# Set up notifications in Squirrelcade

I already have **Squirrelcade** (version 1.4.0 or later), a free, self-hosted web app for my video game collection, running. Please help me set up **one thing**: notifications. Read all of this first.

**Your first message:** say in one sentence what we'll do, tell me the time to allow ("about 10 minutes; give it 25"), then ask me the question under "Have ready" and STOP and wait.

## How to work with me

- **One step at a time.** Give me the exact clicks or fields for one step, then STOP and wait until I say it's done or tell you what I see. Keep messages short.
- **Never ask me for a password, API key, token, app password or webhook address, and don't let me paste one into this chat.** Tell me where to get it (its official page) and where it goes in Squirrelcade. I type it there myself, press its **Test** (or **Save and test**) button and tell you what it said. If I paste a secret anyway, tell me it's exposed, so I make a new one.
- **Ask before changing my server.** Before a command or a click that installs, changes or deletes something, say what it does and wait for my OK. Read-only checks need no OK.
- **Stick to the facts:** this brief, Squirrelcade's own Help (Help in its menu, and the ? on each page) and the official pages named here. Never make up a menu or a setting. If what I see doesn't match, ask me what I see.
- **Free and simple first.** Say what each thing costs in money and upkeep, and never push an extra I didn't ask for.
- **I may stop at any point.** Then say what's done and what's left. Settings > Features in Squirrelcade lists every optional feature, with a **Set it up with AI** button that copies this prompt again to pick up later.

## What it is

Squirrelcade can send a message after each collection update and an alert when something fails. Several ways are available, each with its own switch under **Settings > Notifications**: email, Pushover, Pushbullet, ntfy, Gotify, Discord, Telegram, Slack, a webhook (n8n, Home Assistant) and Apprise. One is enough; more can be on together.

## Have ready

- Which way I'd like. Ask me, simplest first: **ntfy** (free, no account: an app on my phone), **Discord** or **Slack** (a chat channel I already have), **email** (needs my email account, set up on Settings > Email: see the email accounts prompt, `mail`), **Pushover** (a one-time purchase after a trial), or something I run myself (Gotify, Apprise, a webhook).
- My phone, if the way is a phone app.

## Steps

Only the way I chose; all of it happens in **Settings > Notifications**: turn on its switch, and its fields and steps show under it.

- **ntfy** (https://ntfy.sh): the ntfy app on my phone, subscribed to a topic nobody would guess (anyone who knows a topic can read it). The same topic goes in the ntfy fields in Squirrelcade (**Server** `https://ntfy.sh`, unless I run my own).
- **Email:** my email account (see Settings > Email: provider, address, an **app password** made at the provider, such as Gmail's at https://myaccount.google.com/apppasswords with 2-Step Verification on), the account's **Test**, then on Settings > Notifications **Send notifications by email**, **Send from** (that account) and **To**. Outlook.com, Hotmail and Live addresses can't send from programs.
- **Discord:** the channel's settings > Integrations > Webhooks > New Webhook, then **Copy Webhook URL**. I paste it into Squirrelcade myself (a webhook address works like a password). **Slack:** an app with Incoming Webhooks. **Telegram:** `/newbot` to @BotFather for a bot token; I send the bot a message, then press **Find my chat** in Squirrelcade.
- **Pushover** (https://pushover.net): my user key and an application's token. **Pushbullet:** an access token. **Gotify** (my own server): an application's token.
- **A webhook** or **Apprise** (my own Apprise API server): its address.

At the bottom of the page press **Send a test message**.

## Check that it works

- The test message arrives on my phone or in my chat.
- **System > Status > Integrations:** the Notifications light is green once something has been sent.

## How long it takes

about 10 minutes; give it 25. The second number is on purpose: setting up outside accounts usually takes longer than it looks, and nobody should feel behind.

## If something goes wrong

- Nothing arrives: the page's test message names the way that failed and why. A mistyped token or topic is the usual cause.
- Email: a wrong app password, or 2-Step Verification off, or an Outlook address (not supported for sending from programs).
- Help > Notifications has each way's steps.
