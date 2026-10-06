import { Badge, Button, Group, Loader, Pagination, SegmentedControl, Select, Stack, Table, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api } from '../api';
import { PageHeader } from '../components';
import { CopyDetailsModal, TestBadge, type CopyRef, type CopyTest } from '../CopyDetails';
import { count } from '../format';
import { GameTitle } from '../GameDrawer';
import { useSetting } from '../hooks';

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
}

interface ImproveList {
  counts: Record<Gap, number>;
  checked: Gap[];
  total: number;
  items: ImproveItem[];
}

const GAP_NAMES: Record<Gap, string> = { paid: 'Price paid', date: 'Day bought', photos: 'Photos', tested: 'Tested', location: 'Where it is' };
const PAGE = 50;

/**
 * Collection > Improve (0.21.0): what copies are missing, by what Settings > Collection > Improve your collection
 * counts (a price paid, the day bought, a standard photo, a test, where it is), filled in one copy at a time: a copy
 * opens its window, whose Next copy walks the list.
 */
export function ImprovePage() {
  const dateFormat = useSetting('general.dateFormat', 'us');
  const [gap, setGap] = useState<string>('all');
  const [platform, setPlatform] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  // The copy open in its window, as the list had it (it stays while the list refreshes), and where it was.
  const [open, setOpen] = useState<{ item: ImproveItem; index: number } | null>(null);
  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE), ...(gap !== 'all' ? { gap } : {}), ...(platform ? { platform } : {}) });
  const list = useQuery({ queryKey: ['improve', gap, platform, page], queryFn: () => api<ImproveList>(`/collection/improve?${query}`) });
  const platforms = useQuery({ queryKey: ['platforms'], queryFn: () => api<{ key: string; name: string; copies: number }[]>('/platforms') });
  const d = list.data;
  const items = d?.items ?? [];
  const current = open?.item ?? null;
  const ref: CopyRef | null = useMemo(
    () =>
      current
        ? {
            copyKey: current.key,
            title: current.title,
            platform: current.platform ?? '',
            condition: current.condition,
            copy: { id: current.id, completeness: current.completeness, costCents: current.costCents, datePurchased: current.datePurchased, notes: current.notes, slots: current.slots, estimatedCents: current.estimatedCents, platformKey: current.platformKey ?? undefined },
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
        description="What your copies are missing: what you paid (or, when you don't know, your estimate) and when, their standard photos, a test, where each is kept. Open a copy to fill it in, then Next copy for the one after it."
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
          {d.checked.length === 0 ? (
            <Text c="dimmed">Nothing is counted: Settings › Collection › Improve your collection chooses what is.</Text>
          ) : d.total === 0 ? (
            <Text c="dimmed" ta="center" mt="md">
              Nothing missing here.
            </Text>
          ) : (
            <>
              <Text size="sm" c="dimmed">
                {count(d.total)} cop{d.total === 1 ? 'y' : 'ies'}
              </Text>
              <Table.ScrollContainer minWidth={320}>
                <Table verticalSpacing={6} striped highlightOnHover>
                  <Table.Tbody>
                    {items.map((i, index) => (
                      <Table.Tr key={i.id}>
                        <Table.Td>
                          {i.platformKey ? <GameTitle platformKey={i.platformKey} title={i.title} fw={500} /> : <Text fw={500}>{i.title}</Text>}
                          <Text size="xs" c="dimmed">
                            {[i.platform, i.condition, i.location].filter(Boolean).join(' · ')}
                          </Text>
                          <Group gap={4} mt={4}>
                            {i.gaps.includes('paid') && (
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
                                Where is it?
                              </Badge>
                            )}
                          </Group>
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
        onClose={() => setOpen(null)}
        position={open ? `${(page - 1) * PAGE + open.index + 1} of ${count(d?.total ?? 0)}` : undefined}
        onNext={next}
      />
    </>
  );
}
