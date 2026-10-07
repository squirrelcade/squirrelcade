import { Alert, Anchor, Badge, Button, Code, Drawer, Group, List, Stack, Table, Tabs, Text, Title } from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { IconAlertTriangle, IconFileSpreadsheet, IconUpload } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { PageHeader, StatusBadge, type SortDirection } from '../components';
import { count, dateTime } from '../format';
import { notifyError, notifySuccess, useSetting } from '../hooks';
import { sortRows, useSort } from '../sort';
import { MailCard } from './MailExtras';
import { SendToPriceCharting } from './SendExtras';

/** What the upload takes: PriceCharting's CSV, or the zip it arrives in. */
export const EXPORT_FILES = { 'text/csv': ['.csv'], 'application/vnd.ms-excel': ['.csv'], 'application/zip': ['.zip'], 'application/x-zip-compressed': ['.zip'] };

/** The history's headings sort it (D144): updates newest first, files and statuses A to Z, counts most first. */
const SORTS = { when: 'desc', file: 'asc', status: 'asc', games: 'desc', added: 'desc', removed: 'desc', changed: 'desc' } as const satisfies Record<string, SortDirection>;

interface ImportSummary {
  id: number;
  source: 'upload' | 'folder' | 'email';
  fileName: string;
  fileBytes: number;
  status: 'applied' | 'pending' | 'discarded' | 'refused';
  current: boolean;
  createdAt: string;
  appliedAt: string | null;
  rowCount: number;
  copyCount: number;
  addedCount: number;
  removedCount: number;
  changedCount: number;
  message: string | null;
}

interface Change {
  productId: string;
  title: string;
  consoleLabel: string;
  before: number;
  after: number;
}

interface Report {
  errors: string[];
  warnings: string[];
  excluded: { label: string; rows: number }[];
  diff: { added: Change[]; removed: Change[]; quantityChanged: Change[]; copiesBefore: number; copiesAfter: number } | null;
  removalPercent: number;
  /** What an applied update did to the collection's copies (not in reports from before 0.19.0). */
  copies?: { matched: number; added: number; missing: number; gone: number };
}

interface Outcome {
  import: ImportSummary;
  report: Report;
  duplicate: boolean;
}

/** Collection updates: upload PriceCharting's export (CSV or zip), confirm or discard held updates, and the history with each update's report. */
export function ImportsPage() {
  const queryClient = useQueryClient();
  const dateFormat = useSetting('general.dateFormat', 'us');
  const pattern = useSetting('collection.importFilePattern', 'collection_*.csv');
  const folderOn = useSetting('collection.dropFolderEnabled', true);
  const [openId, setOpenId] = useState<number | null>(null);
  const list = useQuery({ queryKey: ['imports'], queryFn: () => api<ImportSummary[]>('/imports'), refetchInterval: 15_000 });
  const status = useQuery({ queryKey: ['system', 'status'], queryFn: () => api<{ folders: { name: string; path: string; exists: boolean }[] }>('/system/status') });
  const importsFolder = status.data?.folders.find((f) => f.name === 'Watched folder');

  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['imports'] }), queryClient.invalidateQueries({ queryKey: ['collection'] }), queryClient.invalidateQueries({ queryKey: ['platforms'] }), queryClient.invalidateQueries({ queryKey: ['catalogs'] }), queryClient.invalidateQueries({ queryKey: ['wishlist'] })]);

  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api<Outcome>('/imports', { method: 'POST', body: form });
    },
    onSuccess: async (outcome) => {
      await refresh();
      const i = outcome.import;
      if (outcome.duplicate) notifySuccess(i.status === 'pending' ? 'This file is the update waiting for your confirmation.' : 'This file matches your current collection.', 'Nothing new');
      else if (i.status === 'applied') notifySuccess(`${count(i.addedCount)} added, ${count(i.removedCount)} removed, ${count(i.changedCount)} changed.`, 'Collection updated');
      else if (i.status === 'pending') notifySuccess(i.message ?? 'Waiting for your confirmation.', 'Update held');
      else notifyError(new Error(i.message ?? 'The file was refused.'), 'Update refused');
      setOpenId(i.id);
    },
    onError: (err) => notifyError(err, 'Upload failed'),
  });

  const act = useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'apply' | 'discard' }) => api(`/imports/${id}/${action}`, { method: 'POST' }),
    onSuccess: async (_d, v) => {
      await refresh();
      notifySuccess(v.action === 'apply' ? 'The update is now your collection.' : 'The held update was discarded.');
    },
    onError: (err) => notifyError(err),
  });

  const pending = list.data?.filter((i) => i.status === 'pending') ?? [];
  const sorting = useSort(SORTS, 'when');
  const rows = sortRows(
    list.data ?? [],
    (i) => (sorting.by === 'file' ? i.fileName : sorting.by === 'status' ? i.status : sorting.by === 'games' ? i.rowCount : sorting.by === 'added' ? i.addedCount : sorting.by === 'removed' ? i.removedCount : sorting.by === 'changed' ? i.changedCount : i.createdAt),
    sorting.dir,
  );

  return (
    <>
      <PageHeader help="collection" title="Stash updates" description="Keep your collection up to date with PriceCharting's export: the CSV file, or the collection.zip it arrives in." />
      {pending.map((p) => (
        <Alert key={p.id} color="yellow" icon={<IconAlertTriangle />} title={`${p.fileName} is waiting for you`} mb="md">
          <Stack gap="xs">
            <Text size="sm">{p.message}</Text>
            <Group gap="xs">
              <Button size="xs" color="yellow" onClick={() => act.mutate({ id: p.id, action: 'apply' })} loading={act.isPending}>
                Apply it anyway
              </Button>
              <Button size="xs" variant="default" onClick={() => act.mutate({ id: p.id, action: 'discard' })} loading={act.isPending}>
                Discard
              </Button>
              <Button size="xs" variant="subtle" onClick={() => setOpenId(p.id)}>
                See what changes
              </Button>
            </Group>
          </Stack>
        </Alert>
      ))}
      <Dropzone onDrop={(files) => files[0] && upload.mutate(files[0])} loading={upload.isPending} accept={EXPORT_FILES} maxFiles={1} mb="xs">
        <Group justify="center" gap="xl" mih={110} style={{ pointerEvents: 'none' }}>
          <Dropzone.Accept>
            <IconUpload size={40} />
          </Dropzone.Accept>
          <Dropzone.Idle>
            <IconFileSpreadsheet size={40} />
          </Dropzone.Idle>
          <div>
            <Text size="lg">Drop an export here (PriceCharting's, CLZ's, GAMEYE's, VGCollect's, or a spreadsheet of your own), or click to choose it</Text>
            <Text size="sm" c="dimmed">
              On PriceCharting: My Collection › Download (CSV). The collection.zip it arrives as works as it is. A spreadsheet of your own works too, saved as CSV with a Title and a Console column (see Help). Squirrelcade compares it with your current collection before anything changes.
            </Text>
          </div>
        </Group>
      </Dropzone>
      <Text size="xs" c="dimmed" mb="lg">
        {folderOn ? (
          <>
            Files named <Code>{pattern}</Code> in the watched folder {importsFolder ? <Code>{importsFolder.path}</Code> : null} update your collection automatically.
          </>
        ) : (
          <>The watched folder is off.</>
        )}{' '}
        <Anchor component={Link} to="/settings/collection" size="xs">
          Change this
        </Anchor>
      </Text>
      <MailCard />
      <SendToPriceCharting />

      <Title order={4} mb="xs">
        History
      </Title>
      <Table.ScrollContainer minWidth={760}>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              {sorting.th('when', 'When')}
              {sorting.th('file', 'File')}
              {sorting.th('status', 'Status')}
              {sorting.th('games', 'Games', { ta: 'right' })}
              {sorting.th('added', 'Added', { ta: 'right' })}
              {sorting.th('removed', 'Removed', { ta: 'right' })}
              {sorting.th('changed', 'Changed', { ta: 'right' })}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((i) => (
              <Table.Tr key={i.id} style={{ cursor: 'pointer' }} onClick={() => setOpenId(i.id)}>
                <Table.Td>{dateTime(i.createdAt, dateFormat)}</Table.Td>
                <Table.Td>
                  <Group gap={6}>
                    <Text size="sm">{i.fileName}</Text>
                    {(i.source === 'folder' || i.source === 'email') && (
                      <Badge size="xs" variant="outline">
                        {i.source}
                      </Badge>
                    )}
                    {i.current && (
                      <Badge size="xs" color="forest">
                        current
                      </Badge>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td>
                  <StatusBadge status={i.status} />
                </Table.Td>
                <Table.Td ta="right">{count(i.rowCount)}</Table.Td>
                <Table.Td ta="right">{count(i.addedCount)}</Table.Td>
                <Table.Td ta="right">{count(i.removedCount)}</Table.Td>
                <Table.Td ta="right">{count(i.changedCount)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {list.data?.length === 0 && (
        <Text c="dimmed" ta="center" mt="md">
          No updates yet.
        </Text>
      )}
      <ImportDrawer id={openId} onClose={() => setOpenId(null)} />
    </>
  );
}

function ChangeList({ changes, empty, showCounts }: { changes: Change[]; empty: string; showCounts?: boolean }) {
  if (changes.length === 0) return <Text c="dimmed" size="sm">{empty}</Text>;
  return (
    <List size="sm" spacing={2}>
      {changes.map((c) => (
        <List.Item key={c.productId}>
          {c.title}{' '}
          <Text span c="dimmed" size="xs">
            ({c.consoleLabel}
            {showCounts ? `, ${c.before} → ${c.after} copies` : c.after > 1 || c.before > 1 ? `, ${Math.max(c.after, c.before)} copies` : ''})
          </Text>
        </List.Item>
      ))}
    </List>
  );
}

function ImportDrawer({ id, onClose }: { id: number | null; onClose: () => void }) {
  const dateFormat = useSetting('general.dateFormat', 'us');
  const detail = useQuery({
    queryKey: ['imports', id],
    queryFn: () => api<{ import: ImportSummary; report: Report }>(`/imports/${id}`),
    enabled: id !== null,
  });
  const d = detail.data;
  return (
    <Drawer opened={id !== null} onClose={onClose} position="right" size="lg" title={d ? d.import.fileName : 'Update'}>
      {d && (
        <Stack>
          <Group gap="xs">
            <StatusBadge status={d.import.status} />
            <Text size="sm" c="dimmed">
              {dateTime(d.import.createdAt, dateFormat)} · {count(d.import.rowCount)} rows · {count(d.import.copyCount)} copies
            </Text>
          </Group>
          {d.import.message && <Text size="sm">{d.import.message}</Text>}
          {d.report.errors.length > 0 && (
            <Alert color="red" title="Why it was refused">
              <List size="sm">
                {d.report.errors.map((e) => (
                  <List.Item key={e}>{e}</List.Item>
                ))}
              </List>
            </Alert>
          )}
          {d.report.warnings.length > 0 && (
            <Alert color="yellow" title="Fixed or skipped">
              <List size="sm">
                {d.report.warnings.map((w) => (
                  <List.Item key={w}>{w}</List.Item>
                ))}
              </List>
            </Alert>
          )}
          {d.report.copies && (
            <Text size="sm">
              {[
                `${count(d.report.copies.matched)} cop${d.report.copies.matched === 1 ? 'y' : 'ies'} already in your collection`,
                `${count(d.report.copies.added)} new`,
                d.report.copies.gone > 0 ? `${count(d.report.copies.gone)} removed with it` : null,
              ]
                .filter(Boolean)
                .join(', ')}
              .{' '}
              {d.report.copies.missing > 0 && (
                <>
                  {count(d.report.copies.missing)} it no longer has {d.report.copies.missing === 1 ? 'waits' : 'wait'} on{' '}
                  <Anchor component={Link} to="/review?tab=copies" size="sm">
                    Review
                  </Anchor>
                  .
                </>
              )}
            </Text>
          )}
          {d.report.excluded.length > 0 && (
            <Text size="sm" c="dimmed">
              Skipped: {d.report.excluded.map((e) => `${e.rows} ${e.label} row${e.rows === 1 ? '' : 's'}`).join(', ')} (see Settings › Platforms).
            </Text>
          )}
          {d.report.diff && (
            <Tabs defaultValue="added">
              <Tabs.List>
                <Tabs.Tab value="added">Added ({d.report.diff.added.length})</Tabs.Tab>
                <Tabs.Tab value="removed">Removed ({d.report.diff.removed.length})</Tabs.Tab>
                <Tabs.Tab value="changed">Copies changed ({d.report.diff.quantityChanged.length})</Tabs.Tab>
              </Tabs.List>
              <Tabs.Panel value="added" pt="sm">
                <ChangeList changes={d.report.diff.added} empty="No new games." />
              </Tabs.Panel>
              <Tabs.Panel value="removed" pt="sm">
                <ChangeList changes={d.report.diff.removed} empty="Nothing removed." />
              </Tabs.Panel>
              <Tabs.Panel value="changed" pt="sm">
                <ChangeList changes={d.report.diff.quantityChanged} empty="No copy counts changed." showCounts />
              </Tabs.Panel>
            </Tabs>
          )}
        </Stack>
      )}
    </Drawer>
  );
}
