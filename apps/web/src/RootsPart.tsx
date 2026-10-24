import { Anchor, AspectRatio, Box, Center, Group, Image, Loader, SimpleGrid, Stack, Tabs, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { igdbCoverUrl, matchKey } from '@squirrelcade/core';
import { IconExternalLink } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { RootsMark, StashMark } from './Acorn';
import { api } from './api';
import { count } from './format';
import { useOpenGame } from './GameDrawer';
import { useSetting } from './hooks';
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
      {(details || linkOf(r)) && (
        <Group gap={8} wrap="nowrap" justify="space-between">
          <Text size="xs" c="dimmed">
            {details}
          </Text>
          <Out link={linkOf(r)} />
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
function Strip({ v }: { v: RootsView }) {
  const points: { date: string; label: string; later: boolean }[] = [];
  const seen = new Set<string>();
  for (const r of v.releases) {
    const label = [r.platform, r.region].filter(Boolean).join(' ') || 'Release';
    const key = `${r.date}|${r.platform ?? ''}`;
    if (seen.has(key) || points.some((p) => p.date === r.date)) continue;
    seen.add(key);
    points.push({ date: r.date, label, later: v.firstRelease !== null && r.date.slice(0, 4) > String(Number(v.firstRelease.slice(0, 4)) + 1) });
  }
  const months = new Map<string, string[]>();
  for (const r of v.time.reviews) if (r.date) months.set(r.date.slice(0, 7), [...(months.get(r.date.slice(0, 7)) ?? []), r.outlet]);
  for (const [m, outlets] of [...months].slice(0, 4)) points.push({ date: m, label: outlets.slice(0, 2).join(', ') + (outlets.length > 2 ? ` +${outlets.length - 2}` : ''), later: false });
  for (const r of v.later.reviews.filter((x) => x.date).slice(0, 2)) points.push({ date: r.date!, label: r.outlet, later: true });
  const shown = points.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 9);
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
export function RootsPart({ platformKey, title, history }: { platformKey: string; title: string; history: { why: HistoryText | null; top100: { rank: number; of: number } | null } | null }) {
  const queryClient = useQueryClient();
  const roots = useQuery({
    queryKey: ['game', 'roots', platformKey, title],
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
  // Read just now (the first time the game is opened): the header's Metacritic score and stars come from it too.
  useEffect(() => {
    if (v?.status === 'ready' && v.readAt && Date.now() - new Date(v.readAt).getTime() < 60_000) {
      void queryClient.invalidateQueries({ queryKey: ['game', platformKey, title], exact: true });
    }
  }, [v?.readAt]);
  if (!history && (!v || v.status === 'off')) {
    // Roots off: its series still shows.
    return inSeries.length > 0 ? (
      <Stack gap="xs">
        <Text fw={700}>Its series</Text>
        <GameSeries list={inSeries} platformKey={platformKey} title={title} />
      </Stack>
    ) : null;
  }
  const year = v?.firstRelease ? Number(v.firstRelease.slice(0, 4)) : null;
  return (
    <Stack gap="sm">
      <Group justify="space-between" gap="xs">
        <Group gap={8}>
          <RootsMark size={18} />
          <Text fw={700} ff="Fredoka, var(--mantine-font-family)" fz={18}>
            Roots
          </Text>
        </Group>
        <Anchor component={Link} to="/settings/roots" size="xs" c="dimmed">
          Settings › Roots
        </Anchor>
      </Group>
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
      {v?.status !== 'ready' && inSeries.length > 0 && (
        <>
          <Text size="sm" fw={700}>
            Its series
          </Text>
          <GameSeries list={inSeries} platformKey={platformKey} title={title} />
        </>
      )}
      {v?.status === 'ready' && (
        <>
          <Strip v={v} />
          {v.aggregates.length > 0 && (
            <Text size="sm">
              {v.aggregates.map((a, i) => (
                <span key={a.outlet}>
                  {i > 0 && ' · '}
                  {a.outlet} <b>{a.score}</b>
                </span>
              ))}
            </Text>
          )}
          <Tabs defaultValue="time" keepMounted={false}>
            <Tabs.List>
              <Tabs.Tab value="time">At the time</Tabs.Tab>
              <Tabs.Tab value="from">Where it came from</Tabs.Tab>
              <Tabs.Tab value="later">Looking back</Tabs.Tab>
              {inSeries.length > 0 && <Tabs.Tab value="series">Its series</Tabs.Tab>}
            </Tabs.List>
            {inSeries.length > 0 && (
              <Tabs.Panel value="series" pt="sm">
                <GameSeries list={inSeries} platformKey={platformKey} title={title} />
              </Tabs.Panel>
            )}
            <Tabs.Panel value="time" pt="sm">
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                <Card title="In the magazines" aside={v.time.magazines.length > 0 ? `${v.time.magazines.length}` : undefined}>
                  {v.time.magazines.length === 0 ? (
                    <Empty>{year && year >= 2010 ? 'Reviews of its day were mostly online: see Reviews from the time.' : 'No magazine of its day is cited in its article.'}</Empty>
                  ) : (
                    v.time.magazines.slice(0, 12).map((s, i) => <SourceLine key={`${s.work}|${s.title}|${i}`} s={s} />)
                  )}
                </Card>
                <Stack gap="sm">
                  <Card title="Reviews from the time" aside={v.time.reviews.length > 0 ? `${v.time.reviews.length} outlets` : undefined}>
                    {v.time.reviews.length === 0 ? <Empty>Its article's review table has none from its time.</Empty> : v.time.reviews.map((r, i) => <ReviewLine key={`${r.outlet}|${i}`} r={r} />)}
                  </Card>
                  <Card title="On the web, then">
                    {year !== null && year < 1995 ? (
                      <Empty>Game websites began in 1995 and 1996. Reviews written online later are under Looking back.</Empty>
                    ) : v.time.web.length === 0 ? (
                      <Empty>No web page of its time is cited in its article.</Empty>
                    ) : (
                      v.time.web.slice(0, 10).map((s, i) => <SourceLine key={`${s.url}|${i}`} s={s} />)
                    )}
                  </Card>
                  <Card title="Videos of the day">
                    {v.time.videos.length > 0 ? (
                      v.time.videos.map((s, i) => <SourceLine key={`${s.url}|${i}`} s={s} />)
                    ) : year !== null && year < 2005 ? (
                      <Empty>{year} is before YouTube: commercials and TV segments of its day will come with Roots' video channels.</Empty>
                    ) : (
                      <Empty>The video reviews of its day will come with Roots' video channels.</Empty>
                    )}
                  </Card>
                </Stack>
              </SimpleGrid>
            </Tabs.Panel>
            <Tabs.Panel value="from" pt="sm">
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                <Card title="What it came from">
                  {v.cameFrom.length === 0 ? <Empty>Its article names no game it drew on that your catalogs have.</Empty> : v.cameFrom.map((m) => <MentionLine key={`${m.platformKey}|${m.catalogTitle}`} m={m} />)}
                </Card>
                <Card title="What it led to">
                  {v.ledTo.length === 0 ? <Empty>Its article names no game it led to that your catalogs have.</Empty> : v.ledTo.map((m) => <MentionLine key={`${m.platformKey}|${m.catalogTitle}`} m={m} />)}
                </Card>
              </SimpleGrid>
            </Tabs.Panel>
            <Tabs.Panel value="later" pt="sm">
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                <Stack gap="sm">
                  <Card title="Reviews since">
                    {v.later.reviews.length === 0 ? <Empty>No later review in its article's table.</Empty> : v.later.reviews.map((r, i) => <ReviewLine key={`${r.outlet}|${i}`} r={r} />)}
                  </Card>
                  {(v.awards.length > 0 || v.bestSelling) && (
                    <Card title="Honors">
                      {v.bestSelling && (
                        <Text size="sm">
                          #{v.bestSelling.rank} on{' '}
                          <Anchor href={v.bestSelling.url} target="_blank" rel="noreferrer" size="sm">
                            Wikipedia's {v.bestSelling.list.replace(/^List of /, '')}
                          </Anchor>
                        </Text>
                      )}
                      {v.awards.map((a, i) => (
                        <Text key={`${a.name}|${i}`} size="sm">
                          ★ {a.name}
                          {a.year ? ` (${a.year})` : ''}
                        </Text>
                      ))}
                    </Card>
                  )}
                </Stack>
                <Card title="Written since">
                  {v.later.sources.length === 0 ? <Empty>Nothing later is cited in its article.</Empty> : v.later.sources.slice(0, 15).map((s, i) => <SourceLine key={`${s.url}|${i}`} s={s} />)}
                </Card>
              </SimpleGrid>
              <Text size="xs" c="dimmed" fw={600} mt="sm" mb={4}>
                Learn more
              </Text>
              <Group gap={6}>
                {v.sites.map((s) => (
                  <Anchor key={s.name} href={s.url} target="_blank" rel="noreferrer" className="sc-chip" style={{ fontSize: 13 }}>
                    {s.name}
                  </Anchor>
                ))}
              </Group>
            </Tabs.Panel>
          </Tabs>
          <Text size="xs" c="dimmed">
            From{' '}
            <Tooltip label={`Read ${v.readAt ? new Date(v.readAt).toLocaleDateString() : ''}`}>
              <Anchor href={v.article!.url} target="_blank" rel="noreferrer" size="xs" inherit>
                its Wikipedia article
              </Anchor>
            </Tooltip>{' '}
            (CC BY-SA) and Wikidata. At the time is its first {v.months} months.
          </Text>
        </>
      )}
    </Stack>
  );
}
