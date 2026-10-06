/**
 * The ways Squirrelcade sends messages (Settings > Notifications): email, and push and chat services. Each is optional,
 * with its own switch. This file holds what doesn't need the network: how each service's request is built, the email
 * providers Squirrelcade can fill in, and the setup steps the settings page shows (each link with a web search to fall
 * back on, since providers move their pages).
 */

/** A way messages go out. */
export type Channel = 'email' | 'pushover' | 'pushbullet' | 'ntfy' | 'gotify' | 'discord' | 'telegram' | 'slack' | 'webhook' | 'apprise';

/** What a message is about, which sets its importance where a service has one (Settings > Notifications). */
export type MessageKind = 'summary' | 'waiting' | 'problem' | 'test';

/** A message: its subject, the full text and HTML (email), and a short form for push and chat services. */
export interface OutgoingMessage {
  subject: string;
  text: string;
  html: string;
  short: string;
}

/** A request to a web service: where it goes, its headers and its JSON body. */
export interface ChannelRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** Each channel's name as the pages say it. */
export const CHANNEL_NAMES: Readonly<Record<Channel, string>> = {
  email: 'Email',
  pushover: 'Pushover',
  pushbullet: 'Pushbullet',
  ntfy: 'ntfy',
  gotify: 'Gotify',
  discord: 'Discord',
  telegram: 'Telegram',
  slack: 'Slack',
  webhook: 'Webhook',
  apprise: 'Apprise',
};

/** The channels in the order the settings page lists them. */
export const CHANNELS = Object.keys(CHANNEL_NAMES) as Channel[];

/** Each channel's switch on Settings > Notifications. */
export const CHANNEL_SWITCHES: Readonly<Record<Channel, string>> = {
  email: 'notifications.emailEnabled',
  pushover: 'notifications.pushoverEnabled',
  pushbullet: 'notifications.pushbulletEnabled',
  ntfy: 'notifications.ntfyEnabled',
  gotify: 'notifications.gotifyEnabled',
  discord: 'notifications.discordEnabled',
  telegram: 'notifications.telegramEnabled',
  slack: 'notifications.slackEnabled',
  webhook: 'notifications.webhookEnabled',
  apprise: 'notifications.appriseEnabled',
};

/** The channels switched on in a set of setting values, by name. */
export function channelsOn(values: Readonly<Record<string, unknown>>): string[] {
  return CHANNELS.filter((c) => values[CHANNEL_SWITCHES[c]] === true).map((c) => CHANNEL_NAMES[c]);
}

/** A message's importance on Pushover's scale, -2 (lowest) to 2 (emergency), which the per-kind settings use. */
export type Importance = -2 | -1 | 0 | 1 | 2;

const clampImportance = (value: number): Importance => Math.max(-2, Math.min(2, Math.round(value))) as Importance;

/** ntfy's priority (1 min to 5 urgent) for an importance. */
export const ntfyPriority = (importance: number) => clampImportance(importance) + 3;

/** Gotify's priority (0 to 10; its apps alert from 4 and up, loudly from 8) for an importance. */
export const gotifyPriority = (importance: number) => [0, 2, 5, 8, 10][clampImportance(importance) + 2]!;

/** Text cut to a service's limit, with "..." when it's longer. */
export function fit(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}

const json = { 'content-type': 'application/json' };
const trimSlash = (url: string) => url.trim().replace(/\/+$/, '');

/** Pushbullet: a note, or a link when there's an address to open (500 pushes a month on its free plan). */
export function pushbulletRequest(token: string, m: OutgoingMessage, link: string): ChannelRequest {
  const body = link ? { type: 'link', title: m.subject, body: m.short, url: link } : { type: 'note', title: m.subject, body: m.short };
  return { url: 'https://api.pushbullet.com/v2/pushes', headers: { ...json, 'Access-Token': token }, body: JSON.stringify(body) };
}

/** ntfy (ntfy.sh or a server of your own): JSON to the server's root names the topic; UTF-8 titles are fine that way. */
export function ntfyRequest(server: string, topic: string, token: string, m: OutgoingMessage, link: string, importance: number): ChannelRequest {
  return {
    url: `${trimSlash(server) || 'https://ntfy.sh'}/`,
    headers: { ...json, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ topic: topic.trim(), title: m.subject, message: fit(m.short, 4000), priority: ntfyPriority(importance), tags: ['video_game'], ...(link ? { click: link } : {}) }),
  };
}

/** Gotify (a server of your own): the application token in its header; a link opens when the message is tapped. */
export function gotifyRequest(server: string, token: string, m: OutgoingMessage, link: string, importance: number): ChannelRequest {
  return {
    url: `${trimSlash(server)}/message`,
    headers: { ...json, 'X-Gotify-Key': token },
    body: JSON.stringify({
      title: m.subject,
      message: m.short,
      priority: gotifyPriority(importance),
      ...(link ? { extras: { 'client::notification': { click: { url: link } } } } : {}),
    }),
  };
}

/** Discord: a channel's webhook; a message holds up to 2,000 characters. */
export function discordRequest(webhook: string, m: OutgoingMessage, link: string): ChannelRequest {
  const content = fit(`**${m.subject}**\n${m.short}${link ? `\n${link}` : ''}`, 2000);
  return { url: webhook.trim(), headers: json, body: JSON.stringify({ content, username: 'Squirrelcade', allowed_mentions: { parse: [] } }) };
}

/** Telegram: a bot's message to a chat, as plain text (up to 4,096 characters), without link previews. */
export function telegramRequest(token: string, chatId: string, m: OutgoingMessage, link: string): ChannelRequest {
  const text = fit(`${m.subject}\n\n${m.short}${link ? `\n\n${link}` : ''}`, 4096);
  return {
    url: `https://api.telegram.org/bot${token.trim()}/sendMessage`,
    headers: json,
    body: JSON.stringify({ chat_id: chatId.trim(), text, link_preview_options: { is_disabled: true } }),
  };
}

/** Slack: a channel's incoming webhook. */
export function slackRequest(webhook: string, m: OutgoingMessage, link: string): ChannelRequest {
  return { url: webhook.trim(), headers: json, body: JSON.stringify({ text: `*${m.subject}*\n${m.short}${link ? `\n${link}` : ''}` }) };
}

/** What Squirrelcade's own webhook sends, for n8n, Home Assistant, Node-RED or anything that takes JSON. */
export interface WebhookPayload {
  app: 'Squirrelcade';
  kind: MessageKind;
  /** -2 (lowest) to 2 (emergency), as Pushover counts. */
  importance: Importance;
  title: string;
  /** The short form, for a push or a chat message. */
  message: string;
  /** The full text and HTML, as in the email. */
  text: string;
  html: string;
  /** This Squirrelcade's page for it, when Settings > General has the address. */
  url: string | null;
  sentAt: string;
}

/** Squirrelcade's own webhook: the message as JSON, with an Authorization header when one is set. */
export function webhookRequest(url: string, authorization: string, m: OutgoingMessage, link: string, kind: MessageKind, importance: number, sentAt: string): ChannelRequest {
  const payload: WebhookPayload = { app: 'Squirrelcade', kind, importance: clampImportance(importance), title: m.subject, message: m.short, text: m.text, html: m.html, url: link || null, sentAt };
  return { url: url.trim(), headers: { ...json, ...(authorization ? { Authorization: authorization } : {}) }, body: JSON.stringify(payload) };
}

/** Apprise's API (a server of your own that passes messages on to 100+ services): its notify address for your setup. */
export function appriseRequest(url: string, m: OutgoingMessage, link: string, kind: MessageKind): ChannelRequest {
  const type = kind === 'problem' ? 'failure' : kind === 'waiting' ? 'warning' : 'info';
  return { url: url.trim(), headers: json, body: JSON.stringify({ title: m.subject, body: `${m.short}${link ? `\n${link}` : ''}`, type, format: 'text' }) };
}

/** A step of a setup guide: what to do, the page it's done on, and what to search for when the page has moved. */
export interface GuideStep {
  text: string;
  link?: { label: string; url: string };
  /** A web search that finds the step's page when the link stops working. */
  search?: string;
}

export interface SetupGuide {
  steps: GuideStep[];
  /** Something to know first (a limit, a service that stopped working this way). */
  note?: string;
  /** A warning: this way doesn't work any more. */
  warning?: string;
}

/** An email provider Squirrelcade can fill in: its mail server, and how to get the password apps sign in with. */
export interface MailProvider {
  id: string;
  name: string;
  host: string;
  /** 465 is TLS from the start, 587 STARTTLS. */
  port: number;
  /** Its IMAP (incoming mail) server and port, for collection updates from email (the same app password works). */
  imapHost: string;
  imapPort: number;
  guide: SetupGuide;
}

/** The email providers the settings page offers (the rest is "Another provider"), most used first. */
export const MAIL_PROVIDERS: readonly MailProvider[] = [
  {
    id: 'gmail',
    name: 'Gmail',
    host: 'smtp.gmail.com',
    port: 587,
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    guide: {
      steps: [
        { text: 'Turn on 2-Step Verification for your Google account: app passwords need it.', link: { label: 'Google Account › Security', url: 'https://myaccount.google.com/security' }, search: 'turn on Google 2-Step Verification' },
        { text: 'Make an app password (name it Squirrelcade) and copy the 16 letters.', link: { label: 'Google app passwords', url: 'https://myaccount.google.com/apppasswords' }, search: 'how to create a Gmail app password' },
        { text: 'Username: your full Gmail address. Password: the app password (spaces or not).' },
      ],
      note: 'Changing your Google password cancels your app passwords: make a new one then.',
    },
  },
  {
    id: 'yahoo',
    name: 'Yahoo Mail',
    host: 'smtp.mail.yahoo.com',
    port: 465,
    imapHost: 'imap.mail.yahoo.com',
    imapPort: 993,
    guide: {
      steps: [
        { text: 'Open your Yahoo account security page; under "External connections", create an app password (name it Squirrelcade).', link: { label: 'Yahoo account security', url: 'https://login.yahoo.com/account/security' }, search: 'how to generate a Yahoo Mail app password' },
        { text: 'Username: your full Yahoo address. Password: the app password.' },
      ],
    },
  },
  {
    id: 'icloud',
    name: 'iCloud Mail',
    host: 'smtp.mail.me.com',
    port: 587,
    imapHost: 'imap.mail.me.com',
    imapPort: 993,
    guide: {
      steps: [
        { text: 'Two-factor authentication must be on for your Apple Account (it is on most).' },
        { text: 'Sign in to your Apple Account, open Sign-In and Security › App-Specific Passwords, and make one (name it Squirrelcade).', link: { label: 'Apple Account', url: 'https://account.apple.com' }, search: 'how to create an Apple app-specific password' },
        { text: 'Username: your iCloud address (@icloud.com or @me.com). Password: the app-specific password.' },
      ],
      note: 'iCloud takes port 587 only.',
    },
  },
  {
    id: 'aol',
    name: 'AOL Mail',
    host: 'smtp.aol.com',
    port: 465,
    imapHost: 'imap.aol.com',
    imapPort: 993,
    guide: {
      steps: [
        { text: 'Open your AOL account security page and choose "Generate app password" (name it Squirrelcade).', link: { label: 'AOL account security', url: 'https://login.aol.com/account/security' }, search: 'how to generate an AOL Mail app password' },
        { text: 'Username: your full AOL address. Password: the app password.' },
      ],
    },
  },
  {
    id: 'zoho',
    name: 'Zoho Mail',
    host: 'smtp.zoho.com',
    port: 465,
    imapHost: 'imap.zoho.com',
    imapPort: 993,
    guide: {
      steps: [
        { text: 'With two-factor authentication on (the usual), make an app password in Zoho Accounts › Security › App Passwords (name it Squirrelcade). Without it, your account password works.', link: { label: 'Zoho app passwords', url: 'https://accounts.zoho.com/home#security/app_password' }, search: 'how to create a Zoho Mail app password' },
        { text: 'Username: your full Zoho address. Password: the app password.' },
      ],
      note: 'Accounts in Zoho\'s other regions use their own server: smtp.zoho.eu in Europe, smtp.zoho.in in India, smtp.zoho.com.au in Australia.',
    },
  },
  {
    id: 'fastmail',
    name: 'Fastmail',
    host: 'smtp.fastmail.com',
    port: 465,
    imapHost: 'imap.fastmail.com',
    imapPort: 993,
    guide: {
      steps: [
        { text: 'In Fastmail, Settings › Privacy & Security › "Manage app passwords and access": make a new app password with mail access (name it Squirrelcade).', link: { label: 'Fastmail security settings', url: 'https://app.fastmail.com/settings/security' }, search: 'how to create a Fastmail app password' },
        { text: 'Username: your full Fastmail address. Password: the app password.' },
      ],
    },
  },
  {
    id: 'gmx',
    name: 'GMX',
    host: 'mail.gmx.com',
    port: 587,
    imapHost: 'imap.gmx.com',
    imapPort: 993,
    guide: {
      steps: [
        { text: 'In GMX, Settings › POP3 & IMAP: allow access by other programs, and save. GMX turns this off again after a long time unused.', link: { label: 'GMX', url: 'https://www.gmx.com' }, search: 'GMX enable POP3 IMAP access' },
        { text: 'Username: your full GMX address. Password: your GMX password.' },
      ],
      note: 'Addresses at gmx.de and gmx.net use smtp.gmx.net instead.',
    },
  },
  {
    id: 'microsoft365',
    name: 'Microsoft 365 (work or school)',
    host: 'smtp.office365.com',
    port: 587,
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    guide: {
      steps: [
        { text: "Your organization's admin has to allow \"Authenticated SMTP\" for your mailbox; with multi-factor sign-in, use an app password if your admin allows those.", link: { label: 'Microsoft security info', url: 'https://mysignins.microsoft.com/security-info' }, search: 'Microsoft 365 authenticated SMTP app password' },
        { text: 'Username: your work or school address. Password: your password, or the app password.' },
      ],
      warning: 'Microsoft is ending password sign-in for sending mail: it turns off by default at the end of 2026 (admins can still turn it on for now). Another provider, or a push service below, will last longer.',
    },
  },
  {
    id: 'outlook',
    name: 'Outlook.com, Hotmail or Live',
    host: 'smtp-mail.outlook.com',
    port: 587,
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    guide: {
      steps: [{ text: 'Use another provider for Squirrelcade\'s messages (a free Gmail address works), or a push service below.', search: 'Outlook.com third-party apps basic authentication' }],
      warning:
        "Since September 2024 Microsoft doesn't let programs like Squirrelcade send mail from Outlook.com, Hotmail or Live addresses with a password (only apps that use Microsoft's own sign-in). Messages from here would be refused.",
    },
  },
];

/** The provider settings use for "Another provider": your own server's details. */
export const CUSTOM_MAIL_GUIDE: SetupGuide = {
  steps: [
    { text: "Your provider's help pages list its SMTP (outgoing) server, its port, and whether it needs an app password: search for \"<your provider> SMTP settings\".", search: 'SMTP settings for my email provider' },
    { text: 'Port 465 is encrypted from the start; 587 (the most common) upgrades with STARTTLS.' },
  ],
};

/** The setup steps of each push and chat service (email has its providers'). */
export const CHANNEL_GUIDES: Readonly<Partial<Record<Channel, SetupGuide>>> = {
  pushover: {
    steps: [
      { text: 'Get the Pushover app on your phone (a one-time purchase after a free trial) and sign in at pushover.net: your user key is on the first page.', link: { label: 'pushover.net', url: 'https://pushover.net' }, search: 'Pushover user key' },
      { text: 'Create an application (name it Squirrelcade) and copy its API token.', link: { label: 'Create a Pushover application', url: 'https://pushover.net/apps/build' }, search: 'Pushover create application API token' },
    ],
  },
  pushbullet: {
    steps: [
      { text: 'Get the Pushbullet app on your phone and sign in at pushbullet.com.', link: { label: 'pushbullet.com', url: 'https://www.pushbullet.com' } },
      { text: 'Settings › Account › "Create Access Token", and copy it.', link: { label: 'Pushbullet account settings', url: 'https://www.pushbullet.com/#settings/account' }, search: 'Pushbullet create access token' },
    ],
    note: 'Pushbullet\'s free plan sends up to 500 pushes a month: plenty for Squirrelcade.',
  },
  ntfy: {
    steps: [
      { text: 'Get the ntfy app (Android or iPhone), or use ntfy.sh in a browser.', link: { label: 'ntfy.sh', url: 'https://ntfy.sh' }, search: 'ntfy app' },
      { text: 'Pick a topic name nobody would guess (on ntfy.sh anyone who knows a topic can read it), such as squirrelcade-7f3k9q, and subscribe to it in the app.' },
      { text: 'Enter the topic here. On your own ntfy server, its address, and an access token if it asks for one.', link: { label: 'ntfy: publishing', url: 'https://docs.ntfy.sh/publish/' }, search: 'ntfy access token' },
    ],
  },
  gotify: {
    steps: [
      { text: 'Gotify is a server you run yourself (a Docker container), with an Android app.', link: { label: 'gotify.net', url: 'https://gotify.net' }, search: 'Gotify docker install' },
      { text: "In Gotify's web page, Apps › Create application (name it Squirrelcade), and copy its token.", link: { label: 'Gotify: pushing messages', url: 'https://gotify.net/docs/pushmsg' }, search: 'Gotify create application token' },
      { text: 'Enter your Gotify server\'s address and the token here.' },
    ],
  },
  discord: {
    steps: [
      { text: 'In Discord, open the settings of the channel the messages should go to: Integrations › Webhooks › New Webhook (name it Squirrelcade).', link: { label: 'Discord: webhooks', url: 'https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks' }, search: 'Discord create channel webhook' },
      { text: '"Copy Webhook URL", and paste it here.' },
    ],
  },
  telegram: {
    steps: [
      { text: 'In Telegram, message @BotFather: send /newbot, give it a name, and copy the token it gives you.', link: { label: 'Telegram: BotFather', url: 'https://t.me/BotFather' }, search: 'Telegram BotFather create bot token' },
      { text: 'Send your new bot any message ("hi"): a bot can only write to people who wrote to it first.' },
      { text: 'Enter the token, then "Find my chat" fills in your chat ID (it reads the message you sent). For a group, add the bot to the group and send a message there first.' },
    ],
  },
  slack: {
    steps: [
      { text: 'Create a Slack app for your workspace (from scratch, name it Squirrelcade), turn on "Incoming Webhooks", and "Add New Webhook to Workspace" for the channel.', link: { label: 'Slack: incoming webhooks', url: 'https://api.slack.com/messaging/webhooks' }, search: 'Slack create incoming webhook' },
      { text: 'Copy the webhook URL (it starts with https://hooks.slack.com/) and paste it here.' },
    ],
  },
  webhook: {
    steps: [
      { text: 'For n8n, Home Assistant, Node-RED or anything else that takes a web request: Squirrelcade sends each message as JSON (a POST) to the address you give.', link: { label: 'n8n: Webhook node', url: 'https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/' }, search: 'n8n webhook node' },
      { text: 'The JSON has app, kind (summary, waiting, problem or test), importance (-2 to 2), title, message (short), text and html (as in the email), url and sentAt.' },
      { text: 'If the receiver checks a header, give its value (such as "Bearer abc123"): it\'s sent as Authorization.' },
    ],
  },
  apprise: {
    steps: [
      { text: 'Apprise API is a server you run yourself (a Docker container) that passes messages on to more than 100 services: Signal, Matrix, Microsoft Teams, SMS and more.', link: { label: 'Apprise API', url: 'https://github.com/caronc/apprise-api' }, search: 'Apprise API docker' },
      { text: "Save your services in Apprise under a key (such as squirrelcade), and enter that key's notify address here, such as http://apprise:8000/notify/squirrelcade." },
    ],
  },
};

/** Where "search the web" links go (Settings > Interface > Web searches). */
export type SearchEngine = 'google' | 'duckduckgo' | 'bing' | 'startpage';

const SEARCHES: Record<SearchEngine, string> = {
  google: 'https://www.google.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
  bing: 'https://www.bing.com/search?q=',
  startpage: 'https://www.startpage.com/do/search?q=',
};

/** A web search's address. */
export function searchUrl(engine: string, query: string): string {
  return `${SEARCHES[engine as SearchEngine] ?? SEARCHES.google}${encodeURIComponent(query)}`;
}
