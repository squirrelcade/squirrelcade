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

## The version shows

The version a server runs shows at the bottom of the menu, small and grey ("Squirrelcade 1.2.2 · f6b0323", from `/api/v1/health`; D170), so the owner can tell at a glance that an update arrived. Keep it there, quiet but visible, through any redesign of the menu.

## Hard rule

- Never handle passwords: the person types them.
