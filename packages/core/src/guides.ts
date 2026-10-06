import type { SetupGuide } from './notify.js';

/**
 * How to set up each service Squirrelcade reads from, step by step, every outside page linked (with a web search for
 * when a page moves). Shown folded under "Set it up" in the service's card on Settings > Sources (and the PC library's
 * on its page). The notification services' guides are CHANNEL_GUIDES, the email providers' MAIL_PROVIDERS.
 */
const guides = {
  igdb: {
    steps: [
      {
        text: 'Sign in to Twitch (IGDB is run by Twitch) and turn on two-factor sign-in: Twitch asks for it before you can register an application.',
        link: { label: 'Twitch security settings', url: 'https://www.twitch.tv/settings/security' },
        search: 'Twitch turn on two-factor authentication',
      },
      {
        text: 'Open the Twitch developer console and click Register Your Application.',
        link: { label: 'Twitch developer console', url: 'https://dev.twitch.tv/console/apps' },
        search: 'Twitch developer console register application',
      },
      { text: 'Name it Squirrelcade, set the OAuth Redirect URL to http://localhost, the Category to Application Integration and the Client Type to Confidential, then click Create.' },
      { text: 'Open the application (Manage): copy its Client ID into Client ID below, then click New Secret and copy the secret into Client secret.' },
      { text: 'Save, then Test: Squirrelcade fetches covers and details for your catalogs’ games.' },
    ],
    note: 'Free. RomM can use the same Client ID and secret.',
  },
  romm: {
    steps: [
      { text: 'Open your RomM and sign in as the user whose library Squirrelcade should see.' },
      {
        text: 'In RomM, open your profile, then API tokens, and make a new token named Squirrelcade with only the scopes roms.read and platforms.read (Squirrelcade only reads). Copy it.',
        link: { label: 'RomM documentation', url: 'https://docs.romm.app' },
        search: 'RomM client API token',
      },
      { text: 'Enter where Squirrelcade reaches RomM (an address on your own network is best, such as http://192.168.1.20:8080) and paste the token below.' },
      { text: 'Save, then Test: Squirrelcade lists the consoles RomM has.' },
    ],
  },
  itad: {
    steps: [
      { text: 'Sign in at IsThereAnyDeal, or make a free account.', link: { label: 'isthereanydeal.com', url: 'https://isthereanydeal.com' } },
      {
        text: 'Open My apps and register an app named Squirrelcade.',
        link: { label: 'IsThereAnyDeal: My apps', url: 'https://isthereanydeal.com/apps/my/' },
        search: 'IsThereAnyDeal register app API key',
      },
      { text: 'Copy the app’s API key into the box below and pick the country whose prices you want.' },
      { text: 'Save, then Test.' },
    ],
    note: 'Free. Squirrelcade asks only about your PC wishlist’s games, never your library.',
  },
  retroachievements: {
    steps: [
      { text: 'Sign in at RetroAchievements, or make a free account.', link: { label: 'retroachievements.org', url: 'https://retroachievements.org' } },
      {
        text: 'Open your settings and copy your Web API key (under Keys).',
        link: { label: 'RetroAchievements settings', url: 'https://retroachievements.org/settings' },
        search: 'RetroAchievements web API key',
      },
      { text: 'Enter your RetroAchievements username and the key below.' },
      { text: 'Save, then Test.' },
    ],
  },
  xbox: {
    steps: [
      { text: 'Sign in at OpenXBL with the Microsoft account you play with.', link: { label: 'xbl.io', url: 'https://xbl.io' } },
      { text: 'On your OpenXBL profile page, create an API key and copy it.', search: 'OpenXBL API key' },
      { text: 'Paste it below, then Save and Test.' },
    ],
    note: 'Microsoft has no public API for achievements; OpenXBL is a free go-between (150 requests an hour; Squirrelcade makes one a day).',
  },
  playstation: {
    steps: [
      { text: 'Sign in at playstation.com with the account you play with.', link: { label: 'playstation.com', url: 'https://www.playstation.com' } },
      {
        text: 'In the same browser, open Sony’s sign-in cookie page. It shows {"npsso":"..."}: copy the 64 characters between the quotes after npsso.',
        link: { label: 'Sony sign-in cookie (NPSSO)', url: 'https://ca.account.sony.com/api/v1/ssocookie' },
        search: 'PSN NPSSO token',
      },
      { text: 'Paste it below, then Save and Test.' },
    ],
    note: 'The token lasts about two months; Squirrelcade says when it needs a new one. Unofficial: it uses the PlayStation App’s own API, so it could stop working if Sony changes it.',
  },
  steam: {
    steps: [
      {
        text: 'Open Steam’s Web API key page, signed in to Steam. Domain name: squirrelcade.com (any name works). Agree to the terms and click Register once.',
        link: { label: 'Steam Web API key', url: 'https://steamcommunity.com/dev/apikey' },
        search: 'Steam Web API key register',
      },
      {
        text: 'Steam then waits for a confirmation from the Steam app on your phone, and may not pop anything up. In the Steam app, tap the three lines (☰) at the far right of the bottom bar, then Confirmations; tap the request, then Confirm. Don’t click Register again while you wait: repeated tries lock you out for a while.',
        search: 'Steam mobile app confirmations',
      },
      {
        text: 'Make your game details public, or Steam won’t share achievements: your profile, Edit Profile, Privacy Settings, Game details: Public.',
        link: { label: 'Steam privacy settings', url: 'https://steamcommunity.com/my/edit/settings' },
        search: 'Steam profile game details public',
      },
      { text: 'Enter the key and your Steam profile’s address below, then Save and Test.' },
    ],
  },
  ggdeals: {
    steps: [
      { text: 'Sign in at GG.deals, or make a free account.', link: { label: 'gg.deals', url: 'https://gg.deals' } },
      {
        text: 'Open the API page and get your API key (in your account settings).',
        link: { label: 'GG.deals API', url: 'https://gg.deals/api/' },
        search: 'GG.deals API key',
      },
      { text: 'Paste the key below, pick the region whose prices you want, and which prices come first. Then save: prices are read with the next PC prices check.' },
    ],
    note: 'Free for personal use. Squirrelcade credits GG.deals, with a link, wherever its prices show.',
  },
  barcodes: {
    steps: [
      { text: 'UPCitemdb needs nothing: about 100 lookups a day, free.', link: { label: 'upcitemdb.com', url: 'https://www.upcitemdb.com' } },
      {
        text: 'For UPC Database, make a free account and copy your API key from your account page (100 lookups a day).',
        link: { label: 'upcdatabase.org', url: 'https://upcdatabase.org' },
        search: 'upcdatabase.org API key',
      },
      { text: 'Pick which to ask below, paste UPC Database’s key if you use it, then Save.' },
    ],
  },
  pc: {
    steps: [
      {
        text: 'In Playnite: Settings › Backup, turn on automatic backups (weekly is enough) to a folder Squirrelcade can read, such as a share on your NAS.',
        link: { label: 'playnite.link', url: 'https://playnite.link' },
        search: 'Playnite automatic library backup',
      },
      { text: 'In Docker, mount that folder at /playnite; outside Docker, name it below.' },
      { text: 'Save: Squirrelcade reads the newest backup within a few minutes, read-only, and never changes it.' },
    ],
  },
} satisfies Record<string, SetupGuide>;

export type ServiceGuideId = keyof typeof guides;
export const SERVICE_GUIDES: Readonly<Record<ServiceGuideId, SetupGuide>> = guides;
