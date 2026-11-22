#!/usr/bin/env python3
"""
Makes the copy the Leaves yardstick measures against (docs/leaves-yardstick.md), from an install's config folder:

  python3 snapshot.py --config /path/to/squirrelcade/config --out /path/to/leaves-audit

Both databases are opened read-only; nothing in the config folder is written or changed. It writes, in --out:
- magazines-audit.db: Leaves' issues, pages (text and words), mentions, the owner's answers. Not the search index,
  so it's smaller than magazines.db (about 5.6 GB for 285,000 pages);
- releases.jsonl: IGDB's games as Squirrelcade keeps them (console, title, other names, release day, kind), one a line:
  the games an issue is checked for;
- settings.json: the install's own magazines.* settings (the rest are the defaults).
No key, account or collection is copied. The copy holds the magazines' text: keep it out of the repository.
Python 3, nothing to install. Run it where the config folder is (the server), then move the folder if you like.
"""
import argparse
import json
import os
import sqlite3
import time


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", required=True, help="the install's config folder (magazines.db and squirrelcade.db)")
    ap.add_argument("--out", required=True, help="the folder to write the copy to")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    started = time.time()
    dst = os.path.join(args.out, "magazines-audit.db")
    if os.path.exists(dst):
        os.remove(dst)
    out = sqlite3.connect(dst, isolation_level=None)
    out.execute("pragma journal_mode = off")
    out.execute("pragma synchronous = off")
    out.execute("attach ? as src", (f"file:{os.path.join(args.config, 'magazines.db')}?mode=ro",))
    # One read of the live database, so the copy is of one moment.
    out.execute("begin")
    for table in ("magazines", "issues", "pages", "mentions", "mention_rules", "state"):
        out.execute(f"create table main.{table} as select * from src.{table}")
        print(table, out.execute(f"select count(*) from main.{table}").fetchone()[0], flush=True)
    out.execute("commit")
    out.execute("detach src")
    out.execute("create unique index pages_pk on pages(issue_id, n)")
    out.execute("create index mentions_issue on mentions(issue_id, source)")
    out.execute("insert into state (key, value) values ('snapshotAt', datetime('now'))")
    out.close()

    app = sqlite3.connect(f"file:{os.path.join(args.config, 'squirrelcade.db')}?mode=ro", uri=True)
    with open(os.path.join(args.out, "releases.jsonl"), "w", encoding="utf-8", newline="") as f:
        n = 0
        for key, data in app.execute("select p.key, g.data from igdb_games g join platforms p on p.id = g.platform_id"):
            g = json.loads(data)
            f.write(json.dumps({"k": key, "t": g.get("name"), "alt": g.get("altNames") or [], "day": g.get("released"), "type": g.get("gameType")}, ensure_ascii=False) + "\n")
            n += 1
    print("releases", n)
    with open(os.path.join(args.out, "settings.json"), "w", encoding="utf-8", newline="") as f:
        json.dump({k: v for k, v in app.execute("select key, value from settings where key like 'magazines.%'")}, f, indent=1)
        f.write("\n")
    print(f"done in {time.time() - started:.0f} s: {os.path.getsize(dst) / 1e9:.1f} GB in {args.out}")


if __name__ == "__main__":
    main()
