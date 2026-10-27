import { Alert, Anchor, Autocomplete, Badge, Button, Card, CloseButton, FileButton, Group, Loader, Modal, NumberInput, Select, Stack, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { KNOWN_PLATFORMS } from '@squirrelcade/core';
import { IconClipboardText, IconExternalLink, IconFileImport, IconMailSearch, IconPackage, IconPlus } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { PageHeader } from '../components';
import { addedCopyRef, CopyDetailsModal, TOUCHED, type CopyRef } from '../CopyDetails';
import { date, money, timeAgo } from '../format';
import { GameTitle } from '../GameDrawer';
import { notifyError, notifySuccess, useSetting } from '../hooks';
import { COUNTS_SAID } from '../OrderEmails';
import { OrderPageModal } from '../OrderPage';

/** A game on the way (GET /api/v1/coming). */
export interface ComingItem {
  id: number;
  store: string;
  orderDate: string | null;
  orderNumber: string | null;
  link: string | null;
  listingTitle: string;
  expectedOn: string | null;
  quantity: number;
  currency: string | null;
  itemCents: number | null;
  taxCents: number | null;
  shippingCents: number | null;
  discountCents: number | null;
  /** In your currency (another currency's at the order day's rate, D173), or null while that's unknown. */
  paidCents: number | null;
  /** In the email's own currency, when it's another. */
  paidInCurrencyCents: number | null;
  /** Several games for one price: a lot, a pack, a bundle (D173). */
  several: boolean;
  /** An Amazon order's game its email didn't name (D176). */
  unknown: boolean;
  lotOf: number | null;
  readBy: string;
  platformKey: string | null;
  platform: string | null;
  title: string | null;
  entryId: number | null;
  maybe: { platformKey: string; platform: string; title: string }[];
  status: 'waiting' | 'arrived' | 'dismissed' | 'split';
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

/** One game of a lot, in its split: its title, its console, and its own price (empty: a share of the rest). */
interface LotGame {
  title: string;
  platformKey: string | null;
  price: number | string;
}

/** Shares a price to the cent, as the server does (the first ones get the cents left over). */
const evenly = (cents: number, n: number) => Array.from({ length: n }, (_, i) => Math.floor(cents / n) + (i < cents - Math.floor(cents / n) * n ? 1 : 0));

/**
 * Several games, one price (D173): a lot, a pack or a bundle made a game of its own for each, the games its listing
 * names to start with. A price left empty is a share of what's left of the lot's (evenly, the owner's way: "divide it
 * by four"); each one can be typed instead.
 */
function SplitLot({ item, onClose, onDone }: { item: ComingItem | null; onClose: () => void; onDone: () => void }) {
  const currency = useSetting('general.currency', 'USD');
  const guesses = useQuery({
    queryKey: ['coming', 'games', item?.id],
    queryFn: () => api<{ games: { name: string; platformKey: string | null; title: string | null }[]; paidCents: number | null }>(`/coming/${item!.id}/games`),
    enabled: item !== null,
  });
  const [games, setGames] = useState<LotGame[]>([]);
  useEffect(() => {
    if (!guesses.data) return;
    const found = guesses.data.games.map((g) => ({ title: g.title ?? g.name, platformKey: g.platformKey, price: '' as number | string }));
    setGames(found.length >= 2 ? found : [...found, ...Array.from({ length: 2 - found.length }, () => ({ title: '', platformKey: null, price: '' as number | string }))]);
  }, [guesses.data]);
  const lotCents = guesses.data?.paidCents ?? null;
  const typed = games.reduce((sum, g) => sum + (g.price === '' ? 0 : Math.round(Number(g.price) * 100)), 0);
  const open = games.filter((g) => g.price === '').length;
  const shares = lotCents === null ? [] : evenly(Math.max(0, lotCents - typed), open);
  const consoles = [...KNOWN_PLATFORMS].sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ value: p.key, label: p.name }));
  const set = (k: number, change: Partial<LotGame>) => setGames((all) => all.map((g, i) => (i === k ? { ...g, ...change } : g)));
  const split = useMutation({
    mutationFn: () =>
      api(`/coming/${item!.id}/split`, {
        method: 'POST',
        // The server shares the price in the email's own currency: a typed price is in yours, so it's sent only then.
        json: { games: games.filter((g) => g.title.trim()).map((g) => ({ platformKey: g.platformKey, title: g.title.trim(), cents: g.price === '' || item!.paidInCurrencyCents !== null ? null : Math.round(Number(g.price) * 100) })) },
      }),
    onSuccess: () => {
      notifySuccess(`${games.filter((g) => g.title.trim()).length} games on the way, each with its share.`, 'Split');
      onDone();
    },
    onError: (err) => notifyError(err),
  });
  let shared = 0;
  return (
    <Modal opened={item !== null} onClose={onClose} title={item ? `Several games, one price · ${item.listingTitle}` : ''} size="lg">
      {!guesses.data ? (
        <Loader />
      ) : (
        <Stack gap="xs">
          <Text size="sm" c="dimmed">
            Each game gets its own line on the way, and arrives on its own.{' '}
            {lotCents !== null ? `The ${money(lotCents, currency)} is shared evenly; type a game's price to give it its own, and the rest share what's left.` : 'The email gave no price.'}
          </Text>
          {games.map((g, k) => {
            const share = g.price === '' && lotCents !== null ? shares[shared++] : undefined;
            return (
              <Group key={k} gap="xs" align="flex-end" wrap="nowrap">
                <TextInput label={k === 0 ? 'Game' : undefined} aria-label={`Game ${k + 1}`} value={g.title} onChange={(e) => set(k, { title: e.currentTarget.value })} style={{ flex: 2 }} maxLength={200} />
                <Select label={k === 0 ? 'Console' : undefined} aria-label={`Console of game ${k + 1}`} data={consoles} value={g.platformKey} onChange={(v) => set(k, { platformKey: v })} searchable style={{ flex: 1.3 }} placeholder="Which?" />
                <NumberInput
                  label={k === 0 ? `Price (${currency})` : undefined}
                  aria-label={`Price of game ${k + 1}`}
                  value={g.price}
                  onChange={(v) => set(k, { price: v })}
                  min={0}
                  decimalScale={2}
                  allowNegative={false}
                  placeholder={share !== undefined ? (share / 100).toFixed(2) : ''}
                  disabled={item?.paidInCurrencyCents != null}
                  w={110}
                />
                <CloseButton aria-label={`Remove game ${k + 1}`} onClick={() => setGames((all) => all.filter((_, i) => i !== k))} disabled={games.length <= 2} mb={6} />
              </Group>
            );
          })}
          {item?.paidInCurrencyCents != null && (
            <Text size="xs" c="dimmed">
              Bought in {item.currency}: shared evenly in it, then each game's share is turned into {currency} at the order day's rate.
            </Text>
          )}
          <Group justify="space-between">
            <Button variant="subtle" leftSection={<IconPlus size={14} />} onClick={() => setGames((all) => [...all, { title: '', platformKey: all.at(-1)?.platformKey ?? null, price: '' }])} disabled={games.length >= 40}>
              Another game
            </Button>
            <Button onClick={() => split.mutate()} loading={split.isPending} disabled={games.filter((g) => g.title.trim()).length < 2}>
              Split it
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
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
  // The page's own switch (D195); the email switch only says whether purchase emails are read.
  const on = useSetting('orders.page', true) === true;
  const watching = useSetting('orders.watch', false) === true;
  const list = useQuery({ queryKey: ['coming'], queryFn: () => api<{ on: boolean; items: ComingItem[] }>('/coming'), refetchInterval: 30_000 });
  const status = useQuery({ queryKey: ['orders', 'status'], queryFn: () => api<OrdersStatus>('/orders'), refetchInterval: 30_000 });
  const [editing, setEditing] = useState<CopyRef | null>(null);
  const [splitting, setSplitting] = useState<ComingItem | null>(null);
  // An order page in (D176): its games added, or an Amazon order's unnamed game named.
  const [paging, setPaging] = useState<{ into: { id: number; label: string } | null } | null>(null);
  const history = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api<{ items: number; games: number; added: number; have: number; unsure: number }>('/coming/amazon-history', { method: 'POST', body: form });
    },
    onSuccess: (r) => {
      notifySuccess(
        `${r.games} of its ${r.items} items are games: ${r.added} on the way to check and add${r.have > 0 ? `, ${r.have} you have already (left out)` : ''}${r.unsure > 0 ? `, ${r.unsure} to say which game` : ''}.`,
        "Amazon's order history",
      );
      void refresh();
    },
    onError: (err) => notifyError(err),
  });
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
      return addedCopyRef(added, added, boughtCondition);
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
        description="Games you bought that haven't arrived: from an order page, Amazon's order history, a purchases CSV, Claude or your purchase emails. They aren't in your collection yet: not counted, not on your lists, never sent to PriceCharting. When one comes, It's here adds it with what you paid and the day, and opens its window for the rest."
        actions={
          <Group gap="xs">
            <Button variant="default" leftSection={<IconClipboardText size={16} />} onClick={() => setPaging({ into: null })}>
              Add from an order page
            </Button>
            <FileButton onChange={(file) => file && history.mutate(file)} accept=".zip,.csv,application/zip,text/csv">
              {(props) => (
                <Button {...props} variant="default" leftSection={<IconFileImport size={16} />} loading={history.isPending}>
                  Amazon's order history
                </Button>
              )}
            </FileButton>
            {on && watching && (
              <Button variant="default" leftSection={<IconMailSearch size={16} />} loading={check.isPending} onClick={() => check.mutate()} disabled={!s?.account}>
                Check my email now
              </Button>
            )}
          </Group>
        }
      />
      {!on ? (
        <Text c="dimmed">
          On the way is off.{' '}
          <Anchor component={Link} to="/settings/features#setting-orders.page">
            Turn it on in Settings › Features
          </Anchor>{' '}
          to keep the games you bought here until they arrive.
        </Text>
      ) : (
        <Stack gap="sm">
          {!watching && (
            <Text size="xs" c="dimmed">
              Your purchase emails aren't read for it.{' '}
              <Anchor component={Link} to="/settings/email#setting-orders.watch" size="xs">
                Settings › Email › On the way
              </Anchor>{' '}
              has Squirrelcade look for your eBay and Mercari purchases (and the stores you name) every day or as often as you like.
            </Text>
          )}
          {watching && s?.problem && (
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
                        {item.expectedOn ? ` · expected ${date(item.expectedOn, dateFormat)}` : ''}
                        {item.paidCents !== null ? ` · ${money(item.paidCents, currency)}` : ''}
                        {item.paidInCurrencyCents !== null ? ` (${money(item.paidInCurrencyCents, cur)}${item.paidCents === null ? ', not turned into yours yet' : ''})` : ''}
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
                      {item.several && (
                        <Group gap={6}>
                          <Text size="xs">Several games for one price?</Text>
                          <Button size="compact-xs" variant="light" onClick={() => setSplitting(item)}>
                            Split it into its games
                          </Button>
                        </Group>
                      )}
                      {/* Amazon's email names no game (D176): its order page names it. */}
                      {item.unknown && (
                        <Group gap={6}>
                          <Button size="compact-xs" variant="light" leftSection={<IconClipboardText size={12} />} onClick={() => setPaging({ into: { id: item.id, label: item.orderNumber ? `Amazon order ${item.orderNumber}` : 'Amazon order' } })}>
                            Name it from its order page
                          </Button>
                          {item.link && (
                            <Anchor href={item.link} target="_blank" rel="noreferrer" size="xs">
                              Open the order on Amazon <IconExternalLink size={11} />
                            </Anchor>
                          )}
                        </Group>
                      )}
                      {!known && !item.unknown && <WhichGame item={item} onPick={(g) => pick.mutate({ id: item.id, ...g })} />}
                      {!known && !item.several && !item.unknown && item.lotOf === null && (
                        <Anchor size="xs" c="dimmed" onClick={() => setSplitting(item)}>
                          It's several games
                        </Anchor>
                      )}
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
      <OrderPageModal
        opened={paging !== null}
        into={paging?.into}
        onClose={() => setPaging(null)}
        onDone={() => {
          setPaging(null);
          void refresh();
        }}
      />
      <SplitLot
        item={splitting}
        onClose={() => setSplitting(null)}
        onDone={() => {
          setSplitting(null);
          void refresh();
        }}
      />
    </>
  );
}
