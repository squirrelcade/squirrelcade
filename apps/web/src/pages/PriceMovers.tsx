import type { SettingsValues } from '@squirrelcade/core';
import { Card, SimpleGrid, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { date, money } from '../format';
import { GameTitle } from '../GameDrawer';

interface Move {
  title: string;
  platform: string;
  platformKey: string | null;
  condition: string;
  beforeCents: number;
  nowCents: number;
  changeCents: number;
  percent: number;
}

interface Movers {
  since: { fileName: string; appliedAt: string; date: string } | null;
  up: Move[];
  down: Move[];
}

/** The owned games whose PriceCharting value moved most since the previous update. */
export function PriceMovers({ currency, dateFormat }: { currency: string; dateFormat: SettingsValues['general.dateFormat'] }) {
  const movers = useQuery({ queryKey: ['collection', 'movers'], queryFn: () => api<Movers>('/collection/movers') });
  const m = movers.data;
  if (!m?.since || (m.up.length === 0 && m.down.length === 0)) return null;

  const list = (items: Move[], color: string) =>
    items.length === 0 ? (
      <Text size="sm" c="dimmed">
        None.
      </Text>
    ) : (
      items.map((x) => (
        <Text key={`${x.title}|${x.platform}|${x.condition}`} size="sm">
          {x.platformKey ? <GameTitle platformKey={x.platformKey} title={x.title} /> : x.title}{' '}
          <Text span size="xs" c="dimmed">
            {x.platform}, {x.condition.toLowerCase()}: {money(x.beforeCents, currency)} →
          </Text>{' '}
          <Text span size="sm" c={color} fw={500}>
            {money(x.nowCents, currency)} ({x.percent > 0 ? '+' : ''}
            {x.percent}%)
          </Text>
        </Text>
      ))
    );

  return (
    <Card withBorder mb="md" padding="sm">
      <Text fw={600} size="sm" mb={6}>
        Biggest price moves since {date(m.since.date, dateFormat)}
      </Text>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        <Stack gap={2}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            Up
          </Text>
          {list(m.up, 'green')}
        </Stack>
        <Stack gap={2}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            Down
          </Text>
          {list(m.down, 'red')}
        </Stack>
      </SimpleGrid>
    </Card>
  );
}
