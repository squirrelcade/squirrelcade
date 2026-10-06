# Backups and updates

## Backups

Everything Squirrelcade knows is in one database file in the `/config` folder. Squirrelcade backs it up every week by default (Settings > Tasks: every 1 to 30 days; daily while you change a lot) and keeps the last 14 backups (a setting), in `/config/backups` or the folder named in **Settings > Storage and backups**.

- **System > Backups:** **Back up now**, download a backup, or restore one. A restore happens at the next start, and the database it replaces is kept beside it. Each backup is one file, whole by itself: it can be copied anywhere.
- **A copy off this disk:** mount another folder (a NAS share, say) and name it in Settings > Storage and backups > Second backup folder: each backup is copied there too. A missing folder shows as a health warning.
- Before each update that changes the database, Squirrelcade keeps a copy of the database as it was.
- **Every backup is checked:** a new one counts only once SQLite's own check says it's sound, and its copy in the second folder must come out whole. One that fails is set aside (as a ".bad" file, never offered for a restore), the older backups are kept, and you get a message that the backup failed.

Settings can also be exported to a file and imported again (Settings, any page: **Export**, **Import**); passwords and keys are never exported. Before a file is applied, the import window lists what it changes (each setting, before and after) and anything in it that isn't a setting; a file written by an AI helping you set up works the same way ([AI-assisted setup](ai-setup.md)).

## Updating Squirrelcade

With Docker, pull the new image and recreate the container (`docker compose pull`, then `docker compose up -d`). A NAS app has steps of its own (Synology's Container Manager needs the old image deleted first): see [Updating later](../guide/install.md#updating-later) in the install guide. A tool can watch for new versions: What's Up Docker or the community-maintained Watchtower update Squirrelcade by themselves, and Diun only tells you. The database is updated at the first start, after that copy is made. After an update, the first visit shows what's new (System > Status shows it again). Each version's changes are in the [changelog](../../CHANGELOG.md).

## Health

A health check runs every 6 hours (a setting) and **System > Status** shows its findings: a missing or unwritable folder, old backups, a disk running out of room, a Playnite folder gone quiet. With [notifications](notifications.md) set up, each new problem sends one message.
