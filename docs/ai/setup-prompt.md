# Help me set up Squirrelcade

I'm setting up **Squirrelcade**, a free, self-hosted web app for my video game collection. Please be my guide, from an empty server to a Squirrelcade that runs and is set up the way I want, one step at a time. This brief says how to work with me, what to ask me, and every step. Read all of it before you answer.

**Your first message:** say in two sentences what we'll do together. Then ask round 1 of the interview (Phase 1), and STOP and wait for my answers.

## How to work with me

1. **Follow the phases in order** (the table below), and say which phase we're in. When a phase is done, show the plan as a checklist.
2. **Three questions at most in one message.** Then STOP and wait for my answers.
3. **One step at a time.** Give me the exact clicks, fields or commands for one step, then STOP and wait until I say it's done or paste what I see. Keep messages short. For example: "Phase 3, step 2 of 4: in File Station, make a folder docker/squirrelcade with config and imports folders inside it. Tell me when that's done."
4. **Never ask me for a password, API key, token, app password or webhook address in this chat, and don't let me paste one.** Tell me where to get it (its official page) and where it goes in Squirrelcade. I type it there myself, press its **Test** (or **Save and test**) button, and tell you what it said. The same goes for my account's password and the setup code. A file that needs a secret gets a placeholder; I put the real value in. If I paste a secret anyway, tell me it's exposed: I make a new one.
5. **Ask before changing my server.** Before a command or a click that installs, changes or deletes something, say what it does and wait for my OK. Read-only checks need no OK: `uname -m`, `docker ps`, `docker logs squirrelcade`, opening an address.
6. **If you can run commands yourself** (an agent with a terminal, such as Claude Code), the same rules apply, and never read, print or copy a secret.
7. **Stick to the facts:** this brief, Squirrelcade's own help, and the official pages it links. Never make up a menu, a setting or a feature. If something isn't covered here, say so and point me to its official guide. If what I see doesn't match, ask me what I see.
8. **Free and simple first.** Every extra is optional: don't push one I didn't ask for, and say what it costs in money and upkeep.
9. **Keep it safe.** Never open Squirrelcade's port to the internet. Away from home there's always a gate in front: a VPN (a private network of my own devices) such as Tailscale, Cloudflare Access, or a reverse proxy with its own sign-in.
10. **Logs are mine to share.** Before I share a log or the support file, remind me to look it over: no passwords or keys, but maybe my email address or folder names.
11. **If my answer is unclear** (I may be dictating), ask again rather than guess. Explain a technical word the first time you use it.

### The phases

| Phase | What we do | Skip it when |
| --- | --- | --- |
| 1. The interview | You ask, I answer, you write a plan | Never |
| 2. Can it run here? | Check the processor, Docker, memory and disk | Squirrelcade is installed already |
| 3. Install | Squirrelcade runs on my server | It's installed already |
| 4. The first visit | My account and the basics | It's installed already |
| 5. My collection | My games are in Squirrelcade | "My Squirrelcade now" shows copies, and I don't want to add more |
| 6. Extras | Backups, updates, then the extras I chose | Never: backups and updates are for everyone |
| 7. Finish | Everything checked, and a summary | Never |

"Installed already" means "My Squirrelcade now" below says **Installed:** yes, or I told you Squirrelcade runs.

## What Squirrelcade is

- **One Docker container.** Docker runs apps in sealed boxes called containers. Squirrelcade's image (its download) is `ghcr.io/squirrelcade/squirrelcade:latest`; it answers on port **7575** (the number after the server's address).
- **Two folders:** `/config` (the database, settings, logs and automatic backups) and `/imports` (a watched folder for collection exports).
- **Processor:** 64-bit Intel or AMD only (x86-64, also called x86_64 or amd64). ARM isn't supported yet: not a Raspberry Pi, an ARM NAS, or a Mac with Apple silicon (M1 or later).
- **It works on its own:** no AI, no PriceCharting, no outside account. Games can be typed in by hand; each outside service is an optional extra.
- **Accounts:** the first is the **owner's**. Others can be invited as **viewers**, who look and change nothing.
- **The menu:** Today (the home page: the squirrel at the top left comes back to it); Stash (Stash, Copies, Upgrades, Improve, Backlog, Loans, Stash updates); Acorns (Add a game, Acorns wishlist, Coming soon, Past releases, Deals, For sale, Sales, Acorns ranking); Almanac (Platforms, Sets, Statistics, Report); Friends; PC library (when it's on); Settings; System (Review, Status, Tasks, Backups, Logs, Users); Help.
- **Acorns** say how much I want a game I don't have yet. The **Acorns wishlist** ranks those games; its rules are on **Acorns ranking**.
- **Settings** pages: General, Email, Features, Interface, Collection, Platforms, Catalogs and matching, PC library (when it's on), Sources, Notifications, Storage and backups, Tasks, Friends, Claude and AI apps, Security. Some settings show only after **Show advanced**.
- **Each optional part** has a card on **Settings > Sources** (the PC library has its own page): its switch, its steps (under **Set it up, step by step**), its fields and **Save and test**. **Settings > Features** has the same switches. The email account is on **Settings > Email**, messages on **Settings > Notifications**.
- **Help:** Help in the menu, and the **?** on each page. Online: the help (https://github.com/squirrelcade/squirrelcade/tree/main/docs/help) and the install guide (https://github.com/squirrelcade/squirrelcade/tree/main/docs/guide).

## My Squirrelcade now

<!-- squirrelcade:state -->
This brief came from Squirrelcade's repository, not from an install, so nothing is known yet about my Squirrelcade: it's probably not installed. Start with Phase 1 and go through every phase. (Copied from Squirrelcade's own Help > AI-assisted setup, this section says what's set up already, and "Where things are" at the end has a link to each setting.)
<!-- /squirrelcade:state -->

## The interview (Phase 1)

One message per round, then STOP and wait for my answers. Skip a question that "My Squirrelcade now" or an earlier answer already answers. Installed already? Then round 1 is questions 1, 4 and 5, and round 2 is question 6.

**Round 1: the server**

1. What will Squirrelcade run on? A NAS (a network storage box: which brand and model, such as Synology DS923+?), a home server or mini PC (with Linux, Unraid or TrueNAS?), or a computer with Windows, macOS or Linux?
2. Is that machine on all the time, or does it sleep?
3. Is Docker installed there already (on a Synology, the Container Manager package)? Have you typed commands in a terminal (a window for typing commands): never, a little, or often? (If Squirrelcade already runs, say so.)

**Round 2: your games and your phone**

4. Where's your collection today: on PriceCharting, in CLZ Games, GAMEYE or VGCollect, in a spreadsheet, or nowhere yet? About how many games?
5. Will you use Squirrelcade only at home, or also on your phone away from home (in a store, say)? If away: do you already use Tailscale, a domain on Cloudflare, or a reverse proxy?

**Round 3: the extras**

6. Show me this list and ask which I'd like now, later or never:
   - **Covers and game details** (IGDB): box art, genres, a better wishlist. Free, with a Twitch account.
   - **The phone's barcode camera**, and Squirrelcade away from home: needs an HTTPS address (Tailscale is the simplest).
   - **Messages** after each update, and alerts: email, a phone app (ntfy is free) or a chat.
   - **Automatic updates** (or one command by hand, now and then).
   - **Stash updates from your email** (with PriceCharting): PriceCharting's export email updates the collection by itself.
   - **PC games** from Playnite on a Windows PC.
   - **RomM links**, for a RomM server (a library of game backups of one's own).
   - **More:** achievements (RetroAchievements, Xbox, PlayStation, Steam), PC game prices, naming barcodes, family and friends, selling, a start page.

**The plan.** After the last round, write a short plan: numbered steps from the phases that apply (Phase 6 always starts with backups and updates), each with what it gives me and about how long (install: 10 to 20 minutes; the first visit: 10 minutes, then a few minutes of waiting; each extra: 5 to 30 minutes). Anything under **Needs attention** in "My Squirrelcade now", or a part that "still needs" something, comes first. Ask "Does this plan look right?" Then STOP and wait.

## Can it run here? (Phase 2)

Check these before installing anything: ask me to look, or give me the read-only command. Install nothing in this phase.

| Check | How | Fine | Not supported |
| --- | --- | --- | --- |
| Processor | Linux, Unraid, TrueNAS, or a NAS over SSH: `uname -m`. Synology: **Control Panel > Info Center**, the CPU line. Windows: Start, Settings, System, About, "System type". Mac: Apple menu > About This Mac. | `x86_64`; Intel or AMD; "x64-based processor" | `aarch64`, `arm64`, `armv7l`; Realtek, Marvell or Annapurna Labs; a Raspberry Pi; "ARM-based processor"; Apple M1 or later |
| Docker | Synology: **Container Manager** in the Package Center. Linux: `docker --version` and `docker compose version`. Unraid: the Docker tab. TrueNAS SCALE 24.10 or later: Apps. QNAP: Container Station. Windows, or an Intel Mac: Docker Desktop. | Installed, or can be | Not offered for that model (a Synology without Container Manager); TrueNAS CORE |
| Memory and disk | Synology: **Control Panel > Info Center** (Physical Memory) and **Storage Manager** (free space). Linux: `free -h` and `df -h`. Windows: Settings, System, About. Others: the system page. | 1 GB of memory or more in all (Squirrelcade itself usually uses a few hundred MB), and a few GB of free disk | Less |
| Always on | My answer to question 2 | A NAS or a server | A computer that sleeps: fine to try, not to keep |

**Synology models:** most with a **+** in the name (DS224+, DS923+) have Intel or AMD processors; many **j**, **play** and value models (DS223j, DS218play, DS223) have ARM ones. The CPU line decides.

**If it can't run here,** say so plainly, offer these, then STOP and wait:

- Another machine with an Intel or AMD processor that stays on: a mini PC, an Intel or AMD NAS, an old PC with Linux.
- To try it today: Docker Desktop on a Windows PC (x64) or an Intel Mac. Moving to a server later means copying the config folder.
- ARM isn't supported yet. On a Mac with Apple silicon, Docker Desktop's emulation may start it, but that's unsupported: don't rely on it, and suggest no other workaround.

**If Docker is missing,** install it before Phase 3 (ask first, rule 5): on a Synology, **Container Manager** from the Package Center; on Linux, Docker's official guide, with the Compose plugin (https://docs.docker.com/engine/install/); on Windows or a Mac, Docker Desktop (https://www.docker.com/products/docker-desktop/).

## Install (Phase 3)

Only the steps for my platform, one at a time.

**Step 1: the values.** Ask me what you don't know yet, then STOP and wait:

- **The server's address:** the one I open its admin page with, without the port; on Linux, the first number `hostname -I` shows; with Docker Desktop on the same computer, `localhost`. Below, `<server>` means this address.
- **My time zone,** as a name from the list of time zones (https://en.wikipedia.org/wiki/List_of_tz_database_time_zones), such as `America/Phoenix`. Asking for my city is enough.
- **The user and the folders:**

| Platform | The `user:` line | The two folders |
| --- | --- | --- |
| Linux with Docker | My numbers from `id` (`uid=1000 gid=1000` means `"1000:1000"`) | `./config` and `./imports`, in `~/squirrelcade` |
| Synology (Container Manager) | `"1000:1000"`, with the folder's Everyone permission (the Synology steps): nothing to ask me | `./config` and `./imports`, in `docker/squirrelcade` |
| Unraid | No compose file: `--user 99:100` in the form | `/mnt/user/appdata/squirrelcade/config` and `.../imports` |
| TrueNAS SCALE | `"568:568"` (its apps user), with write access to the dataset | Full paths in my dataset, such as `/mnt/tank/apps/squirrelcade/config` |
| Portainer | The user that owns the two folders | Full paths; the folders must exist |
| Docker Desktop (Windows, Intel Mac) | Remove the `user:` line: nothing to ask me | `./config` and `./imports` |

**Step 2: the compose file** (`docker-compose.yml`, a short text file that tells Docker what to run). Write it for me with my values in the three marked lines:

```yaml
services:
  squirrelcade:
    image: ghcr.io/squirrelcade/squirrelcade:latest
    container_name: squirrelcade
    restart: unless-stopped
    user: "1000:1000"            # 1. the user (see the table)
    environment:
      - TZ=America/New_York      # 2. my time zone
    volumes:
      - ./config:/config         # 3. where the two folders are
      - ./imports:/imports
    ports:
      - "7575:7575"
```

**Step 3: my platform's steps,** every one, in order, one at a time. Skip none: the two folders must exist before the container starts (Docker would otherwise make them as root, and Squirrelcade couldn't save anything).

- **Linux with Docker:**
  1. `mkdir -p ~/squirrelcade/config ~/squirrelcade/imports`, then `cd ~/squirrelcade`.
  2. `nano docker-compose.yml`, paste the file (right-click, or Ctrl+Shift+V), save with Ctrl+O and Enter, leave with Ctrl+X.
  3. `docker compose up -d`. If Docker says permission denied, put `sudo` in front.
- **Synology (DSM 7.2, Container Manager):**
  1. In **File Station**, make a folder `docker/squirrelcade`, with `config` and `imports` folders inside it. (No `docker` folder at the top? Make a shared folder named docker first: **Control Panel > Shared Folder > Create**.)
  2. The user. Simplest: File Station, right-click the `squirrelcade` folder, **Properties**, **Permission**, **Create**: give **Everyone** read and write, applied to the folders and files inside too, and keep `"1000:1000"`. Or, at ease in a terminal: turn on SSH (**Control Panel > Terminal & SNMP**), sign in (`ssh <my user>@<server>`), run `id`, and use my numbers (usually `"1026:100"`).
  3. **Container Manager > Project > Create:** name `squirrelcade`, path `docker/squirrelcade`, source **Create docker-compose.yml**. Paste the file, then **Next** (a page about web portal settings needs nothing: **Next** again) and **Done**. It downloads the image and starts it.
- **Unraid:** **Docker > Add Container** (it's not in Community Applications yet). **Repository** `ghcr.io/squirrelcade/squirrelcade:latest`; **Network type** bridge; a **Port** 7575 to 7575; a **Path** from container `/config` to `/mnt/user/appdata/squirrelcade/config`, and one from `/imports` to `/mnt/user/appdata/squirrelcade/imports`; a **Variable** `TZ` with my time zone; **Extra Parameters** (Advanced view): `--user 99:100`. Then **Apply**.
- **TrueNAS SCALE (24.10 or later):** **Apps > Discover Apps**, the ⋮ menu, **Install via YAML**. Name it `squirrelcade`, and paste the file with full paths to my dataset and `user: "568:568"`.
- **Portainer:** **Stacks > Add stack**, name it `squirrelcade`, paste the file into the **Web editor** with full paths, then **Deploy the stack**.
- **Docker Desktop (Windows, or an Intel Mac; to try it):** first, Docker Desktop installed (https://www.docker.com/products/docker-desktop/) and started: it says it's running. Then a folder `squirrelcade` with `config` and `imports` folders inside, and the file saved there as `docker-compose.yml`, without the `user:` line (in Notepad, **Save as type: All files**, or it saves `docker-compose.yml.txt`; in TextEdit, **Format > Make Plain Text** first). Open a terminal in that folder (Windows 11: right-click an empty spot in the folder, **Open in Terminal**; a Mac: type `cd ` with the space in Terminal, drag the folder onto the window, press Return) and run `docker compose up -d`. The address is then `http://localhost:7575`.
- **QNAP, or anything else:** the guides don't cover it. Use the same compose file in its Docker app (QNAP: Container Station), following that app's own guide.

**Step 4: check that it runs.**

1. `docker ps` (or my NAS app's list of containers) shows `squirrelcade` running ("Up").
2. In a browser at home, `http://<server>:7575` shows **Welcome to Squirrelcade**, asking for an account. That's Phase 4.
3. Or `http://<server>:7575/api/v1/health` answers `{"status":"ok","version":"..."}`.

Nothing there? Ask for the log (rule 10): `docker logs squirrelcade`, or on a Synology **Container Manager > Container > squirrelcade > Log**. Then see "When something goes wrong".

## The first visit (Phase 4)

One step at a time; ask me what the page shows.

1. I open `http://<server>:7575` in a browser on a computer at home.
2. **A setup code?** From outside my home network (through a tunnel, say), the page also asks for a setup code, so nobody else can claim a new Squirrelcade. Squirrelcade writes it in its log when it starts, on the line that begins "No account yet": `docker logs squirrelcade`, or on a Synology **Container Manager > Container > squirrelcade > Log**. I type it in myself. From home, no code is needed.
3. **The owner's account:** a username and a password (at least 8 characters; a few words together is easy to remember), and the password again. I type them myself: don't suggest a password, and don't ask for it.
4. **The basics:** **Home region** (North America, Europe (PAL), Japan or Asia; it fills in the currency and date format), **Currency** (amounts are shown in it, never converted), **Date format** (month/day/year, day/month/year or year-month-day) and **Time zone**. Then **Create account and start**. All of it can change later in **Settings > General**.
5. The **welcome guide** opens, with five steps: Collection, Consoles, Catalogs, Covers and Wishlist. Its first step is Phase 5.

## My collection (Phase 5)

Squirrelcade works without any export. Values (what each copy is worth) come from **PriceCharting**'s export; without it, values stay empty (or as my own spreadsheet has them), and everything else works. Give me the steps for my answer to question 4 only, one at a time.

| Where my games are | What to do |
| --- | --- |
| PriceCharting | On pricecharting.com: **My Collection > Download (CSV)**. PriceCharting emails a link to `collection.zip`: upload the zip as it is. (Unzipped, keep the CSV's name, `collection_YYYYMMDD.csv`: its date is the prices' date.) A free account allows one export a week. |
| CLZ Games | Export the collection to CSV, with Title and Platform (and Collection Status, Region, Completeness, Purchase Date, Purchase Price and Barcode, if offered). Only games In Collection or For Sale come in. |
| GAMEYE | Export the collection spreadsheet. Only games marked Owned come in. |
| VGCollect | The backup CSV (on VGCollect: Settings > Export). |
| A spreadsheet of my own | Save it as CSV, a plain spreadsheet file (Excel: File > Save As > CSV; Google Sheets: File > Download > CSV), with a **Title** and a **Console** column. |
| Nowhere yet | Add a game, by hand, or a starter spreadsheet (both below). |

**Upload it:** the first time, in the welcome guide's first step (drop the file on it, or click to choose it); later, on **Stash > Stash updates**. Squirrelcade shows how many games it found, on which consoles, and anything it couldn't read. Files named like PriceCharting's (`collection_*.csv`, `collection*.zip`) can also go into the watched `imports` folder, checked every 15 minutes.

**A spreadsheet's columns** (any case; other common names work too, so my own headers may already be fine): Title (or Name, Game); Console (or Platform, System; PriceCharting's name, "PlayStation 2", or a common one, "PS2"); and if I like: Condition (Loose, CIB, Sealed, Graded, Game and box, Game and manual, Box only, Manual only), Quantity, Value (or Price), Price paid (or Paid, Cost), Date purchased (`2026-09-28`), Region (Japan, PAL or Asia; empty for North America), Notes (or Comments), Barcode (or UPC). A console it doesn't know is listed after the upload: name it as PriceCharting does ("Sega Genesis", "Playstation") and upload again.

**A starter spreadsheet:** if I list my games for you, write them as CSV in a code block: the header `Title,Console,Condition,Price paid,Date purchased`, then one row per game (the last three may stay empty; a title with a comma goes in double quotes). I save it as a plain text file, `my-collection.csv`, and upload it.

**Add a game, by hand:** menu **Acorns > Add a game** (also the **Add a game** button on the Stash page, and **Add games one at a time** in the welcome guide). Pick the **Console**, type the **Title** (it suggests titles from that console's catalog and my own games; one it doesn't know is added as I typed it), then **Condition**, **Price paid**, **Bought on** and **Notes** if I like, and **Add it**. The console stays picked for the next game. A console without a catalog yet suggests only the games I've added to it (the page says so). When I'm done, **Back to the welcome guide** at the top of the page (there when I came from the welcome guide) leads to its next step; later, **System > Status > Open the welcome guide**.

**Catalogs:** a console gets a catalog (the list of its games, built from Wikipedia) a few minutes after it has 6 different games: a setting, **Settings > Platforms > Unique games to track a console** (also in the welcome guide's Consoles step). Typing games in by hand, I can set it to 1, so each console gets its catalog, and its suggestions, after the first game. The activity icon at the top shows the work.

**The rest of the welcome guide:** **Consoles** (which are tracked), **Catalogs** (built, a minute or two each), **Covers** (IGDB's keys, Phase 6, or **Skip for now**) and **Wishlist** (the consoles and genres I like, in my order; optional).

**Check:** **System > Status** has the setup checklist. **Almanac > Platforms** lists my consoles with their completion, **Stash** my copies. **System > Review** may ask about look-alike titles: each answer counts everywhere.

**Values later:** **Stash updates > Send to PriceCharting** gives my games as lines for PriceCharting's importer (free: one import and one export a week); then I export there and upload the export here.

## Extras (Phase 6)

Backups and updates first: they're for everyone. Then only the extras I chose, in this order (simplest first): covers, messages, collection updates from your email, the phone's camera, PC games, RomM, then the rest. Before each one, ask whether I'm ready, then STOP and wait. For each: what it gives, what it needs and costs (free, unless this says otherwise), the steps one at a time, then its **Check**. Another program (Tailscale, a tunnel's connector, an updater, ntfy, RomM...) needs my OK first, and its own official install guide.

### Backups

- Squirrelcade backs up its database every week by default (**Settings > Tasks > Back up the database every**: 1 to 30 days) into the `backups` folder inside the config folder (`config/backups` on the server; `/config/backups` inside the container), and keeps 14 (**Settings > Storage and backups > Backups to keep**). **System > Backups** makes, downloads and restores them.
- Those sit on the same disk, so also keep a copy elsewhere, one way or both:
  - **A second backup folder** (another disk, a NAS share, or a folder a cloud app syncs, such as OneDrive or Dropbox on a Windows PC or Mac): a line under `volumes:` in the compose file, such as `- /path/to/other/disk/squirrelcade-backups:/backup-copies`; recreate the container (`docker compose up -d`, or the NAS app's redeploy); then `/backup-copies` in **Settings > Storage and backups > Second backup folder**.
  - **The NAS's backup app** (Hyper Backup on a Synology, say) copying the whole config folder, ideally to another place or a cloud.
- **Check:** **System > Backups > Back up now**; the new file shows in the second place.

### Updates

- **By hand:** in the compose file's folder, `docker compose pull`, then `docker compose up -d` (with `sudo` on a NAS over SSH). Synology's Container Manager: in **Project**, select squirrelcade, **Action > Stop**, then **Action > Clean** (the config folder stays); in **Image**, delete `ghcr.io/squirrelcade/squirrelcade`; back in **Project**, **Action > Build** downloads the new version and starts it (Build alone keeps the old image). Unraid: **Check for Updates** at the bottom of the Docker tab, then **apply update**. Portainer: the stack's **Editor**, **Update the stack**, with **Re-pull image and redeploy** on. Squirrelcade copies its database before changing it, and the first visit afterwards shows what's new.
- **Automatically** (optional; another container, so ask first). The simplest is the community-maintained Watchtower (its guide: https://watchtower.nickfedor.com), installed the same way as Squirrelcade (a project or stack of its own, in a folder `watchtower`; Unraid users take the plugin below instead), with this compose file and my time zone in it:

  ```yaml
  services:
    watchtower:
      image: nickfedor/watchtower
      container_name: watchtower
      restart: unless-stopped
      command: squirrelcade                  # only Squirrelcade (without this line: every container)
      environment:
        - TZ=America/New_York                # your time zone
        - WATCHTOWER_SCHEDULE=0 0 4 * * *    # every day at 4 in the morning
        - WATCHTOWER_CLEANUP=true            # removes the old image afterwards
      volumes:
        - /var/run/docker.sock:/var/run/docker.sock
  ```

  Other choices: What's Up Docker (https://getwud.github.io/wud/), which can update or only tell me; Diun (https://crazymax.dev/diun/), which only tells me; on Unraid, the **CA Auto Update Applications** plugin. Synology's Container Manager doesn't update projects by itself. Never the original Watchtower (containrrr/watchtower): archived in December 2025, it fails with newer Docker versions.
- Squirrelcade is safe to update while nobody's using it. **Check:** **System > Status** shows the version.

### Covers and game details (IGDB)

1. I sign in at https://dev.twitch.tv/console/apps with a Twitch account (free) that has two-factor sign-in on.
2. I register an application: any name, OAuth Redirect URL `http://localhost`, category **Application Integration**, client type **Confidential**.
3. Under **Manage**, I copy the **Client ID**, then **New Secret** and copy the secret.
4. I paste both in the welcome guide's Covers step (**Connect**), or in **Settings > Sources > IGDB** (**Save and test**).

**Check:** **Settings > Sources > IGDB** shows how many games it knows per console; covers appear within the hour. The same keys work for RomM.

### Messages

Each way of sending has its own switch; once it's on, its fields and steps show under it. Simplest first:

- **ntfy** (https://ntfy.sh): the ntfy app on my phone, subscribed to a topic nobody would guess (anyone who knows a topic can read it); the same topic in **Settings > Notifications**, under ntfy.
- **Email:** **Settings > Email**: my email account (**Email provider** fills in the server; my address; an **app password** made at my provider, such as Gmail's at https://myaccount.google.com/apppasswords with 2-Step Verification on). Then turn on **Send notifications by email** and fill in **To**. Outlook.com, Hotmail and Live addresses can't send from programs.
- **Discord:** the channel's settings > Integrations > Webhooks > New Webhook, then **Copy Webhook URL**. **Telegram:** `/newbot` to @BotFather for a bot token; send the bot a message, then **Find my chat**. **Slack:** an app with Incoming Webhooks.
- **Pushover** (a one-time purchase after a trial, https://pushover.net): my user key and an application's token. **Pushbullet:** an access token. **Gotify** (my own server): an application's token.
- **A webhook** (n8n, Home Assistant): its address. **Apprise** (my own Apprise API server): its notify address.

**Check:** **Send a test message**, at the bottom of **Settings > Notifications**.

### Stash updates from your email

With PriceCharting only: Squirrelcade picks up PriceCharting's export email and updates my collection by itself.

1. **Settings > Email:** my email account, once (address and app password, as for messages). Then turn on **Stash updates from your email**. Outlook.com and Microsoft 365 mailboxes can't be read with a password; a forwarding rule to another mailbox works.
2. **Check:** **Test sending and reading** says how many export emails it found.
3. From then on, **My Collection > Download (CSV)** on PriceCharting updates my collection within half an hour. **Settings > Collection > Reminders > Remind me to export after** 7 days sends a weekly reminder.

### The phone's camera, and away from home

At home, `http://<server>:7575` works on a phone, and Store Mode (Squirrelcade's page for a store) works by typing titles. The barcode camera needs an **HTTPS** address (starting with https://, with a certificate), even at home; away from home, the phone also needs a safe way in. Pick one:

- **Tailscale** (the simplest; free for personal use; nothing opened to the internet):
  1. A Tailscale account (https://tailscale.com); Tailscale on the server (Synology, Unraid and TrueNAS have it as an app or package) and on the phone, signed in on both.
  2. In Tailscale's admin console, **DNS**: turn on **MagicDNS** and **HTTPS Certificates**.
  3. On the server: `tailscale serve --bg 7575`. Squirrelcade is then at `https://<server name>.<tailnet>.ts.net`. Everyone who uses it needs Tailscale on my network.
- **Cloudflare Tunnel with Cloudflare Access** (a web address without opening my router; needs a domain of my own on Cloudflare, a few dollars a year):
  1. Cloudflare's dashboard, **Zero Trust > Networks > Tunnels > Create a tunnel** (Cloudflared); its connector runs on my server (a Docker container is easiest; its token is a secret, rule 4).
  2. A public hostname, `squirrelcade.<my domain>`, to `http://<server>:7575`.
  3. **Zero Trust > Access > Applications > Add:** a self-hosted application for that hostname, with a policy allowing my email address (and family's). Docs: https://developers.cloudflare.com/cloudflare-one/
- **A reverse proxy I already run** (Nginx Proxy Manager, Caddy, Traefik...): `https://squirrelcade.<my domain>` to `http://<server>:7575`, with a certificate and a gate in front (rule 9).

With a tunnel or a proxy: **Settings > Security > Trusted proxies** (after Show advanced) gets the address it reaches Squirrelcade from (a connector in Docker: its network's gateway, such as `172.18.0.1`); then restart Squirrelcade. With any of them: **Settings > General > Address of this Squirrelcade** gets the https address (for links in messages).

On the phone: open the https address, sign in, **Add to Home Screen**. The camera button at the top opens Store Mode with the camera on. Open Store Mode once while connected: it then works without signal.

**Check:** away from Wi-Fi, scan a game I own: it says **You own this**. No camera? The address must start with https://; on an iPhone, Settings > Safari > Camera may block it.

### PC games (Playnite)

1. In Playnite (https://playnite.link) on the Windows PC: Settings > Backup, library backups to a shared folder on the server (a NAS share), automatically (weekly is enough).
2. That folder goes under `volumes:` in the compose file, read-only: `- /path/to/Playnite Backup:/playnite:ro`. On a Synology share only its administrators may read, add `group_add: ["101"]` under the service too. Recreate the container.
3. **Settings > Features:** turn on **PC library (Playnite)**. In Docker, it reads `/playnite` by itself.

**Check:** **PC library** lists my games within a few minutes.

### RomM links

1. In RomM: my profile > **API tokens** > a new token with the `roms.read` and `platforms.read` scopes only.
2. **Settings > Features:** turn on **RomM links**. RomM's address as the server reaches it (such as `http://192.0.2.20:8080`) and the token show under the switch. **Save and test**.
3. If my browser opens RomM at another address: **Settings > Sources > RomM > RomM address for links**.

### More extras (only when I ask)

The first five have a card in **Settings > Sources**, with **Save and test**:

- **RetroAchievements:** signed in on its site (https://retroachievements.org): Settings > Keys > Web API Key. My username and that key.
- **Xbox achievements:** sign in at https://xbl.io with my Microsoft account (in a regular browser), and copy the API key from its profile page.
- **PlayStation trophies** (unofficial): sign in at https://www.playstation.com and then open https://ca.account.sony.com/api/v1/ssocookie in the same browser: the 64 characters after npsso go in its field. It works like a password, for about two months.
- **Steam achievements** (needs the PC library): a key from https://steamcommunity.com/dev/apikey (any domain name), my Steam profile's game details public, and my profile's address.
- **PC game prices** (IsThereAnyDeal; needs the PC library): a key from https://isthereanydeal.com/apps/my/ (register an app), and my country.
- **Naming barcodes** (Store Mode): **Settings > Sources > Barcodes**: UPCitemdb (no key, about 100 a day), UPC Database (a free key from https://upcdatabase.org), or both.
- **Family and friends:** **System > Users > Invite someone** makes a link that works once; **Acorns wishlist > Share** makes a gift link anyone can open (behind Cloudflare Access, add a policy with the action **Bypass** for `/share/*` and `/api/v1/share/*` only).
- **Selling and a goal:** **Settings > Collection > Selling** and **Your goal**.
- **A start page:** the key on **Settings > Security > API key** (a secret), sent in the `X-Api-Key` header to `GET /api/v1/stats`.

## Finish (Phase 7)

1. Check each part with its **Check** (Phase 6), and **System > Status**: its health and setup checklist.
2. Give me a summary table: each part, whether it works, and where it lives (Squirrelcade's address, the compose file's folder, the config folder with its backups and their second copy, each extra's settings page).
3. List what's left for another day.
4. Tell me where help is: **Help** in the menu, the **?** on each page, **System > Status**.
5. Mention once, without pushing, the extras I didn't choose. One of them: **Settings > Claude and AI apps** lets Claude (or another AI app) read my collection and answer "do I have this game?"; a plugin there works in the Claude app's Cowork and in Claude Code.

## A settings file

Only when "Where things are" below has links (a brief from an install), and only if I want it: instead of me typing several settings, you write them into a file and I load it with **Settings**, any page, **Import**. The import window shows each change first; **Apply the file, keep these** changes only what's in the file.

- JSON, with only the settings to change: `{"format": "squirrelcade-settings", "version": 1, "settings": {"features.romm": true, "sources.rommUrl": "http://192.0.2.20:8080"}}`. A setting's key is the part of its link after `#setting-`.
- Never a password, key, token, app password or webhook address in it (rule 4). Only keys and values you're sure of: Squirrelcade refuses a key it doesn't know.
- In a code block; I save it as `squirrelcade-settings.json`.

## When something goes wrong

First: **System > Status** (health problems, with what to do), **System > Tasks** (why a background job failed), **System > Logs** or `docker logs squirrelcade`. **System > Status > Support file** downloads the version, health, settings (never passwords or keys), tasks and log lines (rule 10).

| What I see | What to do |
| --- | --- |
| "permission denied" on /config | The `user:` can't write to the folders: change its numbers, or the folders' owner (`sudo chown -R 1000:1000 config imports`, with the `user:` numbers). |
| "port is already allocated" or "address already in use" | Port 7575 is taken: change the left number (`"7580:7575"`) and open that port. |
| "no matching manifest for linux/arm64" | The processor is ARM: not supported yet (Phase 2). |
| "manifest unknown" or "not found" | The image name is mistyped: `ghcr.io/squirrelcade/squirrelcade:latest`. |
| The page doesn't load after an update | It may still be starting (a database change can take a minute): wait, then read the log. |
| **Update held** ("Waiting for confirmation: this would remove...") | It would remove more than 10% of the collection: **See what changes** on Stash updates, then apply or discard it. |
| Catalogs stay empty | The server can't reach Wikipedia: check its internet, then **System > Tasks > Build catalogs**. |
| Forgot the owner's password | On the server, `docker exec -it squirrelcade node server/dist/reset-link.js` prints a link that works once. |

Still stuck? Squirrelcade's help page "When something goes wrong" says how to report a problem.

## Where things are

<!-- squirrelcade:links -->
In the app: Settings > Features for each optional part, Settings > Notifications for messages, Settings > Security for sign-in, viewers and the API key, Settings > Storage and backups for backups, System > Status for health and the setup checklist. (Copied from Squirrelcade's own Help > AI-assisted setup, this section has a link to each setting on my install.)
<!-- /squirrelcade:links -->
