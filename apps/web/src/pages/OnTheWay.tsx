import { Alert, Anchor, Autocomplete, Badge, Button, Card, Group, Loader, Stack, Text } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { COMPLETENESS_LABELS, type Completeness } from '@squirrelcade/core';
import { IconExternalLink, IconMailSearch, IconPackage } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { PageHeader } from '../components';
import { CopyDetailsModal, TOUCHED, type CopyRef } from '../CopyDetails';
import { date, money, timeAgo } from '../format';
import { GameTitle } from '../GameDrawer';
import { notifyError, notifySuccess, useSetting } from '../hooks';
import { COUNTS_SAID } from '../OrderEmails';

/** A game on the way (GET /api/v1/coming). */
export interface ComingItem {
  id: number;
  store: string;
  orderDate: string | null;
  orderNumber: string | null;
  link: string | null;
  listingTitle: string;
  quantity: number;
  currency: string | null;
  itemCents: number | null;
  taxCents: number | null;
  shippingCents: number | null;
  discountCents: number | null;
  paidCents: number | null;
  readBy: string;
  platformKey: string | null;
  platform: string | null;
  title: string | null;
  entryId: number | null;
  maybe: { platformKey: string; platform: string; title: string }[];
  status: 'waiting' | 'arrived' | 'dismissed';
  createdAt: string;
}

interface OrdersStatus {
  find: boolean;
  watch: boolean;
  account: { user: string; host: string } | null;
  problem: string | null;
  reader: 'ai' | 'plain';
  lastWatch: { at: string; ok: boolean; message: string } | null;
  waiting: number;
}

/** The copy's fields its window needs (GET /api/v1/game), as Store Mode's Add it fetches them. */
interface GameCopy {
  id: number;
  copyKey: string;
  completeness: string;
  costCents: number | null;
  datePurchased: string | null;
  notes: string;
  slots: string[];
  estimatedCents: number | null;
  gradingCompany: string;
  gradingCertId: string;
}

/** A copy just added, as its window takes it (D153): fetched from the game's copies, or made from what Add it gave. */
export async function addedCopyRef(added: { id: number; key: string; platformKey: string; platform: string; title: string }, fallbackCompleteness: string): Promise<CopyRef> {
  let found: GameCopy | undefined;
  try {
    const view = await api<{ copies: GameCopy[] }>(`/game?platform=${encodeURIComponent(added.platformKey)}&title=${encodeURIComponent(added.title)}`);
    found = view.copies.find((c) => c.id === added.id);
  } catch {
    // Its window opens anyway, with what It's here gave it.
  }
  const completeness = found?.completeness ?? fallbackCompleteness;
  return {
    copyKey: found?.copyKey ?? added.key,
    title: added.title,
    platform: added.platform,
    condition: COMPLETENESS_LABELS[completeness as Completeness] ?? completeness,
    copy: {
      id: added.id,
      completeness,
      costCents: found?.costCents ?? null,
      datePurchased: found?.datePurchased ?? null,
      notes: found?.notes ?? '',
      slots: found?.slots ?? [],
      estimatedCents: found?.estimatedCents ?? null,
      platformKey: added.platformKey,
      gradingCompany: found?.gradingCompany ?? '',
      gradingCertId: found?.gradingCertId ?? '',
    },
  };
}

/** Says which game a listing is: a search of the games Squirrelcade knows, or one of the games it may be. */
function WhichGame({ item, onPick }: { item: ComingItem; onPick: (game: { platformKey: string; title: string }) => void }) {
  const [typed, setTyped] = useState('');
  const [q] = useDebouncedValue(typed, 250);
  const search = useQuery({
    queryKey: ['lookup', 'coming', q],
    queryFn: () => api<{ platformKey: string; platform: string; title: string }[]>(`/lookup?q=${encodeURIComponent(q)}&limit=12`),
    enabled: q.trim().length >= 2,
  });
  const options = (search.data ?? []).map((r) => ({ value: `${r.platformKey}|${r.title}`, label: `${r.title} · ${r.platform}` }));
  return (
    <Stack gap={4}>
      {item.maybe.length > 0 && (
        <Group gap={4}>
          <Text size="xs" c="dimmed">
            Is it
          </Text>
          {item.maybe.map((m) => (
            <Button key={`${m.platformKey}|${m.title}`} size="compact-xs" variant="light" onClick={() => onPick(m)}>
              {m.title} · {m.platform}
            </Button>
          ))}
        </Group>
      )}
      <Autocomplete
        size="xs"
        placeholder="Which game is it? Search by title"
        value={typed}
        onChange={setTyped}
        data={options}
        filter={({ options: o }) => o}
        onOptionSubmit={(v) => {
          const [platformKey, ...rest] = v.split('|');
          setTyped('');
          onPick({ platformKey: platformKey!, title: rest.join('|') });
        }}
        maw={360}
        aria-label="Which game is it?"
      />
    </Stack>
  );
}

/**
 * On the way (D156): games bought that haven't arrived, from the purchase emails Squirrelcade watches for (eBay and
 * Mercari, and the senders Settings > Email lists). They're not in the collection, not counted, and never sent to
 * PriceCharting. It's here makes one a copy, with its price and day filled in, and opens its window; Not coming
 * takes it off the list.
 */
export function OnTheWayPage() {
  const queryClient = useQueryClient();
  const currency = useSetting('general.currency', 'USD');
  const dateFormat = useSetting('general.dateFormat', 'us');
  const counts = useSetting('orders.paidCounts', 'item');
  const boughtCondition = useSetting('collection.boughtCondition', 'complete');
  const on = useSetting('orders.watch', false) === true;
  const list = useQuery({ queryKey: ['coming'], queryFn: () => api<{ on: boolean; items: ComingItem[] }>('/coming'), refetchInterval: 30_000 });
  const status = useQuery({ queryKey: ['orders', 'status'], queryFn: () => api<OrdersStatus>('/orders'), refetchInterval: 30_000 });
  const [editing, setEditing] = useState<CopyRef | null>(null);
  const refresh = () => Promise.all(['coming', 'orders', ...TOUCHED].map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
  const check = useMutation({
    mutationFn: () => api('/coming/check', { method: 'POST' }),
    onSuccess: () => {
      notifySuccess('Squirrelcade is looking in your email for purchases; they show here in a moment.', 'Checking');
      setTimeout(() => void refresh(), 8000);
    },
    onError: (err) => notifyError(err),
  });
  const pick = useMutation({
    mutationFn: (v: { id: number; platformKey: string; title: string }) => api(`/coming/${v.id}`, { method: 'PUT', json: { platformKey: v.platformKey, title: v.title } }),
    onSuccess: () => refresh(),
    onError: (err) => notifyError(err),
  });
  const dismiss = useMutation({
    mutationFn: (id: number) => api(`/coming/${id}/dismiss`, { method: 'POST' }),
    onSuccess: () => refresh(),
    onError: (err) => notifyError(err),
  });
  const arrived = useMutation({
    mutationFn: async (item: ComingItem) => {
      const added = await api<{ id: number; key: string; platformKey: string; platform: string; title: string }>(`/coming/${item.id}/arrived`, { method: 'POST' });
      return addedCopyRef(added, boughtCondition);
    },
    onSuccess: async (ref) => {
      await refresh();
      setEditing(ref);
    },
    onError: (err) => notifyError(err),
  });
  const items = list.data?.items ?? [];
  const s = status.data;

  return (
    <>
      <PageHeader
        help="orders"
        title="On the way"
        description="Games you bought that haven't arrived, found in your purchase emails. They aren't in your collection yet: not counted, not on your lists, never sent to PriceCharting. When one comes, It's here adds it with what you paid and the day, and opens its window for the rest."
        actions={
          on && (
            <Button variant="default" leftSection={<IconMailSearch size={16} />} loading={check.isPending} onClick={() => check.mutate()} disabled={!s?.account}>
              Check my email now
            </Button>
          )
        }
      />
      {!on ? (
        <Text c="dimmed">
          On the way is off.{' '}
          <Anchor component={Link} to="/settings/email#setting-orders.watch">
            Turn it on in Settings › Email
          </Anchor>{' '}
          to have Squirrelcade look for your eBay and Mercari purchases (and the stores you name) every day or as often as you like.
        </Text>
      ) : (
        <Stack gap="sm">
          {s?.problem && (
            <Alert color="yellow" p="xs">
              {s.problem}{' '}
              <Anchor component={Link} to="/settings/email" size="sm" c="inherit" fw={600} underline="always">
                Set it up
              </Anchor>
            </Alert>
          )}
          {s?.lastWatch && (
            <Text size="xs" c={s.lastWatch.ok ? 'dimmed' : 'red'}>
              Last looked {timeAgo(s.lastWatch.at)}: {s.lastWatch.message}
            </Text>
          )}
          {!list.data ? (
            <Loader />
          ) : items.length === 0 ? (
            <Text c="dimmed" ta="center" mt="md">
              Nothing on the way.
            </Text>
          ) : (
            items.map((item) => {
              const cur = item.currency ?? currency;
              const known = Boolean(item.platformKey && item.title);
              return (
                <Card key={item.id} withBorder padding="sm">
                  <Group justify="space-between" align="flex-start" wrap="wrap" gap="xs">
                    <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
                      {known ? (
                        <Group gap={6} wrap="nowrap">
                          <IconPackage size={16} />
                          <GameTitle platformKey={item.platformKey!} title={item.title!} fw={600} />
                          <Text size="sm" c="dimmed">
                            {item.platform}
                          </Text>
                        </Group>
                      ) : (
                        <Text fw={600}>{item.listingTitle}</Text>
                      )}
                      <Text size="sm">
                        {item.store}
                        {item.orderDate ? `, ${date(item.orderDate, dateFormat)}` : ''}
                        {item.paidCents !== null ? ` · ${money(item.paidCents, cur)}` : ''}
                        {item.quantity > 1 ? ` · ${item.quantity} of them` : ''}
                        {item.link && (
                          <>
                            {' · '}
                            <Anchor href={item.link} target="_blank" rel="noreferrer" size="sm">
                              {item.store === 'eBay' || item.store === 'Mercari' ? 'the listing' : 'the order'} <IconExternalLink size={12} />
                            </Anchor>
                          </>
                        )}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {[
                          item.itemCents !== null ? `item ${money(item.itemCents, cur)}` : 'no price in the email',
                          item.taxCents ? `tax ${money(item.taxCents, cur)}` : null,
                          item.shippingCents ? `shipping ${money(item.shippingCents, cur)}` : null,
                          item.discountCents ? `off ${money(item.discountCents, cur)}` : null,
                          `price paid: ${COUNTS_SAID[counts] ?? counts}`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                        {known ? ` · listed as “${item.listingTitle}”` : ''}
                        {item.orderNumber ? ` · order ${item.orderNumber}` : ''}
                      </Text>
                      {!known && <WhichGame item={item} onPick={(g) => pick.mutate({ id: item.id, ...g })} />}
                      {known && (
                        <Anchor size="xs" c="dimmed" onClick={() => pick.mutate({ id: item.id, platformKey: '', title: '' })}>
                          Not this game?
                        </Anchor>
                      )}
                    </Stack>
                    <Group gap="xs">
                      <Button onClick={() => arrived.mutate(item)} disabled={!known || arrived.isPending} loading={arrived.isPending && arrived.variables?.id === item.id}>
                        It's here
                      </Button>
                      <Button variant="subtle" color="gray" onClick={() => dismiss.mutate(item.id)} disabled={dismiss.isPending}>
                        Not coming
                      </Button>
                    </Group>
                  </Group>
                </Card>
              );
            })
          )}
          {items.some((i) => i.readBy === 'ai') && (
            <Badge variant="light" color="gray" style={{ textTransform: 'none' }}>
              Some were read by the AI model
            </Badge>
          )}
        </Stack>
      )}
      <CopyDetailsModal copy={editing} added onClose={() => setEditing(null)} />
    </>
  );
}
