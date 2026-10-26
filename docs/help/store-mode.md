# Store Mode

Store Mode is for your phone in a store (or a friend's list of games for sale): type a title (it answers as you type, or press **Go**) or scan a barcode, and it tells you at once, in large type on a color you can read at a glance (green when you need it, a green tint when it's yours, gold when it needs a look, blue when it's on another console), with the one thing that matters most under it. **Scan**, in the bar at the bottom of a phone, opens it with the camera on, and so does the camera button at the top of every page (**Scan** on a computer).

- **You own this** (and, for a copy you have, its value);
- **Owned on another console**, or **You have it on PC**;
- **Need it**, with its place on your wishlist and its acorns, or **Need it if physical** for a game not confirmed as a physical release;
- the [sets](sets.md) it's in, and your note on it;
- its stars beside its name, as on its page (its Top 100 place, Critics' favorite, Launch title), and **Play on RomM** for a game your [RomM](romm.md) has.

A game on several consoles is **one card**, with its consoles' marks (in color where you have it, faded grey where you don't, PC last): the first answer shows to start, and tapping a mark shows that console's. The header's search (on a computer) lists a game once too, with its marks; a mark opens it on that console. The chips above the answers still show one console's only.

A game you don't have has **Price on PriceCharting** (what it sells for, in your browser; for a scanned game, the page of that very edition) and your shop links. **Add it**, the big button beside the answer, adds a copy of the game to your collection right away, bought today, in the condition Settings > Collection > Adding copies gives a game just bought (complete in box unless you change it), and opens the copy's walk-through (the whole screen on a phone): its condition, what you paid and the day, then each of its standard photos, one at a time, each skippable, and **Save and close** (closing the window saves too). **Open the whole form** shows everything on one screen (where it's kept, tags, notes); **Undo: I didn't buy it** takes the copy back. Settings > Collection > Adding copies chooses its questions, turns its photo steps off, or turns it off for the whole window. A new barcode you scanned is linked to the game you add, as **This is it** would. After that the answer says **Bought here**, with **undo**, **what you paid?** and **photos and notes** (the window again). A game you bought online that's **on the way** ([Order emails](orders.md#on-the-way)) says so, with where and for how much: Add it then uses that. Under the answers, **Added here, not on PriceCharting yet** lists those copies, each with **undo** and what you paid. **Scan another** opens the camera again.

**Many games at once.** Bringing home a pile? Scan each one and tap **Add it**: in its walk-through, **Save and scan the next one** saves what you typed and opens the camera again, and closing it saves too. When you sit down with them, **Fill in their details** (on the **Added here** card) opens Stash > Improve on the copies you added here: **Go through them** opens each one's window in turn, for what you paid, the day, photos, a test or a rip, and **Next copy** saves it and goes on to the next. With [order emails](orders.md) on, **Find their prices in my email** beside it opens Stash > Recently added on the last 7 days, where one click looks up all their prices at once.

## Scanning barcodes

The phone's camera reads the barcode: hold it flat, about a hand's width away, and tilt a shiny case so the light doesn't shine on the barcode. Where the phone lets the browser switch its light (Chrome on Android), a **Light** button shows.

Scanning is done with the phone **upright**: turned sideways, the scanner pauses and says "Turn your phone upright to scan", and picks up again, the right way up, when you turn it back. (A web page can't lock a phone's screen, and iPhones could leave the picture turned a quarter after a turn.)

**The camera stays ready between scans** for 90 seconds (Settings > Interface > Store Mode > **Keep the camera ready between scans**), so a pile of games scans one after another without waiting, and the browser asks for the camera once. It turns off when the time is up or you leave the page. To have an iPhone never ask again for Squirrelcade: in Safari, on a Squirrelcade page, tap the page icon left of the address (**aA** on older iPhones) › **Website Settings** › **Camera** › **Allow**. For every site: the Settings app › **Apps** › **Safari** › **Camera** › **Allow**.

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

## Pack a place

**Store Mode > Pack a place** gives your games their storage location quickly, at home: choose a bag, a case or a shelf (or scan its label), then scan each game's barcode or type its title, one after another. Each game you own gets that place; one with several copies asks which; one that was somewhere else moves, with **Undo**. See [Places](your-copies.md#places) for the labels, a photo of a bag's games and the Places page.

## With no signal

Stores often have none. Store Mode keeps a copy of its answers in your phone's browser, updated each time it opens (and downloaded again only when something changed), and answers from that copy when Squirrelcade can't be reached, saying so. **Add it** works there too: the purchase waits on the phone (its window, for what you paid and photos, is in its drawer later) and is added to your collection as soon as Squirrelcade answers again (once, even if it's sent twice). Open Store Mode once while you're connected; after that it works offline.

Squirrelcade itself opens with no signal too, even when the phone has closed the tab: its own files stay on the phone after a visit with a connection (a service worker, which only Squirrelcade's HTTPS address can use), and it opens with a note that only Store Mode works until Squirrelcade answers again. After an update, the first visit with a connection brings the new files.

Signing out removes the copy (and then Squirrelcade no longer opens without a connection). Settings > Interface > "Answer without a connection" turns all of it off, and removes the files from the phone.

## Check a shelf

**Store Mode > Check a shelf:** a photo of a shelf of one console's games (a store's, a friend's, your own) in, a checklist out. Pick the console (it's remembered), then **Take a photo** or **Choose a photo**. The phone reads the spines itself, with open text models that come with Squirrelcade (about 30 MB, downloaded the first time and kept: after that it reads with no signal), and checks each against your collection:

- **Need it**: your wishlist's games first, with their place and acorns, and **I bought it** right there;
- **Have it**, **Have it on another console, or maybe**, and **Not on your list** (a game the console's checklist doesn't count, such as one IGDB knows that your catalog leaves out: with **Check a shelf knows every game on the console**, Settings › Interface › Store Mode, on and IGDB set up, the console's whole list is kept on the phone, so such a spine is named for what it is rather than taken for a game on your checklist);
- **Unsure**: spines read only partly, with the best guess and why (its number wasn't read clearly, or it could be another game). A game is never called **Need it** on a doubtful read: Assassin's Creed II read without its last letter could be III, so it's unsure.

Under the list, the photo shows a box around each spine read as a game, and a faint one around other text it read.

**Fixing a spine.** Read wrong, or not read as a game? **Tap its box** on the photo (or **Not it?** beside a game in the list, **It is** or **It's another** beside an unsure one) and say which game it is, by starting to type its title, or **Not a game** (a sticker, a price tag, a store's sign). The checklist changes at once, and the fix is **remembered for that console**: the next photo with the same spine reads it your way, with no signal too. The owner's fixes are kept in Squirrelcade (on every phone, in Store Mode's copy); a viewer's stay on their phone. **Change** or **Forget the fix** in the same window undoes one.

Spines with no box weren't read well enough: stylized logos and very small print are the hardest, and a closer photo of part of the shelf reads more. Spines read sideways by default; **Also read text that isn't sideways** adds box fronts and a glass case (twice as long). On a phone, one photo takes about 10 to 30 seconds.

**A vision model** (optional, Settings > Features): with it on and a connection to Squirrelcade, pieces of the photo also go to the model you chose (any service that takes images, or one at home), and the titles it reads are matched the same way, so it finds more spines and never decides what you have. Settings > Sources > Vision model sets which, its key, and how many pieces a day (each piece is one paid request on most services). Or a **helper** of your own: a program that asks Squirrelcade for photos to read and answers, such as the one in the repository's `tools/shelf-helper`, which reads them with Claude Code signed in on your server, on your own Claude plan (no API key).

What it says comes from the same answers as Store Mode, so it's only as current as your collection: buy something, and **Add it** keeps it right.

A photo of your own games (a bag, a case, a shelf at home)? **Put the games I have here in a place**, under the list, gives the ones you have a storage location in one go: see [Places](your-copies.md#places).

## Talk to Squirrelcade

With **Talk to Squirrelcade** on (Settings > Features; it uses the AI model set up for Check a shelf), a speech bubble at the top of every page opens a conversation. Ask about your collection in plain words ("Do I have Pac-Man?", "What's top of my wishlist for the PS3?", "How many sealed Switch games do I have?") or tell it what happened ("I just bought Halo 3", "Note on Okami: the case is cracked"). Tap the **microphone** beside Send and talk: the words go into the box as you speak (the browser's own speech service, as your keyboard's microphone uses; a pause doesn't stop it), then tap it again and Send. Where a browser has no speech service, it says how to use the keyboard's own dictation. It looks things up in your collection before it answers (the same read-only lookups as the Claude connector), a few at a time, so an answer can take a little while.

When you ask for a change, it says what it will do: a small one is done at once, with **Undo** (I bought it, your note on a game); a big one waits for you to tap it (**Exclude it** from a console's checklist, or **Make it a target** again). It can also **Open** a game's drawer. Viewers can ask, not change. Talk needs an AI model, so it's off until you turn it on, and the button goes as soon as Talk or the model is turned off. The conversation stays in that browser tab (**Start over** clears it). With a helper (Claude Code on your server), Talk runs on your own Claude plan too.

## Check a list

**Store Mode > Check a list:** paste a list of games (a store's list, a lot for sale), one per line, with the console if you like ("Chrono Trigger (SNES)"), and see which you own, which you need, and which you have on another console. Barcodes work too, one per line, as a handheld scanner types them.

## For someone shopping for you

The sign-in page can lead with a check of its own, for family who don't have an account: see [Sharing your collection](sharing.md).
