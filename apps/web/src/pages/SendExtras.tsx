import { Anchor, Button, Card, Group, Stack, Table, Text, Textarea, TextInput, Title } from '@mantine/core';
import { priceChartingUrl } from '@squirrelcade/core';
import { IconCopy, IconDownload, IconExternalLink, IconSend } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { copyText } from '../Copy';
import { count, date, money } from '../format';
import { notifyError, notifySuccess, useSetting } from '../hooks';

/** A copy of Squirrelcade's own on its way to PriceCharting, or sold here and still listed there (GET /api/v1/send/pricecharting). */
interface SendCopy {
  id: number;
  title: string;
  platform: string | null;
  condition: string;
  line: string;
  conditionReadThere: boolean;
  sentAt: string | null;
  goneAt: string | null;
  goneReason: string | null;
  /** Its PriceCharting product id, when Squirrelcade knows it: then it goes in the CSV with its details. */
  pcId: string | null;
  costCents: number | null;
  datePurchased: string | null;
  notes: string;
}

interface ForPriceCharting {
  toSend: SendCopy[];
  waiting: SendCopy[];
  toRemove: SendCopy[];
  /** The paste importer's lines: the copies whose product isn't known. */
  text: string;
}

/** PriceCharting's page that takes pasted lines ("Title Console Condition"), one import a week on a free account. */
export const PRICECHARTING_IMPORTER = 'https://www.pricecharting.com/collection-text-importer';
/** PriceCharting's page that takes a CSV by product id, with what you paid, the day bought and notes. */
export const PRICECHARTING_CSV_IMPORTER = 'https://www.pricecharting.com/collection-import-csv';

/** A copy without a known product: the box for its PriceCharting ID, and where to find it. */
function PriceChartingId({ c, currency, onSaved }: { c: SendCopy; currency: string; onSaved: () => Promise<unknown> }) {
  const [value, setValue] = useState('');
  const save = useMutation({
    mutationFn: () => api(`/send/pricecharting/${c.id}/product`, { method: 'PUT', json: { pcId: value.trim() } }),
    onSuccess: async () => {
      notifySuccess(`${c.title} goes in the CSV now, with its details.`);
      setValue('');
      await onSaved();
    },
    onError: (err) => notifyError(err),
  });
  return (
    <Group gap="xs" wrap="wrap" align="center">
      <Text size="sm" style={{ minWidth: 0, flex: '1 1 12rem' }}>
        {c.title}{' '}
        <Text span size="xs" c="dimmed">
          {c.platform ?? '?'} · {c.condition}
          {c.costCents ? ` · paid ${money(c.costCents, currency)}` : ''}
        </Text>
      </Text>
      <Anchor href={priceChartingUrl(c.title, c.platform ?? '')} target="_blank" rel="noreferrer" size="xs">
        Find it on PriceCharting
      </Anchor>
      <TextInput
        size="xs"
        w={130}
        placeholder="PriceCharting ID"
        aria-label={`PriceCharting ID of ${c.title}`}
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.currentTarget.value.replace(/\D/g, ''))}
        onKeyDown={(e) => e.key === 'Enter' && value && save.mutate()}
      />
      <Button size="compact-xs" variant="default" disabled={!value} loading={save.isPending} onClick={() => save.mutate()}>
        Save
      </Button>
    </Group>
  );
}

/**
 * Send to PriceCharting (0.20.0, D83; the CSV, D150): the copies added in Squirrelcade that PriceCharting doesn't have
 * yet, two ways. Those whose PriceCharting product Squirrelcade knows (from an export that had the game, or an ID
 * typed here) go in a CSV for PriceCharting's CSV importer, with their condition, what you paid, the day bought and
 * your notes, after a look at the list; the rest go by title, as lines for its paste importer. Then the ones sent and
 * waiting for an export, and the copies sold or removed here that PriceCharting still lists. Shown on Stash updates
 * while there's something to do.
 */
export function SendToPriceCharting() {
  const queryClient = useQueryClient();
  const dateFormat = useSetting('general.dateFormat', 'us');
  const currency = useSetting('general.currency', 'USD');
  const data = useQuery({ queryKey: ['send', 'pricecharting'], queryFn: () => api<ForPriceCharting>('/send/pricecharting') });
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['send'] }), queryClient.invalidateQueries({ queryKey: ['game'] }), queryClient.invalidateQueries({ queryKey: ['purchases'] })]);
  const mark = useMutation({
    mutationFn: (v: { path: 'sent' | 'removed'; ids: number[] }) => api(`/send/pricecharting/${v.path}`, { method: 'POST', json: { ids: v.ids } }),
    onSuccess: async (_r, v) => {
      notifySuccess(v.path === 'sent' ? 'Noted: they wait for your next PriceCharting export.' : 'Noted: nothing left to remove on PriceCharting.');
      await refresh();
    },
    onError: (err) => notifyError(err),
  });
  const d = data.data;
  if (!d || d.toSend.length + d.waiting.length + d.toRemove.length === 0) return null;
  const withId = d.toSend.filter((c) => c.pcId !== null);
  const byTitle = d.toSend.filter((c) => c.pcId === null);
  const unread = byTitle.filter((c) => !c.conditionReadThere);

  async function copyList() {
    if (await copyText(d!.text)) notifySuccess(`${count(byTitle.length)} line${byTitle.length === 1 ? '' : 's'} copied. Paste them into PriceCharting's importer.`);
    else notifyError(new Error("This browser didn't let Squirrelcade copy: select the list and copy it yourself."));
  }

  return (
    <Card withBorder padding="sm" mb="lg" id="send">
      <Stack gap="sm">
        <Group gap={6}>
          <IconSend size={18} />
          <Title order={4}>Send to PriceCharting</Title>
        </Group>
        {d.toSend.length > 0 && (
          <Text size="sm" maw={720}>
            {count(d.toSend.length)} cop{d.toSend.length === 1 ? 'y' : 'ies'} you added in Squirrelcade {d.toSend.length === 1 ? "isn't" : "aren't"} on PriceCharting yet. After you send them, export
            from PriceCharting as usual: the export brings each copy's value back to the same copy here, and what you paid stays Squirrelcade's.
          </Text>
        )}

        {withId.length > 0 && (
          <Stack gap="xs">
            <Title order={5}>With their details: PriceCharting's CSV importer ({count(withId.length)})</Title>
            <Text size="sm" maw={720}>
              PriceCharting knows these games, so they go with everything it takes: condition, what you paid, the day bought and your notes. Check the list, download the file, and
              upload it on PriceCharting's CSV importer. Upload it once: PriceCharting adds every row as a new copy, so a second upload adds them again.
            </Text>
            <div style={{ overflowX: 'auto' }}>
              <Table verticalSpacing={4} fz="sm" miw={520} aria-label="What the CSV has">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Game</Table.Th>
                    <Table.Th>Condition</Table.Th>
                    <Table.Th>Paid</Table.Th>
                    <Table.Th>Bought</Table.Th>
                    <Table.Th>Notes</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {withId.map((c) => (
                    <Table.Tr key={c.id}>
                      <Table.Td>
                        {c.title}{' '}
                        <Text span size="xs" c="dimmed">
                          {c.platform ?? '?'} · #{c.pcId}
                        </Text>
                      </Table.Td>
                      <Table.Td>{c.condition}</Table.Td>
                      <Table.Td>{c.costCents ? money(c.costCents, currency) : '—'}</Table.Td>
                      <Table.Td>{c.datePurchased ? date(c.datePurchased, dateFormat) : '—'}</Table.Td>
                      <Table.Td style={{ maxWidth: 220 }}>
                        <Text size="xs" lineClamp={2}>
                          {c.notes ? c.notes.slice(0, 300) : '—'}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>
            <Group gap="xs">
              <Button size="compact-sm" variant="light" leftSection={<IconDownload size={14} />} component="a" href="/api/v1/send/pricecharting.csv" download>
                Download the CSV
              </Button>
              <Button size="compact-sm" variant="default" component="a" href={PRICECHARTING_CSV_IMPORTER} target="_blank" rel="noreferrer" rightSection={<IconExternalLink size={14} />}>
                Open PriceCharting's CSV importer
              </Button>
              <Button size="compact-sm" variant="default" loading={mark.isPending} onClick={() => mark.mutate({ path: 'sent', ids: withId.map((c) => c.id) })}>
                I've uploaded it
              </Button>
            </Group>
          </Stack>
        )}

        {byTitle.length > 0 && (
          <Stack gap="xs">
            <Title order={5}>By title: PriceCharting's paste importer ({count(byTitle.length)})</Title>
            <Text size="sm" maw={720}>
              PriceCharting doesn't know which of its games {byTitle.length === 1 ? 'this is' : 'these are'} yet, so {byTitle.length === 1 ? 'it goes' : 'they go'} by title: it reads CIB and
              Sealed, not what you paid (that stays here). To send one with its details instead, give it its PriceCharting ID: find the game on PriceCharting, and copy the
              number under Item Details, PriceCharting ID.
            </Text>
            <Stack gap={6}>
              {byTitle.map((c) => (
                <PriceChartingId key={c.id} c={c} currency={currency} onSaved={refresh} />
              ))}
            </Stack>
            <Textarea value={d.text} readOnly autosize minRows={2} maxRows={10} aria-label="Lines for PriceCharting's importer" styles={{ input: { fontFamily: 'monospace' } }} onFocus={(e) => e.currentTarget.select()} />
            {unread.length > 0 && (
              <Text size="xs" c="dimmed" maw={720}>
                PriceCharting's paste importer reads CIB and Sealed; these come in as loose, so set their condition there after pasting:{' '}
                {unread.map((c) => `${c.title} (${c.condition})`).join(', ')}.
              </Text>
            )}
            <Group gap="xs">
              <Button size="compact-sm" variant="light" leftSection={<IconCopy size={14} />} onClick={() => void copyList()}>
                Copy the list
              </Button>
              <Button size="compact-sm" variant="default" component="a" href={PRICECHARTING_IMPORTER} target="_blank" rel="noreferrer" rightSection={<IconExternalLink size={14} />}>
                Open PriceCharting's importer
              </Button>
              <Button size="compact-sm" variant="default" loading={mark.isPending} onClick={() => mark.mutate({ path: 'sent', ids: byTitle.map((c) => c.id) })}>
                I've added them there
              </Button>
            </Group>
          </Stack>
        )}

        {d.waiting.length > 0 && (
          <Text size="sm" c="dimmed">
            Sent, waiting for an export that has them ({count(d.waiting.length)}): {d.waiting.map((c) => `${c.title} (${c.platform ?? '?'}, ${date(c.sentAt, dateFormat)})`).join('; ')}.
          </Text>
        )}
        {d.toRemove.length > 0 && (
          <Stack gap={4}>
            <Text size="sm" maw={720}>
              Sold or removed here, still on PriceCharting ({count(d.toRemove.length)}): remove {d.toRemove.length === 1 ? 'it' : 'them'} there, or they'll keep counting in
              PriceCharting's totals.{' '}
              <Anchor href="https://www.pricecharting.com/my-collection" target="_blank" rel="noreferrer" size="sm">
                Your collection on PriceCharting
              </Anchor>
            </Text>
            <Text size="sm" c="dimmed">
              {d.toRemove.map((c) => `${c.title} (${c.platform ?? '?'}, ${c.condition}, ${c.goneReason === 'sold' ? 'sold' : 'removed'} ${date(c.goneAt, dateFormat)})`).join('; ')}
            </Text>
            <Group>
              <Button size="compact-sm" variant="default" loading={mark.isPending} onClick={() => mark.mutate({ path: 'removed', ids: d.toRemove.map((c) => c.id) })}>
                I've removed them there
              </Button>
            </Group>
          </Stack>
        )}
      </Stack>
    </Card>
  );
}
