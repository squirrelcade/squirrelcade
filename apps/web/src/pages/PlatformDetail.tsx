import { Anchor, Badge, Button, Card, Group, Loader, Pagination, Stack, Table, Tabs, Text, TextInput, Tooltip } from '@mantine/core';
import { useDebouncedValue, useMediaQuery } from '@mantine/hooks';
import { IconCheck, IconEyeOff, IconLink, IconPlus, IconSearch, IconX } from '@tabler/icons-react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { api } from '../api';
import { RegionBadge } from '../Region';
import { RommLinks, type RommLink } from '../Romm';
import { SortableTh, type SortDirection } from '../components';
import { count, releaseDate } from '../format';
import { notifyError, useCanEdit, useFeature, usePageTitle, useSetting } from '../hooks';
import { ConsoleHistoryTab, Top100Tab } from './History';
import { AddGameModal, EntryMenu, LinkModal } from './CatalogActions';
import { CatalogSourceCard } from './CatalogSource';
import { ConsoleHead } from './ConsoleHead';
import { GameCover, GameTitle } from '../GameDrawer';
import { MATCH_METHODS, REJECTABLE, type MatchMethod } from '../choices';
import { PreferencePicker } from '../Preference';
import { Acorns, Reviews, type ReviewsOf } from '../Acorn';

type Status = 'missing' | 'review' | 'owned' | 'excluded' | 'unconfirmed' | 'upcoming' | 'extra';

interface Entry {
  id: number;
  title: string;
  format: string | null;
  releaseDate: string | null;
  targetStatus: string;
  notes: string | null;
  source: string;
  /** What shows it had a physical release: list (your list), user (added by hand), igdb; null for none. */
  evidence: string | null;
  coverId: string | null;
  /** IGDB's rating, beside its acorns (0.53.0). */
  reviews?: ReviewsOf;
  status: Status;
  /** The owned products that count as this game, with which release each is (region, PriceCharting's console name). */
  matches: { productId: string; title: string; method: MatchMethod; region: string | null; consoleLabel: string | null }[];
  suggestions: { productId: string; title: string; reason: string }[];
  rejected: { productId: string; title: string }[];
  wishlist: { score: number; priority: string; rank: number | null } | null;
  /** Your wishlist preference for it (Must Have... Do Not Recommend). */
  preference: string | null;
  /** The game's genres, from IGDB. */
  genres: string[];
  /** The owned game in the user's RomM, when it's there. */
  romm: RommLink | null;
  /** PC storefronts where the same game is owned for good (related, never counted). */
  pc?: string[];
}

interface Detail {
  platform: { key: string; name: string };
  counts: { targets: number; owned: number; missing: number; review: number; excluded: number; unconfirmed: number; upcoming: number; extra?: number };
  percent: number;
  /** The games and copies owned here per region and PriceCharting console name (Super Famicom, Super Nintendo...). */
  regions: { region: string; consoleLabel: string; games: number; copies: number }[];
  total: number;
  entries: Entry[];
  notInCatalog: { productId: string; title: string; copies: number; region: string | null; consoleLabel: string | null }[];
  ignored: { productId: string; title: string }[];
}


/** The columns the games table sorts by, and which way each sorts first (names A to Z, dates and acorns newest or most first). */
const SORTS = { title: 'asc', genre: 'asc', released: 'desc', score: 'desc', reviews: 'desc' } as const satisfies Record<string, SortDirection>;
type SortColumn = keyof typeof SORTS;

/** One console: completion, where its catalog comes from, and its games by status, with the answers the user can give about each. */
export function PlatformDetailPage() {
  // A viewer sees the console's catalog and games, not the buttons that change them.
  const canEdit = useCanEdit();
  const { key = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') ?? 'missing') as Status | 'unmatched' | 'top100' | 'history';
  // The Top 100 and History tabs don't list the catalog: its first game is enough for the counts above them.
  const listTab = tab === 'top100' || tab === 'history';
  const historyOn = useFeature('history');
  const available = useQuery({ queryKey: ['history', 'available'], queryFn: () => api<{ top100: string[]; history: string[] }>('/history'), enabled: historyOn, staleTime: 5 * 60_000 });
  const page = Number(params.get('page') ?? 1);
  // The sort lives in the address (?sort=score&dir=desc): click a heading, click again to reverse.
  const sortColumn: SortColumn = (params.get('sort') ?? '') in SORTS ? (params.get('sort') as SortColumn) : 'title';
  const sortDir: SortDirection = params.get('dir') === 'asc' || params.get('dir') === 'desc' ? (params.get('dir') as SortDirection) : SORTS[sortColumn];
  const sortBy = (column: SortColumn) =>
    setParams({ tab, sort: column, dir: column === sortColumn ? (sortDir === 'asc' ? 'desc' : 'asc') : SORTS[column] }, { replace: true });
  const heading = (column: SortColumn, label: string, ta?: 'right') => (
    <SortableTh label={label} active={sortColumn === column} direction={sortDir} onSort={() => sortBy(column)} ta={ta} />
  );
  // Other pages (a set's games, say) link here with ?q= to show one game.
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [q] = useDebouncedValue(search, 250);
  const pageSize = useSetting('interface.pageSize', 100);
  const dateFormat = useSetting('general.dateFormat', 'us');
  const appName = useSetting('general.instanceName', 'Squirrelcade') || 'Squirrelcade';
  // On a phone the format and release date go under the title and buttons wrap, so the table fits the screen.
  const narrow = useMediaQuery('(max-width: 48em)');
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState<string | null>(null);
  const [linking, setLinking] = useState<{ productId: string; title: string } | null>(null);

  const query = new URLSearchParams({ page: String(listTab ? 1 : page), pageSize: String(listTab ? 1 : pageSize) });
  if (tab !== 'unmatched') query.set('status', listTab ? 'missing' : tab);
  if (sortColumn !== 'title' || sortDir !== 'asc') {
    query.set('sort', sortColumn);
    query.set('dir', sortDir);
  }
  if (q) query.set('q', q);
  const detail = useQuery({
    queryKey: ['catalogs', key, query.toString()],
    queryFn: () => api<Detail>(`/catalogs/${key}?${query}`),
    placeholderData: keepPreviousData,
  });
  const decide = useMutation({
    mutationFn: (v: { entryId: number; productId: string; decision: 'confirmed' | 'rejected' | 'undo' }) =>
      v.decision === 'undo'
        ? api('/catalogs/decisions', { method: 'DELETE', json: { entryId: v.entryId, productId: v.productId } })
        : api('/catalogs/decisions', { method: 'POST', json: v }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['catalogs'] }),
    onError: (err) => notifyError(err),
  });
  const ignore = useMutation({
    mutationFn: (v: { productId: string; ignored: boolean }) =>
      v.ignored
        ? api(`/catalogs/${key}/ignored`, { method: 'POST', json: { productId: v.productId } })
        : api(`/catalogs/${key}/ignored/${encodeURIComponent(v.productId)}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['catalogs'] }),
    onError: (err) => notifyError(err),
  });

  function setTab(value: string | null) {
    setParams({ tab: value ?? 'missing' }, { replace: true });
  }

  const d = detail.data;
  usePageTitle(d?.platform.name ?? 'Platforms', appName);
  const hasTop100 = historyOn && Boolean(available.data?.top100.includes(key));
  // The owner can write a history for a console that has none.
  const hasHistory = historyOn && Boolean(available.data) && (available.data!.history.includes(key) || canEdit);
  if (detail.isError) return <Text c="red">{(detail.error as Error).message}</Text>;
  if (!d) return <Loader />;
  const anyCover = d.entries.some((e) => e.coverId);

  return (
    <>
      <ConsoleHead d={d} tab={tab} tiles={!listTab} canEdit={canEdit} onAdd={() => setAdding('')} />
      <AddGameModal platformKey={key} initialTitle={adding ?? ''} opened={adding !== null} onClose={() => setAdding(null)} />
      <LinkModal platformKey={key} product={linking} onClose={() => setLinking(null)} />
      {/* The catalog's own cards stay off the Top 100 and History tabs, so a phone reaches the list sooner. */}
      {canEdit && !listTab && <CatalogSourceCard platformKey={key} />}
      <Tabs value={tab} onChange={setTab} mb="sm">
        <Tabs.List>
          <Tabs.Tab value="missing">Missing</Tabs.Tab>
          <Tabs.Tab value="review">
            Needs review{' '}
            {d.counts.review > 0 && (
              <Badge size="xs" color="yellow" ml={4}>
                {d.counts.review}
              </Badge>
            )}
          </Tabs.Tab>
          <Tabs.Tab value="owned">Owned</Tabs.Tab>
          <Tabs.Tab value="excluded">Excluded</Tabs.Tab>
          {(d.counts.unconfirmed > 0 || tab === 'unconfirmed') && (
            <Tabs.Tab value="unconfirmed">
              Not confirmed physical{' '}
              <Badge size="xs" color="gray" ml={4}>
                {count(d.counts.unconfirmed)}
              </Badge>
            </Tabs.Tab>
          )}
          {(d.counts.upcoming > 0 || tab === 'upcoming') && (
            <Tabs.Tab value="upcoming">
              Upcoming{' '}
              <Badge size="xs" color="gray" ml={4}>
                {count(d.counts.upcoming)}
              </Badge>
            </Tabs.Tab>
          )}
          {((d.counts.extra ?? 0) > 0 || tab === 'extra') && (
            <Tabs.Tab value="extra">
              Other regions{' '}
              <Badge size="xs" color="gray" ml={4}>
                {count(d.counts.extra ?? 0)}
              </Badge>
            </Tabs.Tab>
          )}
          <Tabs.Tab value="unmatched">Not in catalog</Tabs.Tab>
          {(hasTop100 || tab === 'top100') && <Tabs.Tab value="top100">Top 100</Tabs.Tab>}
          {(hasHistory || tab === 'history') && <Tabs.Tab value="history">History</Tabs.Tab>}
        </Tabs.List>
      </Tabs>
      {tab === 'top100' ? (
        <Top100Tab platformKey={key} narrow={Boolean(narrow)} />
      ) : tab === 'history' ? (
        <ConsoleHistoryTab platformKey={key} />
      ) : (
      <>
      <Group mb="sm">
        <TextInput placeholder="Search" leftSection={<IconSearch size={16} />} value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={280} />
        {detail.isFetching && <Loader size="xs" />}
      </Group>

      {tab === 'unmatched' ? (
        <Stack gap={4}>
          <Text size="sm" c="dimmed" mb="xs">
            Games you own for this platform that match no catalog entry: compilations, special releases, or catalog names that differ. Missing
            catalog games that look like one of these show up under Needs review.
          </Text>
          <Table.ScrollContainer minWidth={narrow ? 0 : 560}>
            <Table striped verticalSpacing={6}>
              <Table.Tbody>
                {d.notInCatalog.map((p) => (
                  <Table.Tr key={p.productId}>
                    <Table.Td>
                      <Text size="sm">
                        {p.title} <RegionBadge region={p.region} consoleLabel={p.consoleLabel} platformKey={key} />
                        {p.copies > 1 && (
                          <Text span c="dimmed" size="xs">
                            {' '}
                            ({p.copies} {p.copies === 1 ? 'copy' : 'copies'})
                          </Text>
                        )}
                      </Text>
                    </Table.Td>
                    <Table.Td w={1}>
                      {canEdit && (
                      <Group gap={6} wrap={narrow ? 'wrap' : 'nowrap'}>
                        <Button size="compact-xs" variant="light" leftSection={<IconLink size={12} />} onClick={() => setLinking(p)}>
                          Counts as...
                        </Button>
                        <Button size="compact-xs" variant="default" leftSection={<IconPlus size={12} />} onClick={() => setAdding(p.title)}>
                          Add to catalog
                        </Button>
                        <Tooltip label="Not a catalog game (a demo, a bundle...): stop listing it here">
                          <Button size="compact-xs" variant="default" leftSection={<IconEyeOff size={12} />} onClick={() => ignore.mutate({ productId: p.productId, ignored: true })}>
                            Ignore
                          </Button>
                        </Tooltip>
                      </Group>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {d.notInCatalog.length === 0 && (
            <Text c="dimmed" ta="center" mt="md">
              Every game you own here is in the catalog.
            </Text>
          )}
          {d.ignored.length > 0 && (
            <Card withBorder mt="md">
              <Text fw={600} size="sm" mb={6}>
                Ignored ({d.ignored.length})
              </Text>
              <Stack gap={4}>
                {d.ignored.map((p) => (
                  <Group key={p.productId} gap={8}>
                    <Text size="sm">{p.title}</Text>
                    {canEdit && (
                      <Anchor size="xs" onClick={() => ignore.mutate({ productId: p.productId, ignored: false })}>
                        undo
                      </Anchor>
                    )}
                  </Group>
                ))}
              </Stack>
            </Card>
          )}
        </Stack>
      ) : (
        <>
          {tab === 'extra' && (
            <Text size="sm" c="dimmed" mb="xs" maw={760}>
              Other regions' physical releases (from IGDB) that this console plays, as it isn't region-locked (Settings &gt; Platforms &gt; Region-locked consoles). Each
              counts once you own a copy; until then it's neither missing nor recommended, so your percentages don't drop.
            </Text>
          )}
          {tab === 'review' && (
            <Text size="sm" c="dimmed" mb="xs" maw={760}>
              Questions only you can answer. A copy you own may be one of these games (Same game or Different), or a game was marked as maybe not an ordinary store
              release (It's a target puts it on this checklist, Not a target leaves it off). Until you answer, these games count as neither owned nor missing. Review
              has every console's questions in one place.
            </Text>
          )}
          <Table.ScrollContainer minWidth={narrow ? 0 : 640}>
            <Table striped verticalSpacing={6}>
              <Table.Thead>
                <Table.Tr>
                  {heading('title', 'Game')}
                  {(tab === 'owned' || tab === 'review') && <Table.Th>{tab === 'owned' ? 'Owned as' : 'Is it one of these?'}</Table.Th>}
                  {tab !== 'review' && tab !== 'owned' && !narrow && heading('genre', 'Genre')}
                  {tab !== 'review' && tab !== 'owned' && !narrow && heading('released', 'Released')}
                  {tab === 'missing' && heading('score', 'Acorns', 'right')}
                  {tab === 'missing' && !narrow && heading('reviews', 'Reviews', 'right')}
                  {tab !== 'owned' && !narrow && <Table.Th>Your preference</Table.Th>}
                  <Table.Th w={1} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {d.entries.map((e) => (
                  <Table.Tr key={e.id}>
                    <Table.Td>
                      <Group gap="sm" wrap="nowrap" align="flex-start">
                      <GameCover platformKey={key} title={e.title} id={e.coverId} placeholder={anyCover} />
                      <div>
                      <Text size="sm" fw={500}>
                        <GameTitle platformKey={key} title={e.title} fw={500} />
                        {(e.pc?.length ?? 0) > 0 && (
                          <Tooltip label={`You own it on PC (${e.pc!.join(', ')}); that doesn't count as owning it here`}>
                            <Badge size="xs" variant="light" color="cyan" ml={6} style={{ verticalAlign: 'middle' }}>
                              PC
                            </Badge>
                          </Tooltip>
                        )}
                      </Text>
                      <RommLinks link={e.romm} />
                      {tab !== 'review' && tab !== 'owned' && (e.format || (narrow && (e.releaseDate || e.genres.length > 0))) && (
                        <Text size="xs" c="dimmed">
                          {[e.format, narrow && e.genres.join(', '), narrow && e.releaseDate && releaseDate(e.releaseDate, dateFormat)].filter(Boolean).join(' · ')}
                        </Text>
                      )}
                      {e.notes && tab !== 'owned' && (
                        <Text size="xs" c="dimmed" lineClamp={2}>
                          {e.notes}
                        </Text>
                      )}
                      {narrow && e.status !== 'owned' && (
                        <Group mt={4}>
                          <PreferencePicker platformKey={key} title={e.title} value={e.preference} width={170} />
                        </Group>
                      )}
                      {e.rejected.map((r) => (
                        <Text key={r.productId} size="xs" c="dimmed">
                          Not this game: {r.title}.{' '}
                          {canEdit && (
                            <Anchor size="xs" onClick={() => decide.mutate({ entryId: e.id, productId: r.productId, decision: 'undo' })}>
                              undo
                            </Anchor>
                          )}
                        </Text>
                      ))}
                      </div>
                      </Group>
                    </Table.Td>
                    {tab === 'owned' && (
                      <Table.Td>
                        <Stack gap={2}>
                          {e.matches.map((m) => (
                            <Group key={m.productId} gap={6} wrap={narrow ? 'wrap' : 'nowrap'}>
                              <Text size="sm">{m.title}</Text>
                              <RegionBadge region={m.region} consoleLabel={m.consoleLabel} platformKey={key} />
                              <Badge size="xs" variant="light" miw="max-content" color={m.method === 'confirmed' ? 'forest' : 'gray'}>
                                {MATCH_METHODS[m.method]}
                              </Badge>
                              {canEdit && m.method === 'confirmed' && (
                                <Anchor size="xs" onClick={() => decide.mutate({ entryId: e.id, productId: m.productId, decision: 'undo' })}>
                                  undo
                                </Anchor>
                              )}
                              {canEdit && REJECTABLE.has(m.method) && (
                                <Tooltip label={m.method === 'variant' ? "This edition is a different product: don't count it as this game" : "This is a different game (another region's release, say): don't count it as this one"}>
                                  <Anchor size="xs" c="dimmed" onClick={() => decide.mutate({ entryId: e.id, productId: m.productId, decision: 'rejected' })}>
                                    not the same
                                  </Anchor>
                                </Tooltip>
                              )}
                            </Group>
                          ))}
                        </Stack>
                      </Table.Td>
                    )}
                    {tab === 'review' && (
                      <Table.Td>
                        {e.suggestions.length === 0 ? (
                          <Text size="sm" c="dimmed">
                            Marked for review in the catalog{e.targetStatus === 'review' ? '' : ' (conditional mapping)'}.
                          </Text>
                        ) : (
                          <Stack gap={4}>
                            {e.suggestions.map((s) => (
                              <Group key={s.productId} gap={6} wrap={narrow ? 'wrap' : 'nowrap'}>
                                <Tooltip label={s.reason}>
                                  <Text size="sm">{s.title}</Text>
                                </Tooltip>
                                {canEdit && (
                                  <>
                                    <Button size="compact-xs" color="green" variant="light" leftSection={<IconCheck size={12} />} onClick={() => decide.mutate({ entryId: e.id, productId: s.productId, decision: 'confirmed' })}>
                                      Same game
                                    </Button>
                                    <Button size="compact-xs" variant="default" leftSection={<IconX size={12} />} onClick={() => decide.mutate({ entryId: e.id, productId: s.productId, decision: 'rejected' })}>
                                      Different
                                    </Button>
                                  </>
                                )}
                              </Group>
                            ))}
                          </Stack>
                        )}
                      </Table.Td>
                    )}
                    {tab !== 'review' && tab !== 'owned' && !narrow && (
                      <>
                        <Table.Td>
                          {e.genres.length > 0 ? (
                            <Text size="sm">{e.genres.join(', ')}</Text>
                          ) : (
                            <Text size="sm" c="dimmed">
                              —
                            </Text>
                          )}
                        </Table.Td>
                        <Table.Td>{releaseDate(e.releaseDate, dateFormat)}</Table.Td>
                      </>
                    )}
                    {tab === 'missing' && (
                      <Table.Td ta="right">
                        {e.wishlist ? (
                          <Tooltip label={`${e.wishlist.priority} priority${e.wishlist.rank ? `, #${e.wishlist.rank} in the top picks` : ''}`}>
                            <Text size="sm" span fw={e.wishlist.rank ? 600 : undefined}>
                              <Acorns n={e.wishlist.score} />
                            </Text>
                          </Tooltip>
                        ) : (
                          '—'
                        )}
                      </Table.Td>
                    )}
                    {tab === 'missing' && !narrow && (
                      <Table.Td ta="right">
                        <Text size="sm" span c={e.reviews ? undefined : 'dimmed'}>
                          {e.reviews ? <Reviews r={e.reviews} /> : '—'}
                        </Text>
                      </Table.Td>
                    )}
                    {tab !== 'owned' && !narrow && (
                      <Table.Td>{e.status !== 'owned' && <PreferencePicker platformKey={key} title={e.title} value={e.preference} width={170} />}</Table.Td>
                    )}
                    <Table.Td>
                      <Group gap={4} wrap="nowrap">
                        {canEdit && e.status === 'unconfirmed' && <ConfirmPhysical id={e.id} />}
                        {canEdit && <EntryMenu entry={e} />}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </>
      )}
      {tab !== 'unmatched' && d.entries.length === 0 && (
        <Text c="dimmed" ta="center" mt="md">
          Nothing here.
        </Text>
      )}
      {tab !== 'unmatched' && d.total > pageSize && (
        <Group justify="center" mt="md">
          <Pagination total={Math.ceil(d.total / pageSize)} value={page} onChange={(p) => setParams({ tab, page: String(p) }, { replace: true })} />
        </Group>
      )}
      </>
      )}
    </>
  );
}

/** "It's physical": the user's confirmation makes an unconfirmed game count. */
function ConfirmPhysical({ id }: { id: number }) {
  const queryClient = useQueryClient();
  const confirm = useMutation({
    mutationFn: () => api(`/catalogs/entries/${id}`, { method: 'PATCH', json: { targetStatus: 'required' } }),
    onSuccess: () => Promise.all([queryClient.invalidateQueries({ queryKey: ['catalogs'] }), queryClient.invalidateQueries({ queryKey: ['wishlist'] })]),
    onError: (err) => notifyError(err),
  });
  return (
    <Tooltip label="It had a physical release: count it">
      <Button size="compact-xs" variant="light" leftSection={<IconCheck size={12} />} loading={confirm.isPending} onClick={() => confirm.mutate()}>
        It's physical
      </Button>
    </Tooltip>
  );
}
