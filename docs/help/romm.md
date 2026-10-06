# RomM

[RomM](https://github.com/rommapp/romm) is a self-hosted library for your own game backups, which can play many of them in the browser. Squirrelcade can link your games to the same game in your RomM: **RomM** opens its page there, **Play** starts it in the browser where RomM can run it.

It's off in a new install: **Settings > Sources > RomM (your ROM library)** turns it on.

## Setting it up

1. In RomM, create a **Client API token** with the scopes `roms.read` and `platforms.read` (Squirrelcade only reads).
2. In Squirrelcade, **Settings > Features**, turn on **RomM links**: RomM's address and the token show right under the switch (an address on your own network is best: faster, and no sign-in page in the way). **Save and test** saves them and checks the connection. Once it's on, the rest is in **Settings > Sources > RomM**: if your browser opens RomM at another address (a public one), put that in "RomM address for links".
3. Squirrelcade reads RomM's list of games (the "Update the RomM index" task, daily by default) and links from that list, so pages never wait for RomM, and links follow RomM when it renumbers its games.

Squirrelcade finds a console's RomM platform by IGDB's platform number or its name; Settings > Sources > RomM > RomM platforms fixes one it can't tell. A game is found by its IGDB game first, then by title ("RomM?" marks a match by title alone). Where RomM has several versions of a game, the one from your preferred region is linked (a setting), and betas, demos and hacks come last.

## Games you don't own

By default, Squirrelcade links only games in your collection. **Settings > Sources > RomM > "Link games you don't own"** links the others too, in the Top 100 lists, a console's Start here games and the game drawer. Squirrelcade doesn't endorse piracy: turning this on assumes you own those games, even though they aren't in your collection.

Viewers never get RomM links: your RomM isn't theirs to open.
