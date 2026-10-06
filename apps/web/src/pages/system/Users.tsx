import { Alert, Anchor, Badge, Button, Card, Group, Loader, Modal, Stack, Table, Text, TextInput } from '@mantine/core';
import { IconCopy, IconUserPlus } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../../api';
import { CopyButton } from '../../Copy';
import { PageHeader } from '../../components';
import { date, timeAgo } from '../../format';
import { notifyError, notifySuccess, useSetting } from '../../hooks';

/** The accounts and the links not used yet (GET /api/v1/users). */
interface UsersState {
  users: { id: number; username: string; role: 'owner' | 'viewer'; createdAt: string; lastSeenAt: string | null; you: boolean }[];
  invites: { id: number; name: string | null; username: string | null; createdAt: string; expiresAt: string }[];
}

/** A link just made: its address, shown once. */
interface MadeLink {
  url: string;
  expiresAt: string;
  forWhom: string;
  reset: boolean;
}

/**
 * System > Users: the collection's owner and its viewers. Viewers can look at the collection but change nothing;
 * the owner invites them with a link (it works once, for Settings > Security > "Invite links work for"), can give
 * someone a link to choose a new password, remove a viewer, or hand the collection to another account.
 */
export function UsersPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const dateFormat = useSetting('general.dateFormat', 'us');
  const state = useQuery({ queryKey: ['users'], queryFn: () => api<UsersState>('/users') });
  const [inviting, setInviting] = useState(false);
  const [name, setName] = useState('');
  const [made, setMade] = useState<MadeLink | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['users'] });

  const invite = useMutation({
    mutationFn: (v: { name?: string; userId?: number; forWhom: string }) => api<{ path: string; expiresAt: string }>('/invites', { method: 'POST', json: { name: v.name ?? null, userId: v.userId ?? null } }),
    onSuccess: async (r, v) => {
      setInviting(false);
      setName('');
      setMade({ url: `${window.location.origin}${r.path}`, expiresAt: r.expiresAt, forWhom: v.forWhom, reset: v.userId !== undefined });
      await refresh();
    },
    onError: (err) => notifyError(err),
  });
  const withdraw = useMutation({
    mutationFn: (id: number) => api(`/invites/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError: (err) => notifyError(err),
  });
  const remove = useMutation({
    mutationFn: (u: { id: number; username: string }) => api(`/users/${u.id}`, { method: 'DELETE' }),
    onSuccess: async (_r, u) => {
      notifySuccess(`${u.username} can't sign in any more.`, 'Account removed');
      await refresh();
    },
    onError: (err) => notifyError(err),
  });
  const handOver = useMutation({
    mutationFn: (u: { id: number; username: string }) => api(`/users/${u.id}/owner`, { method: 'POST' }),
    onSuccess: async (_r, u) => {
      notifySuccess(`${u.username} owns the collection now; you're a viewer.`, 'Collection handed over');
      await queryClient.invalidateQueries();
      navigate('/');
    },
    onError: (err) => notifyError(err),
  });

  const users = state.data?.users ?? [];
  const invites = state.data?.invites ?? [];

  return (
    <>
      <PageHeader help="sharing"
        title="Users"
        description={
          <>
            You own the collection: you can change anything. Viewers can look at it (the collection, its value, the consoles' gaps, the wishlist) but change nothing. What else they
            see is in{' '}
            <Anchor component={Link} to="/settings/security" size="sm">
              Settings &gt; Security
            </Anchor>
            .
          </>
        }
        actions={
          <Button leftSection={<IconUserPlus size={16} />} onClick={() => setInviting(true)}>
            Invite someone
          </Button>
        }
      />
      {state.isLoading ? (
        <Loader />
      ) : (
        <Stack gap="lg">
          <Card withBorder p={0}>
            <Table.ScrollContainer minWidth={560}>
              <Table highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Account</Table.Th>
                    <Table.Th>Can</Table.Th>
                    <Table.Th>Last used</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {users.map((u) => (
                    <Table.Tr key={u.id}>
                      <Table.Td>
                        <Text size="sm" fw={500} span>
                          {u.username}
                        </Text>
                        {u.you && (
                          <Text size="xs" c="dimmed" span>
                            {' '}
                            (you)
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Badge variant="light" color={u.role === 'owner' ? 'forest' : 'gray'} style={{ textTransform: 'none' }}>
                          {u.role === 'owner' ? 'Owner: change anything' : 'Viewer: look'}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{u.lastSeenAt ? timeAgo(u.lastSeenAt) : 'never'}</Text>
                      </Table.Td>
                      <Table.Td>
                        {u.role === 'viewer' && (
                          <Group gap="xs" justify="flex-end" wrap="nowrap">
                            <Button size="compact-xs" variant="default" loading={invite.isPending} onClick={() => invite.mutate({ userId: u.id, forWhom: u.username })}>
                              New password link
                            </Button>
                            <Button
                              size="compact-xs"
                              variant="default"
                              onClick={() => {
                                if (window.confirm(`Hand the collection to ${u.username}? They can change anything; you'll be a viewer until they hand it back.`)) handOver.mutate(u);
                              }}
                            >
                              Make owner
                            </Button>
                            <Button
                              size="compact-xs"
                              variant="subtle"
                              color="red"
                              onClick={() => {
                                if (window.confirm(`Remove ${u.username}'s account? They won't be able to sign in; an invite link can bring them back.`)) remove.mutate(u);
                              }}
                            >
                              Remove
                            </Button>
                          </Group>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Card>

          {invites.length > 0 && (
            <Card withBorder>
              <Text fw={600} size="sm" mb="xs">
                Links not used yet
              </Text>
              <Stack gap={6}>
                {invites.map((i) => (
                  <Group key={i.id} justify="space-between" wrap="nowrap">
                    <Text size="sm">
                      {i.username ? `A new password for ${i.username}` : `An invite${i.name ? ` for ${i.name}` : ''}`}{' '}
                      <Text span size="xs" c="dimmed">
                        works until {date(i.expiresAt, dateFormat)}
                      </Text>
                    </Text>
                    <Button size="compact-xs" variant="subtle" color="red" onClick={() => withdraw.mutate(i.id)}>
                      Withdraw
                    </Button>
                  </Group>
                ))}
              </Stack>
            </Card>
          )}
        </Stack>
      )}

      <Modal opened={inviting} onClose={() => setInviting(false)} title="Invite someone to look at the collection">
        <Stack>
          <Text size="sm">You'll get a link to send them. It works once: they choose a username and password, and can look at the collection but change nothing.</Text>
          <TextInput label="Who it's for" description="Shown on their invite page; optional." placeholder="Mom" value={name} onChange={(e) => setName(e.currentTarget.value)} data-autofocus />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setInviting(false)}>
              Cancel
            </Button>
            <Button loading={invite.isPending} onClick={() => invite.mutate({ name: name.trim() || undefined, forWhom: name.trim() || 'them' })}>
              Make the link
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={made !== null} onClose={() => setMade(null)} title={made?.reset ? `A link for ${made.forWhom} to choose a new password` : 'Send them this link'}>
        {made && (
          <Stack>
            <Alert color="yellow" variant="light">
              This is the only time the link is shown. It works once, until {date(made.expiresAt, dateFormat)}; anyone with it can use it, so send it only to {made.forWhom}.
            </Alert>
            <TextInput readOnly value={made.url} aria-label="The link" onFocus={(e) => e.currentTarget.select()} />
            <Group justify="flex-end">
              <CopyButton value={made.url}>
                {({ copied, copy }) => (
                  <Button leftSection={<IconCopy size={16} />} color={copied ? 'teal' : undefined} onClick={copy}>
                    {copied ? 'Copied' : 'Copy the link'}
                  </Button>
                )}
              </CopyButton>
              <Button variant="default" onClick={() => setMade(null)}>
                Done
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
}
