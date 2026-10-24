# Order emails: what you paid, and On the way

Two optional parts read your order and purchase emails, so you type less when new games come in. Both are off until you turn them on in **Settings > Email**, since they read more of your mailbox than PriceCharting's emails. They read the mailbox of **Your email account** on that page (with an app password: see [Notifications](notifications.md)).

What they promise:

- Your mailbox is only read: nothing is marked read, moved or deleted, and no email larger than 5 MB is fetched.
- Only what's found is kept: the store, the day, the items and their amounts (and, so an email is read once, a fingerprint of its Message-ID). Never an email. The logs count emails and say nothing of what's in them.
- Nothing becomes part of your collection until you say so.

## What you paid, from your order emails

Turn on **Find what you paid in your order emails**. Then:

- **Find in my email**, under a copy's Price paid (its window): Squirrelcade searches your mailbox for order or receipt emails that name the game, from the last year (**Look at order emails from the last**), reads the newest few, and shows what it found: the store, the day of the order, the item's price, its share of the tax and shipping, and a link to the listing or order where it has one. The best one fills in the price paid and the day bought; another can be used instead. **Nothing is saved until you save the copy.**
- **Look up prices in my email**, on Stash > Improve: the same for the copies still missing a price (none paid and no estimate), the newest first, up to 30 at a time. Each one found waits beside its copy: **Use it** saves it, **Not this** forgets it, and **Fill in** opens the copy's window with it filled in. After a store haul (Improve's **Added here**), it's one click for all of them.
- **Find their prices in my email**, on Stash > Recently added (and from Store Mode's **Added here** card): the same for the copies added in the days shown there, each price found waiting on its copy to use or turn down.

On Gmail, the search is Gmail's own (the game's title as a phrase, with one of the words "order", "receipt", "purchase", "purchased", "bought" or "invoice"), so it's quick and finds the right emails. On other mailboxes it's the standard IMAP text search, and the reader decides which emails are orders.

### What counts as the price paid

**What counts as the price paid** chooses, for both parts here:

- **The item price only** (to start with): what the store listed the game at.
- **With its share of the tax.**
- **With its share of the tax and shipping, less any discount**: what it cost you, all in.

When an order has several games, its tax, shipping and discount are shared out by their prices: in a $20 and $60 order, the $60 game takes three quarters. A line for two copies counts as two at half its price each.

### Who reads the emails

**Read order emails with** chooses:

- **The AI model, when one is set up**: the model of Check a shelf (Settings > Sources > Vision model; [Optional parts](features.md)), or your own helper. It reads any store's emails, answering with the store, the day, each item and its price, the tax, shipping and total, which Squirrelcade checks before using. Each email is asked about once (the reading is kept, not the email), at most 100 a day (**Emails to the AI model a day**). **With an outside AI service, the text of each order email it reads goes to that service** (OpenAI, Google, Anthropic, OpenRouter...), with email addresses, phone numbers and the lines of a postal address taken out first. A helper sends it where it does (Claude Code: to Anthropic, under your own plan); a model on your own computer keeps it at home. When the model can't answer, Squirrelcade's own reader reads the email instead.
- **Squirrelcade's own reader only**: no email goes to a model. It knows the usual stores' emails as well as it can: eBay, Mercari, Amazon, GameStop, Target, Walmart, Best Buy, Limited Run Games, Super Rare Games, Fangamer and Play-Asia. It reads an email's lines for the game's title and the price beside it, and the order's subtotal, tax, shipping, discount and total. A store whose emails are laid out unusually may give it nothing; then type the price as before.

## On the way

Turn on **Watch for games you bought: On the way**. Squirrelcade then looks through your purchase emails every 24 hours (**Look every**, from 1 hour to a week), from eBay and Mercari to start with. To add more stores to **Purchase emails from**:

- **Tap a store** under the list (Amazon, GameStop, Target, Walmart, Best Buy, Limited Run Games, Super Rare Games, Fangamer, Play-Asia): the stores whose order emails Squirrelcade's own reader knows.
- **Find my stores in my email** looks through your purchase emails from the last year (**Look at order emails from the last**) and lists every store they came from, with how many and the newest one's subject, the stores Squirrelcade reads first. Tick the ones you buy games from and **Add the ticked**. Only the emails' senders and subjects are read for this, and nothing is kept.
- **Type** any other store's web address and press Enter: a domain (such as `fangamer.com`) takes any address there.

Then **Save changes**. A purchase email is one whose subject says so ("Order confirmed", "You purchased", "Thanks for your order", a receipt), and not a shipping or delivery notice, a refund or a sale of yours: both lists are under **Show advanced**.

Each game bought goes on **Acorns > On the way** with the store, the day, the price paid (as counted above) and the listing or order. Squirrelcade matches the listing's title to the game it is when it's sure (its console named, its title's words all there); when it isn't, the listing's own title shows with **Is it ...?** and a search, for you to say. What's on the way:

- isn't in your collection: not counted anywhere, not on your lists, never sent to PriceCharting;
- shows in Store Mode: scan or search a game that's on the way, and its answer says so ("On the way: bought on eBay for $24.99"). **Add it** then uses what the email said;
- becomes a copy with **It's here**: in the condition a game just bought gets (Settings > Collection), with the price paid and the day of the order filled in, and its window opens on the whole screen for the rest (photos, notes, where it's kept), as Add it does. Two of the same in an order arrive one at a time.
- leaves the list with **Not coming** (a cancelled order, or not a game).

**Check my email now** looks at once. **Tell me when something is on the way** sends a message (Settings > Notifications) when a look finds a new purchase; it's off to start with.

The first look goes back 14 days (**The first look goes back**); each look after starts where the one before ended, and each email is read once.

## Turning them on

1. Settings > Email: your email account, with an app password, and **Test sending and reading**.
2. In **Prices from your order emails**, turn on **Find what you paid in your order emails**; choose **What counts as the price paid** and **Read order emails with**.
3. In **On the way**, turn on **Watch for games you bought: On the way**, and add the stores you buy from to **Purchase emails from**: tap them, or **Find my stores in my email**.
4. Save. On the way's first look comes within a few minutes; Settings > Tasks has it as **Look for games on the way**.
