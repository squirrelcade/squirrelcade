# Set up backups to a second folder in Squirrelcade

I already have **Squirrelcade** (version 1.4.0 or later), a free, self-hosted web app for my video game collection, running. Please help me set up **one thing**: backups to a second folder. Read all of this first.

**Your first message:** say in one sentence what we'll do, tell me the time to allow ("about 10 minutes; give it 20"), then ask me the question under "Have ready" and STOP and wait.

## How to work with me

- **One step at a time.** Give me the exact clicks or fields for one step, then STOP and wait until I say it's done or tell you what I see. Keep messages short.
- **Never ask me for a password, API key, token, app password or webhook address, and don't let me paste one into this chat.** Tell me where to get it (its official page) and where it goes in Squirrelcade. I type it there myself, press its **Test** (or **Save and test**) button and tell you what it said. If I paste a secret anyway, tell me it's exposed, so I make a new one.
- **Ask before changing my server.** Before a command or a click that installs, changes or deletes something, say what it does and wait for my OK. Read-only checks need no OK.
- **Stick to the facts:** this brief, Squirrelcade's own Help (Help in its menu, and the ? on each page) and the official pages named here. Never make up a menu or a setting. If what I see doesn't match, ask me what I see.
- **Free and simple first.** Say what each thing costs in money and upkeep, and never push an extra I didn't ask for.
- **I may stop at any point.** Then say what's done and what's left. Settings > Features in Squirrelcade lists every optional feature, with a **Set it up with AI** button that copies this prompt again to pick up later.

## What it is

Squirrelcade backs its database up every week by default (**Settings > Tasks > Back up the database every**), into the `backups` folder inside its config folder, and keeps 14 (**Settings > Storage and backups > Backups to keep**). Those sit on the same disk as the database, so one failure can take both. A **second backup folder** gets a copy of each backup, on another disk, a NAS share, or a folder that a cloud app syncs (OneDrive, Dropbox).

## Have ready

- Where the copy should go: another disk, a NAS share or a synced folder on the server. Ask me which, and its path on the server.
- Where my Squirrelcade's compose file (`docker-compose.yml`) is, because this changes it, and how I usually restart it (`docker compose`, a NAS's Container Manager, Unraid, Portainer).

## Steps

1. **Ask before editing:** add a line under `volumes:` in the compose file: `- /path/to/other/disk/squirrelcade-backups:/backup-copies` (my path on the left; keep `/backup-copies` on the right). The folder must exist, and the user in the compose file's `user:` line must be allowed to write to it.
2. Recreate the container so the folder is there (`docker compose up -d` in the compose file's folder; on a NAS's Container Manager, rebuild the project; Unraid: apply the change to the container).
3. In Squirrelcade: **Settings > Storage and backups > Second backup folder**: `/backup-copies`. Save.
4. If the folder is also copied by something else (Hyper Backup on a Synology, say), that's a good extra: another place, ideally off site.

## Check that it works

- **System > Backups > Back up now**: a new file appears there, and in the second folder.
- **System > Status > Integrations:** the Backups light is green.

## How long it takes

about 10 minutes; give it 20. The second number is on purpose: setting up outside accounts usually takes longer than it looks, and nobody should feel behind.

## If something goes wrong

- A permission error: the compose file's `user:` numbers can't write to that folder; change the folder's owner or its permissions.
- The Backups light is yellow when the newest backup is old or the second folder isn't there: **Check now** on that line.
