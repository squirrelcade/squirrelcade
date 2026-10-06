import { Anchor, Button, Card, Group, Stack, Text, Textarea, Title } from '@mantine/core';
import { IconCopy, IconExternalLink, IconSend } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { copyText } from '../Copy';
import { count, date } from '../format';
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
}

interface ForPriceCharting {
  toSend: SendCopy[];
  waiting: SendCopy[];
  toRemove: SendCopy[];
  text: string;
}

/** PriceCharting's page that takes pasted lines ("Title Console Condition"), one import a week on a free account. */
export const PRICECHARTING_IMPORTER = 'https://www.pricecharting.com/collection-text-importer';

/**
 * Send to PriceCharting (0.20.0, D83): the copies added in Squirrelcade as lines for PriceCharting's paste importer, the
 * ones pasted and waiting for an export, and the copies sold or removed here that PriceCharting still lists. Shown on
 * Collection updates while there's something to do.
 */
export function SendToPriceCharting() {
  const queryClient = useQueryClient();
  const dateFormat = useSetting('general.dateFormat', 'us');
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
  const unread = d.toSend.filter((c) => !c.conditionReadThere);

  async function copyList() {
    if (await copyText(d!.text)) notifySuccess(`${count(d!.toSend.length)} line${d!.toSend.length === 1 ? '' : 's'} copied. Paste them into PriceCharting's importer.`);
    else notifyError(new Error("This browser didn't let Squirrelcade copy: select the list and copy it yourself."));
  }

  return (
    <Card withBorder padding="sm" mb="lg" id="send">
      <Stack gap="xs">
        <Group gap={6}>
          <IconSend size={18} />
          <Title order={4}>Send to PriceCharting</Title>
        </Group>
        {d.toSend.length > 0 && (
          <>
            <Text size="sm" maw={720}>
              {count(d.toSend.length)} cop{d.toSend.length === 1 ? 'y' : 'ies'} you added in Squirrelcade {d.toSend.length === 1 ? "isn't" : "aren't"} on PriceCharting yet. Paste
              these lines into PriceCharting's importer (a free account takes one import a week), then export as usual: the export brings each copy's value back
              to the same copy here, and what you paid stays Squirrelcade's.
            </Text>
            <Textarea value={d.text} readOnly autosize minRows={2} maxRows={10} aria-label="Lines for PriceCharting's importer" styles={{ input: { fontFamily: 'monospace' } }} onFocus={(e) => e.currentTarget.select()} />
            {unread.length > 0 && (
              <Text size="xs" c="dimmed" maw={720}>
                PriceCharting's importer reads CIB and Sealed; these come in as loose, so set their condition there after pasting:{' '}
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
              <Button size="compact-sm" variant="default" loading={mark.isPending} onClick={() => mark.mutate({ path: 'sent', ids: d.toSend.map((c) => c.id) })}>
                I've added them there
              </Button>
            </Group>
          </>
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
