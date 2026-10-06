# Playnite reader

A small read-only .NET 8 program that reads a Playnite library backup (the ZIP Playnite writes on a
schedule) and prints one JSON record per game per storefront. Squirrelcade's PC library runs it as a
helper (see `apps/server/src/pc.ts`); the Docker image builds it in its own stage and ships the binary
as `/app/bin/playnite-reader`.

It came from the ChatGPT-era system ("vgcm-playnite-reader"), where it ran as an HTTP service; Squirrelcade
uses its command-line mode only:

```bash
playnite-reader --backup-dir /playnite --output /tmp/snapshot.json
```

- `--backup-dir <folder>`: the newest `*.zip` in the folder (it must be at least 5 minutes old, so a
  backup still being written is never read); or `--backup-file <zip>`, or `--library-dir <folder>` for an
  unzipped `library` folder.
- Only the 18 library files are extracted, to a temporary folder that is removed afterwards; the backup
  is never written to. A backup that changes while being read produces no output.
- It refuses a library with fewer than `--min-game-count` games (100 by default) or duplicate records.
- The output's `schemaVersion` is `vgcm-playnite-library-v1`: records carry the storefront (`sourceName`),
  its game id, title, platforms, genres, series, completion status, playtime, favorite/hidden/installed
  flags, scores and links.

Playnite's databases are LiteDB 4 files, which is why this is a .NET program rather than part of the
Node server.
