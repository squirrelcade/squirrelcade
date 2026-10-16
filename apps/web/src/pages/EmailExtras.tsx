import { Anchor, Badge, Button, Checkbox, Group, Loader, ScrollArea, Stack, Text } from '@mantine/core';
import { IconExternalLink, IconPlugConnected, IconSearch } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { count, date } from '../format';
import { notifyError, useSetting } from '../hooks';

/** One check's outcome: whether it worked, and what happened in a line. */
interface Outcome {
  ok: boolean;
  message: string;
}

/**
 * Settings > Email's one test, under the app password: sends a message from your account and reads its mailbox (the
 * one PriceCharting's emails go to), so one click shows whether both work. Saves the page first.
 */
export function EmailTest({ unsaved, save }: { unsaved: boolean; save: () => Promise<boolean> }) {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<{ send: Outcome; read: Outcome } | null>(null);
  const test = useMutation({
    mutationFn: async () => {
      if (unsaved && !(await save())) return null;
      return api<{ send: Outcome; read: Outcome }>('/email/test', { method: 'POST' });
    },
    onSuccess: (r) => {
      if (!r) return;
      setResult(r);
      void queryClient.invalidateQueries({ queryKey: ['mail'] });
    },
    onError: (err) => notifyError(err, 'Email'),
  });
  return (
    <Stack gap={6}>
      <Group gap="sm">
        <Button variant="default" leftSection={<IconPlugConnected size={14} />} loading={test.isPending} onClick={() => test.mutate()}>
          {unsaved ? 'Save and test' : 'Test sending and reading'}
        </Button>
        <Anchor href="https://www.pricecharting.com/my-collection" target="_blank" rel="noreferrer" size="sm">
          Export on PriceCharting <IconExternalLink size={12} />
        </Anchor>
      </Group>
      {result && (
        <Stack gap={2} role="status">
          {(
            [
              ['Sending', result.send],
              ['Reading', result.read],
            ] as const
          ).map(([what, o]) => (
            <Text key={what} size="sm" c={o.ok ? 'green' : 'red'}>
              {o.ok ? '✓' : '✗'} {what}: {o.message}
            </Text>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

/** A store found in your purchase emails (POST /api/v1/orders/stores). */
interface StoreSeen {
  domain: string;
  name: string;
  emails: number;
  lastSubject: string;
  lastDate: string;
  known: boolean;
}

interface StoresJob {
  id: string;
  state: 'reading' | 'done' | 'failed';
  stores: StoreSeen[];
  read: number;
  days: number;
  error: string | null;
}

/**
 * Find my stores, under On the way's "Purchase emails from": the stores of your purchase emails (their senders and
 * subjects only, nothing else read or kept), each with how many, to tick and add to the list. Saves the page first.
 */
export function StoreFinder({ unsaved, save, current, onAdd }: { unsaved: boolean; save: () => Promise<boolean>; current: readonly string[]; onAdd: (domains: string[]) => void }) {
  const days = useSetting('orders.lookBackDays', 365);
  const dateFormat = useSetting('general.dateFormat', 'us');
  const [job, setJob] = useState<StoresJob | null>(null);
  const [ticked, setTicked] = useState<string[]>([]);
  const start = useMutation({
    mutationFn: async () => {
      if (unsaved && !(await save())) return null;
      return api<StoresJob>('/orders/stores', { method: 'POST' });
    },
    onSuccess: (j) => {
      if (!j) return;
      setJob(j);
      setTicked([]);
    },
    onError: (err) => notifyError(err, 'Find my stores'),
  });
  // Asked again until the search is done (a year of email takes a little while).
  const poll = useQuery({
    queryKey: ['orders', 'stores', job?.id],
    queryFn: () => api<StoresJob>(`/orders/stores/${job!.id}`),
    enabled: job !== null && job.state === 'reading',
    refetchInterval: (q) => (q.state.data && q.state.data.state !== 'reading' ? false : 1500),
  });
  const now = poll.data ?? job;
  const has = new Set(current.map((c) => c.trim().toLowerCase().replace(/^@/, '')));
  const fresh = (now?.stores ?? []).filter((s) => !has.has(s.domain));
  return (
    <Stack gap={6}>
      <Group gap="sm">
        <Button variant="default" leftSection={<IconSearch size={14} />} loading={start.isPending || now?.state === 'reading'} onClick={() => start.mutate()}>
          {unsaved ? 'Save and find my stores' : 'Find my stores in my email'}
        </Button>
        {!now && (
          <Text size="xs" c="dimmed">
            Lists the stores of your purchase emails from the last {count(days)} days, to add with a tick. Only their senders and subjects are read; nothing is kept.
          </Text>
        )}
      </Group>
      {now?.state === 'reading' && (
        <Group gap="xs">
          <Loader size="xs" />
          <Text size="sm">Looking through {count(now.days)} days of your email…</Text>
        </Group>
      )}
      {now?.state === 'failed' && (
        <Text size="sm" c="red">
          {now.error}
        </Text>
      )}
      {now?.state === 'done' && (
        <Stack gap="xs" role="status">
          <Text size="sm">
            {now.stores.length === 0
              ? `No purchase emails in the last ${count(now.days)} days (${count(now.read)} emails looked at).`
              : `${count(now.stores.length)} ${now.stores.length === 1 ? 'store' : 'stores'} in ${count(now.read)} purchase emails from the last ${count(now.days)} days. Tick the ones you buy games from.`}
          </Text>
          {now.stores.length > 0 && (
            <ScrollArea.Autosize mah={360} type="auto" offsetScrollbars>
              {/* The stores already in the list show ticked (and stay so); the rest are yours to tick. */}
              <Checkbox.Group value={[...ticked, ...now.stores.filter((s) => has.has(s.domain)).map((s) => s.domain)]} onChange={(v) => setTicked(v.filter((d) => !has.has(d)))}>
                <Stack gap={8}>
                  {now.stores.map((s) => {
                    const added = has.has(s.domain);
                    return (
                      <Checkbox
                        key={s.domain}
                        value={s.domain}
                        disabled={added}
                        label={
                          <Group gap={6} wrap="wrap">
                            <Text size="sm" fw={500}>
                              {s.name}
                            </Text>
                            <Text size="xs" c="dimmed">
                              {s.domain}
                            </Text>
                            {s.known && (
                              <Badge size="xs" variant="light" color="green" style={{ textTransform: 'none' }}>
                                Squirrelcade reads its orders
                              </Badge>
                            )}
                            {added && (
                              <Badge size="xs" variant="light" color="gray" style={{ textTransform: 'none' }}>
                                in the list
                              </Badge>
                            )}
                          </Group>
                        }
                        description={`${count(s.emails)} purchase ${s.emails === 1 ? 'email' : 'emails'}; the newest ${date(s.lastDate, dateFormat)}: “${s.lastSubject}”`}
                      />
                    );
                  })}
                </Stack>
              </Checkbox.Group>
            </ScrollArea.Autosize>
          )}
          {fresh.length > 0 && (
            <Group gap="sm">
              <Button
                size="xs"
                disabled={ticked.length === 0}
                onClick={() => {
                  onAdd(ticked);
                  setTicked([]);
                }}
              >
                Add {ticked.length > 0 ? `the ${count(ticked.length)} ticked` : 'the ticked stores'}
              </Button>
              <Text size="xs" c="dimmed">
                Then Save changes.
              </Text>
            </Group>
          )}
        </Stack>
      )}
    </Stack>
  );
}
