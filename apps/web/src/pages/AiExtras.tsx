import { Alert, Badge, Button, Card, Code, Divider, Group, List, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiError } from '../api';
import { CopyButton } from '../Copy';
import { homeAddress } from '../homeAddress';
import { count, date, dateTime, timeAgo } from '../format';
import { notifyError, notifySuccess, useSetting } from '../hooks';

/** A connection: one person's yes to one app (GET /api/v1/ai/connections). */
interface Connection {
  id: number;
  who: string;
  guest: boolean;
  app: string;
  host: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  calls: number;
}

/** A key for an app on the home network (GET /api/v1/ai/keys); never the key itself. */
interface Key {
  id: number;
  name: string;
  username: string;
  createdAt: string;
  lastUsedAt: string | null;
  calls: number;
}

interface Guest {
  id: number;
  name: string;
  email: string;
  createdAt: string;
  connections: number;
}

interface Call {
  id: number;
  at: string;
  who: string;
  client: string;
  tool: string;
  asked: string | null;
  results: number | null;
  ms: number;
  outcome: 'ok' | 'error' | 'limited';
}

const OUTCOME: Record<Call['outcome'], { label: string; color: string }> = {
  ok: { label: 'Answered', color: 'green' },
  error: { label: 'Error', color: 'red' },
  limited: { label: 'Over the limit', color: 'orange' },
};

/**
 * Settings › Claude and AI apps, under its settings (0.55.0): keys for Claude Code and other apps on the home network
 * (each shown once, with the command that adds it), and with the sign-in for apps on the internet on, the connector's
 * address for claude.ai, the guests and the apps connected; the latest calls either way.
 */
export function AiExtras() {
  const queryClient = useQueryClient();
  const dateFormat = useSetting('general.dateFormat', 'us');
  const state = useQuery({ queryKey: ['ai', 'connections'], queryFn: () => api<{ connections: Connection[]; address: string | null; on: boolean; signIn: boolean }>('/ai/connections') });
  const keys = useQuery({ queryKey: ['ai', 'keys'], queryFn: () => api<{ keys: Key[] }>('/ai/keys') });
  const [keyName, setKeyName] = useState('Claude Code');
  // A key just made: shown this once.
  const [made, setMade] = useState<{ name: string; key: string } | null>(null);
  // The address Claude reaches Squirrelcade at on the home network (the one this page was opened at, unless changed).
  const [home, setHome] = useState(() => window.location.origin);
  // The plugin was just downloaded: its steps show.
  const [pluginMade, setPluginMade] = useState(false);
  const guests = useQuery({ queryKey: ['ai', 'guests'], queryFn: () => api<{ guests: Guest[] }>('/ai/guests') });
  const calls = useQuery({ queryKey: ['ai', 'calls'], queryFn: () => api<{ calls: Call[] }>('/ai/calls') });
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [allCalls, setAllCalls] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['ai'] });

  const addGuest = useMutation({
    mutationFn: () => api('/ai/guests', { method: 'POST', json: { name, email } }),
    onSuccess: async () => {
      notifySuccess(`${name.trim()} can connect an AI app now, with the email ${email.trim()}.`, 'Guest added');
      setName('');
      setEmail('');
      await refresh();
    },
    onError: (err) => notifyError(err),
  });
  const removeGuest = useMutation({
    mutationFn: (g: Guest) => api(`/ai/guests/${g.id}`, { method: 'DELETE' }),
    onSuccess: async (_r, g) => {
      notifySuccess(`${g.name} is off the guest list${g.connections > 0 ? '; their connections ended' : ''}.`);
      await refresh();
    },
    onError: (err) => notifyError(err),
  });
  const makeKey = useMutation({
    mutationFn: () => api<{ id: number; name: string; key: string }>('/ai/keys', { method: 'POST', json: { name: keyName } }),
    onSuccess: async (k) => {
      setMade({ name: k.name, key: k.key });
      await refresh();
    },
    onError: (err) => notifyError(err),
  });
  // The plugin for Claude Code and Cowork (0.57.0): a new key in a zip, saved as a file.
  const downloadPlugin = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/v1/ai/plugin', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: home }) });
      if (!res.ok) {
        let body: { error?: string; message?: string } = {};
        try {
          body = await res.json();
        } catch {
          // Not JSON.
        }
        throw new ApiError(res.status, body.error ?? 'error', body.message ?? res.statusText);
      }
      return res.blob();
    },
    onSuccess: async (blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'squirrelcade-plugin.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setPluginMade(true);
      await refresh();
    },
    onError: (err) => notifyError(err),
  });
  const revokeKey = useMutation({
    mutationFn: (k: Key) => api(`/ai/keys/${k.id}`, { method: 'DELETE' }),
    onSuccess: async (_r, k) => {
      notifySuccess(`The key "${k.name}" no longer works.`);
      await refresh();
    },
    onError: (err) => notifyError(err),
  });
  const disconnect = useMutation({
    mutationFn: (c: Connection) => api(`/ai/connections/${c.id}`, { method: 'DELETE' }),
    onSuccess: async (_r, c) => {
      notifySuccess(`${c.app} (${c.who}) is disconnected. Connecting again needs a new sign-in.`);
      await refresh();
    },
    onError: (err) => notifyError(err),
  });

  const address = state.data?.address ?? null;
  const on = state.data?.on ?? false;
  const signIn = state.data?.signIn ?? false;
  const shownCalls = (calls.data?.calls ?? []).slice(0, allCalls ? 100 : 15);
  // User scope: Squirrelcade in every project, not only the folder the command runs in.
  const command = made ? `claude mcp add --scope user --transport http squirrelcade ${home.replace(/\/+$/, '')}/mcp --header "Authorization: Bearer ${made.key}"` : '';
  const atHome = homeAddress(home);

  return (
    <>
      {!on && (
        <Alert color="gray" variant="light">
          <Text size="sm">Turn on "Let AI apps read your collection" above, and save, to make keys and connect apps.</Text>
        </Alert>
      )}

      <Card withBorder>
        <Title order={5} mb="xs">
          Claude Code and Cowork on your network
        </Title>
        <Text size="sm" c="dimmed" mb="sm">
          Claude on your computers connects with a key, so nothing has to be open to the internet. Keys only read, and work from your home network only unless "Keys work
          from" says otherwise.
        </Text>
        <TextInput
          label="Squirrelcade's address on your home network"
          description="The one you open it at at home, such as http://192.168.1.20:7575. Claude reaches Squirrelcade there."
          value={home}
          onChange={(e) => setHome(e.currentTarget.value)}
          maw={420}
          mb="sm"
        />
        {!atHome && (
          <Alert color="yellow" variant="light" mb="sm">
            <Text size="sm">
              That looks like an address on the internet. Claude on your computer needs Squirrelcade's address on your home network: open Squirrelcade at home and copy it from
              the address bar.
            </Text>
          </Alert>
        )}
        <Text fw={600} size="sm" mb={4}>
          The plugin: Claude Code and Cowork
        </Text>
        <Text size="sm" c="dimmed" mb="xs">
          One file for the Claude app on this computer: it carries a new key and a small relay that runs on the computer (it needs Node.js, from nodejs.org).
        </Text>
        {pluginMade && (
          <Alert color="green" variant="light" title="squirrelcade-plugin.zip is in your downloads" mb="sm">
            <List type="ordered" size="sm" spacing={4}>
              <List.Item>In the Claude app: Customize › Plugins › Add › Upload plugin, and choose squirrelcade-plugin.zip.</List.Item>
              <List.Item>Start a new Cowork task or Claude Code session, and ask "Do I have Halo 3?"</List.Item>
            </List>
            <Text size="sm" mt="xs">
              Its key is listed below as "Claude plugin (Code and Cowork)": revoke it there to switch the plugin off.
            </Text>
          </Alert>
        )}
        <Button onClick={() => downloadPlugin.mutate()} loading={downloadPlugin.isPending} disabled={!on || !home.trim()} mb="md">
          Download the plugin
        </Button>
        <Divider mb="sm" />
        <Text fw={600} size="sm" mb={4}>
          Or the command, for Claude Code alone
        </Text>
        <Text size="sm" c="dimmed" mb="xs">
          With the claude command installed: make a key, then run the command it gives on the computer with Claude Code. Other apps that speak MCP take the key too.
        </Text>
        {made ? (
          <Alert color="green" variant="light" title={`The key "${made.name}": shown this once`} mb="sm">
            <Stack gap="xs">
              <Text size="sm">Run this on the computer with Claude Code (it adds Squirrelcade to Claude Code with this key):</Text>
              <Code block style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {command}
              </Code>
              <Group gap="xs">
                <CopyButton value={command}>{({ copied, copy }) => <Button size="xs" onClick={copy}>{copied ? 'Copied' : 'Copy the command'}</Button>}</CopyButton>
                <CopyButton value={made.key}>{({ copied, copy }) => <Button size="xs" variant="default" onClick={copy}>{copied ? 'Copied' : 'Copy the key alone'}</Button>}</CopyButton>
                <Button size="xs" variant="subtle" onClick={() => setMade(null)}>
                  Done
                </Button>
              </Group>
            </Stack>
          </Alert>
        ) : (
          <Group gap="xs" align="flex-end" wrap="wrap" mb="sm">
            <TextInput label="What it's for" value={keyName} onChange={(e) => setKeyName(e.currentTarget.value)} maxLength={60} w={240} maw="100%" />
            <Button variant="default" onClick={() => makeKey.mutate()} loading={makeKey.isPending} disabled={!on || !keyName.trim()}>
              Make a key
            </Button>
          </Group>
        )}
        {(keys.data?.keys.length ?? 0) > 0 && (
          <Table.ScrollContainer minWidth={560}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Key</Table.Th>
                  <Table.Th>Made</Table.Th>
                  <Table.Th>Last used</Table.Th>
                  <Table.Th ta="right">Calls</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {keys.data!.keys.map((k) => (
                  <Table.Tr key={k.id}>
                    <Table.Td>
                      {k.name}
                      <Text size="xs" c="dimmed">
                        answers as {k.username}
                      </Text>
                    </Table.Td>
                    <Table.Td>{date(k.createdAt, dateFormat)}</Table.Td>
                    <Table.Td>{k.lastUsedAt ? timeAgo(k.lastUsedAt) : 'Not yet'}</Table.Td>
                    <Table.Td ta="right">{count(k.calls)}</Table.Td>
                    <Table.Td>
                      <Button
                        size="xs"
                        variant="subtle"
                        color="red"
                        loading={revokeKey.isPending && revokeKey.variables?.id === k.id}
                        onClick={() => window.confirm(`Revoke the key "${k.name}"? Apps using it stop working.`) && revokeKey.mutate(k)}
                      >
                        Revoke
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Card>

      {signIn && address && (
        <Card withBorder>
          <Title order={5} mb="xs">
            Claude's apps on the internet
          </Title>
          <Stack gap="sm">
            <Text size="sm">In claude.ai: Settings › Connectors › Add custom connector, with this address, then Connect and sign in.</Text>
            <Group gap="xs" align="flex-end">
              <TextInput aria-label="Connector address" value={address} readOnly w={420} maw="100%" ff="monospace" />
              <CopyButton value={address}>{({ copied, copy }) => <Button variant="default" onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>}</CopyButton>
            </Group>
          </Stack>
        </Card>
      )}
      {signIn && (
      <Card withBorder>
        <Title order={5} mb="xs">
          Guests
        </Title>
        <Text size="sm" c="dimmed" mb="sm">
          People without an account who may connect their own Claude: they prove their email with a one-time code. Cloudflare Access sends it when its team address and
          audience tag are filled in (Show advanced › Guests); otherwise Squirrelcade emails it, from Settings › Email. Guests get what viewers get, never prices paid or
          notes, and each call they make is in the list below.
        </Text>
        {(guests.data?.guests.length ?? 0) > 0 && (
          <Table.ScrollContainer minWidth={480} mb="sm">
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Guest</Table.Th>
                  <Table.Th>Email</Table.Th>
                  <Table.Th>Connected</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {guests.data!.guests.map((g) => (
                  <Table.Tr key={g.id}>
                    <Table.Td>{g.name}</Table.Td>
                    <Table.Td>{g.email}</Table.Td>
                    <Table.Td>{g.connections > 0 ? `${count(g.connections)} ${g.connections === 1 ? 'app' : 'apps'}` : 'Not yet'}</Table.Td>
                    <Table.Td>
                      <Button
                        size="xs"
                        variant="subtle"
                        color="red"
                        loading={removeGuest.isPending && removeGuest.variables?.id === g.id}
                        onClick={() => window.confirm(`Take ${g.name} off the guest list?${g.connections > 0 ? ' Their connections end.' : ''}`) && removeGuest.mutate(g)}
                      >
                        Remove
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        <Group gap="xs" align="flex-end" wrap="wrap">
          <TextInput label="Name" value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={60} w={180} />
          <TextInput label="Email" type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} maxLength={200} w={260} maw="100%" />
          <Button variant="default" onClick={() => addGuest.mutate()} loading={addGuest.isPending} disabled={!name.trim() || !email.includes('@')}>
            Add guest
          </Button>
        </Group>
      </Card>
      )}

      {(signIn || (state.data?.connections.length ?? 0) > 0) && (
      <Card withBorder>
        <Title order={5} mb="xs">
          Connected apps
        </Title>
        {(state.data?.connections.length ?? 0) === 0 ? (
          <Text size="sm" c="dimmed">
            No app is connected.
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={640}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Who</Table.Th>
                  <Table.Th>App</Table.Th>
                  <Table.Th>Connected</Table.Th>
                  <Table.Th>Last used</Table.Th>
                  <Table.Th ta="right">Calls</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {state.data!.connections.map((c) => (
                  <Table.Tr key={c.id}>
                    <Table.Td>
                      {c.who}
                      {c.guest && (
                        <Badge size="xs" variant="light" color="gray" ml={6}>
                          guest
                        </Badge>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {c.app}
                      {c.host && (
                        <Text size="xs" c="dimmed">
                          {c.host}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>{date(c.createdAt, dateFormat)}</Table.Td>
                    <Table.Td>{c.lastUsedAt ? timeAgo(c.lastUsedAt) : 'Not yet'}</Table.Td>
                    <Table.Td ta="right">{count(c.calls)}</Table.Td>
                    <Table.Td>
                      <Button size="xs" variant="subtle" color="red" loading={disconnect.isPending && disconnect.variables?.id === c.id} onClick={() => disconnect.mutate(c)}>
                        Disconnect
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Card>
      )}

      <Card withBorder>
        <Title order={5} mb="xs">
          Latest calls
        </Title>
        {shownCalls.length === 0 ? (
          <Text size="sm" c="dimmed">
            None yet. Each call an app makes shows here: when, who, which app, what it asked and how it went (never the answer).
          </Text>
        ) : (
          <>
            <Table.ScrollContainer minWidth={720}>
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>When</Table.Th>
                    <Table.Th>Who</Table.Th>
                    <Table.Th>App</Table.Th>
                    <Table.Th>Asked</Table.Th>
                    <Table.Th ta="right">Found</Table.Th>
                    <Table.Th>How it went</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {shownCalls.map((c) => (
                    <Table.Tr key={c.id}>
                      <Table.Td style={{ whiteSpace: 'nowrap' }}>{dateTime(c.at, dateFormat)}</Table.Td>
                      <Table.Td>{c.who}</Table.Td>
                      <Table.Td>{c.client}</Table.Td>
                      <Table.Td>
                        <Code>{c.tool}</Code>
                        {c.asked && (
                          <Text size="xs" c="dimmed">
                            {c.asked}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td ta="right">{c.results ?? ''}</Table.Td>
                      <Table.Td>
                        <Badge size="sm" variant="light" color={OUTCOME[c.outcome].color}>
                          {OUTCOME[c.outcome].label}
                        </Badge>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            {(calls.data?.calls.length ?? 0) > 15 && !allCalls && (
              <Button size="xs" variant="subtle" mt="xs" onClick={() => setAllCalls(true)}>
                Show the last {count(calls.data!.calls.length)}
              </Button>
            )}
          </>
        )}
      </Card>
    </>
  );
}
