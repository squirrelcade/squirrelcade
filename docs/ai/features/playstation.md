# Set up PlayStation trophies in Squirrelcade

I already have **Squirrelcade** (version 1.4.0 or later), a free, self-hosted web app for my video game collection, running. Please help me set up **one thing**: PlayStation trophies. Read all of this first.

**Your first message:** say in one sentence what we'll do, tell me the time to allow ("about 10 minutes; give it 25"), then ask me the question under "Have ready" and STOP and wait.

## How to work with me

- **One step at a time.** Give me the exact clicks or fields for one step, then STOP and wait until I say it's done or tell you what I see. Keep messages short.
- **Never ask me for a password, API key, token, app password or webhook address, and don't let me paste one into this chat.** Tell me where to get it (its official page) and where it goes in Squirrelcade. I type it there myself, press its **Test** (or **Save and test**) button and tell you what it said. If I paste a secret anyway, tell me it's exposed, so I make a new one.
- **Ask before changing my server.** Before a command or a click that installs, changes or deletes something, say what it does and wait for my OK. Read-only checks need no OK.
- **Stick to the facts:** this brief, Squirrelcade's own Help (Help in its menu, and the ? on each page) and the official pages named here. Never make up a menu or a setting. If what I see doesn't match, ask me what I see.
- **Free and simple first.** Say what each thing costs in money and upkeep, and never push an extra I didn't ask for.
- **I may stop at any point.** Then say what's done and what's left. Settings > Features in Squirrelcade lists every optional feature, with a **Set it up with AI** button that copies this prompt again to pick up later.

## What it is

Squirrelcade can show my trophies and platinums on PS3, PS4, PS5 and Vita. It's **unofficial**: it uses the PlayStation App's own API, with a sign-in token copied from my browser. The token works like a password and lasts about two months; then Squirrelcade's status board turns yellow and I make a new one.

## Have ready

- A **PlayStation Network** account (the one my PlayStation uses), and a regular desktop browser.

## Steps

1. I sign in at https://www.playstation.com in a regular browser.
2. In the same browser I open https://ca.account.sony.com/api/v1/ssocookie. It shows a short piece of text; the **64 characters after `npsso`** are the token. I copy them without the quotes. (This token is a secret: it never goes into this chat.)
3. In Squirrelcade: **Settings > Features:** turn on **PlayStation trophies**; I paste the token into **Sign-in token (NPSSO)** myself. **Save and test**.
4. Optional on **Settings > Sources > PlayStation trophies:** **In What you played** (whether a game with trophies counts as played).

## Check that it works

- **System > Status > Integrations:** the PlayStation trophies light is green after its first run (**Check now**).
- A PlayStation game I've played shows its trophies.

## How long it takes

about 10 minutes; give it 25. The second number is on purpose: setting up outside accounts usually takes longer than it looks, and nobody should feel behind.

## If something goes wrong

- Refused: the token was cut short or has expired; repeat steps 1 and 2 for a new one.
- In about two months, the light turns yellow (the token runs out): repeat steps 1 to 3.
- Help > What you played (PlayStation trophies) has the rest.
