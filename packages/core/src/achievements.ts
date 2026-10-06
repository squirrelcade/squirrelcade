/**
 * Achievements from Xbox and PlayStation (0.24.0, D88): which of Squirrelcade's consoles a game on those services can
 * be, its title as a game's title, and when it counts as completed. The services are read on the server.
 */

/** The services whose achievements Squirrelcade reads besides RetroAchievements (Steam's are the PC library's, 0.28.0). */
export type AchievementSource = 'xbox' | 'playstation' | 'steam';
export const ACHIEVEMENT_SOURCES: Record<AchievementSource, string> = { xbox: 'Xbox', playstation: 'PlayStation', steam: 'Steam' };

/**
 * A Steam profile as the owner gives it: its address (steamcommunity.com/profiles/<id> or /id/<name>), its 17-digit
 * id, or its custom name alone. Null for nothing usable.
 */
export function parseSteamProfile(input: string): { id64: string } | { vanity: string } | null {
  // What's left without the site: "/profiles/7656...", "/id/name", or the id or name alone.
  const text = input
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^(www\.)?steamcommunity\.com/i, '')
    .replace(/\/+$/, '');
  const id = /^(?:\/profiles\/)?(7656\d{13})$/.exec(text);
  if (id) return { id64: id[1]! };
  const vanity = /^(?:\/id\/)?([A-Za-z0-9_-]{2,32})$/.exec(text);
  return vanity ? { vanity: vanity[1]! } : null;
}

/** Xbox's device names (a game's "devices" on Xbox Live) as Squirrelcade's consoles; PC, phones and the rest are left out. */
const XBOX_DEVICES: Record<string, string> = {
  xbox360: 'xbox-360',
  xboxone: 'xbox-one',
  xboxseries: 'xbox-series-x',
};

/** The consoles an Xbox game can be on, from its devices (a game played on several, Smart Delivery's, can be on each). */
export function xboxPlatformKeys(devices: readonly string[]): string[] {
  return [...new Set(devices.map((d) => XBOX_DEVICES[d.replace(/[^a-z0-9]/gi, '').toLowerCase()]).filter((k): k is string => Boolean(k)))];
}

/** PlayStation's platform names (a trophy list's "PS4", or "PS3,PSVITA" for one shared) as Squirrelcade's consoles. */
const PSN_PLATFORMS: Record<string, string> = {
  ps3: 'playstation-3',
  ps4: 'playstation-4',
  ps5: 'playstation-5',
  psvita: 'playstation-vita',
  vita: 'playstation-vita',
};

/** The consoles a PlayStation trophy list can be on ("PS4,PS5" is either); PC's lists are left out. */
export function psnPlatformKeys(platforms: string): string[] {
  return [...new Set(platforms.split(/[,/&\s]+/).map((p) => PSN_PLATFORMS[p.trim().toLowerCase()]).filter((k): k is string => Boolean(k)))];
}

/**
 * A game's title as Xbox or PlayStation writes it, as a game's title: without trademark signs, and without what the
 * service adds ("Trophies", "(PS4)", "PS4 & PS5", "for Xbox One", "Xbox Series X|S", a language in brackets).
 */
export function achievementTitle(name: string): string {
  return name
    .replace(/[™®©]/g, ' ')
    .replace(/\s+trophy set$|\s+trophies$/i, '')
    .replace(/\s*[([](?:ps3|ps4|ps5|ps vita|psvita|vita|ps4\s*&\s*ps5|xbox 360|xbox one|xbox series x\|s|windows|pc|english|chinese|korean|japanese|asia|asian)[)\]]\s*/gi, ' ')
    .replace(/\s+-?\s*(?:ps4\s*&\s*ps5|ps4 and ps5|ps5\s*&\s*ps4)$/i, '')
    .replace(/\s+-?\s*(?:for\s+)?(?:xbox one|xbox series x\|s|xbox series x|windows 10)(?:\s+edition)?$/i, '')
    .replace(/\s+([:,.!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** An Xbox game's progress as Xbox Live gives it in a player's title history (OpenXBL's /v2/achievements). */
export interface XboxTitleProgress {
  currentAchievements?: number;
  totalAchievements?: number;
  currentGamerscore?: number;
  totalGamerscore?: number;
  progressPercentage?: number;
}

/** Completed on Xbox: every achievement (all the gamerscore, as an Xbox 360 game counts it). */
export function xboxCompleted(a: XboxTitleProgress): boolean {
  if ((a.progressPercentage ?? 0) >= 100) return true;
  if ((a.totalGamerscore ?? 0) > 0 && (a.currentGamerscore ?? 0) >= (a.totalGamerscore ?? 0)) return true;
  return (a.totalAchievements ?? 0) > 0 && (a.currentAchievements ?? 0) >= (a.totalAchievements ?? 0);
}

/** A trophy list's counts by grade. */
export interface TrophyCounts {
  bronze?: number;
  silver?: number;
  gold?: number;
  platinum?: number;
}

/** Trophies in all: bronze, silver, gold and platinum. */
export const trophyCount = (t: TrophyCounts | undefined): number => (t?.bronze ?? 0) + (t?.silver ?? 0) + (t?.gold ?? 0) + (t?.platinum ?? 0);

/** Completed on PlayStation: its platinum trophy, or every trophy of a game without one. */
export function psnCompleted(defined: TrophyCounts | undefined, earned: TrophyCounts | undefined, progress: number): boolean {
  if ((earned?.platinum ?? 0) > 0) return true;
  return progress >= 100 || (trophyCount(defined) > 0 && trophyCount(earned) >= trophyCount(defined));
}
