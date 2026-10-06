import { Alert, Button, Divider, Group, Stack, Table, Text } from '@mantine/core';
import { IconPlugConnected, IconRefresh } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { count, dateTime } from '../format';
import { notifyError, notifySuccess, useSetting } from '../hooks';

interface Status {
  configured: boolean;
  syncedAt: string | null;
  error: string | null;
  roms: number;
  platforms: { key: string; name: string; romm: { slug: string; name: string }[]; via: 'setting' | 'igdb' | 'name' | null; roms: number }[];
  owned: { matched: number; possible: number; owned: number } | null;
}

const VIA = { setting: 'your setting', igdb: 'IGDB number', name: 'name' } as const;

const useRommStatus = () => useQuery({ queryKey: ['romm'], queryFn: () => api<Status>('/sources/romm'), refetchInterval: 30_000 });

/** RomM's connection test and "Update now", right under its token in Settings > Sources. With unsaved changes, the test saves them first. */
export function RommButtons({ unsaved, save }: { unsaved: boolean; save: () => Promise<boolean> }) {
  const queryClient = useQueryClient();
  const s = useRommStatus().data;
  const configured = s?.configured ?? false;
  const test = useMutation({
    mutationFn: async () => {
      if (unsaved && !(await save())) return null;
      return api<{ ok: boolean; message: string }>('/sources/romm/test', { method: 'POST' });
    },
    onSuccess: (r) => {
      if (!r) return;
      if (r.ok) notifySuccess(r.message, 'RomM');
      else notifyError(new Error(r.message), 'RomM');
      void queryClient.invalidateQueries({ queryKey: ['romm'] });
    },
    onError: (err) => notifyError(err, 'RomM'),
  });
  const update = useMutation({
    mutationFn: () => api('/sources/romm/sync', { method: 'POST' }),
    onSuccess: () => {
      notifySuccess("Squirrelcade reads RomM's list of ROMs in the background; the activity icon at the top shows how far along it is.");
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (err) => notifyError(err),
  });
  return (
    <Stack gap="xs">
      <Group gap="sm">
        <Button variant="default" leftSection={<IconPlugConnected size={14} />} loading={test.isPending} disabled={!configured && !unsaved} onClick={() => test.mutate()}>
          {unsaved ? 'Save and test' : 'Test connection'}
        </Button>
        <Button variant="default" leftSection={<IconRefresh size={14} />} loading={update.isPending} disabled={unsaved || !configured} onClick={() => update.mutate()}>
          Update now
        </Button>
      </Group>
      {s && !configured && !unsaved && (
        <Alert color="gray" p="xs">
          Add RomM's address and an API token to link your games to RomM.
        </Alert>
      )}
    </Stack>
  );
}

/** What Squirrelcade knows of RomM: when the index was read, how many owned games RomM has, and which RomM platform each platform is. */
export function RommStatusTable() {
  const dateFormat = useSetting('general.dateFormat', 'us');
  const s = useRommStatus().data;
  if (!s || !s.configured) return null;
  return (
    <Stack gap="sm">
      <Divider />
      <Text size="sm">
        {s.syncedAt ? `Index: ${count(s.roms)} ROMs, read ${dateTime(s.syncedAt, dateFormat)}.` : 'The index has not been read yet.'}
        {s.owned &&
          ` ${count(s.owned.matched)} of your ${count(s.owned.owned)} games are in RomM${s.owned.possible > 0 ? `, and ${count(s.owned.possible)} more possibly (the same title, not confirmed by IGDB)` : ''}.`}
      </Text>
      {s.error && (
        <Alert color="orange" p="xs">
          {s.error}
        </Alert>
      )}
      <Table.ScrollContainer minWidth={480}>
        <Table verticalSpacing={4} fz="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Platform</Table.Th>
              <Table.Th>In RomM</Table.Th>
              <Table.Th>Found by</Table.Th>
              <Table.Th ta="right">ROMs</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {s.platforms.map((p) => (
              <Table.Tr key={p.key}>
                <Table.Td>{p.name}</Table.Td>
                <Table.Td>
                  {p.romm.length > 0 ? (
                    p.romm.map((r) => r.name).join(', ')
                  ) : (
                    <Text span size="sm" c="dimmed">
                      none
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>{p.via ? VIA[p.via] : ''}</Table.Td>
                <Table.Td ta="right">{p.romm.length > 0 ? count(p.roms) : ''}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}
