# Set up email accounts (PriceCharting exports, On the way, deals) in Squirrelcade

I already have **Squirrelcade** (version 1.4.0 or later), a free, self-hosted web app for my video game collection, running. Please help me set up **one thing**: email accounts (PriceCharting exports, On the way, deals). Read all of this first.

**Your first message:** say in one sentence what we'll do, tell me the time to allow ("about 10 minutes; give it 25"), then ask me the question under "Have ready" and STOP and wait.

## How to work with me

- **One step at a time.** Give me the exact clicks or fields for one step, then STOP and wait until I say it's done or tell you what I see. Keep messages short.
- **Never ask me for a password, API key, token, app password or webhook address, and don't let me paste one into this chat.** Tell me where to get it (its official page) and where it goes in Squirrelcade. I type it there myself, press its **Test** (or **Save and test**) button and tell you what it said. If I paste a secret anyway, tell me it's exposed, so I make a new one.
- **Ask before changing my server.** Before a command or a click that installs, changes or deletes something, say what it does and wait for my OK. Read-only checks need no OK.
- **Stick to the facts:** this brief, Squirrelcade's own Help (Help in its menu, and the ? on each page) and the official pages named here. Never make up a menu or a setting. If what I see doesn't match, ask me what I see.
- **Free and simple first.** Say what each thing costs in money and upkeep, and never push an extra I didn't ask for.
- **I may stop at any point.** Then say what's done and what's left. Settings > Features in Squirrelcade lists every optional feature, with a **Set it up with AI** button that copies this prompt again to pick up later.

## What it is

Squirrelcade can read a mailbox of mine for three things: **PriceCharting's export emails** (the collection updates itself when PriceCharting emails an export), **On the way** (purchase emails from eBay, Mercari, Amazon, GameFly and other shops: games I've bought, waiting to be added when they arrive), and **deal emails**. As of 1.4.0, **Settings > Email** is a list of mail accounts (there can be more than one), and each email-reading feature has its own options on its own page there. None of it is needed to use Squirrelcade.

## Have ready

- An **email account** that Squirrelcade may read, and an **app password** made at its provider (a password made just for Squirrelcade; my real password is never used). Gmail: https://myaccount.google.com/apppasswords, which needs 2-Step Verification on. Outlook.com, Hotmail and Microsoft 365 mailboxes can't be read with a password: a forwarding rule to another mailbox works.
- Which of the three things I want. Ask me. (With PriceCharting: its export emails need a PriceCharting account; the other two need nothing more.)

## Steps

1. In Squirrelcade: **Settings > Email**. I add my mail account to the list: the provider (it fills in the server), my address, and the app password. I type the password myself. Save.
2. Press the account's test (**Test sending and reading** says how many emails it could see). A wrong password shows here.
3. Then the feature's own page, only for what I chose:
   - **Stash updates from your email:** turn it on. From then on **My Collection > Download (CSV)** on PriceCharting updates the collection within half an hour. (**Settings > Collection > Reminders > Remind me to export after** 7 days sends a weekly reminder.)
   - **On the way:** turn on **Watch for games you bought**, then add the stores I buy from to **Purchase emails from** (eBay and Mercari to start; `amazon.com`, `superraregames.com`, `gamefly.com`, or **Find my stores in my email**). Amazon's emails don't name the game: **Read Amazon's emails** helps. A shop's order page pasted into **Acorns > On the way > Add from an order page**, or Amazon's order history download, need no email at all.
   - **Deals:** the deal-emails option, on its page.

## Check that it works

- **System > Status > Integrations:** the mailbox light is green.
- Stash updates: the test says it found the export emails. On the way: after **System > Tasks > Look for games on the way**, recent purchases show on **Acorns > On the way**.

## How long it takes

about 10 minutes; give it 25. The second number is on purpose: setting up outside accounts usually takes longer than it looks, and nobody should feel behind.

## If something goes wrong

- "Login failed": the app password is wrong, or was made with 2-Step Verification off. Make a new one and type it again.
- Gmail may need IMAP on (Gmail's settings > Forwarding and POP/IMAP).
- Help > Your collection (From your email) and Help > Orders have the details.
