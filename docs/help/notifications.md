# Notifications

Squirrelcade can tell you when something happens: a summary after each collection update, a problem, a lent game that's late, a price drop. It sends them by **email**, to a **phone app**, to a **chat**, or to a **webhook**: as many as you like, each with its own switch: email on **Settings > Email**, the others on **Settings > Notifications**. All are off until you set one up.

Turn one on and its fields and setup steps show right under its switch. Each step links to the page where it's done, with **Search the web** beside it in case that page has moved (Settings > Interface > Web searches picks the search engine). **Send a test message** at the bottom checks everything that's on, and says what each service answered.

Passwords, tokens and webhook addresses are kept like passwords: never shown again, never exported with the settings, and never in the support file.

## Email

**Email provider** fills in the mail server and port, and shows how to get the **app password** your provider wants for programs like Squirrelcade (your account's own password usually won't work). Then enter your address as the username, the app password, and who gets the messages (yourself, usually).

| Provider | Mail server | Port | The password |
| --- | --- | --- | --- |
| Gmail | smtp.gmail.com | 587 | An [app password](https://myaccount.google.com/apppasswords) (2-Step Verification must be on) |
| Yahoo Mail | smtp.mail.yahoo.com | 465 | An app password: [account security](https://login.yahoo.com/account/security) › Create app password |
| iCloud Mail | smtp.mail.me.com | 587 | An app-specific password: [Apple Account](https://account.apple.com) › Sign-In and Security |
| AOL Mail | smtp.aol.com | 465 | An app password: [account security](https://login.aol.com/account/security) › Generate app password |
| Zoho Mail | smtp.zoho.com | 465 | An [app password](https://accounts.zoho.com/home#security/app_password) when two-factor sign-in is on (Europe: smtp.zoho.eu) |
| Fastmail | smtp.fastmail.com | 465 | An app password: [Settings › Privacy & Security](https://app.fastmail.com/settings/security) |
| GMX | mail.gmx.com | 587 | Your GMX password, after allowing POP3 & IMAP access in GMX's settings (gmx.de and gmx.net: smtp.gmx.net) |
| Microsoft 365 (work or school) | smtp.office365.com | 587 | Your password or an app password, if your admin allows "Authenticated SMTP" (ending: it turns off by default at the end of 2026) |
| **Another provider** | (its SMTP server) | 587 or 465 | Its help pages say; search for "your provider SMTP settings" |

**Outlook.com, Hotmail and Live addresses don't work:** since September 2024 Microsoft lets programs send from them only with Microsoft's own sign-in, never a password. Use another address for Squirrelcade's messages (a free Gmail works), or a phone app or chat below.

## Phone apps

- **Pushover** (a one-time purchase after a trial): sign in at [pushover.net](https://pushover.net) for your **user key**, and [create an application](https://pushover.net/apps/build) named Squirrelcade for its **API token**.
- **Pushbullet** (free for up to 500 pushes a month): Settings › Account › **Create Access Token** at [pushbullet.com](https://www.pushbullet.com/#settings/account).
- **ntfy** (free on [ntfy.sh](https://ntfy.sh), or a server of your own; apps for Android and iPhone): pick a **topic** nobody would guess (anyone who knows a topic on ntfy.sh can read it), subscribe to it in the app, and enter it. Your own server: its address, and an access token if it asks for one.
- **Gotify** (a server you run yourself, with an Android app): in Gotify, Apps › Create application, then enter your server's address and the app's **token**.

## Chats

- **Discord:** the channel's settings › Integrations › Webhooks › New Webhook, then **Copy Webhook URL**.
- **Telegram:** message [@BotFather](https://t.me/BotFather) with `/newbot` for a **bot token**, send your new bot a message ("hi"), then **Find my chat** under the token fills in your **chat ID**. For a group, add the bot and write there first.
- **Slack:** create an app for your workspace, turn on **Incoming Webhooks**, add a webhook for the channel, and copy its address ([Slack's steps](https://api.slack.com/messaging/webhooks)).

## Webhook, for n8n and friends

Each message as JSON (a POST) to an address of your choice: an n8n workflow's Webhook node, Home Assistant, Node-RED, anything that takes a web request. If the receiver checks a header, give its value (such as `Bearer abc123`): it's sent as `Authorization`.

Each message is one JSON object with these fields:

| Field | What it holds |
| --- | --- |
| `app` | Always `Squirrelcade` |
| `kind` | `summary` (an update summary, a reminder, a price drop, a late loan), `waiting` (an update held for you), `problem` (a failed task, a health problem) or `test` |
| `importance` | From -2 (lowest) to 2 (emergency), as set below |
| `title` | The subject, such as "Squirrelcade: collection updated" |
| `message` | The short form, as a phone notification shows it |
| `text` | The full text, as the email has it |
| `html` | The same, as HTML |
| `url` | The page it's about, such as `https://squirrelcade.example.com/updates`; `null` without Squirrelcade's address (Settings > General) |
| `sentAt` | When it was sent, such as `2026-09-28T20:00:00.000Z` |

## Apprise, for everything else

[Apprise API](https://github.com/caronc/apprise-api) is a server you run yourself (a Docker container) that passes messages on to more than 100 services: Signal, Matrix, Microsoft Teams, SMS and more. Save your services in it under a key, and give Squirrelcade that key's notify address, such as `http://apprise:8000/notify/squirrelcade`.

## How urgent each message is

Update summaries, updates waiting for you, and problems each have an importance, from Lowest to Emergency. Pushover, ntfy and Gotify alert by it (Pushover's Emergency repeats every minute until you acknowledge it, for up to an hour); the webhook and Apprise pass it on. A test message is always Normal.

## What you're told

- **After each collection update:** what was added and removed, the value, the wishlist's new top picks, the biggest price moves, and the games coming out in the next 30 days (each part a setting).
- **When something needs you:** an update or a PC library reading held because it would remove too much, a task that failed (once when it starts failing, at most once a day while it keeps failing, and once when it works again), a health problem (a missing folder, old backups, a disk filling up).
- **When a lent game is overdue** (on): one message per loan, when a game you lent isn't back by its day ([Your copies](your-copies.md)).
- **PC price drops** (with PC game prices on): a game on the PC wishlist at its lowest price ever, or at a discount you choose (Settings > PC library > Prices).
- **Release reminders** (off until you turn them on): a message when games you don't have come out on the consoles you collect, on the day or some days before, each game once. Games you own, said aren't a target, snoozed or marked Do Not Recommend are left out; "Only games with at least this many acorns" can leave out more.

## The game of the day

**Settings > Notifications > Game of the day** sends one game from the top of your wishlist each day, at an hour you choose, with a link to its price. See [the wishlist](wishlist.md#the-game-of-the-day).
