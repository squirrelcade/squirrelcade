import { ActionIcon, Anchor, Badge, Button, Card, Group, Image, Loader, SimpleGrid, Stack, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { igdbCoverUrl } from '@squirrelcade/core';
import { IconChevronLeft, IconChevronRight, IconChevronsLeft, IconChevronsRight, IconPlayerPlay } from '@tabler/icons-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../api';
import { ConsoleMark, useOwnedMarks } from '../ConsoleMark';
import { date as showDate } from '../format';
import { useOpenGame } from '../GameDrawer';
import { notifyError, useSetting } from '../hooks';
import { VideoPlayer, type GameVideo, type GameVideos } from '../RootsPart';

/** A game out in a window (GET /api/v1/history/now-in, /history/day). */
interface WindowGame {
  title: string;
  day: string;
  consoles: { key: string; name: string }[];
  rating: number | null;
  ratingCount: number;
  coverId: string | null;
  top100: boolean;
  /** Its reviews in your magazines (D192). */
  reviews?: { issueId: number; issue: string; page: number; score: string | null }[];
}

/** A magazine issue on sale then (Leaves). */
interface WindowIssue {
  id: number;
  label: string;
  magazine: string;
  version: number;
}

export interface MediaWindow {
  date: string;
  label: string;
  from: string;
  to: string;
  games: WindowGame[];
  magazines: WindowIssue[];
}

/** An issue's cover from Leaves, made small on the server (D182). */
const coverUrl = (issueId: number, version: number) => `/api/v1/magazines/issues/${issueId}/pages/1?v=${version}&w=${Math.ceil(120 * (window.devicePixelRatio || 1))}`;

/** One game of a window: its cover, title and day, its consoles' marks (yours in color), its trailer. */
function GameLine({ g, onTrailer, loading }: { g: WindowGame; onTrailer: (g: WindowGame) => void; loading: boolean }) {
  const owned = useOwnedMarks()(g.title);
  const open = useOpenGame();
  const dateFormat = useSetting('general.dateFormat', 'us');
  return (
    <Group gap="sm" wrap="nowrap" align="flex-start">
      {g.coverId ? <Image src={igdbCoverUrl(g.coverId, 'cover_small')} w={36} h={48} radius={3} fit="cover" alt="" loading="lazy" /> : <div style={{ width: 36, height: 48, flex: 'none' }} />}
      <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
        <Group gap={6} wrap="wrap">
          <Anchor component="button" type="button" fw={600} size="sm" ta="left" onClick={() => open(g.consoles[0]!.key, g.title)}>
            {g.title}
          </Anchor>
          {g.top100 && (
            <Badge size="xs" variant="light" color="yellow">
              Top 100
            </Badge>
          )}
        </Group>
        <Group gap={6} wrap="wrap">
          {g.consoles.map((c) => (
            <ConsoleMark key={c.key} platformKey={c.key} name={c.name} owned={owned.includes(c.key)} size={14} onClick={() => open(c.key, g.title)} />
          ))}
          <Text size="xs" c="dimmed">
            {showDate(g.day, dateFormat)}
            {g.rating !== null ? ` · rated ${Math.round(g.rating)} (${g.ratingCount})` : ''}
          </Text>
        </Group>
        {(g.reviews ?? []).map((r) => (
          <Anchor key={`${r.issueId}-${r.page}`} component={Link} to={`/leaves/issue/${r.issueId}?page=${r.page}`} size="xs">
            {r.issue}, p. {r.page}
            {r.score ? `: ${r.score}` : ''}
          </Anchor>
        ))}
      </Stack>
      <Tooltip label="Its trailer" openDelay={300}>
        <ActionIcon variant="light" onClick={() => onTrailer(g)} loading={loading} aria-label={`The trailer of ${g.title}`}>
          <IconPlayerPlay size={16} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}

/** A window: the games out in it, most important first, and the magazines on sale (each opening in the reader). */
export function WindowView({ w, heading }: { w: MediaWindow; heading?: string }) {
  const dateFormat = useSetting('general.dateFormat', 'us');
  const [playing, setPlaying] = useState<GameVideo | null>(null);
  // A game's trailer: IGDB's own (Roots keeps it once found), else a channel's video of its time.
  const trailer = useMutation({
    mutationFn: async (g: WindowGame) => {
      const v = await api<GameVideos>(`/game/videos?platform=${encodeURIComponent(g.consoles[0]!.key)}&title=${encodeURIComponent(g.title)}`);
      const all = [...v.time, ...v.later];
      return all.find((x) => x.kind === 'trailer') ?? all[0] ?? null;
    },
    onSuccess: (v, g) => (v ? setPlaying(v) : notifyError(new Error(`No trailer of ${g.title} is known yet (Roots' videos need to be on).`), 'No trailer')),
    onError: (err) => notifyError(err),
  });
  return (
    <Card withBorder padding="sm">
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap" gap={4}>
          <Title order={3} size="h4">
            {heading ?? w.label}
          </Title>
          <Text size="xs" c="dimmed">
            {showDate(w.from, dateFormat)} to {showDate(w.to, dateFormat)}
          </Text>
        </Group>
        {w.games.length === 0 && w.magazines.length === 0 ? (
          <Text size="sm" c="dimmed">
            Nothing came out in these days, as far as Squirrelcade knows (IGDB's lists of your consoles and the ones you follow), and no magazine of yours was on sale.
          </Text>
        ) : (
          <>
            {w.games.length > 0 ? (
              <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm" verticalSpacing="xs">
                {w.games.map((g) => (
                  <GameLine key={g.title} g={g} onTrailer={(x) => trailer.mutate(x)} loading={trailer.isPending && trailer.variables?.title === g.title} />
                ))}
              </SimpleGrid>
            ) : (
              <Text size="sm" c="dimmed">
                No games came out in these days, as far as Squirrelcade knows.
              </Text>
            )}
            {w.magazines.length > 0 && (
              <Stack gap={4}>
                <Text size="xs" tt="uppercase" fw={700} c="dimmed">
                  On sale then
                </Text>
                <Group gap="sm" wrap="wrap" align="flex-start">
                  {w.magazines.map((m) => (
                    <Anchor key={m.id} component={Link} to={`/leaves/issue/${m.id}`} underline="never" w={90}>
                      <Image src={coverUrl(m.id, m.version)} w={90} h={120} radius="sm" fit="cover" alt="" loading="lazy" />
                      <Text size="xs" lineClamp={2} mt={2}>
                        {m.label}
                      </Text>
                    </Anchor>
                  ))}
                </Group>
              </Stack>
            )}
          </>
        )}
      </Stack>
      <VideoPlayer video={playing} onClose={() => setPlaying(null)} />
    </Card>
  );
}

/** Now in (D190): today's day and month, a decade back at a time. */
export function NowInPanel() {
  const data = useQuery({ queryKey: ['history', 'now-in'], queryFn: () => api<{ today: string; windows: MediaWindow[] }>('/history/now-in') });
  if (!data.data) return data.isError ? <Text c="red">Now in couldn't be shown.</Text> : <Loader />;
  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed" maw={760}>
        Today, a decade back at a time: the games that came out around this day, the most important first (yours in color), and the magazines of yours on sale then. Any
        other day is in the{' '}
        <Anchor component={Link} to="/roots?view=time-machine">
          Time machine
        </Anchor>
        .
      </Text>
      {data.data.windows.map((w) => (
        <WindowView key={w.date} w={w} />
      ))}
    </Stack>
  );
}

const move = (day: string, by: 'day' | 'week' | 'month', n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  if (by === 'month') d.setUTCMonth(d.getUTCMonth() + n);
  else d.setUTCDate(d.getUTCDate() + n * (by === 'week' ? 7 : 1));
  return d.toISOString().slice(0, 10);
};

/** The Time machine (D190): the same window for any date, a day, week or month at a time. */
export function TimeMachinePanel() {
  const [params, setParams] = useSearchParams();
  const tenYears = move(new Date().toISOString().slice(0, 10), 'month', -120);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date')! : tenYears;
  const go = (d: string) => setParams((p) => ({ ...Object.fromEntries(p), date: d }), { replace: true });
  const data = useQuery({ queryKey: ['history', 'day', day], queryFn: () => api<MediaWindow>(`/history/day?date=${day}`), placeholderData: (prev) => prev });
  const step = (by: 'day' | 'week' | 'month', label: string) => (
    <Group gap={2} wrap="nowrap">
      <ActionIcon variant="default" onClick={() => go(move(day, by, -1))} aria-label={`A ${label} back`}>
        {by === 'day' ? <IconChevronLeft size={16} /> : <IconChevronsLeft size={16} />}
      </ActionIcon>
      <Text size="xs" c="dimmed" w={36} ta="center">
        {label}
      </Text>
      <ActionIcon variant="default" onClick={() => go(move(day, by, 1))} aria-label={`A ${label} on`}>
        {by === 'day' ? <IconChevronRight size={16} /> : <IconChevronsRight size={16} />}
      </ActionIcon>
    </Group>
  );
  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed" maw={760}>
        Any day: the games that came out around it and the magazines of yours on sale then.
      </Text>
      <Group gap="md" wrap="wrap" align="flex-end">
        <TextInput label="The day" type="date" value={day} onChange={(e) => e.currentTarget.value && go(e.currentTarget.value)} w={170} />
        {step('day', 'day')}
        {step('week', 'week')}
        {step('month', 'month')}
        <Button variant="subtle" size="compact-sm" onClick={() => go(tenYears)}>
          Ten years ago today
        </Button>
      </Group>
      {data.data ? <WindowView w={data.data} heading={new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { dateStyle: 'full' })} /> : data.isError ? <Text c="red">That day couldn't be shown.</Text> : <Loader />}
    </Stack>
  );
}
