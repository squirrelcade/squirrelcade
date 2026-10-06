import { Alert, Button, Center, Loader, Paper, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import { Squirrel } from '../Brand';
import { usePageTitle } from '../hooks';

/** Whom an invite link is for (GET /api/v1/join/<token>). */
interface Invite {
  name: string | null;
  /** Set when the link lets an existing account choose a new password. */
  username: string | null;
  expiresAt: string;
  instanceName: string;
}

/**
 * The page an invite link opens (/join/<token>): someone the owner invited chooses a username and password and
 * joins as a viewer; a link made for an existing account lets it choose a new password. Either way they're signed
 * in and go on to the collection.
 */
export function JoinPage({ token }: { token: string }) {
  usePageTitle('Join');
  const invite = useQuery({ queryKey: ['join', token], queryFn: () => api<Invite>(`/join/${encodeURIComponent(token)}`), retry: false });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reset = invite.data?.username ?? null;
  const problem = !reset && !username.trim() ? 'Choose a username.' : password.length < 8 ? 'Use a password of at least 8 characters.' : password !== again ? "The passwords don't match." : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/join/${encodeURIComponent(token)}`, { method: 'POST', json: { username: username.trim(), password } });
      // Signed in: the app starts over at its start page (a reload, so the router starts there too, not at this link).
      window.location.replace('/');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Center mih="100vh" p="md">
      <Paper withBorder shadow="md" p="xl" w="100%" maw={420}>
        {invite.isPending ? (
          <Loader />
        ) : invite.isError ? (
          <Stack>
            <Title order={3}>This link doesn't work</Title>
            <Alert color="yellow">{errorMessage(invite.error)}</Alert>
            <Text size="sm">
              <a href="/">Go to the sign-in page</a>
            </Text>
          </Stack>
        ) : (
          <form onSubmit={submit}>
            <Stack>
              <Center>
                <Squirrel size={64} />
              </Center>
              <Title order={3} ta="center">
                {reset ? `A new password for ${reset}` : `Welcome${invite.data.name ? `, ${invite.data.name}` : ''}`}
              </Title>
              <Text size="sm" c="dimmed" ta="center">
                {reset
                  ? `Choose a new password for ${invite.data.instanceName}.`
                  : `You're invited to look at the game collection in ${invite.data.instanceName}: what's in it, what it's worth and what's on the wishlist. Choose a username and a password.`}
              </Text>
              {!reset && <TextInput label="Username" value={username} onChange={(e) => setUsername(e.currentTarget.value)} autoFocus autoComplete="username" data-lpignore="false" />}
              <PasswordInput label="Password" description="At least 8 characters." value={password} onChange={(e) => setPassword(e.currentTarget.value)} autoComplete="new-password" data-lpignore="false" autoFocus={Boolean(reset)} />
              <PasswordInput label="Password again" value={again} onChange={(e) => setAgain(e.currentTarget.value)} autoComplete="new-password" data-lpignore="false" />
              {error && <Alert color="red">{error}</Alert>}
              <Button type="submit" loading={busy} disabled={problem !== null}>
                {reset ? 'Save the new password' : 'Join'}
              </Button>
              {problem && (username || password || again) && (
                <Text size="xs" c="dimmed" ta="center">
                  {problem}
                </Text>
              )}
            </Stack>
          </form>
        )}
      </Paper>
    </Center>
  );
}
