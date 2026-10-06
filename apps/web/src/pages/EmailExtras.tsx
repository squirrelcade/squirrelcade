import { Anchor, Button, Group, Stack, Text } from '@mantine/core';
import { IconExternalLink, IconPlugConnected } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { notifyError } from '../hooks';

/** One check's outcome: whether it worked, and what happened in a line. */
interface Outcome {
  ok: boolean;
  message: string;
}

/**
 * Settings > Email's one test, under the app password: sends a message from your account and reads its mailbox (the
 * one PriceCharting's emails go to), so one click shows whether both work. Saves the page first.
 */
export function EmailTest({ unsaved, save }: { unsaved: boolean; save: () => Promise<boolean> }) {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<{ send: Outcome; read: Outcome } | null>(null);
  const test = useMutation({
    mutationFn: async () => {
      if (unsaved && !(await save())) return null;
      return api<{ send: Outcome; read: Outcome }>('/email/test', { method: 'POST' });
    },
    onSuccess: (r) => {
      if (!r) return;
      setResult(r);
      void queryClient.invalidateQueries({ queryKey: ['mail'] });
    },
    onError: (err) => notifyError(err, 'Email'),
  });
  return (
    <Stack gap={6}>
      <Group gap="sm">
        <Button variant="default" leftSection={<IconPlugConnected size={14} />} loading={test.isPending} onClick={() => test.mutate()}>
          {unsaved ? 'Save and test' : 'Test sending and reading'}
        </Button>
        <Anchor href="https://www.pricecharting.com/my-collection" target="_blank" rel="noreferrer" size="sm">
          Export on PriceCharting <IconExternalLink size={12} />
        </Anchor>
      </Group>
      {result && (
        <Stack gap={2} role="status">
          {(
            [
              ['Sending', result.send],
              ['Reading', result.read],
            ] as const
          ).map(([what, o]) => (
            <Text key={what} size="sm" c={o.ok ? 'green' : 'red'}>
              {o.ok ? '✓' : '✗'} {what}: {o.message}
            </Text>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
