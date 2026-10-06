# squirrelcade.com

The project's one-page website lives in `site/`: plain HTML and CSS, no build step, hosted free on Cloudflare Pages
(project `squirrelcade`, at squirrelcade.com and www.squirrelcade.com since 2026-10-01; also squirrelcade.pages.dev). It says what Squirrelcade is, shows it, and links to the GitHub repository.

- **Look:** the app's (the October 2026 brand kit, docs/design/redesign.md and docs/brand): charcoal, the arcade green,
  the squirrel's brown and acorn gold; Fredoka for headings and Silkscreen (pixel type) for small labels, both served
  from `site/fonts` (SIL Open Font License, `site/fonts/OFL.txt`); light and dark by the visitor's system setting.
- **Screenshots:** only from a made-up collection, never anyone's own. `node scripts/demo.mjs` makes a demo install and
  its screenshots (box art from IGDB's public game data in `DEMO_IGDB_ROWS`, or with `DEMO_IGDB_ID`/`DEMO_IGDB_SECRET`;
  the demo forgets the keys after its cover sync); `site/shots/` holds web-sized JPEG copies of four of them: Today,
  Store Mode on a phone, a console's Top 100, the collection.
- **Share image:** `site/img/og.png` (1200 × 630).
- **The GitHub button:** "Coming soon to GitHub" (not a link) while the repository is private; "Get it on GitHub", a link to the repository, once it's public (the `is-soon` class and the `<span>` become an `<a href>`).
- **Publishing a change:** Cloudflare dashboard > Workers & Pages > squirrelcade > Create deployment > upload the
  `site` folder's files (or a zip of them).
