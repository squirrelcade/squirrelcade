import { Autocomplete, Button, Card, CloseButton, Group, Loader, Menu, NumberInput, SegmentedControl, Select, SimpleGrid, Stack, Text } from '@mantine/core';
import { RIP_RESULTS, type TestResult } from '@squirrelcade/core';
import { IconCheck, IconChevronDown, IconDisc, IconPencil } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../api';
import { PageHeader } from '../components';
import { CONDITIONS, CopyDetailsModal, TestBadge, TOUCHED, type CopyRef } from '../CopyDetails';
import { count, date, money } from '../format';
import { GameTitle } from '../GameDrawer';
import { notifyError, useSetting } from '../hooks';
import { LookUpPrices, useFoundPrices, useOrdersOn } from '../OrderEmails';

/** A copy added lately (GET /api/v1/collection/recent, D161). */
interface RecentItem {
  id: number;
  key: string;
  title: string;
  platform: string | null;
  platformKey: string | null;
  completeness: string;
  condition: string;
  costCents: number | null;
  estimatedCents: number | null;
  datePurchased: string | null;
  notes: string;
  gradingCompany: string;
  gradingCertId: string;
  slots: string[];
  addedAt: string;
  location: string | null;
  canRip: boolean;
  lastRip: { id: number; result: TestResult; testedAt: string } | null;
}

/** How far back the page looks: the last week, month (the start) or three months. */
const SPANS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
];

/** The other ways a rip can go, behind the arrow beside "Read fully". */
const OTHER_RIPS: TestResult[] = ['issues', 'broken'];

/**
 * One copy's row: what's finished after a game comes in, in the order it's done (the owner's way, D161): its condition
 * (from the box in hand), what was paid (from the receipt), the rip, and where it's put away. Each saves on its own.
 */
function RecentRow({ item, places, onEdit, prices }: { item: RecentItem; places: string[]; onEdit: () => void; prices: ReturnType<typeof useFoundPrices> | null }) {
  const queryClient = useQueryClient();
  const currency = useSetting('general.currency', 'USD');
  const dateFormat = useSetting('general.dateFormat', 'us');
  // PriceCharting writes 0 for a price it wasn't given: it shows as not known.
  const savedPaid = item.costCents ? item.costCents / 100 : '';
  const [paid, setPaid] = useState<number | string>(savedPaid);
  const [place, setPlace] = useState(item.location ?? '');
  useEffect(() => setPaid(savedPaid), [item.costCents]);
  useEffect(() => setPlace(item.location ?? ''), [item.location]);
  // "Saved" beside the copy for a moment after each change.
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const save = useMutation({
    mutationFn: (c: { path: string; method: 'PUT' | 'POST' | 'DELETE'; json?: unknown }) => api(c.path, { method: c.method, json: c.json }),
    onSuccess: async () => {
      setSaved(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setSaved(false), 2500);
      await Promise.all(['recent', ...TOUCHED].map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
    },
    onError: (err) => notifyError(err),
  });
  const saveCopy = (fields: Record<string, unknown>) => save.mutate({ path: `/collection/copies/${item.id}`, method: 'PUT', json: fields });
  const savePaid = () => {
    const cents = paid === '' ? null : Math.round(Number(paid) * 100);
    if (cents !== (item.costCents || null)) saveCopy({ costCents: cents });
  };
  const savePlace = (value = place) => {
    const next = value.trim();
    if (next !== (item.location ?? '')) save.mutate({ path: '/copy', method: 'PUT', json: { key: item.key, location: next || null } });
  };
  const rip = (result: TestResult) => save.mutate({ path: '/copy/tests', method: 'POST', json: { key: item.key, kind: 'rip', result } });
  const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && e.currentTarget.blur();

  return (
    <Card withBorder padding="sm">
      <Group justify="space-between" align="flex-start" wrap="nowrap" mb="xs">
        <Stack gap={0} style={{ minWidth: 0 }}>
          <GameTitle platformKey={item.platformKey ?? ''} title={item.title} fw={600} />
          <Text size="xs" c="dimmed">
            {item.platform ?? ''} · added {date(item.addedAt, dateFormat)}
          </Text>
        </Stack>
        <Group gap="xs" wrap="nowrap">
          {saved && (
            <Text size="xs" c="green" role="status">
              <IconCheck size={12} /> Saved
            </Text>
          )}
          <button type="button" className="sc-tag" data-tone="edit" onClick={onEdit}>
            <IconPencil size={13} aria-hidden /> Edit this copy
          </button>
        </Group>
      </Group>
      <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="xs" verticalSpacing="xs">
        <Select
          label="Condition"
          aria-label={`Condition of ${item.title}`}
          data={CONDITIONS}
          value={item.completeness === 'unknown' ? null : item.completeness}
          placeholder="Unknown"
          allowDeselect={false}
          onChange={(v) => v && v !== item.completeness && saveCopy({ completeness: v })}
        />
        <NumberInput
          label={`Price paid (${currency})`}
          aria-label={`Price paid for ${item.title}`}
          value={paid}
          onChange={setPaid}
          onBlur={savePaid}
          onKeyDown={blurOnEnter}
          min={0}
          decimalScale={2}
          allowNegative={false}
          inputMode="decimal"
          placeholder={item.estimatedCents ? `About ${(item.estimatedCents / 100).toFixed(2)}` : 'Not known'}
        />
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Ripped
          </Text>
          {!item.canRip ? (
            <Text size="xs" c="dimmed">
              Not a console you rip (Settings › Collection).
            </Text>
          ) : item.lastRip ? (
            <Group gap={4} wrap="nowrap">
              <TestBadge kind="rip" result={item.lastRip.result} testedAt={item.lastRip.testedAt} dateFormat={dateFormat} />
              <CloseButton size="sm" aria-label={`Take back the rip of ${item.title}`} onClick={() => save.mutate({ path: `/copy/tests/${item.lastRip!.id}`, method: 'DELETE' })} />
            </Group>
          ) : (
            // Most rips read fully: one tap. The arrow has the other ways it can go.
            <Button.Group>
              <Button color="green" leftSection={<IconDisc size={16} />} loading={save.isPending} onClick={() => rip('works')} aria-label={`${item.title}: ${RIP_RESULTS.works}`}>
                {RIP_RESULTS.works}
              </Button>
              <Menu position="bottom-end" withinPortal>
                <Menu.Target>
                  <Button color="green" px={8} disabled={save.isPending} aria-label={`Another rip result for ${item.title}`}>
                    <IconChevronDown size={16} />
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  {OTHER_RIPS.map((r) => (
                    <Menu.Item key={r} onClick={() => rip(r)}>
                      {RIP_RESULTS[r]}
                    </Menu.Item>
                  ))}
                </Menu.Dropdown>
              </Menu>
            </Button.Group>
          )}
        </Stack>
        <Autocomplete
          label="Storage location"
          aria-label={`Storage location of ${item.title}`}
          placeholder="Bag 7, Black case #7..."
          data={places}
          value={place}
          onChange={setPlace}
          onOptionSubmit={(v) => {
            setPlace(v);
            savePlace(v);
          }}
          onBlur={() => savePlace()}
          onKeyDown={blurOnEnter}
          maxLength={80}
        />
      </SimpleGrid>
      {/* The haul (the owner's yes, 2026-10-23): a price your order emails gave for it, to use or turn down. */}
      {(() => {
        const found = prices?.of(item.id);
        if (!found || found.paidCents === null || item.costCents) return null;
        return (
          <Group gap={8} mt="xs" wrap="wrap">
            <Text size="sm">
              Found in your email: <b>{money(found.paidCents, currency)}</b>
              <Text span size="xs" c="dimmed">
                {' '}
                {[found.store, found.date ? date(found.date, dateFormat) : null, found.itemTitle].filter(Boolean).join(' · ')}
              </Text>
            </Text>
            <Button size="compact-xs" color="forest" loading={prices!.using === item.id} onClick={() => prices!.use({ id: item.id, datePurchased: item.datePurchased }, () => queryClient.invalidateQueries({ queryKey: ['recent'] }))}>
              Use it
            </Button>
            <Button size="compact-xs" variant="subtle" color="gray" onClick={() => prices!.forget(item.id)}>
              Not this
            </Button>
          </Group>
        );
      })()}
    </Card>
  );
}

/**
 * Stash > Recently added (D161, the owner's ask): the copies added lately, newest first, each finished right there
 * (condition, what was paid, the rip, where it's kept), without searching for each game; Edit this copy has the rest.
 */
export function RecentPage() {
  const [params, setParams] = useSearchParams();
  const days = SPANS.some((s) => s.value === params.get('days')) ? params.get('days')! : '30';
  const list = useQuery({ queryKey: ['recent', days], queryFn: () => api<{ days: number; total: number; items: RecentItem[] }>(`/collection/recent?days=${days}`) });
  const vocabulary = useQuery({ queryKey: ['tags'], queryFn: () => api<{ locations: { name: string }[] }>('/tags') });
  const places = (vocabulary.data?.locations ?? []).map((l) => l.name);
  const [editing, setEditing] = useState<RecentItem | null>(null);
  const ref: CopyRef | null = useMemo(
    () =>
      editing
        ? {
            copyKey: editing.key,
            title: editing.title,
            platform: editing.platform ?? '',
            condition: editing.condition,
            copy: { id: editing.id, completeness: editing.completeness, costCents: editing.costCents, datePurchased: editing.datePurchased, notes: editing.notes, slots: editing.slots, estimatedCents: editing.estimatedCents, platformKey: editing.platformKey ?? undefined, gradingCompany: editing.gradingCompany, gradingCertId: editing.gradingCertId },
          }
        : null,
    [editing],
  );
  const items = list.data?.items ?? [];
  // The haul: every new copy's price looked for in your order emails at once (Find in my email, Settings > Email).
  const ordersOn = useOrdersOn();
  const prices = useFoundPrices(ordersOn);
  const unpriced = items.filter((i) => !i.costCents).length;

  return (
    <>
      <PageHeader
        help="your-copies"
        title="Recently added"
        description="The copies you added lately, newest first, to finish in one place once a game is in: its condition, what you paid, the rip, and where you keep it. Each change saves as you make it; Edit this copy has everything else (photos, notes, the day you bought it)."
      />
      <Group mb="md" gap="sm">
        <Text size="sm">Added in the last</Text>
        <SegmentedControl size="xs" data={SPANS} value={days} onChange={(v) => setParams(v === '30' ? {} : { days: v }, { replace: true })} />
        {list.data && (
          <Text size="sm" c="dimmed">
            {count(list.data.total)} {list.data.total === 1 ? 'copy' : 'copies'}
            {list.data.total > items.length ? ` (the newest ${count(items.length)} shown)` : ''}
          </Text>
        )}
      </Group>
      {ordersOn && unpriced > 0 && (
        <Card withBorder padding="sm" mb="md">
          <Group justify="space-between" gap="sm" wrap="wrap">
            <Text size="sm" style={{ flex: '1 1 320px' }}>
              <b>A haul?</b> {count(unpriced)} of these {unpriced === 1 ? 'copy has' : 'copies have'} no price yet. Squirrelcade can look for all of them in your order emails at once;
              each price found waits on its copy below to use or turn down.
            </Text>
            <LookUpPrices platform={null} addedHere={false} recentDays={Number(days)} label="Find their prices in my email" />
          </Group>
        </Card>
      )}
      {list.isLoading ? (
        <Loader />
      ) : items.length === 0 ? (
        <Text c="dimmed">Nothing added in the last {days} days.</Text>
      ) : (
        <Stack gap="sm">
          {items.map((i) => (
            <RecentRow key={i.id} item={i} places={places} onEdit={() => setEditing(i)} prices={ordersOn ? prices : null} />
          ))}
        </Stack>
      )}
      <CopyDetailsModal copy={ref} onClose={() => setEditing(null)} />
    </>
  );
}
