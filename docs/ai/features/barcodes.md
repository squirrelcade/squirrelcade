# Set up naming barcodes in Squirrelcade

I already have **Squirrelcade** (version 1.4.0 or later), a free, self-hosted web app for my video game collection, running. Please help me set up **one thing**: naming barcodes. Read all of this first.

**Your first message:** say in one sentence what we'll do, tell me the time to allow ("about 5 minutes; give it 10"), then ask me the question under "Have ready" and STOP and wait.

## How to work with me

- **One step at a time.** Give me the exact clicks or fields for one step, then STOP and wait until I say it's done or tell you what I see. Keep messages short.
- **Never ask me for a password, API key, token, app password or webhook address, and don't let me paste one into this chat.** Tell me where to get it (its official page) and where it goes in Squirrelcade. I type it there myself, press its **Test** (or **Save and test**) button and tell you what it said. If I paste a secret anyway, tell me it's exposed, so I make a new one.
- **Ask before changing my server.** Before a command or a click that installs, changes or deletes something, say what it does and wait for my OK. Read-only checks need no OK.
- **Stick to the facts:** this brief, Squirrelcade's own Help (Help in its menu, and the ? on each page) and the official pages named here. Never make up a menu or a setting. If what I see doesn't match, ask me what I see.
- **Free and simple first.** Say what each thing costs in money and upkeep, and never push an extra I didn't ask for.
- **I may stop at any point.** Then say what's done and what's left. Settings > Features in Squirrelcade lists every optional feature, with a **Set it up with AI** button that copies this prompt again to pick up later.

## What it is

Store Mode (the page for your phone in a store) matches a scanned barcode against the barcodes in your collection and the catalogs. For a barcode it has never seen, Squirrelcade can ask a lookup service what product it is, so the game can still be found. Only the barcode's digits are sent. Options: **UPCitemdb** (free, no account, about 100 lookups a day), **UPC Database** (a free account's key), both, or off.

## Have ready

- Nothing for UPCitemdb. For UPC Database: a free account at https://upcdatabase.org and its API key (ask me whether I want it; UPCitemdb alone is usually enough).

## Steps

1. In Squirrelcade: **Settings > Sources > Barcodes**, **Name unknown barcodes with**. UPCitemdb is the start; pick **UPC Database** or **Both** if I want that one.
2. For UPC Database: I make the account at https://upcdatabase.org, copy my API key from my account page, and type it into **UPC Database key** in Squirrelcade myself. Save.

## Check that it works

- **System > Status > Integrations:** the barcode lookup light is green (grey when it's off).
- In Store Mode, scan or type a barcode that isn't in my collection: a product name comes back.

## How long it takes

about 5 minutes; give it 10. The second number is on purpose: setting up outside accounts usually takes longer than it looks, and nobody should feel behind.

## If something goes wrong

- "Not found" for a barcode: not every barcode is in every service; try Both.
- UPCitemdb's free allowance is about 100 a day: it resumes the next day.
