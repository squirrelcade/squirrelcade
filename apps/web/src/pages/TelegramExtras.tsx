import { Button, Group, Stack, Text } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../api';
import { notifyError } from '../hooks';

interface Chat {
  id: string;
  name: string;
  type: string;
}

/**
 * "Find my chat" under the Telegram bot's token: the chats the bot has had a message from lately, one click each to
 * fill in the chat ID. With unsaved changes (the token), it saves them first.
 */
export function TelegramChatFinder({ unsaved, save, onPick }: { unsaved: boolean; save: () => Promise<boolean>; onPick: (id: string) => void }) {
  const find = useMutation({
    mutationFn: async () => {
      if (unsaved && !(await save())) return null;
      return api<{ chats: Chat[]; message: string | null }>('/notifications/telegram/chats', { method: 'POST' });
    },
    onError: (err) => notifyError(err, 'Telegram'),
  });
  const r = find.data;
  return (
    <Stack gap={6}>
      <Group gap="sm">
        <Button variant="default" leftSection={<IconSearch size={14} />} loading={find.isPending} onClick={() => find.mutate()}>
          {unsaved ? 'Save and find my chat' : 'Find my chat'}
        </Button>
      </Group>
      {r?.message && (
        <Text size="sm" c="dimmed">
          {r.message}
        </Text>
      )}
      {r && r.chats.length > 0 && (
        <Group gap="xs">
          <Text size="sm">Use:</Text>
          {r.chats.map((c) => (
            <Button key={c.id} size="compact-sm" variant="light" onClick={() => onPick(c.id)}>
              {c.name} ({c.type === 'private' ? 'you' : c.type})
            </Button>
          ))}
        </Group>
      )}
    </Stack>
  );
}
