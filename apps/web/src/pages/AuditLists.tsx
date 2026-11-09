import { Alert, Anchor, Badge, Button, Card, Group, Loader, Modal, Progress, Select, Stack, Text, TextInput } from '@mantine/core';
import { IconCamera, IconSearch } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { StashMark } from '../Acorn';
import { api, errorMessage } from '../api';
import { addedText, byConsole, conditionText, findCopies, OUTCOMES, percent, type AuditCopy, type AuditSummary, type Outcome, type SeenCopy } from '../audit';
import { type Answer } from '../choices';
import { PageHeader } from '../components';
import { addedCopyRef, CopyDetailsModal, TOUCHED, type CopyRef } from '../CopyDetails';
import { count } from '../format';
import { notifyError, notifySuccess, useSetting } from '../hooks';
import { isBarcode } from '../lines';
import { ScannerModal } from '../ScannerModal';
import { remember, remembered } from '../ShelfReader';

/**
 * The collection audit's lists (1.5.0, R05): Tick by hand (a console's copies not seen yet, tap to tick), Not seen yet
 * (what became of each: found, sold, lent, given away, lost), a barcode that ticks its copies, and Add it as Store
 * Mode adds a game, told to the audit.
 */

/** The audit's console picked last (a shelf, Tick by hand), kept on this phone. */
export const AUDIT_CONSOLE = 'squirrelcade.auditConsole';

/** Rows shown at first in a long list; "Show more" shows the next as many. */
const PAGE = 60;

/** Refreshes the audit's progress (its copies' lists keep their rows, so a tick can be undone where it was made). */
export function useAuditRefresh() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['audit'], exact: true });
}

/** A game to add: its console, and its title (the catalog game's, when it has one). */
export interface AddGame {
  platformKey: string;
  platform: string;
  title: string;
}

/**
 * Add it, as Store Mode adds a game, then told to the audit (counted as seen, and noted on its shelf), and the copy's
 * walk-through opens. Always as Add a game adds one, with the catalog game's own title (so it counts the same): not as
 * bought today (POST /purchases), since a game found on your shelf is one you've had, and its day isn't known.
 */
export function useAuditAdd(audit: AuditSummary) {
  const queryClient = useQueryClient();
  const refresh = useAuditRefresh();
  const usual = useSetting('collection.boughtCondition', 'complete');
  const [editing, setEditing] = useState<CopyRef | null>(null);
  const add = useMutation({
    mutationFn: async ({ game, shelfId }: { game: AddGame; shelfId?: number | null }) => {
      const made = (await api<{ copy: { id: number; key: string } }>('/collection/copies', { method: 'POST', json: { platformKey: game.platformKey, title: game.title, completeness: usual } })).copy;
      await api(`/audit/${audit.id}/added`, { method: 'POST', json: { copyKey: made.key, shelfId: shelfId ?? null, title: game.title } });
      return made;
    },
    onSuccess: async (made, { game }) => {
      notifySuccess(`${game.title} is in your collection, and counts as seen.`, 'Added');
      setEditing(await addedCopyRef(game, made, usual));
      void refresh();
      await Promise.all(TOUCHED.map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
    },
    onError: (err) => notifyError(err),
  });
  const modal = <CopyDetailsModal copy={editing} added onClose={() => setEditing(null)} />;
  return { add, modal };
}

/** Store Mode's answer to a barcode: the games it may be, the barcode's own console first. */
interface BarcodeResult {
  platformKey: string;
  platform: string;
  title: string;
  answer: Answer;
  ownedAs: string[];
}
interface BarcodeAnswer {
  code: string;
  known: boolean;
  productName: string | null;
  platformKey?: string | null;
  results: BarcodeResult[];
  message: string | null;
  retryInSeconds?: number | null;
}

const owned = (r: BarcodeResult) => r.answer === 'own' || r.answer === 'own-not-in-catalog';

/**
 * Scan a barcode: its game on its console ticks that console's copies, or, when it isn't logged, offers Add it. The
 * camera, or a handheld scanner (or fingers) typing the code into the box.
 */
export function AuditBarcode({ audit, opened, onClose }: { audit: AuditSummary; opened: boolean; onClose: () => void }) {
  const refresh = useAuditRefresh();
  const { add, modal } = useAuditAdd(audit);
  const [typed, setTyped] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [ticked, setTicked] = useState<Record<string, SeenCopy[] | 'none'>>({});
  const inAudit = useMemo(() => new Set(audit.consoles.map((c) => c.key)), [audit.consoles]);
  const lookup = useQuery({
    queryKey: ['audit-barcode', code],
    queryFn: () => api<BarcodeAnswer>(`/lookup/barcode/${code}`),
    enabled: code !== null,
    // A barcode waiting its turn with the barcode service: asked again when the server says.
    refetchInterval: (q) => (q.state.data?.retryInSeconds ? q.state.data.retryInSeconds * 1000 : false),
  });
  const b = lookup.data;
  // The barcode's own console when it names one, else every game it may be; only the audit's consoles count.
  const candidates = useMemo(() => {
    if (!b) return [];
    const on = b.platformKey ? b.results.filter((r) => r.platformKey === b.platformKey) : [];
    return (on.length > 0 ? on : b.results).filter((r) => inAudit.has(r.platformKey));
  }, [b, inAudit]);
  const tick = useMutation({
    mutationFn: (r: BarcodeResult) => api<{ seen: SeenCopy[]; unmatched: string[] }>(`/audit/${audit.id}/seen`, { method: 'POST', json: { platformKey: r.platformKey, titles: r.ownedAs.length > 0 ? r.ownedAs : [r.title], how: 'barcode' } }),
    onSuccess: (res, r) => {
      setTicked((t) => ({ ...t, [`${r.platformKey}|${r.title}`]: res.seen.length > 0 ? res.seen : 'none' }));
      void refresh();
    },
    onError: (err) => notifyError(err),
  });
  // One game you have, on the barcode's console: ticked at once, so a run of scans needs no taps.
  useEffect(() => {
    const only = candidates.length === 1 ? candidates[0]! : null;
    if (b && !b.retryInSeconds && only && owned(only) && !ticked[`${only.platformKey}|${only.title}`] && !tick.isPending) tick.mutate(only);
    // Once per barcode's answer.
  }, [b?.code, candidates.length]);

  const take = (value: string) => {
    const c = value.replace(/\D/g, '');
    if (!isBarcode(c)) return;
    setTyped('');
    setCode(c);
  };

  return (
    <>
      <Modal opened={opened} onClose={onClose} title="Scan a barcode" centered>
        <Stack gap="sm">
          <Text size="sm">A game's barcode ticks its copies on that console. One you haven't logged can be added here.</Text>
          <Group gap="xs" align="flex-end" wrap="nowrap">
            <TextInput
              label="Barcode"
              placeholder="Scan or type it"
              inputMode="numeric"
              value={typed}
              onChange={(e) => setTyped(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && take(typed)}
              style={{ flex: 1 }}
              data-autofocus
            />
            <Button variant="default" onClick={() => take(typed)} disabled={!isBarcode(typed.replace(/\D/g, ''))}>
              Look up
            </Button>
          </Group>
          <Button leftSection={<IconCamera size={18} />} onClick={() => setScanning(true)}>
            Use the camera
          </Button>
          {lookup.isFetching && !b && <Loader size="sm" />}
          {lookup.error && <Alert color="red">{errorMessage(lookup.error)}</Alert>}
          {b && (
            <Stack gap="xs">
              <Text size="xs" c="dimmed">
                Barcode {b.code}
                {b.productName ? `: ${b.productName}` : ''}
              </Text>
              {b.retryInSeconds ? <Text size="sm">Waiting its turn with the barcode service: asking again in {b.retryInSeconds} s…</Text> : null}
              {!b.retryInSeconds && candidates.length === 0 && (
                <Text size="sm">{b.results.length > 0 ? "It's a game on a console this audit doesn't cover." : (b.message ?? "This barcode wasn't found. Tick the game by hand instead.")}</Text>
              )}
              {candidates.map((r) => {
                const done = ticked[`${r.platformKey}|${r.title}`];
                return (
                  <Group key={`${r.platformKey}|${r.title}`} justify="space-between" wrap="nowrap" gap="xs">
                    <Stack gap={0} style={{ minWidth: 0 }}>
                      <Text size="sm" fw={600}>
                        {r.title}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {r.platform} · {owned(r) ? 'logged' : 'not logged'}
                      </Text>
                    </Stack>
                    {owned(r) ? (
                      done ? (
                        <Badge color="forest" variant="light" style={{ textTransform: 'none' }}>
                          {done === 'none' ? 'No copy found: tick it by hand' : `✓ ${done.length === 1 ? 'seen' : `${done.length} copies seen`}`}
                        </Badge>
                      ) : (
                        <Button size="compact-sm" onClick={() => tick.mutate(r)} loading={tick.isPending && tick.variables === r}>
                          Tick it
                        </Button>
                      )
                    ) : (
                      <Button size="compact-sm" variant="light" color="orange" onClick={() => add.mutate({ game: r })} loading={add.isPending && add.variables?.game === r}>
                        Add it
                      </Button>
                    )}
                  </Group>
                );
              })}
            </Stack>
          )}
        </Stack>
      </Modal>
      <ScannerModal
        opened={scanning}
        onClose={() => setScanning(false)}
        onCode={(c) => {
          setScanning(false);
          take(c);
        }}
      />
      {modal}
    </>
  );
}

/** The console asked for in the address, else the one picked last, else the audit's first. */
function useAuditConsole(audit: AuditSummary, allowAll: boolean): [string | null, (key: string | null) => void] {
  const [params, setParams] = useSearchParams();
  const asked = params.get('console');
  const last = remembered(AUDIT_CONSOLE);
  const known = (k: string | null) => k !== null && audit.consoles.some((c) => c.key === k);
  const key = known(asked) ? asked : allowAll ? null : known(last) ? last : (audit.consoles[0]?.key ?? null);
  const set = (k: string | null) => {
    if (k) remember(AUDIT_CONSOLE, k);
    setParams(k ? { console: k } : {}, { replace: true });
  };
  return [key, set];
}

function ConsolePicker({ audit, value, onChange, allowAll }: { audit: AuditSummary; value: string | null; onChange: (key: string | null) => void; allowAll: boolean }) {
  return (
    <Select
      label="Console"
      data={[...(allowAll ? [{ value: '', label: 'All consoles' }] : []), ...[...audit.consoles].sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ value: c.key, label: `${c.name} (${count(c.copies - c.seen)} not seen)` }))]}
      value={value ?? ''}
      onChange={(v) => onChange(v || null)}
      searchable
      allowDeselect={false}
    />
  );
}

/** A copy's line: its title, condition, when it was added, and its place. */
function CopyLine({ c }: { c: AuditCopy }) {
  return (
    <Stack gap={0} style={{ minWidth: 0 }}>
      <Text size="sm" fw={600}>
        {c.title}
        {c.quantity > 1 ? ` ×${c.quantity}` : ''}
      </Text>
      <Text size="xs" c="dimmed">
        {[conditionText(c.completeness), addedText(c.addedAt), c.place].filter(Boolean).join(' · ')}
      </Text>
    </Stack>
  );
}

function useCopies(audit: AuditSummary, platformKey: string | null) {
  return useQuery({
    queryKey: ['audit-copies', audit.id, platformKey ?? 'all'],
    queryFn: () => api<{ copies: AuditCopy[] }>(`/audit/${audit.id}/copies?state=unseen${platformKey ? `&platform=${encodeURIComponent(platformKey)}` : ''}`).then((r) => r.copies),
    // Each visit starts from what's not seen now; while on the page, a row ticked stays (to undo it there).
    staleTime: 0,
    gcTime: 0,
  });
}

/** Tick by hand: a console's copies not seen yet; tap one you're holding to tick it, with Undo. */
export function AuditTick({ audit }: { audit: AuditSummary }) {
  const refresh = useAuditRefresh();
  const [platformKey, setPlatformKey] = useAuditConsole(audit, false);
  const copies = useCopies(audit, platformKey);
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => setShown(PAGE), [platformKey, query]);
  const found = useMemo(() => findCopies(copies.data ?? [], query), [copies.data, query]);
  const left = (copies.data ?? []).filter((c) => !ticked.has(c.copyKey)).length;

  const toggle = async (c: AuditCopy) => {
    setBusy(c.copyKey);
    try {
      if (ticked.has(c.copyKey)) {
        await api(`/audit/${audit.id}/seen?key=${encodeURIComponent(c.copyKey)}`, { method: 'DELETE' });
        setTicked((t) => {
          const next = new Set(t);
          next.delete(c.copyKey);
          return next;
        });
      } else {
        await api(`/audit/${audit.id}/seen`, { method: 'POST', json: { copyKeys: [c.copyKey], how: 'hand' } });
        setTicked((t) => new Set(t).add(c.copyKey));
      }
      void refresh();
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Stack gap="sm" maw={640} mx="auto">
      <PageHeader help="collection" title="Tick by hand" description="A console's copies not seen yet. Tap one you're holding to tick it: the spines the photo couldn't read, a box on a high shelf, a game in a drawer." />
      <BackToAudit />
      <ConsolePicker audit={audit} value={platformKey} onChange={setPlatformKey} allowAll={false} />
      <TextInput leftSection={<IconSearch size={16} />} placeholder="Find a game" aria-label="Find a game" value={query} onChange={(e) => setQuery(e.currentTarget.value)} />
      {copies.isLoading && <Loader size="sm" />}
      {copies.error && <Alert color="red">{errorMessage(copies.error)}</Alert>}
      {copies.data && (
        <Text size="sm" c="dimmed">
          {left === 0 ? 'Every copy on this console has been seen.' : `${count(left)} not seen yet${ticked.size > 0 ? `, ${count(ticked.size)} ticked here` : ''}.`}
        </Text>
      )}
      <Stack gap={0}>
        {found.slice(0, shown).map((c) => {
          const on = ticked.has(c.copyKey);
          return (
            <Group key={c.copyKey} justify="space-between" wrap="nowrap" gap="xs" py={6} style={{ borderBottom: '1px solid var(--sc-line)' }}>
              <CopyLine c={c} />
              <Button size="compact-sm" variant={on ? 'light' : 'default'} color={on ? 'forest' : undefined} loading={busy === c.copyKey} onClick={() => void toggle(c)} aria-label={on ? `Undo the tick on ${c.title}` : `Tick ${c.title} as seen`}>
                {on ? '✓ Seen · Undo' : 'Seen'}
              </Button>
            </Group>
          );
        })}
      </Stack>
      {found.length > shown && (
        <Button variant="subtle" onClick={() => setShown((n) => n + PAGE)}>
          Show more ({count(found.length - shown)} left)
        </Button>
      )}
      {copies.data && query && found.length === 0 && <Text size="sm">No copy not seen yet has those words.</Text>}
    </Stack>
  );
}

/** Back to the audit's page, from one of its lists. */
export function BackToAudit() {
  return (
    <Anchor component={Link} to="/collection/audit" size="sm">
      ‹ Collection audit
    </Anchor>
  );
}

/** What became of one copy: the five answers, with a name asked for Lent and a check before those that remove it. */
function Settle({ audit, copy, onDone }: { audit: AuditSummary; copy: AuditCopy; onDone: (text: string) => void }) {
  const queryClient = useQueryClient();
  const refresh = useAuditRefresh();
  const [asking, setAsking] = useState<Outcome | null>(null);
  const [lentTo, setLentTo] = useState('');
  const settle = useMutation({
    mutationFn: (outcome: Outcome) => api(`/audit/${audit.id}/settle`, { method: 'POST', json: { copyKey: copy.copyKey, outcome, ...(outcome === 'lent' ? { lentTo: lentTo.trim() } : {}) } }),
    onSuccess: async (_r, outcome) => {
      setAsking(null);
      const o = OUTCOMES.find((x) => x.value === outcome)!;
      onDone(outcome === 'lent' ? `Lent to ${lentTo.trim() || 'someone'}` : o.done);
      void refresh();
      await Promise.all(TOUCHED.map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
    },
    onError: (err) => notifyError(err),
  });
  const choose = (o: Outcome) => (o === 'found' ? settle.mutate(o) : setAsking(o));
  const asked = OUTCOMES.find((x) => x.value === asking);
  return (
    <>
      <Group gap={6} wrap="wrap">
        {OUTCOMES.map((o) => (
          <Button key={o.value} size="compact-xs" variant={o.value === 'found' ? 'light' : 'default'} color={o.value === 'found' ? 'forest' : undefined} onClick={() => choose(o.value)} loading={settle.isPending && settle.variables === o.value}>
            {o.label}
          </Button>
        ))}
      </Group>
      <Modal opened={asking !== null} onClose={() => setAsking(null)} title={asking === 'lent' ? `Lent: ${copy.title}` : `${asked?.label ?? ''}: ${copy.title}`} centered>
        <Stack gap="sm">
          {asking === 'lent' ? (
            <>
              <TextInput label="Who has it?" placeholder="A name" value={lentTo} onChange={(e) => setLentTo(e.currentTarget.value)} maxLength={120} data-autofocus />
              <Text size="xs" c="dimmed">
                It goes on Stash › Loans, and stays in your collection.
              </Text>
            </>
          ) : (
            <Text size="sm">
              {copy.title} ({copy.platform}, {conditionText(copy.completeness)}) leaves your collection, as Remove does.
            </Text>
          )}
          <Group gap="xs">
            <Button color={asking === 'lent' ? 'forest' : 'red'} onClick={() => asking && settle.mutate(asking)} loading={settle.isPending}>
              {asking === 'lent' ? 'Lend it' : (asked?.confirm ?? 'Yes')}
            </Button>
            <Button variant="default" onClick={() => setAsking(null)}>
              Cancel
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

/** Not seen yet: the copies logged but not on any shelf so far, by console, each settled when you know. */
export function AuditUnseen({ audit, onFinish, finishing }: { audit: AuditSummary; onFinish: () => void; finishing: boolean }) {
  const [platformKey, setPlatformKey] = useAuditConsole(audit, true);
  const copies = useCopies(audit, platformKey);
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [settled, setSettled] = useState<Record<string, string>>({});
  useEffect(() => setShown(PAGE), [platformKey, query]);
  const found = useMemo(() => findCopies(copies.data ?? [], query), [copies.data, query]);
  const groups = byConsole(found.slice(0, shown));
  const left = (copies.data ?? []).filter((c) => !settled[c.copyKey]).length;
  return (
    <Stack gap="sm" maw={640} mx="auto">
      <PageHeader help="collection" title="Not seen yet" description="Logged in Squirrelcade, but not on any shelf so far. Once every shelf is done, these are the ones to look for." />
      <BackToAudit />
      <ConsolePicker audit={audit} value={platformKey} onChange={setPlatformKey} allowAll />
      <TextInput leftSection={<IconSearch size={16} />} placeholder="Find a game" aria-label="Find a game" value={query} onChange={(e) => setQuery(e.currentTarget.value)} />
      {copies.isLoading && <Loader size="sm" />}
      {copies.error && <Alert color="red">{errorMessage(copies.error)}</Alert>}
      {copies.data && <Text size="sm" c="dimmed">{left === 0 ? 'Nothing left to look for here.' : `${count(left)} not seen yet.`}</Text>}
      {groups.map((g) => (
        <Card key={g.key} withBorder padding="sm">
          {!platformKey && (
            <Text fw={700} mb={4}>
              {g.name}
            </Text>
          )}
          <Stack gap={0}>
            {g.copies.map((c) => (
              <Stack key={c.copyKey} gap={4} py={8} style={{ borderBottom: '1px solid var(--sc-line)' }}>
                <CopyLine c={c} />
                {settled[c.copyKey] ? (
                  <Text size="xs" fw={600} c="forest">
                    {settled[c.copyKey]}
                  </Text>
                ) : audit.finishedAt ? null : (
                  <Settle audit={audit} copy={c} onDone={(text) => setSettled((s) => ({ ...s, [c.copyKey]: text }))} />
                )}
              </Stack>
            ))}
          </Stack>
        </Card>
      ))}
      {found.length > shown && (
        <Button variant="subtle" onClick={() => setShown((n) => n + PAGE)}>
          Show more ({count(found.length - shown)} left)
        </Button>
      )}
      {!audit.finishedAt && (
        <>
          <Button variant="default" onClick={onFinish} loading={finishing}>
            Finish the audit
          </Button>
          <Text size="xs" c="dimmed">
            Sold, gave away and lost take the copy out of the collection, as Remove does. Lent puts it on a loan. Finishing keeps everything, and you can pick the audit up again.
          </Text>
        </>
      )}
    </Stack>
  );
}

/** A console's line on the audit's page: the chest, its name, "612 of 640" and a bar. */
export function ConsoleProgress({ name, seen, copies, to }: { name: string; seen: number; copies: number; to: string }) {
  return (
    <Stack gap={4} py={6} style={{ borderBottom: '1px solid var(--sc-line)' }}>
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
          <StashMark size={14} />
          <Anchor component={Link} to={to} size="sm" c="var(--mantine-color-text)" fw={600} truncate>
            {name}
          </Anchor>
        </Group>
        <Text size="sm" c="dimmed" style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {count(seen)} of {count(copies)}
        </Text>
      </Group>
      <Progress value={percent(seen, copies)} size="sm" color="forest" aria-label={`${name}: ${seen} of ${copies} seen`} />
    </Stack>
  );
}

