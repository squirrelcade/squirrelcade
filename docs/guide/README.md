# Install and set up Squirrelcade

A step-by-step guide from nothing to a Squirrelcade you use every day: on your server, and on your phone in a store. Each step says what you need, what to do, and how to check it worked.

| Step | What you end up with | Time |
| --- | --- | --- |
| 1. [Install it](install.md) | Squirrelcade running on your server, open in a browser at home. | 10 to 20 minutes |
| 2. [The first visit](first-run.md) | Your account, your collection in, catalogs built for your consoles. | 10 minutes, then a few minutes of waiting |
| 3. [Reach it from your phone](phone.md) | Squirrelcade on your phone away from home, with the barcode camera working. | 15 to 30 minutes |
| 4. [Connect what you use](connect.md) | Covers, messages, exports picked up from your email, your PC games, RomM, family access. Each one optional. | 5 to 15 minutes each |
| 5. [Keep it running](maintain.md) | Updates, backups, moving to a new server, and what to do when something's wrong. | Read once |

Prefer to be walked through it? Paste [the setup prompt](../ai/setup-prompt.md) into the AI you use (Claude, ChatGPT...; a free account is enough). It asks about your server and your collection, checks that Squirrelcade can run there, and takes you through these same steps one at a time. It never asks for your passwords or keys. Once Squirrelcade runs, **Help > AI-assisted setup** gives the same prompt with your install's details filled in ([how it works](../help/ai-setup.md)).

## Before you start

- **A machine that runs Docker all the time:** a NAS (Synology, QNAP, Unraid, TrueNAS), a mini PC, or any Linux server. Squirrelcade is built for 64-bit Intel and AMD processors (x86-64); ARM machines (a Raspberry Pi, NAS models with ARM processors) aren't supported yet. To check: on Linux, `uname -m` says `x86_64` (fine) or `aarch64` (not yet); on a Synology, **Control Panel > Info Center** names the processor (Intel or AMD is fine).
- **Your games.** Bring them in from an export (PriceCharting, CLZ Games, GAMEYE, VGCollect, or a spreadsheet of your own), or type them in one at a time. Values come from a PriceCharting export, or from a Value column in a spreadsheet of your own; games you type in have none until then, and everything else works the same. See [Your collection](../help/collection.md).
- **About 30 minutes** for steps 1 and 2. The rest can wait for another day.

**Squirrelcade works on its own.** It needs no AI, no outside account and no subscription. Everything else (covers, messages, the PC library, Claude...) is optional, and each has its own switch in **Settings > Features**.

The pictures come from a new install with a made-up collection.

## Words used here

- **Docker:** a free program that runs apps in separate, self-contained boxes called **containers**. Squirrelcade is one container. Your NAS may have Docker already (Synology calls it Container Manager).
- **Export:** a file with your list of games, saved by the app or website where you keep your collection (or a spreadsheet of your own). A **CSV** is a plain spreadsheet file.
- **Port:** the number after the colon in an address (7575). It's the door Squirrelcade answers at on your server.
- **Server:** the machine Squirrelcade runs on. **Its address** is how you reach it at home, such as `http://192.168.1.20:7575` (your server's own address and port 7575).
- **Compose file:** a short text file (`docker-compose.yml`) that tells Docker what to run. Every NAS app that runs Docker takes one (a "project" in Synology's Container Manager, a "stack" in Portainer).
- **Owner:** the account that owns the collection, the first one made. Others can be invited as **viewers**, who can look but change nothing.

Once Squirrelcade runs, its own help is in the app: **Help** in the menu, and the **?** on each page. The same guides are in [docs/help](../help/README.md).
