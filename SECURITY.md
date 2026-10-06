# Security

Please report a security problem privately, not in a public issue: use GitHub's **Report a vulnerability** (the Security tab of this repository). Say what you found and how to reproduce it; you'll get an answer as soon as possible.

## How Squirrelcade protects an install

- **A new install** makes its owner's account from the home network; from anywhere else, first-run setup asks for a one-time setup code that Squirrelcade writes in its log, so nobody who finds a new install on the internet can claim it.
- **Sign-in:** passwords are stored as salted hashes (scrypt); sessions and invite links are kept only as SHA-256 hashes of their tokens. Settings > Security sets how long a session lasts.
- **Viewers** can read the collection and change nothing: the server refuses them every change and the owner's private pages, whatever the interface shows.
- **Keys and passwords** for outside services (IGDB, RomM, email, Pushover) live in the install's database, are never sent back to the browser, and never appear in settings exports or the support file.
- **Checking a game without signing in** (off by default) shows nothing private and limits how many checks one address can make.
- **Headers:** no MIME sniffing, no framing by other sites, no page addresses sent to other sites, and API answers are never cached.

## Running it safely

- Keep Squirrelcade behind a VPN or an access gate (such as Cloudflare Access) when it's reachable from the internet, and use HTTPS (Store Mode's camera needs it anyway).
- Settings > Security > Trusted proxies names the reverse proxies whose forwarded addresses Squirrelcade may believe.
- Back up `/config`: it holds the database with everything, including those keys.
