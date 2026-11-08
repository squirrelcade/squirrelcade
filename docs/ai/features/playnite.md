# Set up the PC library (Playnite) in Squirrelcade

I already have **Squirrelcade** (version 1.4.0 or later), a free, self-hosted web app for my video game collection, running. Please help me set up **one thing**: the PC library (Playnite). Read all of this first.

**Your first message:** say in one sentence what we'll do, tell me the time to allow ("about 20 minutes; give it 45"), then ask me the question under "Have ready" and STOP and wait.

## How to work with me

- **One step at a time.** Give me the exact clicks or fields for one step, then STOP and wait until I say it's done or tell you what I see. Keep messages short.
- **Never ask me for a password, API key, token, app password or webhook address, and don't let me paste one into this chat.** Tell me where to get it (its official page) and where it goes in Squirrelcade. I type it there myself, press its **Test** (or **Save and test**) button and tell you what it said. If I paste a secret anyway, tell me it's exposed, so I make a new one.
- **Ask before changing my server.** Before a command or a click that installs, changes or deletes something, say what it does and wait for my OK. Read-only checks need no OK.
- **Stick to the facts:** this brief, Squirrelcade's own Help (Help in its menu, and the ? on each page) and the official pages named here. Never make up a menu or a setting. If what I see doesn't match, ask me what I see.
- **Free and simple first.** Say what each thing costs in money and upkeep, and never push an extra I didn't ask for.
- **I may stop at any point.** Then say what's done and what's left. Settings > Features in Squirrelcade lists every optional feature, with a **Set it up with AI** button that copies this prompt again to pick up later.

## What it is

**Playnite** (https://playnite.link) is a free program for Windows that gathers PC games from every storefront (Steam, Epic, GOG, itch.io...) in one library. Squirrelcade reads Playnite's library backups from a folder and shows those games beside the console games (**Stash > PC library**), with a PC wishlist and PC deals. It reads only; it never changes Playnite or the PC.

## Have ready

- **Playnite** on the Windows PC with my games in it.
- A shared folder on the server that the PC can write to (a NAS share, say) where Playnite's backups go.
- Where my Squirrelcade's compose file is (this adds a line to it).

## Steps

1. In Playnite: **Settings > Backup**: library backups to that shared folder on the server, automatic (weekly is enough).
2. **Ask before editing:** add the folder under `volumes:` in the compose file, read-only: `- /path/to/Playnite Backup:/playnite:ro`. On a Synology share that only administrators may read, add `group_add: ["101"]` under the service too. Recreate the container (`docker compose up -d`, or the NAS app's redeploy).
3. In Squirrelcade: **Settings > Features:** turn on **PC library (Playnite)**. In Docker it reads `/playnite` by itself (**Settings > PC library > Playnite backup folder**, empty).
4. No folder? A reading can also be uploaded by hand on the PC library page.

## Check that it works

- **Stash > PC library** lists my games within a few minutes.
- **System > Status > Integrations:** the Playnite's folder light is green.

## How long it takes

about 20 minutes; give it 45. The second number is on purpose: setting up outside accounts usually takes longer than it looks, and nobody should feel behind.

## If something goes wrong

- Red or "can't read the folder": Squirrelcade's `user:` account needs read permission on the folder and its files.
- A game count of 0: Playnite hasn't made a backup yet; make one by hand in Playnite.
- Help > PC library has the details.
