import { Anchor, Button, Card, Group, Loader, Stack, Text } from '@mantine/core';
import { IconExternalLink, IconMailSearch } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from './api';
import { date, money } from './format';
import { notifyError, useSetting } from './hooks';

/**
 * Prices from your order emails (D155): one order found for a copy, as the server reads it (POST /api/v1/orders/find).
 * The amounts are the copy's share of its order; paidCents is what Settings > Email counts as the price paid.
 */
export interface FoundPrice {
  store: string;
  date: string | null;
  orderNumber: string | null;
  itemTitle: string;
  quantity: number;
  currency: string | null;
  itemCents: number | null;
  taxCents: number | null;
  shippingCents: number | null;
  discountCents: number | null;
  paidCents: number | null;
  link: string | null;
  readBy: 'ai' | 'plain';
}

interface FindJob {
  id: string;
  state: 'reading' | 'done' | 'failed';
  found: FoundPrice[];
  read: number;
  message: string | null;
  error: string | null;
}

/** What Settings > Email counts as the price paid, in a few words. */
export const COUNTS_SAID: Record<string, string> = { item: 'the item alone', tax: 'the item and its tax', all: 'the item, its tax and its shipping' };

/** Whether Find in my email is on (Settings > Email). */
export function useOrdersOn(): boolean {
  return useSetting('orders.find', false) === true;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Asks the server to look for a copy's order and waits for its answer (a mailbox search, then a model's reading). */
export async function findInEmail(copyId: number): Promise<FindJob> {
  let job = await api<FindJob>('/orders/find', { method: 'POST', json: { copyId } });
  const until = Date.now() + 10 * 60_000;
  while (job.state === 'reading' && Date.now() < until) {
    await wait(1500);
    job = await api<FindJob>(`/orders/find/${job.id}`);
  }
  if (job.state === 'failed') throw new Error(job.error ?? "Your mailbox couldn't be searched.");
  if (job.state === 'reading') throw new Error('Reading your emails took too long. Try again in a moment.');
  return job;
}

/** One found order in a line: the store and day, the item's price, its share of the tax and shipping, the price paid. */
export function FoundPriceLine({ f, currency, size = 'sm' }: { f: FoundPrice; currency: string; size?: 'xs' | 'sm' }) {
  const dateFormat = useSetting('general.dateFormat', 'us');
  const cur = f.currency ?? currency;
  const parts = [
    f.itemCents !== null ? `item ${money(f.itemCents, cur)}${f.quantity > 1 ? ` each (${f.quantity})` : ''}` : 'no price for the item',
    f.taxCents !== null ? `tax ${money(f.taxCents, cur)}` : null,
    f.shippingCents !== null ? `shipping ${money(f.shippingCents, cur)}` : null,
    f.discountCents ? `off ${money(f.discountCents, cur)}` : null,
  ].filter(Boolean);
  return (
    <Text size={size} component="div">
      <Text span fw={600} size={size}>
        {f.store}
      </Text>
      {f.date ? ` · ${date(f.date, dateFormat)}` : ''} · {parts.join(' · ')}
      {f.link && (
        <>
          {' · '}
          <Anchor href={f.link} target="_blank" rel="noreferrer" size={size}>
            {f.store === 'eBay' || f.store === 'Mercari' ? 'listing' : 'order'} <IconExternalLink size={11} />
          </Anchor>
        </>
      )}
      <Text size="xs" c="dimmed">
        “{f.itemTitle}”{f.orderNumber ? `, order ${f.orderNumber}` : ''}
        {f.readBy === 'ai' ? ', read by the AI model' : ''}
      </Text>
    </Text>
  );
}

/**
 * Find in my email, beside a copy's Price paid: the mailbox searched for the game's order or receipt; the best one
 * found fills in the price and the day (nothing is saved until the copy is), the others can be picked instead. One
 * found before (Look up prices in my email) is filled in as the window opens, the day only where there's none.
 */
export function FindInEmail({ copyId, title, onUse, initial = null }: { copyId: number; title: string; onUse: (f: FoundPrice, asked: boolean) => void; initial?: FoundPrice | null }) {
  const currency = useSetting('general.currency', 'USD');
  const counts = useSetting('orders.paidCounts', 'item');
  const [result, setResult] = useState<FindJob | null>(null);
  const [used, setUsed] = useState<number | null>(null);
  // A price Look up prices in my email found: shown and filled in, as a search here would.
  useEffect(() => {
    if (!initial) return;
    setResult({ id: '', state: 'done', found: [initial], read: 1, message: null, error: null });
    if (initial.paidCents !== null) {
      setUsed(0);
      onUse(initial, false);
    }
    // Once, as the window opens.
  }, []);
  const find = useMutation({
    mutationFn: () => findInEmail(copyId),
    onSuccess: (job) => {
      setResult(job);
      const best = job.found.findIndex((f) => f.paidCents !== null);
      if (best >= 0) {
        setUsed(best);
        onUse(job.found[best]!, true);
      } else setUsed(null);
    },
    onError: (err) => notifyError(err, 'Find in my email'),
  });
  return (
    <Stack gap={4}>
      <Group gap="xs">
        <Button variant="default" size="compact-sm" leftSection={find.isPending ? <Loader size={12} /> : <IconMailSearch size={14} />} onClick={() => find.mutate()} disabled={find.isPending}>
          {find.isPending ? 'Looking in your email…' : 'Find in my email'}
        </Button>
        {find.isPending && (
          <Text size="xs" c="dimmed">
            Searching for {title}'s order or receipt
          </Text>
        )}
      </Group>
      {result && (
        <Card withBorder padding="xs" role="status">
          {result.found.length === 0 ? (
            <Text size="sm" c="dimmed">
              {result.message}
            </Text>
          ) : (
            <Stack gap={6}>
              {result.found.map((f, i) => (
                <Group key={i} justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <FoundPriceLine f={f} currency={currency} />
                  </div>
                  {f.paidCents !== null &&
                    (used === i ? (
                      <Text size="xs" c="green" style={{ whiteSpace: 'nowrap' }}>
                        ✓ Filled in
                      </Text>
                    ) : (
                      <Button
                        size="compact-xs"
                        variant="light"
                        style={{ flexShrink: 0 }}
                        onClick={() => {
                          setUsed(i);
                          onUse(f, true);
                        }}
                      >
                        Use this
                      </Button>
                    ))}
                </Group>
              ))}
              <Text size="xs" c="dimmed">
                The price paid is {COUNTS_SAID[counts] ?? counts} (Settings › Email). Check it, then save the copy: nothing is kept until then.
              </Text>
            </Stack>
          )}
        </Card>
      )}
    </Stack>
  );
}

/** A price Look up prices in my email found for a copy, kept until used or turned down (GET /api/v1/orders/found). */
export interface StoredFound extends FoundPrice {
  copyId: number;
  at: string;
}

interface BatchJob {
  id: string;
  state: 'reading' | 'done' | 'failed';
  total: number;
  done: number;
  found: number;
  error: string | null;
}

/**
 * The prices found for copies (Collection › Improve), by copy: Use it saves one as the copy's price paid (and the day,
 * when the copy has none), Not this forgets it.
 */
export function useFoundPrices(on: boolean) {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ['orders', 'found'], queryFn: () => api<{ found: StoredFound[] }>('/orders/found'), enabled: on });
  const byCopy = new Map((list.data?.found ?? []).map((f) => [f.copyId, f]));
  const forget = useMutation({
    mutationFn: (copyId: number) => api(`/orders/found/${copyId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['orders', 'found'] }),
    onError: (err) => notifyError(err),
  });
  const use = useMutation({
    mutationFn: async ({ copy }: { copy: { id: number; datePurchased: string | null }; then: () => unknown }) => {
      const f = byCopy.get(copy.id);
      if (!f || f.paidCents === null) return;
      await api(`/collection/copies/${copy.id}`, { method: 'PUT', json: { costCents: f.paidCents, ...(!copy.datePurchased && f.date ? { datePurchased: f.date } : {}) } });
      await api(`/orders/found/${copy.id}`, { method: 'DELETE' });
    },
    onSuccess: async (_r, { then }) => {
      await queryClient.invalidateQueries({ queryKey: ['orders', 'found'] });
      await then();
    },
    onError: (err) => notifyError(err),
  });
  return {
    of: (copyId: number) => byCopy.get(copyId),
    use: (copy: { id: number; datePurchased: string | null }, then: () => unknown) => use.mutate({ copy, then }),
    using: use.isPending ? (use.variables?.copy.id ?? null) : null,
    forget: (copyId: number) => forget.mutate(copyId),
  };
}

/**
 * Look up prices in my email (Collection › Improve, D155): the copies still missing a price, on the console and with
 * Added here as the page has them, looked for in the mailbox one after another; each found waits beside its copy.
 */
export function LookUpPrices({ platform, addedHere, recentDays, label = 'Look up prices in my email' }: { platform: string | null; addedHere: boolean; recentDays?: number; label?: string }) {
  const queryClient = useQueryClient();
  const [job, setJob] = useState<BatchJob | null>(null);
  const start = useMutation({
    mutationFn: async () => {
      let j = await api<BatchJob>('/orders/batch', { method: 'POST', json: { ...(platform ? { platform } : {}), ...(addedHere ? { added: 'here' } : {}), ...(recentDays ? { recentDays } : {}) } });
      setJob(j);
      const until = Date.now() + 30 * 60_000;
      while (j.state === 'reading' && Date.now() < until) {
        await wait(2000);
        j = await api<BatchJob>(`/orders/batch/${j.id}`);
        setJob(j);
        // What's found shows as it comes.
        void queryClient.invalidateQueries({ queryKey: ['orders', 'found'] });
      }
      if (j.state === 'failed') throw new Error(j.error ?? "Your mailbox couldn't be searched.");
      return j;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['orders', 'found'] }),
    onError: (err) => notifyError(err, 'Look up prices in my email'),
  });
  return (
    <Group gap={6} wrap="wrap">
      <Button size="compact-sm" variant="light" leftSection={start.isPending ? <Loader size={12} /> : <IconMailSearch size={14} />} onClick={() => start.mutate()} disabled={start.isPending}>
        {label}
      </Button>
      {job && job.state !== 'failed' && (
        <Text size="xs" c="dimmed" role="status">
          {job.state === 'reading' ? `Looked for ${job.done} of ${job.total}: ` : ''}
          {job.total === 0 ? 'no copy is missing a price.' : `${job.found} ${job.found === 1 ? 'price' : 'prices'} found${job.state === 'reading' ? '' : ` for ${job.total} ${job.total === 1 ? 'copy' : 'copies'}`}.`}
        </Text>
      )}
    </Group>
  );
}
