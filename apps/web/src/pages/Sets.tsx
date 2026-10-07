import { KNOWN_PLATFORMS, READY_SETS, setKey } from '@squirrelcade/core';
import { ActionIcon, Anchor, Badge, Button, Card, Checkbox, FileButton, FileInput, Group, Loader, Menu, Modal, Progress, SegmentedControl, Select, Stack, Table, Tabs, Text, TextInput, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconDots, IconDownload, IconPlus, IconRefresh, IconSearch, IconUpload, IconX } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { StashMark } from '../Acorn';
import { api } from '../api';
import { PageHeader, type SortDirection } from '../components';
import { count, dateTime } from '../format';
import { notifyError, notifySuccess, useCanEdit, usePageTitle, useSetting, useSettings } from '../hooks';
import { GameTitle } from '../GameDrawer';
import { PreferencePicker } from '../Preference';
import { sortRows, useSort } from '../sort';
import { SeriesList } from './Series';

/** A set with its completion (GET /api/v1/sets). */
interface SetSummary {
  key: string;
  name: string;
  source: 'csv' | 'wikipedia';
  page: string | null;
  collectedOnly: boolean;
  builtAt: string | null;
  message: string | null;
  games: number;
  owned: number;
  review: number;
  percent: number;
  /** Games you added by hand, and games of the list you took out. */
  addedByHand: number;
  takenOut: number;
  platforms: { key: string; name: string; games: number; owned: number }[];
}

/** One of a set's games on one console (GET /api/v1/sets/:key). */
interface SetGame {
  id: number;
  title: string;
  platformKey: string;
  platform: string;
  status: 'owned' | 'missing' | 'review';
  ownedAs: string[];
  inCatalog: boolean;
  catalogStatus?: string;
  /** Owned copies that look like it (outside its console's catalog), never counted. */
  maybe?: string[];
  /** Owned through your answer that a look-alike is the same game. */
  linked?: boolean;
  /** Other consoles the same title is owned on (for a game not owned here). */
  ownedOn?: string[];
  /** Added by you, not from the set's list. */
  byHand?: boolean;
  notes: string | null;
  /** The console catalog's title for it, which your preference is kept under. */
  catalogTitle?: string;
  /** Your wishlist preference for it (a game its console's catalog has). */
  preference?: string | null;
}

const CATALOG_STATUS: Record<string, string> = {
  unconfirmed: 'Not confirmed physical on its console',
  upcoming: 'Not out yet',
  excluded: 'Left out of its console’s catalog',
};

/** The sets table's columns and which way each sorts first (D144): names A to Z, completion and consoles most first. */
const SET_SORTS = { name: 'asc', complete: 'desc', consoles: 'desc' } as const satisfies Record<string, SortDirection>;

/** A set's games table's columns and which way each sorts first (D144): words A to Z. */
const GAME_SORTS = { title: 'asc', console: 'asc', notes: 'asc' } as const satisfies Record<string, SortDirection>;

/** Makes a set: a ready-made one, from a Wikipedia list, or from the owner's own CSV. */
function NewSet({ opened, onClose, have }: { opened: boolean; onClose: () => void; have: readonly string[] }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [from, setFrom] = useState<'wikipedia' | 'csv'>('wikipedia');
  const [page, setPage] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [collectedOnly, setCollectedOnly] = useState(true);
  const create = useMutation({
    mutationFn: async () => {
      const made = await api<{ set: SetSummary; message: string }>('/sets', { method: 'POST', json: { name, page: from === 'wikipedia' ? page : null, collectedOnly } });
      if (from === 'csv' && file) {
        const form = new FormData();
        form.append('file', file);
        const saved = await api<{ message: string }>(`/sets/${made.set.key}/list`, { method: 'PUT', body: form });
        return { key: made.set.key, message: saved.message };
      }
      return { key: made.set.key, message: made.message };
    },
    onSuccess: (r) => {
      notifySuccess(r.message, 'Set made');
      void queryClient.invalidateQueries({ queryKey: ['sets'] });
      onClose();
      navigate(`/sets/${r.key}`);
    },
    onError: (err) => notifyError(err),
  });
  const ready = name.trim() && (from === 'wikipedia' ? page.trim() : file);
  // The ready-made sets you don't have yet: a click fills in the name and the Wikipedia page.
  const readyMade = READY_SETS.filter((r) => !have.includes(setKey(r.name)));

  return (
    <Modal opened={opened} onClose={onClose} title="New set" size="lg">
      <Stack>
        {readyMade.length > 0 && (
          <Stack gap={6}>
            <Text size="sm" fw={500}>
              Ready-made
            </Text>
            <Group gap="xs">
              {readyMade.map((r) => (
                <Tooltip key={r.name} label={r.about} multiline w={260}>
                  <Button
                    variant={name === r.name && page === r.page ? 'light' : 'default'}
                    size="xs"
                    onClick={() => {
                      setName(r.name);
                      setFrom('wikipedia');
                      setPage(r.page);
                    }}
                  >
                    {r.name}
                  </Button>
                </Tooltip>
              ))}
            </Group>
          </Stack>
        )}
        <TextInput label="Name" placeholder="Limited Run Games" value={name} onChange={(e) => setName(e.currentTarget.value)} data-autofocus />
        <SegmentedControl
          value={from}
          onChange={(v) => setFrom(v as 'wikipedia' | 'csv')}
          data={[
            { value: 'wikipedia', label: 'From a Wikipedia list' },
            { value: 'csv', label: 'From your own list (CSV)' },
          ]}
        />
        {from === 'wikipedia' ? (
          <TextInput
            label="Wikipedia list"
            description="The list's title or address. Each game's consoles come from a Platform column, from notes such as “(PS4)” in its row, or from the heading its table is under (“Nintendo Switch”)."
            placeholder="List of Limited Run Games releases"
            value={page}
            onChange={(e) => setPage(e.currentTarget.value)}
          />
        ) : (
          <FileInput
            label="Your list"
            description="A CSV with a Title column and a Platform column (PS4, Switch, Nintendo Switch...; several separated by ;), and Notes if you like."
            placeholder="Choose a .csv file"
            accept=".csv,text/csv"
            value={file}
            onChange={setFile}
            clearable
          />
        )}
        <Checkbox
          label="Only consoles you collect"
          description="A publisher's list spans many consoles; leave out the games on consoles you have no games for."
          checked={collectedOnly}
          onChange={(e) => setCollectedOnly(e.currentTarget.checked)}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!ready}>
            Make the set
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Adds a game to a set by hand: its title and console. */
function AddGame({ setKey, opened, onClose, platform }: { setKey: string; opened: boolean; onClose: () => void; platform: string | null }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [console_, setConsole] = useState<string | null>(platform);
  const add = useMutation({
    mutationFn: () => api(`/sets/${setKey}/games`, { method: 'POST', json: { title, platformKey: console_, action: 'add' } }),
    onSuccess: () => {
      notifySuccess(`${title} added to the set.`);
      setTitle('');
      void queryClient.invalidateQueries({ queryKey: ['sets'] });
      onClose();
    },
    onError: (err) => notifyError(err),
  });
  return (
    <Modal opened={opened} onClose={onClose} title="Add a game to the set">
      <Stack>
        <TextInput label="Title" value={title} onChange={(e) => setTitle(e.currentTarget.value)} data-autofocus />
        <Select label="Console" data={KNOWN_PLATFORMS.map((p) => ({ value: p.key, label: p.name }))} value={console_ ?? platform} onChange={setConsole} searchable />
        <Group justify="flex-end">
          <Button onClick={() => add.mutate()} loading={add.isPending} disabled={!title.trim() || !(console_ ?? platform)}>
            Add
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Sets: the owner's own sets of games beyond consoles, each with its completion. */
export function SetsPage() {
  const [opened, { open, close }] = useDisclosure();
  const canEdit = useCanEdit();
  // Your own sets, or the series IGDB knows (?tab=series), kept in the address for reloads and the back button.
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'series' ? 'series' : 'sets';
  const list = useQuery({ queryKey: ['sets'], queryFn: () => api<SetSummary[]>('/sets') });
  // A heading sorts the sets by its column (D144).
  const sorting = useSort(SET_SORTS, 'name');
  const sets = sortRows(list.data ?? [], (s) => (sorting.by === 'complete' ? s.percent : sorting.by === 'consoles' ? s.platforms.length : s.name), sorting.dir);
  return (
    <>
      <PageHeader help="sets"
        title="Sets"
        description="Your own sets of games beyond consoles: a publisher's releases (Limited Run Games, Super Rare Games), a series, any theme. Whether you own a game is its console's answer, your review answers included. The Series tab lists the series IGDB knows, on its own."
        actions={
          tab === 'sets' && canEdit ? (
            <Button leftSection={<IconPlus size={16} />} onClick={open}>
              New set
            </Button>
          ) : undefined
        }
      />
      <NewSet opened={opened} onClose={close} have={(list.data ?? []).map((s) => s.key)} />
      <Tabs value={tab} onChange={(v) => setParams(v === 'series' ? { tab: 'series' } : {}, { replace: true })} mb="md">
        <Tabs.List>
          <Tabs.Tab value="sets">Your sets</Tabs.Tab>
          <Tabs.Tab value="series">Series</Tabs.Tab>
        </Tabs.List>
      </Tabs>
      {tab === 'series' ? (
        // A new series named in the address (from a game's drawer) starts the list afresh.
        <SeriesList key={params.get('series') ?? ''} />
      ) : list.isLoading ? (
        <Loader />
      ) : (list.data ?? []).length === 0 ? (
        <Card withBorder>
          <Text size="sm">
            No sets yet. Make one from a Wikipedia list (Wikipedia's “List of Limited Run Games releases”, for example) or from your own CSV of titles and consoles.
          </Text>
        </Card>
      ) : (
        <Card withBorder p={0}>
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                {sorting.th('name', 'Set')}
                {sorting.th('complete', 'Complete')}
                {sorting.th('consoles', 'Consoles', { visibleFrom: 'sm' })}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {sets.map((s) => (
                <Table.Tr key={s.key}>
                  <Table.Td>
                    <Anchor component={Link} to={`/sets/${s.key}`} fw={500}>
                      {s.name}
                    </Anchor>
                    <Text size="xs" c="dimmed">
                      {s.source === 'wikipedia' ? `Wikipedia: ${s.page}` : 'Your list'}
                    </Text>
                  </Table.Td>
                  <Table.Td miw={180}>
                    <Text size="sm">
                      {count(s.owned)} of {count(s.games)} ({s.percent}%)
                    </Text>
                    <Progress aria-label={`${s.name} complete`} value={s.percent} size="sm" mt={4} />
                  </Table.Td>
                  <Table.Td visibleFrom="sm">
                    <Group gap={4}>
                      {s.platforms.slice(0, 4).map((p) => (
                        <Badge key={p.key} size="sm" variant="light" color="gray" style={{ textTransform: 'none' }}>
                          {p.name} {p.owned}/{p.games}
                        </Badge>
                      ))}
                      {s.platforms.length > 4 && (
                        <Text size="xs" c="dimmed">
                          +{s.platforms.length - 4}
                        </Text>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      )}
    </>
  );
}

/** One set: its completion, its games by owned, missing and to review, filtered by console. */
export function SetDetailPage() {
  const { key = '' } = useParams();
  // A viewer sees the set and its games, not the buttons that change it.
  const canEdit = useCanEdit();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: settings } = useSettings();
  const dateFormat = useSetting('general.dateFormat', 'us');
  const [tab, setTab] = useState<string | null>('missing');
  const [platform, setPlatform] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  // A heading sorts the games by its column (D144), on every tab.
  const sorting = useSort(GAME_SORTS, 'title');
  const detail = useQuery({ queryKey: ['sets', key], queryFn: () => api<{ set: SetSummary; games: SetGame[] }>(`/sets/${key}`) });
  usePageTitle(detail.data?.set.name ?? 'Sets', settings?.['general.instanceName'] || 'Squirrelcade');
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['sets'] });
  const rebuild = useMutation({
    mutationFn: () => api<{ message: string }>(`/sets/${key}/rebuild`, { method: 'POST' }),
    onSuccess: (r) => {
      notifySuccess(r.message, 'Read again');
      void refresh();
    },
    onError: (err) => notifyError(err),
  });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api<{ message: string }>(`/sets/${key}/list`, { method: 'PUT', body: form });
    },
    onSuccess: (r) => {
      notifySuccess(r.message, 'List updated');
      void refresh();
    },
    onError: (err) => notifyError(err),
  });
  const change = useMutation({
    mutationFn: (body: { name?: string; collectedOnly?: boolean }) => api(`/sets/${key}`, { method: 'PATCH', json: body }),
    onSuccess: () => void refresh(),
    onError: (err) => notifyError(err),
  });
  const answer = useMutation({
    mutationFn: (body: { platformKey: string; title: string; ownedTitle: string; decision: 'same' | 'different' | null }) => api(`/sets/${key}/answers`, { method: 'PUT', json: body }),
    onSuccess: () => void refresh(),
    onError: (err) => notifyError(err),
  });
  const [adding, { open: openAdd, close: closeAdd }] = useDisclosure();
  const takeOut = useMutation({
    mutationFn: (g: SetGame) => api(`/sets/${key}/games`, { method: 'POST', json: { title: g.title, platformKey: g.platformKey, action: 'remove' } }),
    onSuccess: () => void refresh(),
    onError: (err) => notifyError(err),
  });
  const bringBack = useMutation({
    mutationFn: () => api(`/sets/${key}/restore`, { method: 'POST' }),
    onSuccess: () => void refresh(),
    onError: (err) => notifyError(err),
  });
  const remove = useMutation({
    mutationFn: () => api(`/sets/${key}`, { method: 'DELETE' }),
    onSuccess: () => {
      void refresh();
      navigate('/sets');
    },
    onError: (err) => notifyError(err),
  });

  if (detail.isLoading) return <Loader />;
  if (!detail.data) return <Text c="dimmed">No such set.</Text>;
  const { set, games } = detail.data;
  const q = search.trim().toLowerCase();
  const shown = games.filter((g) => (!platform || g.platformKey === platform) && (!q || g.title.toLowerCase().includes(q)));
  // The third column is what the row shows: the copies it's owned as, else the list's notes (nothing while it waits for Review).
  const sorted = sortRows(shown, (g) => (sorting.by === 'console' ? g.platform : sorting.by === 'notes' ? (g.status === 'owned' ? g.ownedAs.join('; ') : g.status === 'review' ? null : g.notes) : g.title), sorting.dir);
  const of = (status: SetGame['status']) => sorted.filter((g) => g.status === status);

  return (
    <>
      <PageHeader help="sets"
        title={set.name}
        description={
          <>
            <Anchor component={Link} to="/sets" size="sm">
              Sets
            </Anchor>
            {' · '}
            {set.source === 'wikipedia' ? (
              <>
                From Wikipedia's{' '}
                <Anchor href={`https://en.wikipedia.org/wiki/${encodeURIComponent(set.page ?? '')}`} target="_blank" rel="noreferrer" size="sm">
                  {set.page}
                </Anchor>
              </>
            ) : (
              'From your list'
            )}
            {set.builtAt ? `, read ${dateTime(set.builtAt, dateFormat)}` : ''}
            {set.collectedOnly ? '; only consoles you collect' : ''}
          </>
        }
        actions={
          <>
            {!canEdit ? null : set.source === 'wikipedia' ? (
              <Button size="xs" variant="default" leftSection={<IconRefresh size={14} />} loading={rebuild.isPending} onClick={() => rebuild.mutate()}>
                Read again
              </Button>
            ) : (
              <FileButton onChange={(f) => f && upload.mutate(f)} accept=".csv,text/csv">
                {(props) => (
                  <Button {...props} size="xs" variant="default" leftSection={<IconUpload size={14} />} loading={upload.isPending}>
                    New list
                  </Button>
                )}
              </FileButton>
            )}
            {canEdit && (
              <Button size="xs" variant="default" leftSection={<IconPlus size={14} />} onClick={openAdd}>
                Add a game
              </Button>
            )}
            <Button size="xs" variant="default" leftSection={<IconDownload size={14} />} component="a" href={`/api/v1/sets/${key}/export?status=missing`}>
              Missing (CSV)
            </Button>
            {canEdit && (
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon variant="default" size="md" aria-label="More">
                  <IconDots size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  onClick={() => {
                    const name = window.prompt('Name of the set', set.name);
                    if (name && name.trim() && name.trim() !== set.name) change.mutate({ name: name.trim() });
                  }}
                >
                  Rename
                </Menu.Item>
                <Menu.Item onClick={() => change.mutate({ collectedOnly: !set.collectedOnly })}>{set.collectedOnly ? 'Show every console in the list' : 'Only consoles you collect'}</Menu.Item>
                <Menu.Divider />
                <Menu.Item
                  color="red"
                  onClick={() => {
                    if (window.confirm(`Remove the set "${set.name}"? Your collection and catalogs stay as they are.`)) remove.mutate();
                  }}
                >
                  Remove the set
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
            )}
          </>
        }
      />
      <Card withBorder mb="md">
        <Group justify="space-between" mb={6}>
          <Text fw={600}>{set.percent}% complete</Text>
          <Text size="sm" c="dimmed">
            {count(set.owned)} of {count(set.games)} owned{set.review > 0 ? `, ${count(set.review)} to review` : ''}
          </Text>
        </Group>
        <Progress aria-label={`${set.name} complete`} value={set.percent} size="lg" />
        {set.message && (
          <Text size="xs" c="dimmed" mt="xs">
            {set.message}
          </Text>
        )}
        {(set.addedByHand > 0 || set.takenOut > 0) && (
          <Text size="xs" c="dimmed" mt={4}>
            {set.addedByHand > 0 ? `${count(set.addedByHand)} added by you` : ''}
            {set.addedByHand > 0 && set.takenOut > 0 ? '; ' : ''}
            {set.takenOut > 0 && (
              <>
                {count(set.takenOut)} taken out by you
                {canEdit && (
                  <>
                    {' · '}
                    <Anchor size="xs" onClick={() => bringBack.mutate()}>
                      bring them back
                    </Anchor>
                  </>
                )}
              </>
            )}
          </Text>
        )}
      </Card>
      <AddGame setKey={key} opened={adding} onClose={closeAdd} platform={platform ?? set.platforms[0]?.key ?? null} />
      {set.platforms.length > 1 && (
        <Group gap={6} mb="sm">
          <Badge component="button" size="lg" variant={platform === null ? 'filled' : 'light'} style={{ cursor: 'pointer', textTransform: 'none' }} onClick={() => setPlatform(null)}>
            Every console
          </Badge>
          {set.platforms.map((p) => (
            <Badge
              key={p.key}
              component="button"
              size="lg"
              variant={platform === p.key ? 'filled' : 'light'}
              color={p.owned === p.games ? 'teal' : 'gray'}
              style={{ cursor: 'pointer', textTransform: 'none' }}
              onClick={() => setPlatform(platform === p.key ? null : p.key)}
            >
              {p.name} {p.owned}/{p.games}
            </Badge>
          ))}
        </Group>
      )}
      <TextInput placeholder="Search" leftSection={<IconSearch size={16} />} value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={260} mb="sm" />
      <Tabs value={tab} onChange={setTab}>
        <Tabs.List mb="sm">
          <Tabs.Tab value="missing">Missing ({count(of('missing').length)})</Tabs.Tab>
          <Tabs.Tab value="owned" leftSection={<StashMark size={13} />}>
            Owned ({count(of('owned').length)})
          </Tabs.Tab>
          {set.review > 0 && <Tabs.Tab value="review">To review ({count(of('review').length)})</Tabs.Tab>}
        </Tabs.List>
      </Tabs>
      <Card withBorder p={0}>
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              {sorting.th('title', 'Game')}
              {sorting.th('console', 'Console')}
              {sorting.th('notes', tab === 'owned' ? 'Owned as' : 'Notes', { visibleFrom: 'sm' })}
              <Table.Th w={40} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {of((tab ?? 'missing') as SetGame['status']).map((g) => (
              <Table.Tr key={g.id}>
                <Table.Td>
                  <Group gap={6}>
                    <GameTitle platformKey={g.platformKey} title={g.title} />
                    {g.byHand && (
                      <Badge size="xs" variant="light" color="gray" style={{ textTransform: 'none' }}>
                        added by you
                      </Badge>
                    )}
                  </Group>
                  {g.catalogStatus && CATALOG_STATUS[g.catalogStatus] && (
                    <Text size="xs" c="dimmed">
                      {CATALOG_STATUS[g.catalogStatus]}
                    </Text>
                  )}
                  {g.maybe?.map((m) => (
                    <Group key={m} gap={6}>
                      <Text size="xs" c="yellow.7">
                        You have {m}: the same game?
                      </Text>
                      {canEdit && (
                        <>
                          <Anchor size="xs" onClick={() => answer.mutate({ platformKey: g.platformKey, title: g.title, ownedTitle: m, decision: 'same' })}>
                            Same game
                          </Anchor>
                          <Anchor size="xs" c="dimmed" onClick={() => answer.mutate({ platformKey: g.platformKey, title: g.title, ownedTitle: m, decision: 'different' })}>
                            Not it
                          </Anchor>
                        </>
                      )}
                    </Group>
                  ))}
                  {g.ownedOn && (
                    <Text size="xs" c="dimmed">
                      You have it on {g.ownedOn.join(', ')}
                    </Text>
                  )}
                  {g.status !== 'owned' && g.catalogTitle && (
                    <Group mt={4}>
                      <PreferencePicker platformKey={g.platformKey} title={g.catalogTitle} value={g.preference ?? null} width={170} />
                    </Group>
                  )}
                  {g.linked && (
                    <Group gap={6}>
                      <Text size="xs" c="dimmed">
                        You said {g.ownedAs.join('; ')} is this game.
                      </Text>
                      {canEdit && (
                        <Anchor size="xs" c="dimmed" onClick={() => g.ownedAs.forEach((m) => answer.mutate({ platformKey: g.platformKey, title: g.title, ownedTitle: m, decision: null }))}>
                          undo
                        </Anchor>
                      )}
                    </Group>
                  )}
                </Table.Td>
                <Table.Td>
                  {g.inCatalog ? (
                    <Anchor component={Link} to={`/platforms/${g.platformKey}?tab=${g.catalogStatus ?? g.status}&q=${encodeURIComponent(g.title)}`} size="sm">
                      {g.platform}
                    </Anchor>
                  ) : (
                    <Tooltip label="Not in this console's catalog: matched by its title alone">
                      <Text size="sm">{g.platform}</Text>
                    </Tooltip>
                  )}
                </Table.Td>
                <Table.Td visibleFrom="sm">
                  {g.status === 'review' ? (
                    <Anchor component={Link} to="/review" size="sm">
                      Answer on Review
                    </Anchor>
                  ) : (
                    <Text size="sm" c="dimmed">
                      {tab === 'owned' ? g.ownedAs.join('; ') : (g.notes ?? '')}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  {canEdit && (
                    <Tooltip label={g.byHand ? 'Remove from the set' : "Take out of the set (it isn't part of it); you can bring it back"}>
                      <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => takeOut.mutate(g)} aria-label={`Take ${g.title} out of the set`}>
                        <IconX size={14} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>
    </>
  );
}
