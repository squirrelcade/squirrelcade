import { normalizeTitle } from './text.js';

/**
 * Videos on a game's page (D165 phase 3): a YouTube address read, a game found in a channel's video titles, the kind
 * of video, and whether it's from the game's own time.
 */

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** A YouTube video's id from its address (watch, youtu.be, shorts, embed, live) or the id itself; null otherwise. */
export function youtubeVideoId(text: string): string | null {
  const t = text.trim();
  if (VIDEO_ID.test(t)) return t;
  let url: URL;
  try {
    url = new URL(t.startsWith('http') ? t : `https://${t}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0] ?? null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.searchParams.get('v') ?? url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/)?.[1] ?? null;
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

/** What a video is, from words in its title. */
export type VideoKind = 'review' | 'trailer' | 'preview' | 'history' | 'gameplay';

const KINDS: [VideoKind, RegExp][] = [
  ['review', /\b(review|reviewed|retrospective|quick look|impressions|verdict|tech review|analysis)\b/i],
  ['trailer', /\b(trailer|teaser|commercial|advert|tv spot)\b/i],
  ['preview', /\b(preview|first look|hands[- ]on|e3|demo)\b/i],
  ['history', /\b(history of|story of|the making of|making of|documentary|behind the scenes|oral history)\b/i],
  ['gameplay', /\b(gameplay|walkthrough|playthrough|let'?s play|speedrun|longplay)\b/i],
];

/** The kind of a video by its title's words, or null when its title says none. */
export function videoKind(title: string): VideoKind | null {
  for (const [kind, words] of KINDS) if (words.test(title)) return kind;
  return null;
}

/** The games' titles a channel's videos are matched against: each title's words, by its normalized form. */
export interface VideoTitleIndex {
  /** Normalized title → the title as the catalog has it. */
  titles: Map<string, string>;
  /** The most words a title has, so a video title's runs of words are only tried that long. */
  longest: number;
}

/** A title is too common to find in a video's title on its own when it's this short (a word like "Halo" still counts). */
const SHORTEST = 4;

export function videoTitleIndex(titles: Iterable<string>): VideoTitleIndex {
  const map = new Map<string, string>();
  let longest = 1;
  for (const title of titles) {
    const key = normalizeTitle(title);
    if (key.replace(/ /g, '').length < SHORTEST || map.has(key)) continue;
    map.set(key, title);
    longest = Math.max(longest, key.split(' ').length);
  }
  return { titles: map, longest };
}

/** A video title without its channel's tag at the end ("... Review - IGN", "... | GameSpot"). */
function withoutTag(title: string): string {
  return title.replace(/\s+[-|–—]\s+[^-|–—]{1,30}$/, '').trim();
}

/**
 * The game a video is about, by the longest run of words in its title that is a game's title (Squirrelcade's own
 * title rules: case, punctuation and "&" don't matter). Only a video whose title says what it is (a review, a trailer,
 * a preview, a history, gameplay) or is just the game's title is matched: a channel's other videos name games in
 * passing. Null when it names no game.
 */
export function gameInVideoTitle(videoTitle: string, index: VideoTitleIndex): string | null {
  const bare = withoutTag(videoTitle);
  const words = normalizeTitle(bare).split(' ').filter(Boolean);
  const whole = words.join(' ');
  if (index.titles.has(whole)) return index.titles.get(whole)!;
  if (!videoKind(videoTitle)) return null;
  let best: string | null = null;
  let bestLength = 0;
  for (let i = 0; i < words.length; i++) {
    for (let n = Math.min(index.longest, words.length - i); n >= 1; n--) {
      const run = words.slice(i, i + n).join(' ');
      if (run.length <= bestLength) break;
      const found = index.titles.get(run);
      if (found) {
        best = found;
        bestLength = run.length;
        break;
      }
    }
  }
  return best;
}

/**
 * Whether a video belongs to a game's At the time (published before it came out or within this many months of its
 * first release) or its Looking back; null when either date is unknown.
 */
export function videoEra(published: string | null, firstRelease: string | null, months: number): 'time' | 'later' | null {
  if (!published || !firstRelease) return null;
  const p = Date.parse(published.length === 4 ? `${published}-07-01` : published);
  const r = Date.parse(firstRelease.length === 4 ? `${firstRelease}-01-01` : firstRelease.length === 7 ? `${firstRelease}-01` : firstRelease);
  if (!Number.isFinite(p) || !Number.isFinite(r)) return null;
  // Previews and trailers before it came out count as its time too.
  return p > r + months * 30.44 * 86_400_000 ? 'later' : 'time';
}

/** The channel lines of Settings > Roots > Video channels: "Name | @handle or address | on or off | archive". */
export interface VideoChannel {
  name: string;
  /** "@IGN", a channel id ("UC..."), or a channel's address. */
  handle: string;
  on: boolean;
  /** An archive of its era (old commercials, TV shows): its videos are dated by what they show, so they're At the time. */
  archive: boolean;
}

export function parseVideoChannels(lines: readonly string[]): VideoChannel[] {
  const out: VideoChannel[] = [];
  for (const line of lines) {
    const [name, handle, state, kind] = line.split('|').map((p) => p.trim());
    if (!name || !handle) continue;
    out.push({ name, handle, on: (state ?? 'on').toLowerCase() !== 'off', archive: (kind ?? '').toLowerCase() === 'archive' });
  }
  return out;
}

/** A channel's handle, id or address as YouTube is asked for it: { id } for a channel id, else { handle } without its "@". */
export function channelRef(handle: string): { id: string } | { handle: string } | null {
  const t = handle.trim();
  const id = t.match(/(?:^|\/channel\/)(UC[A-Za-z0-9_-]{22})(?:$|[/?#])/)?.[1];
  if (id) return { id };
  const h = t.match(/(?:^|youtube\.com\/)@([A-Za-z0-9._-]{3,30})(?:$|[/?#])/)?.[1];
  return h ? { handle: h } : null;
}
