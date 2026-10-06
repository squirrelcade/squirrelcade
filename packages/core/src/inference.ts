import { normalizeTitle } from './text.js';

/**
 * Conservative genre, style and franchise guesses from well-known series names,
 * used only when a game has no curated details (the old system's WR-020). Every
 * guess is labeled as inferred; nothing about series completion, rarity or
 * personal interest is ever inferred.
 */

const has = (titleKey: string, phrase: string) => ` ${titleKey} `.includes(` ${phrase} `);

const GENRE_RULES: { genre: string; phrases: string[] }[] = [
  { genre: 'Party / minigame', phrases: ['mario party', 'warioware'] },
  { genre: 'Racing', phrases: ['mario kart', 'sonic racing', 'gran turismo', 'forza', 'need for speed', 'ridge racer', 'burnout', 'gear club', 'nascar', 'motogp', 'wrc', 'f1'] },
  { genre: 'Sports', phrases: ['madden', 'nba', 'nhl', 'mlb', 'fifa', 'ea sports fc', 'pga tour', 'college hoops', 'wwe', 'pro evolution soccer', 'efootball', 'tony hawk'] },
  { genre: 'Rhythm / music', phrases: ['just dance', 'guitar hero', 'rock band', 'taiko', 'hatsune miku', 'theatrhythm'] },
  { genre: 'Fighting', phrases: ['street fighter', 'mortal kombat', 'tekken', 'virtua fighter', 'king of fighters', 'soulcalibur', 'guilty gear', 'blazblue', 'smash bros'] },
  { genre: 'Metroidvania', phrases: ['metroid', 'castlevania', 'hollow knight', 'ori and the'] },
  { genre: 'Visual novel', phrases: ['ace attorney', 'danganronpa', 'steins gate', 'clannad'] },
  { genre: 'Puzzle', phrases: ['tetris', 'puyo', 'lumines', 'picross', 'professor layton'] },
  { genre: 'Arcade', phrases: ['pac man', 'galaga', 'space invaders', 'bubble bobble', 'r type'] },
  { genre: "Beat 'em up / hack-and-slash", phrases: ['dynasty warriors', 'samurai warriors', 'warriors orochi', 'streets of rage', 'river city'] },
  { genre: 'Horror', phrases: ['resident evil', 'silent hill', 'fatal frame', 'dead space', 'outlast', 'amnesia', 'little nightmares', 'until dawn'] },
  { genre: 'Shooter', phrases: ['call of duty', 'battlefield', 'doom', 'halo', 'gears of war', 'wolfenstein', 'borderlands', 'far cry'] },
  { genre: 'Strategy', phrases: ['civilization', 'xcom', 'advance wars', 'total war', 'command and conquer', 'age of empires'] },
  { genre: 'Simulation', phrases: ['the sims', 'farming simulator', 'snowrunner', 'simcity', 'cities skylines'] },
  {
    genre: 'RPG',
    phrases: [
      'final fantasy', 'dragon quest', 'xenoblade', 'disgaea', 'persona', 'shin megami', 'tales of', 'legend of heroes', 'trails in the sky', 'trails of cold steel',
      'trails into reverie', 'fire emblem', 'pokemon', 'star ocean', 'atelier', 'octopath', 'bravely default', 'etrian odyssey', 'suikoden', 'dragon age', 'mass effect',
      'fallout', 'elder scrolls', 'baldur s gate', 'neverwinter', 'pillars of eternity', 'divinity', 'kingdom hearts', 'monster hunter', 'like a dragon',
    ],
  },
  { genre: 'Platformer', phrases: ['super mario', 'mario bros', 'sonic', 'kirby', 'donkey kong', 'crash bandicoot', 'spyro', 'rayman', 'yooka laylee', 'littlebigplanet', 'mega man'] },
  { genre: 'Action-adventure', phrases: ['legend of zelda', 'assassin s creed', 'uncharted', 'tomb raider', 'god of war', 'spider man', 'batman arkham', 'indiana jones', 'horizon', 'metal gear'] },
];

const STYLE_RULES: Record<string, { style: string; phrases: string[] }[]> = {
  RPG: [
    { style: 'Western RPG', phrases: ['dragon age', 'mass effect', 'fallout', 'elder scrolls', 'baldur s gate', 'neverwinter', 'pillars of eternity', 'divinity'] },
    { style: 'Dungeon crawler', phrases: ['etrian odyssey'] },
    { style: 'Tactical / strategy RPG', phrases: ['fire emblem', 'disgaea'] },
    { style: 'Action RPG', phrases: ['kingdom hearts', 'monster hunter', 'ys'] },
    {
      style: 'JRPG',
      phrases: ['final fantasy', 'dragon quest', 'xenoblade', 'persona', 'shin megami', 'tales of', 'legend of heroes', 'trails in the sky', 'trails of cold steel', 'trails into reverie', 'pokemon', 'star ocean', 'atelier', 'octopath', 'bravely default', 'suikoden', 'like a dragon'],
    },
  ],
  Platformer: [
    { style: 'Traditional 2D platformer', phrases: ['super mario bros', 'sonic mania', 'mega man', 'donkey kong country', 'rayman legends', 'rayman origins'] },
    { style: 'Traditional 3D platformer', phrases: ['crash bandicoot', 'spyro', 'yooka laylee', 'littlebigplanet', 'super mario 3d', 'super mario odyssey'] },
  ],
  'Action-adventure': [
    { style: 'Open-world', phrases: ['assassin s creed', 'spider man', 'horizon'] },
    { style: 'Linear and story-driven', phrases: ['uncharted', 'god of war'] },
    { style: 'Exploration and puzzle-focused', phrases: ['tomb raider', 'legend of zelda'] },
    { style: 'Stealth-focused', phrases: ['metal gear'] },
  ],
};

const FRANCHISES = [
  'mario', 'zelda', 'donkey kong', 'kirby', 'metroid', 'pokemon', 'sonic', 'pac man', 'final fantasy', 'dragon quest', 'persona', 'shin megami', 'tales of',
  'resident evil', 'silent hill', 'castlevania', 'mega man', 'rayman', 'uncharted', 'god of war', 'assassin s creed', 'tomb raider', 'metal gear', 'spider man',
  'batman arkham', 'skylanders', 'disney infinity', 'wii fit', 'ben 10', 'the smurfs', 'lego dimensions', 'call of duty', 'battlefield', 'doom', 'halo', 'gears of war',
  'tony hawk', 'tetris',
];

// normalizeTitle drops apostrophes ("assassin's" -> "assassins"); the phrase lists
// use the old spelling with a space, so titles are compared in both forms.
function keys(title: string): string[] {
  const n = normalizeTitle(title);
  const spaced = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  return n === spaced ? [n] : [n, spaced];
}

/** A genre guessed from a well-known series name in the title, with the phrase that decided it; null when none applies. */
export function inferGenre(title: string): { genre: string; evidence: string } | null {
  for (const k of keys(title)) {
    for (const rule of GENRE_RULES) {
      const phrase = rule.phrases.find((p) => has(k, p));
      if (phrase) return { genre: rule.genre, evidence: phrase };
    }
  }
  return null;
}

/** A style within a genre (a JRPG, say) guessed from the title, with the phrase that decided it; null when none applies. */
export function inferStyle(title: string, genre: string): { style: string; evidence: string } | null {
  const rules = STYLE_RULES[genre];
  if (!rules) return null;
  for (const k of keys(title)) {
    for (const rule of rules) {
      const phrase = rule.phrases.find((p) => has(k, p));
      if (phrase) return { style: rule.style, evidence: phrase };
    }
  }
  return null;
}

/** The franchise a title belongs to, from a short list of big series; empty when it isn't one of them. */
export function inferFranchise(title: string): string {
  for (const k of keys(title)) {
    const f = FRANCHISES.find((p) => has(k, p));
    if (f) return f;
  }
  return '';
}
