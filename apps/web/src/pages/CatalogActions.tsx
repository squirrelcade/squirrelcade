import { ActionIcon, Button, Group, Menu, Modal, MultiSelect, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { IconDots, IconRestore, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { notifyError, notifySuccess } from '../hooks';

const refresh = (queryClient: ReturnType<typeof useQueryClient>) =>
  Promise.all([queryClient.invalidateQueries({ queryKey: ['catalogs'] }), queryClient.invalidateQueries({ queryKey: ['wishlist'] })]);

/** Adds a game to a platform's catalog: a new release, or an owned game the catalog lacks. */
export function AddGameModal({ platformKey, initialTitle, opened, onClose }: { platformKey: string; initialTitle?: string; opened: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [format, setFormat] = useState('');
  const [releaseDate, setReleaseDate] = useState('');
  const [notes, setNotes] = useState('');
  useEffect(() => {
    if (opened) {
      setTitle(initialTitle ?? '');
      setFormat('');
      setReleaseDate('');
      setNotes('');
    }
  }, [opened, initialTitle]);
  const add = useMutation({
    mutationFn: () => api(`/catalogs/${platformKey}/entries`, { method: 'POST', json: { title, format, releaseDate, notes } }),
    onSuccess: async () => {
      await refresh(queryClient);
      notifySuccess(`${title.trim()} is in the catalog now.`);
      onClose();
    },
    onError: (err) => notifyError(err, "Couldn't add the game"),
  });

  return (
    <Modal opened={opened} onClose={onClose} title="Add a game to the catalog">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <Stack gap="sm">
          <TextInput label="Title" required value={title} onChange={(e) => setTitle(e.currentTarget.value)} data-autofocus />
          <TextInput label="Format" placeholder="Game Disc, Cartridge..." value={format} onChange={(e) => setFormat(e.currentTarget.value)} />
          <TextInput label="Release date" placeholder="2026-09-27, 2026-09 or 2026" value={releaseDate} onChange={(e) => setReleaseDate(e.currentTarget.value)} />
          <Textarea label="Notes" autosize minRows={2} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
          <Text size="xs" c="dimmed">
            It becomes a collecting target in your home region. You can remove games you added at any time.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={add.isPending} disabled={!title.trim()}>
              Add
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

const STATUS_GROUPS: [string, string][] = [
  ['missing', 'Missing'],
  ['review', 'Needs review'],
  ['owned', 'Already owned'],
  ['excluded', 'Excluded'],
];

/** Says which catalog games an owned product counts as (a compilation can count as several). */
export function LinkModal({
  platformKey,
  product,
  onClose,
}: {
  platformKey: string;
  product: { productId: string; title: string } | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => setSelected([]), [product]);
  const titles = useQuery({
    queryKey: ['catalogs', platformKey, 'titles'],
    queryFn: () => api<{ id: number; title: string; status: string }[]>(`/catalogs/${platformKey}/titles`),
    enabled: product !== null,
  });
  const data = STATUS_GROUPS.map(([status, group]) => ({
    group,
    items: (titles.data ?? []).filter((t) => t.status === status).map((t) => ({ value: String(t.id), label: t.title })),
  })).filter((g) => g.items.length > 0);
  const link = useMutation({
    mutationFn: async () => {
      for (const id of selected) {
        await api('/catalogs/decisions', { method: 'POST', json: { entryId: Number(id), productId: product!.productId, decision: 'confirmed' } });
      }
    },
    onSuccess: async () => {
      await refresh(queryClient);
      notifySuccess(`${product!.title} now counts as ${selected.length === 1 ? 'that game' : `${selected.length} games`}.`);
      onClose();
    },
    onError: (err) => notifyError(err, "Couldn't save the link"),
  });

  return (
    <Modal opened={product !== null} onClose={onClose} title={`What does "${product?.title ?? ''}" count as?`} size="lg">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          Pick the catalog games this owned game includes. A compilation can count as several. You can undo a link on the Owned tab.
        </Text>
        <MultiSelect
          data={data}
          value={selected}
          onChange={setSelected}
          searchable
          limit={50}
          maxDropdownHeight={320}
          placeholder={titles.isLoading ? 'Loading the catalog...' : 'Search the catalog'}
          nothingFoundMessage="No catalog game by that name"
          data-autofocus
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => link.mutate()} loading={link.isPending} disabled={selected.length === 0}>
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Per-game menu in the catalog table: exclude or restore it, or remove a game the user added. */
export function EntryMenu({ entry }: { entry: { id: number; title: string; targetStatus: string; status: string; source: string } }) {
  const queryClient = useQueryClient();
  const setStatus = useMutation({
    mutationFn: (targetStatus: string) => api(`/catalogs/entries/${entry.id}`, { method: 'PATCH', json: { targetStatus } }),
    onSuccess: () => refresh(queryClient),
    onError: (err) => notifyError(err),
  });
  const remove = useMutation({
    mutationFn: () => api(`/catalogs/entries/${entry.id}`, { method: 'DELETE' }),
    onSuccess: () => refresh(queryClient),
    onError: (err) => notifyError(err),
  });
  const excludedHere = entry.targetStatus === 'excluded';
  const excludedByList = entry.status === 'excluded' && !excludedHere;
  // Excluding a game, or making it a target again, isn't in this menu, where a slip of the mouse could do it: both are
  // at the bottom of the game's drawer, and ask first (D145).
  if (entry.status !== 'unconfirmed' && !excludedByList && entry.source !== 'user') return null;

  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon variant="subtle" color="gray" aria-label={`Actions for ${entry.title}`}>
          <IconDots size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {entry.status === 'unconfirmed' && (
          <Menu.Item leftSection={<IconRestore size={14} />} onClick={() => setStatus.mutate('required')}>
            It had a physical release: count it
          </Menu.Item>
        )}
        {excludedByList && <Menu.Item disabled>Excluded by the ignore list</Menu.Item>}
        {entry.source === 'user' && (
          <Menu.Item
            color="red"
            leftSection={<IconTrash size={14} />}
            onClick={() => window.confirm(`Remove ${entry.title} from the catalog?`) && remove.mutate()}
          >
            Remove from catalog
          </Menu.Item>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}
