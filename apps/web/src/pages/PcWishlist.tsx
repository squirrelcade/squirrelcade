import { ActionIcon, Anchor, Badge, Button, Card, Group, Loader, Menu, SegmentedControl, Select, Stack, Table, Text, TextInput, Tooltip } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconChevronDown, IconChevronRight, IconClock, IconDownload, IconEyeOff, IconRefresh, IconSearch, IconTag } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../api';
import { Cover, PageHeader } from '../components';
import { count, dateTime, money } from '../format';
import { notifyError, notifySuccess, useCanEdit, useSetting } from '../hooks';
import { monthsFromNow, SNOOZES } from '../choices';
import { Acorns } from '../Acorn';

/** A game on the PC wishlist (GET /api/v1/pc/wishlist). */
export interface PcEntry {
  key: string;
  title: string;
  igdbId: number;
  rank: number;
  score: number;
  priority: 'High' | 'Medium' | 'Low';
  components: { label: string; points: number }[];
  details: { genres?: string[]; genre?: string; style?: string; franchise?: string };
  released?: string | null;
  coverId?: string | null;
  steamAppId?: number | null;
  steam?: { percent: number; total: number; summary: string } | null;
  sources: string[];
  preference?: string;
  /** IsThereAnyDeal's prices, with PC game prices on (null before they're read). */
  price?: PcPrice | null;
}

export interface PcPrice {
  currentCents: number | null;
  regularCents: number | null;
  cut: number | null;
  shop: string | null;
  url: string | null;
  lowCents: number | null;
  currency: string | null;
  atLow: boolean;
  missing: boolean;
  fetchedAt: string;
  /** Where the price comes from (IsThereAnyDeal unless it says GG.deals). */
  source?: 'itad' | 'ggdeals';
  /** GG.deals' lowest key shop price now. */
  keyshopCents?: number | null;
}

/** A game's best price now (a link to the store), how much off, and its lowest ever. */
export function PriceCell({ price }: { price: PcPrice | null | undefined }) {
  if (!price) {
    return (
      <Text size="xs" c="dimmed">
        Not read yet
      </Text>
    );
  }
  if (price.missing || price.currentCents === null) {
    return (
      <Text size="xs" c="dimmed">
        {price.missing ? 'Not on IsThereAnyDeal' : 'No store sells it'}
      </Text>
    );
  }
  const currency = price.currency ?? 'USD';
  return (
    <Stack gap={0} align="flex-end">
      <Group gap={4} wrap="nowrap">
        {price.atLow && ((price.cut ?? 0) > 0 || price.source === 'ggdeals') && (
          <Badge size="xs" color="teal" variant="light" leftSection={<IconTag size={10} />} style={{ textTransform: 'none' }}>
            Lowest ever
          </Badge>
        )}
        {price.url ? (
          <Anchor href={price.url} target="_blank" rel="noreferrer" size="sm" fw={500}>
            {money(price.currentCents, currency)}
          </Anchor>
        ) : (
          <Text size="sm">{money(price.currentCents, currency)}</Text>
        )}
      </Group>
      <Text size="xs" c="dimmed">
        {[price.shop, (price.cut ?? 0) > 0 ? `${price.cut}% off` : null, price.lowCents !== null ? `low ${money(price.lowCents, currency)}` : null].filter(Boolean).join(' · ')}
      </Text>
      {/* GG.deals also has key shops' prices; its data is credited with a link (its terms). */}
      {price.source === 'ggdeals' && (price.keyshopCents ?? null) !== null && (
        <Text size="xs" c="dimmed">
          key shops {money(price.keyshopCents!, currency)}, by{' '}
          <Anchor href={price.url ?? 'https://gg.deals'} target="_blank" rel="noreferrer" size="xs" c="dimmed">
            GG.deals
          </Anchor>
        </Text>
      )}
    </Stack>
  );
}

export interface PcWishlist {
  generatedAt: string;
  found: number;
  searchedAt: string | null;
  owned: number;
  hidden: number;
  items: PcEntry[];
  /** PC game prices are on (Settings > Features). */
  pricesOn?: boolean;
}

const PRIORITY_COLORS = { High: 'green', Medium: 'yellow', Low: 'gray' } as const;

/**
 * The PC wishlist: PC games worth buying, found through IGDB (the genres you score highest, the series
 * you collect, the PC versions of console games you keep sealed) and ranked on the console wishlist's
 * scale, every point explained. Games you own for good on PC never appear.
 */
export function PcWishlistPage() {
  // A viewer sees the PC wishlist, not the buttons that change it.
  const canEdit = useCanEdit();
  const queryClient = useQueryClient();
  const narrow = useMediaQuery('(max-width: 48em)');
  const dateFormat = useSetting('general.dateFormat', 'us');
  const preferences = useSetting('wishlist.preferencePoints', {} as Record<string, number>);
  const [open, setOpen] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  // "PC deals": the wishlist's games on sale now (with PC game prices on).
  const [params, setParams] = useSearchParams();
  const list = useQuery({ queryKey: ['pc', 'wishlist'], queryFn: () => api<PcWishlist>('/pc/wishlist') });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['pc', 'wishlist'] });
  const discover = useMutation({
    mutationFn: () => api('/pc/wishlist/discover', { method: 'POST' }),
    onSuccess: () => {
      notifySuccess('Looking for PC games on IGDB (and Steam’s reviews); this takes a few minutes.', 'Searching');
      for (const wait of [30_000, 120_000, 300_000]) setTimeout(() => void refresh(), wait);
    },
    onError: (err) => notifyError(err),
  });
  const readPrices = useMutation({
    mutationFn: () => api('/pc/prices/refresh', { method: 'POST' }),
    onSuccess: () => {
      notifySuccess('Reading prices from IsThereAnyDeal; this takes a minute or two.', 'Checking prices');
      for (const wait of [30_000, 90_000, 180_000]) setTimeout(() => void refresh(), wait);
    },
    onError: (err) => notifyError(err),
  });
  const control = useMutation({
    mutationFn: ({ key, change }: { key: string; change: Record<string, string | null> }) => api(`/pc/wishlist/${encodeURIComponent(key)}`, { method: 'PUT', json: change }),
    onSuccess: () => void refresh(),
    onError: (err) => notifyError(err),
  });

  const data = list.data;
  const deals = params.get('view') === 'deals' && Boolean(data?.pricesOn);
  const onSale = (e: PcEntry) => Boolean(e.price && !e.price.missing && e.price.currentCents !== null && (e.price.cut ?? 0) > 0);
  const q = search.trim().toLowerCase();
  const items = (data?.items ?? []).filter((e) => (!deals || onSale(e)) && (!q || e.title.toLowerCase().includes(q) || (e.details.genres ?? []).some((g) => g.toLowerCase().includes(q))));

  return (
    <>
      <PageHeader help="pc-library"
        title={deals ? 'PC deals' : 'PC wishlist'}
        description={
          data
            ? deals
              ? `${count(data.items.filter(onSale).length)} games on your PC wishlist are on sale now, the ones you want most first`
              : `${count(data.items.length)} PC games worth buying, from ${count(data.found)} found${data.searchedAt ? ` (searched ${dateTime(data.searchedAt, dateFormat)})` : ''}; ${count(data.owned)} you own on PC and ${count(data.hidden)} hidden or snoozed are left out`
            : undefined
        }
        actions={
          <Group gap="xs">
            {canEdit && (
              <Button size="xs" variant="default" leftSection={<IconRefresh size={14} />} loading={discover.isPending} onClick={() => discover.mutate()}>
                Search now
              </Button>
            )}
            {canEdit && data?.pricesOn && (
              <Button size="xs" variant="default" leftSection={<IconTag size={14} />} loading={readPrices.isPending} onClick={() => readPrices.mutate()}>
                Check prices
              </Button>
            )}
            <Button size="xs" variant="default" leftSection={<IconDownload size={14} />} component="a" href="/api/v1/pc/wishlist/export">
              CSV
            </Button>
          </Group>
        }
      />
      {data && data.found === 0 && (
        <Card withBorder mb="md">
          <Text size="sm">
            No PC games found yet. The search runs weekly (Settings &gt; PC library) and needs IGDB’s keys (Settings &gt; Sources); “Search now” starts it. It looks at the genres that get the most acorns{' '}
            <Anchor component={Link} to="/acorns" size="sm">
              (Acorns)
            </Anchor>{' '}
            (or learned from your collection), the series you collect, and your sealed console games, and leaves out every game your PC library owns.
          </Text>
        </Card>
      )}
      <Group gap="sm" mb="sm" wrap="wrap">
        <TextInput placeholder="Search" leftSection={<IconSearch size={16} />} value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={260} />
        {data?.pricesOn && (
          <SegmentedControl
            size="xs"
            value={deals ? 'deals' : 'all'}
            onChange={(v) => setParams(v === 'deals' ? { view: 'deals' } : {}, { replace: true })}
            data={[
              { value: 'all', label: 'Every game' },
              { value: 'deals', label: 'On sale now' },
            ]}
            aria-label="Which games"
          />
        )}
      </Group>
      {list.isLoading ? (
        <Loader />
      ) : (
        <Card withBorder p={0}>
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={40}>#</Table.Th>
                <Table.Th>Game</Table.Th>
                {!narrow && <Table.Th>Reviews</Table.Th>}
                {data?.pricesOn && <Table.Th ta="right">Price</Table.Th>}
                <Table.Th ta="right">Acorns</Table.Th>
                {!narrow && <Table.Th>Preference</Table.Th>}
                <Table.Th w={70} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map((e) => {
                const expanded = open === e.key;
                return (
                  <Fragment key={e.key}>
                    <Table.Tr onClick={() => setOpen(expanded ? null : e.key)} style={{ cursor: 'pointer' }}>
                      <Table.Td>
                        <Group gap={2} wrap="nowrap">
                          {expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                          <Text size="sm">{e.rank}</Text>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Group gap="sm" wrap="nowrap" align="flex-start">
                          <Cover id={e.coverId} placeholder />
                          <Stack gap={2}>
                            <Text size="sm" fw={500}>
                              {e.title}
                            </Text>
                            <Text size="xs" c="dimmed">
                              {[(e.details.genres ?? []).join(', '), e.released?.slice(0, 4)].filter(Boolean).join(' · ')}
                            </Text>
                            <Group gap={4}>
                              {e.sources.map((s) => (
                                <Badge key={s} size="xs" variant="outline" color={s.startsWith('Sealed') ? 'squirrel' : 'gray'} style={{ textTransform: 'none' }}>
                                  {s}
                                </Badge>
                              ))}
                            </Group>
                          </Stack>
                        </Group>
                      </Table.Td>
                      {!narrow && (
                        <Table.Td>
                          {e.steam ? (
                            <Tooltip label={`${e.steam.summary} (${count(e.steam.total)} Steam reviews)`}>
                              <Text size="sm">{e.steam.percent}% on Steam</Text>
                            </Tooltip>
                          ) : (
                            <Text size="xs" c="dimmed">
                              —
                            </Text>
                          )}
                        </Table.Td>
                      )}
                      {data?.pricesOn && (
                        <Table.Td ta="right" onClick={(ev) => ev.stopPropagation()}>
                          <PriceCell price={e.price} />
                        </Table.Td>
                      )}
                      <Table.Td ta="right">
                        <Badge size="md" variant="light" color={PRIORITY_COLORS[e.priority]}>
                          <Acorns n={e.score} size={12} />
                        </Badge>
                      </Table.Td>
                      {!narrow && (
                        <Table.Td onClick={(ev) => ev.stopPropagation()}>
                          {canEdit ? (
                            <Select
                              size="xs"
                              placeholder="No preference"
                              aria-label={`Your preference for ${e.title}`}
                              data={Object.keys(preferences)}
                              value={e.preference ?? null}
                              onChange={(v) => control.mutate({ key: e.key, change: { preference: v } })}
                              clearable
                              w={170}
                            />
                          ) : (
                            <Text size="sm">{e.preference ?? ''}</Text>
                          )}
                        </Table.Td>
                      )}
                      <Table.Td onClick={(ev) => ev.stopPropagation()}>
                        {canEdit && (
                        <Group gap={2} wrap="nowrap">
                          <Menu position="bottom-end" withinPortal>
                            <Menu.Target>
                              <Tooltip label="Snooze: leave it off the PC wishlist for a while">
                                <ActionIcon variant="subtle" color="gray" aria-label={`Snooze ${e.title}`}>
                                  <IconClock size={16} />
                                </ActionIcon>
                              </Tooltip>
                            </Menu.Target>
                            <Menu.Dropdown>
                              <Menu.Label>Snooze for</Menu.Label>
                              {SNOOZES.map(([label, months]) => (
                                <Menu.Item key={label} onClick={() => control.mutate({ key: e.key, change: { action: 'defer', until: monthsFromNow(months) } })}>
                                  {label}
                                </Menu.Item>
                              ))}
                            </Menu.Dropdown>
                          </Menu>
                          <Tooltip label="Not interested: hide it">
                            <ActionIcon variant="subtle" color="gray" aria-label={`Hide ${e.title}`} onClick={() => control.mutate({ key: e.key, change: { action: 'hide' } })}>
                              <IconEyeOff size={16} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                        )}
                      </Table.Td>
                    </Table.Tr>
                    {expanded && (
                      <Table.Tr>
                        <Table.Td colSpan={(narrow ? 4 : 6) + (data?.pricesOn ? 1 : 0)}>
                          <Group align="flex-start" gap="xl" pl={narrow ? 0 : 'lg'}>
                            <Stack gap={2}>
                              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                                Where its acorns come from
                              </Text>
                              {e.components.map((c) => (
                                <Group key={c.label} gap="xs" justify="space-between" miw={300}>
                                  <Text size="sm">{c.label}</Text>
                                  <Text size="sm" c={c.points < 0 ? 'red' : c.points > 0 ? undefined : 'dimmed'}>
                                    {c.points > 0 ? `+${c.points}` : c.points}
                                  </Text>
                                </Group>
                              ))}
                            </Stack>
                            <Stack gap={4}>
                              {e.steamAppId && (
                                <Anchor href={`https://store.steampowered.com/app/${e.steamAppId}/`} target="_blank" rel="noreferrer" size="sm">
                                  Open on Steam
                                </Anchor>
                              )}
                              <Anchor href={`https://www.igdb.com/search?type=1&q=${encodeURIComponent(e.title)}`} target="_blank" rel="noreferrer" size="sm">
                                Look it up on IGDB
                              </Anchor>
                            </Stack>
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    )}
                  </Fragment>
                );
              })}
            </Table.Tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
