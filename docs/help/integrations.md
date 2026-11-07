# Integrations

Squirrelcade works on its own: you can type in a collection by hand and nothing else is needed. Every outside part below is optional and makes it better. **System > Status > Integrations** shows a light for each one:

- **Green:** it's on and its last check worked.
- **Yellow:** it needs a look soon: a token about to run out, today's units nearly used, not run lately, or some items failed.
- **Red:** it's on and failing; the line says what went wrong in plain words.
- **Grey:** it's off or not set up.

Each line says when it last worked, links to its setting, and has **Check now**, which runs its check at once (System > Tasks shows it running). The card only shows what Squirrelcade already recorded, so it opens at once. Health at the top of the page says when a light is red, and the menu's System count includes the red ones. To get a message when a light turns red, turn on Settings > Notifications > When an integration turns red.

The **?** beside each line shows its part of this page.

## IGDB

The Internet Game Database: box art, genres, release dates, ratings, the consoles a game came out on, and which games had a disc or cartridge. It makes catalogs, covers, the Top 100's art, Top 20 and much of Roots better.

- **Needs:** free keys from Twitch's developer site (Settings > Sources > IGDB).
- **Leaves your server:** the names of the consoles it reads, never your collection.
- **Red?** The keys were refused (paste them again) or IGDB was down (it tries again).

## The mailbox (PriceCharting exports, purchase emails)

A mailbox Squirrelcade reads for PriceCharting's export emails (your collection's updates) and, if you turn it on, emails about games you bought (On the way).

- **Needs:** an email account's IMAP address and an app password (Settings > Email).
- **Leaves your server:** nothing; Squirrelcade only reads.
- **Red?** The sign-in was refused (a new app password), or the server couldn't be reached.

## Notifications

Messages from Squirrelcade: a summary after an update, a task that keeps failing, loans due, a game you want going on sale. By email, Pushover, Pushbullet, ntfy, Gotify, Discord, Telegram, Slack, a webhook or Apprise.

- **Needs:** the service's token or address (Settings > Notifications).
- **Leaves your server:** the message itself.
- **Red?** The service refused the last message: the line says what it answered. Send a test from Settings > Notifications after fixing it.

## RomM

Your RomM server's games, for the purple Play on RomM buttons.

- **Needs:** RomM's address and an API token (Settings > Sources > RomM).
- **Leaves your server:** nothing but the requests to your own RomM.
- **Red?** RomM can't be reached at its address, or the token was refused.

## Playnite's folder (the PC library)

Playnite's backups, read for your PC games (the PC library and PC wishlist).

- **Needs:** the folder Playnite backs up to, mounted into Squirrelcade (Settings > PC library).
- **Leaves your server:** nothing.
- **Red?** The folder can't be found or read, or a backup couldn't be opened.

## YouTube

Videos of each game's time and since, from the video channels you choose, and Find its videos.

- **Needs:** a free YouTube Data API key (Settings > Sources > YouTube), and Settings > Roots > Videos on a game's page on.
- **Leaves your server:** the channels' names and the games searched for.
- **Yellow?** Today's units are nearly used: they come back at midnight, Pacific time.

## RetroAchievements

What you beat and mastered, from RetroAchievements.

- **Needs:** your username and web API key (Settings > Sources > RetroAchievements).
- **Leaves your server:** your username.
- **Red?** The key was refused, or the site was down.

## Xbox achievements

Your Xbox achievements, through OpenXBL.

- **Needs:** an OpenXBL API key (Settings > Sources > Xbox achievements).
- **Leaves your server:** your key, to OpenXBL.

## Steam

Your Steam achievements and play.

- **Needs:** a Steam Web API key and your Steam ID (Settings > Sources > Steam achievements).
- **Leaves your server:** your Steam ID.

## PlayStation trophies

Your PlayStation trophies and platinums.

- **Needs:** a token from PlayStation's site (Settings > Sources > PlayStation trophies). It runs out every few months.
- **Yellow or red?** The token is running out or ran out: get a new one the same way and paste it.

## IsThereAnyDeal and GG.deals (PC prices)

PC game prices and deals, for the PC wishlist.

- **Needs:** free API keys (Settings > Sources).
- **Leaves your server:** the PC games on your wishlist.

## GameFly

GameFly's prices for the games on your wishlist, as a place to buy.

- **Needs:** nothing; turn it on in Settings > Sources.
- **Leaves your server:** the wishlist's game names.

## Exchange rates (Frankfurter)

The European Central Bank's rates, from Frankfurter, for two things: a purchase in another currency (a UK store's pounds, a Canadian shop's dollars) gets its price paid in yours, at the rate of its order's day (On the way); and when your currency isn't dollars, prices in dollars are shown in it.

- **Needs:** nothing. It's on while Settings > Email > On the way > **Turn other currencies into mine** is on (it is to start), or Settings > General > Currency isn't USD.
- **Grey, "Not needed"?** Your prices are in dollars and purchases keep their own currency: nothing to set up.
- **Yellow?** Frankfurter didn't give a rate the last time it was asked: a purchase waiting for its rate gets it on a later look.
- **Leaves your server:** the two currencies' names and the order's day.

## The barcode lookup

Barcodes Squirrelcade doesn't know yet (Store Mode, Add a game) are asked of a barcode database.

- **Needs:** nothing for UPCitemdb; a key for others (Settings > Sources).
- **Leaves your server:** the barcode.

## Wikipedia and Wikidata

The catalogs (each console's list of games), the sets, Roots' articles, reviews of the time and awards, and Top 20's best sellers.

- **Needs:** nothing.
- **Leaves your server:** the names of the pages read.
- **Red?** Wikipedia was busy or down: it tries again.

## The AI model (Check a shelf, Talk)

A vision model for Check a shelf (the spines a phone can't read in a photo of your shelf), and for Talk.

- **Needs:** either a model's address and model name (and a key, if the service wants one) in Settings > Sources > Vision model, or **a helper of your own**: a program on your server that asks Squirrelcade for work and answers with your own AI plan, no API key in Squirrelcade (Help > Store Mode has one that uses Claude Code).
- **Green** with a helper means it asked for work in the last minute and a half; **red** means Squirrelcade is set to a helper but none is asking: is it running?
- **Grey, "Optional, not set up"?** Check a shelf still reads with the phone alone; Talk needs a model.
- **Leaves your server:** the photo or what you asked, to the model or helper you chose.

## Claude's plugin keys

Keys for Claude's plugin and other AI apps to read your collection (Settings > Sources > Vision model).

- **Needs:** a key made in Settings > Claude and AI apps.
- **Leaves your server:** the answers to what the app asks.

## The magazines folder and its night reader

Leaves: your magazine scans, read from a folder (never changed), their text read at night with Tesseract, and the games on their pages found.

- **Needs:** the folder mounted into Squirrelcade, readable by its account (Settings > Magazines).
- **Leaves your server:** nothing.
- **Red?** Usually the folder's permissions: Squirrelcade's account needs to read the folder and every file in it. Help > Magazines says how. Issues that couldn't be opened go back in line by themselves once they can.

## Backups

Squirrelcade's own backups of its database, on a schedule.

- **Needs:** a folder with room (Settings > Storage and backups).
- **Yellow?** The newest backup is older than the schedule says, or the disk is nearly full.

## The HTTPS address

The address you open Squirrelcade at from outside, used in notifications' links. Over https, a phone keeps Store Mode for when there's no connection.

- **Needs:** an https address (Settings > General > Address of this Squirrelcade), from a reverse proxy or a tunnel.
- **Yellow?** It's plain http: everything works except Store Mode with no connection.
