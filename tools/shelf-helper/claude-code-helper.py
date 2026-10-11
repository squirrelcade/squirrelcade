#!/usr/bin/env python3
"""A helper for Check a shelf (Squirrelcade, D147): asks Squirrelcade for shelf photos to read and answers with the
game titles on them, using Claude Code signed in on this computer, so the reading runs on that account's own Claude
plan (no API key). Squirrelcade's Settings > Sources > Vision model > Kind of API: "A helper of your own".

Any program can be a helper the same way (this one is only an example): GET /api/v1/helper/next with the API key waits
up to 25 seconds and answers 204 when there's nothing, or {id, prompt, console, pieces: [data URLs]}; the answer is
POST /api/v1/helper/answer {id, titles: [...]} (or {id, error}).

Settings, from the environment:
  SQUIRRELCADE_URL   Squirrelcade's address from here (default http://127.0.0.1:7575)
  SQUIRRELCADE_KEY   its API key (Settings > Security > API key), or
  SQUIRRELCADE_DB    its database file, to read the key from (read-only) when Squirrelcade runs on this computer
  CLAUDE_BIN         Claude Code (default: claude on the PATH)
  CLAUDE_MODEL       the model it reads with (default sonnet; reading spines needs no more)
Standard library only. It reads one photo at a time, in a scratch folder holding only that photo's pieces, and Claude
Code may only read them: no other tools, no connectors. Run it as a service (README.md beside it).
"""
import base64
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

URL = os.environ.get("SQUIRRELCADE_URL", "http://127.0.0.1:7575").rstrip("/")
CLAUDE = os.environ.get("CLAUDE_BIN") or shutil.which("claude") or "claude"
MODEL = os.environ.get("CLAUDE_MODEL", "sonnet")
SCHEMA = {"type": "object", "properties": {"titles": {"type": "array", "items": {"type": "string"}}}, "required": ["titles"]}
EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


def log(msg):
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def api_key():
    if os.environ.get("SQUIRRELCADE_KEY"):
        return os.environ["SQUIRRELCADE_KEY"]
    db = os.environ.get("SQUIRRELCADE_DB")
    if not db:
        sys.exit("Set SQUIRRELCADE_KEY, or SQUIRRELCADE_DB to read it from Squirrelcade's database.")
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        return con.execute("select value from app_state where key = 'apiKey'").fetchone()[0]
    finally:
        con.close()


def call(method, path, key, body=None, timeout=40):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(URL + path, data=data, method=method, headers={"X-Api-Key": key, "Accept": "application/json", **({"Content-Type": "application/json"} if data else {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        return r.status, (json.loads(raw) if raw else None)


def answer_of(out):
    """The titles from `claude -p --output-format json` (its structured_output, or JSON in its result)."""
    outer = json.loads(out)
    if outer.get("is_error"):
        raise RuntimeError(f"Claude stopped: {outer.get('subtype') or 'error'}")
    inner = outer.get("structured_output")
    if not isinstance(inner, dict):
        text = str(outer.get("result") or "").strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        inner = json.loads(text)
    titles = inner.get("titles")
    if not isinstance(titles, list):
        raise RuntimeError("Claude's answer had no titles")
    return [t for t in titles if isinstance(t, str)]


def read(job):
    """Claude Code reads the photo's pieces from a scratch folder; returns the titles."""
    work = tempfile.mkdtemp(prefix="shelf-")
    try:
        names = []
        for i, piece in enumerate(job.get("pieces") or [], 1):
            head, _, data = piece.partition(",")
            mime = head.removeprefix("data:").removesuffix(";base64")
            if mime not in EXT:
                continue
            name = f"piece-{i}.{EXT[mime]}"
            with open(os.path.join(work, name), "wb") as f:
                f.write(base64.b64decode(data))
            names.append(name)
        if not names:
            raise RuntimeError("no pieces to read")
        prompt = (
            f"{job.get('prompt')}\n\nThe photo is in {len(names)} overlapping pieces, the image files {', '.join(names)} in this folder: "
            "read each one with the Read tool. Answer with every title you can read on any of them, each once, in titles."
        )
        env = {**os.environ, "ENABLE_CLAUDEAI_MCP_SERVERS": "0"}
        run = subprocess.run(
            [CLAUDE, "-p", prompt, "--output-format", "json", "--json-schema", json.dumps(SCHEMA), "--model", MODEL,
             "--permission-mode", "dontAsk", "--permission-prompts", "none", "--no-session-persistence", "--tools", "Read", "--allowedTools", "Read"],
            cwd=work, env=env, capture_output=True, text=True, timeout=540, stdin=subprocess.DEVNULL,
        )
        if run.returncode != 0:
            raise RuntimeError(f"Claude Code exited {run.returncode}: {(run.stderr or run.stdout)[-300:].strip()}")
        return answer_of(run.stdout)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main():
    key = api_key()
    log(f"asking {URL} for shelf photos to read, with {MODEL}")
    pause = 0
    while True:
        if pause:
            time.sleep(pause)
        try:
            status, job = call("GET", "/api/v1/helper/next?wait=25000", key)
            pause = 0
        except urllib.error.HTTPError as e:
            if e.code in (401, 403) and os.environ.get("SQUIRRELCADE_DB"):
                key = api_key()  # the key was changed in Squirrelcade: read it again
            log(f"Squirrelcade said {e.code}")
            pause = 30
            continue
        except Exception as e:
            log(f"Squirrelcade didn't answer ({e.__class__.__name__}); trying again in a while")
            pause = min(300, max(15, pause * 2))
            continue
        if status == 204 or not job:
            continue
        started = time.time()
        try:
            titles = read(job)
            call("POST", "/api/v1/helper/answer", key, {"id": job["id"], "titles": titles})
            log(f"read {len(job.get('pieces') or [])} piece(s): {len(titles)} titles in {round(time.time() - started)} s")
        except Exception as e:
            log(f"couldn't read a photo: {e}")
            try:
                call("POST", "/api/v1/helper/answer", key, {"id": job["id"], "error": str(e)[:300]})
            except Exception:
                pass


if __name__ == "__main__":
    main()
