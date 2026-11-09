import { matchTokens } from './text.js';

/**
 * A way to play a game the owner doesn't have on its own console (1.5.1, the owner: "I actually do own a way to play
 * Mega Man 2, because it appears in a Mega Man collection"): a collection that contains it, a remaster or a remake of it,
 * owned on a console or on PC.
 */
export interface WayToPlay {
  kind: 'collection' | 'remaster' | 'remake';
  /** The collection's or the remaster's name. */
  title: string;
  /** Where the owner has it: console names, and "PC (Steam)" and the like. */
  on: string[];
}

/** Words that name a package rather than its games: a box's name may add them or leave them out. */
const PACKAGE_WORDS = new Set(['collection', 'bundle', 'pack', 'combo', 'set', 'edition', 'remaster', 'remastered', 'pixel', 'hd', 'and', 'the']);

/**
 * Whether a copy's name is a collection or remaster known by one of these names, for linking the owner's copies to
 * IGDB's collections: every word of the name (other than package words) is in the copy's, the copy adds only package
 * words, and their numbers agree. So "Final Fantasy I-VI Collection Pixel Remaster" is IGDB's "Final Fantasy I-VI
 * Bundle", while "Mega Man X Legacy Collection" isn't "Mega Man Legacy Collection" (an X more) nor is "Mega Man Legacy
 * Collection 2" (another number).
 */
export function collectionNameMatches(copy: string, names: readonly string[]): boolean {
  const own = matchTokens(copy);
  const ownNumbers = own.filter((t) => /^\d+$/.test(t)).sort().join(',');
  const ownWords = new Set(own.filter((t) => !/^\d+$/.test(t)));
  return names.some((name) => {
    const theirs = matchTokens(name);
    if (theirs.filter((t) => /^\d+$/.test(t)).sort().join(',') !== ownNumbers) return false;
    const words = new Set(theirs.filter((t) => !/^\d+$/.test(t)));
    const core = [...words].filter((w) => !PACKAGE_WORDS.has(w));
    if (core.length < 2 || !core.every((w) => ownWords.has(w))) return false;
    return [...ownWords].every((w) => words.has(w) || PACKAGE_WORDS.has(w));
  });
}

/** "You can play it in Mega Man Legacy Collection 1 + 2 (Nintendo Switch) and in Mega Man Legacy Collection (PC: Steam)." */
export function waysToPlayText(ways: readonly WayToPlay[]): string {
  const part = (w: WayToPlay) => `${w.kind === 'collection' ? 'in' : w.kind === 'remaster' ? 'as the remaster' : 'as the remake'} ${w.title} (${w.on.join(', ')})`;
  return `You can play it ${ways.map(part).join(' and ')}`;
}
