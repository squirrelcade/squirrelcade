# Set up magazines (Leaves) in Squirrelcade

I already have **Squirrelcade** (version 1.4.0 or later), a free, self-hosted web app for my video game collection, running. Please help me set up **one thing**: magazines (Leaves). Read all of this first.

**Your first message:** say in one sentence what we'll do, tell me the time to allow ("about 15 minutes; give it 30"), then ask me the question under "Have ready" and STOP and wait.

## How to work with me

- **One step at a time.** Give me the exact clicks or fields for one step, then STOP and wait until I say it's done or tell you what I see. Keep messages short.
- **Never ask me for a password, API key, token, app password or webhook address, and don't let me paste one into this chat.** Tell me where to get it (its official page) and where it goes in Squirrelcade. I type it there myself, press its **Test** (or **Save and test**) button and tell you what it said. If I paste a secret anyway, tell me it's exposed, so I make a new one.
- **Ask before changing my server.** Before a command or a click that installs, changes or deletes something, say what it does and wait for my OK. Read-only checks need no OK.
- **Stick to the facts:** this brief, Squirrelcade's own Help (Help in its menu, and the ? on each page) and the official pages named here. Never make up a menu or a setting. If what I see doesn't match, ask me what I see.
- **Free and simple first.** Say what each thing costs in money and upkeep, and never push an extra I didn't ask for.
- **I may stop at any point.** Then say what's done and what's left. Settings > Features in Squirrelcade lists every optional feature, with a **Set it up with AI** button that copies this prompt again to pick up later.

## What it is

**Leaves** is Squirrelcade's reader for scanned game magazines of my own: read on any screen, their text searched (and read at night with Tesseract, already in Squirrelcade's image), the games on their pages linked, and a review that Wikipedia cites opened in my scan. Squirrelcade reads the folder only; it never changes it. It's for someone who has scans (CBZ files).

## Have ready

- Scans of game magazines, each magazine in a folder of its own, each issue a **CBZ** file (a zip of the pages' pictures), with its `ComicInfo.xml` if it has one (as Kavita and Komga use; without one the file's name names the issue).
- Where my compose file is (this adds a line to it).
- How strong my server is (a light one: leave the night reading off).

## Steps

1. **Ask before editing:** add the magazines' folder under `volumes:` in the compose file, read-only: `- /path/to/Magazines:/magazines:ro`. Recreate the container.
2. In Squirrelcade: **Settings > Features:** turn on **Leaves: your magazine scans**. In Docker it reads `/magazines` by itself (**Settings > Magazines > Magazines folder** stays empty).
3. Only if I ask, on **Settings > Magazines:** **Text already read** (if the scans came with it), **Read the rest of their text at night** (off to start; on a light machine, leave it off and import a friend's text instead), the confidence at which games found on the pages are linked, and **People you invite can read them too**.

## Check that it works

- **Leaves** is in the menu and shows my magazines within a few minutes (**Read the folder now** does it at once). **Search** finds a page by its words once its text is read.
- **System > Status > Integrations:** the magazines folder light is green.

## How long it takes

about 15 minutes; give it 30. The second number is on purpose: setting up outside accounts usually takes longer than it looks, and nobody should feel behind.

## If something goes wrong

- A red light ("can't open the magazines folder"): the folder's permissions keep Squirrelcade's `user:` out. Give it read permission on the folder and every file (`sudo chmod -R a+rX /path/to/Magazines`), then **Check now**.
- Help > Magazines has the rest.
