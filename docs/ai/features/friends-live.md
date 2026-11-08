# Set up friends' live links in Squirrelcade

I already have **Squirrelcade** (version 1.4.0 or later), a free, self-hosted web app for my video game collection, running. Please help me set up **one thing**: friends' live links. Read all of this first.

**Your first message:** say in one sentence what we'll do, tell me the time to allow ("about 15 minutes; give it 30 (if a sync tool is already there)"), then ask me the question under "Have ready" and STOP and wait.

## How to work with me

- **One step at a time.** Give me the exact clicks or fields for one step, then STOP and wait until I say it's done or tell you what I see. Keep messages short.
- **Never ask me for a password, API key, token, app password or webhook address, and don't let me paste one into this chat.** Tell me where to get it (its official page) and where it goes in Squirrelcade. I type it there myself, press its **Test** (or **Save and test**) button and tell you what it said. If I paste a secret anyway, tell me it's exposed, so I make a new one.
- **Ask before changing my server.** Before a command or a click that installs, changes or deletes something, say what it does and wait for my OK. Read-only checks need no OK.
- **Stick to the facts:** this brief, Squirrelcade's own Help (Help in its menu, and the ? on each page) and the official pages named here. Never make up a menu or a setting. If what I see doesn't match, ask me what I see.
- **Free and simple first.** Say what each thing costs in money and upkeep, and never push an extra I didn't ask for.
- **I may stop at any point.** Then say what's done and what's left. Settings > Features in Squirrelcade lists every optional feature, with a **Set it up with AI** button that copies this prompt again to pick up later.

## What it is

Friends compare collections by swapping files. A **live link** keeps a friend's collection current by itself. Squirrelcade writes an **encrypted live file** for each friend I share with into a folder, again after every collection update. Something that carries that folder to the cloud (Google Drive for desktop, Synology Cloud Sync, rclone or Dropbox) makes each file reachable by a link (shared as **Anyone with the link**), and I paste that link on the friend's card. An **invite** is sent to the friend once, so their Squirrelcade reads my file, and theirs sends me their link the same way. The file is encrypted with the friendship's code: whoever has the link and the invite can read what my file shares (**Settings > Friends > What you share** decides it; never what I paid or my notes).

## Have ready

- A **friend** already added on **Friends** (a name is enough), who also has a Squirrelcade of version 1.4.0 or later.
- A **sync tool** that carries a folder from the server to the cloud, which I already use: Google Drive for desktop, Synology Cloud Sync, rclone or Dropbox. If I have none, this is the long part; offer rclone or Cloud Sync, and ask before installing anything.
- Where my compose file is (if the folder needs to be mounted).

## Steps

1. **The folder.** Squirrelcade writes live files into **Settings > Friends > Live links > Folder for live friend files**. Empty means `/config/friends-live` (the config folder's own `friends-live` folder). Choose where the sync tool can reach it: either point the tool at that folder on the server, or **ask before editing** the compose file and mount a synced folder, for example `- /path/to/synced-folder:/friends-live`, recreate the container, and set the folder to `/friends-live`.
2. **The sync.** The sync tool carries that folder to the cloud. (Google Drive for desktop and Dropbox run on a computer: the folder then has to be on that computer; Synology Cloud Sync and rclone can run on the server or NAS.)
3. **Share with a friend.** On **Friends**, open the friend's card, **Live link**, and turn on **Share live with <friend>**. The file is written in a moment (**Write now** does it at once) and its name shows on the card.
4. **Share the file.** In the cloud folder, share that file as **Anyone with the link** (read only) and paste its link into **The file's shared link** on the friend's card. (The link is a secret: it goes only on that card.)
5. **The invite.** Once the link is saved, the card offers the **invite**: I send it to the friend once, in a message, and they paste it on their card for me. Likewise, the friend's own link and invite come to me, and I paste their link in the other half of the card.
6. How often Squirrelcade reads friends' live links: **Settings > Friends > Read friends' live links every** (24 hours).

## Check that it works

- **System > Status > Integrations:** **Your live friend files** is green (the files were written), and each **<friend>'s live link** is green after it is read (**Check now**, or **Read now** on their card).
- On the friend's card: Written a moment ago, and their file's date.

## How long it takes

about 15 minutes; give it 30 (if a sync tool is already there). The second number is on purpose: setting up outside accounts usually takes longer than it looks, and nobody should feel behind.

## If something goes wrong

- A friend's file is refused (red): the line says why. "A web page": share the file as **Anyone with the link**. "Not found": ask for a new invite. "Another friendship" or "doesn't check out": ask the friend for a fresh invite. The last good file is kept.
- Yellow "not written yet": press **Write now**, and check that the folder is writable by the compose file's `user:`.
- Help > Friends has the hand-sent files, which keep working beside live links.
