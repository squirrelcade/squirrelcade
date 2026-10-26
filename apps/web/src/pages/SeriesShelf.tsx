import { Anchor, AspectRatio, Badge, Box, Card, Center, Group, Image, Loader, Progress, SegmentedControl, SimpleGrid, Stack, Table, Text, TextInput, UnstyledButton } from '@mantine/core';
import { igdbCoverUrl } from '@squirrelcade/core';
import { IconArrowLeft, IconSearch } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { StashMark } from '../Acorn';
import { api } from '../api';
import { PageHeader } from '../components';
import { count } from '../format';
import { GameTitle, useOpenGame } from '../GameDrawer';
import { jumpMark, LetterBar, useListView, ViewSwitch } from '../GameViews';
import { usePageTitle, useSetting, useSettings } from '../hooks';
import { ConsoleMark } from '../ConsoleMark';

/** A series counted by game (GET /api/v1/series?by=game). */
interface SeriesByGame {
  name: string;
  had: number;
  total: number;
  onPc: number;
  percent: number;
  coverId: string | null;
  consoles: number;
  custom?: boolean;
}

/** A series' game counted once, wherever you have it (GET /api/v1/series/games?by=game). */
interface SeriesTitle {
  key: string;
  title: string;
  released: string | null;
  coverId: string | null;
  had: boolean;
  onPc: boolean;
  consoles: { platformKey: string; platform: string; status: string }[];
  original?: { title: string; released: string | null; kind: 'remake' | 'remaster' | 'version' };
}

const ORDERS = {
  had: (a: SeriesByGame, b: SeriesByGame) => b.had - a.had || b.percent - a.percent || a.name.localeCompare(b.name),
  closest: (a: SeriesByGame, b: SeriesByGame) => a.total - a.had - (b.total - b.had) || b.had - a.had || a.name.localeCompare(b.name),
  name: (a: SeriesByGame, b: SeriesByGame) => a.name.localeCompare(b.name),
};

const GAME_ORDERS = {
  year: null,
  missing: (a: SeriesTitle, b: SeriesTitle) => Number(a.had) - Number(b.had),
  name: (a: SeriesTitle, b: SeriesTitle) => a.title.localeCompare(b.title),
};

/** Box art, or the name on a plain tile when there's none (or covers are off); grey for a game you don't have. */
function Art({ coverId, name, dim = false }: { coverId: string | null; name: string; dim?: boolean }) {
  const covers = useSetting('interface.showCoverArt', true);
  return (
    <AspectRatio ratio={3 / 4}>
      {covers && coverId ? (
        <Image src={igdbCoverUrl(coverId, 'cover_big')} radius="sm" alt="" loading="lazy" fit="cover" style={dim ? { filter: 'grayscale(1)', opacity: 0.5 } : undefined} />
      ) : (
        <Center p={6} style={{ borderRadius: 'var(--mantine-radius-sm)', border: '1px solid var(--mantine-color-default-border)', opacity: dim ? 0.6 : 1 }}>
          <Text size="xs" ta="center" lineClamp={5}>
            {name}
          </Text>
        </Center>
      )}
    </AspectRatio>
  );
}

/** How much of a series you have: the bar (PC apart, after it) and its words. */
function HadBar({ had, total, onPc }: { had: number; total: number; onPc: number }) {
  return (
    <Stack gap={2}>
      <Progress.Root size="sm" aria-label={`${had} of ${total} games`}>
        <Progress.Section value={(had / Math.max(1, total)) * 100} color="teal" />
        <Progress.Section value={(onPc / Math.max(1, total)) * 100} color="blue" />
      </Progress.Root>
      <Text size="xs" c="dimmed">
        {count(had)} of {count(total)}
        {onPc > 0 ? ` · +${count(onPc)} on PC` : ''}
      </Text>
    </Stack>
  );
}

/** One series' games as box art, the ones you have in color, each with the consoles it came out on. */
function SeriesGames({ name }: { name: string }) {
  const open = useOpenGame();
  const [order, setOrder] = useState<keyof typeof GAME_ORDERS>('year');
  const [view, setView] = useListView('series-games', 'covers');
  const games = useQuery({ queryKey: ['series', 'by-game', name], queryFn: () => api<SeriesTitle[]>(`/series/games?name=${encodeURIComponent(name)}&by=game`) });
  if (games.isLoading) return <Loader />;
  if (!games.data) return <Text size="sm">No series of that name in your catalogs.</Text>;
  const had = games.data.filter((g) => g.had).length;
  const onPc = games.data.filter((g) => g.onPc).length;
  const sort = GAME_ORDERS[order];
  const sorted = sort ? [...games.data].sort(sort) : games.data;
  return (
    <Stack gap="sm">
      <Group gap="sm" wrap="wrap" justify="space-between">
        <Box w={260}>
          <HadBar had={had} total={games.data.length} onPc={onPc} />
        </Box>
        <Group gap="xs">
          <SegmentedControl
            size="xs"
            value={order}
            onChange={(v) => setOrder(v as keyof typeof GAME_ORDERS)}
            aria-label="Order of the series' games"
            data={[
              { value: 'year', label: 'Release order' },
              { value: 'missing', label: 'Missing first' },
              { value: 'name', label: 'A to Z' },
            ]}
          />
          <ViewSwitch value={view} onChange={setView} />
        </Group>
      </Group>
      <LetterBar titles={sorted.map((g) => g.title)} inTitleOrder={order === 'name'} sortByTitle={() => setOrder('name')} />
      {view === 'table' ? (
        <Table.ScrollContainer minWidth={560}>
          <Table striped highlightOnHover verticalSpacing={6}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Game</Table.Th>
                <Table.Th>Year</Table.Th>
                <Table.Th>Consoles</Table.Th>
                <Table.Th>Yours</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {sorted.map((g, i) => {
                const at = g.consoles.find((c) => c.status === 'owned') ?? g.consoles[0]!;
                return (
                  <Table.Tr key={g.key} {...jumpMark(i)}>
                    <Table.Td>
                      <GameTitle platformKey={at.platformKey} title={g.title} fw={g.had ? 600 : undefined} />
                      {g.original && (
                        <Text size="xs" c="dimmed">
                          {g.original.kind === 'version' ? 'a version' : g.original.kind} of {g.original.title}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>{g.released?.slice(0, 4) ?? ''}</Table.Td>
                    <Table.Td>
                      <Group gap={4} wrap="wrap">
                        {g.consoles.map((c) => (
                          <ConsoleMark key={c.platformKey} platformKey={c.platformKey} name={c.platform} owned={c.status === 'owned'} size={14} />
                        ))}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      {g.had ? (
                        <Badge size="sm" variant="light" color="teal" leftSection={<StashMark size={11} />} style={{ textTransform: 'none' }}>
                          Have it
                        </Badge>
                      ) : g.onPc ? (
                        <Badge size="sm" variant="light" color="blue" style={{ textTransform: 'none' }}>
                          On PC
                        </Badge>
                      ) : null}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      ) : (
      <SimpleGrid cols={{ base: 3, xs: 4, sm: 5, md: 6, lg: 8 }} spacing="sm" verticalSpacing="md">
        {sorted.map((g, i) => {
          // The page it opens: a console you have it on, else its first.
          const at = g.consoles.find((c) => c.status === 'owned') ?? g.consoles[0]!;
          return (
            <Stack key={g.key} gap={4} {...jumpMark(i)}>
              <Box aria-hidden="true" style={{ cursor: 'pointer' }} onClick={() => open(at.platformKey, g.title)}>
                <Art coverId={g.coverId} name={g.title} dim={!g.had} />
              </Box>
              <Group gap={4} wrap="nowrap" align="flex-start">
                {g.had && (
                  <span style={{ flex: 'none', marginTop: 2 }}>
                    <StashMark size={11} />
                  </span>
                )}
                <Text size="xs" lineClamp={2} component="div" fw={g.had ? 600 : undefined}>
                  <GameTitle platformKey={at.platformKey} title={g.title} size="xs" />
                </Text>
              </Group>
              <Text size="xs" c="dimmed" lineClamp={3}>
                {[
                  g.released?.slice(0, 4) ?? null,
                  g.consoles.map((c) => (c.status === 'owned' ? `${c.platform} ✓` : c.platform)).join(', '),
                  g.original ? `${g.original.kind === 'version' ? 'a version' : g.original.kind} of ${g.original.title}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              {g.onPc && (
                <Badge size="xs" variant="light" color="blue" w="fit-content">
                  On PC
                </Badge>
              )}
            </Stack>
          );
        })}
      </SimpleGrid>
      )}
    </Stack>
  );
}

/**
 * Nutshell > Series (the owner's idea, 2026-10-23: "put game series on there... similar to this on Big Box... As
 * long as we have one copy somewhere, it counts for that game"): each series you have a game of as box art, its
 * games counted once whatever consoles they came out on, PC apart. Sets > Series counts each console's apart.
 */
export function SeriesShelfPage() {
  const { data: settings } = useSettings();
  const [params, setParams] = useSearchParams();
  const named = params.get('series');
  usePageTitle(named ?? 'Series', settings?.['general.instanceName'] || 'Squirrelcade');
  const list = useQuery({ queryKey: ['series', 'by-game'], queryFn: () => api<SeriesByGame[]>('/series?by=game') });
  const hidden = useSetting('collection.seriesHidden', [] as string[]);
  const [filter, setFilter] = useState('');
  const [order, setOrder] = useState<keyof typeof ORDERS>('had');
  const [view, setView] = useListView('series', 'covers');

  if (named) {
    return (
      <>
        <Anchor component={Link} to="/series" size="sm" mb={4} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <IconArrowLeft size={14} /> All series
        </Anchor>
        <PageHeader help="sets" title={named} description="Every game of the series counted once: a copy on any console counts for it. In color, the ones you have; PC copies are counted apart." />
        <SeriesGames name={named} />
      </>
    );
  }

  const phrase = filter.trim().toLowerCase();
  const shown = (list.data ?? []).filter((s) => !hidden.includes(s.name) && (!phrase || s.name.toLowerCase().includes(phrase))).sort(ORDERS[order]);
  return (
    <>
      <PageHeader
        help="sets"
        title="Series"
        description="The series you have a game of, each game counted once: a copy on any console counts for it. PC games are counted apart. Sets > Series counts each console's games instead."
      />
      {list.isLoading ? (
        <Loader />
      ) : (list.data ?? []).length === 0 ? (
        <Card withBorder>
          <Text size="sm">No series yet. Series come from IGDB's details of your consoles' games (Settings &gt; Sources &gt; IGDB), once you have a game of one, and from series of your own (Sets &gt; Series &gt; Set up).</Text>
        </Card>
      ) : (
        <Stack gap="sm">
          <Group gap="sm">
            <TextInput placeholder="Filter by series" aria-label="Filter by series" leftSection={<IconSearch size={16} />} value={filter} onChange={(e) => setFilter(e.currentTarget.value)} w={240} />
            <SegmentedControl
              size="xs"
              value={order}
              onChange={(v) => setOrder(v as keyof typeof ORDERS)}
              aria-label="Order of the series"
              data={[
                { value: 'had', label: 'Most had' },
                { value: 'closest', label: 'Fewest missing' },
                { value: 'name', label: 'A to Z' },
              ]}
            />
            <ViewSwitch value={view} onChange={setView} />
            <Text size="xs" c="dimmed">
              {count(shown.length)} series
            </Text>
          </Group>
          <LetterBar titles={shown.map((s) => s.name)} inTitleOrder={order === 'name'} sortByTitle={() => setOrder('name')} />
          {view === 'table' ? (
            <Table.ScrollContainer minWidth={520}>
              <Table striped highlightOnHover verticalSpacing={6}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Series</Table.Th>
                    <Table.Th>Yours</Table.Th>
                    <Table.Th w={200}>How much</Table.Th>
                    <Table.Th>Consoles</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {shown.map((s, i) => (
                    <Table.Tr key={s.name} {...jumpMark(i)} style={{ cursor: 'pointer' }} onClick={() => setParams({ series: s.name })}>
                      <Table.Td>
                        <Anchor component="button" type="button" fw={600} size="sm" onClick={() => setParams({ series: s.name })}>
                          {s.name}
                        </Anchor>
                        {s.custom && (
                          <Badge size="xs" variant="light" color="gray" ml={6}>
                            Yours
                          </Badge>
                        )}
                      </Table.Td>
                      <Table.Td>
                        {count(s.had)} of {count(s.total)}
                        {s.onPc > 0 ? ` · +${count(s.onPc)} on PC` : ''}
                      </Table.Td>
                      <Table.Td>
                        <Progress.Root size="sm" aria-label={`${s.had} of ${s.total} games`}>
                          <Progress.Section value={(s.had / Math.max(1, s.total)) * 100} color="teal" />
                          <Progress.Section value={(s.onPc / Math.max(1, s.total)) * 100} color="blue" />
                        </Progress.Root>
                      </Table.Td>
                      <Table.Td>{count(s.consoles)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          ) : (
          <SimpleGrid cols={{ base: 2, xs: 3, sm: 4, md: 5, lg: 7 }} spacing="sm" verticalSpacing="md">
            {shown.map((s, i) => (
              <UnstyledButton key={s.name} {...jumpMark(i)} onClick={() => setParams({ series: s.name })} aria-label={`${s.name}: ${s.had} of ${s.total} games`}>
                <Stack gap={4}>
                  <Art coverId={s.coverId} name={s.name} />
                  <Text size="sm" fw={600} lineClamp={2}>
                    {s.name}
                    {s.custom && (
                      <Badge size="xs" variant="light" color="gray" ml={4}>
                        Yours
                      </Badge>
                    )}
                  </Text>
                  <HadBar had={s.had} total={s.total} onPc={s.onPc} />
                </Stack>
              </UnstyledButton>
            ))}
          </SimpleGrid>
          )}
        </Stack>
      )}
    </>
  );
}
