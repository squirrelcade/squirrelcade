import { Anchor, Badge, Button, Group, Loader, Select, Stack, Table, Tabs, Text, Tooltip } from '@mantine/core';
import { IconCheck, IconX } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../api';
import { PageHeader, type SortDirection } from '../components';
import { count, date } from '../format';
import { notifyError, useSetting } from '../hooks';
import { GameTitle } from '../GameDrawer';
import { sortRows, useSort } from '../sort';

/** A copy whose file (PriceCharting's export, the owner's spreadsheet) no longer has it. */
export interface MissingCopy {
  id: number;
  key: string;
  title: string;
  platform: string | null;
  platformKey: string | null;
  condition: string;
  source: 'pricecharting' | 'spreadsheet' | 'squirrelcade';
  missingSince: string;
  valueCents: number | null;
  others: number;
}

const FILE_OF: Record<MissingCopy['source'], string> = { pricecharting: "PriceCharting's export", spreadsheet: 'your spreadsheet', squirrelcade: 'its file' };

/** The look-alikes' heading sorts them (D144): games A to Z; listed is the server's order, by console. */
const SORTS = { title: 'asc', listed: 'asc' } as const satisfies Record<string, SortDirection>;

interface Queue {
  lookAlikes: { platformKey: string; platform: string; entryId: number; title: string; suggestions: { productId: string; title: string; reason: string }[] }[];
  marked: { platformKey: string; platform: string; entryId: number; title: string; notes: string | null; conditional: boolean }[];
}

/** A mark's reason in plain words, where it came from the old system or a list's section ("Championship games"). */
function plainReason(reason: string): string | null {
  if (/No current PriceCharting market-price evidence/i.test(reason))
    return "From the old system: it found no price for these on PriceCharting, so it couldn't tell whether they ever came out on a disc or cartridge.";
  if (/living catalog refresh/i.test(reason)) return 'From the old system: added late, without checking that they came out where you live.';
  if (/Limited Editions|Promotional Giveaways/i.test(reason)) return 'Wikipedia lists these as limited editions or promotional giveaways, not ordinary store releases.';
  if (/Championship games/i.test(reason)) return 'Wikipedia lists these as competition cartridges, made for a contest rather than sold in stores.';
  if (/non-retail/i.test(reason)) return 'Wikipedia lists these as releases that were never sold in stores.';
  return null;
}

/** Marked games grouped by why they're marked, largest group first. */
function groups(items: Queue['marked']): [string, Queue['marked']][] {
  const by = new Map<string, Queue['marked']>();
  for (const x of items) {
    const reason = x.conditional ? 'Owned only through a conditional mapping (a compilation that may not include the full game)' : x.notes || 'Marked for review in the catalog';
    by.set(reason, [...(by.get(reason) ?? []), x]);
  }
  return [...by.entries()].sort((a, b) => b[1].length - a[1].length);
}

/** Every open review question across the consoles, answered in one place. */
export function ReviewPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'marked' ? 'marked' : params.get('tab') === 'copies' ? 'copies' : 'lookalikes';
  const [platform, setPlatform] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const sorting = useSort(SORTS, 'listed');
  const queryClient = useQueryClient();
  const dateFormat = useSetting('general.dateFormat', 'us');
  const queue = useQuery({ queryKey: ['catalogs', 'review'], queryFn: () => api<Queue>('/review') });
  const gone = useQuery({ queryKey: ['collection', 'missing'], queryFn: () => api<MissingCopy[]>('/collection/missing') });
  // The owner's answer about a copy its file no longer has; everything worked out from the collection follows.
  const answer = useMutation({
    mutationFn: (v: { id: number; answer: 'keep' | 'sold' | 'removed' }) => api(`/collection/missing/${v.id}`, { method: 'POST', json: { answer: v.answer } }),
    onSuccess: () => Promise.all([queryClient.invalidateQueries({ queryKey: ['collection'] }), queryClient.invalidateQueries({ queryKey: ['catalogs'] }), queryClient.invalidateQueries({ queryKey: ['wishlist'] })]),
    onError: (err) => notifyError(err),
  });
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['catalogs'] }), queryClient.invalidateQueries({ queryKey: ['wishlist'] })]);
  const decide = useMutation({
    mutationFn: (v: { entryId: number; productId: string; decision: 'confirmed' | 'rejected' }) => api('/catalogs/decisions', { method: 'POST', json: v }),
    onSuccess: refresh,
    onError: (err) => notifyError(err),
  });
  const setStatus = useMutation({
    mutationFn: (v: { entryId: number; targetStatus: 'required' | 'excluded' }) => api(`/catalogs/entries/${v.entryId}`, { method: 'PATCH', json: { targetStatus: v.targetStatus } }),
    onSuccess: refresh,
    onError: (err) => notifyError(err),
  });

  const q = queue.data;
  const platforms = q
    ? [...new Map([...q.lookAlikes, ...q.marked, ...(gone.data ?? []).filter((x) => x.platformKey && x.platform)].map((x) => [x.platformKey!, x.platform!])).entries()].map(([value, label]) => ({ value, label }))
    : [];
  const onConsole = (q?.lookAlikes ?? []).filter((x) => !platform || x.platformKey === platform);
  // Why a pair looks alike ("One title contains the other", "... (romanized differently)"), to answer alike ones together.
  const reasons = [...new Map(onConsole.flatMap((x) => x.suggestions.map((s) => s.reason)).map((r) => [r, onConsole.filter((x) => x.suggestions.some((s) => s.reason === r)).length])).entries()].sort((a, b) => b[1] - a[1]);
  const lookAlikes = sortRows(
    onConsole.filter((x) => !reason || x.suggestions.some((s) => s.reason === reason)),
    (x) => (sorting.by === 'title' ? x.title : onConsole.indexOf(x)),
    sorting.dir,
  );
  // Questions with one suggestion, the only kind "Same game for all" answers.
  const single = lookAlikes.filter((x) => x.suggestions.length === 1);
  const marked = (q?.marked ?? []).filter((x) => !platform || x.platformKey === platform);
  const setMany = useMutation({
    mutationFn: (v: { ids: number[]; targetStatus: 'required' | 'excluded' }) => api('/catalogs/entries/status', { method: 'POST', json: v }),
    onSuccess: refresh,
    onError: (err) => notifyError(err),
  });
  const confirmAll = useMutation({
    mutationFn: async (items: Queue['lookAlikes']) => {
      for (const x of items) await api('/catalogs/decisions', { method: 'POST', json: { entryId: x.entryId, productId: x.suggestions[0]!.productId, decision: 'confirmed' } });
    },
    onSuccess: refresh,
    onError: (err) => notifyError(err),
  });
  const busy = decide.isPending || setStatus.isPending || setMany.isPending || confirmAll.isPending || answer.isPending;
  const missing = (gone.data ?? []).filter((x) => !platform || x.platformKey === platform);

  function sameForAll(items: Queue['lookAlikes']) {
    const examples = items
      .slice(0, 5)
      .map((x) => `${x.suggestions[0]!.title} = ${x.title}`)
      .join('\n');
    if (window.confirm(`Answer "Same game" for these ${items.length} questions (one suggestion each)? For example:\n${examples}\n\nEach answer can be undone on its console's page.`)) confirmAll.mutate(items);
  }

  function bulk(items: Queue['marked'], targetStatus: 'required' | 'excluded') {
    const ids = items.filter((x) => !x.conditional).map((x) => x.entryId);
    const what = targetStatus === 'required' ? 'collecting targets' : 'excluded from the target';
    if (window.confirm(`Make ${ids.length} games ${what}? Each can be changed back on its console's page.`)) setMany.mutate({ ids, targetStatus });
  }

  return (
    <>
      <PageHeader help="matching"
        title="Review"
        description={
          <>
            Questions only you can answer. Until then these games count as neither owned nor missing, and aren't recommended.{' '}
            <Anchor component={Link} to="/help/matching" size="sm">
              How Squirrelcade decides what you own
            </Anchor>
          </>
        }
      />
      {!q ? (
        <Loader />
      ) : (
        <>
          <Group mb="sm" justify="space-between">
            <Tabs value={tab} onChange={(v) => setParams(v === 'marked' || v === 'copies' ? { tab: v } : {}, { replace: true })}>
              <Tabs.List>
                <Tabs.Tab value="lookalikes">
                  Look-alikes <Badge size="xs" ml={4}>{count(lookAlikes.length)}</Badge>
                </Tabs.Tab>
                <Tabs.Tab value="marked">
                  Marked in the catalog <Badge size="xs" ml={4} color="gray">{count(marked.length)}</Badge>
                </Tabs.Tab>
                <Tabs.Tab value="copies">
                  Copies <Badge size="xs" ml={4} color={missing.length > 0 ? undefined : 'gray'}>{count(missing.length)}</Badge>
                </Tabs.Tab>
              </Tabs.List>
            </Tabs>
            <Group gap="xs">
              {tab === 'lookalikes' && reasons.length > 1 && (
                <Select placeholder="Every reason" data={reasons.map(([r, n]) => ({ value: r, label: `${r} (${n})` }))} value={reason} onChange={setReason} clearable w={300} />
              )}
              <Select placeholder="All consoles" data={platforms} value={platform} onChange={setPlatform} clearable searchable w={240} />
            </Group>
          </Group>
          {tab === 'lookalikes' && reason && single.length > 1 && (
            <Group mb="sm" gap="xs">
              <Button size="compact-sm" color="green" variant="light" leftSection={<IconCheck size={14} />} loading={confirmAll.isPending} disabled={busy} onClick={() => sameForAll(single)}>
                Same game for all {count(single.length)} with one suggestion
              </Button>
              <Text size="xs" c="dimmed">
                Look them over first: each can be undone on its console's page.
              </Text>
            </Group>
          )}
          {tab === 'copies' ? (
            <Stack gap="xs">
              <Text size="sm" c="dimmed" maw={720}>
                The latest file of their kind no longer has these copies. They still count until you answer: kept, they're copies of your own that no file removes (you
                can add them back on PriceCharting); sold or gone, they leave your collection. Settings &gt; Collection &gt; Safety can remove them with the update
                instead.
              </Text>
              {missing.length === 0 ? (
                <Text c="dimmed" ta="center" mt="md">
                  No copies to ask about.
                </Text>
              ) : (
                <Table.ScrollContainer minWidth={320}>
                  <Table verticalSpacing={6} striped>
                    <Table.Tbody>
                      {missing.map((x) => (
                        <Table.Tr key={x.id}>
                          <Table.Td>
                            {x.platformKey ? <GameTitle platformKey={x.platformKey} title={x.title} fw={500} /> : <Text fw={500}>{x.title}</Text>}
                            <Text size="xs" c="dimmed">
                              {[x.platform, x.condition, x.others > 0 ? `you have ${count(x.others)} other cop${x.others === 1 ? 'y' : 'ies'}` : null].filter(Boolean).join(' · ')}
                              <br />
                              Not in {FILE_OF[x.source]} since {date(x.missingSince, dateFormat)}
                            </Text>
                          </Table.Td>
                          <Table.Td w={1}>
                            <Group gap={6} wrap="nowrap">
                              <Button size="compact-xs" variant="light" disabled={busy} onClick={() => answer.mutate({ id: x.id, answer: 'keep' })}>
                                I still have it
                              </Button>
                              <Button size="compact-xs" variant="default" disabled={busy} onClick={() => answer.mutate({ id: x.id, answer: 'sold' })}>
                                Sold
                              </Button>
                              <Button size="compact-xs" variant="default" disabled={busy} onClick={() => answer.mutate({ id: x.id, answer: 'removed' })}>
                                Gone
                              </Button>
                            </Group>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              )}
            </Stack>
          ) : tab === 'lookalikes' ? (
            lookAlikes.length === 0 ? (
              <Text c="dimmed" ta="center" mt="md">
                No look-alikes to check.
              </Text>
            ) : (
              <Table.ScrollContainer minWidth={320}>
                <Table verticalSpacing={6} striped>
                  <Table.Thead>
                    <Table.Tr>
                      {sorting.th('title', 'Catalog game')}
                      <Table.Th>Is it one of these you own?</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {lookAlikes.map((x) => (
                      <Table.Tr key={x.entryId}>
                        <Table.Td>
                          <GameTitle platformKey={x.platformKey} title={x.title} fw={500} />
                          <br />
                          <Anchor component={Link} to={`/platforms/${x.platformKey}?tab=review`} size="xs" c="dimmed">
                            {x.platform}
                          </Anchor>
                        </Table.Td>
                        <Table.Td>
                          <Stack gap={4}>
                            {x.suggestions.map((s) => (
                              <Group key={s.productId} gap={6} style={{ rowGap: 2 }}>
                                <Tooltip label={s.reason}>
                                  <Text size="sm">{s.title}</Text>
                                </Tooltip>
                                {!reason && (
                                  <Text size="xs" c="dimmed">
                                    {s.reason}
                                  </Text>
                                )}
                                <Button size="compact-xs" color="green" variant="light" leftSection={<IconCheck size={12} />} disabled={busy} onClick={() => decide.mutate({ entryId: x.entryId, productId: s.productId, decision: 'confirmed' })}>
                                  Same game
                                </Button>
                                <Button size="compact-xs" variant="default" leftSection={<IconX size={12} />} disabled={busy} onClick={() => decide.mutate({ entryId: x.entryId, productId: s.productId, decision: 'rejected' })}>
                                  Different
                                </Button>
                              </Group>
                            ))}
                          </Stack>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )
          ) : marked.length === 0 ? (
            <Text c="dimmed" ta="center" mt="md">
              Nothing marked for review.
            </Text>
          ) : (
            <Stack gap="lg">
              <Text size="sm" c="dimmed" maw={760}>
                Should these games be on your checklists? Each was marked as maybe not an ordinary store release, for the reason above its group. Until you answer, a
                game counts as neither owned nor missing, and it isn't recommended. <b>It's a target</b> puts it on its console's checklist: missing until you own it,
                and it can be recommended. <b>Not a target</b> leaves it off (you can change either on the console's page). Leaving them unanswered is fine.
              </Text>
              {groups(marked).map(([reason, items]) => (
                <Stack key={reason} gap="xs">
                  <Group justify="space-between" wrap="wrap" gap="xs">
                    <Stack gap={0} maw={640}>
                      <Text size="sm" fw={600}>
                        {reason} ({count(items.length)})
                      </Text>
                      {plainReason(reason) && (
                        <Text size="xs" c="dimmed">
                          {plainReason(reason)}
                        </Text>
                      )}
                    </Stack>
                    {items.some((x) => !x.conditional) && (
                      <Group gap={6}>
                        <Button size="compact-xs" variant="light" disabled={busy} onClick={() => bulk(items, 'required')}>
                          Make all {count(items.length)} targets
                        </Button>
                        <Button size="compact-xs" variant="default" disabled={busy} onClick={() => bulk(items, 'excluded')}>
                          Exclude all {count(items.length)}
                        </Button>
                      </Group>
                    )}
                  </Group>
                  <Table.ScrollContainer minWidth={320}>
                    <Table verticalSpacing={4} striped>
                      <Table.Tbody>
                        {items.map((x) => (
                          <Table.Tr key={x.entryId}>
                            <Table.Td>
                              <GameTitle platformKey={x.platformKey} title={x.title} fw={500} />
                              <br />
                              <Anchor component={Link} to={`/platforms/${x.platformKey}?tab=review`} size="xs" c="dimmed">
                                {x.platform}
                              </Anchor>
                            </Table.Td>
                            <Table.Td w={1}>
                              {!x.conditional && (
                                <Group gap={6} wrap="nowrap">
                                  <Button size="compact-xs" variant="light" disabled={busy} onClick={() => setStatus.mutate({ entryId: x.entryId, targetStatus: 'required' })}>
                                    It's a target
                                  </Button>
                                  <Button size="compact-xs" variant="default" disabled={busy} onClick={() => setStatus.mutate({ entryId: x.entryId, targetStatus: 'excluded' })}>
                                    Not a target
                                  </Button>
                                </Group>
                              )}
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                </Stack>
              ))}
            </Stack>
          )}
        </>
      )}
    </>
  );
}
