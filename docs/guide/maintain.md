# 5. Keep it running

## Updates

A new version is a new image. Pull it and recreate the container: `docker compose pull`, then `docker compose up -d` (or your NAS app's update button; see [Install it](install.md#updating-later)). Before a new version changes the database, Squirrelcade saves a copy of it, and the first visit afterwards shows what's new (again any time: **System > Status > What's new**). The version running is on **System > Status**.

To update automatically, a tool that watches your containers' images can pull each new version for you. The simplest is the community-maintained Watchtower, installed the same way as Squirrelcade (a project or stack of its own), with this compose file:

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

Watchtower and the others:

- [What's Up Docker](https://getwud.github.io/wud/): it can update, or only tell you.
- The [community-maintained Watchtower](https://github.com/nicholas-fedor/watchtower). (The original Watchtower was archived in December 2025 and doesn't work with newer Docker versions.)
- [Diun](https://crazymax.dev/diun/): it only tells you about a new version, and nothing changes on its own.
- On Unraid, the **CA Auto Update Applications** plugin.

Synology's Container Manager doesn't update projects by itself: update by hand ([the steps](install.md#updating-later)) or use one of the tools above. Squirrelcade is safe to update while nobody's using it: it copies its database before changing it, and a task an update interrupts runs again two minutes after the restart.

## Backups

- Squirrelcade backs up its own database every week by default (Settings > Tasks: every 1 to 30 days) into `config/backups` (**System > Backups**, where you can also make one and restore one). The number kept is a setting (Settings > Storage and backups).
- Those backups sit on the same disk. Copy the whole **config** folder somewhere else too: with your NAS's backup app (Hyper Backup, say), or name a **second backup folder** in Settings > Storage and backups (a folder on another disk, a share, or a folder a cloud app syncs such as OneDrive or Dropbox, mounted into the container) and each backup is copied there.
- If you keep your collection on PriceCharting, it also lives there, and each export is kept on **Stash updates**. The database holds everything else: games added by hand, your answers to Review questions, your notes, preferences, sets, photos and what you played. Back it up.

## Moving to a new server

Stop the container, copy the **config** folder to the new server, and start Squirrelcade there with the same compose file (and the folder's owner matching `user:`). Everything comes along: the account, settings, keys and history.

## When something's wrong

1. **System > Status** lists health problems (a missing folder, old backups, a full disk) with what to do.
2. **System > Tasks** shows each background job's last run, and why one failed.
3. **System > Logs**, or `docker logs squirrelcade`.
4. **System > Status > Support file** downloads the version, health, settings (never passwords or keys), recent tasks and log lines: send it with a description when asking for help. See [When something goes wrong](../help/troubleshooting.md).

Common ones:

| What you see | Why, and what to do |
| --- | --- |
| The page doesn't load after an update | The container may still be starting (a database change can take a minute): wait, then look at its log. |
| **Update held** ("Waiting for confirmation: this would remove...") | The export would remove more than 10% of your collection: look at **See what changes** on Stash updates, then apply or discard it. A PriceCharting export cut short is the usual cause. |
| Catalogs stay empty | Squirrelcade couldn't reach Wikipedia: check the server's internet connection and **System > Tasks > Build catalogs**. |
| The camera doesn't start | The address isn't HTTPS: see [Reach it from your phone](phone.md). |
| Forgot the owner's password | Run `docker exec -it squirrelcade node server/dist/reset-link.js` on the server: it prints a link that works once to choose a new password (and signs the account out everywhere). A viewer who forgot theirs: System > Users makes them the same link. |

## Uninstalling

Stop and remove the container (`docker compose down`), then delete the config and imports folders if you don't want to keep them. Nothing else is left behind: Squirrelcade keeps no data anywhere else.
