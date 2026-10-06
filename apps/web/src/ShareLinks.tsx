import { ActionIcon, Button, Group, Modal, Stack, Table, Text, TextInput, Tooltip } from '@mantine/core';
import { IconCheck, IconCopy, IconShare, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from './api';
import { CopyButton } from './Copy';
import { count, date } from './format';
import { notifyError, useSetting } from './hooks';

/** A share link, as the owner's list shows it (GET /api/v1/shares). */
interface ShareLink {
  id: number;
  kind: 'wishlist' | 'sale';
  name: string | null;
  path: string;
  createdAt: string;
  lastOpenedAt: string | null;
  opens: number;
}

const WHAT = {
  wishlist: { button: 'Share', title: 'Share your wishlist', about: "Anyone with a link sees your wishlist's top picks and where to buy them, without signing in: nothing else of your collection. Make one per person to see who looked, and remove a link to stop it working." },
  sale: { button: 'Share', title: 'Share the games for sale', about: 'Anyone with a link sees the games you marked for sale or trade, with your asking prices and notes, without signing in. Remove a link to stop it working.' },
};

/** The owner's share links of one kind: make one (with a name for whom it's for), copy it, see how often it was opened, remove it. */
export function ShareButton({ kind }: { kind: 'wishlist' | 'sale' }) {
  const [opened, setOpened] = useState(false);
  const [name, setName] = useState('');
  const queryClient = useQueryClient();
  const dateFormat = useSetting('general.dateFormat', 'us');
  const links = useQuery({ queryKey: ['shares'], queryFn: () => api<ShareLink[]>('/shares'), enabled: opened });
  const change = useMutation({
    mutationFn: (c: { method: 'POST' | 'DELETE'; path: string; json?: unknown }) => api(c.path, { method: c.method, json: c.json }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['shares'] }),
    onError: (err) => notifyError(err),
  });
  const mine = (links.data ?? []).filter((l) => l.kind === kind);
  const url = (l: ShareLink) => `${window.location.origin}${l.path}`;
  return (
    <>
      <Button variant="default" leftSection={<IconShare size={16} />} onClick={() => setOpened(true)}>
        {WHAT[kind].button}
      </Button>
      <Modal opened={opened} onClose={() => setOpened(false)} title={WHAT[kind].title} size="lg">
        <Stack>
          <Text size="sm">{WHAT[kind].about}</Text>
          <Group align="flex-end" gap="xs">
            {/* The dialog opens with the cursor here (typed at once, a name went to the close button, which took focus a moment later). */}
            <TextInput
              label="For whom"
              description="Optional; the page says it's shared with them."
              placeholder="Mom, the family chat..."
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              maxLength={60}
              style={{ flex: 1 }}
              data-autofocus
            />
            <Button
              loading={change.isPending}
              onClick={() => {
                change.mutate({ method: 'POST', path: '/shares', json: { kind, name: name.trim() || null } });
                setName('');
              }}
            >
              Make a link
            </Button>
          </Group>
          {mine.length > 0 && (
            <Table verticalSpacing={6}>
              <Table.Tbody>
                {mine.map((l) => (
                  <Table.Tr key={l.id}>
                    <Table.Td>
                      <Text size="sm" fw={500}>
                        {l.name ?? 'A link'}
                      </Text>
                      <Text size="xs" c="dimmed">
                        Made {date(l.createdAt, dateFormat)} · {l.opens === 0 ? 'not opened yet' : `opened ${count(l.opens)} time${l.opens === 1 ? '' : 's'}, last ${date(l.lastOpenedAt, dateFormat)}`}
                      </Text>
                    </Table.Td>
                    <Table.Td w={90}>
                      <Group gap={4} wrap="nowrap">
                        <CopyButton value={url(l)}>
                          {({ copied, copy }) => (
                            <Tooltip label={copied ? 'Copied' : 'Copy the link'}>
                              <ActionIcon variant="subtle" color={copied ? 'teal' : 'gray'} onClick={copy} aria-label={`Copy the link${l.name ? ` for ${l.name}` : ''}`}>
                                {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                              </ActionIcon>
                            </Tooltip>
                          )}
                        </CopyButton>
                        <Tooltip label="Remove: the link stops working">
                          <ActionIcon variant="subtle" color="red" onClick={() => change.mutate({ method: 'DELETE', path: `/shares/${l.id}` })} aria-label={`Remove the link${l.name ? ` for ${l.name}` : ''}`}>
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
          <Text size="xs" c="dimmed">
            The link works where this Squirrelcade is reachable: for people outside your home, that's its public address (Settings › General).
          </Text>
        </Stack>
      </Modal>
    </>
  );
}
