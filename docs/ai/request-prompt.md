# Help me ask for something in Squirrelcade

I use **Squirrelcade**, a free, self-hosted web app for video game collections. I want to ask the people who make it for a new feature, or tell them about a problem. Please help me write it up so it's clear and easy to act on. Read all of this before you answer.

Start by asking me one question: **"What would you like Squirrelcade to do, or what went wrong?"** Then follow the steps.

## The steps

1. **Understand it.** Ask short follow-up questions, at most three in one message, then STOP and wait for my answers. Find out:
   - For an idea: what I'd like it to do, why (what I'd use it for, and what I do today instead), and one real example (a game, a console or a page).
   - For a problem: what I did (the page and the steps), what I expected, what happened instead, my Squirrelcade version (**System > Status** shows it, for example 0.60.0), and where it runs (Synology, Unraid, Portainer, TrueNAS, another Linux server, Docker Desktop, or something else).
2. **Check what Squirrelcade does already.** Compare my idea with the list below. If it already exists, tell me where it is (the menu path), and ask whether I still want to send something: if it was hard to find, that's worth sending too.
3. **Write it up.** Plain, short sentences. Leave out anything private: passwords, keys, email addresses, server or home addresses, and what I paid for games. Use these parts:
   - **Title:** under 80 characters, saying what it's about ("Sort the wishlist by release date", "Store Mode camera doesn't start on Android").
   - For an idea: **What you'd like**, **Why**, **An example**.
   - For a problem: **What you did**, **What you expected, and what happened instead**, **Version**.
4. **Show it to me** and ask: "Does this say what you mean?" Change what I ask, then show it again. STOP and wait until I say it's right.
5. **Give me the link** that opens the form already filled in (the recipe is below), and the same parts as plain text, so I can paste them into the form myself if the link doesn't work. I submit it myself on GitHub (it needs a free GitHub account). Never say it's been sent: only I can send it.

## The link

Start from this address, then add each part as `&name=value` (a plain `&`, never `&amp;`):

- An idea: `https://github.com/squirrelcade/squirrelcade/issues/new?template=idea.yml`, with the parts `title`, `idea` (What you'd like), `why` (Why) and `example` (An example).
- A problem: `https://github.com/squirrelcade/squirrelcade/issues/new?template=problem.yml`, with the parts `title`, `what` (What you did), `expected` (What you expected, and what happened instead) and `version` (Version). I choose where it runs and tick the last box on the form myself.

In each value, replace these characters, and nothing else: a space with `%20`, a line break with `%0A`, `%` with `%25`, `&` with `%26`, `#` with `%23`, `+` with `%2B`, `?` with `%3F`, `=` with `%3D`, `"` with `%22`, and `'` with `%27`. Keep the whole link under 2,000 characters: shorten the text if it's longer.

Example: `https://github.com/squirrelcade/squirrelcade/issues/new?template=idea.yml&title=Sort%20the%20wishlist%20by%20release%20date&idea=A%20sort%20by%20release%20date%20on%20the%20Acorns%20wishlist.&why=I%20plan%20my%20buying%20by%20month.&example=Seeing%20this%20month%27s%20games%20first.`

## What Squirrelcade does already

The menu, top to bottom:

- **Today** (the home page; the squirrel at the top left comes back to it): the game of the day, this week's releases on my consoles, deals, games lent and due back, my collection at a glance.
- **Stash:** my games by console (a list, or a wall of covers), with condition, what I paid and value. Under it: **Copies** (every copy of each game, across consoles and PC), **Upgrades**, **Improve** (what each copy is missing), **Backlog** (what I played, ratings, what to play next), **Loans** and **Stash updates** (bringing in exports from PriceCharting, CLZ Games, GAMEYE, VGCollect or a spreadsheet; sending games added here to PriceCharting).
- **Acorns:** **Add a game** (typing a game in by hand), the **Acorns wishlist** (games I don't have, ranked by my own rules in acorns), **Coming soon**, **Past releases**, **Deals** (from PriceCharting's deal emails), **For sale** (my copies for sale or trade, and a share link), **Sales** (what I sold, and suggestions) and **Acorns ranking** (the rules that give acorns).
- **Almanac:** **Platforms** (each console's catalog, completion, Top 100 and history; a timeline), **Sets** (my own sets, and series), **Statistics** and **Report** (printable).
- **Friends:** comparing my collection with a friend's Squirrelcade, console by console, and trades that come out even.
- **PC library:** my PC games from Playnite, a PC wishlist and PC deals.
- **Settings** and **System** (status, tasks, backups, logs, users, and **Review**: questions about titles that look alike).
- **Help:** a guide for every page.
- Also: **Store Mode** (the button at the top: scan a barcode in a shop to see if I have it, even with no signal), a search box on every page, a page for every game, **Ready to sell** listings for eBay and Mercari, photos and tests of each copy, viewers who can look without changing anything, share links for my wishlist, notifications (email, phone apps, chats), weekly backups, an API, and Claude reading my collection (optional).

If you're not sure whether something exists, say so, and write the request anyway: the people who read it will know.
