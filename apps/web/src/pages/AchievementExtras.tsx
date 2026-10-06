import { Button, Group, Stack, Text } from '@mantine/core';
import { IconPlugConnected, IconRefresh } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { date, timeAgo } from '../format';
import { notifyError, notifySuccess, useSetting } from '../hooks';

/** GET /api/v1/sources/xbox or /playstation: the last read's games, matched to your consoles, completed; PlayStation's sign-in end. */
interface AchievementStatus {
  on: boolean;
  configured: boolean;
  games: number;
  matched: number;
  completed: number;
  syncedAt: string | null;
  signedInUntil: string | null;
}

const NAMES = { xbox: 'Xbox achievements', playstation: 'PlayStation trophies', steam: 'Steam achievements' } as const;

/**
 * Under Xbox's key (PlayStation's sign-in token, Steam's key and profile) on Settings > Features: the Test button (saving first), reading
 * now, what the last read found, and until when PlayStation's sign-in lasts.
 */
export function AchievementButtons({ source, unsaved, save }: { source: 'xbox' | 'playstation' | 'steam'; unsaved: boolean; save: () => Promise<boolean> }) {
  const queryClient = useQueryClient();
  const dateFormat = useSetting('general.dateFormat', 'us');
  const name = NAMES[source];
  const status = useQuery({ queryKey: ['achievements', source], queryFn: () => api<AchievementStatus>(`/sources/${source}`) });
  const test = useMutation({
    mutationFn: async () => {
      if (unsaved && !(await save())) return null;
      return api<{ ok: boolean; message: string }>(`/sources/${source}/test`, { method: 'POST' });
    },
    onSuccess: (r) => {
      if (!r) return;
      if (r.ok) notifySuccess(r.message, name);
      else notifyError(new Error(r.message), name);
      void queryClient.invalidateQueries({ queryKey: ['achievements', source] });
    },
    onError: (err) => notifyError(err, name),
  });
  const sync = useMutation({
    mutationFn: () => api(`/sources/${source}/sync`, { method: 'POST' }),
    onSuccess: () => {
      notifySuccess(
        source === 'steam' ? 'Reading your Steam achievements; they show in the PC library in a moment (the first read takes a few minutes).' : `Reading your ${source === 'xbox' ? 'achievements' : 'trophies'}; they show in each game's drawer in a moment.`,
        name,
      );
      setTimeout(() => void queryClient.invalidateQueries({ queryKey: ['achievements', source] }), 5000);
    },
    onError: (err) => notifyError(err, name),
  });
  const s = status.data;
  return (
    <Stack gap={6}>
      <Group gap="sm">
        <Button variant="default" leftSection={<IconPlugConnected size={14} />} loading={test.isPending} onClick={() => test.mutate()}>
          {unsaved ? 'Save and test' : source === 'playstation' ? 'Test the sign-in' : 'Test the key'}
        </Button>
        {s?.configured && !unsaved && (
          <Button variant="default" leftSection={<IconRefresh size={14} />} loading={sync.isPending} onClick={() => sync.mutate()}>
            Read now
          </Button>
        )}
      </Group>
      {s && s.syncedAt && (
        <Text size="sm" c="dimmed">
          {source === 'steam'
            ? `Read ${timeAgo(s.syncedAt)}: ${s.games} ${s.games === 1 ? 'game' : 'games'} with achievements, ${s.completed} completed.`
            : `Read ${timeAgo(s.syncedAt)}: ${s.games} ${s.games === 1 ? 'game' : 'games'}, ${s.matched} on your consoles, ${s.completed} completed.`}
        </Text>
      )}
      {s?.signedInUntil && (
        <Text size="sm" c="dimmed">
          The sign-in lasts until {date(s.signedInUntil, dateFormat)}; then Squirrelcade needs a new token.
        </Text>
      )}
    </Stack>
  );
}
