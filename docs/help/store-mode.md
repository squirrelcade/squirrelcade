# Store Mode

Store Mode is for your phone in a store (or a friend's list of games for sale): type a title or scan a barcode, and it tells you at once, in large type on a color you can read at a glance (green when you need it, a green tint when it's yours, gold when it needs a look, blue when it's on another console), with the one thing that matters most under it. The camera button at the top of every page (**Store Mode** on a computer) opens it with the camera on.

- **You own this** (and, for a copy you have, its value);
- **Owned on another console**, or **You have it on PC**;
- **Need it**, with its place on your wishlist and its acorns, or **Need it if physical** for a game not confirmed as a physical release;
- the [sets](sets.md) it's in, and your note on it.

A game you don't have has **Price on PriceCharting** (what it sells for, in your browser; for a scanned game, the page of that very edition) and your shop links. **I bought it** adds a copy of the game to your collection right away, in the condition Settings > Collection > Adding copies gives a game just bought (complete in box unless you change it), bought today. **what you paid?** beside **undo** takes the price there and then (its condition, and anything else, can be changed in its drawer). Under the answers, **Added here, not on PriceCharting yet** lists those copies, each with **undo** and what you paid. **Scan another** opens the camera again.

## Scanning barcodes

The phone's camera reads the barcode: hold it flat, about a hand's width away, and tilt a shiny case so the light doesn't shine on the barcode. Where the phone lets the browser switch its light (Chrome on Android), a **Light** button shows.

The first time Squirrelcade sees a barcode, it asks UPCitemdb what product it is (free: 100 lookups a day and 6 a minute; Settings > Sources > Barcodes can turn that off, or choose UPC Database, or both) and finds the game inside the name it gets back, whatever the publisher, edition or packaging words around the title, on the console the name gives first. Tap **This is it** on the right game once and Squirrelcade remembers the barcode. Linked to the wrong game? Under a barcode linked before, **Not this game?** forgets the link: tap **This is it** on the right one.

When nothing matches, **Search by title** puts the name in the search box: tap **This is it** on the game you find, and the barcode is linked to it all the same. **Look it up on PriceCharting** opens PriceCharting's page for the barcode, which names most games. Each lookup is noted in System > Logs (the barcode and what the service called it, or that it didn't know it), so a scan that found nothing can be looked into later.

What the service says is kept for good: each game costs one lookup, ever, for everyone who scans it, even with the service turned off later (a code it didn't know is asked about again after a week). Squirrelcade never asks faster than 6 a minute: a new barcode over that waits its turn and is looked up in the background, and Store Mode says so, counts down and asks again by itself. Under a new barcode's answer, Store Mode shows how many lookups are left today, in bold once 10 or fewer are left.

**A second barcode service:** UPC Database (upcdatabase.org) knows other barcodes. Make a free account there, register an application in your dashboard, and put its key in Settings > Sources > Barcodes (100 lookups a day free; its paid plans start at a few dollars a month for 1,000 a day). Choose it on its own, or **UPCitemdb, then UPC Database**: a barcode UPCitemdb doesn't know is asked of UPC Database, and once UPCitemdb's lookups are used up for today, UPC Database answers alone. A barcode UPCitemdb didn't know before is asked of UPC Database once it's chosen. Each lookup in System > Logs says which service answered, so you can see which knows more of your games.

The camera needs Squirrelcade to be reached over **HTTPS** (a reverse proxy or a tunnel with a certificate); browsers don't allow the camera on plain HTTP. "Add to Home Screen" in the phone's browser gives Squirrelcade an app icon.

## Scan my shelf

**Store Mode > Scan my shelf** teaches Squirrelcade your own games' barcodes, at home at an easy pace, so each one answers at once in a store, even with no signal, and never needs the barcode service.

1. Choose **the console on the shelf** (it's remembered on this phone or computer). Beside it: how many of that console's games have their barcode.
2. **Scan** a game (or type its barcode and press **Look**). One Squirrelcade already knows says **Already known** with its title.
3. For a new one, type **a few letters of its title**: your games on that console that match are listed. **This is it** saves the barcode.
4. A wrong one? **Undo** beside it in this visit's list, or **Not this game?** on one Already known, and choose again.

This page never asks the barcode service (UPCitemdb or UPC Database), so their daily lookups are left for stores. A game on another console? Choose that console first.

## With no signal

Stores often have none. Store Mode keeps a copy of its answers in your phone's browser, updated each time it opens (and downloaded again only when something changed), and answers from that copy when Squirrelcade can't be reached, saying so. **I bought it** works there too: the purchase waits on the phone and is added to your collection as soon as Squirrelcade answers again (once, even if it's sent twice). Open Store Mode once while you're connected; after that it works offline.

Squirrelcade itself opens with no signal too, even when the phone has closed the tab: its own files stay on the phone after a visit with a connection (a service worker, which only Squirrelcade's HTTPS address can use), and it opens with a note that only Store Mode works until Squirrelcade answers again. After an update, the first visit with a connection brings the new files.

Signing out removes the copy (and then Squirrelcade no longer opens without a connection). Settings > Interface > "Answer without a connection" turns all of it off, and removes the files from the phone.

## Check a list

**Store Mode > Check a list:** paste a list of games (a store's list, a lot for sale), one per line, with the console if you like ("Chrono Trigger (SNES)"), and see which you own, which you need, and which you have on another console. Barcodes work too, one per line, as a handheld scanner types them.

## For someone shopping for you

The sign-in page can lead with a check of its own, for family who don't have an account: see [Sharing your collection](sharing.md).
