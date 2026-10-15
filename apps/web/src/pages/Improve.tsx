import { Anchor, Badge, Button, Chip, Group, Loader, Pagination, SegmentedControl, Select, Stack, Table, Text } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../api';
import { PageHeader } from '../components';
import { CopyDetailsModal, TestBadge, type CopyRef, type CopyTest } from '../CopyDetails';
import { count } from '../format';
import { GameTitle } from '../GameDrawer';
import { useSetting } from '../hooks';
import { FoundPriceLine, LookUpPrices, useFoundPrices, useOrdersOn } from '../OrderEmails';
import { usePlaceNotes } from '../places';

type Gap = 'paid' | 'date' | 'photos' | 'tested' | 'location';

/** GET /api/v1/collection/improve: a copy and what it's missing. */
interface ImproveItem {
  id: number;
  key: string;
  title: string;
  platform: string | null;
  platformKey: string | null;
  completeness: string;
  condition: string;
  costCents: number | null;
  datePurchased: string | null;
  notes: string;
  gaps: Gap[];
  slots: string[];
  missingPhotos: string[];
  lastTest: Pick<CopyTest, 'kind' | 'result' | 'testedAt'> | null;
  location: string | null;
  estimatedCents: number | null;
  /** Who graded a graded copy, and its certificate (D151). */
  gradingCompany: string;
  gradingCertId: string;
}

interface ImproveList {
  counts: Record<Gap, number>;
  checked: Gap[];
  total: number;
  items: ImproveItem[];
}

const GAP_NAMES: Record<Gap, string> = { paid: 'Price paid', date: 'Day bought', photos: 'Photos', tested: 'Tested', location: 'Storage location' };
const PAGE = 50;

/**
 * Collection > Improve (0.21.0): what copies are missing, by what Settings > Collection > Improve your collection
 * counts (a price paid, the day bought, a standard photo, a test, where it is), filled in one copy at a time: a copy
 * opens its window, whose Next copy walks the list.
 */
export function ImprovePage() {
  const dateFormat = useSetting('general.dateFormat', 'us');
  // Where each place itself is (D157), beside it.
  const noteOf = usePlaceNotes();
  const [params, setParams] = useSearchParams();
  // A tab asked for in the address (?gap=location: Places' "without one").
  const [gap, setGap] = useState<string>(() => params.get('gap') ?? 'all');
  const [platform, setPlatform] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  // Only the copies added here (?added=here, Store Mode's link after a haul, D153), kept in the address.
  const addedHere = params.get('added') === 'here';
  // The copy open in its window, as the list had it (it stays while the list refreshes), and where it was.
  const [open, setOpen] = useState<{ item: ImproveItem; index: number } | null>(null);
  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE), ...(gap !== 'all' ? { gap } : {}), ...(platform ? { platform } : {}), ...(addedHere ? { added: 'here' } : {}) });
  const list = useQuery({ queryKey: ['improve', gap, platform, addedHere, page], queryFn: () => api<ImproveList>(`/collection/improve?${query}`) });
  const platforms = useQuery({ queryKey: ['platforms'], queryFn: () => api<{ key: string; name: string; copies: number }[]>('/platforms') });
  const d = list.data;
  const items = d?.items ?? [];
  const current = open?.item ?? null;
  // Prices found in the owner's order emails (D155), waiting beside their copies.
  const ordersOn = useOrdersOn();
  const currency = useSetting('general.currency', 'USD');
  const queryClient = useQueryClient();
  const prices = useFoundPrices(ordersOn);
  const ref: CopyRef | null = useMemo(
    () =>
      current
        ? {
            copyKey: current.key,
            title: current.title,
            platform: current.platform ?? '',
            condition: current.condition,
            copy: { id: current.id, completeness: current.completeness, costCents: current.costCents, datePurchased: current.datePurchased, notes: current.notes, slots: current.slots, estimatedCents: current.estimatedCents, platformKey: current.platformKey ?? undefined, gradingCompany: current.gradingCompany, gradingCertId: current.gradingCertId },
          }
        : null,
    [current],
  );
  // Next copy: the one after it in the list as it is now (or, once it's complete and gone from the list, the one in its place).
  const next = () => {
    if (!open) return;
    const now = items.findIndex((i) => i.id === open.item.id);
    const index = now >= 0 ? now + 1 : open.index;
    if (index < items.length) setOpen({ item: items[index]!, index });
    else if (d && page * PAGE < d.total) {
      setPage(page + 1);
      setOpen(null);
    } else setOpen(null);
  };

  return (
    <>
      <PageHeader
        help="collection"
        title="Improve your collection"
        description="What your copies are missing: what you paid (or, when you don't know, your estimate) and when, their standard photos, a test or a rip, where each is kept. Go through them, or open one: Next copy saves what you typed and opens the one after it. Added here keeps the copies you added in Squirrelcade, a store's haul say."
      />
      {!d ? (
        <Loader />
      ) : (
        <Stack gap="sm">
          <Group justify="space-between" wrap="wrap" gap="xs">
            <SegmentedControl
              value={gap}
              onChange={(v) => {
                setGap(v);
                setPage(1);
              }}
              data={[{ value: 'all', label: 'Everything' }, ...d.checked.map((g) => ({ value: g, label: `${GAP_NAMES[g]} (${count(d.counts[g])})` }))]}
            />
            <Group gap="xs" wrap="wrap">
              <Chip
                checked={addedHere}
                onChange={(on) => {
                  const next = new URLSearchParams(params);
                  if (on) next.set('added', 'here');
                  else next.delete('added');
                  setParams(next, { replace: true });
                  setPage(1);
                }}
              >
                Added here
              </Chip>
              <Select
                placeholder="All consoles"
                data={(platforms.data ?? []).filter((p) => p.copies > 0).map((p) => ({ value: p.key, label: p.name }))}
                value={platform}
                onChange={(v) => {
                  setPlatform(v);
                  setPage(1);
                }}
                clearable
                searchable
                w={220}
              />
            </Group>
          </Group>
          {d.checked.length === 0 ? (
            <Text c="dimmed">Nothing is counted: Settings › Collection › Improve your collection chooses what is.</Text>
          ) : d.total === 0 ? (
            <Text c="dimmed" ta="center" mt="md">
              Nothing missing here.
            </Text>
          ) : (
            <>
              {/* One after another from the first: each copy's window, Next copy saving what was typed (D153). */}
              <Group justify="space-between" wrap="wrap" gap="xs">
                <Text size="sm" c="dimmed">
                  {count(d.total)} cop{d.total === 1 ? 'y' : 'ies'}
                  {addedHere ? ' added here' : ''}
                  {gap === 'location' && (
                    <>
                      {'. Many in one bag, case or shelf? '}
                      <Anchor component={Link} to="/store/pack" size="sm">
                        Pack a place
                      </Anchor>
                      {' gives them their place one after another.'}
                    </>
                  )}
                </Text>
                <Group gap="xs">
                  {ordersOn && d.checked.includes('paid') && d.counts.paid > 0 && (gap === 'all' || gap === 'paid') && <LookUpPrices platform={platform} addedHere={addedHere} />}
                  {items.length > 0 && (
                    <Button size="compact-sm" onClick={() => setOpen({ item: items[0]!, index: 0 })}>
                      Go through them
                    </Button>
                  )}
                </Group>
              </Group>
              <Table.ScrollContainer minWidth={320}>
                <Table verticalSpacing={6} striped highlightOnHover>
                  <Table.Tbody>
                    {items.map((i, index) => (
                      <Table.Tr key={i.id}>
                        <Table.Td>
                          {i.platformKey ? <GameTitle platformKey={i.platformKey} title={i.title} fw={500} /> : <Text fw={500}>{i.title}</Text>}
                          <Text size="xs" c="dimmed">
                            {[i.platform, i.condition, i.location && (noteOf(i.location) ? `${i.location} (${noteOf(i.location)})` : i.location)].filter(Boolean).join(' · ')}
                          </Text>
                          <Group gap={4} mt={4}>
                            {i.gaps.includes('paid') && !prices.of(i.id) && (
                              <Badge size="sm" variant="light" color="gray" style={{ textTransform: 'none' }}>
                                No price paid
                              </Badge>
                            )}
                            {i.gaps.includes('date') && (
                              <Badge size="sm" variant="light" color="gray" style={{ textTransform: 'none' }}>
                                No day bought
                              </Badge>
                            )}
                            {i.gaps.includes('photos') && (
                              <Badge size="sm" variant="light" color="gray" style={{ textTransform: 'none' }}>
                                Photos to take: {i.missingPhotos.join(', ')}
                              </Badge>
                            )}
                            {i.gaps.includes('tested') &&
                              (i.lastTest ? (
                                <TestBadge kind={i.lastTest.kind} result={i.lastTest.result} testedAt={i.lastTest.testedAt} dateFormat={dateFormat} />
                              ) : (
                                <Badge size="sm" variant="light" color="gray" style={{ textTransform: 'none' }}>
                                  Never tested
                                </Badge>
                              ))}
                            {i.gaps.includes('location') && (
                              <Badge size="sm" variant="light" color="gray" style={{ textTransform: 'none' }}>
                                No storage location
                              </Badge>
                            )}
                          </Group>
                          {i.gaps.includes('paid') && prices.of(i.id) && (
                            <Group gap="xs" mt={4} align="flex-start" wrap="wrap">
                              <FoundPriceLine f={prices.of(i.id)!} currency={currency} size="xs" />
                              <Button size="compact-xs" onClick={() => prices.use(i, () => queryClient.invalidateQueries({ queryKey: ['improve'] }))} loading={prices.using === i.id}>
                                Use it
                              </Button>
                              <Button size="compact-xs" variant="subtle" color="gray" onClick={() => prices.forget(i.id)}>
                                Not this
                              </Button>
                            </Group>
                          )}
                        </Table.Td>
                        <Table.Td w={1}>
                          <Button size="compact-sm" variant="light" onClick={() => setOpen({ item: i, index })}>
                            Fill in
                          </Button>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
              {d.total > PAGE && <Pagination total={Math.ceil(d.total / PAGE)} value={page} onChange={setPage} />}
            </>
          )}
        </Stack>
      )}
      <CopyDetailsModal
        copy={ref}
        found={current ? (prices.of(current.id) ?? null) : null}
        onClose={() => setOpen(null)}
        position={open ? `${(page - 1) * PAGE + open.index + 1} of ${count(d?.total ?? 0)}` : undefined}
        onNext={next}
      />
    </>
  );
}
