#!/usr/bin/env python3
"""
Labels the Leaves yardstick's sample pages (docs/leaves-yardstick.md, truth set B): for each page of pages.json,
Claude Code reads the page's picture and lists every game the page names. It uses Claude Code signed in on this
computer (as tools/shelf-helper does), so the reading counts against that account's plan; no API key.

  python label-pages.py pages.json --magazines /path/to/Magazines [--limit 10] [--model sonnet]

pages.json comes from `npm run leaves:yardstick -- sample-pages`. A page already labelled is left as it is (delete its
"labelledBy" to have it read again), so the run can be stopped and started. Each page is cut in two overlapping
halves so its small print can be read. Afterwards, correct some pages by hand: set "checked": true on those.
Needs Python 3 with Pillow (pip install pillow). Pictures are read from the scans, never changed.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile

SCHEMA = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["contents", "review", "preview", "news", "ad", "feature", "guide", "letters", "other"]},
        "games": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"title": {"type": "string"}, "printed": {"type": "string"}, "console": {"type": "string"}},
                "required": ["title"],
            },
        },
    },
    "required": ["kind", "games"],
}

PROMPT = """This is one page of the video game magazine {magazine}, {date}. It is in two overlapping image files in this
folder, top.jpg and bottom.jpg: read both with the Read tool.

List every video game the page names, anywhere on it: headings, body text, captions, charts, lists, advertisements,
price lists. For each: title (the game's full official title as you know it), printed (the words exactly as the page
prints them, when they differ), console (the console the page gives for it, if it does). List a game once. Leave out
series or franchises named only in general ("the Final Fantasy series"), consoles, companies, magazines, films and
people. If a title is only in a logo or box art you can read, include it. Also say the page's kind: contents, review,
preview, news, ad, feature, guide, letters or other."""


def claude(prompt, cwd, model):
    env = {**os.environ, "ENABLE_CLAUDEAI_MCP_SERVERS": "0"}
    run = subprocess.run(
        [shutil.which("claude") or "claude", "-p", "--output-format", "json", "--json-schema", json.dumps(SCHEMA), "--model", model,
         "--permission-mode", "dontAsk", "--permission-prompts", "none", "--no-session-persistence",
         "--strict-mcp-config", "--mcp-config", '{"mcpServers": {}}', "--setting-sources", "project",
         "--tools", "Read", "--allowedTools", "Read(./**)"],
        cwd=cwd, env=env, input=prompt, capture_output=True, text=True, timeout=540,
        **({"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}),
    )
    if run.returncode != 0:
        raise RuntimeError(f"Claude Code exited {run.returncode}: {(run.stderr or run.stdout)[-300:].strip()}")
    outer = json.loads(run.stdout)
    if outer.get("is_error"):
        raise RuntimeError(f"Claude stopped: {outer.get('subtype') or 'error'}")
    inner = outer.get("structured_output")
    if not isinstance(inner, dict):
        text = str(outer.get("result") or "").strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        inner = json.loads(text)
    return inner, outer.get("usage") or {}


def halves(scan, page, folder):
    """The page's picture from its CBZ (pages in name order), as two overlapping halves no longer than 1568 pixels."""
    from PIL import Image  # asked for here, so --help works without it

    with zipfile.ZipFile(scan) as z:
        names = sorted(n for n in z.namelist() if re.search(r"\.(jpe?g|png|webp|gif)$", n, re.I))
        with z.open(names[page - 1]) as f:
            im = Image.open(f).convert("RGB")
    cut = int(im.height * 0.55)
    for name, box in (("top.jpg", (0, 0, im.width, cut)), ("bottom.jpg", (0, im.height - cut, im.width, im.height))):
        piece = im.crop(box)
        piece.thumbnail((1568, 1568))
        piece.save(os.path.join(folder, name), quality=88)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pages")
    ap.add_argument("--magazines", required=True, help="the magazines folder (each issue's path in pages.json is under it)")
    ap.add_argument("--limit", type=int, default=0, help="stop after this many pages (a first try)")
    ap.add_argument("--model", default="sonnet")
    args = ap.parse_args()
    with open(args.pages, encoding="utf-8") as f:
        doc = json.load(f)
    done = 0
    used = {"input_tokens": 0, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0, "output_tokens": 0}
    for p in doc["pages"]:
        if p.get("labelledBy"):
            continue
        if args.limit and done >= args.limit:
            break
        work = tempfile.mkdtemp(prefix="leaves-label-")
        started = time.time()
        try:
            halves(os.path.join(args.magazines, p["path"]), p["page"], work)
            date = f"{p['year']}-{int(p.get('month') or 0):02d}" if p.get("month") else str(p["year"])
            answer, usage = claude(PROMPT.format(magazine=p["magazine"], date=date), work, args.model)
        except Exception as err:  # one page failing doesn't stop the rest
            print(f"{p['magazine']} {p['issueId']} p.{p['page']}: {err}", file=sys.stderr)
            continue
        finally:
            shutil.rmtree(work, ignore_errors=True)
        p["kind"] = answer.get("kind") or p.get("kind") or "other"
        p["games"] = [{k: g[k] for k in ("title", "printed", "console") if g.get(k)} for g in answer.get("games") or [] if g.get("title")]
        p["labelledBy"] = f"claude-code:{args.model}"
        p["checked"] = False
        for k in used:
            used[k] += int(usage.get(k) or 0)
        done += 1
        print(f"{done}: {p['magazine']} {p['year']} p.{p['page']}: {p['kind']}, {len(p['games'])} games, {time.time() - started:.0f} s", flush=True)
        # Kept after every page: stopping loses nothing.
        with open(args.pages, "w", encoding="utf-8", newline="") as f:
            json.dump(doc, f, ensure_ascii=False, indent=1)
            f.write("\n")
    print(f"{done} pages labelled; tokens: {used}")


if __name__ == "__main__":
    main()
