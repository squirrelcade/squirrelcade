import { COMPLETENESS_SHORT, type Completeness } from '@squirrelcade/core';
import { Badge, Button, Group, Loader, Menu, Modal, Pagination, SegmentedControl, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { useDebouncedValue, useMediaQuery } from '@mantine/hooks';
import { IconDeviceDesktop, IconExternalLink, IconSearch } from '@tabler/icons-react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../api';
import { PageHeader, type SortDirection } from '../components';
import { count } from '../format';
import { GameTitle, useOpenGame } from '../GameDrawer';
import { notifyError, notifySuccess, useCanEdit, useSetting } from '../hooks';
import { useSort } from '../sort';

interface ConsoleCopies {
  copyKey: string;
  platformKey: string;
  platform: string;
  title: string;
  copies: number;
  sealed: number;
  completeness: Completeness[];
  moved: boolean;
}

interface PcCopies {
  copyKey: string;
  title: string;
  storefronts: { storefront: string; ownership: string }[];
  owned: boolean;
  moved: boolean;
}

interface CopiesGroup {
  key: string;
  title: string;
  consoles: ConsoleCopies[];
  pc: PcCopies[];
  total: number;
  sealed: number;
  playable: { kind: 'pc' | 'copy' | 'romm'; label: string; url?: string }[];
}

type View = 'sealed-playable' | 'sealed-only' | 'repeats' | 'multiple' | 'all';

/** The list's headings sort it on the server (D144): games A to Z first, copies most first. */
const SORTS = { title: 'asc', copies: 'desc' } as const satisfies Record<string, SortDirection>;

interface CopiesList {
  view: View;
  counts: Record<View, number>;
  total: number;
  page: number;
  pageSize: number;
  pcOn: boolean;
  items: CopiesGroup[];
}

const VIEWS: { value: View; label: string; about: string }[] = [
  { value: 'sealed-playable', label: 'Sealed, playable another way', about: 'Games you keep sealed that you can still play without opening them: on PC, with another copy that is open, or in RomM.' },
  { value: 'sealed-only', label: 'Sealed, no other way', about: 'Games you only have sealed: playing them means opening one, or getting another copy (a PC version, say).' },
  {
    value: 'repeats',
    label: 'Same item more than once',
    about: "Games you have more than one copy of on the same console (two complete copies, or a sealed one and an open one). Each still counts once among your games; its copies beyond the first are the duplicates under Copies on the Collection page.",
  },
  { value: 'multiple', label: 'More than once', about: 'Games you have more than once: several copies, copies on several consoles, or a copy and the PC game.' },
  { value: 'all', label: 'Everything', about: 'Every game you have, with all its copies.' },
];

const OWNERSHIP: Record<string, string> = { permanent: '', subscription: ' (subscription)', historical: ' (not verified)' };

/** A console's copies as short labels, alike ones counted together: "Sealed · CIB ×2". */
function completeness(c: ConsoleCopies): string {
  const counts = new Map<string, number>();
  for (const x of c.completeness) counts.set(COMPLETENESS_SHORT[x] ?? x, (counts.get(COMPLETENESS_SHORT[x] ?? x) ?? 0) + 1);
  return [...counts].map(([label, n]) => (n > 1 ? `${label} ×${n}` : label)).join(' · ');
}

/**
 * Copies: each game you have with every copy of it, on each console and on PC. The first view answers "which sealed
 * games can I play anyway?"; the owner can say a copy belongs with another game, or on its own.
 */
export function CopiesPage() {
  const canEdit = useCanEdit();
  const queryClient = useQueryClient();
  const narrow = useMediaQuery('(max-width: 48em)');
  const [params, setParams] = useSearchParams();
  const view = (VIEWS.some((v) => v.value === params.get('view')) ? params.get('view') : 'sealed-playable') as View;
  const page = Number(params.get('page') ?? 1);
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [q] = useDebouncedValue(search, 250);
  const pageSize = useSetting('interface.pageSize', 100);
  const how = view === 'sealed-playable' ? params.get('how') : null;
  const sorting = useSort(SORTS, 'title');
  const query = new URLSearchParams({ view, sort: sorting.by, dir: sorting.dir, page: String(page), pageSize: String(pageSize) });
  if (q) query.set('q', q);
  if (how) query.set('how', how);
  const list = useQuery({ queryKey: ['copies', query.toString()], queryFn: () => api<CopiesList>(`/copies?${query}`), placeholderData: keepPreviousData });
  const [moving, setMoving] = useState<{ copyKey: string; title: string } | null>(null);
  const move = useMutation({
    mutationFn: (v: { copyKey: string; groupKey: string | null; done: string }) => api('/copies/group', { method: 'PUT', json: { copyKey: v.copyKey, groupKey: v.groupKey } }),
    onSuccess: (_d, v) => {
      notifySuccess(v.done);
      setMoving(null);
      return queryClient.invalidateQueries({ queryKey: ['copies'] });
    },
    onError: (err) => notifyError(err),
  });
  const setParam = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete('page');
    if (changes.page) next.set('page', changes.page);
    setParams(next, { replace: true });
  };

  const d = list.data;
  const sealedView = view === 'sealed-playable' || view === 'sealed-only';
  // A copy's own menu: open it, say it's another game or none, or put it back.
  const copyMenu = (label: string, copyKey: string, title: string, isMoved: boolean, open?: () => void) =>
    canEdit ? (
      <Menu position="bottom-start" withinPortal key={copyKey}>
        <Menu.Target>
          <Badge component="button" type="button" variant="light" color={isMoved ? 'blue' : 'gray'} style={{ textTransform: 'none', cursor: 'pointer' }} aria-label={`${title}, ${label}: what to do`}>
            {label}
          </Badge>
        </Menu.Target>
        <Menu.Dropdown>
          {open && <Menu.Item onClick={open}>Show the game</Menu.Item>}
          <Menu.Item onClick={() => setMoving({ copyKey, title })}>It&apos;s the same game as...</Menu.Item>
          <Menu.Item onClick={() => move.mutate({ copyKey, groupKey: 'own', done: `${title} stands on its own now.` })}>It&apos;s a different game (on its own)</Menu.Item>
          {isMoved && <Menu.Item onClick={() => move.mutate({ copyKey, groupKey: null, done: `${title} is back with its title.` })}>Put it back with its title</Menu.Item>}
        </Menu.Dropdown>
      </Menu>
    ) : (
      <Badge key={copyKey} variant="light" color="gray" style={{ textTransform: 'none', cursor: open ? 'pointer' : undefined }} onClick={open}>
        {label}
      </Badge>
    );
  const open = useOpenGame();

  return (
    <>
      <PageHeader help="collection"
        title="Copies"
        description="Each game you have, with every copy of it: on each console, and on PC. Games are put together by title; when a copy is really another game, or the same game under another name, fix it from the copy's menu."
      />
      <Stack gap="sm">
        <SegmentedControl
          value={view}
          onChange={(v) => setParam({ view: v === 'sealed-playable' ? null : v })}
          data={VIEWS.map((v) => ({ value: v.value, label: `${v.label}${d ? ` (${count(d.counts[v.value])})` : ''}` }))}
          orientation={narrow ? 'vertical' : 'horizontal'}
          fullWidth={Boolean(narrow)}
          aria-label="Which games"
        />
        <Text size="sm" c="dimmed">
          {VIEWS.find((v) => v.value === view)!.about}
          {d && !d.pcOn && ' (With the PC library on, Settings › Features, your PC games show here too.)'}
        </Text>
        <Group>
          <TextInput placeholder="Search" leftSection={<IconSearch size={16} />} value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={280} aria-label="Search the games" />
          {view === 'sealed-playable' && (
            <Select
              aria-label="Which way to play"
              w={220}
              value={how ?? ''}
              onChange={(v) => setParam({ how: v || null })}
              allowDeselect={false}
              data={[
                { value: '', label: 'Any way to play' },
                ...(d?.pcOn ? [{ value: 'pc', label: 'On PC' }] : []),
                { value: 'copy', label: 'Another copy, opened' },
                { value: 'romm', label: 'In RomM' },
              ]}
            />
          )}
          {list.isFetching && <Loader size="xs" />}
        </Group>
        {list.isError && <Text c="red">{(list.error as Error).message}</Text>}
        {!d ? (
          <Loader />
        ) : (
          <Table.ScrollContainer minWidth={narrow ? 0 : 720}>
            <Table striped verticalSpacing={6}>
              <Table.Thead>
                <Table.Tr>
                  {sorting.th('title', 'Game')}
                  {sorting.th('copies', 'Copies and PC games')}
                  {sealedView && !narrow && <Table.Th>Play it without opening one</Table.Th>}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {d.items.map((g) => {
                  const first = g.consoles[0];
                  return (
                    <Table.Tr key={g.key}>
                      <Table.Td valign="top">
                        {first ? (
                          <GameTitle platformKey={first.platformKey} title={first.title} fw={600}>
                            {g.title}
                          </GameTitle>
                        ) : (
                          <Text size="sm" fw={600}>
                            {g.title}
                          </Text>
                        )}
                        <Text size="xs" c="dimmed">
                          {haveLine(g)}
                        </Text>
                      </Table.Td>
                      <Table.Td valign="top">
                        <Group gap={6}>
                          {g.consoles.map((c) =>
                            copyMenu(`${c.platform}${c.title !== g.title ? ` (${c.title})` : ''} · ${completeness(c)}`, c.copyKey, `${c.title} (${c.platform})`, c.moved, () => open(c.platformKey, c.title)),
                          )}
                          {g.pc.map((p) =>
                            copyMenu(
                              `PC${p.title !== g.title ? ` (${p.title})` : ''} · ${[...new Set(p.storefronts.map((s) => `${s.storefront}${OWNERSHIP[s.ownership] ?? ''}`))].join(', ')}`,
                              p.copyKey,
                              `${p.title} (PC)`,
                              p.moved,
                            ),
                          )}
                        </Group>
                        {narrow && sealedView && g.playable.length > 0 && <PlayWays ways={g.playable} />}
                      </Table.Td>
                      {sealedView && !narrow && (
                        <Table.Td valign="top">
                          {g.playable.length > 0 ? (
                            <PlayWays ways={g.playable} />
                          ) : (
                            <Text size="xs" c="dimmed">
                              None yet
                            </Text>
                          )}
                        </Table.Td>
                      )}
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        {d && d.items.length === 0 && (
          <Text c="dimmed" ta="center" mt="md">
            {q ? 'No games match.' : 'No games here.'}
          </Text>
        )}
        {d && d.total > d.pageSize && (
          <Group justify="center">
            <Pagination total={Math.ceil(d.total / d.pageSize)} value={page} onChange={(p) => setParam({ page: String(p) })} />
          </Group>
        )}
      </Stack>
      <SameGameModal moving={moving} busy={move.isPending} onClose={() => setMoving(null)} onPick={(key, title) => moving && move.mutate({ copyKey: moving.copyKey, groupKey: key, done: `${moving.title} is with ${title} now.` })} />
    </>
  );
}

/**
 * What you have of a game in words: its copies (physical items: a sealed one and an open one are two copies) and, apart
 * from them, whether you have it on PC ("1 copy, sealed, and on PC"; "2 copies, 1 sealed").
 */
function haveLine(g: CopiesGroup): string {
  const physical = g.consoles.reduce((n, c) => n + c.copies, 0);
  const onPc = g.pc.length > 0;
  if (physical === 0) return onPc ? 'On PC' : '';
  const sealed = g.sealed === 0 ? '' : physical === 1 ? ', sealed' : `, ${g.sealed} sealed`;
  return `${physical} ${physical === 1 ? 'copy' : 'copies'}${sealed}${onPc ? ', and on PC' : ''}`;
}

/** The ways to play a sealed game and keep it sealed: each an oval, RomM's opening RomM. */
function PlayWays({ ways }: { ways: CopiesGroup['playable'] }) {
  return (
    <Group gap={6} mt={4}>
      {ways.map((w) =>
        w.url ? (
          <Badge
            key={w.label}
            component="a"
            href={w.url}
            target="_blank"
            rel="noopener noreferrer"
            variant="light"
            color="grape"
            rightSection={<IconExternalLink size={12} />}
            style={{ textTransform: 'none', cursor: 'pointer' }}
          >
            {w.label}
          </Badge>
        ) : (
          <Badge key={w.label} variant="light" color={w.kind === 'pc' ? 'blue' : 'green'} leftSection={w.kind === 'pc' ? <IconDeviceDesktop size={12} /> : undefined} style={{ textTransform: 'none' }}>
            {w.label}
          </Badge>
        ),
      )}
    </Group>
  );
}

/** "It's the same game as...": find the game a copy belongs with, by title. */
function SameGameModal({ moving, busy, onClose, onPick }: { moving: { copyKey: string; title: string } | null; busy: boolean; onClose: () => void; onPick: (key: string, title: string) => void }) {
  const [text, setText] = useState('');
  const [q] = useDebouncedValue(text, 250);
  const found = useQuery({ queryKey: ['copies', 'search', q], queryFn: () => api<{ key: string; title: string; where: string }[]>(`/copies/search?q=${encodeURIComponent(q)}`), enabled: q.trim().length > 1 });
  return (
    <Modal opened={moving !== null} onClose={onClose} title={moving ? `${moving.title} is the same game as...` : ''} size="lg">
      <Stack gap="sm">
        <TextInput placeholder="The game's title" leftSection={<IconSearch size={16} />} value={text} onChange={(e) => setText(e.currentTarget.value)} data-autofocus aria-label="Find the game" />
        {(found.data ?? []).map((g) => (
          <Group key={g.key} justify="space-between" wrap="nowrap">
            <Stack gap={0}>
              <Text size="sm">{g.title}</Text>
              <Text size="xs" c="dimmed">
                {g.where}
              </Text>
            </Stack>
            <Button size="compact-sm" variant="light" loading={busy} onClick={() => onPick(g.key, g.title)}>
              This one
            </Button>
          </Group>
        ))}
        {q.trim().length > 1 && found.data?.length === 0 && (
          <Text size="sm" c="dimmed">
            No game with that title.
          </Text>
        )}
      </Stack>
    </Modal>
  );
}
