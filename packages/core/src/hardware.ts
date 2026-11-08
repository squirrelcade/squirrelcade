/**
 * Hardware in a collection (T-217, D205): PriceCharting lists a console, a controller or an accessory like a game, on its
 * console ("Nintendo 64 Console" under Nintendo 64). Squirrelcade tells them apart by PriceCharting's names, so they
 * stay out of game counts, catalogs, Review and IGDB, and show as Your hardware; the owner can correct any of them.
 */

export type HardwareKind = 'console' | 'controller' | 'accessory';

/**
 * A console: "<the console> Console" or "<...> System", with a model or color after it ("Nintendo 64 Console Jungle
 * Green", "PlayStation 2 Slim Console", "Xbox 360 S Console 250GB"). Not a game with the word in its name ("System
 * Shock", "Catan: Console Edition", "Jet Set Radio: Future System"): the word is never first, and never before Edition.
 */
const CONSOLE = /^(?!(?:console|system)\b)[\w\s.:&'+-]{2,60}?\b(?:console|system)\b(?!\s*(?:edition|shock|crash|rush|failure|error|of|wars))(?:\s+[\w\s.()/-]{0,40})?$/i;

/** Words a console's own title has around Console or System, and a game's doesn't. */
const CONSOLE_HINT = /\b(console|system)\s*$|\b(console|system)\s+(?:\d+\s*(?:gb|tb)|slim|lite|mini|pro|oled|black|white|red|blue|green|grey|gray|silver|gold|purple|pink|yellow|orange|clear|crystal|limited|bundle|jungle|atomic|neon|special)\b|\b(slim|lite|mini|pro|oled|s|x|one)\s+(console|system)\b/i;

const CONTROLLER = /\b(controllers?|gamepad|joy-?cons?|joystick|dualshock|dualsense|wii remote|wiimote|nunchuc?k|arcade stick|fight ?stick|steering wheel|pro controller)\b/i;

const ACCESSORY =
  /\b(memory card|controller pak|rumble pak|expansion pak|transfer pak|ac adapter|power (?:supply|adapter|cord|cable)|av cables?|composite cables?|component cables?|hdmi cables?|link cable|multi-?tap|zapper|light gun|sensor bar|kinect sensor|playstation (?:camera|eye)|playstation move(?=\s*$|\s+(?:motion|navigation|controller|charging|starter|shooting|sharp|racing|pack|bundle|camera|eye))|charging (?:station|dock|stand|grip)|charge kit|headset|memory unit|rf (?:switch|adapter)|game boy player|super game boy|wii motion ?plus|play ?&? ?charge)\b/i;

/**
 * Games named after hardware (1.4.0, D217: a game read as an accessory was left out of its catalog, so the wishlist
 * suggested it to its owner): a title starting "Zapper:" (Zapper: One Wicked Cricket), and a game sold with a headset.
 */
const GAME_NAMED_AFTER_HARDWARE = /^zapper\s*:|\bheadset bundle\b|\bwith headset\b/i;

/** Whether a PriceCharting name is hardware, and which kind; null for a game. */
export function hardwareKind(title: string): HardwareKind | null {
  const t = title.trim();
  if (!t) return null;
  if (GAME_NAMED_AFTER_HARDWARE.test(t)) return null;
  if (ACCESSORY.test(t)) return 'accessory';
  if (CONTROLLER.test(t) && !/\b(game|edition)\b/i.test(t)) return 'controller';
  if (CONSOLE.test(t) && CONSOLE_HINT.test(t)) return 'console';
  return null;
}

/** How a kind of hardware reads ("Console", "Controller", "Accessory"). */
export const HARDWARE_LABELS: Record<HardwareKind, string> = { console: 'Console', controller: 'Controller', accessory: 'Accessory' };
