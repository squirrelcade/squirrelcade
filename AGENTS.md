# Squirrelcade: instructions for AI assistants

Shared by Claude Code (`CLAUDE.md` imports this file) and any other assistant working on this repository. Keep it current and tool-neutral.

## Read first

- `README.md`: what Squirrelcade is, and how it's installed.
- `docs/PLAN.md`: the decisions, architecture, data model and phases.
- `docs/DECISIONS.md` (each decision with its reasons) and `CHANGELOG.md` (what each version changed).
- Someone working on their own copy may keep notes in `private/` (ignored by git): `private/STATUS.md` (where the work stands) and `private/OWNER.md` (their own rules). Read them when they're there, and keep `private/STATUS.md` current at the end of a work session.

## Nothing private in a tracked file

The repository is public, and git history keeps everything that was ever committed. So none of this goes into a tracked file:

- Credentials: API keys, tokens, passwords, service-account files, SMTP credentials.
- Personal data: anyone's collection (spreadsheets, exports, prices paid), email addresses.
- Home-network details: IP addresses, hostnames, server and share paths.

Keep those in `private/` or in local config outside the repository, and commit placeholders instead (for example `docker-compose.example.yml`). Check the staged diff before every commit.

## Every decision is a setting

Squirrelcade is built around its owner's preferences, but it's meant for anyone to install. Never hard-code a personal choice (tastes, consoles, regions, rule values, points, list sizes, schedules, folders, limits). Make it a setting with a description and a neutral default. See "Settings" in `docs/PLAN.md`.

## It works on its own

Squirrelcade runs in a Docker container with nothing else required: no AI, no PriceCharting, no outside account. A collection can be typed in by hand (Add a game), and every outside service (PriceCharting's exports, IGDB, Playnite, RomM, notifications, Claude) is an optional part that makes it better. Keep it that way: a new feature never needs one of those to work.

## The website follows the app

squirrelcade.com is the one-page site in `site/`. When a feature is added or changed and that touches what the site says or shows (its pitch, the "what it does" cards, the getting-started steps, the screenshots, the share image), update the site in the same piece of work and redeploy it (`docs/website.md`). Screenshots come only from the made-up demo collection (`scripts/demo.mjs`), never anyone's own.

## The guides and the AI setup prompt follow the app too

A change that adds or changes something to set up or configure updates, in the same piece of work: Help, the README and install guides, and both AI setup prompts (`docs/ai/setup-prompt.md`, for before installing, and the one an install writes, `apps/server/src/aiSetup.ts`), including the settings file the AI can write. The prompts are meant to take someone through setup and configuration from start to finish, by pasting them into any AI chat.

## It stays snappy

Every feature keeps the app fast to use: searching, scanning a barcode, opening a page. Heavy work (downloading a catalog, reading a channel's videos, matching thousands of titles) runs once or in the background, and its results are stored or kept in memory, so everyday use only reads what's already there. A one-time wait while data is first gathered is fine; a slower search or page from then on isn't. Never do on each keystroke or request what could be done once and kept. Time the main paths (the search, a barcode lookup, the game page) before and after a change that touches them.

## The version shows

The version a server runs shows at the bottom of the menu, small and grey ("Squirrelcade 1.2.2 · f6b0323", from `/api/v1/health`; D170), so the owner can tell at a glance that an update arrived. Keep it there, quiet but visible, through any redesign of the menu.

## The Stash's chest and the console marks

Two symbols say what the owner has (D142, D175, D185; the owner's rule, 2026-11-06). Keep them consistent everywhere, use them together often, and never add another symbol for "you have it".

- **The Stash's chest means "yours".** Wherever a page says what the owner has, the chest marks it: filled when they have it, grey when they don't. That includes:
  - a count or a bar of what they have of one console (Nutshell's Games and Complete columns, the console cards' bar);
  - a game's verdict ("You own it").
- **The console marks mean "where".** When a game is shown across consoles, its marks show which ones: in color where the owner has it, grey where they don't, PC at the right end. Where a page is already about one console (its row, its card, its page), the console isn't repeated: the chest alone says it's theirs.
- **On every cover, both:** a banner at the top shows, in order:
  1. the chest: filled when the owner has the game on any console or PC, grey when they don't;
  2. two console marks, one per company: the newest consoles they have it on, then the newest other consoles it came out on, grey;
  3. PC, at the right end.

  A game they don't have shows all of it in grey. When a cover belongs to one console's version (the game of the day, a console's list, a game's page for one console, a copy), that console takes the first mark, in color if the owner has it there, grey if not; the second goes to the next-newest other console it came out on (the owner's, in color, first), then PC (the owner's rule, 2026-11-08). Covers that aren't about one console's version (a series, a year's Top 20) keep the rule above.
- **Hover text:** a mark that says whether the owner has the game there says "<console> (owned)" or "<console> (unowned)", in its tooltip and its label; the cover's chest says "Stash (owned)" or "Stash (unowned)". A mark that only names a console (a filter chip) says its name.

## Words

In what people read, a console is a **console**: Nutshell > Consoles and Roots > Consoles, "the consoles you have it on". PC is named as PC. "Platform" stays in code, the API and the database.

## Hard rule

- Never handle passwords: the person types them.

## Ticky (to-dos)

- At the start of a session, check Ticky for open tasks tagged `claude-code` in this project (the Zebintosh hub's `tickintosh_list_tasks`, view "open", label "claude-code", project "Squirrelcade") and bring them up with Mark before other work.
- To-dos go to Tickintosh (Ticky) through the `tickintosh_*` hub tools, never Todoist; tag `ai` for checks Claude should do itself when due.
