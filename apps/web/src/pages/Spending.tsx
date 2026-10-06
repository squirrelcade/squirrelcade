import { Anchor, Card, Group, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../api';
import { count, wholeMoney } from '../format';
import { useSetting } from '../hooks';

/** What the collection cost by month (GET /api/v1/collection/spending). */
interface SpendingData {
  months: { month: string; cents: number; copies: number }[];
  consoles: { platform: string; cents: number; copies: number }[];
}

const W = 600;
const H = 90;
const PAD = 4;
/** Months the chart shows, this one last. */
const SHOWN = 24;

/** "2026-09" -> "Sep 2026". */
const monthName = (month: string) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * Spending: what the copies in the collection cost, by the month they were bought (or added), as bars for the
 * last two years, with the monthly budget from Settings > Collection when there is one.
 */
export function Spending({ currency }: { currency: string }) {
  // The budget is in whole units of the currency; amounts are in cents (yen have none).
  const budgetUnits = useSetting('collection.monthlyBudget', 0);
  const budget = Math.round(currency === 'JPY' ? budgetUnits : budgetUnits * 100);
  const spending = useQuery({ queryKey: ['collection', 'spending'], queryFn: () => api<SpendingData>('/collection/spending') });
  const data = spending.data;
  if (!data || data.months.length === 0) return null;

  const now = new Date();
  const months = Array.from({ length: SHOWN }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (SHOWN - 1 - i), 1)).toISOString().slice(0, 7));
  const byMonth = new Map(data.months.map((m) => [m.month, m]));
  const bars = months.map((month) => ({ month, cents: byMonth.get(month)?.cents ?? 0, copies: byMonth.get(month)?.copies ?? 0 }));
  const top = Math.max(...bars.map((b) => b.cents), budget, 1);
  const last12 = bars.slice(-12).reduce((t, b) => ({ cents: t.cents + b.cents, copies: t.copies + b.copies }), { cents: 0, copies: 0 });
  const thisMonth = bars[bars.length - 1]!;
  const slot = (W - 2 * PAD) / SHOWN;
  const y = (cents: number) => H - PAD - (cents / top) * (H - 2 * PAD);

  return (
    <Card withBorder mb="md" padding="sm">
      <Group justify="space-between" mb={4} wrap="wrap" gap="xs">
        <Text fw={600} size="sm">
          Spending
        </Text>
        <Text size="sm" c="dimmed">
          {wholeMoney(last12.cents, currency)} in the last 12 months ({count(last12.copies)} {last12.copies === 1 ? 'copy' : 'copies'}) · {wholeMoney(thisMonth.cents, currency)} this month
          {budget > 0 && (
            <Text span size="sm" c={thisMonth.cents > budget ? 'red' : 'green'}>
              {' '}
              ({thisMonth.cents > budget ? `${wholeMoney(thisMonth.cents - budget, currency)} over` : `${wholeMoney(budget - thisMonth.cents, currency)} left of`} your budget)
            </Text>
          )}
        </Text>
      </Group>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img" aria-label="Spending by month">
        {bars.map((b, i) => (
          <rect key={b.month} x={PAD + i * slot + slot * 0.15} y={y(b.cents)} width={slot * 0.7} height={Math.max(H - PAD - y(b.cents), b.cents > 0 ? 1 : 0)} fill="var(--mantine-color-forest-5)" opacity={i === SHOWN - 1 ? 1 : 0.75}>
            <title>{`${monthName(b.month)}: ${wholeMoney(b.cents, currency)} for ${count(b.copies)} ${b.copies === 1 ? 'copy' : 'copies'}`}</title>
          </rect>
        ))}
        {budget > 0 && <line x1={PAD} x2={W - PAD} y1={y(budget)} y2={y(budget)} stroke="var(--mantine-color-orange-6)" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />}
      </svg>
      <Group justify="space-between" mt={2} wrap="nowrap" gap="xs">
        <Text size="xs" c="dimmed">
          {monthName(months[0]!)}
        </Text>
        <Text size="xs" c="dimmed" ta="center" lineClamp={1}>
          {data.consoles.length > 0
            ? `Last 12 months: ${data.consoles
                .slice(0, 4)
                .map((c) => `${c.platform} ${wholeMoney(c.cents, currency)}`)
                .join(' · ')}`
            : 'Nothing bought in the last 12 months'}
          {budget === 0 && (
            <>
              {' · '}
              <Anchor component={Link} to="/settings/collection" size="xs">
                set a budget
              </Anchor>
            </>
          )}
        </Text>
        <Text size="xs" c="dimmed">
          {monthName(months[SHOWN - 1]!)}
        </Text>
      </Group>
    </Card>
  );
}
