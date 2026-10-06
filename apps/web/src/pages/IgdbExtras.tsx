import { Alert, Button, Divider, Group, Stack, Table, Text } from '@mantine/core';
import { IconPlugConnected, IconRefresh } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { count, dateTime } from '../format';
import { notifyError, notifySuccess, useSetting } from '../hooks';

interface Status {
  configured: boolean;
  platforms: { key: string; name: string; igdbId: number | null; extraIgdbId: number | null; games: number; syncedAt: string | null; error: string | null }[];
}

const useIgdbStatus = () => useQuery({ queryKey: ['igdb'], queryFn: () => api<Status>('/sources/igdb'), refetchInterval: 15_000 });

/** IGDB's connection test and "Update now", right under its keys in Settings > Sources. With unsaved changes, the test saves them first. */
export function IgdbButtons({ unsaved, save }: { unsaved: boolean; save: () => Promise<boolean> }) {
  const queryClient = useQueryClient();
  const status = useIgdbStatus();
  const test = useMutation({
    mutationFn: async () => {
      if (unsaved && !(await save())) return null;
      return api<{ ok: boolean; message: string }>('/sources/igdb/test', { method: 'POST' });
    },
    onSuccess: (r) => {
      if (!r) return;
      if (r.ok) notifySuccess(r.message, 'IGDB');
      else notifyError(new Error(r.message), 'IGDB');
      void queryClient.invalidateQueries({ queryKey: ['igdb'] });
    },
    onError: (err) => notifyError(err, 'IGDB'),
  });
  const update = useMutation({
    mutationFn: () => api('/tasks/igdb-sync/run', { method: 'POST' }),
    onSuccess: () => {
      notifySuccess('The download runs in the background for a few minutes; the activity icon at the top shows how far along it is.');
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['igdb'] }), 5000);
    },
    onError: (err) => notifyError(err),
  });
  const s = status.data;
  const configured = s?.configured ?? false;

  return (
    <Stack gap="xs">
      <Group gap="sm">
        <Button variant="default" leftSection={<IconPlugConnected size={14} />} loading={test.isPending} disabled={!configured && !unsaved} onClick={() => test.mutate()}>
          {unsaved ? 'Save and test' : 'Test connection'}
        </Button>
        <Button variant="default" leftSection={<IconRefresh size={14} />} loading={update.isPending} disabled={unsaved || !configured} onClick={() => update.mutate()}>
          Update now
        </Button>
        {unsaved && (
          <Text size="xs" c="dimmed">
            "Update now" needs your changes saved first.
          </Text>
        )}
      </Group>
      {s && !configured && !unsaved && (
        <Alert color="gray" p="xs">
          Add a client ID and secret above to turn IGDB on.
        </Alert>
      )}
    </Stack>
  );
}

/** What IGDB data is downloaded for each platform, at the end of the IGDB box. */
export function IgdbStatusTable() {
  const dateFormat = useSetting('general.dateFormat', 'us');
  const s = useIgdbStatus().data;
  return (
    <Stack gap="sm">
      <Divider />
      <Text size="sm" c="dimmed">
        Squirrelcade downloads the IGDB game list of each platform that has a catalog, then matches catalog games by name for covers, genres and series.
      </Text>
      {s && s.platforms.length > 0 && (
        <Table.ScrollContainer minWidth={520}>
          <Table verticalSpacing={4} fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Platform</Table.Th>
                <Table.Th>IGDB number</Table.Th>
                <Table.Th>Games</Table.Th>
                <Table.Th>Updated</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {s.platforms.map((p) => (
                <Table.Tr key={p.key}>
                  <Table.Td>{p.name}</Table.Td>
                  <Table.Td>
                    {p.igdbId === null ? (
                      <Text span c="orange" size="sm">
                        none set
                      </Text>
                    ) : (
                      [p.igdbId, p.extraIgdbId].filter((id) => id !== null).join(' + ')
                    )}
                  </Table.Td>
                  <Table.Td>{p.syncedAt ? count(p.games) : '—'}</Table.Td>
                  <Table.Td>
                    {p.error ? (
                      <Text span c="red" size="sm">
                        {p.error}
                      </Text>
                    ) : p.syncedAt ? (
                      dateTime(p.syncedAt, dateFormat)
                    ) : (
                      'never'
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Stack>
  );
}
