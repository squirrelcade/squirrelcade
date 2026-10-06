import { Button, Group, Stack, Text } from '@mantine/core';
import { IconPlugConnected, IconRefresh } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { timeAgo } from '../format';
import { notifyError, notifySuccess } from '../hooks';

/** GET /api/v1/sources/retroachievements: the last read's games, matched to your consoles, beaten and mastered. */
interface RaStatus {
  on: boolean;
  configured: boolean;
  games: number;
  matched: number;
  beaten: number;
  mastered: number;
  syncedAt: string | null;
}

/**
 * Under RetroAchievements' key on Settings > Features: the Test button (saving first), reading your progress now,
 * and what the last read found.
 */
export function RaButtons({ unsaved, save }: { unsaved: boolean; save: () => Promise<boolean> }) {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ['retroachievements'], queryFn: () => api<RaStatus>('/sources/retroachievements') });
  const test = useMutation({
    mutationFn: async () => {
      if (unsaved && !(await save())) return null;
      return api<{ ok: boolean; message: string }>('/sources/retroachievements/test', { method: 'POST' });
    },
    onSuccess: (r) => {
      if (!r) return;
      if (r.ok) notifySuccess(r.message, 'RetroAchievements');
      else notifyError(new Error(r.message), 'RetroAchievements');
    },
    onError: (err) => notifyError(err, 'RetroAchievements'),
  });
  const sync = useMutation({
    mutationFn: () => api('/sources/retroachievements/sync', { method: 'POST' }),
    onSuccess: () => {
      notifySuccess('Reading your RetroAchievements progress; it shows in each game\'s drawer in a moment.', 'RetroAchievements');
      setTimeout(() => void queryClient.invalidateQueries({ queryKey: ['retroachievements'] }), 5000);
    },
    onError: (err) => notifyError(err, 'RetroAchievements'),
  });
  const s = status.data;
  return (
    <Stack gap={6}>
      <Group gap="sm">
        <Button variant="default" leftSection={<IconPlugConnected size={14} />} loading={test.isPending} onClick={() => test.mutate()}>
          {unsaved ? 'Save and test' : 'Test the key'}
        </Button>
        {s?.configured && !unsaved && (
          <Button variant="default" leftSection={<IconRefresh size={14} />} loading={sync.isPending} onClick={() => sync.mutate()}>
            Read now
          </Button>
        )}
      </Group>
      {s && s.syncedAt && (
        <Text size="sm" c="dimmed">
          Read {timeAgo(s.syncedAt)}: {s.games} {s.games === 1 ? 'game' : 'games'} with progress, {s.matched} on your consoles, {s.mastered} mastered, {s.beaten} beaten.
        </Text>
      )}
    </Stack>
  );
}
