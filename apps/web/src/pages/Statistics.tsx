import { Anchor, Box, Card, Group, Loader, SimpleGrid, Stack, Table, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { PageHeader, StatCard } from '../components';
import { GoalProgress } from '../Goal';
import { count, wholeMoney } from '../format';
import { useSetting } from '../hooks';
import { PlatformValueHistory } from './ValueHistory';

interface Bar {
  label: string;
  count: number;
  cents?: number;
}

/** GET /api/v1/collection/statistics. */
interface Statistics {
  currency: string;
  totals: { games: number; copies: number; valueCents: number; costCents: number | null; sealed: number; consoles: number };
  /** The owner's estimates of the prices they don't know, together; null when prices paid aren't shown. */
  estimated: { cents: number; copies: number } | null;
  consoles: (Bar & { key: string | null; games: number })[];
  conditions: Bar[];
  regions: Bar[];
  decades: Bar[];
  genres: Bar[];
  added: Bar[];
  spending: Bar[] | null;
  mostValuable: { title: string; platform: string; condition: string; valueCents: number }[];
  play: { statuses: Bar[]; finished: Bar[] } | null;
}

/** A card of bars, each as long as its share of the largest, with its number (or amount) beside it. */
function Bars({ title, bars, value = (b) => count(b.count), measure = (b) => b.count, link, color = 'blue', note }: {
  title: string;
  bars: Bar[];
  value?: (b: Bar) => ReactNode;
  measure?: (b: Bar) => number;
  link?: (b: Bar) => string | null;
  color?: string;
  note?: string;
}) {
  const max = Math.max(1, ...bars.map(measure));
  return (
    <Card withBorder padding="md">
      <Text fw={600} mb={note ? 0 : 'xs'}>
        {title}
      </Text>
      {note && (
        <Text size="xs" c="dimmed" mb="xs">
          {note}
        </Text>
      )}
      {bars.length === 0 ? (
        <Text size="sm" c="dimmed">
          Nothing to show yet.
        </Text>
      ) : (
        <Stack gap={6} role="list" aria-label={title}>
          {bars.map((b) => {
            const to = link?.(b) ?? null;
            return (
              <Group key={b.label} gap="xs" wrap="nowrap" role="listitem">
                <Text size="sm" w={150} truncate="end" style={{ flex: 'none' }}>
                  {to ? (
                    <Anchor component={Link} to={to} size="sm">
                      {b.label}
                    </Anchor>
                  ) : (
                    b.label
                  )}
                </Text>
                <Box style={{ flex: 1 }}>
                  <Box h={12} w={`${Math.max(1.5, (measure(b) / max) * 100)}%`} bg={`var(--mantine-color-${color}-6)`} style={{ borderRadius: 3 }} />
                </Box>
                <Text size="sm" w={90} ta="right" style={{ flex: 'none' }}>
                  {value(b)}
                </Text>
              </Group>
            );
          })}
        </Stack>
      )}
    </Card>
  );
}

/**
 * Collection > Statistics: the collection counted every way: by console, condition, region, decade, genre, year
 * added, spending and play, and each platform's value over time.
 */
export function StatisticsPage() {
  const currency = useSetting('general.currency', 'USD');
  const dateFormat = useSetting('general.dateFormat', 'us');
  const stats = useQuery({ queryKey: ['collection', 'statistics'], queryFn: () => api<Statistics>('/collection/statistics') });
  const s = stats.data;
  if (!s) return stats.isError ? <Text c="red">The statistics couldn't be worked out.</Text> : <Loader />;
  const moneyOf = (b: Bar) => wholeMoney(b.cents ?? 0, currency);
  return (
    <>
      <PageHeader help="collection" title="Statistics" description="Your collection counted every way. The Collection page lists the copies behind each bar." />
      <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }} mb="md">
        <StatCard label="Games" value={count(s.totals.games)} hint="Each game once, however many copies" />
        <StatCard label="Copies" value={count(s.totals.copies)} hint={s.totals.copies > s.totals.games ? `${count(s.totals.copies - s.totals.games)} duplicate${s.totals.copies - s.totals.games === 1 ? '' : 's'}` : undefined} />
        <StatCard label="Value" value={wholeMoney(s.totals.valueCents, currency)} />
        {s.totals.costCents !== null && (
          <StatCard
            label="Paid"
            value={wholeMoney(s.totals.costCents, currency)}
            hint={s.estimated && s.estimated.copies > 0 ? `and ${wholeMoney(s.estimated.cents, currency)} estimated by you for ${count(s.estimated.copies)} without a price` : undefined}
          />
        )}
        <StatCard label="Sealed" value={count(s.totals.sealed)} />
        <StatCard label="Platforms" value={count(s.totals.consoles)} />
      </SimpleGrid>
      <GoalProgress card mb="md" />
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <Bars title="Copies by platform" bars={s.consoles.slice(0, 15)} link={(b) => ((b as Statistics['consoles'][number]).key ? `/collection?platform=${(b as Statistics['consoles'][number]).key}` : null)} note={s.consoles.length > 15 ? `The 15 with the most copies, of ${s.consoles.length}.` : undefined} />
        <Bars title="Value by platform" bars={[...s.consoles].sort((a, b) => (b.cents ?? 0) - (a.cents ?? 0)).slice(0, 15)} measure={(b) => b.cents ?? 0} value={moneyOf} color="teal" />
        <Bars title="Condition" bars={s.conditions} color="squirrel" />
        <Bars title="Region" bars={s.regions} color="cyan" />
        <Bars title="Decade" bars={s.decades} color="orange" note="When each game first came out on its platform (IGDB); games IGDB doesn't know are left out." />
        <Bars title="Genres" bars={s.genres} color="pink" note="Games in IGDB's genres (a game can have several)." />
        <Bars title="Copies added each year" bars={s.added} color="blue" note="By the day each copy was added in PriceCharting." />
        {s.spending && <Bars title="Spent each year" bars={s.spending} measure={(b) => b.cents ?? 0} value={moneyOf} color="red" note="What you paid, by the day bought (or added, when there's none)." />}
        {s.play && <Bars title="Played" bars={s.play.statuses} color="green" link={() => '/collection/backlog'} />}
        {s.play && s.play.finished.length > 0 && <Bars title="Finished each year" bars={s.play.finished} color="green" />}
      </SimpleGrid>
      <PlatformValueHistory currency={currency} dateFormat={dateFormat} />
      {s.mostValuable.length > 0 && (
        <Card withBorder padding="md" mt="md">
          <Text fw={600} mb="xs">
            Most valuable copies
          </Text>
          <Table verticalSpacing={4}>
            <Table.Tbody>
              {s.mostValuable.map((m, i) => (
                <Table.Tr key={`${m.title}|${m.platform}|${i}`}>
                  <Table.Td>{m.title}</Table.Td>
                  <Table.Td c="dimmed">{m.platform}</Table.Td>
                  <Table.Td c="dimmed">{m.condition}</Table.Td>
                  <Table.Td ta="right">{wholeMoney(m.valueCents, currency)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
