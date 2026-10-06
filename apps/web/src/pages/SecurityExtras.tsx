import { Button, Card, Group, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { CopyButton } from '../Copy';
import { notifyError, notifySuccess, useSession } from '../hooks';

/** API key and password, shown under the Security settings. */
export function SecurityExtras() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const key = useQuery({ queryKey: ['apikey'], queryFn: () => api<{ apiKey: string }>('/auth/apikey') });
  const regenerate = useMutation({
    mutationFn: () => api<{ apiKey: string }>('/auth/apikey', { method: 'POST' }),
    onSuccess: (data) => {
      queryClient.setQueryData(['apikey'], data);
      notifySuccess('New API key created. Update any tools that used the old one.');
    },
    onError: (err) => notifyError(err),
  });
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const change = useMutation({
    mutationFn: () => api('/auth/password', { method: 'POST', json: { currentPassword: current, newPassword: next } }),
    onSuccess: () => {
      setCurrent('');
      setNext('');
      notifySuccess('Password changed. Other devices were signed out.');
    },
    onError: (err) => notifyError(err, "Couldn't change the password"),
  });

  return (
    <>
      <Card withBorder>
        <Title order={5} mb="xs">
          API key
        </Title>
        <Text size="sm" c="dimmed" mb="sm">
          Lets other tools use Squirrelcade's API without signing in: send it in an X-Api-Key header.
        </Text>
        <Group gap="xs" align="flex-end">
          <TextInput aria-label="API key" value={key.data?.apiKey ?? ''} readOnly w={340} ff="monospace" />
          <CopyButton value={key.data?.apiKey ?? ''}>{({ copied, copy }) => <Button variant="default" onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>}</CopyButton>
          <Button
            variant="default"
            color="red"
            loading={regenerate.isPending}
            onClick={() => window.confirm('Make a new API key? Tools using the current one will stop working.') && regenerate.mutate()}
          >
            New key
          </Button>
        </Group>
      </Card>
      {session?.via === 'session' && (
        <Card withBorder>
          <Title order={5} mb="xs">
            Password for {session.username}
          </Title>
          <Stack maw={340} gap="sm">
            <PasswordInput label="Current password" value={current} onChange={(e) => setCurrent(e.currentTarget.value)} autoComplete="current-password" data-lpignore="false" />
            <PasswordInput label="New password" description="At least 8 characters." value={next} onChange={(e) => setNext(e.currentTarget.value)} autoComplete="new-password" data-lpignore="false" />
            <Button onClick={() => change.mutate()} loading={change.isPending} disabled={!current || next.length < 8}>
              Change password
            </Button>
          </Stack>
        </Card>
      )}
    </>
  );
}
