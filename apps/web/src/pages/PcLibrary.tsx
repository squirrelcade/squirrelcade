import { PC_OWNERSHIP_LABELS, pcFamilyKey, type PcOwnership } from '@squirrelcade/core';
import { PriceCell, type PcWishlist } from './PcWishlist';
import { Alert, Anchor, Badge, Button, Card, Checkbox, FileButton, Group, Menu, Pagination, Select, SimpleGrid, Stack, Table, Tabs, Text, TextInput, Tooltip } from '@mantine/core';
import { useDebouncedValue, useMediaQuery } from '@mantine/hooks';
import { IconDeviceDesktop, IconDownload, IconRefresh, IconSearch, IconShieldCheck, IconTrash, IconTrophy, IconUpload } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../api';
import { PageHeader, SortableTh, StatCard, type SortDirection } from '../components';
import { count, date, dateTime } from '../format';
import { notifyError, notifySuccess, useCanEdit, useFeature, useSetting } from '../hooks';
import { GameTitle } from '../GameDrawer';
import { sortRows, useSort } from '../sort';

/** One game in one storefront (GET /api/v1/pc/games). */
interface PcRecord {
  recordKey: string;
  storefront: string;
  name: string;
  ownership: PcOwnership;
  audited: boolean;
  playtimeSeconds: number;
  installed: boolean;
  hidden: boolean;
  links: { name: string; url: string }[];
  /** A Steam game's achievements (with Steam achievements on). */
  achievements?: { earned: number; total: number; progress: number; completed: boolean; lastPlayedAt: string | null } | null;
}

/** A game across its storefronts, with its console copies. */
interface PcFamily {
  key: string;
  title: string;
  records: PcRecord[];
  owned: boolean;
  playtimeHours: number;
  lastActivityAt: string | null;
  genres: string[];
  installed: boolean;
  favorite: boolean;
  consoles: { platform: string; platformKey: string; title: string; copies: number; sealed: number }[];
}

/** The PC library's state (GET /api/v1/pc). */
interface PcStatus {
  folder: string | null;
  readerAvailable: boolean;
  newestBackup: { fileName: string; writtenAt: string } | null;
  lastRead: { id: number; readAt: string; fileName: string; backupAt: string | null; status: string; games: number; added: number; removed: number; message: string | null } | null;
  held: { id: number; readAt: string; fileName: string; games: number; message: string | null } | null;
  records: number;
  families: number;
  owned: number;
  byStorefront: { storefront: string; records: number; owned: number; subscription: number; historical: number }[];
  playtimeHours: number;
  installed: number;
  audit: number;
}

/** Ownership colors: owned green, subscription blue, not verified gray. */
const OWNERSHIP_COLOR: Record<PcOwnership, string> = { permanent: 'teal', subscription: 'blue', historical: 'gray' };

const COLUMNS = { title: 'asc', playtime: 'desc', played: 'desc', storefronts: 'desc' } as const satisfies Record<string, SortDirection>;
type Column = keyof typeof COLUMNS;

/** The sealed games table's columns and which way each sorts first (D144): words A to Z, the PC version's price most first. */
const SEALED_SORTS = { title: 'asc', consoles: 'asc', pc: 'desc' } as const satisfies Record<string, SortDirection>;

/**
 * The PC library: the games in your PC storefronts as Playnite knows them, one row per game with its
 * storefronts (colored by how each counts), playtime and the console copies of the same game. Owning a
 * game on PC never counts as owning its console version; it shows as related instead.
 */
export function PcLibraryPage() {
  const queryClient = useQueryClient();
  // A viewer sees the library and its download, not the readings, the audit or the ownership answers.
  const canEdit = useCanEdit();
  const dateFormat = useSetting('general.dateFormat', 'us');
  // Steam achievements (0.28.0): their badge beside Steam games, and a filter, for those who see what the owner played
  // (a viewer only when Settings > Security shares it).
  const seesPlay = useSetting('security.viewersSeePlay', true) || canEdit;
  const steamOn = useFeature('steam') && seesPlay;
  const narrow = useMediaQuery('(max-width: 48em)');
  const [params, setParams] = useSearchParams();
  const set = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  };
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [q] = useDebouncedValue(search, 300);
  const by: Column = (params.get('sort') ?? '') in COLUMNS ? (params.get('sort') as Column) : 'title';
  const direction: SortDirection = params.get('dir') === 'asc' || params.get('dir') === 'desc' ? (params.get('dir') as SortDirection) : COLUMNS[by];
  const view = params.get('view') ?? '';
  const page = Number(params.get('page')) || 1;
  const query = new URLSearchParams({ sort: by, dir: direction, page: String(page), pageSize: '100' });
  for (const k of ['storefront', 'ownership', 'installed', 'achievements']) if (params.get(k)) query.set(k, params.get(k)!);
  if (q) query.set('q', q);
  if (view === 'both' || view === 'pc-only') query.set('view', view);

  const status = useQuery({ queryKey: ['pc', 'status'], queryFn: () => api<PcStatus>('/pc') });
  const games = useQuery({ queryKey: ['pc', 'games', query.toString()], queryFn: () => api<{ total: number; page: number; pageSize: number; items: PcFamily[] }>(`/pc/games?${query}`), enabled: view !== 'sealed' });
  const sealed = useQuery({
    queryKey: ['pc', 'sealed'],
    queryFn: () => api<{ title: string; key: string; consoles: { platform: string; platformKey: string; title: string; copies: number; sealed: number }[] }[]>('/pc/sealed'),
    enabled: view === 'sealed',
  });
  // Their PC versions: the PC wishlist has them (with IsThereAnyDeal's prices, when PC game prices are on).
  const pcWishlist = useQuery({ queryKey: ['pc', 'wishlist'], queryFn: () => api<PcWishlist>('/pc/wishlist'), enabled: view === 'sealed' });
  const pcVersion = new Map((pcWishlist.data?.items ?? []).map((e) => [pcFamilyKey(e.title), e]));
  // The sealed games sort by their headings too (D144), in keys of their own (?sort= is the games table's). On PC sorts
  // by today's price when PC game prices are on, else by whether the PC wishlist has it.
  const sealedSorting = useSort(SEALED_SORTS, 'title', 'sealed');
  const sealedRows = sortRows(
    sealed.data ?? [],
    (g) => {
      if (sealedSorting.by === 'title') return g.title;
      if (sealedSorting.by === 'consoles') return g.consoles.map((c) => c.platform).join(', ');
      const pc = pcVersion.get(g.key) ?? pcVersion.get(pcFamilyKey(g.title));
      return pcWishlist.data?.pricesOn ? (pc?.price && !pc.price.missing ? pc.price.currentCents : null) : pc !== undefined;
    },
    sealedSorting.dir,
  );
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['pc'] });

  const read = useMutation({
    mutationFn: () => api('/pc/read', { method: 'POST' }),
    onSuccess: () => {
      notifySuccess('Reading the newest Playnite backup; the page updates when it is done.', 'Reading');
      // A reading takes seconds; look again shortly.
      for (const wait of [3000, 8000, 20000]) setTimeout(() => void refresh(), wait);
    },
    onError: (err) => notifyError(err),
  });
  const uploadSnapshot = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api<{ status: string; message: string }>('/pc/snapshot', { method: 'POST', body: form });
    },
    onSuccess: (r) => {
      notifySuccess(r.message, r.status === 'held' ? 'Held for your confirmation' : 'PC library updated');
      void refresh();
    },
    onError: (err) => notifyError(err),
  });
  const held = useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'apply' | 'discard' }) => api(`/pc/reads/${id}/${action}`, { method: 'POST' }),
    onSuccess: () => void refresh(),
    onError: (err) => notifyError(err),
  });
  const audit = useMutation({
    mutationFn: (file: File | null) => {
      if (!file) return api('/pc/audit', { method: 'DELETE' });
      const form = new FormData();
      form.append('file', file);
      return api<{ entries: number; problems: string[] }>('/pc/audit', { method: 'PUT', body: form });
    },
    onSuccess: (r) => {
      const result = r as { entries?: number; problems?: string[] } | undefined;
      notifySuccess(result?.entries !== undefined ? `${count(result.entries)} audited games.${result.problems?.length ? ` ${result.problems.join(' ')}` : ''}` : 'Your audit file is gone.', 'Ownership audit');
      void refresh();
    },
    onError: (err) => notifyError(err),
  });
  const setOwnership = useMutation({
    mutationFn: ({ key, ownership }: { key: string; ownership: PcOwnership | null }) => api(`/pc/games/${encodeURIComponent(key)}`, { method: 'PATCH', json: { ownership } }),
    onSuccess: () => void refresh(),
    onError: (err) => notifyError(err),
  });

  const s = status.data;
  const heading = (column: Column, label: string, ta?: 'right') => (
    <SortableTh label={label} active={by === column} direction={direction} onSort={() => set({ sort: column, dir: column === by ? (direction === 'asc' ? 'desc' : 'asc') : COLUMNS[column] })} ta={ta} />
  );

  return (
    <>
      <PageHeader help="pc-library"
        title="PC library"
        description={s && s.records > 0 ? `${count(s.families)} games (${count(s.owned)} owned) in ${count(s.byStorefront.length)} storefronts, from Playnite` : 'Your PC games, read from Playnite’s library backups'}
        actions={
          <Group gap="xs">
            {canEdit && (
              <Button size="xs" variant="default" leftSection={<IconRefresh size={14} />} loading={read.isPending} disabled={!s?.readerAvailable || !s?.folder} onClick={() => read.mutate()}>
                Read now
              </Button>
            )}
            {/* The games the page shows (its filters), as a spreadsheet. */}
            {s && s.records > 0 && (
              <Button
                size="xs"
                variant="default"
                component="a"
                href={`/api/v1/pc/export${(() => {
                  const f = new URLSearchParams([...params].filter(([k]) => ['q', 'storefront', 'ownership', 'installed', 'played', 'view'].includes(k)));
                  return f.size > 0 ? `?${f}` : '';
                })()}`}
                leftSection={<IconDownload size={14} />}
              >
                Download
              </Button>
            )}
            {/* Not the backup ZIP (gigabytes of artwork): the small JSON file the Playnite reader writes, for setups that run it elsewhere. */}
            {canEdit && (
            <FileButton onChange={(f) => f && uploadSnapshot.mutate(f)} accept=".json,application/json">
              {(props) => (
                <Tooltip label="Not the backup itself: the small .json file the Playnite reader writes, for setups where Squirrelcade can't read the backup folder" multiline w={260}>
                  <Button {...props} size="xs" variant="subtle" leftSection={<IconUpload size={14} />} loading={uploadSnapshot.isPending}>
                    Reader snapshot (.json)
                  </Button>
                </Tooltip>
              )}
            </FileButton>
            )}
          </Group>
        }
      />

      {/* In Docker the folder is /playnite even when nothing is mounted there, so the help shows until a backup turns up. */}
      {s && s.records === 0 && !s.newestBackup && (
        <Alert color="blue" mb="md" icon={<IconDeviceDesktop size={18} />} title="Connect Playnite">
          {s.folder
            ? `No Playnite backup in ${s.folder} yet. Set Playnite to save its library backups (Playnite > Settings > Backup, weekly is enough) to that folder; in Docker, mount the folder Playnite saves to at /playnite (read-only is enough; the README shows how).`
            : 'Set Playnite to save library backups (Playnite > Settings > Backup, weekly is enough) to a folder Squirrelcade can read, then name the folder in Settings > PC library.'}{' '}
          Backups can be gigabytes of artwork: Squirrelcade reads them where they are and takes only the library files out, so nothing is uploaded.
        </Alert>
      )}
      {s && s.records === 0 && s.newestBackup && s.readerAvailable && !s.lastRead && (
        <Alert color="blue" mb="md" icon={<IconDeviceDesktop size={18} />} title="A Playnite backup is here">
          {s.newestBackup.fileName} is waiting to be read: Read now reads it (Squirrelcade also looks for new backups on its own, Settings &gt; PC library).
        </Alert>
      )}
      {s?.folder && !s.readerAvailable && (
        <Alert color="orange" mb="md" title="The Playnite reader isn’t here">
          This installation can’t read Playnite backups itself (the Docker image can). Run the Playnite reader elsewhere and upload the snapshot it writes.
        </Alert>
      )}
      {canEdit && s?.held && (
        <Alert color="orange" mb="md" title="A reading waits for you">
          <Stack gap={6}>
            <Text size="sm">{s.held.message}</Text>
            <Group gap="xs">
              <Button size="xs" color="orange" onClick={() => held.mutate({ id: s.held!.id, action: 'apply' })} loading={held.isPending}>
                Apply it
              </Button>
              <Button size="xs" variant="default" onClick={() => held.mutate({ id: s.held!.id, action: 'discard' })} loading={held.isPending}>
                Discard it
              </Button>
            </Group>
          </Stack>
        </Alert>
      )}
      {s?.lastRead?.status === 'failed' && (
        <Alert color="red" mb="md" title="The last reading failed">
          {s.lastRead.message}
        </Alert>
      )}

      {s && s.records > 0 && (
        <SimpleGrid cols={{ base: 2, sm: 4 }} mb="md">
          <StatCard label="Games" value={count(s.families)} hint={`${count(s.records)} storefront copies`} />
          <StatCard label="Owned" value={count(s.owned)} hint="Bought or claimed for good" />
          <StatCard label="Played" value={`${count(Math.round(s.playtimeHours))} h`} hint={`${count(s.installed)} installed`} />
          <StatCard
            label="Last reading"
            value={s.lastRead ? date(s.lastRead.readAt, dateFormat) : '—'}
            hint={s.newestBackup ? `Newest backup ${dateTime(s.newestBackup.writtenAt, dateFormat)}` : s.lastRead?.fileName}
          />
        </SimpleGrid>
      )}

      {s && s.byStorefront.length > 0 && (
        <Group gap={6} mb="sm">
          {s.byStorefront.map((st) => (
            <Tooltip key={st.storefront} label={`${count(st.owned)} owned${st.subscription ? `, ${count(st.subscription)} subscription` : ''}${st.historical ? `, ${count(st.historical)} not verified` : ''}`}>
              <Badge
                component="button"
                size="lg"
                variant={params.get('storefront') === st.storefront ? 'filled' : 'light'}
                color={st.owned === st.records ? 'teal' : st.owned === 0 ? 'gray' : 'yellow'}
                style={{ cursor: 'pointer', textTransform: 'none' }}
                onClick={() => set({ storefront: params.get('storefront') === st.storefront ? null : st.storefront })}
              >
                {st.storefront} {count(st.records)}
              </Badge>
            </Tooltip>
          ))}
        </Group>
      )}

      {/* The library's views, as a console's page has them. */}
      <Tabs value={view || 'all'} onChange={(v) => set({ view: v === 'all' || !v ? null : v })} mb="sm">
        <Tabs.List>
          <Tabs.Tab value="all">Every PC game</Tabs.Tab>
          <Tabs.Tab value="both">On PC and a console</Tabs.Tab>
          <Tabs.Tab value="pc-only">Only on PC</Tabs.Tab>
          <Tabs.Tab value="sealed">Play it on PC, keep it sealed</Tabs.Tab>
        </Tabs.List>
      </Tabs>
      <Group mb="sm" gap="sm" wrap="wrap">
        <TextInput
          placeholder="Search"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => {
            setSearch(e.currentTarget.value);
            set({ q: e.currentTarget.value || null });
          }}
          w={240}
        />
        <Select
          aria-label="Ownership"
          placeholder="Any ownership"
          data={Object.entries(PC_OWNERSHIP_LABELS).map(([value, label]) => ({ value, label }))}
          value={params.get('ownership')}
          onChange={(v) => set({ ownership: v })}
          clearable
          w={170}
        />
        <Checkbox label="Installed" checked={params.get('installed') === 'yes'} onChange={(e) => set({ installed: e.currentTarget.checked ? 'yes' : null })} />
        {steamOn && (
          <Select
            aria-label="Steam achievements"
            placeholder="Any achievements"
            data={[
              { value: 'completed', label: 'Completed on Steam' },
              { value: 'started', label: 'With Steam achievements' },
            ]}
            value={params.get('achievements')}
            onChange={(v) => set({ achievements: v })}
            clearable
            w={250}
          />
        )}
      </Group>

      {view === 'sealed' ? (
        <Card withBorder p={0}>
          <Text size="xs" c="dimmed" p="sm">
            Games you keep sealed on a console and don’t own on PC: the PC game lets you play them and keep the box sealed (and sell it later, if you like).
            Their PC versions are on the PC wishlist, found through IGDB, with today's price and the lowest ever when PC game prices are on; a price drop sends
            you a message.
          </Text>
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                {sealedSorting.th('title', 'Game')}
                {sealedSorting.th('consoles', 'Console copies')}
                {sealedSorting.th('pc', 'On PC')}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {sealedRows.map((g) => {
                const pc = pcVersion.get(g.key) ?? pcVersion.get(pcFamilyKey(g.title));
                return (
                  <Table.Tr key={g.key}>
                    <Table.Td>{g.title}</Table.Td>
                    <Table.Td>
                      <ConsoleCopies consoles={g.consoles} />
                    </Table.Td>
                    <Table.Td>
                      {pc ? (
                        pcWishlist.data?.pricesOn ? (
                          <PriceCell price={pc.price} />
                        ) : (
                          <Anchor component={Link} to="/pc/wishlist" size="xs">
                            On the PC wishlist
                          </Anchor>
                        )
                      ) : (
                        <Text size="xs" c="dimmed">
                          {pcWishlist.isLoading ? '…' : 'No PC version found yet'}
                        </Text>
                      )}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Card>
      ) : (
        <Card withBorder p={0}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                {heading('title', 'Game')}
                {!narrow && <Table.Th>Genres</Table.Th>}
                {heading('playtime', 'Played', 'right')}
                {!narrow && heading('played', 'Last played')}
                {!narrow && <Table.Th>Consoles</Table.Th>}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(games.data?.items ?? []).map((f) => (
                <Table.Tr key={f.key}>
                  <Table.Td>
                    <Stack gap={4}>
                      <Text size="sm" fw={500}>
                        {f.title}
                        {f.favorite && ' ★'}
                      </Text>
                      <Group gap={4}>
                        {f.records.map((r) => (
                          <Menu key={r.recordKey} position="bottom-start" withinPortal>
                            <Menu.Target>
                              <Badge component="button" size="sm" variant={r.audited ? 'filled' : 'light'} color={OWNERSHIP_COLOR[r.ownership]} style={{ cursor: 'pointer', textTransform: 'none' }}>
                                {r.storefront}
                                {r.ownership !== 'permanent' ? ` · ${PC_OWNERSHIP_LABELS[r.ownership]}` : ''}
                              </Badge>
                            </Menu.Target>
                            <Menu.Dropdown>
                              <Menu.Label>
                                {r.storefront}: {r.name}
                              </Menu.Label>
                              {canEdit && (Object.keys(PC_OWNERSHIP_LABELS) as PcOwnership[]).map((o) => (
                                <Menu.Item key={o} leftSection={o === r.ownership ? <IconShieldCheck size={14} /> : undefined} onClick={() => setOwnership.mutate({ key: r.recordKey, ownership: o })}>
                                  {PC_OWNERSHIP_LABELS[o]}
                                </Menu.Item>
                              ))}
                              {canEdit && r.audited && <Menu.Item onClick={() => setOwnership.mutate({ key: r.recordKey, ownership: null })}>Back to the storefront’s default</Menu.Item>}
                              {r.links.slice(0, 3).map((l) => (
                                <Menu.Item key={l.url} component="a" href={l.url} target="_blank" rel="noreferrer">
                                  Open {l.name}
                                </Menu.Item>
                              ))}
                            </Menu.Dropdown>
                          </Menu>
                        ))}
                        {f.records
                          .filter((r) => r.achievements)
                          .map((r) => (
                            <Tooltip key={`a-${r.recordKey}`} label={`Steam achievements: ${r.achievements!.earned} of ${r.achievements!.total}${r.achievements!.lastPlayedAt ? `, last played ${date(r.achievements!.lastPlayedAt, dateFormat)}` : ''}`}>
                              <Badge size="sm" variant="light" color={r.achievements!.completed ? 'yellow' : 'gray'} leftSection={<IconTrophy size={12} />} style={{ textTransform: 'none' }}>
                                {r.achievements!.completed ? 'All' : `${r.achievements!.earned}/${r.achievements!.total}`}
                              </Badge>
                            </Tooltip>
                          ))}
                      </Group>
                    </Stack>
                  </Table.Td>
                  {!narrow && (
                    <Table.Td>
                      <Text size="xs">{f.genres.slice(0, 3).join(', ')}</Text>
                    </Table.Td>
                  )}
                  <Table.Td ta="right">{f.playtimeHours > 0 ? `${f.playtimeHours} h` : '—'}</Table.Td>
                  {!narrow && <Table.Td>{f.lastActivityAt ? date(f.lastActivityAt, dateFormat) : '—'}</Table.Td>}
                  {!narrow && (
                    <Table.Td>
                      <ConsoleCopies consoles={f.consoles} />
                    </Table.Td>
                  )}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {games.data && games.data.total > games.data.pageSize && (
            <Group justify="center" p="sm">
              <Pagination total={Math.ceil(games.data.total / games.data.pageSize)} value={page} onChange={(p) => set({ page: String(p) })} size="sm" />
            </Group>
          )}
          {games.data && games.data.total === 0 && (
            <Text c="dimmed" size="sm" p="md">
              {s && s.records === 0 ? 'No PC games yet: connect Playnite (above) or upload a snapshot.' : 'No game matches.'}
            </Text>
          )}
        </Card>
      )}

      {canEdit && (
      <Card withBorder mt="md">
        <Group justify="space-between" align="flex-start">
          <Stack gap={4} style={{ flex: 1, minWidth: 240 }}>
            <Text fw={600} size="sm">
              Ownership audit
            </Text>
            <Text size="xs" c="dimmed">
              Some storefronts mix subscription games into their libraries (EA app, Ubisoft Connect, Xbox), so their games wait as not verified until you say how you own them: here, one game at a time (click its storefront), or from a CSV of Source, Storefront Game ID, Title and Ownership Status columns.
            </Text>
            {s && <Text size="xs">{s.audit > 0 ? `${count(s.audit)} audited games.` : 'Nothing audited yet.'}</Text>}
          </Stack>
          <Group gap="xs">
            <FileButton onChange={(f) => f && audit.mutate(f)} accept=".csv,text/csv">
              {(props) => (
                <Button {...props} size="xs" variant="default" loading={audit.isPending}>
                  Use your audit CSV
                </Button>
              )}
            </FileButton>
            {s && s.audit > 0 && (
              <Button size="xs" variant="subtle" color="red" leftSection={<IconTrash size={14} />} onClick={() => window.confirm('Remove the audit from your file? Answers you gave on single games stay.') && audit.mutate(null)}>
                Remove the file’s audit
              </Button>
            )}
          </Group>
        </Group>
        {s?.lastRead && (
          <Text size="xs" c="dimmed" mt="sm">
            Last reading {dateTime(s.lastRead.readAt, dateFormat)}: {s.lastRead.message}{' '}
            <Anchor size="xs" href="/system/tasks">
              Tasks
            </Anchor>
          </Text>
        )}
      </Card>
      )}
    </>
  );
}

/** A game's console copies as badges: "Nintendo Switch ×2 (1 sealed)". */
function ConsoleCopies({ consoles }: { consoles: { platform: string; platformKey: string; title: string; copies: number; sealed: number }[] }) {
  if (consoles.length === 0) return <Text size="xs" c="dimmed">—</Text>;
  return (
    <Group gap={4}>
      {consoles.map((c) => (
        <GameTitle key={c.platform} platformKey={c.platformKey} title={c.title} size="xs">
          <Badge size="sm" variant="outline" color={c.sealed > 0 ? 'squirrel' : 'gray'} style={{ textTransform: 'none', cursor: 'pointer' }}>
            {c.platform}
            {c.copies > 1 ? ` ×${c.copies}` : ''}
            {c.sealed > 0 ? ` (${c.sealed} sealed)` : ''}
          </Badge>
        </GameTitle>
      ))}
    </Group>
  );
}
