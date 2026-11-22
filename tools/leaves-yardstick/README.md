# The Leaves yardstick's helpers

Two scripts for [the Leaves yardstick](../../docs/leaves-yardstick.md), which measures how well Squirrelcade finds the games on your magazines' pages. Neither changes an install: both only read.

- **`snapshot.py`** makes the copy the yardstick measures against, from an install's config folder (both databases opened read-only):

  ```sh
  python3 snapshot.py --config /path/to/config --out /path/to/leaves-audit
  ```

- **`label-pages.py`** labels the yardstick's sample pages: Claude Code, signed in on the computer it runs on, reads each page's picture and lists every game the page names. It counts against that Claude account's plan (no API key), a page at a time, and can be stopped and started:

  ```sh
  npm run leaves:yardstick -- sample-pages --data /path/to/leaves-audit --out pages.json
  python3 label-pages.py pages.json --magazines /path/to/Magazines --limit 10   # a first try
  python3 label-pages.py pages.json --magazines /path/to/Magazines
  ```

  It needs Python 3 with Pillow (`pip install pillow`) and Claude Code (`claude`, signed in once). It reads the page's picture from the scan and cuts it in two overlapping halves so small print can be read. Correct some pages by hand afterwards and set `"checked": true` on them.

The copy and `pages.json` hold your magazines' text and what's in your library: keep them out of the repository.
