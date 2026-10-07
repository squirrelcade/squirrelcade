import { ActionIcon, Alert, Anchor, Badge, Button, Code, Group, Table, Text, Tooltip } from '@mantine/core';
import { IconDownload, IconHistory, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../../api';
import { PageHeader, type SortDirection } from '../../components';
import { bytes, dateTime } from '../../format';
import { notifyError, notifySuccess, useSetting } from '../../hooks';
import { sortRows, useSort } from '../../sort';

interface BackupList {
  folder: string;
  /** The second backup folder each backup is copied to, or null. */
  copyFolder: string | null;
  restorePending: boolean;
  backups: { name: string; bytes: number; createdAt: string; kind: 'scheduled' | 'manual' | 'update' }[];
}

/** The backups' headings sort them (D144): newest and biggest first, kinds A to Z. */
const SORTS = { made: 'desc', kind: 'asc', size: 'desc' } as const satisfies Record<string, SortDirection>;

/** Backups: make one now, download or delete them, and restore one (applied at the next start). */
export function BackupsPage() {
  const queryClient = useQueryClient();
  const dateFormat = useSetting('general.dateFormat', 'us');
  const keep = useSetting('storage.backupRetention', 14);
  const { data } = useQuery({ queryKey: ['backups'], queryFn: () => api<BackupList>('/backups') });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['backups'] });
  const sorting = useSort(SORTS, 'made');
  // A kind sorts by the name it shows.
  const rows = sortRows(
    data?.backups ?? [],
    (b) => (sorting.by === 'kind' ? (b.kind === 'manual' ? 'Manual' : b.kind === 'update' ? 'Before update' : 'Automatic') : sorting.by === 'size' ? b.bytes : b.createdAt),
    sorting.dir,
  );

  const create = useMutation({
    mutationFn: () => api<{ name: string }>('/backups', { method: 'POST' }),
    onSuccess: (b) => {
      notifySuccess(`${b.name} created.`, 'Backed up');
      void refresh();
    },
    onError: (err) => notifyError(err, 'Backup failed'),
  });
  const restore = useMutation({
    mutationFn: (name: string) => api(`/backups/${name}/restore`, { method: 'POST' }),
    onSuccess: () => {
      notifySuccess('The restore happens the next time Squirrelcade restarts.', 'Restore staged');
      void refresh();
    },
    onError: (err) => notifyError(err),
  });
  const cancel = useMutation({ mutationFn: () => api('/backups/restore', { method: 'DELETE' }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (name: string) => api(`/backups/${name}`, { method: 'DELETE' }), onSuccess: refresh, onError: (err) => notifyError(err) });

  return (
    <>
      <PageHeader help="backups"
        title="Backups"
        description={
          <>
            Automatic backups keep the newest {keep}; manual ones stay until you delete them. Folder: <Code>{data?.folder}</Code>
            {data?.copyFolder && (
              <>
                , copied to <Code>{data.copyFolder}</Code>
              </>
            )}{' '}
            <Anchor component={Link} to="/settings/storage" size="sm">
              Settings
            </Anchor>
          </>
        }
        actions={
          <Button onClick={() => create.mutate()} loading={create.isPending}>
            Back up now
          </Button>
        }
      />
      {data?.restorePending && (
        <Alert color="yellow" mb="md" title="Restore waiting for a restart">
          <Group justify="space-between">
            <Text size="sm">A backup will replace the database when Squirrelcade next starts. The current database is kept next to it.</Text>
            <Button size="xs" variant="default" onClick={() => cancel.mutate()}>
              Cancel restore
            </Button>
          </Group>
        </Alert>
      )}
      <Table.ScrollContainer minWidth={600}>
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              {sorting.th('made', 'Made')}
              {sorting.th('kind', 'Kind')}
              {sorting.th('size', 'Size', { ta: 'right' })}
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((b) => (
              <Table.Tr key={b.name}>
                <Table.Td>
                  <Text size="sm">{dateTime(b.createdAt, dateFormat)}</Text>
                  <Text size="xs" c="dimmed" ff="monospace">
                    {b.name}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Badge variant="light" color={b.kind === 'manual' ? 'forest' : b.kind === 'update' ? 'orange' : 'gray'}>
                    {b.kind === 'manual' ? 'Manual' : b.kind === 'update' ? 'Before update' : 'Automatic'}
                  </Badge>
                </Table.Td>
                <Table.Td ta="right">{bytes(b.bytes)}</Table.Td>
                <Table.Td>
                  <Group gap={4} justify="flex-end">
                    <Tooltip label="Download">
                      <ActionIcon variant="subtle" component="a" href={`/api/v1/backups/${b.name}`} aria-label="Download">
                        <IconDownload size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Restore this backup">
                      <ActionIcon
                        variant="subtle"
                        aria-label="Restore"
                        onClick={() =>
                          window.confirm(`Restore ${b.name}? It replaces the whole database the next time Squirrelcade restarts.`) && restore.mutate(b.name)
                        }
                      >
                        <IconHistory size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Delete">
                      <ActionIcon variant="subtle" color="red" aria-label="Delete" onClick={() => window.confirm(`Delete ${b.name}?`) && remove.mutate(b.name)}>
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {data?.backups.length === 0 && (
        <Text c="dimmed" ta="center" mt="md">
          No backups yet. The first automatic one runs shortly after Squirrelcade starts.
        </Text>
      )}
    </>
  );
}
