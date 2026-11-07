import { Anchor, AspectRatio, Box, Center, Group, Image, Loader, Progress, SegmentedControl, SimpleGrid, Stack, Switch, Text, UnstyledButton } from '@mantine/core';
import { useLocalStorage } from '@mantine/hooks';
import { igdbCoverUrl, SALES_REGIONS, type SalesRegion } from '@squirrelcade/core';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { StashMark } from '../Acorn';
import { api } from '../api';
import { CoverMarks, useOwnedMarks } from '../ConsoleMark';
import { useOpenGame } from '../GameDrawer';
import { useSetting } from '../hooks';
import { useAllConsoles } from './History';

/** A year's Top 20 (GET /api/v1/roots/top20, T-218). */
interface Top20Game {
  rank: number;
  title: string;
  coverId: string | null;
  consoles: string[];
  rating: number | null;
  ratings: number | null;
}
interface Top20Year {
  year: number;
  games: Top20Game[];
  note: string | null;
  region: SalesRegion | null;
}

/** A game of the list, as a tile: its box art (grey when it isn't yours), its rank, the cover's banner. */
function Tile({ g, mine }: { g: Top20Game; mine: boolean }) {
  const open = useOpenGame();
  const covers = useSetting('interface.showCoverArt', true);
  const on = g.consoles[0];
  return (
    <Stack gap={4}>
      <Box pos="relative" style={{ cursor: on ? 'pointer' : undefined }} onClick={() => on && open(on, g.title)} aria-hidden="true">
        <AspectRatio ratio={3 / 4} style={{ borderRadius: 6, outline: mine ? '2px solid var(--sc-have)' : '2px dashed var(--sc-gold)', outlineOffset: 1 }}>
          {covers && g.coverId ? (
            <Image src={igdbCoverUrl(g.coverId, 'cover_big')} radius="sm" alt="" loading="lazy" fit="cover" style={mine ? undefined : { filter: 'grayscale(1)', opacity: 0.55 }} />
          ) : (
            <Center p={6} style={{ borderRadius: 'var(--mantine-radius-sm)', border: '1px solid var(--mantine-color-default-border)' }}>
              <Text size="xs" ta="center" lineClamp={5}>
                {g.title}
              </Text>
            </Center>
          )}
        </AspectRatio>
        <span className="sc-square-rank" style={{ position: 'absolute', bottom: 4, left: 6, fontFamily: 'Silkscreen, ui-monospace, monospace', fontSize: 13, color: '#fff', textShadow: '0 1px 2px #000, 0 0 3px #000' }}>
          {g.rank}
        </span>
        <CoverMarks title={g.title} coverWidth={110} platformKey={on} />
      </Box>
      <Text size="xs" lineClamp={2}>
        {on ? (
          <Anchor component="button" type="button" size="xs" ta="left" onClick={() => open(on, g.title)}>
            {g.title}
          </Anchor>
        ) : (
          g.title
        )}
      </Text>
      {g.rating !== null && (
        <Text size="xs" c="dimmed">
          {g.rating} · {g.ratings} ratings
        </Text>
      )}
    </Stack>
  );
}

/**
 * Roots > Top 20 (T-218, D206): each year's 20 highest-rated (IGDB's ratings) or best-selling (Wikipedia's charts)
 * games, newest year first. Each year folded shows how many you have with the chest and a bar; open, the games as tiles.
 * A game counts as yours on any console it came out on.
 */
export function Top20Panel() {
  const [kind, setKind] = useLocalStorage<'rated' | 'selling'>({ key: 'squirrelcade-top20-kind', defaultValue: 'rated' });
  const [all, setAll] = useAllConsoles();
  const owned = useOwnedMarks();
  const data = useQuery({ queryKey: ['history', 'top20', kind, all], queryFn: () => api<{ years: Top20Year[]; region: SalesRegion; minRatings: number }>(`/roots/top20?kind=${kind}${all ? '&all=1' : ''}`), staleTime: 10 * 60_000 });
  const years = data.data?.years ?? [];
  const now = new Date().getFullYear();
  // The newest year with games starts open; the rest folded until opened.
  const [opened, setOpened] = useState<Set<number> | null>(null);
  const firstWith = years.find((y) => y.games.length > 0)?.year;
  const open = opened ?? new Set(firstWith ? [firstWith] : []);
  const toggle = (year: number) => {
    const next = new Set(open);
    if (next.has(year)) next.delete(year);
    else next.add(year);
    setOpened(next);
  };
  const isMine = (g: Top20Game) => owned(g.title).length > 0;
  const decades = [...new Set(years.map((y) => Math.floor(y.year / 10) * 10))];
  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap" align="flex-end">
        <SegmentedControl
          size="md"
          value={kind}
          onChange={(v) => setKind(v as 'rated' | 'selling')}
          data={[
            { value: 'rated', label: 'Highest rated' },
            { value: 'selling', label: 'Best selling' },
          ]}
          aria-label="Which Top 20"
        />
        <Switch size="sm" label="Consoles you don't collect too" checked={all} onChange={(e) => setAll(e.currentTarget.checked)} />
      </Group>
      <Text size="sm" c="dimmed" maw={760}>
        {kind === 'rated'
          ? `Each year's 20 best-rated games on IGDB, counting games rated by at least ${data.data?.minRatings ?? 10} people (Settings › Roots › Top 20).`
          : `Each year's best sellers, from Wikipedia's "YYYY in video games" (${data.data ? SALES_REGIONS[data.data.region] : 'the United States'} where the year has it; Settings › Roots › Top 20).`}{' '}
        A game counts as yours on any console it came out on.
      </Text>
      <Group gap={6} wrap="wrap" role="navigation" aria-label="Decades">
        {decades.map((d) => (
          <Anchor key={d} href={`#top20-${d}`} size="sm" className="sc-chip" onClick={(e) => {
            e.preventDefault();
            document.getElementById(`top20-${d}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}>
            {d}s
          </Anchor>
        ))}
      </Group>
      {data.isLoading ? (
        <Group gap="xs">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">
            Gathering every year's games (the first time takes a moment)…
          </Text>
        </Group>
      ) : (
        <Stack gap={4}>
          {years.map((y) => {
            const have = y.games.filter(isMine).length;
            const isOpen = open.has(y.year);
            const firstOfDecade = y.year % 10 === 9 || y.year === now;
            return (
              <Box key={y.year} id={firstOfDecade ? `top20-${Math.floor(y.year / 10) * 10}` : undefined} style={{ borderTop: '1px solid var(--sc-line)', scrollMarginTop: 70 }}>
                <UnstyledButton onClick={() => toggle(y.year)} aria-expanded={isOpen} w="100%" py={8}>
                  <Group gap="sm" wrap="nowrap">
                    {isOpen ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                    <Text fw={700} w={110}>
                      {y.year}
                      {y.year === now ? ' so far' : ''}
                    </Text>
                    {y.games.length > 0 ? (
                      <Group gap={6} wrap="nowrap">
                        <StashMark size={13} owned={have > 0} />
                        <Text size="sm">
                          you have {have} of {y.games.length}
                        </Text>
                        <Progress value={(have / y.games.length) * 100} w={80} size="sm" color="forest" aria-hidden="true" />
                      </Group>
                    ) : (
                      <Text size="sm" c="dimmed">
                        {y.note}
                      </Text>
                    )}
                    {y.games.length > 0 && y.note && (
                      <Text size="xs" c="dimmed" visibleFrom="sm">
                        {y.note}
                      </Text>
                    )}
                    {kind === 'selling' && y.region && y.region !== data.data?.region && (
                      <Text size="xs" c="dimmed" visibleFrom="sm">
                        {SALES_REGIONS[y.region]}&apos;s chart
                      </Text>
                    )}
                  </Group>
                </UnstyledButton>
                {isOpen && y.games.length > 0 && (
                  <SimpleGrid cols={{ base: 3, xs: 4, sm: 5, md: 6, lg: 10 }} spacing="sm" pb="md">
                    {y.games.map((g) => (
                      <Tile key={`${y.year}|${g.rank}`} g={g} mine={isMine(g)} />
                    ))}
                  </SimpleGrid>
                )}
              </Box>
            );
          })}
        </Stack>
      )}
      <Text size="xs" c="dimmed">
        Ratings from <Anchor href="https://www.igdb.com" target="_blank" rel="noreferrer" size="xs" inherit>IGDB</Anchor>; sales charts from Wikipedia (CC BY-SA).{' '}
        <Anchor component={Link} to="/settings/roots" size="xs" inherit>
          Settings › Roots
        </Anchor>
      </Text>
    </Stack>
  );
}
