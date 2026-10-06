import { PLAY_STATUSES, type PlayStatus, type SettingsValues } from '@squirrelcade/core';
import { Badge, Group, Select, Text, Tooltip } from '@mantine/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { date } from './format';
import { notifyError } from './hooks';

/** What the owner played of a game: its status, rating and days (GET /api/v1/game's play, the Backlog page's rows). */
export interface Play {
  status: PlayStatus | null;
  rating: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export const PLAY_COLORS: Record<PlayStatus, string> = {
  backlog: 'gray',
  playing: 'blue',
  beaten: 'teal',
  completed: 'green',
  dropped: 'red',
  shelf: 'cyan',
};

const SHORT = Object.fromEntries(PLAY_STATUSES.map((s) => [s.value, s.short])) as Record<PlayStatus, string>;

/** Everything that shows play status, refreshed after a change. */
const TOUCHED = ['game', 'play', 'collection', 'history'];

/** A small badge with a game's status and rating ("Beaten · 9/10"); nothing for a game not marked. */
export function PlayBadge({ play, size = 'sm' }: { play: Play | null | undefined; size?: 'xs' | 'sm' }) {
  if (!play || (!play.status && !play.rating)) return null;
  const text = [play.status ? SHORT[play.status] : null, play.rating ? `${play.rating}/10` : null].filter(Boolean).join(' · ');
  return (
    <Badge size={size} variant="light" color={play.status ? PLAY_COLORS[play.status] : 'gray'} style={{ textTransform: 'none' }}>
      {text}
    </Badge>
  );
}

/** Saves a game's status or rating (PUT /api/v1/play) and refreshes what shows it. */
export function useSetPlay() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { platformKey: string; title: string; status?: PlayStatus | null; rating?: number | null }) => api<{ play: Play | null }>('/play', { method: 'PUT', json: input }),
    onSuccess: async () => {
      await Promise.all(TOUCHED.map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
    },
    onError: (err) => notifyError(err, "The game's status couldn't be saved"),
  });
}

const RATINGS = Array.from({ length: 10 }, (_, i) => ({ value: String(10 - i), label: `${10 - i}/10` }));

/**
 * Where the owner is with a game, and their rating, as two choices; the days it was started and finished under
 * them. A viewer sees the badge only.
 */
export function PlayPicker({
  platformKey,
  title,
  play,
  canEdit,
  dateFormat,
  compact = false,
}: {
  platformKey: string;
  title: string;
  play: Play | null;
  canEdit: boolean;
  dateFormat: SettingsValues['general.dateFormat'];
  compact?: boolean;
}) {
  const save = useSetPlay();
  if (!canEdit) return <PlayBadge play={play} />;
  const days = [play?.startedAt ? `started ${date(play.startedAt, dateFormat)}` : null, play?.finishedAt ? `finished ${date(play.finishedAt, dateFormat)}` : null].filter(Boolean).join(', ');
  return (
    <Group gap="xs" wrap="wrap" align="center">
      <Select
        aria-label={`What you played of ${title}`}
        size={compact ? 'xs' : 'sm'}
        w={compact ? 150 : 200}
        placeholder="Not marked"
        data={PLAY_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
        value={play?.status ?? null}
        onChange={(v) => save.mutate({ platformKey, title, status: (v as PlayStatus | null) ?? null })}
        clearable
        disabled={save.isPending}
        comboboxProps={{ withinPortal: true }}
      />
      <Select
        aria-label={`Your rating of ${title}`}
        size={compact ? 'xs' : 'sm'}
        w={compact ? 90 : 110}
        placeholder="Rating"
        data={RATINGS}
        value={play?.rating ? String(play.rating) : null}
        onChange={(v) => save.mutate({ platformKey, title, rating: v ? Number(v) : null })}
        clearable
        disabled={save.isPending}
        comboboxProps={{ withinPortal: true }}
      />
      {days && !compact && (
        <Tooltip label="Set when you choose Playing, Beaten or Completed">
          <Text size="xs" c="dimmed">
            {days}
          </Text>
        </Tooltip>
      )}
    </Group>
  );
}
