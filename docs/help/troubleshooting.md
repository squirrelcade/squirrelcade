# When something goes wrong

## First places to look

- **System > Status:** health problems, the version, the folders Squirrelcade uses, and the setup checklist (also on Today while essential steps are left).
- **System > Tasks:** each background task's last run, what it did or why it failed, and **Run now**.
- **System > Logs:** what Squirrelcade wrote down, newest first (Settings > General > Log level for more detail).

## Asking for help

**System > Status > Support file** downloads what someone helping you needs: the version, health, settings (never passwords or keys), recent tasks and log lines. Look it over before you send it: it names your consoles and folders.

## Reporting a problem, or asking for something new

Squirrelcade's [GitHub page](https://github.com/squirrelcade/squirrelcade/issues/new/choose) has a form for each: **Something's wrong** and **An idea** (a free GitHub account is needed to send one). An AI can write it up with you: paste [the request prompt](https://github.com/squirrelcade/squirrelcade/blob/main/docs/ai/request-prompt.md) into Claude, ChatGPT or another AI and tell it what you'd like. It asks a few questions, checks what Squirrelcade does already, and gives you a link to the form, filled in, which you look over and send yourself. Ideas are reviewed, and the approved ones go into a future version.

## Common questions

- **A game I own shows as missing.** Its title in your export differs from the catalog's more than Squirrelcade will guess. Look for it on the console's **Not in catalog** tab (link it, or say it's another game) or on **Review**. A compilation needs a mapping. See [How matching works](../MATCHING.md).
- **A game shows as owned that I don't have.** Open it: the drawer says which of your copies counts as it and why; **not the same** stops it.
- **An update was held.** It would remove more of your games than allowed (10% by default): check the export on Stash updates, then apply or discard it.
- **No covers.** Covers need IGDB keys (Settings > Sources > IGDB) and IGDB turned on (Settings > Features). After adding keys, the "Update IGDB data" task downloads each console's list (System > Tasks).
- **Store Mode's camera doesn't start.** Browsers allow the camera only over HTTPS: reach Squirrelcade through a reverse proxy or tunnel with a certificate. Typing the title works everywhere.
- **The PC library or RomM is missing from the menu.** They're off in a new install: Settings > Features.
- **A page says it couldn't be shown.** Reload it; after an update, the old page's code may be gone. If it keeps happening, the support file has the error.

## Locked out

Forgot the owner's password? On the server, `docker exec -it squirrelcade node server/dist/reset-link.js` prints a link that works once to choose a new one (and signs the account out everywhere). A viewer who forgot theirs: System > Users makes them the same link.
