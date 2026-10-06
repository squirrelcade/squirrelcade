import { Alert, Button, Center, Paper, PasswordInput, Stack, TextInput, Title } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import { Squirrel } from '../Brand';
import { usePageTitle, useSession } from '../hooks';
import { isPhone, PublicCheck } from '../PublicCheck';

/**
 * The sign-in page. When Settings > Security lets people check a game without signing in, it leads with that
 * (on phones and tablets, or everywhere), for someone shopping for the collection's owner; the sign-in is below.
 */
export function LoginPage() {
  usePageTitle('Sign in');
  const queryClient = useQueryClient();
  const session = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mode = session.data?.publicCheck ?? 'off';
  const checkFirst = mode === 'everywhere' || (mode === 'phones' && isPhone());

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/login', { method: 'POST', json: { username, password } });
      await queryClient.invalidateQueries();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Center mih="100vh" p="md">
      <Stack align="center" w="100%" gap="lg">
        {checkFirst && <PublicCheck />}
        <Paper withBorder shadow="md" p="xl" w="100%" maw={checkFirst ? 520 : 380}>
          <form onSubmit={submit}>
            <Stack>
              {!checkFirst && (
                <Center>
                  <Squirrel size={64} />
                </Center>
              )}
              <Title order={3} ta="center">
                Sign in to Squirrelcade
              </Title>
              <TextInput label="Username" value={username} onChange={(e) => setUsername(e.currentTarget.value)} autoFocus={!checkFirst} autoComplete="username" data-lpignore="false" />
              <PasswordInput label="Password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} autoComplete="current-password" data-lpignore="false" />
              {error && <Alert color="red">{error}</Alert>}
              <Button type="submit" loading={busy} disabled={!username || !password}>
                Sign in
              </Button>
            </Stack>
          </form>
        </Paper>
      </Stack>
    </Center>
  );
}
