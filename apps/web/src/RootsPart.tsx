import { Anchor, AspectRatio, Box, Button, Center, Group, Image, Loader, Modal, SimpleGrid, Spoiler, Stack, Tabs, Text, TextInput, Tooltip, UnstyledButton } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { igdbCoverUrl, matchKey, youtubeVideoId } from '@squirrelcade/core';
import { IconExternalLink, IconPlayerPlayFilled, IconX } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { RootsMark, StashMark } from './Acorn';
import { api } from './api';
import { count } from './format';
import { useOpenGame } from './GameDrawer';
import { notifyError, notifySuccess, useCanEdit, useFeature, useSetting } from './hooks';
import { InTheMagazines } from './pages/LeavesGames';
import { DrawerHistory, type HistoryText } from './pages/History';

/** A review of the game (GET /api/v1/game/roots). */
interface RootsReview {
  outlet: string;
  score: string;
  date: string | null;
  issue: string | null;
  page: string | null;
  url: string | null;
  archiveUrl: string | null;
  print: boolean;
  /** The owner's scan of it in Leaves (D191). */
  scan: { issueId: number; page: number; label: string; offsetKnown: boolean } | null;
}

/** A source the article cites. */
interface RootsSource {
  kind: 'magazine' | 'web' | 'news' | 'video' | 'book' | 'other';
  title: string | null;
  work: string | null;
  date: string | null;
  issue: string | null;
  page: string | null;
  url: string | null;
  archiveUrl: string | null;
  language: string | null;
}

/** A game the article names, found in a catalog. */
interface RootsMention {
  title: string;
  context: string;
  platformKey: string;
  platform: string;
  catalogTitle: string;
  owned: boolean;
  missing: boolean;
}

/** A game's Roots (GET /api/v1/game/roots). */
interface RootsView {
  status: 'off' | 'none' | 'ready';
  article: { title: string; url: string } | null;
  firstRelease: string | null;
  releases: { platform: string | null; region: string | null; date: string }[];
  months: number;
  aggregates: { outlet: string; score: string }[];
  time: { reviews: RootsReview[]; magazines: RootsSource[]; web: RootsSource[]; videos: RootsSource[] };
  later: { reviews: RootsReview[]; sources: RootsSource[] };
  cameFrom: RootsMention[];
  ledTo: RootsMention[];
  sites: { name: string; url: string }[];
  awards: { name: string; year: string | null }[];
  bestSelling: { rank: number; list: string; url: string } | null;
  readAt: string | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "1994-06-22" as "Jun 22, 1994", "1994-06" as "Jun 1994", "1994" as is. */
function when(d: string | null): string {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  if (!m) return y!;
  return day ? `${MONTHS[+m - 1]} ${+day}, ${y}` : `${MONTHS[+m - 1]} ${y}`;
}

/** Hosts whose links are scans of the printed page (the Internet Archive, the Video Game History Foundation, Sega Retro, Retromags). */
const SCANS = /archive\.org\/details|gamehistory\.org|segaretro\.org\/.*\.pdf|retromags\.com|kultboy\.com/i;

/** Where a source opens: its scan, its archived copy, or the page itself (an old page through the Wayback Machine, nearest its date). */
function linkOf(s: { url: string | null; archiveUrl: string | null; date: string | null }): { href: string; label: string } | null {
  if (s.url && SCANS.test(s.url)) return { href: s.url, label: 'Scan' };
  if (s.archiveUrl) return { href: s.archiveUrl, label: 'Archived' };
  if (s.url) {
    const stamp = (s.date ?? '').replace(/-/g, '').padEnd(8, '0').slice(0, 8);
    return /^\d{8}$/.test(stamp) && Number(stamp.slice(0, 4)) < new Date().getFullYear() - 1 ? { href: `https://web.archive.org/web/${stamp}/${s.url}`, label: 'Archived' } : { href: s.url, label: 'Open' };
  }
  return null;
}

function Out({ link }: { link: { href: string; label: string } | null }) {
  if (!link) return null;
  return (
    <Anchor href={link.href} target="_blank" rel="noreferrer" size="xs" style={{ whiteSpace: 'nowrap' }}>
      {link.label} <IconExternalLink size={11} aria-hidden />
    </Anchor>
  );
}

function Card({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <Box p="sm" style={{ border: '1px solid var(--sc-line)', borderRadius: 10, background: 'var(--sc-surface)' }}>
      <Group justify="space-between" gap="xs" mb={6} wrap="nowrap">
        <Text fw={700} size="sm" ff="Fredoka, var(--mantine-font-family)">
          {title}
        </Text>
        {aside && (
          <Text size="xs" c="dimmed">
            {aside}
          </Text>
        )}
      </Group>
      <Stack gap={4}>{children}</Stack>
    </Box>
  );
}

/** Nothing of that kind for its era: said, so the page doesn't look broken. */
function Empty({ children }: { children: ReactNode }) {
  return (
    <Text size="xs" c="dimmed" p={8} style={{ border: '1px dashed var(--sc-line-strong)', borderRadius: 8 }}>
      {children}
    </Text>
  );
}

/** A review: the outlet and its score, then its date, issue and page, and where it opens. */
function ReviewLine({ r }: { r: RootsReview }) {
  const details = [when(r.date), r.issue ? `#${r.issue}` : null, r.page ? `p. ${r.page}` : null].filter(Boolean).join(' · ');
  return (
    <Stack gap={0} style={{ borderTop: '1px solid var(--sc-line)', paddingTop: 4 }}>
      <Group gap={8} wrap="nowrap" justify="space-between">
        <Text size="sm" style={{ minWidth: 0 }} lineClamp={1}>
          {r.outlet}
        </Text>
        <Text size="sm" fw={700} style={{ whiteSpace: 'nowrap' }}>
          {r.score}
        </Text>
      </Group>
      {(details || linkOf(r) || r.scan) && (
        <Group gap={8} wrap="nowrap" justify="space-between">
          <Text size="xs" c="dimmed">
            {details}
          </Text>
          <Group gap={8} wrap="nowrap">
            {/* The review in the owner's own scan, at its page (D191). */}
            {r.scan && (
              <Anchor component={Link} to={`/leaves/issue/${r.scan.issueId}?page=${r.scan.page}`} size="xs" fw={600}>
                Open your scan
              </Anchor>
            )}
            <Out link={linkOf(r)} />
          </Group>
        </Group>
      )}
    </Stack>
  );
}

function SourceLine({ s }: { s: RootsSource }) {
  return (
    <Group gap={8} wrap="nowrap" justify="space-between" style={{ borderTop: '1px solid var(--sc-line)', paddingTop: 4 }}>
      <Stack gap={0} style={{ minWidth: 0 }}>
        <Text size="sm" lineClamp={2}>
          {s.work && <b>{s.work}</b>}
          {s.work && s.title ? ' · ' : ''}
          {s.title}
        </Text>
        <Text size="xs" c="dimmed">
          {[when(s.date), s.issue ? `#${s.issue}` : null, s.page ? `p. ${s.page}` : null, s.language && !/^en/i.test(s.language) ? s.language : null].filter(Boolean).join(' · ')}
        </Text>
      </Stack>
      <Out link={linkOf(s)} />
    </Group>
  );
}

/** A video on a game's page (GET /api/v1/game/videos). */
export interface GameVideo {
  videoId: string;
  title: string;
  channel: string | null;
  publishedAt: string | null;
  source: 'pasted' | 'igdb' | 'channel' | 'cited';
  kind: string | null;
}

export interface GameVideos {
  status: 'off' | 'ready';
  time: GameVideo[];
  later: GameVideo[];
  keyed: boolean;
}

/**
 * The player (D168): YouTube's privacy-enhanced player in a window (the whole screen on a phone), full screen too; the
 * frame sends its origin, as YouTube's player needs (Squirrelcade's own pages send only same-origin referrers).
 */
export function VideoPlayer({ video, onClose }: { video: GameVideo | null; onClose: () => void }) {
  const narrow = useMediaQuery('(max-width: 48em)');
  return (
    <Modal opened={video !== null} onClose={onClose} size="xl" fullScreen={Boolean(narrow)} title={video?.title} centered>
      {video && (
        <Stack gap="xs">
          <AspectRatio ratio={16 / 9}>
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${video.videoId}?autoplay=1&rel=0`}
              title={video.title}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              style={{ border: 0, borderRadius: 8 }}
            />
          </AspectRatio>
          <Group justify="space-between" gap="xs">
            <Text size="xs" c="dimmed">
              {[video.channel, when(video.publishedAt)].filter(Boolean).join(' · ')}
            </Text>
            <Anchor href={`https://www.youtube.com/watch?v=${video.videoId}`} target="_blank" rel="noreferrer" size="xs">
              Watch on YouTube <IconExternalLink size={11} />
            </Anchor>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

/** Videos as a list: the thumbnail (kept on the server) with a play mark, the title, the channel and day. */
function VideoList({ videos, onPlay, onRemove, shownAtFirst }: { videos: GameVideo[]; onPlay: (v: GameVideo) => void; onRemove?: (v: GameVideo) => void; shownAtFirst: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? videos : videos.slice(0, shownAtFirst);
  return (
    <Stack gap={6}>
      {shown.map((v) => (
        <Group key={v.videoId} gap={8} wrap="nowrap" align="flex-start" style={{ borderTop: '1px solid var(--sc-line)', paddingTop: 6 }}>
          <UnstyledButton onClick={() => onPlay(v)} aria-label={`Play ${v.title}`} style={{ position: 'relative', flex: 'none', width: 112 }}>
            <AspectRatio ratio={16 / 9}>
              <Image src={`/api/v1/videos/thumb/${v.videoId}`} radius="sm" alt="" loading="lazy" fit="cover" />
            </AspectRatio>
            <Center style={{ position: 'absolute', inset: 0 }}>
              <span style={{ background: 'rgba(0,0,0,.6)', borderRadius: 999, padding: 6, display: 'inline-flex' }}>
                <IconPlayerPlayFilled size={14} color="white" />
              </span>
            </Center>
          </UnstyledButton>
          <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
            <Anchor component="button" type="button" size="sm" ta="left" lineClamp={2} onClick={() => onPlay(v)} c="var(--sc-text)">
              {v.title}
            </Anchor>
            <Text size="xs" c="dimmed">
              {[v.channel, when(v.publishedAt), v.source === 'igdb' ? 'from IGDB' : v.source === 'cited' ? 'cited in its article' : v.source === 'pasted' ? 'added by you' : null].filter(Boolean).join(' · ')}
            </Text>
          </Stack>
          {onRemove && v.source !== 'cited' && (
            <Tooltip label="Take it off this game">
              <UnstyledButton aria-label={`Take ${v.title} off this game`} onClick={() => onRemove(v)} c="dimmed">
                <IconX size={14} />
              </UnstyledButton>
            </Tooltip>
          )}
        </Group>
      ))}
      {videos.length > shownAtFirst && (
        <Anchor component="button" type="button" size="xs" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${videos.length}`}
        </Anchor>
      )}
    </Stack>
  );
}

/** A video pasted onto the game (the owner): its address, and whether it's from the game's time. */
/** Add a YouTube video: its date puts it under Of its time or Looking back (item 13: no switch to choose). */
function AddVideo({ platformKey, title }: { platformKey: string; title: string }) {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState('');
  const add = useMutation({
    mutationFn: () => api('/game/videos', { method: 'POST', json: { platform: platformKey, title, url, era: null } }),
    onSuccess: async () => {
      setUrl('');
      await queryClient.invalidateQueries({ queryKey: ['game', 'videos', platformKey, title] });
    },
    onError: (err) => notifyError(err),
  });
  return (
    <Stack gap={4} mt={6}>
      <Group gap={6} wrap="nowrap">
        <TextInput size="xs" placeholder="Paste a YouTube video's address" aria-label="A YouTube video's address" value={url} onChange={(e) => setUrl(e.currentTarget.value)} style={{ flex: 1 }} />
        <Button size="compact-sm" variant="light" disabled={!youtubeVideoId(url)} loading={add.isPending} onClick={() => add.mutate()}>
          Add
        </Button>
      </Group>
    </Stack>
  );
}

/** A series the game is in (GET /api/v1/series/of): how much of it you have. */
interface SeriesRef {
  name: string;
  had: number;
  total: number;
}

/** A series' game counted once, wherever you have it (GET /api/v1/series/games?by=game). */
interface SeriesTitle {
  key: string;
  title: string;
  released: string | null;
  coverId: string | null;
  had: boolean;
  consoles: { platformKey: string; platform: string; status: string }[];
}

/** How many of a series' games a game's page shows; the rest are on the Series page. */
const SERIES_SHOWN = 24;

/**
 * Its series (the owner: "I would like to be able to see the series from this game"): a chip for each series it's in,
 * the chosen one's games as box art (the ones you have in color, this one outlined), each opening its page.
 */
function GameSeries({ list, platformKey, title }: { list: SeriesRef[]; platformKey: string; title: string }) {
  const [chosen, setChosen] = useState(list[0]!.name);
  const s = list.find((x) => x.name === chosen) ?? list[0]!;
  const games = useQuery({ queryKey: ['series', 'by-game', s.name], queryFn: () => api<SeriesTitle[]>(`/series/games?name=${encodeURIComponent(s.name)}&by=game`) });
  const open = useOpenGame();
  const covers = useSetting('interface.showCoverArt', true);
  const shown = (games.data ?? []).slice(0, SERIES_SHOWN);
  const more = (games.data?.length ?? 0) - shown.length;
  return (
    <Stack gap="sm">
      {list.length > 1 && (
        <Group gap={6}>
          {list.map((x) => (
            <button key={x.name} type="button" className="sc-chip" data-tone={x.name === s.name ? 'have' : undefined} style={{ fontSize: 13 }} aria-pressed={x.name === s.name} onClick={() => setChosen(x.name)}>
              {x.name}
              <span className="sc-muted" style={{ fontWeight: 500 }}>
                {count(x.had)}/{count(x.total)}
              </span>
            </button>
          ))}
        </Group>
      )}
      <Group justify="space-between" gap="xs">
        <Text size="sm">
          {s.name}: you have <b>{count(s.had)}</b> of its {count(s.total)} games, a copy on any console counting.
        </Text>
        <Anchor component={Link} to={`/series?series=${encodeURIComponent(s.name)}`} size="sm">
          Open the series
        </Anchor>
      </Group>
      {games.isLoading ? (
        <Loader size="sm" />
      ) : (
        <SimpleGrid cols={{ base: 4, xs: 6, sm: 8 }} spacing={8} verticalSpacing={8}>
          {shown.map((x) => {
            const at = x.consoles.find((c) => c.status === 'owned') ?? x.consoles[0]!;
            const here = x.consoles.some((c) => c.platformKey === platformKey) && matchKey(x.title) === matchKey(title);
            return (
              <Tooltip key={x.key} label={`${x.title}${x.released ? ` (${x.released.slice(0, 4)})` : ''}${x.had ? ': you have it' : ''}`}>
                <UnstyledButton aria-label={x.title} onClick={() => open(at.platformKey, x.title)} style={{ borderRadius: 4, outline: here ? '2px solid var(--sc-cade)' : undefined, outlineOffset: 2 }}>
                  <AspectRatio ratio={3 / 4}>
                    {covers && x.coverId ? (
                      <Image src={igdbCoverUrl(x.coverId, 'cover_small')} radius="sm" alt="" loading="lazy" fit="cover" style={x.had ? undefined : { filter: 'grayscale(1)', opacity: 0.5 }} />
                    ) : (
                      <Center p={4} style={{ borderRadius: 'var(--mantine-radius-sm)', border: '1px solid var(--mantine-color-default-border)', opacity: x.had ? 1 : 0.6 }}>
                        <Text size="10px" ta="center" lineClamp={5}>
                          {x.title}
                        </Text>
                      </Center>
                    )}
                  </AspectRatio>
                </UnstyledButton>
              </Tooltip>
            );
          })}
        </SimpleGrid>
      )}
      {more > 0 && (
        <Text size="xs" c="dimmed">
          And {count(more)} more on the series' page.
        </Text>
      )}
    </Stack>
  );
}

function MentionLine({ m }: { m: RootsMention }) {
  const open = useOpenGame();
  return (
    <Stack gap={0} style={{ borderTop: '1px solid var(--sc-line)', paddingTop: 4 }}>
      <Group gap={6} wrap="wrap">
        <Anchor component="button" type="button" size="sm" fw={600} onClick={() => open(m.platformKey, m.catalogTitle)}>
          {m.catalogTitle}
        </Anchor>
        <Text size="xs" c="dimmed">
          {m.platform}
        </Text>
        {m.owned && (
          <span className="sc-chip" data-tone="have" style={{ fontSize: 11, padding: '0 8px' }}>
            <StashMark size={11} /> Have it
          </span>
        )}
        {!m.owned && m.missing && (
          <span className="sc-chip" data-tone="want" style={{ fontSize: 11, padding: '0 8px' }}>
            Not yet
          </span>
        )}
      </Group>
      <Text size="xs" c="dimmed" lineClamp={2}>
        {m.context}
      </Text>
    </Stack>
  );
}

/** The dated points of the game's time and since: its releases, the reviews of its time, re-releases and later notes. */
function Strip({ v, platformKey, title }: { v: RootsView; platformKey: string; title: string }) {
  // Its other releases from IGDB (D194): on other consoles, and its remakes and remasters.
  const more = useQuery({
    queryKey: ['game', 'releases', platformKey, title],
    queryFn: () => api<{ releases: { day: string; platform: string; title: string; kind: 'release' | 'remake' | 'remaster' }[] }>(`/game/releases?platform=${encodeURIComponent(platformKey)}&title=${encodeURIComponent(title)}`),
    staleTime: Infinity,
  });
  const points: { date: string; label: string; later: boolean }[] = [];
  const seen = new Set<string>();
  for (const r of v.releases) {
    const label = [r.platform, r.region].filter(Boolean).join(' ') || 'Release';
    const key = `${r.date}|${r.platform ?? ''}`;
    if (seen.has(key) || points.some((p) => p.date === r.date)) continue;
    seen.add(key);
    points.push({ date: r.date, label, later: v.firstRelease !== null && r.date.slice(0, 4) > String(Number(v.firstRelease.slice(0, 4)) + 1) });
  }
  for (const r of more.data?.releases ?? []) {
    if (points.some((p) => p.date === r.day || (p.date.slice(0, 7) === r.day.slice(0, 7) && p.label.includes(r.platform)))) continue;
    const label = r.kind === 'release' ? r.platform : `${r.kind === 'remake' ? 'Remake' : 'Remaster'}: ${r.platform}`;
    points.push({ date: r.day, label, later: v.firstRelease !== null && r.day.slice(0, 4) > String(Number(v.firstRelease.slice(0, 4)) + 1) });
  }
  const months = new Map<string, string[]>();
  for (const r of v.time.reviews) if (r.date) months.set(r.date.slice(0, 7), [...(months.get(r.date.slice(0, 7)) ?? []), r.outlet]);
  for (const [m, outlets] of [...months].slice(0, 4)) points.push({ date: m, label: outlets.slice(0, 2).join(', ') + (outlets.length > 2 ? ` +${outlets.length - 2}` : ''), later: false });
  for (const r of v.later.reviews.filter((x) => x.date).slice(0, 2)) points.push({ date: r.date!, label: r.outlet, later: true });
  const shown = points.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 12);
  if (shown.length < 2) return null;
  return (
    <Box style={{ overflowX: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${shown.length}, minmax(84px, 1fr))`, position: 'relative', paddingTop: 6, minWidth: shown.length * 84 }}>
        <div style={{ position: 'absolute', left: 8, right: 8, top: 12, height: 2, background: 'var(--sc-gold-fill)' }} />
        {shown.map((p) => (
          <Stack key={`${p.date}|${p.label}`} gap={2} align="center" style={{ textAlign: 'center' }}>
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: p.later ? 'var(--sc-line-strong)' : 'var(--sc-gold-fill)', border: '2px solid var(--sc-surface)', zIndex: 1 }} />
            <Text size="xs" fw={700}>
              {when(p.date)}
            </Text>
            <Text size="xs" c="dimmed" lineClamp={2}>
              {p.label}
            </Text>
          </Stack>
        ))}
      </div>
    </Box>
  );
}

/**
 * A game's Roots on its page (D165): the game in its own time and since, from its Wikipedia article (read when the
 * game is first opened, then at night): At the time (its magazines, the reviews of its day, the web as it was, videos
 * of its era), Where it came from (the games it drew on and led to, from your catalogs), and Looking back (later
 * reviews and writing, its awards, the reference sites). Its Top 100 place and why it matters come first, as before.
 */
/** A game page's tabs (item 13 of the owner's 1.3 list), the last one opened kept on this device. */
type GameTab = 'about' | 'videos' | 'magazines';
const GAME_TAB = 'squirrelcade-game-tab';

/**
 * A game's tabs, under its head and your collection (item 13 of the owner's 1.3 list): About (a short summary, its facts,
 * why it matters, its reviews of the time, its series, its Top 100 place and its timeline), Videos (of its time first,
 * then looking back) and Magazines (every issue that mentions it, and the reviews its article cites). Each label has
 * its count; a tab with nothing in it is faded and says why. The same in the drawer and on the full page.
 */
export function RootsPart({
  platformKey,
  title,
  history,
  summary = null,
  facts = null,
}: {
  platformKey: string;
  title: string;
  history: { why: HistoryText | null; top100: { rank: number; of: number } | null } | null;
  summary?: string | null;
  facts?: { genres: string[]; developers: string[]; publishers: string[] } | null;
}) {
  const leavesOn = useFeature('magazines');
  const narrow = useMediaQuery('(max-width: 48em)');
  const [tab, setTabState] = useState<GameTab>(() => {
    try {
      const kept = localStorage.getItem(GAME_TAB);
      return kept === 'videos' || kept === 'magazines' ? kept : 'about';
    } catch {
      return 'about';
    }
  });
  const setTab = (t: GameTab) => {
    setTabState(t);
    try {
      localStorage.setItem(GAME_TAB, t);
    } catch {
      // Private windows: the tab isn't kept.
    }
  };
  // Its mentions in your magazines, for the tab's count (the same answer In your magazines shows).
  const mentions = useQuery({
    queryKey: ['magazines', 'mentions', title],
    queryFn: () => api<{ mentions: { state: string }[] }>(`/game/magazines?title=${encodeURIComponent(title)}`),
    enabled: leavesOn,
    retry: false,
  });
  const queryClient = useQueryClient();
  const roots = useQuery({
    // Not under 'game': a copy's change refreshes the game's answers, never its Roots (read from Wikipedia and Wikidata).
    queryKey: ['roots', 'game', platformKey, title],
    queryFn: () => api<RootsView>(`/game/roots?platform=${encodeURIComponent(platformKey)}&title=${encodeURIComponent(title)}`),
    staleTime: 10 * 60_000,
    retry: false,
  });
  const v = roots.data;
  // The series it's in (the Nutshell's Series), for its own tab.
  const series = useQuery({
    queryKey: ['series', 'of', platformKey, title],
    queryFn: () => api<{ series: SeriesRef[] }>(`/series/of?platform=${encodeURIComponent(platformKey)}&title=${encodeURIComponent(title)}`),
    enabled: platformKey !== 'pc',
    staleTime: 5 * 60_000,
    retry: false,
  });
  const inSeries = series.data?.series ?? [];
  // Its videos (D168): pasted, IGDB's trailers, the channels'; with the videos its article cites, made playable.
  const videosQuery = useQuery({
    queryKey: ['game', 'videos', platformKey, title],
    queryFn: () => api<GameVideos>(`/game/videos?platform=${encodeURIComponent(platformKey)}&title=${encodeURIComponent(title)}`),
    enabled: platformKey !== 'pc',
    staleTime: 5 * 60_000,
    retry: false,
  });
  const canEdit = useCanEdit();
  const queryClient2 = useQueryClient();
  const shownAtFirst = useSetting('roots.videosShown', 6);
  const [playing, setPlaying] = useState<GameVideo | null>(null);
  const videosOn = videosQuery.data?.status === 'ready';
  const removeVideo = (video: GameVideo) =>
    void api(`/game/videos?platform=${encodeURIComponent(platformKey)}&title=${encodeURIComponent(title)}&video=${video.videoId}`, { method: 'DELETE' })
      .then(() => queryClient2.invalidateQueries({ queryKey: ['game', 'videos', platformKey, title] }))
      .catch((err: unknown) => notifyError(err));
  // The videos its article cites, as videos when they're YouTube's; the rest stay links.
  const cited = (v?.time.videos ?? []).flatMap((s) => {
    const id = s.url ? youtubeVideoId(s.url) : null;
    return id ? [{ videoId: id, title: s.title ?? s.work ?? 'Video', channel: s.work, publishedAt: s.date, source: 'cited' as const, kind: null }] : [];
  });
  const citedLinks = (v?.time.videos ?? []).filter((s) => !(s.url && youtubeVideoId(s.url)));
  const timeVideos = [...(videosQuery.data?.time ?? []), ...cited.filter((c) => !(videosQuery.data?.time ?? []).some((x) => x.videoId === c.videoId))];
  const laterVideos = videosQuery.data?.later ?? [];
  // Read just now (the first time the game is opened): the header's Metacritic score and stars come from it too.
  useEffect(() => {
    if (v?.status === 'ready' && v.readAt && Date.now() - new Date(v.readAt).getTime() < 60_000) {
      void queryClient.invalidateQueries({ queryKey: ['game', platformKey, title], exact: true });
    }
  }, [v?.readAt]);
  const year = v?.firstRelease ? Number(v.firstRelease.slice(0, 4)) : null;
  const ready = v?.status === 'ready' ? v : null;
  const videoCount = timeVideos.length + laterVideos.length + citedLinks.length;
  const magazineCount = (mentions.data?.mentions.filter((m) => m.state === 'linked').length ?? 0) + (ready?.time.magazines.length ?? 0);
  // Why a tab is empty, said on it (faded): no YouTube key, no magazines with it.
  const videosWhy = !videosOn ? 'Videos are off: Settings › Roots › Videos turns them on.' : videoCount === 0 ? (videosQuery.data?.keyed ? 'No video of it yet: the video channels are read at night.' : 'No video of it yet. With a YouTube key (Settings › Sources), the video channels are matched to your games.') : null;
  const magazinesWhy = magazineCount > 0 ? null : leavesOn ? 'None of your magazines mentions it yet (their text is read at night).' : 'Leaves, your magazine scans, is off (Settings › Features).';
  const released = [...new Map((ready?.releases ?? []).filter((r) => r.platform).map((r) => [r.platform!, r.date])).entries()];
  return (
    <Stack gap="sm">
      <VideoPlayer video={playing} onClose={() => setPlaying(null)} />
      <Tabs value={tab} onChange={(t) => t && setTab(t as GameTab)} keepMounted={false}>
        {/* The bar stays at the top while the page scrolls on a phone (item 13 of the owner's 1.3 list). */}
        <Tabs.List style={narrow ? { position: 'sticky', top: 0, zIndex: 3, background: 'var(--mantine-color-body)' } : undefined}>
          <Tabs.Tab value="about" leftSection={<RootsMark size={14} />}>
            About
          </Tabs.Tab>
          <Tabs.Tab value="videos" style={videosWhy ? { opacity: 0.55 } : undefined}>
            Videos{videoCount > 0 ? ` · ${videoCount}` : ''}
          </Tabs.Tab>
          <Tabs.Tab value="magazines" style={magazinesWhy ? { opacity: 0.55 } : undefined}>
            Magazines{magazineCount > 0 ? ` · ${magazineCount}` : ''}
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="about" pt="sm">
          <Stack gap="sm">
            {summary && (
              <Box>
                <Spoiler maxHeight={88} showLabel="More" hideLabel="Less" styles={{ control: { fontSize: 'var(--mantine-font-size-sm)' } }}>
                  <Text size="sm">{summary}</Text>
                </Spoiler>
                {ready?.article && (
                  <Anchor href={ready.article.url} target="_blank" rel="noreferrer" size="xs">
                    Read on Wikipedia
                  </Anchor>
                )}
              </Box>
            )}
            {(facts || released.length > 0) && (
              <SimpleGrid cols={{ base: 1, xs: 2 }} spacing={6} verticalSpacing={4}>
                {released.length > 0 && <Fact label="Released">{released.map(([p, d]) => `${p} ${when(d)}`).join(' · ')}</Fact>}
                {facts && facts.developers.length > 0 && <Fact label="Developer">{facts.developers.join(', ')}</Fact>}
                {facts && facts.publishers.length > 0 && <Fact label="Publisher">{facts.publishers.join(', ')}</Fact>}
                {facts && facts.genres.length > 0 && <Fact label="Genres">{facts.genres.join(', ')}</Fact>}
              </SimpleGrid>
            )}
            <DrawerHistory platformKey={platformKey} title={title} history={history} />
            {roots.isLoading && (
              <Group gap="xs">
                <Loader size="xs" />
                <Text size="sm" c="dimmed">
                  Reading its Wikipedia article…
                </Text>
              </Group>
            )}
            {v?.status === 'none' && (
              <Text size="sm" c="dimmed">
                Squirrelcade didn't find this game's Wikipedia article, so its reviews of the time aren't here.
              </Text>
            )}
            {inSeries.length > 0 && (
              <Stack gap={4}>
                <Text size="sm" fw={700}>
                  Its series
                </Text>
                <GameSeries list={inSeries} platformKey={platformKey} title={title} />
              </Stack>
            )}
            {ready && (
              <>
                <Strip v={ready} platformKey={platformKey} title={title} />
                {ready.aggregates.length > 0 && (
                  <Text size="sm">
                    {ready.aggregates.map((a, i) => (
                      <span key={a.outlet}>
                        {i > 0 && ' · '}
                        {a.outlet} <b>{a.score}</b>
                      </span>
                    ))}
                  </Text>
                )}
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                  <Card title="Reviews from the time" aside={ready.time.reviews.length > 0 ? `${ready.time.reviews.length} outlets` : undefined}>
                    {ready.time.reviews.length === 0 ? <Empty>Its article's review table has none from its time.</Empty> : ready.time.reviews.map((r, i) => <ReviewLine key={`${r.outlet}|${i}`} r={r} />)}
                  </Card>
                  <Card title="On the web, then">
                    {year !== null && year < 1995 ? (
                      <Empty>Game websites began in 1995 and 1996. Reviews written online later are under Looking back.</Empty>
                    ) : ready.time.web.length === 0 ? (
                      <Empty>No web page of its time is cited in its article.</Empty>
                    ) : (
                      ready.time.web.slice(0, 10).map((s, i) => <SourceLine key={`${s.url}|${i}`} s={s} />)
                    )}
                  </Card>
                  <Card title="What it came from">
                    {ready.cameFrom.length === 0 ? <Empty>Its article names no game it drew on that your catalogs have.</Empty> : ready.cameFrom.map((m) => <MentionLine key={`${m.platformKey}|${m.catalogTitle}`} m={m} />)}
                  </Card>
                  <Card title="What it led to">
                    {ready.ledTo.length === 0 ? <Empty>Its article names no game it led to that your catalogs have.</Empty> : ready.ledTo.map((m) => <MentionLine key={`${m.platformKey}|${m.catalogTitle}`} m={m} />)}
                  </Card>
                  <Card title="Looking back: reviews since">
                    {ready.later.reviews.length === 0 ? <Empty>No later review in its article's table.</Empty> : ready.later.reviews.map((r, i) => <ReviewLine key={`${r.outlet}|${i}`} r={r} />)}
                  </Card>
                  <Card title="Written since">
                    {ready.later.sources.length === 0 ? <Empty>Nothing later is cited in its article.</Empty> : ready.later.sources.slice(0, 15).map((s, i) => <SourceLine key={`${s.url}|${i}`} s={s} />)}
                  </Card>
                  {(ready.awards.length > 0 || ready.bestSelling) && (
                    <Card title="Honors">
                      {ready.bestSelling && (
                        <Text size="sm">
                          #{ready.bestSelling.rank} on{' '}
                          <Anchor href={ready.bestSelling.url} target="_blank" rel="noreferrer" size="sm">
                            Wikipedia's {ready.bestSelling.list.replace(/^List of /, '')}
                          </Anchor>
                        </Text>
                      )}
                      {ready.awards.map((a, i) => (
                        <Text key={`${a.name}|${i}`} size="sm">
                          ★ {a.name}
                          {a.year ? ` (${a.year})` : ''}
                        </Text>
                      ))}
                    </Card>
                  )}
                </SimpleGrid>
                {ready.sites.length > 0 && (
                  <Group gap={6}>
                    <Text size="xs" c="dimmed" fw={600}>
                      Learn more
                    </Text>
                    {ready.sites.map((s) => (
                      <Anchor key={s.name} href={s.url} target="_blank" rel="noreferrer" className="sc-chip" style={{ fontSize: 13 }}>
                        {s.name}
                      </Anchor>
                    ))}
                  </Group>
                )}
                <Text size="xs" c="dimmed">
                  From{' '}
                  <Tooltip label={`Read ${ready.readAt ? new Date(ready.readAt).toLocaleDateString() : ''}`}>
                    <Anchor href={ready.article!.url} target="_blank" rel="noreferrer" size="xs" inherit>
                      its Wikipedia article
                    </Anchor>
                  </Tooltip>{' '}
                  (CC BY-SA) and Wikidata. Its time is its first {ready.months} months.{' '}
                  <Anchor component={Link} to="/settings/roots" size="xs" inherit>
                    Settings › Roots
                  </Anchor>
                </Text>
              </>
            )}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="videos" pt="sm">
          <Stack gap="sm">
            {videosWhy && <Empty>{videosWhy}</Empty>}
            {(timeVideos.length > 0 || citedLinks.length > 0) && (
              <Card title="Of its time" aside={`${timeVideos.length + citedLinks.length}`}>
                {timeVideos.length > 0 && <VideoList videos={timeVideos} onPlay={setPlaying} onRemove={canEdit ? removeVideo : undefined} shownAtFirst={shownAtFirst} />}
                {citedLinks.map((s, i) => (
                  <SourceLine key={`${s.url}|${i}`} s={s} />
                ))}
              </Card>
            )}
            {laterVideos.length > 0 && (
              <Card title="Looking back" aside={`${laterVideos.length}`}>
                <VideoList videos={laterVideos} onPlay={setPlaying} onRemove={canEdit ? removeVideo : undefined} shownAtFirst={shownAtFirst} />
              </Card>
            )}
            {canEdit && videosOn && videosQuery.data?.keyed && <FindVideos platformKey={platformKey} title={title} />}
            {canEdit && videosOn && <AddVideo platformKey={platformKey} title={title} />}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="magazines" pt="sm">
          <Stack gap="sm">
            {magazinesWhy && <Empty>{magazinesWhy}</Empty>}
            {leavesOn && <InTheMagazines title={title} />}
            {ready && ready.time.magazines.length > 0 && (
              <Card title="Cited in its article" aside={`${ready.time.magazines.length}`}>
                {ready.time.magazines.slice(0, 20).map((s, i) => (
                  <SourceLine key={`${s.work}|${s.title}|${i}`} s={s} />
                ))}
              </Card>
            )}
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

/** A fact of a game, as a small label over its words (About). */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box>
      <Text size="xs" c="dimmed" fw={600}>
        {label}
      </Text>
      <Text size="sm">{children}</Text>
    </Box>
  );
}

/**
 * Find its videos (D193): each video channel searched for the game with YouTube's search (100 units a channel), for
 * the reviews a channel's upload list caps away (IGN's and GameSpot's before about 2018); the day's units left beside it.
 */
function FindVideos({ platformKey, title }: { platformKey: string; title: string }) {
  const queryClient = useQueryClient();
  const units = useQuery({ queryKey: ['videos', 'units'], queryFn: () => api<{ used: number; budget: number; left: number }>('/videos/units') });
  const find = useMutation({
    mutationFn: () => api<{ searched: string[]; skipped: string[]; found: number }>('/game/videos/find', { method: 'POST', json: { platform: platformKey, title } }),
    onSuccess: async (r) => {
      notifySuccess(
        `${r.found} video${r.found === 1 ? '' : 's'} found on ${r.searched.join(', ') || 'no channel'}${r.skipped.length > 0 ? `; ${r.skipped.join(', ')} left for tomorrow (today's YouTube budget is spent)` : ''}.`,
        'Find its videos',
      );
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['game', 'videos'] }), queryClient.invalidateQueries({ queryKey: ['videos', 'units'] })]);
    },
    onError: (err) => notifyError(err),
  });
  return (
    <Group gap="xs" mt={4} wrap="wrap">
      <Button size="compact-xs" variant="light" onClick={() => find.mutate()} loading={find.isPending} disabled={(units.data?.left ?? 0) < 100}>
        Find its videos
      </Button>
      {units.data && (
        <Text size="xs" c="dimmed">
          {units.data.left.toLocaleString()} of today's {units.data.budget.toLocaleString()} YouTube units left (100 a channel)
        </Text>
      )}
    </Group>
  );
}
