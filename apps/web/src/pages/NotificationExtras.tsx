import { CHANNEL_NAMES, type Channel } from '@squirrelcade/core';
import { Button, Card, Group, List, Text, ThemeIcon, Title } from '@mantine/core';
import { IconCheck, IconSend, IconX } from '@tabler/icons-react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../api';
import { notifyError } from '../hooks';

interface SendResult {
  channel: Channel;
  ok: boolean;
  error?: string;
}

/** The test button under the Notifications settings. */
export function NotificationExtras({ unsaved }: { unsaved: boolean }) {
  const test = useMutation({
    mutationFn: () => api<{ results: SendResult[] }>('/notifications/test', { method: 'POST' }),
    onError: (err) => notifyError(err, "Couldn't send a test message"),
  });

  return (
    <Card withBorder>
      <Title order={5} mb="xs">
        Test
      </Title>
      <Text size="sm" c="dimmed" mb="sm">
        Sends a short message through every channel that is turned on, using the saved settings.
      </Text>
      <Group gap="sm">
        <Button variant="default" leftSection={<IconSend size={14} />} loading={test.isPending} disabled={unsaved} onClick={() => test.mutate()}>
          Send a test message
        </Button>
        {unsaved && (
          <Text size="sm" c="dimmed">
            Save your changes first.
          </Text>
        )}
      </Group>
      {test.data && (
        <List mt="sm" spacing={4} size="sm" center>
          {test.data.results.map((r) => (
            <List.Item
              key={r.channel}
              icon={
                <ThemeIcon size={18} radius="xl" color={r.ok ? 'green' : 'red'}>
                  {r.ok ? <IconCheck size={12} /> : <IconX size={12} />}
                </ThemeIcon>
              }
            >
              {CHANNEL_NAMES[r.channel]}: {r.ok ? 'sent' : r.error}
            </List.Item>
          ))}
        </List>
      )}
    </Card>
  );
}
