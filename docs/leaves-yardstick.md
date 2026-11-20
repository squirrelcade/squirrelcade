# The Leaves yardstick

Leaves finds the games a magazine's pages name ([Help: Leaves](help/magazines.md), "The games in the magazines"). The yardstick measures how well, so a change to the finding can be judged by numbers before it ships: how many of the games known to be in an issue it finds, and how many of the games it links are right.

It runs against a **copy** of an install's magazine database and never writes to it. What it finds goes to a run file of its own.

## What it measures against

**Truth set A, the reviews Wikipedia cites.** Leaves already keeps every printed review that a game's Wikipedia article cites in an issue you have ("EGM, June 1994, p. 28"). Each says: this game is reviewed in this issue. The yardstick counts how many of them the page-text finding also found in that issue: **linked**, **a maybe** (found, left to answer on Review > Magazines) or **missed**, by magazine and by five-year era.

Three things make it a fair count:

- **Citations that name a page are counted apart.** A citation with a date only is often a website's review, set against that month's issue, where the printed review may not be. The reviews citing a page are the surer half and the number to watch.
- **A citation set against the wrong issue is left out**: one whose game came out more than a year after the issue.
- **A game found by its article alone is read by its own name**, not the article's ("Deadpool (video game)").

For each miss it says why, from the issue's own text, the first that fits: the exact title is on a page; it's there in another spelling (& for and, 2 for II, a possessive, a mark between words); only its main title; its words run together or split; one character misread; all its words on one page, out of order; or not in the text read at all. And whether the game was among the games the issue was checked for.

Truth set A measures finding (recall) only: it knows some games that are in an issue, never which games are not.

**Truth set B, pages whose every game is listed.** About 300 pages, spread over magazines, eras and kinds of page (contents, reviews, previews, news, ads), each with every game the page names. It gives both numbers: of the games linked on those pages, how many are right, and of the games on them, how many were linked.

- `sample-pages` picks the pages (the same ones every time for the same library) and writes `pages.json` with no games yet.
- [`tools/leaves-yardstick/label-pages.py`](../tools/leaves-yardstick/label-pages.py) has Claude Code read each page's picture and list its games, on the plan of the account signed in on that computer (as the Check a shelf helper does). Then correct some pages by hand and set `"checked": true` on them: the hand-checked pages say how far to trust the rest.
- `run --labels pages.json` adds the two numbers to the report.

Until those pages are labelled, precision is judged by hand on samples: `sample` prints some of a run's finds with the words around each, to mark right or wrong.

## Running it

1. **Make the copy**, on the computer that has the install's config folder (it opens both databases read-only):

   ```sh
   python3 tools/leaves-yardstick/snapshot.py --config /path/to/config --out /path/to/leaves-audit
   ```

   The copy holds the magazines' text, about 20 KB a page: keep it out of the repository (and out of anything that's backed up to somewhere public).

2. **Measure**, from the repository:

   ```sh
   # What the install's own finding found, as the copy holds it:
   npm run leaves:yardstick -- run --data /path/to/leaves-audit --stored --label before
   # Every issue looked through again with the code as it is now:
   npm run leaves:yardstick -- run --data /path/to/leaves-audit --label after
   npm run leaves:yardstick -- compare /path/to/leaves-audit/runs/before.json /path/to/leaves-audit/runs/after.json
   ```

   A run looks through every issue with the same code the nightly task uses (`spotIndex`, `spotIssue` and `spotWindow` in `packages/core/src/spotting.ts`), on several processor cores: about a minute and a half for 285,000 pages on 12 cores. It keeps `<label>.json` (the numbers), `<label>.md` (the report) and `<label>.db` (every game found, to look into).

Other options and commands:

- `--only cited` looks through only the issues with a cited review (a third of the time, for trying things).
- `--no-evidence` leaves each page as it alone reads (without what the rest of the issue settles); `--cited` lets a cited review settle a maybe, as the nightly task does. It's left out by default because the citations are what the finding is measured against.
- `--link-at 0.8` and `--ask-at 0.6` try other bars than the install's.
- `why --data <folder> --issue <id> --title "<game>"` says whether a game was a candidate for an issue, where its words are on the pages, and what the finding made of them.
- `sample --data <folder> --run runs/after.db --not-in runs/before.db --n 100` prints 100 finds the second run doesn't have, each with its surroundings, to judge by hand.

## Reading the report

- **Linked** and **Found** of the reviews citing a page are the two numbers that say how well games are found. Found counts the maybes too.
- **Games linked** and **Maybes** say what the owner sees: more links at the same precision is better; fewer maybes means less to answer.
- **Different printed words among the maybes** is how many answers would clear the pile: each answer on Review > Magazines is a rule for those printed words.
- A change that raises Linked should come with a hand-judged sample (or the labelled pages) showing the new links are right about as often as the old.
