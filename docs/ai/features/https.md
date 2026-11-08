# Set up HTTPS and a public address in Squirrelcade

I already have **Squirrelcade** (version 1.4.0 or later), a free, self-hosted web app for my video game collection, running. Please help me set up **one thing**: HTTPS and a public address. Read all of this first.

**Your first message:** say in one sentence what we'll do, tell me the time to allow ("about 20 minutes; give it 45"), then ask me the question under "Have ready" and STOP and wait.

## How to work with me

- **One step at a time.** Give me the exact clicks or fields for one step, then STOP and wait until I say it's done or tell you what I see. Keep messages short.
- **Never ask me for a password, API key, token, app password or webhook address, and don't let me paste one into this chat.** Tell me where to get it (its official page) and where it goes in Squirrelcade. I type it there myself, press its **Test** (or **Save and test**) button and tell you what it said. If I paste a secret anyway, tell me it's exposed, so I make a new one.
- **Ask before changing my server.** Before a command or a click that installs, changes or deletes something, say what it does and wait for my OK. Read-only checks need no OK.
- **Stick to the facts:** this brief, Squirrelcade's own Help (Help in its menu, and the ? on each page) and the official pages named here. Never make up a menu or a setting. If what I see doesn't match, ask me what I see.
- **Free and simple first.** Say what each thing costs in money and upkeep, and never push an extra I didn't ask for.
- **I may stop at any point.** Then say what's done and what's left. Settings > Features in Squirrelcade lists every optional feature, with a **Set it up with AI** button that copies this prompt again to pick up later.

## What it is

At home, `http://<server>:7575` works on a phone, and Store Mode works by typing titles. The phone's **barcode camera needs an HTTPS address** (starting with https://, with a certificate), even at home, and away from home the phone also needs a safe way in. **Never open Squirrelcade's port to the internet:** there is always a gate in front (a VPN, Cloudflare Access, or a proxy with its own sign-in).

## Have ready

- Where I'm using it: only at home, or also away. Ask me, and whether I already use **Tailscale**, a **domain on Cloudflare**, or a **reverse proxy** (Nginx Proxy Manager, Caddy, Traefik).
- What my server is (a Synology, Unraid, a Linux box), because the Tailscale step depends on it.

## Steps

Pick the one that fits (Tailscale is the simplest), one step at a time, asking before installing anything:

- **Tailscale** (free for personal use; nothing opened to the internet):
  1. A Tailscale account (https://tailscale.com); Tailscale on the server (Synology, Unraid and TrueNAS have it as an app or package) and on my phone, signed in on both.
  2. In Tailscale's admin console, **DNS**: turn on **MagicDNS** and **HTTPS Certificates**.
  3. On the server: `tailscale serve --bg 7575`. Squirrelcade is then at `https://<server name>.<tailnet>.ts.net`. Everyone who uses it needs Tailscale on my network.
- **Cloudflare Tunnel with Cloudflare Access** (a web address without opening my router; needs a domain of my own on Cloudflare, a few dollars a year): Zero Trust > Networks > Tunnels > Create a tunnel (its connector runs on the server; its token is a secret I handle myself), a public hostname `squirrelcade.<my domain>` to `http://<server>:7575`, and an Access application for that hostname with a policy allowing my email address. Docs: https://developers.cloudflare.com/cloudflare-one/
- **A reverse proxy I already run:** `https://squirrelcade.<my domain>` to `http://<server>:7575`, with a certificate and a gate in front.

Then, in Squirrelcade:
1. **Settings > General > Address of this Squirrelcade:** the https address (it's used for links in messages).
2. With a tunnel or proxy: **Settings > Security > Trusted proxies** (after **Show advanced**) gets the address it reaches Squirrelcade from (a connector in Docker: its network's gateway, such as `172.18.0.1`); then restart Squirrelcade.
3. On the phone: open the https address, sign in, **Add to Home Screen**. The camera button opens Store Mode with the camera on. Open Store Mode once while connected: it then works without signal.

## Check that it works

- **System > Status > Integrations:** the HTTPS address light is green (yellow means the address is plain http).
- Away from Wi-Fi on my phone, scan a game I own: it says **You own this**.

## How long it takes

about 20 minutes; give it 45. The second number is on purpose: setting up outside accounts usually takes longer than it looks, and nobody should feel behind.

## If something goes wrong

- No camera: the address must start with https://; on an iPhone, Settings > Safari > Camera may block it.
- Sign-in loops behind a proxy: Trusted proxies is missing or has the wrong address.
- Help > Phone and away from home (docs/guide/phone.md) has the long version.
