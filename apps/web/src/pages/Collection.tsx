import { COMPLETENESS_LABELS, COMPLETENESS_SHORT, igdbCoverUrl, PLAY_STATUSES, REGION_LABELS, type Completeness, type Region, type TestKind, type TestResult } from '@squirrelcade/core';
import { Anchor, AspectRatio, Badge, Box, Button, Center, Group, Image, Loader, Menu, Pagination, SegmentedControl, Select, SimpleGrid, Stack, Switch, Table, Text, TextInput, Tooltip } from '@mantine/core';
import { useDebouncedValue, useMediaQuery } from '@mantine/hooks';
import { IconCamera, IconChevronDown, IconDownload, IconFileSpreadsheet, IconLayoutGrid, IconList, IconMapPin, IconNotes, IconPlus, IconSearch, IconUserShare } from '@tabler/icons-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../api';
import { RegionBadge } from '../Region';
import { RommLinks, type RommLink } from '../Romm';
import { Cover, PageHeader, StatCard } from '../components';
import { PriceMovers } from './PriceMovers';
import { Spending } from './Spending';
import { ValueHistory } from './ValueHistory';
import { count, date, money, wholeMoney } from '../format';
import { useCanEdit, useSetting } from '../hooks';
import { GameCover, GameTitle, useOpenGame } from '../GameDrawer';
import { useGameNotes } from '../notes';
import { PlayBadge, type Play } from '../Playing';
import { TestBadge } from '../CopyDetails';

/** The collection's totals and each platform's (GET /api/v1/collection/summary). */
export interface CollectionSummary {
  currentImport: { id: number; fileName: string; appliedAt: string | null } | null;
  totals: {
    games: number;
    copies: number;
    valueCents: number;
    costCents: number;
    sealed: number;
    platforms: number;
    eligiblePlatforms: number;
    /** Games you have more than one copy of (the same item), and the copies beyond one of each. */
    repeatGames?: number;
    repeatCopies?: number;
  };
  platforms: { platformId: number; key: string; name: string; games: number; copies: number; valueCents: number; costCents: number; sealed: number; eligible: boolean }[];
}

interface Item {
  id: number;
  productId: string;
  title: string;
  platform: string | null;
  platformKey: string | null;
  region: Region;
  /** PriceCharting's console name for the copy, such as Super Famicom. */
  consoleLabel: string;
  completeness: Completeness;
  includeString: string;
  conditionString: string;
  sealed: boolean;
  quantity: number;
  valueCents: number | null;
  costCents: number | null;
  dateEntered: string | null;
  notes: string;
  coverId: string | null;
  romm: RommLink | null;
  copyKey: string;
  /** Whose files keep it up to date (PriceCharting's export, a spreadsheet, or none: Squirrelcade's own). */
  source: 'pricecharting' | 'spreadsheet' | 'squirrelcade';
  /** Since when its file no longer has it: it waits on Review. */
  missingSince: string | null;
  /** What the owner played of the game (null when it isn't shown). */
  play: Play | null;
  /** The owner's details on the copy (null when they aren't shown). */
  details: { location: string | null; tags: string[]; sale: 'sale' | 'trade' | null; lentTo: string[]; photos: number; tested: { kind: TestKind; result: TestResult; testedAt: string } | null } | null;
  /** The owner's estimate of a price they don't know (null unless set, or when prices paid aren't shown). */
  estimatedCents: number | null;
}

/** The filters by what's kept beside the collection, as the page's parameters. */
const EXTRA_FILTERS = ['play', 'location', 'tag', 'lent', 'sale', 'digital'];

/** A copy's play status and details in a line of small badges. */
function ItemExtras({ item }: { item: Item }) {
  const d = item.details;
  const dateFormat = useSetting('general.dateFormat', 'us');
  const badges = [
    item.missingSince ? (
      <Badge key="missing" size="xs" variant="light" color="yellow" component={Link} to="/review?tab=copies" style={{ textTransform: 'none', cursor: 'pointer' }}>
        {item.source === 'spreadsheet' ? 'Not in your spreadsheet' : "Not in PriceCharting's export"}: on Review
      </Badge>
    ) : null,
    item.play && (item.play.status || item.play.rating) ? <PlayBadge key="play" play={item.play} size="xs" /> : null,
    d?.location ? (
      <Badge key="where" size="xs" variant="outline" color="gray" leftSection={<IconMapPin size={10} />} style={{ textTransform: 'none' }}>
        {d.location}
      </Badge>
    ) : null,
    ...(d?.tags ?? []).map((t) => (
      <Badge key={`tag:${t}`} size="xs" variant="light" color="gray" style={{ textTransform: 'none' }}>
        {t}
      </Badge>
    )),
    d?.tested ? <TestBadge key="tested" kind={d.tested.kind} result={d.tested.result} testedAt={d.tested.testedAt} dateFormat={dateFormat} /> : null,
    d?.sale ? (
      <Badge key="sale" size="xs" variant="light" color="orange" style={{ textTransform: 'none' }}>
        {d.sale === 'sale' ? 'For sale' : 'For trade'}
      </Badge>
    ) : null,
    d && d.lentTo.length > 0 ? (
      <Badge key="lent" size="xs" variant="light" color="blue" leftSection={<IconUserShare size={10} />} style={{ textTransform: 'none' }}>
        {d.lentTo.join(', ')}
      </Badge>
    ) : null,
    d && d.photos > 0 ? (
      <Badge key="photos" size="xs" variant="transparent" color="gray" leftSection={<IconCamera size={11} />} aria-label={`${d.photos} photos`}>
        {d.photos}
      </Badge>
    ) : null,
  ].filter(Boolean);
  if (badges.length === 0) return null;
  return (
    <Group gap={4} mt={2}>
      {badges}
    </Group>
  );
}

const COMPLETENESS_COLORS: Partial<Record<Completeness, string>> = {
  sealed: 'squirrel',
  complete: 'green',
  'item-box': 'teal',
  'item-manual': 'cyan',
  loose: 'gray',
  graded: 'yellow',
};

/** The collection's totals, shared by the pages that show them. */
export function useCollectionSummary() {
  return useQuery({ queryKey: ['collection', 'summary'], queryFn: () => api<CollectionSummary>('/collection/summary') });
}

/** The collection: every owned copy with its value, filters by platform, region and completeness, search and sorting. */
/** Where this browser keeps the Collection page's last view (list or grid). */
const VIEW = 'squirrelcade:collection-view';

function rememberedView(): 'list' | 'grid' {
  try {
    return localStorage.getItem(VIEW) === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';
  }
}

/**
 * A copy in the grid view: its cover art (or its title on a plain tile when there's none) and its title under it.
 * The cover opens the game's drawer for the mouse and touch; the title is the way in for keyboards and screen readers.
 */
function CoverTile({ item }: { item: Item }) {
  const open = useOpenGame();
  const covers = useSetting('interface.showCoverArt', true);
  const art = covers && item.coverId;
  return (
    <Stack gap={4}>
      <Box
        aria-hidden="true"
        style={{ cursor: item.platformKey ? 'pointer' : undefined }}
        onClick={() => item.platformKey && open(item.platformKey, item.title)}
      >
        <AspectRatio ratio={3 / 4}>
          {art ? (
            <Image src={igdbCoverUrl(item.coverId!, 'cover_big')} radius="sm" alt="" loading="lazy" fit="cover" />
          ) : (
            <Center p={6} style={{ borderRadius: 'var(--mantine-radius-sm)', border: '1px solid var(--mantine-color-default-border)' }}>
              <Text size="xs" ta="center" lineClamp={5}>
                {item.title}
              </Text>
            </Center>
          )}
        </AspectRatio>
      </Box>
      <Text size="xs" lineClamp={2} component="div">
        {item.platformKey ? <GameTitle platformKey={item.platformKey} title={item.title} size="xs" /> : item.title}
      </Text>
    </Stack>
  );
}

export function CollectionPage() {
  const [params, setParams] = useSearchParams();
  // The list or the grid: the page's parameter, else what this browser used last.
  const view = params.get('view') === 'grid' || (params.get('view') === null && rememberedView() === 'grid') ? 'grid' : 'list';
  const [search, setSearch] = useState(params.get('q') ?? '');
  const { notes } = useGameNotes();
  // A viewer sees the collection, not the Update button; and what the owner paid only when it's shared with them.
  const canEdit = useCanEdit();
  const seesPaid = useSetting('security.viewersSeePaid', false) || canEdit;
  const seesPlay = useSetting('security.viewersSeePlay', true) || canEdit;
  const seesDetails = useSetting('security.viewersSeeCopyDetails', false) || canEdit;
  const vocabulary = useQuery({ queryKey: ['tags'], queryFn: () => api<{ tags: { name: string; copies: number }[]; locations: { name: string; copies: number }[] }>('/tags'), enabled: seesDetails });
  const [debounced] = useDebouncedValue(search, 250);
  const platform = params.get('platform') ?? '';
  const region = params.get('region') ?? '';
  const completeness = params.get('completeness') ?? '';
  const duplicates = params.get('duplicates') === '1';
  // The download takes the filters the table shows (the page and sort don't matter to it).
  const exportQuery = new URLSearchParams([...params].filter(([k]) => ['platform', 'region', 'completeness', 'q', 'duplicates', ...EXTRA_FILTERS].includes(k)));
  const exportHref = `/api/v1/collection/export${exportQuery.size > 0 ? `?${exportQuery}` : ''}`;
  const sort = params.get('sort') ?? 'title';
  const page = Number(params.get('page') ?? 1);
  const pageSize = useSetting('interface.pageSize', 100);
  const currency = useSetting('general.currency', 'USD');
  const dateFormat = useSetting('general.dateFormat', 'us');
  const density = useSetting('interface.tableDensity', 'compact');
  const summary = useCollectionSummary();
  // On a phone the table keeps title and value; platform and condition go under the title.
  const narrow = useMediaQuery('(max-width: 48em)');

  const query = new URLSearchParams({ sort, page: String(page), pageSize: String(pageSize) });
  if (platform) query.set('platform', platform);
  if (region) query.set('region', region);
  if (completeness) query.set('completeness', completeness);
  if (duplicates) query.set('duplicates', '1');
  if (debounced) query.set('q', debounced);
  for (const k of EXTRA_FILTERS) if (params.get(k)) query.set(k, params.get(k)!);
  // Lent out, for sale or trade, and a digital copy claimed with the disc share one choice.
  const standing = params.get('lent') === '1' ? 'lent' : params.get('digital') ? `digital-${params.get('digital')}` : (params.get('sale') ?? '');
  const items = useQuery({
    queryKey: ['collection', 'items', query.toString()],
    queryFn: () => api<{ total: number; items: Item[] }>(`/collection/items?${query}`),
    placeholderData: keepPreviousData,
  });

  function set(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  }

  const totals = summary.data?.totals;
  // Empty only with nothing at all: games added by hand (Add a game) show without any export (0.60.0).
  if (summary.data && summary.data.currentImport === null && (summary.data.totals?.copies ?? 0) === 0) {
    return (
      <>
        <PageHeader help="collection" title="Stash" />
        <Stack align="center" mt="xl" gap="sm">
          <Text size="lg">Your collection is empty.</Text>
          <Text c="dimmed" size="sm" ta="center" maw={480}>
            Add your games one at a time, or bring them all in at once from an export: PriceCharting's (it arrives as collection.zip), CLZ Games', GAMEYE's, VGCollect's, or a spreadsheet of
            your own with a Title and a Console column.
          </Text>
          {canEdit && (
            <Group gap="xs">
              <Button component={Link} to="/collection/add" leftSection={<IconPlus size={16} />}>
                Add a game
              </Button>
              <Button component={Link} to="/updates" variant="default">
                Upload an export
              </Button>
            </Group>
          )}
        </Stack>
      </>
    );
  }

  return (
    <>
      <PageHeader help="collection"
        title="Stash"
        description={summary.data?.currentImport ? `From ${summary.data.currentImport.fileName}, updated ${date(summary.data.currentImport.appliedAt, dateFormat)}` : undefined}
        actions={
          <Group gap="xs">
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <Button variant="default" leftSection={<IconDownload size={16} />} rightSection={<IconChevronDown size={14} />}>
                  Download
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item component="a" href={exportHref} leftSection={<IconDownload size={16} />}>
                  What's shown here (CSV)
                </Menu.Item>
                <Menu.Item component="a" href="/api/v1/export/workbook" leftSection={<IconFileSpreadsheet size={16} />}>
                  Everything (Excel workbook)
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
            {notes.length > 0 && (
              <Button variant="default" component={Link} to="/notes" leftSection={<IconNotes size={16} />}>
                Your notes ({count(notes.length)})
              </Button>
            )}
            {canEdit && (
              <Button variant="default" component={Link} to="/collection/add" leftSection={<IconPlus size={16} />}>
                Add a game
              </Button>
            )}
            {canEdit && (
              <Button variant="light" component={Link} to="/updates">
                Update
              </Button>
            )}
          </Group>
        }
      />
      {totals && (
        <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }} mb="md">
          <StatCard label="Unique games" value={count(totals.games)} hint="Each game once, however many copies" />
          <StatCard
            label="Copies"
            value={count(totals.copies)}
            hint={
              // Duplicates: each game's copies beyond its first (the same item twice or more); the games still count once.
              (totals.repeatCopies ?? 0) > 0 ? (
                <Anchor component={Link} to="/collection/copies?view=repeats" size="xs" c="dimmed" underline="always">
                  {count(totals.repeatCopies ?? 0)} duplicate{totals.repeatCopies === 1 ? '' : 's'}
                </Anchor>
              ) : (
                'Every copy you have'
              )
            }
          />
          {/* Values come from PriceCharting's exports; without one, they aren't known yet (0.60.0). */}
          <StatCard
            label="Value"
            value={summary.data?.currentImport ? wholeMoney(totals.valueCents, currency) : '—'}
            hint={
              summary.data?.currentImport ? (
                <>
                  From{' '}
                  <Anchor href="https://www.pricecharting.com" target="_blank" rel="noreferrer" size="xs" inherit>
                    PriceCharting
                  </Anchor>
                  , at export
                </>
              ) : (
                'From a PriceCharting export, when you have one'
              )
            }
          />
          {seesPaid && <StatCard label="Paid" value={wholeMoney(totals.costCents, currency)} hint="Where recorded" />}
          <StatCard label="Sealed" value={count(totals.sealed)} />
          <StatCard label="Platforms" value={count(totals.platforms)} hint={`${totals.eligiblePlatforms} tracked`} />
        </SimpleGrid>
      )}
      <ValueHistory currency={currency} dateFormat={dateFormat} />
      {seesPaid && <Spending currency={currency} />}
      <PriceMovers currency={currency} dateFormat={dateFormat} />
      <Group mb="sm" gap="sm" wrap="wrap">
        <TextInput
          placeholder="Search titles"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => {
            setSearch(e.currentTarget.value);
            set('q', e.currentTarget.value);
          }}
          w={260}
        />
        <Select
          aria-label="Platform"
          placeholder="All platforms"
          data={(summary.data?.platforms ?? []).map((p) => ({ value: p.key, label: `${p.name} (${p.games})` }))}
          value={platform || null}
          onChange={(v) => set('platform', v ?? '')}
          clearable
          searchable
          w={240}
        />
        <Select
          aria-label="Region"
          placeholder="Any region"
          data={Object.entries(REGION_LABELS).map(([value, label]) => ({ value, label }))}
          value={region || null}
          onChange={(v) => set('region', v ?? '')}
          clearable
          w={170}
        />
        <Select
          aria-label="Condition"
          placeholder="Any condition"
          data={Object.entries(COMPLETENESS_LABELS).map(([value, label]) => ({ value, label }))}
          value={completeness || null}
          onChange={(v) => set('completeness', v ?? '')}
          clearable
          w={180}
        />
        {seesPlay && (
          <Select
            aria-label="Played"
            placeholder="Played or not"
            data={[{ value: 'backlog', label: 'Not played yet (your backlog)' }, ...PLAY_STATUSES.filter((x) => x.value !== 'backlog').map((x) => ({ value: x.value, label: x.label })), { value: 'unmarked', label: 'Not marked' }]}
            value={params.get('play')}
            onChange={(v) => set('play', v ?? '')}
            clearable
            w={200}
          />
        )}
        {seesDetails && (vocabulary.data?.locations.length ?? 0) > 0 && (
          <Select
            aria-label="Where it is"
            placeholder="Anywhere"
            data={(vocabulary.data?.locations ?? []).map((l) => ({ value: l.name, label: `${l.name} (${l.copies})` }))}
            value={params.get('location')}
            onChange={(v) => set('location', v ?? '')}
            clearable
            searchable
            w={180}
          />
        )}
        {seesDetails && (vocabulary.data?.tags.length ?? 0) > 0 && (
          <Select
            aria-label="Tag"
            placeholder="Any tag"
            data={(vocabulary.data?.tags ?? []).map((t) => ({ value: t.name, label: `${t.name} (${t.copies})` }))}
            value={params.get('tag')}
            onChange={(v) => set('tag', v ?? '')}
            clearable
            searchable
            w={160}
          />
        )}
        {seesDetails && (
          <Select
            aria-label="Lent, for sale or its digital copy"
            placeholder="Lent, sale, digital"
            data={[
              { value: 'lent', label: 'Lent out' },
              { value: 'any', label: 'For sale or trade' },
              { value: 'sale', label: 'For sale' },
              { value: 'trade', label: 'For trade' },
              { value: 'digital-claimed', label: 'Digital copy claimed' },
              { value: 'digital-unclaimed', label: 'Digital copy not claimed yet' },
            ]}
            value={standing || null}
            onChange={(v) => {
              const next = new URLSearchParams(params);
              next.delete('lent');
              next.delete('sale');
              next.delete('digital');
              next.delete('page');
              if (v === 'lent') next.set('lent', '1');
              else if (v?.startsWith('digital-')) next.set('digital', v.slice('digital-'.length));
              else if (v) next.set('sale', v);
              setParams(next, { replace: true });
            }}
            clearable
            w={190}
            comboboxProps={{ width: 240 }}
          />
        )}
        <Switch label="Owned more than once" checked={duplicates} onChange={(e) => set('duplicates', e.currentTarget.checked ? '1' : '')} />
        <Select
          aria-label="Sort"
          data={[
            { value: 'title', label: 'Sort by title' },
            { value: 'platform', label: 'Sort by platform' },
            { value: 'value', label: 'Sort by value' },
            { value: 'gain', label: 'Sort by gain (value − paid)' },
            { value: 'added', label: 'Recently added' },
          ]}
          value={sort}
          onChange={(v) => set('sort', v ?? 'title')}
          allowDeselect={false}
          w={170}
        />
        <SegmentedControl
          size="xs"
          aria-label="View"
          value={view}
          onChange={(v) => {
            try {
              localStorage.setItem(VIEW, v);
            } catch {
              // Storage can be off: the page's parameter still holds it.
            }
            const next = new URLSearchParams(params);
            next.set('view', v);
            setParams(next, { replace: true });
          }}
          data={[
            {
              value: 'list',
              label: (
                <Group gap={4} wrap="nowrap">
                  <IconList size={14} aria-hidden="true" />
                  <span>List</span>
                </Group>
              ),
            },
            {
              value: 'grid',
              label: (
                <Group gap={4} wrap="nowrap">
                  <IconLayoutGrid size={14} aria-hidden="true" />
                  <span>Grid</span>
                </Group>
              ),
            },
          ]}
        />
        {items.isFetching && <Loader size="xs" />}
      </Group>
      {view === 'grid' ? (
        <SimpleGrid cols={{ base: 3, xs: 4, sm: 5, md: 6, lg: 8 }} spacing="sm" verticalSpacing="md">
          {items.data?.items.map((item) => <CoverTile key={item.id} item={item} />)}
        </SimpleGrid>
      ) : (
      <Table.ScrollContainer minWidth={narrow ? 0 : 760}>
        <Table striped highlightOnHover verticalSpacing={density === 'compact' ? 4 : 'sm'}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Title</Table.Th>
              {!narrow && <Table.Th>Platform</Table.Th>}
              {!narrow && <Table.Th>Condition</Table.Th>}
              <Table.Th ta="right">Value</Table.Th>
              {!narrow && seesPaid && <Table.Th ta="right">Paid</Table.Th>}
              {!narrow && <Table.Th>Added</Table.Th>}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.data?.items.map((item, _i, all) => {
              const platformLink = (
                <Anchor size={narrow ? 'xs' : 'sm'} component={Link} to={`/collection?platform=${item.platformKey ?? ''}`}>
                  {item.platform ?? '—'}
                </Anchor>
              );
              const regionBadge = <RegionBadge region={item.region} consoleLabel={item.consoleLabel} platformKey={item.platformKey} />;
              const conditionBadge = (
                <Tooltip label={`${COMPLETENESS_LABELS[item.completeness]}${item.includeString ? ` (${item.includeString})` : ''}${item.conditionString ? `, ${item.conditionString}` : ''}`}>
                  <Badge size={narrow ? 'xs' : 'sm'} variant="light" color={COMPLETENESS_COLORS[item.completeness] ?? 'gray'} miw="max-content">
                    {COMPLETENESS_SHORT[item.completeness]}
                  </Badge>
                </Tooltip>
              );
              return (
                <Table.Tr key={item.id}>
                  <Table.Td>
                    <Group gap="sm" wrap="nowrap" align="flex-start">
                      {item.platformKey ? (
                        <GameCover platformKey={item.platformKey} title={item.title} id={item.coverId} placeholder={all.some((x) => x.coverId)} />
                      ) : (
                        <Cover id={item.coverId} placeholder={all.some((x) => x.coverId)} />
                      )}
                      <div>
                        {item.platformKey ? (
                          <GameTitle platformKey={item.platformKey} title={item.title} fw={500} />
                        ) : (
                          <Text size="sm" fw={500}>
                            {item.title}
                          </Text>
                        )}
                        <RommLinks link={item.romm} />
                        {narrow && (
                          <Group gap={6} mt={2}>
                            {platformLink}
                            {regionBadge}
                            {conditionBadge}
                          </Group>
                        )}
                        {item.notes && (
                          <Text size="xs" c="dimmed" lineClamp={1}>
                            {item.notes}
                          </Text>
                        )}
                        <ItemExtras item={item} />
                      </div>
                    </Group>
                  </Table.Td>
                  {!narrow && (
                    <Table.Td>
                      <Group gap={6} wrap="nowrap">
                        {platformLink}
                        {regionBadge}
                      </Group>
                    </Table.Td>
                  )}
                  {!narrow && <Table.Td>{conditionBadge}</Table.Td>}
                  <Table.Td ta="right">{money(item.valueCents, currency)}</Table.Td>
                  {!narrow && seesPaid && (
                    <Table.Td ta="right">
                      {item.costCents ? (
                        money(item.costCents, currency)
                      ) : item.estimatedCents !== null ? (
                        <Tooltip label="Your estimate of what it cost: never a price paid, never sent anywhere">
                          <Text span size="sm" c="dimmed" fs="italic">
                            ≈{money(item.estimatedCents, currency)}
                          </Text>
                        </Tooltip>
                      ) : (
                        '—'
                      )}
                    </Table.Td>
                  )}
                  {!narrow && <Table.Td>{date(item.dateEntered, dateFormat)}</Table.Td>}
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      )}
      {items.data && items.data.items.length === 0 && (
        <Text c="dimmed" ta="center" mt="md">
          Nothing matches these filters.
        </Text>
      )}
      {items.data && items.data.total > pageSize && (
        <Group justify="center" mt="md">
          <Pagination total={Math.ceil(items.data.total / pageSize)} value={page} onChange={(p) => set('page', String(p))} />
        </Group>
      )}
      {items.data && (
        <Text size="xs" c="dimmed" ta="center" mt="xs">
          {count(items.data.total)} rows
        </Text>
      )}
    </>
  );
}
