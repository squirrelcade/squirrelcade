import { ActionIcon, Alert, Anchor, Button, Group, Loader, Select, Stack, Text } from '@mantine/core';
import { normalizeTitle } from '@squirrelcade/core';
import { IconChevronLeft, IconChevronRight, IconExternalLink } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { HelpLink } from '../components';
import { count, date, money, timeAgo, wholeMoney } from '../format';
import { useCanEdit, useSession, useSetting } from '../hooks';
import { GameTitle, useOpenGame } from '../GameDrawer';
import { GoalProgress } from '../Goal';
import { FAMILY_COLOR, FAMILY_NAME, platformColor, platformFamily } from '../look';
import { consoleOf, dealConsoles, dealOrder, isNewListing, offPercent, type DealOrder } from '../dealTools';
import { GameOfTheDayCard } from './GameOfTheDay';
import type { MissingCopy } from './Review';
import { SetupChecklist } from './system/SetupChecklist';
import { Acorns, Reviews, type ReviewsOf } from '../Acorn';

interface Deal {
  /** IGDB's rating, beside its acorns (0.53.0). */
  reviews?: ReviewsOf;
  id: string;
  date: string;
  title: string;
  console: string;
  priceCents: number | null;
  saveCents: number | null;
  listingTitle: string | null;
  listingUrl: string | null;
  platformKey: string | null;
  platform: string | null;
  gameTitle: string | null;
  wishlist: { score: number; priority: string; rank: number | null } | null;
}

interface Release {
  platformKey: string;
  platform: string;
  title: string;
  releaseDate: string;
  status: string;
  score: number | null;
  /** IGDB's rating, beside its acorns (0.53.0). */
  reviews?: ReviewsOf;
  preference: string | null;
}

interface HistoryGame {
  platformKey: string;
  platform: string;
  title: string;
  releaseDate: string;
  yearsAgo: number;
  /** Days from today's date to its date this year (-1 yesterday, 2 the day after tomorrow). */
  offset: number;
  status: string;
  rank: number | null;
  /** Its acorns, for a game you don't have (0.54.0). */
  score?: number | null;
  reviews?: ReviewsOf;
}

interface CompletionLine {
  kind: 'catalog' | 'top100' | 'set';
  key: string;
  name: string;
  owned: number;
  total: number;
  percent: number;
}

/** GET /api/v1/today. */
interface Today {
  date: string;
  gotd: unknown | null;
  deals: Deal[];
  dealsOn: boolean;
  releases: Release[];
  history: HistoryGame[];
  completion: { lines: CompletionLine[]; done: number };
  loans: { id: number; title: string; platform: string | null; lentTo: string; dueAt: string | null; overdue: boolean }[] | null;
  lastUpdate: { fileName: string; appliedAt: string | null; addedCount: number; removedCount: number; changedCount: number; ageDays: number | null } | null;
}

/** What Today reads of GET /api/v1/collection/statistics. */
interface Statistics {
  totals: { games: number; copies: number; valueCents: number };
  consoles: { label: string; count: number; key: string | null }[];
  added: { label: string; count: number }[];
}

interface Move {
  title: string;
  platform: string;
  platformKey: string | null;
  condition: string;
  nowCents: number;
  changeCents: number;
  percent: number;
}

interface ReviewQueue {
  lookAlikes: { platformKey: string; platform: string; entryId: number; title: string; suggestions: { productId: string; title: string; reason: string }[] }[];
}

/** One game's deals, cheapest first, and the biggest saving among them (in percent of the market value). */
interface DealGame {
  key: string;
  platformKey: string | null;
  title: string;
  platform: string;
  wishlist: Deal['wishlist'];
  reviews: ReviewsOf;
  listings: Deal[];
  best: number | null;
}

const DAY_MS = 86_400_000;
const noon = (day: string) => new Date(`${day}T12:00:00Z`);
const plusDays = (day: string, n: number) => new Date(noon(day).getTime() + n * DAY_MS).toISOString().slice(0, 10);
const weekday = (day: string, style: 'long' | 'short') => noon(day).toLocaleDateString('en-US', { weekday: style, timeZone: 'UTC' });
const monthDay = (day: string) => noon(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** The deals by game, in the order given (each game where its first deal is), each game's listings cheapest first. */
function dealGames(deals: Deal[]): DealGame[] {
  const games = new Map<string, DealGame>();
  for (const d of deals) {
    const title = d.gameTitle ?? d.title;
    const key = `${d.platformKey ?? d.console}|${title.toLowerCase()}`;
    const game = games.get(key) ?? { key, platformKey: d.platformKey, title, platform: d.platform ?? d.console, wishlist: d.wishlist, reviews: d.reviews ?? null, listings: [], best: null };
    game.listings.push(d);
    const off = offPercent(d);
    if (off !== null && (game.best === null || off > game.best)) game.best = off;
    games.set(key, game);
  }
  for (const g of games.values()) g.listings.sort((a, b) => (a.priceCents ?? Infinity) - (b.priceCents ?? Infinity));
  return [...games.values()];
}

/** Good morning, afternoon or evening, by the hour where the collection is (Settings > General > Time zone). */
function greeting(zone: string): string {
  let hour = new Date().getHours();
  try {
    hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: zone || undefined }).format(new Date()));
  } catch {
    // An unknown zone: the browser's own hour.
  }
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

/** "today", "yesterday", "tomorrow", else the day of the week (this week's) a past release's date falls on. */
function dayWord(today: string, offset: number): string {
  if (offset === 0) return 'today';
  if (offset === -1) return 'yesterday';
  if (offset === 1) return 'tomorrow';
  return weekday(plusDays(today, offset), 'long');
}

/**
 * Today (0.48.0, the redesign's start page): a greeting with what's waiting (deals, releases, questions); the game of
 * the day beside this week in game history; the week's releases on your consoles, day by day; deals against the
 * market value; a question only you can answer, right there; the last update; the collection's pulse (copies, the
 * goal, copies added each year, by console); the biggest price movers; the lists closest to done. Each part only when
 * it has something to say. While a new install has essential setup steps left, the owner sees them first.
 */
export function TodayPage() {
  const currency = useSetting('general.currency', 'USD');
  const dateFormat = useSetting('general.dateFormat', 'us');
  const zone = useSetting('general.timeZone', '');
  const reminderDays = useSetting('collection.exportReminderDays', 0);
  const canEdit = useCanEdit();
  const { data: session } = useSession();
  const today = useQuery({ queryKey: ['today'], queryFn: () => api<Today>('/today') });
  const queue = useQuery({ queryKey: ['catalogs', 'review'], queryFn: () => api<ReviewQueue>('/review'), enabled: canEdit });
  const gone = useQuery({ queryKey: ['collection', 'missing'], queryFn: () => api<MissingCopy[]>('/collection/missing'), enabled: canEdit });
  const toSend = useQuery({ queryKey: ['send', 'pricecharting'], queryFn: () => api<{ toSend: unknown[] }>('/send/pricecharting'), enabled: canEdit });
  const t = today.data;
  if (today.isPending) return <Loader />;
  if (!t) {
    return (
      <Alert color="red" title="Today couldn't load">
        {today.error instanceof Error ? today.error.message : 'The server did not answer.'} Try again in a moment; System &gt; Logs has the details.
      </Alert>
    );
  }
  const stale = t.lastUpdate?.ageDays !== null && t.lastUpdate?.ageDays !== undefined && t.lastUpdate.ageDays >= Math.max(reminderDays || 7, 1);
  const deals = t.dealsOn ? dealGames([...t.deals].sort(dealOrder('best'))) : [];
  const lookAlikes = queue.data?.lookAlikes ?? [];
  const missing = gone.data ?? [];
  const questions = canEdit ? lookAlikes.length + missing.length : 0;
  const name = session?.username;
  return (
    <Stack gap={24}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <div className="sc-pixel sc-muted" style={{ fontSize: 13 }}>
            {weekday(t.date, 'long')} · {date(t.date, dateFormat)}
          </div>
          <Group gap={8} wrap="nowrap" align="center">
            <h1 className="sc-hello">
              {greeting(zone)}
              {name ? `, ${name}` : ''}.
            </h1>
            <HelpLink topic="getting-started" />
          </Group>
        </div>
        {(deals.length > 0 || t.releases.length > 0 || questions > 0) && (
          <Group gap={8}>
            {deals.length > 0 && (
              <a className="sc-head-chip" href="#deals">
                <span className="sc-pixel">{count(deals.length)}</span>
                {deals.length === 1 ? 'deal' : 'deals'} below market
              </a>
            )}
            {t.releases.length > 0 && (
              <a className="sc-head-chip" href="#week">
                <span className="sc-pixel">{count(t.releases.length)}</span>
                out this week
              </a>
            )}
            {questions > 0 && (
              <Link className="sc-head-chip" data-tone="gold" to="/review">
                <span className="sc-pixel">{count(questions)}</span>
                {questions === 1 ? 'question' : 'questions'} for you
              </Link>
            )}
          </Group>
        )}
      </div>
      {canEdit && <SetupChecklist unfinishedOnly />}
      <div className="sc-row">
        <GameOfTheDayCard className="sc-wide" />
        <Movers currency={currency} dateFormat={dateFormat} className="sc-narrow" />
      </div>
      <WeekStrip today={t.date} releases={t.releases} />
      <div className="sc-row">
        {t.dealsOn && <Deals deals={t.deals} currency={currency} />}
        {t.history.length > 0 && <GameHistory today={t.date} games={t.history} />}
      </div>
      <div className="sc-row" style={{ alignItems: 'flex-start' }}>
        <Pulse currency={currency} />
        <div className="sc-narrow" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <Completion lines={t.completion.lines} done={t.completion.done} />
          <LastUpdate last={t.lastUpdate} stale={stale} toSend={toSend.data?.toSend.length ?? 0} canEdit={canEdit} />
          {t.loans && t.loans.length > 0 && <DueBack loans={t.loans} dateFormat={dateFormat} />}
        </div>
      </div>
    </Stack>
  );
}

/** This week in game history: the best known games out this week in earlier years, today's first. */
function GameHistory({ today, games }: { today: string; games: HistoryGame[] }) {
  return (
    <aside className="sc-card sc-pad sc-narrow" aria-labelledby="history-h">
      <h2 id="history-h" className="sc-h2">
        This week in game history
      </h2>
      <Text size="sm" className="sc-muted" mb={8}>
        Out this week, years ago
      </Text>
      <div className="sc-rows">
        {games.map((h) => (
          <div key={`${h.platformKey}|${h.title}`} style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: '10px 0' }}>
            <div style={{ flex: '0 0 56px', textAlign: 'center', padding: '6px 0', borderRadius: 8, background: 'var(--sc-raised)' }}>
              <div className="sc-pixel" style={{ fontSize: 15 }}>
                {h.releaseDate.slice(0, 4)}
              </div>
              <div className="sc-muted" style={{ fontSize: 11 }}>
                {monthDay(h.releaseDate)}
              </div>
            </div>
            <div style={{ flex: '1 1 auto', minWidth: 0 }}>
              <GameTitle platformKey={h.platformKey} title={h.title} fw={700} size="md" />
              <Text size="xs" className="sc-muted">
                {h.platform} · {count(h.yearsAgo)} {h.yearsAgo === 1 ? 'year' : 'years'} ago {dayWord(today, h.offset)}
              </Text>
              {(h.status === 'owned' || h.rank !== null || h.score != null || h.reviews) && (
                <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  {h.status === 'owned' ? (
                    <span className="sc-tag" data-tone="have" style={{ fontSize: 11 }}>
                      Have it
                    </span>
                  ) : (
                    (h.rank !== null || h.score != null) && (
                      <span className="sc-tag" data-tone="want" style={{ fontSize: 11 }} title={h.rank !== null ? `#${h.rank} on your wishlist` : undefined}>
                        {h.rank !== null ? `#${count(h.rank)}` : ''}
                        {h.rank !== null && h.score != null ? ' · ' : ''}
                        {h.score != null && <Acorns n={h.score} size={11} />}
                      </span>
                    )
                  )}
                  {h.reviews && (
                    <span className="sc-tag" style={{ fontSize: 11 }}>
                      <Reviews r={h.reviews} size={11} />
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

/** How many weeks ahead Out this week can look. */
const WEEKS_AHEAD = 12;

/** One game out on a day, on every console it comes out on that day. */
interface ReleaseTile {
  key: string;
  title: string;
  releases: Release[];
}

/** A day's releases by game: one tile however many consoles it comes out on, the most acorns first. */
function releaseTiles(releases: Release[]): ReleaseTile[] {
  const tiles = new Map<string, ReleaseTile>();
  for (const r of releases) {
    const key = `${r.releaseDate}|${normalizeTitle(r.title)}`;
    const tile = tiles.get(key) ?? { key, title: r.title, releases: [] };
    tile.releases.push(r);
    tiles.set(key, tile);
  }
  const best = (t: ReleaseTile) => Math.max(-1, ...t.releases.map((r) => r.score ?? -1));
  return [...tiles.values()].sort((a, b) => best(b) - best(a) || a.title.localeCompare(b.title));
}

/** A tile's edge in its consoles' makers' colors, stacked (one color for one maker). */
function edgeOf(t: ReleaseTile): string {
  const colors = [...new Set(t.releases.map((r) => FAMILY_COLOR[platformFamily(r.platformKey, r.platform)]))];
  if (colors.length === 1) return colors[0]!;
  const step = 100 / colors.length;
  return `linear-gradient(to bottom, ${colors.map((c, i) => `${c} ${Math.round(i * step)}% ${Math.round((i + 1) * step)}%`).join(', ')})`;
}

/**
 * Out this week: seven days side by side, each day's games on your consoles, a game out on several consoles once with
 * its makers' colors stacked on its edge (0.54.0); the arrows look at the weeks ahead. Where the whole week fits, they
 * sit on the calendar's two sides, where a click on the week itself turns it (the owner, 2026-10-06); where it doesn't
 * (a phone), beside the title.
 */
function WeekStrip({ today, releases }: { today: string; releases: Release[] }) {
  const open = useOpenGame();
  const [week, setWeek] = useState(0);
  const start = plusDays(today, week * 7);
  const end = plusDays(start, 6);
  // The weeks ahead come from Coming soon's list (this week's came with Today).
  const later = useQuery({ queryKey: ['catalogs', 'upcoming'], queryFn: () => api<Release[]>('/catalogs/upcoming'), enabled: week > 0, staleTime: 5 * 60_000 });
  const list = week === 0 ? releases : (later.data ?? []).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.releaseDate) && r.releaseDate >= start && r.releaseDate <= end);
  const days = Array.from({ length: 7 }, (_, i) => plusDays(start, i));
  const tiles = releaseTiles(list);
  const owned = tiles.filter((t) => t.releases.some((r) => r.status === 'owned')).length;
  const families = [...new Set(list.map((r) => platformFamily(r.platformKey, r.platform)))];
  const PER_DAY = 4;
  const loading = week > 0 && later.isPending;
  const before = () => setWeek((w) => Math.max(0, w - 1));
  const after = () => setWeek((w) => Math.min(WEEKS_AHEAD, w + 1));
  return (
    <section id="week" className="sc-card sc-pad sc-week-card" aria-labelledby="week-h">
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, marginBottom: 14 }}>
        <Group gap={10} wrap="nowrap" align="flex-start">
          <Group gap={4} wrap="nowrap" mt={2} className="sc-week-title-arrows">
            <ActionIcon variant="default" size="md" radius={8} aria-label="The week before" disabled={week === 0} onClick={before}>
              <IconChevronLeft size={16} />
            </ActionIcon>
            <ActionIcon variant="default" size="md" radius={8} aria-label="The week after" disabled={week >= WEEKS_AHEAD} onClick={after}>
              <IconChevronRight size={16} />
            </ActionIcon>
          </Group>
          <div>
            <h2 id="week-h" className="sc-h2">
              {week === 0 ? 'Out this week' : week === 1 ? 'Out next week' : `Out the week of ${monthDay(start)}`}
            </h2>
            <Text size="sm" className="sc-muted">
              {loading
                ? 'Looking ahead…'
                : tiles.length === 0
                  ? `Nothing comes out on your consoles ${week === 0 ? 'in the next 7 days' : `from ${monthDay(start)} to ${monthDay(end)}`}.`
                  : `${count(tiles.length)} ${tiles.length === 1 ? 'game' : 'games'} on your consoles${owned > 0 ? ` · ${count(owned)} already in your collection` : ''}`}
            </Text>
          </div>
        </Group>
        <Group gap={16} style={{ fontSize: 13 }}>
          {families.map((f) => (
            <span key={f} className="sc-soft" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span className="sc-dot" style={{ '--dot': FAMILY_COLOR[f] } as CSSProperties} />
              {FAMILY_NAME[f]}
            </span>
          ))}
          <Anchor component={Link} to="/wishlist/coming-soon" size="sm">
            Coming soon
          </Anchor>
        </Group>
      </div>
      <div className="sc-week-frame">
        <ActionIcon className="sc-week-side" variant="default" radius="xl" size={44} aria-label="The week before" disabled={week === 0} onClick={before}>
          <IconChevronLeft size={24} />
        </ActionIcon>
        <div style={{ overflowX: 'auto', flex: 1, minWidth: 0 }} tabIndex={0} role="region" aria-label="The week, day by day">
        <div className="sc-week">
          {days.map((d) => {
            const items = tiles.filter((t) => t.releases[0]!.releaseDate === d);
            return (
              <div key={d} className="sc-day" data-today={d === today}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span className="sc-pixel sc-muted" style={{ fontSize: 12 }}>
                    {weekday(d, 'short').toUpperCase()}
                  </span>
                  <span className="sc-day-num">{Number(d.slice(8))}</span>
                </div>
                {items.slice(0, PER_DAY).map((t) => {
                  const first = t.releases[0]!;
                  const score = Math.max(-1, ...t.releases.map((r) => r.score ?? -1));
                  const reviews = t.releases.find((r) => r.reviews)?.reviews ?? null;
                  const have = t.releases.some((r) => r.status === 'owned');
                  return (
                    <button key={t.key} type="button" className="sc-release" onClick={() => open(first.platformKey, first.title)}>
                      <span className="sc-release-edge" aria-hidden="true" style={{ background: edgeOf(t) }} />
                      <span style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.25 }}>{t.title}</span>
                      <span className="sc-muted" style={{ fontSize: 12 }}>
                        {t.releases.map((r) => r.platform).join(' · ')}
                      </span>
                      {(have || score >= 0 || reviews) && (
                        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {have && (
                            <span className="sc-tag" data-tone="have" style={{ fontSize: 11 }}>
                              Have it
                            </span>
                          )}
                          {score >= 0 && (
                            <span className="sc-tag" style={{ fontSize: 11 }}>
                              <Acorns n={score} size={11} />
                            </span>
                          )}
                          {reviews && (
                            <span className="sc-tag" style={{ fontSize: 11 }}>
                              <Reviews r={reviews} size={11} />
                            </span>
                          )}
                        </span>
                      )}
                    </button>
                  );
                })}
                {items.length > PER_DAY && (
                  <Anchor component={Link} to="/wishlist/coming-soon" size="xs">
                    {count(items.length - PER_DAY)} more
                  </Anchor>
                )}
                {items.length === 0 && (
                  <div className="sc-muted" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>
                    {loading ? '' : 'No releases'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        </div>
        <ActionIcon className="sc-week-side" variant="default" radius="xl" size={44} aria-label="The week after" disabled={week >= WEEKS_AHEAD} onClick={after}>
          <IconChevronRight size={24} />
        </ActionIcon>
      </div>
    </section>
  );
}

type DealFilter = 'all' | 'wish' | 'deep' | 'new';
const DEAL_FILTERS: [DealFilter, string][] = [
  ['all', 'All'],
  ['wish', 'Wishlist only'],
  ['deep', '25%+ off'],
  ['new', 'New or sealed'],
];

/**
 * Deals from PriceCharting's emails, by game: each listing's price against the market value. Best deals first (the
 * biggest saving against the market value) or the wishlist's first; one console or all of them; new or sealed only.
 */
function Deals({ deals, currency }: { deals: Deal[]; currency: string }) {
  const [filter, setFilter] = useState<DealFilter>('all');
  const [order, setOrder] = useState<DealOrder>('best');
  const [console, setConsole] = useState<string | null>(null);
  const consoles = dealConsoles(deals);
  const listings = deals.filter((d) => (!console || consoleOf(d) === console) && (filter !== 'new' || isNewListing(d))).sort(dealOrder(order));
  const games = dealGames(listings);
  const shown = games.filter((g) => filter === 'all' || filter === 'new' || (filter === 'wish' && g.wishlist?.rank) || (filter === 'deep' && (g.best ?? 0) >= 25)).slice(0, 3);
  return (
    <section id="deals" className="sc-card sc-pad sc-wide" aria-labelledby="deals-h" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h2 id="deals-h" className="sc-h2">
          Deals
        </h2>
        {deals.length > 0 && (
          <Group gap={8} wrap="wrap">
            <Select
              size="xs"
              w={190}
              placeholder="All consoles"
              aria-label="Console"
              data={consoles}
              value={console}
              onChange={setConsole}
              clearable
              comboboxProps={{ withinPortal: true }}
            />
            <div role="group" aria-label="Order" style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="sc-toggle" aria-pressed={order === 'best'} onClick={() => setOrder('best')}>
                Best deals
              </button>
              <button type="button" className="sc-toggle" aria-pressed={order === 'wishlist'} onClick={() => setOrder('wishlist')}>
                Wishlist first
              </button>
            </div>
          </Group>
        )}
      </div>
      {deals.length > 0 && (
        <div role="group" aria-label="Show deals" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {DEAL_FILTERS.map(([value, label]) => (
            <button key={value} type="button" className="sc-toggle" aria-pressed={filter === value} onClick={() => setFilter(value)}>
              {label}
            </button>
          ))}
        </div>
      )}
      {shown.map((g) => (
        <div key={g.key} style={{ border: '1px solid var(--sc-line)', borderRadius: 12, padding: 16, background: 'var(--sc-sunken)', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0 }}>
              <Group gap={8} wrap="wrap" align="center">
                {g.platformKey ? (
                  <GameTitle platformKey={g.platformKey} title={g.title} fw={800} size="md" />
                ) : (
                  <Text fw={800} size="md">
                    {g.title}
                  </Text>
                )}
                {g.wishlist && (
                  <span className="sc-tag" style={{ fontSize: 11 }}>
                    <Acorns n={g.wishlist.score} size={11} />
                  </span>
                )}
                {g.reviews && (
                  <span className="sc-tag" style={{ fontSize: 11 }}>
                    <Reviews r={g.reviews} size={11} />
                  </span>
                )}
              </Group>
              <Text size="sm" className="sc-muted">
                {[g.platform, g.wishlist?.rank ? `#${count(g.wishlist.rank)} on your wishlist` : null, `${count(g.listings.length)} ${g.listings.length === 1 ? 'listing' : 'listings'}`].filter(Boolean).join(' · ')}
              </Text>
            </div>
            {g.best !== null && (
              <span className="sc-pixel" style={{ flex: 'none', fontSize: 16, padding: '4px 10px', borderRadius: 6, background: 'var(--sc-have-bg)', color: 'var(--sc-have)' }}>
                −{g.best}%
              </span>
            )}
          </div>
          {g.listings.map((l) => {
            const market = l.priceCents !== null && l.saveCents ? l.priceCents + l.saveCents : null;
            return (
              <div key={l.id} style={{ display: 'grid', gridTemplateColumns: '84px minmax(0, 1fr) auto', gap: 14, alignItems: 'center' }}>
                <span style={{ fontFamily: 'Fredoka, sans-serif', fontWeight: 700, fontSize: 20 }}>{l.priceCents !== null ? money(l.priceCents, currency) : 'Listed'}</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
                  {market !== null && l.priceCents !== null && (
                    <span className="sc-meter" data-size="lg" role="img" aria-label={`${money(l.priceCents, currency)} against a market value of ${money(market, currency)}`}>
                      <span style={{ width: `${Math.round((l.priceCents / market) * 100)}%` }} />
                    </span>
                  )}
                  <span className="sc-muted" style={{ fontSize: 13 }}>
                    {[l.saveCents ? `${money(l.saveCents, currency)} below` : null, market !== null ? `market ${money(market, currency)}` : null, timeAgo(l.date)].filter(Boolean).join(' · ')}
                  </span>
                </div>
                {l.listingUrl ? (
                  <Anchor href={l.listingUrl} target="_blank" rel="noreferrer" fw={700} size="sm">
                    Listing <IconExternalLink size={12} />
                  </Anchor>
                ) : (
                  <span className="sc-muted" style={{ fontSize: 13 }}>
                    No link
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ))}
      {shown.length === 0 && (
        <div className="sc-muted" style={{ padding: 24, textAlign: 'center', border: '1px dashed var(--sc-line-strong)', borderRadius: 12 }}>
          {deals.length === 0 ? "No deals on games you don't have lately." : 'No deals match these choices right now.'}
        </div>
      )}
      <Anchor component={Link} to="/wishlist/deals" fw={700} size="sm" style={{ alignSelf: 'flex-start' }}>
        All deals
      </Anchor>
    </section>
  );
}

/** The collection's last update: its file, how old, what it changed; copies added here that PriceCharting doesn't have yet. */
function LastUpdate({ last, stale, toSend, canEdit }: { last: Today['lastUpdate']; stale: boolean; toSend: number; canEdit: boolean }) {
  // Without an export, the collection is the games added here (0.60.0).
  const summary = useQuery({ queryKey: ['collection', 'summary'], queryFn: () => api<{ totals: { copies: number } }>('/collection/summary') });
  const copies = summary.data?.totals.copies ?? 0;
  const age = last?.ageDays === null || last?.ageDays === undefined ? '' : last.ageDays === 0 ? ', an export from today' : `, ${count(last.ageDays)} ${last.ageDays === 1 ? 'day' : 'days'} old`;
  return (
    <section className="sc-card sc-pad" aria-labelledby="update-h" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h2 id="update-h" className="sc-h2">
        Last collection update
      </h2>
      {last ? (
        <>
          <Text className="sc-soft" style={{ overflowWrap: 'anywhere' }}>
            {last.fileName}
            {age}
          </Text>
          <Group gap={10}>
            <span className="sc-tag" data-size="lg" data-tone={last.addedCount > 0 ? 'have' : undefined}>
              +{count(last.addedCount)} added
            </span>
            <span className="sc-tag" data-size="lg">
              {count(last.removedCount)} removed
            </span>
            {last.changedCount > 0 && (
              <span className="sc-tag" data-size="lg">
                {count(last.changedCount)} changed
              </span>
            )}
          </Group>
        </>
      ) : (
        <Text size="sm" className="sc-muted">
          {copies > 0 ? 'No export yet: your collection is the games added here.' : 'No collection yet.'}
        </Text>
      )}
      {toSend > 0 && last && (
        <Text size="sm" className="sc-muted">
          {count(toSend)} {toSend === 1 ? 'copy' : 'copies'} added here {toSend === 1 ? 'waits' : 'wait'} to be sent to PriceCharting.
        </Text>
      )}
      {canEdit && (
        <Group gap="xs">
          {!last && (
            <Button component={Link} to="/collection/add" variant="default" radius={8}>
              Add a game
            </Button>
          )}
          <Button component={Link} to="/updates" variant="default" radius={8}>
            {last ? 'Update collection' : 'Upload an export'}
          </Button>
          {stale && (
            <Button component="a" href="https://www.pricecharting.com/my-collection" target="_blank" rel="noreferrer" variant="subtle" radius={8} rightSection={<IconExternalLink size={12} />}>
              Export on PriceCharting
            </Button>
          )}
        </Group>
      )}
    </section>
  );
}

/** Lent games overdue or due back within a week. */
function DueBack({ loans, dateFormat }: { loans: NonNullable<Today['loans']>; dateFormat: Parameters<typeof date>[1] }) {
  return (
    <section className="sc-card sc-pad" aria-labelledby="loans-h" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Group justify="space-between" align="baseline">
        <h2 id="loans-h" className="sc-h2">
          Due back
        </h2>
        <Anchor component={Link} to="/collection/loans" size="sm">
          Loans
        </Anchor>
      </Group>
      <div className="sc-rows">
        {loans.map((l) => (
          <Group key={l.id} justify="space-between" wrap="nowrap" gap="xs" py={8}>
            <div style={{ minWidth: 0 }}>
              <Text fw={700} size="sm">
                {l.title}
              </Text>
              <Text size="xs" className="sc-muted">
                {[l.platform, `with ${l.lentTo}`, l.dueAt ? `due ${date(l.dueAt, dateFormat)}` : null].filter(Boolean).join(' · ')}
              </Text>
            </div>
            {l.overdue && (
              <span className="sc-tag" data-tone="over">
                Overdue
              </span>
            )}
          </Group>
        ))}
      </div>
    </section>
  );
}

/** The collection's pulse: copies, games and worth; the goal; copies added each year; copies by console. */
function Pulse({ currency }: { currency: string }) {
  const stats = useQuery({ queryKey: ['collection', 'statistics'], queryFn: () => api<Statistics>('/collection/statistics'), retry: false });
  const s = stats.data;
  if (!s || s.totals.copies === 0) return null;
  // The last six years, this one last (so far), each with the copies added that year (none is a year too).
  const thisYear = new Date().getFullYear();
  const added = new Map(s.added.map((y) => [y.label, y.count]));
  const years = Array.from({ length: 6 }, (_, i) => String(thisYear - 5 + i)).map((label) => ({ label, count: added.get(label) ?? 0 }));
  const mostInAYear = Math.max(1, ...years.map((y) => y.count));
  const consoles = [...s.consoles].sort((a, b) => b.count - a.count).slice(0, 6);
  const mostOnAConsole = Math.max(1, ...consoles.map((c) => c.count));
  const columns = { display: 'grid', gridTemplateColumns: `repeat(${years.length}, minmax(0, 1fr))`, gap: 8 } as CSSProperties;
  return (
    <section className="sc-card sc-pad sc-wide" aria-labelledby="pulse-h" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <h2 id="pulse-h" className="sc-h2">
            Your collection
          </h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 10px', marginTop: 4 }}>
            <span style={{ fontFamily: 'Fredoka, sans-serif', fontWeight: 700, fontSize: 48, lineHeight: 1 }}>{count(s.totals.copies)}</span>
            <span className="sc-muted">
              copies · {count(s.totals.games)} unique games
              {s.totals.valueCents > 0 ? ` · worth ${wholeMoney(s.totals.valueCents, currency)}` : ''}
            </span>
          </div>
        </div>
        <GoalProgress line style={{ flex: '0 1 auto', minWidth: 0 }} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28 }}>
        {s.added.length > 0 && (
          <div style={{ flex: '1 1 280px', minWidth: 0 }}>
            <div className="sc-label" style={{ marginBottom: 8 }}>
              Copies added each year
            </div>
            <div role="img" aria-label={`Copies added each year: ${years.map((y) => `${y.label}, ${count(y.count)}`).join('; ')}`} style={{ ...columns, alignItems: 'end', height: 140, borderBottom: '1px solid var(--sc-line-strong)' }}>
              {years.map((y) => (
                <div key={y.label} title={`${y.label}: ${count(y.count)} copies`} style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 4 }}>
                  <span className="sc-soft" style={{ fontSize: 12, fontWeight: 700 }}>
                    {count(y.count)}
                  </span>
                  <div style={{ width: '100%', height: `${Math.round((y.count / mostInAYear) * 78)}%`, minHeight: 2, background: 'var(--sc-cade)', borderRadius: '4px 4px 0 0' }} />
                </div>
              ))}
            </div>
            <div className="sc-muted" style={{ ...columns, marginTop: 6, fontSize: 12, textAlign: 'center' }}>
              {years.map((y) => (
                <span key={y.label}>
                  {y.label}
                  {y.label === String(thisYear) && (
                    <>
                      <br />
                      so far
                    </>
                  )}
                </span>
              ))}
            </div>
          </div>
        )}
        {consoles.length > 0 && (
          <div style={{ flex: '1 1 280px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div className="sc-label" style={{ marginBottom: 1 }}>
              Copies by console{s.consoles.length > consoles.length ? ` · top ${consoles.length} of ${count(s.consoles.length)}` : ''}
            </div>
            {consoles.map((c) => (
              <div key={c.label} title={`${c.label}: ${count(c.count)} copies`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 120px) minmax(0, 1fr) 48px', gap: 10, alignItems: 'center', fontSize: 14 }}>
                <span className="sc-soft" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {c.label}
                </span>
                <span className="sc-meter" data-size="lg" aria-hidden="true">
                  <span style={{ width: `${Math.round((c.count / mostOnAConsole) * 100)}%`, '--fill': platformColor(c.key ?? '', c.label) } as CSSProperties} />
                </span>
                <span style={{ textAlign: 'right', fontWeight: 700 }}>{count(c.count)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** The copies whose value moved most since the update before the last: up to three up and two down. */
function Movers({ currency, dateFormat, className }: { currency: string; dateFormat: Parameters<typeof date>[1]; className?: string }) {
  const movers = useQuery({ queryKey: ['collection', 'movers'], queryFn: () => api<{ since: { date: string } | null; up: Move[]; down: Move[] }>('/collection/movers'), retry: false });
  const m = movers.data;
  if (!m?.since || m.up.length + m.down.length === 0) return null;
  const rows = [...m.up.slice(0, 3), ...m.down.slice(0, 2)];
  return (
    <section className={`sc-card sc-pad ${className ?? ''}`} aria-labelledby="movers-h" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Group justify="space-between" align="baseline" gap={10}>
        <h2 id="movers-h" className="sc-h2">
          Biggest movers
        </h2>
        <span className="sc-muted" style={{ fontSize: 13 }}>
          since {date(m.since.date, dateFormat)}
        </span>
      </Group>
      <div className="sc-rows">
        {rows.map((r) => (
          <div key={`${r.platform}|${r.title}|${r.condition}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' }}>
            <span className="sc-tag" data-tone={r.changeCents > 0 ? 'have' : 'over'} style={{ flex: 'none', width: 64, textAlign: 'center' }}>
              {r.changeCents > 0 ? '+' : '−'}
              {Math.abs(Math.round(r.percent))}%
            </span>
            <span style={{ flex: '1 1 auto', minWidth: 0 }}>
              {r.platformKey ? (
                <GameTitle platformKey={r.platformKey} title={r.title} fw={700} size="sm" />
              ) : (
                <Text fw={700} size="sm" truncate>
                  {r.title}
                </Text>
              )}
              <Text size="xs" className="sc-muted">
                {r.platform} · {r.condition}
              </Text>
            </span>
            <span style={{ fontWeight: 700 }}>{money(r.nowCents, currency)}</span>
          </div>
        ))}
      </div>
      <Anchor component={Link} to="/collection" size="sm" fw={700}>
        All price changes
      </Anchor>
    </section>
  );
}

/** The catalogs, Top 100 lists and sets closest to done. */
function Completion({ lines, done }: { lines: CompletionLine[]; done: number }) {
  if (lines.length === 0) return null;
  const to = (l: CompletionLine) => (l.kind === 'set' ? `/sets/${l.key}` : l.kind === 'top100' ? `/platforms/${l.key}?tab=top100` : `/platforms/${l.key}`);
  const name = (l: CompletionLine) => (l.kind === 'set' ? l.name : l.kind === 'top100' ? `${l.name} Top 100` : `${l.name} catalog`);
  return (
    <section className="sc-card sc-pad" aria-labelledby="completion-h" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Group justify="space-between" align="baseline">
        <h2 id="completion-h" className="sc-h2">
          Completion
        </h2>
        <Anchor component={Link} to="/platforms" size="sm">
          Platforms
        </Anchor>
      </Group>
      {lines.map((l) => (
        <Anchor key={`${l.kind}|${l.key}`} component={Link} to={to(l)} underline="never" c="inherit" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontWeight: 700, minWidth: 0 }}>{name(l)}</span>
            <span className="sc-muted" style={{ fontSize: 14, whiteSpace: 'nowrap' }}>
              {count(l.owned)} of {count(l.total)} · {l.percent}%
            </span>
          </span>
          <span className="sc-meter" aria-hidden="true">
            <span style={{ width: `${l.percent}%` }} />
          </span>
        </Anchor>
      ))}
      {done > 0 && (
        <Text size="xs" className="sc-muted">
          {count(done)} {done === 1 ? 'list is' : 'lists are'} done.
        </Text>
      )}
    </section>
  );
}
