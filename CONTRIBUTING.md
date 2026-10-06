# Contributing

Thanks for helping. Squirrelcade is a small project, so a few things keep it workable:

- **Open an issue first** for anything bigger than a small fix, so we can agree on the approach before you spend time on it.
- **Every decision is a setting.** Squirrelcade is meant for anyone's collection: a taste, a console, a region, a number of points or a schedule belongs in the settings (packages/core/src/settings.ts) with a description and a neutral default, never in the code.
- **It works on its own.** Nothing outside is required: no AI, no PriceCharting, no outside account (games can be typed in with Add a game). Anything that needs another program or an outside service is optional, with a switch (Settings > Features).
- **Ideas and problems** go through the issue forms; [docs/ai/request-prompt.md](docs/ai/request-prompt.md) lets an AI help write one.
- **Decisions are logged** in [docs/DECISIONS.md](docs/DECISIONS.md), with the reason.

## Building and testing

Requires Node.js 22.

```bash
npm install
npm test          # unit tests of all three packages
npm run build
npm start         # the built app on port 7575, data in .dev-config/
```

While working on the interface: `npm run dev:server` and `npm run dev:web` (Vite on port 5175).

- New behaviour comes with tests: domain logic in `packages/core`, API routes in `apps/server` (the tests there run the whole app against a temporary database, with fakes for outside services).
- The browser walk-through: start a fresh install (an empty config folder) and run `SMOKE_UI=1 node scripts/smoke-test.mjs http://127.0.0.1:<its port>` (Chrome, or Edge with `UI_BROWSER=msedge`). CI runs it on every push.
- Files use LF line endings: `npm run check:eol` (and `npm run fix:eol`).
- User-facing text is plain and short; the help guides in [docs/help](docs/help/README.md) are shown in the app too, so change them with the feature.

## Pull requests

Keep them to one change, say what and why, and make sure `npm test` passes. By contributing, you agree your work is released under the project's license, the [GNU Affero General Public License v3.0](LICENSE).
