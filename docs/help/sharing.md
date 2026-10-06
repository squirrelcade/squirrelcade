# Sharing your collection

Three ways to let other people see what you have, without letting them change anything.

## Viewers

A viewer signs in and can look at your collection (its games and value, each console's gaps, the wishlist, Coming soon, Past releases, sets and series, the Top 100 and history, Copies, statistics and the report, and the PC library) but can change nothing: the server itself refuses them. They don't see Settings, System, Review or Stash updates.

1. **System > Users > Invite someone:** type who it's for ("Mom") and send them the link it makes. The link works once, for 7 days (a setting).
2. They open it, choose a username and password, and they're in.

What stays yours unless you share it (**Settings > Security > Viewers**): what you paid for each copy (and your spending), your notes on games, the PC library (shared by default), what you played (shared by default; see [What you played](playing.md)), and your copies' details: where they're kept, your tags, photos and loans (not shared by default; see [Your copies](your-copies.md)). Viewers never get RomM links.

System > Users also makes a link for someone to choose a new password, removes a viewer, and can hand the collection to another account (they become the owner).

## Share links

A link anyone can open, with no account and no sign-in, that shows one list and nothing else:

- **Your wishlist**: **Acorns wishlist > Share**. The page shows your top picks (50 by default: Acorns ranking > Sharing), best first, each with links to where it sells: PriceCharting and your shop links. Handy for birthdays and holidays.
- **Your games for sale or trade**: **Acorns > For sale > Share**, with your asking prices and notes.

Make one link per person ("Mom", "the family chat"): the page says who it's shared with, and your list of links shows how often each was opened. **Remove** a link and it stops working at once. A share page never shows your collection, its value, what you paid or your notes.

Each address can open share pages a limited number of times in 10 minutes. The link uses the address you opened Squirrelcade at: for people outside your home, open Squirrelcade at its public address (Settings > General) before copying it.

## Checking a game without signing in

For family shopping for you, who have no account: **Settings > Security > "Check a game without signing in"**. On (on phones and tablets only, or everywhere), the sign-in page leads with **Shopping for them?**: scan a game's barcode or type its title, and it answers:

- **They have it** (on this console, or on another), with what your copy is worth if you choose to show that ("Show what your copy is worth");
- **They need it**, with the wishlist's priority and links to its prices;
- **Maybe**, or **not something they collect**.

Nothing private is shown (no notes, no prices paid), and each address can check a limited number of games in 10 minutes (a setting), so nobody can read your whole collection that way.

## If Squirrelcade is on the internet

Anyone who can reach the sign-in page can use the check, and try passwords. Keep Squirrelcade behind a sign-in of its own when it's reachable from the internet: a VPN, or a tunnel with an access gate such as Cloudflare Access (add each person's email to it). Store Mode's camera needs HTTPS anyway, which a tunnel gives you.

Share links are meant to be opened by people without an account, so an access gate in front of Squirrelcade stops them too, unless the gate lets `/share/` and `/api/v1/share/` through (Cloudflare Access: a bypass policy for those two paths). Only those pages and their answers need it.
