/**
 * The list of optional features and integrations (1.4.0, D219): what each adds, what it needs from outside, how long it
 * takes (with padding: a tester took ten times as long as expected), where it's set up and which light on System > Status
 * says whether it works. One list for the app (Settings > Features), the setup prompts and the docs, so they agree.
 * Each feature also has its own setup prompt, docs/ai/features/<id>.md, which the web app bundles.
 */

export interface FeatureEntry {
  /** The prompt's file name (docs/ai/features/<id>.md) and the entry's id. */
  id: string;
  name: string;
  /** What it adds, in one line. */
  adds: string;
  /** What it needs from outside Squirrelcade: "Nothing", or the accounts and tools. */
  needs: string;
  /** True when it needs an account on another site (the part that takes the longest). */
  account: boolean;
  /** An honest guess at the minutes, and the minutes to allow (padded generously). */
  minutes: number;
  padded: number;
  /** Where it's set up in Squirrelcade (a path, with the setting's anchor when there is one). */
  settings: string;
  /** The lights on System > Status that say whether it works (GET /api/v1/system/integrations, each line's key; one ending in a dash matches every line that starts with it). */
  lights: readonly string[];
}

/** The quick start (the setup prompt's first choice): install, the first visit and the collection in. */
export const QUICK_START = { minutes: 30, padded: 60 } as const;

/** In the order "Everything now" goes through them: the quick and free first, the ones with the most to set up later. */
export const FEATURE_LIST: readonly FeatureEntry[] = [
  { id: 'igdb', name: 'Covers and game details (IGDB)', adds: 'Box art, genres, series and release dates, and a better wishlist.', needs: 'A free Twitch account (for IGDB)', account: true, minutes: 10, padded: 25, settings: '/settings/sources#setting-features.igdb', lights: ['igdb'] },
  { id: 'notifications', name: 'Notifications', adds: 'A message after each collection update, and an alert when something fails: Pushover, email, ntfy, Discord, Telegram and more.', needs: 'A phone app or chat of your choice (ntfy is free and needs no account)', account: false, minutes: 10, padded: 25, settings: '/settings/notifications', lights: ['notifications'] },
  { id: 'mail', name: 'Email accounts', adds: "Your collection updated from PriceCharting's export emails, games you've bought on On the way, and deal emails.", needs: 'An email account, and an app password made at its provider', account: false, minutes: 10, padded: 25, settings: '/settings/email', lights: ['mailbox'] },
  { id: 'barcodes', name: 'Naming barcodes', adds: 'Store Mode names a barcode it has never seen.', needs: 'Nothing (a free UPC Database key is optional)', account: false, minutes: 5, padded: 10, settings: '/settings/sources#setting-sources.barcodeLookup', lights: ['barcodes'] },
  { id: 'backups', name: 'Backups to a second folder', adds: 'A copy of each backup on another disk or a synced folder, so one failure never takes everything.', needs: 'Another disk, a NAS share or a synced folder', account: false, minutes: 10, padded: 20, settings: '/settings/storage#setting-storage.backupCopyFolder', lights: ['backups'] },
  { id: 'youtube', name: 'YouTube videos', adds: "Videos on a game's page: Light needs nothing (each channel's newest uploads, IGDB's trailers); Deep adds whole channel lists and Find its videos.", needs: 'Light: nothing. Deep: a free YouTube key from Google', account: true, minutes: 10, padded: 25, settings: '/settings/roots#setting-roots.youtubeMode', lights: ['youtube'] },
  { id: 'gamefly', name: "GameFly's prices", adds: "GameFly's new and used prices beside the wishlist's games.", needs: 'Nothing', account: false, minutes: 2, padded: 5, settings: '/settings/sources#setting-sources.gamefly', lights: ['gamefly'] },
  { id: 'https', name: 'HTTPS and a public address', adds: "The phone's barcode camera, and Squirrelcade away from home (a secure address, with a gate in front).", needs: 'Tailscale (free), or a domain on Cloudflare, or a reverse proxy you already run', account: true, minutes: 20, padded: 45, settings: '/settings/general#setting-general.publicUrl', lights: ['https'] },
  { id: 'playnite', name: 'PC library (Playnite)', adds: 'Your PC games from every storefront, a PC wishlist and PC deals.', needs: 'Playnite on a Windows PC, and its backup folder shared to the server', account: false, minutes: 20, padded: 45, settings: '/settings/features#setting-features.pc', lights: ['playnite'] },
  { id: 'magazines', name: 'Magazines (Leaves)', adds: 'Your scanned game magazines: read, searched, and linked to their games.', needs: 'Magazine scans of your own (CBZ files) in a folder', account: false, minutes: 15, padded: 30, settings: '/settings/features#setting-features.magazines', lights: ['magazines'] },
  { id: 'romm', name: 'RomM links', adds: 'Play on RomM buttons on your games.', needs: 'A RomM server of your own, and an API token from it', account: false, minutes: 10, padded: 20, settings: '/settings/features#setting-features.romm', lights: ['romm'] },
  { id: 'retroachievements', name: 'RetroAchievements', adds: 'What you have beaten, completed and mastered on retro consoles.', needs: 'A free RetroAchievements account and its web API key', account: true, minutes: 5, padded: 15, settings: '/settings/features#setting-features.retroachievements', lights: ['retroachievements'] },
  { id: 'xbox', name: 'Xbox achievements', adds: 'How far you got in each Xbox game.', needs: 'A free OpenXBL account (sign in with your Microsoft account)', account: true, minutes: 5, padded: 15, settings: '/settings/features#setting-features.xbox', lights: ['xbox'] },
  { id: 'steam', name: 'Steam achievements', adds: 'Your achievements beside each Steam game in the PC library.', needs: 'The PC library, a free Steam Web API key, and public game details on your Steam profile', account: true, minutes: 10, padded: 25, settings: '/settings/features#setting-features.steam', lights: ['steam'] },
  { id: 'playstation', name: 'PlayStation trophies', adds: 'Your trophies and platinums on PS3, PS4, PS5 and Vita.', needs: 'A sign-in token copied from your browser (it lasts about two months)', account: true, minutes: 10, padded: 25, settings: '/settings/features#setting-features.playstation', lights: ['playstation'] },
  { id: 'pc-prices', name: 'PC game prices (IsThereAnyDeal, GG.deals)', adds: 'The best price now and the lowest ever of each game on the PC wishlist, and a message when one drops.', needs: 'The PC library, and free keys from IsThereAnyDeal and GG.deals', account: true, minutes: 15, padded: 35, settings: '/settings/features#setting-features.itad', lights: ['deals'] },
  { id: 'friends-live', name: "Friends' live links", adds: "Friends' collections that stay current by themselves: a folder of encrypted live files carried to the cloud, and a link each.", needs: 'A sync tool you already use (Google Drive for desktop, Synology Cloud Sync, rclone or Dropbox)', account: true, minutes: 15, padded: 30, settings: '/settings/friends#setting-friends.liveFolder', lights: ['friends-live-files', 'friend-link-'] },
  { id: 'claude', name: 'Claude and AI apps (the connector)', adds: 'Claude, or another AI app, answers "do I have this game?" from your collection.', needs: 'An AI app that speaks MCP (Claude Code, Claude Desktop, claude.ai)', account: false, minutes: 10, padded: 25, settings: '/settings/ai#setting-ai.enabled', lights: ['claude-keys'] },
  { id: 'ai-model', name: 'An AI model (Check a shelf, Talk)', adds: 'A vision model that reads more game spines from a shelf photo, and a Talk button on every page.', needs: "An AI service's API key (OpenAI, Gemini, Claude, OpenRouter), or a model at home", account: true, minutes: 10, padded: 25, settings: '/settings/features#setting-features.vision', lights: ['ai-model'] },
];

/** A feature's own prompt, on GitHub (the same text the app copies). */
export const featurePromptUrl = (id: string) => `https://github.com/squirrelcade/squirrelcade/blob/main/docs/ai/features/${id}.md`;

/** "about 10 minutes; give it 20" */
export function featureTime(f: Pick<FeatureEntry, 'minutes' | 'padded'>): string {
  return `about ${f.minutes} minutes; give it ${f.padded}`;
}

/** A long time in words: minutes under an hour and a half, else whole hours. */
export function longTime(minutes: number): string {
  return minutes < 90 ? `${minutes} minutes` : `${Math.round(minutes / 60)} hours`;
}

/** What "Everything now" takes in all: the quick start and every feature, as a guess and as the time to allow. */
export function everythingNowTotals(list: readonly FeatureEntry[] = FEATURE_LIST): { minutes: number; padded: number } {
  return {
    minutes: QUICK_START.minutes + list.reduce((sum, f) => sum + f.minutes, 0),
    padded: QUICK_START.padded + list.reduce((sum, f) => sum + f.padded, 0),
  };
}

/** The one sentence the setup prompts and the features page share about the total. */
export function everythingNowSentence(): string {
  const t = everythingNowTotals();
  return `about ${longTime(t.minutes)} if everything goes smoothly; give it ${longTime(t.padded)}, spread over several days`;
}

export type FeatureLight = 'green' | 'yellow' | 'red' | 'grey';

/** Whether a feature is set up now, from System > Status > Integrations' lines: the worst light among its lines, else off. */
export function featureLight(f: Pick<FeatureEntry, 'lights'>, lines: readonly { key: string; light: FeatureLight }[]): FeatureLight | null {
  const mine = lines.filter((l) => f.lights.some((k) => l.key === k || (k.endsWith('-') && l.key.startsWith(k))));
  if (mine.length === 0) return null;
  for (const light of ['red', 'yellow', 'green'] as const) if (mine.some((l) => l.light === light)) return light;
  return 'grey';
}
