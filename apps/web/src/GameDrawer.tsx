import { DrawerHistory, type HistoryText } from './pages/History';
import { COMPLETENESS_LABELS, priceChartingUrl, shopLinksFor, shopUrl, type Completeness, type SettingsValues, type ShopLink, SHOPS_IN_LISTS } from '@squirrelcade/core';
import { Anchor, Badge, Box, Button, Divider, Drawer, Group, Loader, Menu, Spoiler, Stack, Table, Text, Textarea, Tooltip } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconCheck, IconClock, IconNotes, IconPlus, IconShoppingCart, IconX } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from './api';
import { MATCH_METHODS, monthsFromNow, REJECTABLE, SNOOZES, type MatchMethod } from './choices';
import { Cover } from './components';
import { SellHelper } from './SellHelper';
import { AddCopyModal, CopyDetailLine, CopyDetailsModal, TestBadge, type CopyDetail, type CopyRef, type CopyTest, type Loan, type PhotoInfo } from './CopyDetails';
import { PlayPicker, type Play } from './Playing';
import { count, date, money, releaseDate } from './format';
import { overGoalNote } from './Goal';
import { notifyError, notifySuccess, useCanEdit, useSetting } from './hooks';
import { NOTE_MAX, useGameNotes } from './notes';
import { PreferencePicker } from './Preference';
import { RegionBadge } from './Region';
import { RommLinks, type RommLink } from './Romm';
import { Acorns, Reviews } from './Acorn';

/** One game on one console (GET /api/v1/game). */
interface GameView {
  platformKey: string;
  platform: string;
  title: string;
  coverId: string | null;
  igdb: { name: string; genres: string[]; franchise: string | null; released: string | null; rating: number | null; ratingCount: number | null; gameType: string | null } | null;
  catalog: {
    entryId: number;
    title: string;
    status: string;
    targetStatus: string;
    yourChoice: boolean;
    releaseDate: string | null;
    format: string | null;
    source: string;
    notes: string | null;
    matches: { productId: string; title: string; method: MatchMethod }[];
    suggestions: { productId: string; title: string; reason: string }[];
    purchase: { id: number; createdAt: string } | null;
  } | null;
  copies: {
    productId: string;
    title: string;
    consoleLabel: string;
    region: string;
    completeness: string;
    quantity: number;
    valueCents: number | null;
    costCents: number | null;
    dateEntered: string | null;
    countsAs: MatchMethod | null;
    includeString: string;
    history: { date: string; cents: number }[];
    copyKey: string;
    id: number;
    datePurchased: string | null;
    notes: string;
    /** When a copy of Squirrelcade's own went into the list for PriceCharting's importer (null: not yet). */
    sentAt: string | null;
    /** Whose files keep it up to date: PriceCharting's export, a spreadsheet, or none (Squirrelcade's own). */
    source: 'pricecharting' | 'spreadsheet' | 'squirrelcade';
    /** Since when its file no longer has it (it waits on Review). */
    missingSince: string | null;
    /** Where it's kept, tags, for sale (null when copies' details aren't shown to this viewer). */
    details: CopyDetail | null;
    loans: Loan[];
    photos: PhotoInfo[];
    /** Its standard photos (Settings > Collection), its tests (the newest first), and the owner's estimate of its price. */
    slots: string[];
    tests: CopyTest[];
    estimatedCents: number | null;
  }[];
  /** What the owner played of it (null when it isn't shown to this viewer). */
  play: Play | null;
  ownedOn: string[];
  pc: { storefront: string; ownership: string; playtimeHours: number }[];
  sets: { key: string; name: string }[];
  wishlist: { score: number; rank: number | null; priority: string; components: { label: string; points: number }[] } | null;
  preference: string | null;
  wishlistNote: string | null;
  snoozedUntil: string | null;
  romm: RommLink | null;
  note: { text: string; updatedAt: string } | null;
  /** Why the game matters and its Top 100 rank on the console (null with Top 100 lists and history off). */
  history: { why: HistoryText | null; top100: { rank: number; of: number } | null } | null;
  /** Your RetroAchievements progress on it (with RetroAchievements on). */
  retroAchievements: RaGame | null;
  /** Your progress on it on Xbox and PlayStation (with those parts on). */
  achievements: AchievementView[];
}

/** A game's progress on Xbox or PlayStation (GET /api/v1/game). */
interface AchievementView {
  source: 'xbox' | 'playstation';
  earned: number;
  total: number;
  pointsEarned: number | null;
  pointsTotal: number | null;
  progress: number;
  platinum: boolean | null;
  completed: boolean;
  lastPlayedAt: string | null;
}

/** "Xbox: 20 of 50 achievements · 400 of 1,000 gamerscore · 40%", or "PlayStation: Platinum · 48 of 48 trophies · 100%". */
function AchievementLine({ a, dateFormat }: { a: AchievementView; dateFormat: SettingsValues['general.dateFormat'] }) {
  const things = a.source === 'xbox' ? 'achievements' : 'trophies';
  const parts = [
    a.platinum ? 'Platinum' : a.completed ? 'Completed' : null,
    a.total > 0 ? `${count(a.earned)} of ${count(a.total)} ${things}` : `${count(a.earned)} ${a.earned === 1 ? things.slice(0, -1).replace(/ie$/, 'y') : things}`,
    a.pointsTotal ? `${count(a.pointsEarned ?? 0)} of ${count(a.pointsTotal)} gamerscore` : null,
    a.completed ? null : `${a.progress}%`,
    a.lastPlayedAt ? `${a.source === 'xbox' ? 'last played' : 'last trophy'} ${date(a.lastPlayedAt, dateFormat)}` : null,
  ].filter(Boolean);
  return (
    <Text size="sm">
      {a.source === 'xbox' ? 'Xbox' : 'PlayStation'}: {parts.join(' · ')}
    </Text>
  );
}

/** A game's RetroAchievements progress (GET /api/v1/game). */
interface RaGame {
  gameId: number;
  numAwarded: number;
  numAwardedHardcore: number;
  maxPossible: number;
  award: string | null;
  awardedAt: string | null;
  url: string;
}

/** RetroAchievements' highest award, in words. */
const RA_AWARDS: Record<string, string> = {
  mastered: 'Mastered',
  completed: 'Completed',
  'beaten-hardcore': 'Beaten (hardcore)',
  'beaten-softcore': 'Beaten',
};

/** "Mastered · 72 of 72 achievements · 9/1/2026", linked to the game on RetroAchievements. */
function RaLine({ ra, dateFormat }: { ra: RaGame; dateFormat: SettingsValues['general.dateFormat'] }) {
  const parts = [
    ra.award ? (RA_AWARDS[ra.award] ?? ra.award) : null,
    `${ra.numAwarded} of ${ra.maxPossible} achievements`,
    ra.award && ra.awardedAt ? date(ra.awardedAt, dateFormat) : null,
  ].filter(Boolean);
  return (
    <Text size="sm">
      <Anchor href={ra.url} target="_blank" rel="noreferrer" size="sm">
        RetroAchievements
      </Anchor>
      : {parts.join(' · ')}
    </Text>
  );
}

const STATUS: Record<string, { label: string; color: string }> = {
  owned: { label: 'You own it', color: 'teal' },
  missing: { label: 'Missing', color: 'gray' },
  review: { label: 'To review', color: 'yellow' },
  unconfirmed: { label: 'Not confirmed physical', color: 'orange' },
  upcoming: { label: 'Not out yet', color: 'blue' },
  excluded: { label: 'Not a target', color: 'gray' },
};

/** Where a catalog's game came from, as the drawer says it. */
const SOURCES: Record<string, string> = { list: 'From your list', wikipedia: 'From Wikipedia', 'nintendo-life': 'From Nintendo Life', user: 'Added by you' };

const OWNERSHIP: Record<string, string> = { permanent: 'owned', subscription: 'subscription', historical: 'not verified' };

/** The catalog statuses of a game you don't have yet, where "I bought it" applies. */
const WANTED = new Set(['missing', 'unconfirmed', 'review', 'upcoming']);

/** Everything a change in the drawer can touch, refreshed after it. */
const TOUCHED = ['game', 'catalogs', 'wishlist', 'lookup', 'purchases', 'sets', 'review', 'notes', 'collection', 'send', 'copy', 'improve'];

/** The URL parameter the drawer reads: "platform key|title". */
const PARAM = 'game';

/** Where this browser keeps the games opened lately, newest first (the header's search lists them). */
const RECENT = 'squirrelcade:recent-games';
const RECENT_MAX = 8;

/** A game opened lately: its console and title, as the drawer opened it. */
export interface RecentGame {
  platformKey: string;
  platform: string;
  title: string;
}

/** The games this browser opened lately, newest first; none when storage is off. */
export function recentGames(): RecentGame[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT) ?? '[]') as RecentGame[];
    return Array.isArray(list) ? list.filter((g) => g && typeof g.platformKey === 'string' && typeof g.title === 'string') : [];
  } catch {
    return [];
  }
}

function remember(game: RecentGame): void {
  try {
    const list = [game, ...recentGames().filter((g) => !(g.platformKey === game.platformKey && g.title === game.title))].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT, JSON.stringify(list));
  } catch {
    // Storage can be off (a private window): the list just stays empty.
  }
}

/** Opens a game in the drawer: sets the page's game parameter (so the back button closes it again). */
export function useOpenGame(): (platformKey: string, title: string) => void {
  const [params, setParams] = useSearchParams();
  return (platformKey, title) => {
    const next = new URLSearchParams(params);
    next.set(PARAM, `${platformKey}|${title}`);
    setParams(next);
  };
}

/** A game's title that opens it in the drawer, marked when you have a note on the game (the note on hover). */
export function GameTitle({
  platformKey,
  title,
  children,
  fw,
  size = 'sm',
  withNote = true,
}: {
  platformKey: string;
  title: string;
  children?: ReactNode;
  fw?: number;
  size?: 'xs' | 'sm' | 'md';
  /** Mark it when you have a note on it (not where the note is shown anyway). */
  withNote?: boolean;
}) {
  const open = useOpenGame();
  const { noteOf } = useGameNotes();
  const note = withNote ? noteOf(platformKey, title) : null;
  const link = (
    <Anchor
      component="button"
      type="button"
      c="inherit"
      underline="hover"
      size={size}
      fw={fw}
      ta="left"
      onClick={(ev) => {
        // Rows that open or expand on a click (the wishlist's) don't also react.
        ev.stopPropagation();
        open(platformKey, title);
      }}
      aria-label={`Show ${title}`}
    >
      {children ?? title}
    </Anchor>
  );
  if (!note) return link;
  // One inline piece, so the mark stays beside the title where a column of the row lays out its children.
  return (
    <span>
      {link}
      <Tooltip
        label={
          <Text size="xs" style={{ whiteSpace: 'pre-wrap' }}>
            {note}
          </Text>
        }
        multiline
        w={280}
      >
        <span role="img" aria-label={`Your note: ${note}`} style={{ display: 'inline-flex', verticalAlign: 'middle', marginLeft: 4, color: 'var(--mantine-color-dimmed)' }}>
          <IconNotes size={14} aria-hidden="true" />
        </span>
      </Tooltip>
    </span>
  );
}

/**
 * A game's shop links (Settings > Interface > Shop links), folded under "Shop for it" until opened, then by their
 * groups (used marketplaces, game stores, new games...), each a search for the game in that shop.
 */
function ShopFor({ links, title, platform }: { links: ShopLink[]; title: string; platform: string }) {
  const [open, setOpen] = useState(false);
  if (links.length === 0) return null;
  const groups = new Map<string, ShopLink[]>();
  for (const l of links) groups.set(l.group ?? 'Your links', [...(groups.get(l.group ?? 'Your links') ?? []), l]);
  return (
    <>
      <Anchor component="button" type="button" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        Shop for it ({links.length})
      </Anchor>
      {open && (
        <Stack gap={4} w="100%">
          {[...groups].map(([group, shops]) => (
            <Group key={group} gap={8} wrap="wrap" align="baseline">
              <Text size="xs" c="dimmed" w={130}>
                {group}
              </Text>
              {shops.map((s) => (
                <Anchor key={s.name} href={shopUrl(s.template, title, platform)} target="_blank" rel="noreferrer" size="sm">
                  {s.name}
                </Anchor>
              ))}
            </Group>
          ))}
        </Stack>
      )}
    </>
  );
}

/** Where to see what a game sells for: PriceCharting, and the shop links for its console (Settings > Interface). */
export function PriceLinks({ platformKey, platform, title, size = 'xs' }: { platformKey: string; platform: string; title: string; size?: 'xs' | 'sm' }) {
  const shops = useSetting('interface.shopLinks', []);
  const links = [
    { name: 'PriceCharting', href: priceChartingUrl(title, platform) },
    // The first few of your shop links: the game's drawer has them all, by group.
    ...shopLinksFor(shops ?? [], platformKey)
      .slice(0, SHOPS_IN_LISTS)
      .map((s) => ({ name: s.name, href: shopUrl(s.template, title, platform) })),
  ];
  return (
    <Group gap={8} wrap="wrap">
      {links.map((l) => (
        <Anchor key={l.name} href={l.href} target="_blank" rel="noreferrer" size={size} aria-label={`${l.name}: ${title}`}>
          {l.name}
        </Anchor>
      ))}
    </Group>
  );
}

/**
 * A game's cover that opens it in the drawer, as its title does. It's for the mouse and touch: keyboards and
 * screen readers reach the game through its title, so the cover isn't announced a second time.
 */
export function GameCover({ platformKey, title, id, width, placeholder }: { platformKey: string; title: string; id?: string | null; width?: number; placeholder?: boolean }) {
  const open = useOpenGame();
  return (
    <Box
      component="span"
      aria-hidden="true"
      style={{ cursor: 'pointer', display: 'inline-flex', flex: 'none' }}
      onClick={(ev) => {
        // Rows that open or expand on a click (the wishlist's) don't also react.
        ev.stopPropagation();
        open(platformKey, title);
      }}
    >
      <Cover id={id} width={width} placeholder={placeholder} />
    </Box>
  );
}

/** Your note on the game: typed here and kept with Save; Remove clears it. */
function NoteSection({ note, busy, dateFormat, save }: { note: GameView['note']; busy: boolean; dateFormat: SettingsValues['general.dateFormat']; save: (note: string | null) => void }) {
  const [draft, setDraft] = useState(note?.text ?? '');
  const changed = draft.trim() !== (note?.text ?? '');
  return (
    <Section title="Your note">
      <Textarea
        aria-label="Your note"
        placeholder="A note for yourself: the edition you're after, what to check at a store..."
        autosize
        minRows={2}
        maxRows={8}
        maxLength={NOTE_MAX}
        value={draft}
        onChange={(e) => setDraft(e.currentTarget.value)}
      />
      <Group gap="xs">
        <Button size="compact-sm" variant="light" disabled={!changed || busy} onClick={() => save(draft.trim() || null)}>
          Save note
        </Button>
        {note && (
          <Button
            size="compact-sm"
            variant="subtle"
            color="gray"
            disabled={busy}
            onClick={() => {
              setDraft('');
              save(null);
            }}
          >
            Remove
          </Button>
        )}
        {note && (
          <Text size="xs" c="dimmed">
            Changed {date(note.updatedAt, dateFormat)}
          </Text>
        )}
        <Anchor component={Link} to="/notes" size="xs" ml="auto">
          All your notes
        </Anchor>
      </Group>
    </Section>
  );
}

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <Stack gap={4}>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {title}
      </Text>
      {children}
    </Stack>
  );
}

/** A copy's value over its collection updates: a small line, and how much it moved since the first (every value on hover). */
function PriceTrend({ history, currency, dateFormat }: { history: { date: string; cents: number }[]; currency: string; dateFormat: SettingsValues['general.dateFormat'] }) {
  if (history.length < 2) return null;
  const width = 64;
  const height = 18;
  const values = history.map((p) => p.cents);
  const low = Math.min(...values);
  const span = Math.max(...values) - low || 1;
  const points = values.map((v, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${(height - 2 - ((v - low) / span) * (height - 4)).toFixed(1)}`).join(' ');
  const first = history[0]!;
  const change = history.at(-1)!.cents - first.cents;
  const color = change > 0 ? 'teal' : change < 0 ? 'red' : 'dimmed';
  return (
    <Tooltip
      label={
        <Stack gap={0}>
          {history.map((p) => (
            <Text key={p.date} size="xs">
              {date(p.date, dateFormat)}: {money(p.cents, currency)}
            </Text>
          ))}
        </Stack>
      }
    >
      <Group gap={4} justify="flex-end" wrap="nowrap">
        <svg width={width} height={height} aria-hidden="true">
          <polyline points={points} fill="none" stroke={`var(--mantine-color-${color === 'dimmed' ? 'gray' : color}-6)`} strokeWidth={1.5} />
        </svg>
        <Text size="xs" c={color}>
          {change > 0 ? '+' : ''}
          {money(change, currency)} since {date(first.date, dateFormat)}
        </Text>
      </Group>
    </Tooltip>
  );
}

/** A change the drawer makes through the API, with what to say once it's done. */
interface Change {
  path: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  json?: unknown;
  done?: string;
}

/**
 * The game drawer: everything Squirrelcade knows about one game on one console, from any page that shows it: the
 * console catalog's answer, your copies with their value, other consoles and PC storefronts you have it on,
 * your sets, the wishlist's points, and links to its console page, RomM and IGDB. The answers the other pages
 * take are here too: "It's physical", a target or not, "I bought it", "Same game" for a look-alike, "not the
 * same" for a copy counted by a similar title, and the wishlist's preference and snooze.
 */
export function GameDrawer() {
  const [params, setParams] = useSearchParams();
  const narrow = useMediaQuery('(max-width: 48em)');
  const currency = useSetting('general.currency', 'USD');
  const dateFormat = useSetting('general.dateFormat', 'us');
  const shops = useSetting('interface.shopLinks', []);
  const queryClient = useQueryClient();
  const value = params.get(PARAM);
  const at = value?.indexOf('|') ?? -1;
  const platformKey = value && at > 0 ? value.slice(0, at) : null;
  const title = value && at > 0 ? value.slice(at + 1) : null;
  const view = useQuery({
    queryKey: ['game', platformKey, title],
    queryFn: () => api<GameView>(`/game?platform=${encodeURIComponent(platformKey!)}&title=${encodeURIComponent(title!)}`),
    enabled: Boolean(platformKey && title),
  });
  // IGDB's summary, asked for on its own: the first time, the server asks IGDB, and the drawer doesn't wait for it.
  const summary = useQuery({
    queryKey: ['game', 'summary', platformKey, title],
    queryFn: () => api<{ summary: string | null }>(`/game/summary?platform=${encodeURIComponent(platformKey!)}&title=${encodeURIComponent(title!)}`),
    enabled: Boolean(platformKey && title && view.data?.igdb),
    staleTime: Infinity,
  });
  // Your sets, for "Add to a set" (the ones the game isn't in yet).
  const allSets = useQuery({ queryKey: ['sets'], queryFn: () => api<{ key: string; name: string }[]>('/sets'), enabled: Boolean(platformKey && title) });
  const change = useMutation({
    mutationFn: (c: Change) => api(c.path, { method: c.method, json: c.json }),
    onSuccess: async (d, c) => {
      // A copy added at the goal says so (one in, one out).
      if (c.done) notifySuccess(c.done + overGoalNote(d));
      await Promise.all(TOUCHED.map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
    },
    onError: (err) => notifyError(err),
  });
  const close = () => {
    const next = new URLSearchParams(params);
    next.delete(PARAM);
    setParams(next, { replace: true });
  };
  const g = view.data;
  const c = g?.catalog ?? null;
  // Each game shown is remembered for the header's search.
  useEffect(() => {
    if (g) remember({ platformKey: g.platformKey, platform: g.platform, title: g.title });
  }, [g?.platformKey, g?.title]);
  const status = c ? STATUS[c.status] : undefined;
  // The redesign's status tags (0.50.0): how many you have, its place in the console's Top 100, on the wishlist.
  const owned = g ? g.copies.reduce((n, x) => n + x.quantity, 0) : 0;
  const tags = g
    ? [
        owned > 0 ? { label: owned > 1 ? `Have it ×${owned}` : 'Have it', tone: 'have' } : null,
        g.history?.top100 ? { label: `Top 100 · #${g.history.top100.rank}`, tone: 'deep' } : null,
        owned === 0 && g.wishlist?.rank ? { label: `Wishlist #${g.wishlist.rank}`, tone: 'want' } : null,
        owned === 0 && c?.status === 'missing' && !g.wishlist?.rank ? { label: 'Missing', tone: 'missing' } : null,
      ].filter((t): t is { label: string; tone: string } => t !== null)
    : [];
  // A second copy that could go: the least valuable one.
  const spare = owned > 1 && g ? [...g.copies].sort((a, b) => (a.valueCents ?? 0) - (b.valueCents ?? 0))[0] : undefined;
  const busy = change.isPending;
  // A viewer sees the game, not the buttons that change the collection.
  const canEdit = useCanEdit();
  // What the owner played, and their copies' details, show to viewers only when the owner shares them.
  const seesPlay = useSetting('security.viewersSeePlay', true) || canEdit;
  const [editing, setEditing] = useState<CopyRef | null>(null);
  // The windows opened from the drawer keep what they were opened for, and live outside its content: a refresh that
  // redraws the content (WebKit showed one) must not close a window or lose what was typed in it.
  const [adding, setAdding] = useState<{ platformKey: string; platform: string; title: string } | null>(null);
  const [selling, setSelling] = useState<{ id: number; title: string } | null>(null);

  const setStatus = (targetStatus: 'required' | 'excluded', done: string) => c && change.mutate({ path: `/catalogs/entries/${c.entryId}`, method: 'PATCH', json: { targetStatus }, done });
  const decide = (productId: string, decision: 'confirmed' | 'rejected' | 'undo') =>
    c &&
    change.mutate(
      decision === 'undo'
        ? { path: '/catalogs/decisions', method: 'DELETE', json: { entryId: c.entryId, productId } }
        : { path: '/catalogs/decisions', method: 'POST', json: { entryId: c.entryId, productId, decision } },
    );
  const snooze = (until: string | null) => g && change.mutate({ path: '/wishlist/snooze', method: 'PUT', json: { platformKey: g.platformKey, title: g.title, until } });

  return (
    <Drawer opened={Boolean(platformKey && title)} onClose={close} position="right" size={narrow ? '100%' : 'lg'} title={<Text fw={700}>{title}</Text>}>
      {view.isLoading || !g ? (
        view.isError ? <Text c="red">This game couldn't be shown.</Text> : <Loader />
      ) : (
        <Stack gap="md">
          <Group align="flex-start" wrap="nowrap" gap="md">
            <Cover id={g.coverId} width={90} placeholder />
            <Stack gap={4}>
              {tags.length > 0 && (
                <Group gap={6}>
                  {tags.map((t) => (
                    <span key={t.label} className="sc-tag" data-tone={t.tone}>
                      {t.label}
                    </span>
                  ))}
                </Group>
              )}
              <Text size="sm" c="dimmed">
                {g.platform}
              </Text>
              {g.igdb && (
                <Text size="sm">
                  {[g.igdb.genres.join(', '), g.igdb.released?.slice(0, 4), g.igdb.rating !== null ? `IGDB ${Math.round(g.igdb.rating)} (${count(g.igdb.ratingCount ?? 0)} ratings)` : null]
                    .filter(Boolean)
                    .join(' · ')}
                  {g.igdb.franchise && (
                    <>
                      {' · '}
                      <Anchor component={Link} to={`/sets?tab=series&series=${encodeURIComponent(g.igdb.franchise)}`} size="sm" underline="hover">
                        {g.igdb.franchise}
                      </Anchor>
                    </>
                  )}
                </Text>
              )}
              <Group gap={6}>
                {status ? (
                  <Badge color={status.color} variant="light" style={{ textTransform: 'none' }}>
                    {status.label}
                  </Badge>
                ) : (
                  <Badge color="gray" variant="outline" style={{ textTransform: 'none' }}>
                    {g.copies.length > 0 ? 'You own it; not in the catalog' : "Not in the console's catalog"}
                  </Badge>
                )}
                {c?.format && /game[\s-]*key/i.test(c.format) && (
                  <Badge color="cyan" variant="light" style={{ textTransform: 'none' }}>
                    Game-Key Card
                  </Badge>
                )}
                {c?.releaseDate && (
                  <Text size="xs" c="dimmed">
                    Released {/^\d{4}/.test(c.releaseDate) ? releaseDate(c.releaseDate, dateFormat) : c.releaseDate}
                  </Text>
                )}
              </Group>
              {c && (
                <Text size="xs" c="dimmed">
                  {[SOURCES[c.source] ?? `From ${c.source}`, c.yourChoice && (c.targetStatus === 'excluded' ? 'you said not a target' : 'you said it counts'), c.notes].filter(Boolean).join(' · ')}
                </Text>
              )}
            </Stack>
          </Group>

          {summary.data?.summary && (
            <Spoiler maxHeight={66} showLabel="More" hideLabel="Less" styles={{ control: { fontSize: 'var(--mantine-font-size-sm)' } }}>
              <Text size="sm">{summary.data.summary}</Text>
            </Spoiler>
          )}

          <DrawerHistory platformKey={g.platformKey} title={g.title} history={g.history} />

          {/* What you played of it: for games you own (a status for a game you don't have yet is a wish, not a play). */}
          {seesPlay && (g.copies.length > 0 || g.play) && (canEdit || g.play) && (
            <Section title="Played">
              <PlayPicker platformKey={g.platformKey} title={g.title} play={g.play} canEdit={canEdit} dateFormat={dateFormat} />
              {g.retroAchievements && <RaLine ra={g.retroAchievements} dateFormat={dateFormat} />}
              {g.achievements.map((a) => (
                <AchievementLine key={a.source} a={a} dateFormat={dateFormat} />
              ))}
            </Section>
          )}
          {(g.retroAchievements || g.achievements.length > 0) && !(seesPlay && (g.copies.length > 0 || g.play) && (canEdit || g.play)) && (
            <Section title="Played">
              {g.retroAchievements && <RaLine ra={g.retroAchievements} dateFormat={dateFormat} />}
              {g.achievements.map((a) => (
                <AchievementLine key={a.source} a={a} dateFormat={dateFormat} />
              ))}
            </Section>
          )}

          {c && canEdit && (
            <Group gap="xs">
              {c.status === 'unconfirmed' && (
                <Button size="compact-sm" variant="light" leftSection={<IconCheck size={14} />} loading={busy} onClick={() => setStatus('required', `${g.title} had a physical release: it counts now.`)}>
                  It's physical
                </Button>
              )}
              {c.status === 'review' && c.targetStatus === 'review' && c.suggestions.length === 0 && (
                <Button size="compact-sm" variant="light" loading={busy} onClick={() => setStatus('required', `${g.title} counts on ${g.platform}.`)}>
                  It's a target
                </Button>
              )}
              {c.status === 'excluded' && (
                <Button size="compact-sm" variant="light" loading={busy} onClick={() => setStatus('required', `${g.title} counts on ${g.platform} again.`)}>
                  It's a target
                </Button>
              )}
              {WANTED.has(c.status) && !c.purchase && (
                <Button
                  size="compact-sm"
                  variant="default"
                  leftSection={<IconShoppingCart size={14} />}
                  loading={busy}
                  onClick={() => change.mutate({ path: '/purchases', method: 'POST', json: { entryId: c.entryId }, done: `${g.title} is in your collection. Its condition and price are under Your copies.` })}
                >
                  I bought it
                </Button>
              )}
              {WANTED.has(c.status) && (
                <Button size="compact-sm" variant="subtle" color="gray" loading={busy} onClick={() => setStatus('excluded', `${g.title} no longer counts on ${g.platform}.`)}>
                  Not a target
                </Button>
              )}
            </Group>
          )}
          {canEdit && (
            <Group gap="xs">
              <Button size="compact-sm" variant="subtle" leftSection={<IconPlus size={14} />} onClick={() => setAdding({ platformKey: g.platformKey, platform: g.platform, title: g.title })}>
                Add a copy
              </Button>
            </Group>
          )}

          {c && canEdit && c.suggestions.length > 0 && (
            <Section title="Look-alikes you own">
              {c.suggestions.map((s) => (
                <Group key={s.productId} gap={6} wrap={narrow ? 'wrap' : 'nowrap'} justify="space-between">
                  <Text size="sm">
                    {s.title}{' '}
                    <Text span size="xs" c="dimmed">
                      ({s.reason})
                    </Text>
                  </Text>
                  <Group gap={6} wrap="nowrap">
                    <Button size="compact-xs" color="green" variant="light" leftSection={<IconCheck size={12} />} disabled={busy} onClick={() => decide(s.productId, 'confirmed')}>
                      Same game
                    </Button>
                    <Button size="compact-xs" variant="default" leftSection={<IconX size={12} />} disabled={busy} onClick={() => decide(s.productId, 'rejected')}>
                      Different
                    </Button>
                  </Group>
                </Group>
              ))}
            </Section>
          )}

          {g.copies.length > 0 && (
            <Section title="Your copies">
              <Table verticalSpacing={4}>
                <Table.Tbody>
                  {g.copies.map((x, i) => (
                    <Table.Tr key={x.copyKey || `${x.productId}|${i}`}>
                      <Table.Td>
                        <Group gap={6} wrap="nowrap">
                          <Text size="sm">{x.title}</Text>
                          <RegionBadge region={x.region} consoleLabel={x.consoleLabel} platformKey={g.platformKey} />
                        </Group>
                        <Text size="xs" c="dimmed">
                          {[COMPLETENESS_LABELS[x.completeness as Completeness] ?? x.completeness, x.quantity > 1 ? `${x.quantity} copies` : null, x.dateEntered ? `added ${date(x.dateEntered, dateFormat)}` : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                        {x.source === 'squirrelcade' && !x.missingSince && (
                          <Text size="xs" c="dimmed">
                            {x.sentAt ? `Sent to PriceCharting ${date(x.sentAt, dateFormat)}: waiting for an export that has it` : 'Added in Squirrelcade: not on PriceCharting yet'}
                            {canEdit && !x.sentAt && (
                              <>
                                {' '}
                                (
                                <Anchor component={Link} to="/updates#send" size="xs">
                                  send it
                                </Anchor>
                                {' · '}
                                <Anchor component="button" type="button" size="xs" onClick={() => change.mutate({ path: `/purchases/${x.id}`, method: 'DELETE', done: `Took back the copy of ${x.title} just added.` })}>
                                  take back
                                </Anchor>
                                )
                              </>
                            )}
                          </Text>
                        )}
                        {x.missingSince && (
                          <Text size="xs" c="yellow.8">
                            {x.source === 'spreadsheet' ? 'Not in your spreadsheet' : "Not in PriceCharting's export"} since {date(x.missingSince, dateFormat)}:{' '}
                            {canEdit ? (
                              <Anchor component={Link} to="/review?tab=copies" size="xs" c="inherit" td="underline">
                                answer on Review
                              </Anchor>
                            ) : (
                              'waiting on Review'
                            )}
                          </Text>
                        )}
                        <CopyDetailLine details={x.details} loans={x.loans} photos={x.photos} currency={currency} dateFormat={dateFormat} />
                        {(x.tests[0] || canEdit) && (
                          <Group gap={6} mt={2}>
                            {x.tests.find((t) => t.kind === 'test') && <TestBadge {...x.tests.find((t) => t.kind === 'test')!} dateFormat={dateFormat} />}
                            {x.tests.find((t) => t.kind === 'rip') && <TestBadge {...x.tests.find((t) => t.kind === 'rip')!} dateFormat={dateFormat} />}
                            {canEdit && (
                              <Anchor
                                component="button"
                                type="button"
                                size="xs"
                                onClick={() => change.mutate({ path: '/copy/tests', method: 'POST', json: { key: x.copyKey, result: 'works' }, done: `${x.title}: tested, it works.` })}
                              >
                                {x.tests.some((t) => t.kind === 'test') ? 'tested again: it works' : 'tested: it works'}
                              </Anchor>
                            )}
                            {canEdit && (
                              <Anchor component="button" type="button" size="xs" onClick={() => setSelling({ id: x.id, title: x.title })}>
                                ready to sell
                              </Anchor>
                            )}
                          </Group>
                        )}
                        {canEdit && (
                          <Anchor
                            component="button"
                            type="button"
                            size="xs"
                            onClick={() =>
                              setEditing({
                                copyKey: x.copyKey,
                                title: x.title,
                                platform: g.platform,
                                condition: COMPLETENESS_LABELS[x.completeness as Completeness] ?? x.completeness,
                                copy: { id: x.id, completeness: x.completeness, costCents: x.costCents, datePurchased: x.datePurchased, notes: x.notes, slots: x.slots, estimatedCents: x.estimatedCents, platformKey: g.platformKey },
                              })
                            }
                          >
                            Change it, where it is, lending, photos...
                          </Anchor>
                        )}
                        {c && x.countsAs !== 'exact' && (
                          <Text size="xs" c="dimmed">
                            {x.countsAs ? `Counts as this game: ${MATCH_METHODS[x.countsAs].toLowerCase()}` : "Doesn't count as this game"}
                            {canEdit && x.countsAs && REJECTABLE.has(x.countsAs) && (
                              <>
                                {' · '}
                                <Anchor size="xs" onClick={() => decide(x.productId, 'rejected')}>
                                  not the same
                                </Anchor>
                              </>
                            )}
                            {canEdit && x.countsAs === 'confirmed' && (
                              <>
                                {' · '}
                                <Anchor size="xs" onClick={() => decide(x.productId, 'undo')}>
                                  undo
                                </Anchor>
                              </>
                            )}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text size="sm">{money(x.valueCents, currency)}</Text>
                        {x.costCents ? (
                          <Text size="xs" c="dimmed">
                            paid {money(x.costCents, currency)}
                          </Text>
                        ) : x.estimatedCents !== null ? (
                          <Tooltip label="Your estimate of what it cost: never a price paid, never sent anywhere">
                            <Text size="xs" c="dimmed" fs="italic">
                              estimated {money(x.estimatedCents, currency)}
                            </Text>
                          </Tooltip>
                        ) : null}
                        <PriceTrend history={x.history} currency={currency} dateFormat={dateFormat} />
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
              {canEdit && spare && (
                <Text size="xs" c="dimmed">
                  You have {owned} copies of it.{' '}
                  <Anchor component="button" type="button" size="xs" onClick={() => setSelling({ id: spare.id, title: spare.title })}>
                    List one for sale
                  </Anchor>
                </Text>
              )}
            </Section>
          )}

          {(g.ownedOn.length > 0 || g.pc.length > 0 || g.sets.length > 0) && (
            <Section title="Also">
              {g.ownedOn.length > 0 && <Text size="sm">You have it on {g.ownedOn.join(', ')}</Text>}
              {g.pc.length > 0 && (
                <Text size="sm">
                  On PC: {g.pc.map((p) => `${p.storefront} (${OWNERSHIP[p.ownership] ?? p.ownership}${p.playtimeHours > 0 ? `, ${p.playtimeHours} h played` : ''})`).join(', ')}
                </Text>
              )}
              {g.sets.length > 0 && (
                <Text size="sm">
                  In your {g.sets.length === 1 ? 'set' : 'sets'}{' '}
                  {g.sets.map((s, i) => (
                    <Fragment key={s.key || s.name}>
                      {i > 0 && ', '}
                      <Anchor component={Link} to={s.key ? `/sets/${s.key}` : '/sets'} size="sm">
                        {s.name}
                      </Anchor>
                      {canEdit && s.key && (
                        <>
                          {' ('}
                          <Anchor
                            component="button"
                            type="button"
                            size="xs"
                            c="dimmed"
                            disabled={busy}
                            onClick={() =>
                              change.mutate({
                                path: `/sets/${s.key}/games`,
                                method: 'POST',
                                json: { platformKey: g.platformKey, title: g.title, action: 'remove' },
                                done: `${g.title} is out of ${s.name}; the set's page can put it back.`,
                              })
                            }
                          >
                            take out
                          </Anchor>
                          {')'}
                        </>
                      )}
                    </Fragment>
                  ))}
                </Text>
              )}
            </Section>
          )}

          {(g.wishlist || g.snoozedUntil || g.preference || g.wishlistNote) && (
            <Section
              title={
                g.wishlist ? (
                  <>
                    Wishlist: <Acorns n={g.wishlist.score} size={11} />
                    {g.igdb?.rating != null && g.igdb.ratingCount ? (
                      <>
                        {' · '}
                        <Reviews r={{ rating: Math.round(g.igdb.rating), count: g.igdb.ratingCount }} size={11} />
                      </>
                    ) : null}
                    {g.wishlist.rank ? `, #${g.wishlist.rank}` : ''} ({g.wishlist.priority})
                  </>
                ) : (
                  'Wishlist'
                )
              }
            >
              {g.wishlist?.components
                .filter((p) => p.points !== 0)
                .map((p) => (
                  <Group key={p.label} justify="space-between" gap="xs">
                    <Text size="sm">{p.label}</Text>
                    <Text size="sm" c={p.points < 0 ? 'red' : undefined}>
                      {p.points > 0 ? `+${p.points}` : p.points}
                    </Text>
                  </Group>
                ))}
              {!g.wishlist && g.wishlistNote && (
                <Text size="sm" c="dimmed">
                  {g.wishlistNote}
                </Text>
              )}
              {g.snoozedUntil && (
                <Text size="sm">
                  Snoozed until {date(g.snoozedUntil, dateFormat)}.{' '}
                  {canEdit && (
                    <Anchor size="sm" onClick={() => snooze(null)}>
                      Wake it up
                    </Anchor>
                  )}
                </Text>
              )}
              <Group gap="xs" mt={4}>
                <PreferencePicker platformKey={g.platformKey} title={g.title} value={g.preference} width={190} disabled={busy} />
                {canEdit && g.wishlist && !g.snoozedUntil && (
                  <Menu position="bottom-start" withinPortal>
                    <Menu.Target>
                      <Button size="compact-sm" variant="default" leftSection={<IconClock size={14} />} disabled={busy}>
                        Snooze
                      </Button>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Label>Leave it off the wishlist for</Menu.Label>
                      {SNOOZES.map(([label, months]) => (
                        <Menu.Item key={label} onClick={() => snooze(monthsFromNow(months))}>
                          {label}
                        </Menu.Item>
                      ))}
                    </Menu.Dropdown>
                  </Menu>
                )}
              </Group>
            </Section>
          )}

          {canEdit ? (
            <NoteSection
              key={`${g.platformKey}|${g.title}`}
              note={g.note}
              busy={busy}
              dateFormat={dateFormat}
              save={(note) => change.mutate({ path: '/game/note', method: 'PUT', json: { platformKey: g.platformKey, title: g.title, note }, done: note ? 'Note saved.' : 'Note removed.' })}
            />
          ) : (
            // A viewer sees the owner's note when the owner shares notes (Settings > Security > Viewers).
            g.note && (
              <Section title="Their note">
                <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                  {g.note.text}
                </Text>
              </Section>
            )
          )}

          <Divider />
          <Group gap="md">
            <Anchor component={Link} to={`/platforms/${g.platformKey}?${c ? `tab=${c.status}&` : ''}q=${encodeURIComponent(g.title)}`} size="sm" onClick={close}>
              On its console's page
            </Anchor>
            <Anchor href={`https://www.igdb.com/search?type=1&q=${encodeURIComponent(g.title)}`} target="_blank" rel="noreferrer" size="sm">
              IGDB
            </Anchor>
            {/* PriceCharting, where the collection's values come from: its prices for the game, by its console name for a copy you have. */}
            <Anchor href={priceChartingUrl(g.title, g.copies[0]?.consoleLabel ?? g.platform)} target="_blank" rel="noreferrer" size="sm">
              PriceCharting
            </Anchor>
            {/* Your shop links (Settings > Interface), each a search for the game in a shop: folded under "Shop for it". */}
            <ShopFor links={shopLinksFor(shops ?? [], g.platformKey)} title={g.title} platform={g.platform} />
            <RommLinks link={g.romm} />
            {canEdit && (allSets.data ?? []).some((s) => !g.sets.some((x) => x.key === s.key)) && (
              <Menu position="top-start" withinPortal>
                <Menu.Target>
                  <Anchor component="button" type="button" size="sm">
                    Add to a set
                  </Anchor>
                </Menu.Target>
                <Menu.Dropdown>
                  {(allSets.data ?? [])
                    .filter((s) => !g.sets.some((x) => x.key === s.key))
                    .map((s) => (
                      <Menu.Item
                        key={s.key}
                        onClick={() =>
                          change.mutate({ path: `/sets/${s.key}/games`, method: 'POST', json: { platformKey: g.platformKey, title: g.title, action: 'add' }, done: `${g.title} is in ${s.name} now.` })
                        }
                      >
                        {s.name}
                      </Menu.Item>
                    ))}
                </Menu.Dropdown>
              </Menu>
            )}
            <Anchor component={Link} to="/help/matching" size="sm" c="dimmed">
              How copies count
            </Anchor>
          </Group>
        </Stack>
      )}
      <AddCopyModal game={adding} onClose={() => setAdding(null)} />
      <SellHelper copy={selling} onClose={() => setSelling(null)} />
      <CopyDetailsModal copy={editing} onClose={() => setEditing(null)} />
    </Drawer>
  );
}
