import type { SettingsValues } from '@squirrelcade/core';
import { Anchor, Card, Group, Table, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../api';
import { count, date, wholeMoney } from '../format';

interface Point {
  id: number;
  fileName: string;
  appliedAt: string;
  /** The export's own date (from its file name), or when it was applied. */
  date: string;
  games: number;
  copies: number;
  valueCents: number;
  costCents: number;
  /** Each platform's totals in this update, most valuable first; null for an update from before they were kept. */
  platforms: { key: string; name: string; games: number; copies: number; valueCents: number; costCents: number }[] | null;
}

const W = 600;
const H = 110;
const PAD = 6;

/**
 * The collection's value at each update, as a small line chart. The scale always
 * spans at least 4% of the value, so ordinary price wobble looks as small as it is.
 */
export function ValueHistory({ currency, dateFormat }: { currency: string; dateFormat: SettingsValues['general.dateFormat'] }) {
  const history = useQuery({ queryKey: ['collection', 'history'], queryFn: () => api<Point[]>('/collection/history') });
  const points = history.data ?? [];
  if (points.length < 2) return null;

  const last = points[points.length - 1]!;
  const prev = points[points.length - 2]!;
  const change = last.valueCents - prev.valueCents;
  const percent = prev.valueCents ? (change / prev.valueCents) * 100 : 0;
  const times = points.map((p) => Date.parse(p.date));
  const t0 = times[0]!;
  const tSpan = times[times.length - 1]! - t0 || 1;
  const values = points.map((p) => p.valueCents);
  const middle = (Math.min(...values) + Math.max(...values)) / 2;
  const vSpan = Math.max(Math.max(...values) - Math.min(...values), middle * 0.04, 1);
  const vMin = middle - vSpan / 2;
  const x = (i: number) => (PAD + ((times[i]! - t0) / tSpan) * (W - 2 * PAD)).toFixed(1);
  const y = (v: number) => (H - PAD - ((v - vMin) / vSpan) * (H - 2 * PAD)).toFixed(1);
  const line = points.map((p, i) => `${x(i)},${y(p.valueCents)}`).join(' ');
  const percentText = Math.abs(percent) < 0.1 && change !== 0 ? Math.abs(percent).toFixed(2) : Math.abs(percent).toFixed(1);
  const summary = points
    .map((p) => `${date(p.date, dateFormat)}: ${wholeMoney(p.valueCents, currency)} value, ${wholeMoney(p.costCents, currency)} paid, ${count(p.games)} games`)
    .join('\n');

  return (
    <Card withBorder mb="md" padding="sm">
      <Group justify="space-between" mb={4} wrap="wrap" gap="xs">
        <Text fw={600} size="sm">
          Value over time
        </Text>
        <Text size="sm" c={change > 0 ? 'green' : change < 0 ? 'red' : 'dimmed'}>
          {change >= 0 ? '+' : '−'}
          {wholeMoney(Math.abs(change), currency)} ({percent >= 0 ? '+' : '−'}
          {percentText}%) since {date(prev.date, dateFormat)}
        </Text>
      </Group>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img" aria-label="Collection value over time">
        <title>{summary}</title>
        <polyline points={line} fill="none" stroke="var(--mantine-color-forest-5)" strokeWidth={2.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <Group justify="space-between" mt={2} wrap="nowrap">
        <Text size="xs" c="dimmed">
          {date(points[0]!.date, dateFormat)}
        </Text>
        <Text size="xs" c="dimmed" ta="center">
          {wholeMoney(vMin + vSpan, currency)} top, {wholeMoney(vMin, currency)} bottom · {points.length} updates
        </Text>
        <Text size="xs" c="dimmed">
          {date(last.date, dateFormat)}
        </Text>
      </Group>
    </Card>
  );
}

/** How many platforms "Value by platform over time" lists: the most valuable now. */
const PLATFORMS_SHOWN = 12;
const SW = 120;
const SH = 28;

/** A platform's values as a small line (red when it ends lower); like the collection's chart, the scale spans at least 4% of the value. */
function Sparkline({ values, label }: { values: number[]; label: string }) {
  const fell = values[values.length - 1]! < values[0]!;
  const middle = (Math.min(...values) + Math.max(...values)) / 2;
  const span = Math.max(Math.max(...values) - Math.min(...values), middle * 0.04, 1);
  const low = middle - span / 2;
  const x = (i: number) => (2 + (i / Math.max(values.length - 1, 1)) * (SW - 4)).toFixed(1);
  const y = (v: number) => (SH - 3 - ((v - low) / span) * (SH - 6)).toFixed(1);
  return (
    <svg viewBox={`0 0 ${SW} ${SH}`} width={SW} height={SH} role="img" aria-label={label}>
      <polyline points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke={`var(--mantine-color-${fell ? 'red' : 'teal'}-5)`} strokeWidth={2} strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Collection > Statistics: each platform's value at every collection update that kept it by platform (updates
 * since 0.13.0, and the ones the server still had then), for the most valuable platforms now: a small line, the
 * value now, and the change since the first of those updates.
 */
export function PlatformValueHistory({ currency, dateFormat }: { currency: string; dateFormat: SettingsValues['general.dateFormat'] }) {
  const history = useQuery({ queryKey: ['collection', 'history'], queryFn: () => api<Point[]>('/collection/history') });
  if (!history.data) return null;
  const points = history.data.filter((p) => p.platforms);
  const title = (
    <Text fw={600} mb={4}>
      Value by platform over time
    </Text>
  );
  if (points.length < 2) {
    return (
      <Card withBorder padding="md" mt="md">
        {title}
        <Text size="sm" c="dimmed">
          Each collection update now keeps every platform's value. This shows once there are two of them, after your next update.
        </Text>
      </Card>
    );
  }
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const rows = last.platforms!.slice(0, PLATFORMS_SHOWN).map((p) => {
    const series = points.map((pt) => pt.platforms!.find((x) => x.key === p.key)?.valueCents ?? 0);
    return { ...p, series, change: p.valueCents - series[0]!, start: series[0]! };
  });
  return (
    <Card withBorder padding="md" mt="md">
      {title}
      <Text size="xs" c="dimmed" mb="xs">
        At each of {points.length} collection updates since {date(first.date, dateFormat)}
        {last.platforms!.length > PLATFORMS_SHOWN ? `; the ${PLATFORMS_SHOWN} most valuable of ${last.platforms!.length} platforms` : ''}.
      </Text>
      <Table verticalSpacing={4}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Platform</Table.Th>
            <Table.Th visibleFrom="sm">Over time</Table.Th>
            <Table.Th ta="right">Value</Table.Th>
            <Table.Th ta="right" style={{ whiteSpace: 'nowrap' }}>
              Since {date(first.date, dateFormat)}
            </Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r) => {
            const percent = r.start > 0 ? (r.change / r.start) * 100 : null;
            return (
              <Table.Tr key={r.key}>
                <Table.Td>
                  <Anchor component={Link} to={`/platforms/${r.key}`} size="sm">
                    {r.name}
                  </Anchor>
                </Table.Td>
                <Table.Td visibleFrom="sm">
                  <Sparkline values={r.series} label={`${r.name}: ${points.map((pt, i) => `${date(pt.date, dateFormat)} ${wholeMoney(r.series[i]!, currency)}`).join(', ')}`} />
                </Table.Td>
                <Table.Td ta="right">{wholeMoney(r.valueCents, currency)}</Table.Td>
                <Table.Td ta="right" c={r.change > 0 ? 'green' : r.change < 0 ? 'red' : 'dimmed'} style={{ whiteSpace: 'nowrap' }}>
                  {r.start === 0 ? 'New' : `${r.change >= 0 ? '+' : '−'}${wholeMoney(Math.abs(r.change), currency)}${percent !== null && Math.abs(percent) >= 0.1 ? ` (${percent >= 0 ? '+' : '−'}${Math.abs(percent).toFixed(1)}%)` : ''}`}
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Card>
  );
}
