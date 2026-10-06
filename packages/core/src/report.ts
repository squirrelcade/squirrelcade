/**
 * The update summary sent after a collection update, in the old system's
 * "additions-first" order: what was added, then the run summary, the top picks
 * and how the wishlist changed. Plain text and simple HTML that reads well on a phone.
 */

/** A wishlist entry as saved after each collection update, to compare the list between updates. */
export interface SnapshotEntry {
  key: string;
  title: string;
  platform: string;
  rank: number;
  score: number;
}

/** How the master list changed since the last snapshot: games that entered, games that left, and big movers. */
export interface WishlistChanges {
  entered: SnapshotEntry[];
  left: SnapshotEntry[];
  movers: { entry: SnapshotEntry; from: number }[];
}

/** Compares the master list with the last snapshot; nothing when there is no snapshot yet. */
export function wishlistChanges(previous: SnapshotEntry[] | null, current: SnapshotEntry[], moverPlaces = 25): WishlistChanges {
  if (!previous) return { entered: [], left: [], movers: [] };
  const before = new Map(previous.map((e) => [e.key, e]));
  const now = new Map(current.map((e) => [e.key, e]));
  return {
    entered: current.filter((e) => !before.has(e.key)),
    left: previous.filter((e) => !now.has(e.key)),
    movers: current
      .filter((e) => before.has(e.key) && Math.abs(before.get(e.key)!.rank - e.rank) >= moverPlaces)
      .map((e) => ({ entry: e, from: before.get(e.key)!.rank }))
      .sort((a, b) => Math.abs(b.from - b.entry.rank) - Math.abs(a.from - a.entry.rank))
      .slice(0, MAX_LISTED_MOVERS),
  };
}

/** What the update summary is made from. */
export interface ImportReportInput {
  instanceName: string;
  fileName: string;
  added: { title: string; consoleLabel: string; after: number }[];
  removed: { title: string; consoleLabel: string }[];
  changedCount: number;
  games: number;
  copies: number;
  top: SnapshotEntry[];
  changes: WishlistChanges;
  firstSnapshot: boolean;
  /** The first collection update: say how many games arrived instead of listing them all. */
  firstImport?: boolean;
  /** Owned games whose value moved most since the previous update. */
  priceMoves?: { up: PriceMoveLine[]; down: PriceMoveLine[] };
  /** Platforms this update made tracked (enough different games). */
  newlyTracked?: { name: string; games: number }[];
  /** Games marked as bought in Store Mode that this export still doesn't include. */
  waitingPurchases?: { title: string; platform: string }[];
  /** Games out soon on the consoles with a catalog (see Settings > Notifications), soonest first. */
  comingSoon?: { title: string; platform: string; releaseDate: string; owned: boolean }[];
  /** Currency for prices, such as USD. */
  currency?: string;
  url: string;
}

/** An owned game whose PriceCharting value moved, for the summary. */
export interface PriceMoveLine {
  title: string;
  platform: string;
  beforeCents: number;
  nowCents: number;
  percent: number;
}

/** A message ready to send: a subject, plain text, HTML, and a short version for push notifications. */
export interface Report {
  subject: string;
  text: string;
  html: string;
  /** One or two lines for a push notification. */
  short: string;
}

/** Longer lists of additions are cut short in messages; the Collection updates page has them all. */
export const MAX_LISTED_ADDITIONS = 100;
/** Only the biggest wishlist moves are listed. */
export const MAX_LISTED_MOVERS = 10;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/**
 * The update summary after a collection update (see the top of this file). The first update only
 * says how many games arrived; later ones list what was added and removed.
 */
export function importReport(r: ImportReportInput): Report {
  const subject = r.firstImport
    ? `${r.instanceName}: collection added`
    : r.added.length > 0
      ? `${r.instanceName}: ${plural(r.added.length, 'game')} added`
      : `${r.instanceName}: collection updated`;
  const lines: string[] = [];
  const html: string[] = ['<div style="font-family:system-ui,sans-serif;max-width:640px;line-height:1.4">'];

  lines.push('WHAT WAS ADDED TO THE COLLECTION');
  html.push('<div style="border:2px solid #2b7a4b;border-radius:8px;padding:12px;margin-bottom:16px">', '<h2 style="margin:0 0 8px">What was added to the collection</h2>');
  if (r.firstImport) {
    const first = `This was your first collection update: ${plural(r.games, 'game')} (${plural(r.copies, 'copy', 'copies')}) are now in Squirrelcade.`;
    lines.push(first);
    html.push(`<p style="margin:0">${esc(first)}</p>`);
  } else if (r.added.length === 0) {
    lines.push('No games were added in this update.');
    html.push('<p style="margin:0">No games were added in this update.</p>');
  } else {
    html.push('<ul style="margin:0;padding-left:20px">');
    for (const a of r.added.slice(0, MAX_LISTED_ADDITIONS)) {
      const copies = a.after > 1 ? ` (${a.after} copies)` : '';
      lines.push(`- ${a.title} (${a.consoleLabel})${copies}`);
      html.push(`<li>${esc(a.title)} <span style="color:#868e96">${esc(a.consoleLabel)}${copies}</span></li>`);
    }
    html.push('</ul>');
    if (r.added.length > MAX_LISTED_ADDITIONS) {
      const more = `...and ${r.added.length - MAX_LISTED_ADDITIONS} more. The Stash updates page lists them all.`;
      lines.push(more);
      html.push(`<p style="margin:8px 0 0">${esc(more)}</p>`);
    }
  }
  html.push('</div>');

  const summary = `${r.fileName}: ${r.games} games, ${r.copies} copies. ${plural(r.removed.length, 'game')} removed, ${plural(r.changedCount, 'copy count')} changed.`;
  lines.push('', 'SUMMARY', summary);
  html.push('<h3>Summary</h3>', `<p>${esc(summary)}</p>`);
  if (r.waitingPurchases && r.waitingPurchases.length > 0) {
    const waiting = `Marked as bought but not in this export yet (add them to PriceCharting): ${r.waitingPurchases.map((p) => `${p.title} (${p.platform})`).join(', ')}.`;
    lines.push(waiting);
    html.push(`<p>${esc(waiting)}</p>`);
  }
  if (!r.firstImport && r.newlyTracked && r.newlyTracked.length > 0) {
    const tracked = `Newly tracked: ${r.newlyTracked.map((p) => `${p.name} (${plural(p.games, 'game')})`).join(', ')}.`;
    lines.push(tracked);
    html.push(`<p>${esc(tracked)}</p>`);
  }
  if (r.removed.length > 0 && !r.firstImport) {
    const removed = r.removed.slice(0, MAX_LISTED_ADDITIONS);
    const more = r.removed.length > removed.length ? [`...and ${r.removed.length - removed.length} more.`] : [];
    lines.push('Removed:', ...removed.map((x) => `- ${x.title} (${x.consoleLabel})`), ...more);
    html.push('<p>Removed:</p><ul>', ...removed.map((x) => `<li>${esc(x.title)} <span style="color:#868e96">${esc(x.consoleLabel)}</span></li>`), '</ul>', ...more.map((m) => `<p>${m}</p>`));
  }

  const moves = r.priceMoves;
  if (!r.firstImport && moves && (moves.up.length > 0 || moves.down.length > 0)) {
    const currency = r.currency ?? 'USD';
    const money = (cents: number) =>
      new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: currency === 'JPY' ? 0 : 2 }).format(currency === 'JPY' ? cents : cents / 100);
    const line = (m: PriceMoveLine) => `${m.title} (${m.platform}): ${money(m.beforeCents)} → ${money(m.nowCents)} (${m.percent > 0 ? '+' : ''}${m.percent}%)`;
    const all = [...moves.up, ...moves.down];
    lines.push('', 'PRICE MOVES', ...all.map((m) => `- ${line(m)}`));
    html.push('<h3>Price moves</h3><ul>', ...all.map((m) => `<li>${esc(line(m))}</li>`), '</ul>');
  }

  if (r.comingSoon && r.comingSoon.length > 0) {
    const line = (g: { title: string; platform: string; releaseDate: string; owned: boolean }) => `${g.releaseDate}: ${g.title} (${g.platform})${g.owned ? ', you have it' : ''}`;
    lines.push('', 'COMING SOON', ...r.comingSoon.map((g) => `- ${line(g)}`));
    html.push('<h3>Coming soon</h3><ul>', ...r.comingSoon.map((g) => `<li>${esc(line(g))}</li>`), '</ul>');
  }

  if (r.top.length > 0) {
    lines.push('', 'TOP PICKS');
    html.push('<h3>Top picks</h3><ol>');
    for (const t of r.top) {
      lines.push(`${t.rank}. ${t.title} (${t.platform}), score ${t.score}`);
      html.push(`<li>${esc(t.title)} <span style="color:#868e96">${esc(t.platform)}, score ${t.score}</span></li>`);
    }
    html.push('</ol>');
  }

  const c = r.changes;
  if (!r.firstSnapshot && (c.entered.length || c.left.length || c.movers.length)) {
    lines.push('', 'WISHLIST CHANGES');
    html.push('<h3>Wishlist changes</h3>');
    const section = (title: string, items: string[]) => {
      if (items.length === 0) return;
      lines.push(`${title}:`, ...items.map((i) => `- ${i}`));
      html.push(`<p>${esc(title)}:</p><ul>`, ...items.map((i) => `<li>${esc(i)}</li>`), '</ul>');
    };
    section('New', c.entered.map((e) => `#${e.rank} ${e.title} (${e.platform})`));
    section('Gone', c.left.map((e) => `${e.title} (${e.platform}), was #${e.rank}`));
    section('Big moves', c.movers.map((m) => `${m.entry.title} (${m.entry.platform}): #${m.from} → #${m.entry.rank}`));
  } else if (r.firstSnapshot) {
    lines.push('', 'Wishlist changes will be listed from the next update on.');
  }

  if (r.url) {
    lines.push('', `Open Squirrelcade: ${r.url}`);
    html.push(`<p><a href="${esc(r.url)}">Open Squirrelcade</a></p>`);
  }
  html.push('</div>');

  const lead = r.firstImport
    ? `Collection added: ${plural(r.games, 'game')}.`
    : r.added.length > 0
      ? `Added: ${r.added.slice(0, 3).map((a) => a.title).join(', ')}${r.added.length > 3 ? ` and ${r.added.length - 3} more` : ''}.`
      : 'No games added.';
  const short = lead + (r.top[0] ? ` Top pick: ${r.top[0].title} (${r.top[0].platform}).` : '');
  return { subject, text: lines.join('\n'), html: html.join('\n'), short };
}

/** A game you don't have yet that's coming out, for a release reminder. */
export interface ReleaseLine {
  title: string;
  platform: string;
  /** YYYY-MM-DD */
  releaseDate: string;
  /** Its wishlist score, when it's on the wishlist. */
  score: number | null;
  /** A Nintendo Switch 2 Game-Key Card (the cartridge holds only a key to download the game). */
  keyCard: boolean;
}

/**
 * The release reminder: games you don't have yet that come out today or in the next few days on the consoles
 * you collect, the soonest first and then the highest wishlist score.
 */
export function releaseReminder(r: { instanceName: string; today: string; games: ReleaseLine[]; url: string }): Report {
  const games = [...r.games].sort((a, b) => a.releaseDate.localeCompare(b.releaseDate) || (b.score ?? -1) - (a.score ?? -1) || a.title.localeCompare(b.title));
  const allToday = games.every((g) => g.releaseDate === r.today);
  const subject =
    games.length === 1
      ? `${r.instanceName}: ${games[0]!.title} is out ${games[0]!.releaseDate === r.today ? 'today' : `on ${games[0]!.releaseDate}`}`
      : `${r.instanceName}: ${plural(games.length, 'game')} ${allToday ? 'out today' : 'coming out'}`;
  const line = (g: ReleaseLine) =>
    `${g.releaseDate === r.today ? 'Today' : g.releaseDate}: ${g.title} (${g.platform})${g.keyCard ? ', Game-Key Card' : ''}${g.score !== null ? `, wishlist ${g.score}` : ''}`;
  const intro = "Coming out on the consoles you collect, and you don't have them yet:";
  const text = [intro, '', ...games.map((g) => `- ${line(g)}`), ...(r.url ? ['', `Coming soon in Squirrelcade: ${r.url}`] : [])].join('\n');
  const html = [
    `<p>${esc(intro)}</p><ul>`,
    ...games.map((g) => `<li>${esc(line(g))}</li>`),
    '</ul>',
    ...(r.url ? [`<p><a href="${esc(r.url)}">Coming soon in Squirrelcade</a></p>`] : []),
  ].join('');
  const short = games.map((g) => `${g.releaseDate === r.today ? 'Today' : g.releaseDate}: ${g.title} (${g.platform})`).join('\n');
  return { subject, text, html, short };
}
