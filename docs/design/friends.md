# Friends' collections: the plan

Written 2026-10-04 overnight as a proposal; updated 2026-10-05 with the owner's direction (D131). Phase 1 is built (0.56.0, with D132's details); phases 2 and 3 are next.

## What it's for

Two people who both run Squirrelcade see each other's collections side by side, and Squirrelcade suggests trades: my second copies and copies for sale that they need or want, and theirs that I need or want, balanced by value and condition. Talking and the trade itself stay outside the app at first.

## Two ways to connect, both offered

Most installs sit behind a sign-in at home, so neither can simply call the other. The owner chooses, friend by friend:

### By email (the simplest)

- **Send:** on a friend, **Send my collection** emails your share file (a small attachment) to them from your account (Settings > Email), with a short note. **Download my share file** gives it to you to send however you like.
- **Bring in:** in the friend's Squirrelcade, **Bring in from email** finds share files from their friends in the mailbox Squirrelcade already reads (Settings > Email, the same Gmail app password as PriceCharting's exports) and brings them in with one click, or as they arrive (a setting). Without a mailbox: drop the file (or a zip of it) on the Friends page, or paste its text.
- **Reply:** after bringing one in, **Send mine back** sends yours to that friend.
- Nothing is opened to the internet. Each friend's file carries a **friend code** (made when the friend is added, given to them once), so a file from a stranger, or from a known address without the right code, is ignored.

### Directly (a key per friend)

- **Add a friend > Directly:** your Squirrelcade makes a read-only key just for them, shown once inside a link that carries your address and the key. They paste the link into their Squirrelcade, which then fetches your share file whenever theirs is older than a day (a setting): no emails.
- The key only reads the share file (what you chose to share with friends), is listed with its friend's name, limited, logged and revoked in one click, like the keys for Claude Code (D130), and is separate from your API key.
- It needs your Squirrelcade reachable from the internet for that one address (the share address), like the connector's addresses for Claude's apps (Help > Claude and AI apps > Behind Cloudflare Access). Friends who won't open anything use email.

## The share file

JSON, versioned (`squirrelcade-friend`, version 1): who it's from (the install's name), when it was made, the friend code, and the parts the owner chose to share:

- **Collection:** each game's console, title, PriceCharting product id (most copies come from PriceCharting's export, so two installs compare by it exactly; by console and title otherwise, with the title matching of 0.55.0) and each copy's condition (sealed, CIB, loose...). Default: shared.
- **Market value** of each copy (PriceCharting's), so trades can be balanced. Default: shared. Prices paid: never.
- **Wishlist:** the top games (50 by default) with their priority and acorns. Default: shared.
- **For trade:** duplicates and copies marked for sale or trade (Acorns > For sale). Default: shared.
- Never: prices paid, notes, where copies are kept, loans, the PC library's play time.

Removing a friend stops sending (and revokes their key); their install keeps your last file until it's 60 days old (a setting), since one install can't delete files on another.

## Friends in the menu

A **Friends** item of its own, with three tabs:

- **Friends:** each friend, how they're connected (email or directly), when their last file came, how many games, what's in common; **Add a friend**, **Send my collection**, **Bring in from email**.
- **Compare:** pick a friend and a console: your games and theirs side by side: both of you have it, only you, only them (with their condition and value); filters for their copies for trade and your wishlist.
- **Trades:** recommendations: your spare or for-trade copies they want (their wishlist) against theirs you want, balanced by market value within a margin (20% by default, a setting), the conditions shown. **Pick one game you want** and it suggests even trades: one of your games for it, or a combination that adds up to its value (fewest games first). Each idea can be dismissed (it stays dismissed) or copied as a message to the friend.

Values come from each copy's PriceCharting market value in the files (by condition); a trade is even when the two sides' totals are within the margin.

## Phases

1. **The share file and Friends** (0.56.0, built): what to share (Settings > Friends), download and upload or paste a file, the Friends, Compare and Trades tabs, and each trade copied as a message. Dismissing an idea waits.
2. **Email:** Send my collection, Bring in from email (one click, or as they arrive), Send mine back.
3. **Directly:** a key per friend, the friend's install fetching yours.
4. **Later:** Store Mode and the game drawer saying when a friend has a game for trade; a trade proposed and followed inside Squirrelcade.

## Decided (2026-10-05)

- Both ways, email and directly, chosen friend by friend.
- A Friends item in the menu with Friends, Compare and Trades.
- Trades balanced by market value: one for one, or a combination.

## Defaults proposed (each a setting)

- What's shared: the collection with conditions and market values, the wishlist's top 50, copies for trade and spares; never prices paid, notes, where copies are kept, loans or play time.
- The margin for an even trade: 20%.
- A friend's file kept 60 days after they stop sending.
