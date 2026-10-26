/**
 * What an item bought is, from its name (D184): the purchases CSV and Claude's connector decide for themselves which
 * items are games (a sheet's own "Video game?" column is only a hint), which are consoles, and which are neither.
 */

/** A game bought as a code to redeem, not a disc or cartridge ("[Digital Code]", "Online Game Code", "- Digital"). */
export function isDigitalCode(item: string, seller = ''): boolean {
  return (
    /\[\s*(?:digital|online)(?:\s+(?:game\s+)?code)?\s*\]|\b(?:digital|online|download)\s+(?:game\s+)?code\b|\bdigital\s+download\b|[-–(]\s*digital\s*\)?\s*$|\bemailed\s+code\b/i.test(item) ||
    /\bdigital\s+(?:services|code|delivery)\b|\bcode\s+delivery\b/i.test(seller)
  );
}

/** A thing for a console that isn't a game: a controller, a cable, a case, a figure... */
export function isAccessory(item: string): boolean {
  return /\b(?:controllers?|gamepads?|joy-?cons?|cables?|chargers?|charging|adapters?|headsets?|headphones?|earbuds|stands?|docks?|docking|memory\s+cards?|micro\s?sd|sd\s+cards?|skins?|grips?|protectors?|screen\s+protector|carrying|cases?|pouch|batter(?:y|ies)|stylus|keyboards?|mouse|mice|thumb\s?sticks?|cleaning|cleaner|plush|figures?|figurines?|amiibo|strategy\s+guide|guide\s?book|poster|t-?shirt|hoodie|mug|keychain|gift\s+card|store\s+card|points\s+card|subscription|membership|capture\s+card|hard\s+drive|ssd|hdmi|power\s+supply|cooling\s+fan|wheel|pedals|steering|arcade\s+stick|fight\s?stick|light\s?gun|remote|sensor|camera|microphone|mic\b|steelbook\s+case)\b/i.test(item);
}

/** A console itself (with or without a game in its box): "PlayStation 2 Slim Console", "Nintendo Switch OLED Model". */
export function isConsoleHardware(item: string): boolean {
  return /\b(?:console|system|oled\s+model|handheld\s+gaming|gaming\s+handheld|hardware\s+bundle|console\s+bundle)\b/i.test(item);
}
