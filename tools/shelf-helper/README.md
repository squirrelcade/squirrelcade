# A helper for Check a shelf

Check a shelf (Store Mode) reads shelf photos on the phone with no service at all. Its optional vision model can be an API (OpenAI, Gemini, Anthropic, OpenRouter, a model at home), or a **helper**: a program of your own that asks Squirrelcade for photos to read and answers with the titles. Squirrelcade decides what you have either way; a helper only reads.

`claude-code-helper.py` is one such helper. It uses [Claude Code](https://docs.claude.com/en/docs/claude-code) signed in on the computer it runs on, so the reading counts against that Claude account's plan, with no API key. Any other program can be a helper the same way:

- `GET /api/v1/helper/next` with the `X-Api-Key` header waits up to 25 seconds (`?wait=` in milliseconds, less) and answers `204` when no photo is waiting, or `{ id, kind: "shelf", prompt, console, pieces }`, the pieces being JPEG data URLs.
- `POST /api/v1/helper/answer` with `{ id, titles: ["...", ...] }` (or `{ id, text }`, one title a line, or `{ id, error }`).

A photo waits a minute for a helper to take it and ten minutes for its answer. Only the owner's key or sign-in can be a helper.

## Running it

On the computer Claude Code is signed in on (`claude` once, interactively, to sign in), with Python 3:

1. In Squirrelcade: **Settings > Features**, turn on **A vision model for Check a shelf**; then **Settings > Sources > Vision model > Kind of API: A helper of your own**.
2. Run it with Squirrelcade's address and API key (Settings > Security > API key):

   ```sh
   SQUIRRELCADE_URL=http://127.0.0.1:7575 SQUIRRELCADE_KEY=... python3 claude-code-helper.py
   ```

   On the computer Squirrelcade runs on, `SQUIRRELCADE_DB=/path/to/config/squirrelcade.db` reads the key from Squirrelcade's database instead (read-only), so it's kept in one place.

3. **Save and test** under the key in Settings > Sources > Vision model: "The helper answered."

To keep it running, a systemd service on Linux (as the user Claude Code is signed in as):

```ini
[Unit]
Description=Squirrelcade's shelf photo helper (Claude Code)
After=network-online.target docker.service

[Service]
User=you
Environment=SQUIRRELCADE_URL=http://127.0.0.1:7575
Environment=SQUIRRELCADE_DB=/opt/squirrelcade/config/squirrelcade.db
ExecStart=/usr/bin/python3 /usr/local/sbin/squirrelcade-shelf-helper
Restart=always
RestartSec=30
Nice=10

[Install]
WantedBy=multi-user.target
```

Each photo is a few image reads for Claude Code (with Sonnet by default; `CLAUDE_MODEL` changes it), counted in the plan's usage limits. Settings > Sources > Vision model > Pieces a day caps it.
