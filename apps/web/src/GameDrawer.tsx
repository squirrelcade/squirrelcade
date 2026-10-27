import { type HistoryText } from './pages/History';
import { RootsPart } from './RootsPart';
import { COMPLETENESS_LABELS, missingParts, partsSearch, priceChartingUrl, shopLinksFor, shopUrl, type Completeness, type SettingsValues, type ShopLink, SHOPS_IN_LISTS } from '@squirrelcade/core';
import { Anchor, Badge, Box, Button, Divider, Drawer, Group, Loader, Menu, Modal, SimpleGrid, Spoiler, Stack, Text, Textarea, Tooltip, VisuallyHidden } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconCheck, IconClock, IconEyeOff, IconNotes, IconPencil, IconPlus, IconRestore, IconShoppingCart, IconX } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from './api';
import { MATCH_METHODS, monthsFromNow, REJECTABLE, SNOOZES, type MatchMethod } from './choices';
import { Cover } from './components';
import { SellHelper } from './SellHelper';
import { AddCopyModal, CopyDetailLine, CopyDetailsModal, TestBadge, type CopyDetail, type CopyRef, type CopyTest, type Loan, type PhotoInfo } from './CopyDetails';
import { PlayPicker, type Play } from './Playing';
import { count, date, money, releaseDate, wholeMoney } from './format';
import { overGoalNote } from './Goal';
import { notifyError, notifySuccess, useCanEdit, useSetting } from './hooks';
import { NOTE_MAX, useGameNotes } from './notes';
import { PreferencePicker } from './Preference';
import { RegionBadge } from './Region';
import { type RommLink } from './Romm';
import { Acorn, Acorns, Reviews, StashMark } from './Acorn';
import { gameFlyLabel, useGameFly } from './GameFly';
import { ConsoleMark } from './ConsoleMark';
import { GameHeader, ReviewsRing, RommChip, ScoreRing, type GameStar, type HeaderReviews } from './GameHeader';
import { ConsoleRowChips, CopiesFrame, Fact, GetItCard, KeptIn, OnPc, OtherConsoles, Thumbs, WorthGraph, WorthValue, type ConsoleCopy, type ConsoleRow } from './CopiesCard';

/** One game on one console (GET /api/v1/game). */
export interface GameView {
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
    /** Who graded a graded copy, and its certificate (D151). */
    gradingCompany: string;
    gradingCertId: string;
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
  /** The header's stars (D165): Top 100 place, critics' favorite, launch title (best-selling and awards with Roots). */
  stars: GameStar[];
  /** What its copies are worth together on every console, and the share of your games worth less. */
  worth: { cents: number; copies: number; percentile: number } | null;
  /** The Reviews circle: Metacritic's score when known, IGDB's rating otherwise. */
  reviews: HeaderReviews | null;
  /** Every console it's on or you have it on, in release order, this one marked. */
  consoles: ConsoleRow[];
  /** A PC game's storefront links ("Open in Steam"). */
  pcLinks: { storefront: string; name: string; url: string }[];
}

/** A copy on the game page (GET /api/v1/game's copies). */
export type DrawerCopy = GameView['copies'][number];

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
  excluded: { label: 'Excluded', color: 'gray' },
};

/** Where a catalog's game came from, as the drawer says it. */
const SOURCES: Record<string, string> = { list: 'From your list', wikipedia: 'From Wikipedia', 'nintendo-life': 'From Nintendo Life', user: 'Added by you' };

/** The catalog statuses of a game you don't have yet, where "I bought it" applies. */
const WANTED = new Set(['missing', 'unconfirmed', 'review', 'upcoming']);

/** Everything a change in the drawer can touch, refreshed after it. */
const TOUCHED = ['game', 'catalogs', 'wishlist', 'lookup', 'purchases', 'sets', 'review', 'notes', 'collection', 'send', 'copy', 'improve'];

/** Two names of the same game, as written apart only by punctuation or case ("Uncharted 2 Among Thieves"). */
const sameName = (a: string, b: string) => a.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '') === b.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

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
  // GameFly's price, when it sells the game (D174).
  const gamefly = useGameFly()(platformKey, title);
  const links = [
    { name: 'PriceCharting', href: priceChartingUrl(title, platform) },
    ...(gamefly?.url ? [{ name: gameFlyLabel(gamefly), href: gamefly.url }] : []),
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
      <Cover id={id} width={width} placeholder={placeholder} title={title} />
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
    onSuccess: (d, c) => {
      // A copy added at the goal says so (one in, one out).
      if (c.done) notifySuccess(c.done + overGoalNote(d));
      // The page catches up behind: waiting for every answer on it to come back kept the drawer's buttons disabled
      // on a slow server.
      void Promise.all(TOUCHED.map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
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
  // How many copies of it you have on this console.
  const owned = g ? g.copies.reduce((n, x) => n + x.quantity, 0) : 0;
  // A second copy that could go: the least valuable one.
  const spare = owned > 1 && g ? [...g.copies].sort((a, b) => (a.valueCents ?? 0) - (b.valueCents ?? 0))[0] : undefined;
  const busy = change.isPending;
  // A viewer sees the game, not the buttons that change the collection.
  const canEdit = useCanEdit();
  // What the owner played, and their copies' details, show to viewers only when the owner shares them.
  const seesPlay = useSetting('security.viewersSeePlay', true) || canEdit;
  const [editing, setEditing] = useState<CopyRef | null>(null);
  // The copy whose worth over time is shown (its Worth opens it).
  const [graphing, setGraphing] = useState<DrawerCopy | null>(null);
  const openGame = useOpenGame();
  /** A copy's window: its condition, what you paid, when, notes, photos, where it is, lending. */
  const editRef = (x: DrawerCopy): CopyRef => ({
    copyKey: x.copyKey,
    title: x.title,
    platform: g!.platform,
    condition: COMPLETENESS_LABELS[x.completeness as Completeness] ?? x.completeness,
    copy: { id: x.id, completeness: x.completeness, costCents: x.costCents, datePurchased: x.datePurchased, notes: x.notes, slots: x.slots, estimatedCents: x.estimatedCents, platformKey: g!.platformKey, gradingCompany: x.gradingCompany, gradingCertId: x.gradingCertId },
  });
  /** A copy on another console, opened from its line (the game page shows every console's copies). */
  const otherRef = (r: ConsoleRow, x: ConsoleCopy): CopyRef => ({
    copyKey: x.copyKey,
    title: x.title,
    platform: r.platform,
    condition: COMPLETENESS_LABELS[x.completeness as Completeness] ?? x.completeness,
    copy: { id: x.id, completeness: x.completeness, costCents: x.costCents, datePurchased: x.datePurchased, notes: x.notes, slots: x.slots, estimatedCents: x.estimatedCents, platformKey: r.platformKey, gradingCompany: x.gradingCompany, gradingCertId: x.gradingCertId },
  });
  // Copies on every console, the consoles you have it on besides this one, the ones it's on that you don't have yet.
  const copiesCount = g ? g.consoles.reduce((n, r) => n + r.copies.reduce((m, x) => m + x.quantity, 0), 0) : 0;
  const otherConsoles = g ? g.consoles.filter((r) => !r.current && r.copies.length > 0).length : 0;
  const consolesHad = g ? g.consoles.filter((r) => r.copies.length > 0).length : 0;
  const pcStores = g ? [...new Set(g.pc.map((x) => x.storefront))] : [];
  const haveLabel = !g
    ? null
    : g.platformKey === 'pc'
      ? pcStores.length > 0
        ? `Have it · ${pcStores.join(', ')}`
        : null
      : owned > 0
        ? [owned > 1 ? `Have it ×${owned}` : 'Have it', consolesHad > 1 ? `${consolesHad} consoles` : null, pcStores.length > 0 ? 'and PC' : null].filter(Boolean).join(' · ')
        : null;
  const copiesAside = !g
    ? null
    : [
        copiesCount > 0 ? `${count(copiesCount)} ${copiesCount === 1 ? 'copy' : 'copies'}${consolesHad > 1 ? ` on ${consolesHad} consoles` : ''}` : null,
        g.worth && consolesHad > 1 ? `worth ${money(g.worth.cents, currency)}` : null,
        pcStores.length > 0 ? 'and on PC' : null,
        g.copies.length === 1 && g.copies[0]!.dateEntered ? `added ${date(g.copies[0]!.dateEntered, dateFormat)}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
  // The windows opened from the drawer keep what they were opened for, and live outside its content: a refresh that
  // redraws the content (WebKit showed one) must not close a window or lose what was typed in it.
  const [adding, setAdding] = useState<{ platformKey: string; platform: string; title: string } | null>(null);
  const [selling, setSelling] = useState<{ id: number; title: string } | null>(null);
  // Excluding a game from its console's checklist, or making it a target again, asks first (D145).
  const [confirming, setConfirming] = useState<'exclude' | 'include' | null>(null);

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
    <Drawer
      opened={Boolean(platformKey && title)}
      onClose={close}
      position="right"
      // Wide enough for the header's circles beside the name and Roots' two columns (the mockups' 820 pixels).
      size={narrow ? '100%' : 'xl'}
      title={<VisuallyHidden>{title}</VisuallyHidden>}
      // Escape closes the window on top (a copy's, its worth over time), not the page under it.
      closeOnEscape={graphing === null && editing === null && adding === null && selling === null && confirming === null}
    >
      {view.isLoading || !g ? (
        view.isError ? <Text c="red">This game couldn't be shown.</Text> : <Loader />
      ) : (
        <Stack gap="md">
          {/* One header for a game (D165): the console, Have it or its wishlist place, Play on RomM, the name with its
              stars, then Worth (a game you have) or Acorns (one you don't) and Reviews, as Game of the Day draws them. */}
          <GameHeader
            coverId={g.coverId}
            title={g.title}
            stars={g.stars}
            chips={
              <>
                {/* Its consoles' marks (D175, the owner on Azur Lane: Crosswave): filled where you have it, dotted where you
                    don't, this one outlined, PC apart at the end; a mark opens it there. */}
                <span role="group" aria-label={haveLabel ? `Its consoles: ${haveLabel}` : 'Its consoles'} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  {(g.consoles.length > 0 ? g.consoles : [{ platformKey: g.platformKey, platform: g.platform, current: true, via: null, copies: owned > 0 ? [{ quantity: owned }] : [] }]).map((r) => (
                    <ConsoleMark
                      key={r.platformKey}
                      platformKey={r.platformKey}
                      name={r.platform}
                      owned={r.copies.length > 0 || Boolean(r.via)}
                      size={20}
                      onClick={r.current ? undefined : () => openGame(r.platformKey, g.title)}
                      style={r.current ? { outline: '2px solid var(--sc-cade)', outlineOffset: 2, borderRadius: 2 } : undefined}
                    />
                  ))}
                  {g.pc.length > 0 && <ConsoleMark platformKey="pc" name={`PC · ${[...new Set(g.pc.map((x) => x.storefront))].join(', ')}`} size={20} onClick={g.platformKey === 'pc' ? undefined : () => openGame('pc', g.title)} />}
                </span>
                {owned === 0 && g.wishlist?.rank ? (
                  <span className="sc-chip" data-tone="want">
                    <Acorn size={13} /> #{g.wishlist.rank} on your wishlist
                  </span>
                ) : null}
                {owned === 0 && g.wishlist && <span className="sc-chip">{g.wishlist.priority} priority</span>}
                {owned === 0 && !g.wishlist && c?.status === 'missing' && (
                  <span className="sc-chip" data-tone="missing">
                    Missing
                  </span>
                )}
                <RommChip link={g.romm} />
              </>
            }
            sub={
              <Stack gap={4}>
                {g.igdb && (
                  <Text size="sm" c="dimmed">
                    {[g.igdb.genres.join(', '), g.igdb.released?.slice(0, 4)].filter(Boolean).join(' · ')}
                    {g.igdb.franchise && (
                      <>
                        {' · '}
                        <Anchor component={Link} to={`/series?series=${encodeURIComponent(g.igdb.franchise)}`} size="sm" underline="hover">
                          {g.igdb.franchise}
                        </Anchor>
                      </>
                    )}
                  </Text>
                )}
                {g.platformKey !== 'pc' && (
                  <Group gap={6}>
                    {status ? (
                      <Badge color={status.color} variant="light" style={{ textTransform: 'none' }} leftSection={c?.status === 'owned' ? <StashMark size={12} /> : undefined}>
                        {status.label}
                      </Badge>
                    ) : (
                      <Badge color="gray" variant="outline" style={{ textTransform: 'none' }} leftSection={g.copies.length > 0 ? <StashMark size={12} /> : undefined}>
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
                )}
                {c && (
                  <Text size="xs" c="dimmed">
                    {[SOURCES[c.source] ?? `From ${c.source}`, c.yourChoice && (c.targetStatus === 'excluded' ? 'you excluded it' : 'you said it counts'), c.notes].filter(Boolean).join(' · ')}
                  </Text>
                )}
              </Stack>
            }
            rings={
              <>
                {owned === 0 && g.wishlist ? (
                  <ScoreRing kind="acorns" fill={g.wishlist.score} text={String(g.wishlist.score)} size={92} label={`${g.wishlist.score} acorns`} />
                ) : g.worth ? (
                  <ScoreRing
                    kind="worth"
                    fill={g.worth.percentile}
                    text={wholeMoney(g.worth.cents, currency)}
                    size={92}
                    label={`Worth ${money(g.worth.cents, currency)}`}
                    tooltip={`${money(g.worth.cents, currency)} for ${g.worth.copies === 1 ? 'your copy' : `your ${count(g.worth.copies)} copies`}${otherConsoles > 0 ? ' on every console' : ''}: more than ${g.worth.percentile}% of your games`}
                  />
                ) : null}
                {g.reviews && <ReviewsRing reviews={g.reviews} size={92} />}
              </>
            }
          />

          {/* Your copy first, whatever else is on (the owner: "this is still primarily a collecting application"); each
              copy with its own Edit this copy (the owner, 2026-10-23: "move that edit my copy to the actual copy"). */}
          {g.copies.length > 0 || g.platformKey === 'pc' ? (
            <CopiesFrame title={copiesCount === 1 ? 'Your copy' : 'Your copies'} aside={copiesAside}>
              <ConsoleRowChips rows={g.consoles} pc={g.pc} pcCurrent={g.platformKey === 'pc'} onOpen={(k) => openGame(k, g.title)} />
              {g.copies.map((x, i) => (
                <Box key={x.copyKey || `${x.productId}|${i}`} style={i > 0 ? { borderTop: '1px solid var(--sc-line)', paddingTop: 8 } : undefined}>
                  <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
                    <SimpleGrid cols={{ base: 2, xs: 4 }} spacing="xs" verticalSpacing={6} style={{ flex: '1 1 300px' }}>
                      <Fact label={g.copies.length > 1 ? `Copy ${i + 1}${sameName(x.title, g.title) ? '' : ` · ${x.title}`}` : sameName(x.title, g.title) ? 'Condition' : x.title}>
                        <Text fw={600}>{COMPLETENESS_LABELS[x.completeness as Completeness] ?? x.completeness}</Text>
                      </Fact>
                      <Fact label="Paid">
                        {x.costCents ? (
                          <Text fw={600}>{money(x.costCents, currency)}</Text>
                        ) : x.estimatedCents !== null ? (
                          <Tooltip label="Your estimate of what it cost: never a price paid, never sent anywhere">
                            <Text fw={600} fs="italic">
                              estimated {money(x.estimatedCents, currency)}
                            </Text>
                          </Tooltip>
                        ) : (
                          <Text fw={600}>—</Text>
                        )}
                      </Fact>
                      <Fact label="Worth">
                        <WorthValue valueCents={x.valueCents} history={x.history} currency={currency} onGraph={() => setGraphing(x)} />
                      </Fact>
                      <Fact label="Kept in">
                        <KeptIn location={x.details?.location ?? null} />
                      </Fact>
                    </SimpleGrid>
                    <Thumbs photos={x.photos} />
                  </Group>
                  <Group gap={6} mt={6} wrap="wrap">
                    <RegionBadge region={x.region} consoleLabel={x.consoleLabel} platformKey={g.platformKey} />
                    {x.quantity > 1 && (
                      <Text size="xs" c="dimmed">
                        {x.quantity} copies
                      </Text>
                    )}
                    {x.tests.find((t) => t.kind === 'test') && <TestBadge {...x.tests.find((t) => t.kind === 'test')!} dateFormat={dateFormat} />}
                    {x.tests.find((t) => t.kind === 'rip') && <TestBadge {...x.tests.find((t) => t.kind === 'rip')!} dateFormat={dateFormat} />}
                    <CopyDetailLine details={x.details} loans={x.loans} photos={x.photos} currency={currency} dateFormat={dateFormat} without={['place', 'photos']} />
                    {x.dateEntered && g.copies.length > 1 && (
                      <Text size="xs" c="dimmed">
                        added {date(x.dateEntered, dateFormat)}
                      </Text>
                    )}
                    <span style={{ flex: '1 1 0' }} />
                    {canEdit && (
                      <Button size="compact-sm" color="forest" leftSection={<IconPencil size={14} />} onClick={() => setEditing(editRef(x))}>
                        Edit this copy
                      </Button>
                    )}
                    {/* Another copy, beside the last copy's Edit this copy, a button like it (the owner, 2026-10-24). */}
                    {canEdit && i === g.copies.length - 1 && g.platformKey !== 'pc' && (
                      <Button size="compact-sm" variant="default" leftSection={<IconPlus size={14} />} onClick={() => setAdding({ platformKey: g.platformKey, platform: g.platform, title: g.title })}>
                        Add a copy
                      </Button>
                    )}
                  </Group>
                  {x.source === 'squirrelcade' && !x.missingSince && (
                    <Text size="xs" c="dimmed" mt={4}>
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
                    <Text size="xs" c="yellow.8" mt={4}>
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
                  {canEdit && (
                    <Group gap={10} mt={4}>
                      <Anchor
                        component="button"
                        type="button"
                        size="xs"
                        onClick={() => change.mutate({ path: '/copy/tests', method: 'POST', json: { key: x.copyKey, result: 'works' }, done: `${x.title}: tested, it works.` })}
                      >
                        {x.tests.some((t) => t.kind === 'test') ? 'tested again: it works' : 'tested: it works'}
                      </Anchor>
                      <Anchor component="button" type="button" size="xs" onClick={() => setSelling({ id: x.id, title: x.title })}>
                        ready to sell
                      </Anchor>
                    </Group>
                  )}
                  {/* A copy that isn't complete: its missing parts looked for on your used marketplaces (D160). */}
                  {canEdit &&
                    (() => {
                      const parts = missingParts(x.completeness, g.platformKey);
                      const markets = shopLinksFor(shops ?? [], g.platformKey)
                        .filter((sh) => sh.group === 'Used marketplaces')
                        .slice(0, SHOPS_IN_LISTS);
                      if (parts.length === 0 || markets.length === 0) return null;
                      return (
                        <Text size="xs" mt={2}>
                          Find its {parts.join(' and ')}:{' '}
                          {markets.map((sh, k) => (
                            <span key={sh.name}>
                              {k > 0 && ' · '}
                              <Anchor href={shopUrl(sh.template, partsSearch(g.title, parts), g.platform)} target="_blank" rel="noreferrer" size="xs">
                                {sh.name}
                              </Anchor>
                            </span>
                          ))}
                        </Text>
                      );
                    })()}
                  {c && x.countsAs !== 'exact' && (
                    <Text size="xs" c="dimmed" mt={2}>
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
                </Box>
              ))}
              {/* The other consoles' and PC's copies are a tap on their tabs above (D175): no repeat under the copy. */}
              {g.platformKey === 'pc' && <OnPc pc={g.pc} links={g.pcLinks} current onOpen={() => openGame('pc', g.title)} />}
              {canEdit && spare && (
                <Group gap="xs">
                  {spare && (
                    <Text size="xs" c="dimmed">
                      You have {owned} copies of it.{' '}
                      <Anchor component="button" type="button" size="xs" onClick={() => setSelling({ id: spare.id, title: spare.title })}>
                        List one for sale
                      </Anchor>
                    </Text>
                  )}
                </Group>
              )}
            </CopiesFrame>
          ) : (
            <GetItCard
              platformKey={g.platformKey}
              platform={g.platform}
              title={g.title}
              shops={shops ?? []}
              wishlist={g.wishlist}
              actions={
                <>
                  {c && canEdit && WANTED.has(c.status) && !c.purchase && (
                    <Button
                      size="compact-sm"
                      leftSection={<IconShoppingCart size={14} />}
                      loading={busy}
                      onClick={() => change.mutate({ path: '/purchases', method: 'POST', json: { entryId: c.entryId }, done: `${g.title} is in your collection. Its condition and price are under Your copy.` })}
                    >
                      I bought it
                    </Button>
                  )}
                  {canEdit && (
                    <Button size="compact-sm" variant="default" leftSection={<IconPlus size={14} />} onClick={() => setAdding({ platformKey: g.platformKey, platform: g.platform, title: g.title })}>
                      Add a copy
                    </Button>
                  )}
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
                  {canEdit && c && WANTED.has(c.status) && (
                    <Button size="compact-sm" variant="subtle" color="red" leftSection={<IconEyeOff size={14} />} onClick={() => setConfirming('exclude')}>
                      Not a target
                    </Button>
                  )}
                  <PreferencePicker platformKey={g.platformKey} title={g.title} value={g.preference} width={190} disabled={busy} />
                </>
              }
              versions={
                <Stack gap={6}>
                  {c?.purchase && (
                    <Text size="xs" c="dimmed">
                      You marked it bought on {date(c.purchase.createdAt, dateFormat)}: it counts until an export has it.
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
                  {!g.wishlist && g.wishlistNote && (
                    <Text size="xs" c="dimmed">
                      {g.wishlistNote}
                    </Text>
                  )}
                  <ConsoleRowChips rows={g.consoles} pc={g.pc} onOpen={(k) => openGame(k, g.title)} />
                  <OtherConsoles rows={g.consoles} currency={currency} canEdit={canEdit} onEdit={(r, x) => setEditing(otherRef(r, x))} onOpen={(k) => openGame(k, g.title)} />
                  <OnPc pc={g.pc} links={g.pcLinks} current={false} onOpen={() => openGame('pc', g.title)} />
                </Stack>
              }
            />
          )}

          {c && canEdit && (c.status === 'unconfirmed' || (c.status === 'review' && c.targetStatus === 'review' && c.suggestions.length === 0)) && (
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
            </Group>
          )}

          {c && canEdit && c.suggestions.length > 0 && (
            <Section title="Look-alikes you own">
              {c.suggestions.map((sg) => (
                <Group key={sg.productId} gap={6} wrap={narrow ? 'wrap' : 'nowrap'} justify="space-between">
                  <Text size="sm">
                    {sg.title}{' '}
                    <Text span size="xs" c="dimmed">
                      ({sg.reason})
                    </Text>
                  </Text>
                  <Group gap={6} wrap="nowrap">
                    <Button size="compact-xs" color="green" variant="light" leftSection={<IconCheck size={12} />} disabled={busy} onClick={() => decide(sg.productId, 'confirmed')}>
                      Same game
                    </Button>
                    <Button size="compact-xs" variant="default" leftSection={<IconX size={12} />} disabled={busy} onClick={() => decide(sg.productId, 'rejected')}>
                      Different
                    </Button>
                  </Group>
                </Group>
              ))}
            </Section>
          )}

          {summary.data?.summary && (
            <Spoiler maxHeight={66} showLabel="More" hideLabel="Less" styles={{ control: { fontSize: 'var(--mantine-font-size-sm)' } }}>
              <Text size="sm">{summary.data.summary}</Text>
            </Spoiler>
          )}

          {/* Roots (D165): the game in its own time and since, its Top 100 place and why it matters first. */}
          <RootsPart platformKey={g.platformKey} title={g.title} history={g.platformKey === 'pc' ? null : g.history} />

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

          {g.sets.length > 0 && (
            <Section title="In your sets">
              <Text size="sm">
                {g.sets.map((st, i) => (
                  <Fragment key={st.key || st.name}>
                    {i > 0 && ', '}
                    <Anchor component={Link} to={st.key ? `/sets/${st.key}` : '/sets'} size="sm">
                      {st.name}
                    </Anchor>
                    {canEdit && st.key && (
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
                              path: `/sets/${st.key}/games`,
                              method: 'POST',
                              json: { platformKey: g.platformKey, title: g.title, action: 'remove' },
                              done: `${g.title} is out of ${st.name}; the set's page can put it back.`,
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
            </Section>
          )}

          {g.copies.length > 0 && g.platformKey !== 'pc' && (g.wishlist || g.preference || g.wishlistNote) && (
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
            {g.platformKey === 'pc' ? (
              <Anchor component={Link} to={`/pc?q=${encodeURIComponent(g.title)}`} size="sm" onClick={close}>
                In the PC library
              </Anchor>
            ) : (
              <Anchor component={Link} to={`/platforms/${g.platformKey}?${c ? `tab=${c.status}&` : ''}q=${encodeURIComponent(g.title)}`} size="sm" onClick={close}>
                On its console's page
              </Anchor>
            )}
            <Anchor href={`https://www.igdb.com/search?type=1&q=${encodeURIComponent(g.title)}`} target="_blank" rel="noreferrer" size="sm">
              IGDB
            </Anchor>
            {/* PriceCharting, where the collection's values come from: its prices for the game, by its console name for a copy you have. */}
            <Anchor href={priceChartingUrl(g.title, g.copies[0]?.consoleLabel ?? g.platform)} target="_blank" rel="noreferrer" size="sm">
              PriceCharting
            </Anchor>
            {/* Your shop links (Settings > Interface), each a search for the game in a shop: folded under "Shop for it". */}
            <ShopFor links={shopLinksFor(shops ?? [], g.platformKey)} title={g.title} platform={g.platform} />
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
          {/* Excluding it from the checklist, and making it a target again: at the very bottom, apart, and only after a
              question (D145), so a slip can't do either. */}
          {c && canEdit && (WANTED.has(c.status) || c.status === 'excluded') && (
            <>
              <Divider />
              <Group justify="space-between" gap="xs">
                <Text size="xs" c="dimmed" style={{ flex: '1 1 240px' }}>
                  {c.status === 'excluded'
                    ? `Excluded: it doesn't count on the ${g.platform} checklist.`
                    : `Not something to collect, like a store kiosk or a demo disc? Exclude it from the ${g.platform} checklist.`}
                </Text>
                {c.status === 'excluded' ? (
                  <Button size="compact-sm" variant="subtle" leftSection={<IconRestore size={14} />} onClick={() => setConfirming('include')}>
                    Make it a target
                  </Button>
                ) : (
                  <Button size="compact-sm" variant="subtle" color="red" leftSection={<IconEyeOff size={14} />} onClick={() => setConfirming('exclude')}>
                    Exclude it
                  </Button>
                )}
              </Group>
            </>
          )}
        </Stack>
      )}
      <Modal
        opened={confirming !== null && Boolean(g && c)}
        onClose={() => setConfirming(null)}
        title={<Text fw={700}>{confirming === 'include' ? 'Make it a target again?' : 'Exclude it from the checklist?'}</Text>}
        centered
      >
        {g &&
          (confirming === 'include' ? (
            <Stack>
              <Text size="sm">
                <b>{g.title}</b> goes back on the {g.platform} checklist as a game you're missing, so {g.platform}'s completion goes down until you own it. It can
                come back on your Acorns wishlist and in release reminders too.
              </Text>
              <Group justify="flex-end">
                <Button variant="default" onClick={() => setConfirming(null)}>
                  Cancel
                </Button>
                <Button
                  loading={busy}
                  onClick={() => {
                    setConfirming(null);
                    setStatus('required', `${g.title} is a target on ${g.platform} again.`);
                  }}
                >
                  Make it a target
                </Button>
              </Group>
            </Stack>
          ) : (
            <Stack>
              <Text size="sm">
                <b>{g.title}</b> moves to {g.platform}'s Excluded tab. It stops counting as missing, so the {g.platform} checklist can reach 100%, and it leaves your
                Acorns wishlist and release reminders.
              </Text>
              <Text size="sm" c="dimmed">
                Nothing is deleted. To bring it back, open it from the Excluded tab and choose Make it a target.
              </Text>
              <Group justify="flex-end">
                <Button variant="default" onClick={() => setConfirming(null)}>
                  Cancel
                </Button>
                <Button
                  color="red"
                  loading={busy}
                  onClick={() => {
                    setConfirming(null);
                    setStatus('excluded', `${g.title} is excluded from ${g.platform}. Its Excluded tab can bring it back.`);
                  }}
                >
                  Exclude it
                </Button>
              </Group>
            </Stack>
          ))}
      </Modal>
      <AddCopyModal game={adding} onClose={() => setAdding(null)} />
      <SellHelper copy={selling} onClose={() => setSelling(null)} />
      <CopyDetailsModal copy={editing} onClose={() => setEditing(null)} />
      <WorthGraph copy={graphing} onClose={() => setGraphing(null)} currency={currency} dateFormat={dateFormat} />
    </Drawer>
  );
}
