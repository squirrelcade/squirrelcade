# Squirrelcade's logo

The pixel squirrel: a squirrel holding its acorn, on a 16 × 16 pixel grid. The owner chose a first one on 2026-10-01 (D100), with the name Squirrelcade (D99); their brand kit of 2026-10-05 redrew it in browns and acorn gold, with the app icon on deep green (D116). `node scripts/make-icons.mjs` draws every file here from the same grid and copies the app's icons into `apps/web`.

![Squirrelcade](wordmark.png)

## Colors

| Part | Color | Also used for |
|---|---|---|
| Tail | `#c27a3f` | |
| Tail's light side | `#e3a866` | |
| Body | `#8e5428` | |
| Belly | `#e9cfa6` | |
| Acorn cap | `#6b3a10` | the acorn icon's cap, everywhere acorns are counted |
| Acorn | `#46a36b` | the acorn icon (a green nut, as the first logo had it, D140); the app's gold (`#e9b44c`) still marks what's wanted, missing or to check |
| Eye | `#111111` | |
| Deep green | `#16392a` | the app icon's background; the app's highlighted panels and secondary buttons |

The wordmark's "squirrel" is `#c0763a` on dark backgrounds and `#a8632d` on light ones; "cade" is the arcade green, `#3dbe74` on dark and `#1e7546` on light. The app's other colors (the charcoal neutrals, the platform colors) are in `apps/web/src/brand.css`.

## Type

The wordmark is set in [Fredoka](https://fonts.google.com/specimen/Fredoka) Bold (700), free under the SIL Open Font License, with "squirrel" and "cade" in two colors. Labels and big numbers in the app use [Silkscreen](https://fonts.google.com/specimen/Silkscreen), a pixel typeface (also under the SIL Open Font License); running text stays in the system's font.

## Files

| File | For |
|---|---|
| `squirrelcade.svg` | The squirrel alone, at any size (a browser tab, a page header) |
| `icon.svg` | The app icon: the squirrel on deep green |
| `favicon-16.png`, `favicon-32.png` | Browser tabs |
| `icon-192.png`, `icon-512.png` | The web app's icons (its manifest) |
| `icon-maskable-512.png` | Android's home screen, which crops icons to a circle or other shapes (more room around the squirrel) |
| `apple-touch-icon.png` | iPhone and iPad home screens (180 × 180) |
| `pushover-128.png` | The Pushover application's icon (Pushover asks for 128 × 128, transparent) |
| `avatar-500.png` | A GitHub organization's picture |
| `wordmark.png`, `wordmark-dark.png` | The squirrel and the name, for light and for dark backgrounds |

## Using it

- It's pixel art: show it at whole multiples of 16 pixels (16, 32, 48, 64...), or as SVG, which keeps its edges sharp (`shape-rendering="crispEdges"`). Never smooth or blur it.
- Keep the squirrel facing right, holding its acorn, and its colors as they are.
- Every PNG here is drawn from the same 16 × 16 grid as the SVGs, at a whole number of screen pixels per squirrel pixel.
