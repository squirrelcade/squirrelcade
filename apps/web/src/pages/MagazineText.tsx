import { Alert, Anchor, Button, Card, Checkbox, FileButton, Group, Loader, SegmentedControl, Stack, Text, Title } from '@mantine/core';
import { IconDownload, IconUpload } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { bytes, dateTime } from '../format';
import { notifyError, useSetting } from '../hooks';

/** What the text's share is doing and the exports made (GET /api/v1/magazines/text, D209). */
interface TextShare {
  job: { kind: 'export' | 'import'; state: 'running' | 'done' | 'failed'; progress: string; startedAt: string; error: string | null; result: { file: string; issues: number; pages: number; filled: number; skipped: number; unmatched: number; rules: number } | null } | null;
  exports: { name: string; bytes: number; at: string }[];
  lastExportAt: string | null;
}

/**
 * Settings > Magazines > Share the text (D209): the text Squirrelcade read from your scans, exported for a friend with
 * the same scans (their install takes it instead of reading every page again: an older NAS reads a page in minutes),
 * and a friend's export brought in. Only the magazines' text goes, never your collection.
 */
export function MagazineTextShare() {
  const dateFormat = useSetting('general.dateFormat', 'us');
  const on = useSetting('features.magazines', false);
  const queryClient = useQueryClient();
  const [since, setSince] = useState<'all' | 'last'>('all');
  const [rules, setRules] = useState(false);
  const share = useQuery({
    queryKey: ['magazines', 'text'],
    queryFn: () => api<TextShare>('/magazines/text'),
    enabled: on,
    refetchInterval: (q) => (q.state.data?.job?.state === 'running' ? 2000 : false),
  });
  const exportIt = useMutation({
    mutationFn: () => api<TextShare>('/magazines/text/export', { method: 'POST', json: { since } }),
    onSuccess: (d) => queryClient.setQueryData(['magazines', 'text'], d),
    onError: (err) => notifyError(err),
  });
  const importIt = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('rules', rules ? 'true' : 'false');
      form.append('file', file);
      return api<TextShare>('/magazines/text/import', { method: 'POST', body: form });
    },
    onSuccess: (d) => queryClient.setQueryData(['magazines', 'text'], d),
    onError: (err) => notifyError(err),
  });
  if (!on) return null;
  const d = share.data;
  const running = d?.job?.state === 'running';
  const r = d?.job?.result;
  return (
    <Card withBorder mt="md" id="share-the-text">
      <Title order={4} mb={4}>
        Share the text with a friend
      </Title>
      <Text size="sm" c="dimmed" mb="sm">
        Someone with the same scans can take the text Squirrelcade read from yours instead of reading every page again (on an older NAS a page takes minutes).
        The export holds only the magazines&apos; text, each page&apos;s words and where they are, never your collection. Their install fills only the issues it
        has without text, found by the file&apos;s name or by the magazine and its number.
      </Text>
      <Stack gap="sm">
        <Group gap="sm" wrap="wrap">
          <SegmentedControl
            size="xs"
            value={since}
            onChange={(v) => setSince(v as 'all' | 'last')}
            data={[
              { value: 'all', label: 'All the text' },
              { value: 'last', label: 'Only what was read since the last export' },
            ]}
            aria-label="Which issues"
          />
          <Button size="xs" leftSection={<IconDownload size={14} />} loading={exportIt.isPending} disabled={running} onClick={() => exportIt.mutate()}>
            Export the text
          </Button>
        </Group>
        {d?.lastExportAt && (
          <Text size="xs" c="dimmed">
            Last exported {dateTime(d.lastExportAt, dateFormat)}.
          </Text>
        )}
        <Group gap="sm" wrap="wrap">
          <FileButton accept=".zip,application/zip" onChange={(f) => f && importIt.mutate(f)}>
            {(props) => (
              <Button {...props} size="xs" variant="default" leftSection={<IconUpload size={14} />} loading={importIt.isPending} disabled={running}>
                Import a friend&apos;s text
              </Button>
            )}
          </FileButton>
          <Checkbox size="xs" label="Also their answers about which game a page means" checked={rules} onChange={(e) => setRules(e.currentTarget.checked)} />
        </Group>
        <Text size="xs" c="dimmed">
          Or put their export in the magazines&apos; text folder (Text already read): the next reading of the folder brings it in.
        </Text>
        {running && (
          <Group gap="xs">
            <Loader size="xs" />
            <Text size="sm">
              {d!.job!.kind === 'export' ? 'Exporting' : 'Reading their text'}: {d!.job!.progress}
            </Text>
          </Group>
        )}
        {d?.job?.state === 'failed' && (
          <Alert color="red" py="xs">
            {d.job.error}
          </Alert>
        )}
        {d?.job?.state === 'done' && r && d.job.kind === 'import' && (
          <Alert color="green" py="xs">
            {r.filled} {r.filled === 1 ? 'issue' : 'issues'} filled from their text{r.skipped > 0 ? `, ${r.skipped} had text already` : ''}
            {r.unmatched > 0 ? `, ${r.unmatched} not found here (another scan, or a magazine you don't have)` : ''}
            {r.rules > 0 ? `, ${r.rules} answers` : ''}. The games on the new pages are being found.
          </Alert>
        )}
        {d?.job?.state === 'done' && r && d.job.kind === 'export' && (
          <Alert color="green" py="xs">
            Exported {r.issues} {r.issues === 1 ? 'issue' : 'issues'} ({r.pages.toLocaleString()} pages).
          </Alert>
        )}
        {(d?.exports ?? []).map((x) => (
          <Group key={x.name} gap="xs">
            <Anchor href={`/api/v1/magazines/text/exports/${encodeURIComponent(x.name)}`} size="sm">
              {x.name}
            </Anchor>
            <Text size="xs" c="dimmed">
              {bytes(x.bytes)} · {dateTime(x.at, dateFormat)}
            </Text>
          </Group>
        ))}
      </Stack>
    </Card>
  );
}
