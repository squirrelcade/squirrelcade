import { Anchor, Box, Card, Group, Progress, Text, type BoxProps } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from './api';
import { count } from './format';
import { useCanEdit } from './hooks';

/** GET /api/v1/collection/goal. */
interface CollectionGoal {
  goal: number;
  counts: 'copies' | 'games';
  now: number;
  yearAgo: number;
  change: number;
  perMonth: number;
  remaining: number;
  reachBy: string | null;
}

/**
 * One in, one out: the sentence a confirmation adds when a copy just added puts the collection at or over its goal
 * (the server's overGoal: how many over, 0 at the goal), else nothing.
 */
export function overGoalNote(answer: unknown): string {
  const over = (answer as { overGoal?: unknown } | null | undefined)?.overGoal;
  if (typeof over !== 'number') return '';
  return over === 0 ? " That's your goal reached: one in, one out from here (Acorns > Sales has what to sell)." : ` That's ${count(over)} over your goal: Acorns > Sales has what to sell.`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "March 2027" for a day. */
const monthOf = (day: string) => `${MONTHS[Number(day.slice(5, 7)) - 1] ?? ''} ${day.slice(0, 4)}`.trim();

/**
 * The collection against its goal (Settings > Collection > Your goal): how many of how many, the last 12 months' change
 * and when that pace gets there; at the goal, how many are over it, with Sales for the owner (play one, sell one).
 * Nothing without a goal. On Statistics (a card of its own); Today shows it as one small line (`line`, 0.52.0: a goal is
 * one owner's choice, not something every collection has).
 */
export function GoalProgress({ card = false, line = false, ...box }: { card?: boolean; line?: boolean } & BoxProps) {
  const canEdit = useCanEdit();
  const q = useQuery({ queryKey: ['collection', 'goal'], queryFn: () => api<{ goal: CollectionGoal | null }>('/collection/goal') });
  const g = q.data?.goal;
  if (!g) return null;
  const unit = (n: number) => (g.counts === 'games' ? (n === 1 ? 'game' : 'games') : n === 1 ? 'copy' : 'copies');
  const percent = Math.min(100, Math.round((g.now / g.goal) * 1000) / 10);
  const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${count(Math.abs(n))}`;
  if (line) {
    return (
      <Text size="sm" c="dimmed" {...box}>
        {percent}% of your {count(g.goal)}-{g.counts === 'games' ? 'game' : 'copy'} goal
        {g.remaining <= 0 ? (g.remaining === 0 ? ': reached' : `: ${count(-g.remaining)} over`) : ''}
      </Text>
    );
  }
  const pace = `The last 12 months: ${signed(g.change)} ${unit(Math.abs(g.change))}${g.change !== 0 ? ` (${g.perMonth > 0 ? '+' : g.perMonth < 0 ? '−' : ''}${Math.abs(g.perMonth).toLocaleString(undefined, { maximumFractionDigits: 1 })} a month)` : ''}`;
  const body = (
    <>
      <Group justify="space-between" gap="xs" mb={4} wrap="nowrap">
        <Text size="sm" fw={600}>
          Your goal: {count(g.goal)} {unit(g.goal)}
        </Text>
        <Text size="sm" c="dimmed">
          {count(g.now)} · {percent}%
        </Text>
      </Group>
      <Progress value={percent} color={g.remaining <= 0 ? 'teal' : 'forest'} size="md" aria-label={`${count(g.now)} of ${count(g.goal)} ${unit(g.goal)}`} />
      <Text size="xs" c="dimmed" mt={6}>
        {g.remaining > 0 ? (
          <>
            {count(g.remaining)} to go. {pace}
            {g.reachBy ? `: at that pace, about ${monthOf(g.reachBy)}.` : ', so not at this pace.'}
          </>
        ) : (
          <>
            {g.remaining === 0 ? "You're at your goal." : `${count(-g.remaining)} ${unit(-g.remaining)} over your goal.`} {pace}.{' '}
            {canEdit && (
              <Anchor component={Link} to="/collection/sales" size="xs">
                What to sell
              </Anchor>
            )}
          </>
        )}
      </Text>
    </>
  );
  return card ? (
    <Card withBorder padding="sm" {...box}>
      {body}
    </Card>
  ) : (
    <Box {...box}>{body}</Box>
  );
}
