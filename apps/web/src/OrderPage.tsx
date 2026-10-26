import { Button, FileButton, Group, Modal, Progress, Stack, Text, Textarea } from '@mantine/core';
import { IconCamera, IconClipboardText } from '@tabler/icons-react';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from './api';
import { notifyError, notifySuccess } from './hooks';
import { photoReader, progressText, progressValue, type ReadLine, type ReaderProgress } from './shelfCheck';

/**
 * A screenshot's lines as the page's text (D176): top to bottom, the words side by side on one row joined, so an item's
 * name and its price stay on one line as the page has them.
 */
export function screenshotText(lines: readonly ReadLine[]): string {
  const read = lines
    .map((l) => {
      const ys = l.box.map((p) => p[1]);
      const xs = l.box.map((p) => p[0]);
      return { text: l.text.trim(), top: Math.min(...ys), bottom: Math.max(...ys), left: Math.min(...xs) };
    })
    .filter((l) => l.text)
    .sort((a, b) => a.top - b.top || a.left - b.left);
  const rows: (typeof read)[] = [];
  for (const l of read) {
    const row = rows.at(-1);
    // On the same row when its middle is within the row's first line.
    if (row && (l.top + l.bottom) / 2 < row[0]!.bottom) row.push(l);
    else rows.push([l]);
  }
  return rows.map((r) => r.sort((a, b) => a.left - b.left).map((l) => l.text).join('  ')).join('\n');
}

/**
 * An order page in, its games out (D176): its text pasted (on the shop's page, Ctrl+A then Ctrl+C), or a screenshot
 * of it read on this phone or computer (Check a shelf's reader, nothing sent anywhere). Its games go on the way to
 * be checked and added; with `into`, they name an Amazon order's game its email didn't.
 */
export function OrderPageModal({ opened, into, onClose, onDone }: { opened: boolean; into?: { id: number; label: string } | null; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('');
  const [progress, setProgress] = useState<ReaderProgress | null>(null);
  const [reading, setReading] = useState(false);
  useEffect(() => {
    if (opened) setText('');
  }, [opened]);
  const read = async (file: File) => {
    setReading(true);
    try {
      const reader = await photoReader();
      const canvas = await reader.decodePhoto(file);
      const found = await reader.readCanvas(canvas, { turns: ['0'], onProgress: setProgress });
      const words = screenshotText(found.lines);
      if (!words.trim()) notifyError(new Error('No words could be read on that picture. A sharper screenshot of the order page, or its text pasted, works.'));
      setText((t) => (t.trim() ? `${t}\n${words}` : words));
    } catch (err) {
      notifyError(err, "The screenshot couldn't be read");
    } finally {
      setReading(false);
      setProgress(null);
    }
  };
  const send = useMutation({
    mutationFn: () => api<{ items: { title: string | null; listingTitle: string }[] }>('/coming/page', { method: 'POST', json: { text, ...(into ? { into: into.id } : {}) } }),
    onSuccess: ({ items }) => {
      notifySuccess(items.length === 0 ? 'Those games are on the way already.' : `${items.length} ${items.length === 1 ? 'game' : 'games'} on the way: ${items.map((i) => i.title ?? i.listingTitle).join(', ')}.`, 'Read');
      onDone();
    },
    onError: (err) => notifyError(err),
  });
  return (
    <Modal opened={opened} onClose={onClose} title={into ? `Name it · ${into.label}` : 'Add from an order page'} size="lg">
      <Stack gap="xs">
        <Text size="sm" c="dimmed">
          On the order's page (Amazon's order details, GameFly's, any shop's): press Ctrl+A, then Ctrl+C, and paste it here (Ctrl+V). Or a screenshot of the page, read on this device. Each game goes on the way with its price, to check and add.
        </Text>
        <Textarea aria-label="The order page's text" placeholder="Paste the order page here" autosize minRows={6} maxRows={14} value={text} onChange={(e) => setText(e.currentTarget.value)} data-autofocus />
        {reading && progress && <Progress value={progressValue(progress)} size="sm" aria-label={progressText(progress)} />}
        <Group justify="space-between">
          <FileButton onChange={(file) => file && void read(file)} accept="image/*">
            {(props) => (
              <Button {...props} variant="default" leftSection={<IconCamera size={16} />} loading={reading}>
                Read a screenshot
              </Button>
            )}
          </FileButton>
          <Button leftSection={<IconClipboardText size={16} />} onClick={() => send.mutate()} loading={send.isPending} disabled={!text.trim() || reading}>
            Read the order
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
