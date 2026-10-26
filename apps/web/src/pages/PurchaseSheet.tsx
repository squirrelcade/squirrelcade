import { Alert, Anchor, Button, Checkbox, FileButton, Group, Loader, Stack, Table, Text, Title } from '@mantine/core';
import { IconRefresh, IconUpload } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { PageHeader } from '../components';
import { count, date, money, timeAgo } from '../format';
import { notifyError, notifySuccess, useSetting } from '../hooks';

interface Audit {
  at: string;
  rows: number;
  games: number;
  gone: number;
  writes: { key: string; item: string; date: string | null; unitCents: number | null; orderNumber: string; platform: string; title: string; copyId: number; copyCostCents: number | null; copyDate: string | null }[];
  missing: { key: string; item: string; date: string | null; unitCents: number | null; orderNumber: string; platform: string | null; title: string | null; coming?: boolean; expectedOn?: string | null }[];
  consoles: { item: string; date: string | null; platform: string }[];
  leftOut?: { item: string; date: string | null; why: string }[];
}

/**
 * Your purchases (D178): what a purchases CSV's games would change, shown before anything is written. The copies you
 * have get the sheet's price and day (where they have none), its order number and ASIN; the games you don't have go on
 * the way, to check and add. Only what you tick, each row once.
 */
export function PurchaseSheetPage() {
  const queryClient = useQueryClient();
  const currency = useSetting('general.currency', 'USD');
  const dateFormat = useSetting('general.dateFormat', 'us');
  const data = useQuery({ queryKey: ['purchase-sheet'], queryFn: () => api<{ on: boolean; audit: Audit | null }>('/purchase-sheet') });
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const toggle = (key: string) => setChosen((s) => (s.has(key) ? new Set([...s].filter((k) => k !== key)) : new Set([...s, key])));
  const check = useMutation({
    mutationFn: () => api('/purchase-sheet/check', { method: 'POST' }),
    onSuccess: () => {
      notifySuccess('Squirrelcade is reading your purchases; what they would change shows here in a minute.', 'Reading');
      setTimeout(() => void queryClient.invalidateQueries({ queryKey: ['purchase-sheet'] }), 15000);
    },
    onError: (err) => notifyError(err),
  });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api<{ rows: number }>('/purchase-sheet/upload', { method: 'POST', body: form });
    },
    onSuccess: (r) => {
      notifySuccess(`${count(r.rows)} rows saved; what they would change shows here in a minute.`, 'Your purchases');
      setTimeout(() => void queryClient.invalidateQueries({ queryKey: ['purchase-sheet'] }), 15000);
    },
    onError: (err) => notifyError(err),
  });
  const apply = useMutation({
    mutationFn: () => api<{ written: number; onTheWay: number }>('/purchase-sheet/apply', { method: 'POST', json: { keys: [...chosen] } }),
    onSuccess: (r) => {
      notifySuccess(`${r.written} ${r.written === 1 ? 'copy' : 'copies'} given their price and order; ${r.onTheWay} on the way to check and add.`, 'Done');
      setChosen(new Set());
      void queryClient.invalidateQueries();
    },
    onError: (err) => notifyError(err),
  });
  const a = data.data?.audit ?? null;
  const all = (keys: string[]) => setChosen((s) => new Set([...s, ...keys]));
  return (
    <>
      <PageHeader
        help="orders"
        title="Your purchases"
        description="What a CSV of your purchases would change in your collection. Nothing changes until you tick it and press Write the chosen."
        actions={
          <Group gap="xs">
            <FileButton onChange={(file) => file && upload.mutate(file)} accept=".csv,text/csv">
              {(props) => (
                <Button {...props} variant="default" leftSection={<IconUpload size={16} />} loading={upload.isPending} disabled={!data.data?.on}>
                  Upload a CSV
                </Button>
              )}
            </FileButton>
            <Button variant="default" leftSection={<IconRefresh size={16} />} loading={check.isPending} onClick={() => check.mutate()} disabled={!data.data?.on}>
              Read it again now
            </Button>
          </Group>
        }
      />
      {!data.data ? (
        <Loader />
      ) : !data.data.on ? (
        <Text c="dimmed">
          Reading a purchases CSV is off:{' '}
          <Anchor component={Link} to="/settings/sources">
            Settings › Sources › Purchases CSV
          </Anchor>
          .
        </Text>
      ) : !a ? (
        <Text c="dimmed">Nothing read yet: Upload a CSV, or Read it again now for the ones in its folder.</Text>
      ) : (
        <Stack gap="lg">
          <Text size="sm" c="dimmed">
            Read {timeAgo(a.at)}: {count(a.rows)} rows, {count(a.games)} games bought{a.gone > 0 ? ` (and ${count(a.gone)} cancelled or returned, left out)` : ''}.
          </Text>
          <Stack gap="xs">
            <Group justify="space-between">
              <Title order={3} size="h4">
                Games you have: their price and order ({count(a.writes.length)})
              </Title>
              {a.writes.length > 0 && (
                <Button size="compact-sm" variant="subtle" onClick={() => all(a.writes.map((w) => w.key))}>
                  Tick them all
                </Button>
              )}
            </Group>
            {a.writes.length === 0 ? (
              <Text size="sm" c="dimmed">
                Nothing to write.
              </Text>
            ) : (
              <Table striped>
                <Table.Tbody>
                  {a.writes.map((w) => (
                    <Table.Tr key={w.key}>
                      <Table.Td w={30}>
                        <Checkbox checked={chosen.has(w.key)} onChange={() => toggle(w.key)} aria-label={`Write ${w.title}`} />
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" fw={600}>
                          {w.title} · {w.platform}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {w.item}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">
                          {w.unitCents !== null ? money(w.unitCents, currency) : '—'}
                          {w.date ? `, ${date(w.date, dateFormat)}` : ''}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {w.copyCostCents ? `the copy says ${money(w.copyCostCents, currency)}: kept` : 'the copy has no price'}
                          {w.copyDate ? '; its day kept' : ''} · order {w.orderNumber}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Stack>
          <Stack gap="xs">
            <Group justify="space-between">
              <Title order={3} size="h4">
                Games bought that aren't in your collection ({count(a.missing.length)})
              </Title>
              {a.missing.length > 0 && (
                <Button size="compact-sm" variant="subtle" onClick={() => all(a.missing.map((m) => m.key))}>
                  Tick them all
                </Button>
              )}
            </Group>
            <Text size="xs" c="dimmed">
              Ticked, each goes on On the way with its price and day, to check and add (or Not coming, for one you sold or gave away).
            </Text>
            {a.missing.length > 0 && (
              <Table striped>
                <Table.Tbody>
                  {a.missing.map((m) => (
                    <Table.Tr key={m.key}>
                      <Table.Td w={30}>
                        <Checkbox checked={chosen.has(m.key)} onChange={() => toggle(m.key)} aria-label={`Put ${m.title ?? m.item} on the way`} />
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" fw={600}>
                          {m.title ? `${m.title} · ${m.platform}` : m.item}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {m.title ? m.item : m.platform ? `${m.platform}: Squirrelcade isn't sure which game` : "Squirrelcade isn't sure which game or console"}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">
                          {m.unitCents !== null ? money(m.unitCents, currency) : '—'}
                          {m.date ? `, ${date(m.date, dateFormat)}` : ''}
                        </Text>
                        {m.coming && (
                          <Text size="xs" c="blue">
                            Not shipped yet{m.expectedOn ? `: expected ${date(m.expectedOn, dateFormat)}` : ''}
                          </Text>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Stack>
          {a.consoles.length > 0 && (
            <Stack gap={4}>
              <Title order={3} size="h4">
                Consoles and their accessories bought ({count(a.consoles.length)})
              </Title>
              {a.consoles.map((c, k) => (
                <Text key={k} size="sm">
                  {c.platform}: {c.item}
                  {c.date ? `, ${date(c.date, dateFormat)}` : ''}
                </Text>
              ))}
            </Stack>
          )}
          {(a.leftOut?.length ?? 0) > 0 && (
            <Stack gap={4}>
              <Title order={3} size="h4">
                Left out ({count(a.leftOut!.length)})
              </Title>
              <Text size="xs" c="dimmed">
                Not put on the way or written anywhere. Console games bought as digital codes count when Settings › Email › Count console games bought as digital codes is on.
              </Text>
              {a.leftOut!.map((l, k) => (
                <Text key={k} size="sm">
                  {l.item}
                  {l.date ? `, ${date(l.date, dateFormat)}` : ''}: {l.why}
                </Text>
              ))}
            </Stack>
          )}
          <Group>
            <Button onClick={() => apply.mutate()} loading={apply.isPending} disabled={chosen.size === 0}>
              Write the chosen ({count(chosen.size)})
            </Button>
          </Group>
          {chosen.size > 0 && (
            <Alert variant="light" color="gray">
              A copy's own price and day stay where it has them; its order number and ASIN are added.
            </Alert>
          )}
        </Stack>
      )}
    </>
  );
}
