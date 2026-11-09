import { Alert, Anchor, Button, Card, Group, Image, Loader, MultiSelect, Progress, SegmentedControl, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { IconBarcode, IconCamera, IconHandFinger, IconListSearch } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { StashMark } from '../Acorn';
import { api, errorMessage } from '../api';
import { percent, photoFiles, type AuditSummary } from '../audit';
import { PageHeader } from '../components';
import { count, date, timeAgo } from '../format';
import { notifyError, useSetting } from '../hooks';
import { AuditBarcode, AuditTick, AuditUnseen, ConsoleProgress } from './AuditLists';
import { AuditShelf } from './AuditShelf';

/**
 * Stash > Collection audit (1.5.0, R05; the owner: "take pictures of my copies, and see if there are games that aren't
 * logged in"). Shelf by shelf: a photo ticks the copies on it as seen and lists the games on it that aren't logged, each
 * with Add it; barcodes and taps tick the rest. Progress is kept for weeks. At the end, Not seen yet lists the copies
 * no shelf had, each found, sold, lent, given away or lost. The server's side is apps/server/src/audit.ts.
 */

const VIEWS = new Set(['shelf', 'tick', 'unseen']);

/** A button with its icon over its words, for a row of three on a phone. */
const TILE = {
  size: 'sm',
  h: 'auto',
  py: 8,
  px: 4,
  styles: { inner: { flexDirection: 'column', gap: 4 }, section: { margin: 0 }, label: { whiteSpace: 'normal', textAlign: 'center', lineHeight: 1.2 } },
} as const;

export function AuditPage() {
  const { view } = useParams<{ view?: string }>();
  const queryClient = useQueryClient();
  const current = useQuery({ queryKey: ['audit'], queryFn: () => api<{ audit: AuditSummary | null }>('/audit').then((r) => r.audit) });
  const finish = useMutation({
    mutationFn: (id: number) => api<{ audit: AuditSummary }>(`/audit/${id}/finish`, { method: 'POST' }),
    onSuccess: (r) => queryClient.setQueryData(['audit'], r.audit),
    onError: (err) => notifyError(err),
  });
  if (current.isLoading) return <Loader />;
  if (current.error) return <Alert color="red">{errorMessage(current.error)}</Alert>;
  const audit = current.data ?? null;
  const open = audit && !audit.finishedAt ? audit : null;
  if (view && VIEWS.has(view)) {
    // A shelf and Tick by hand need an audit going; Not seen yet can look back at a finished one.
    const usable = view === 'unseen' ? audit : open;
    if (!usable)
      return (
        <Stack maw={640} mx="auto" gap="sm">
          <PageHeader help="collection" title="Collection audit" />
          <Text>{audit ? 'This audit is finished. Pick it up again on its page first.' : 'No audit is going. Start one on its page first.'}</Text>
          <Button component={Link} to="/collection/audit" variant="light" w="fit-content">
            Go to the collection audit
          </Button>
        </Stack>
      );
    if (view === 'shelf') return <AuditShelf key={usable.id} audit={usable} />;
    if (view === 'tick') return <AuditTick key={usable.id} audit={usable} />;
    return <AuditUnseen key={usable.id} audit={usable} onFinish={() => finish.mutate(usable.id)} finishing={finish.isPending} />;
  }
  return <AuditHome audit={audit} onFinish={(id) => finish.mutate(id)} finishing={finish.isPending} />;
}

/** Starts an audit: its name (a month's, if none), and every console or the ones chosen. */
function StartAudit({ onCancel }: { onCancel?: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [which, setWhich] = useState<'all' | 'some'>('all');
  const [chosen, setChosen] = useState<string[]>([]);
  const platforms = useQuery({ queryKey: ['platforms'], queryFn: () => api<{ key: string; name: string; copies: number }[]>('/platforms') });
  const yours = (platforms.data ?? []).filter((p) => p.copies > 0);
  const start = useMutation({
    mutationFn: () => api<{ audit: AuditSummary }>('/audit', { method: 'POST', json: { name: name.trim() || undefined, platforms: which === 'some' ? chosen : [] } }),
    onSuccess: (r) => queryClient.setQueryData(['audit'], r.audit),
    onError: (err) => notifyError(err),
  });
  const month = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  return (
    <Card withBorder padding="md">
      <Stack gap="sm">
        <TextInput label="Name" placeholder={`Collection audit, ${month}`} value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={120} />
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Consoles
          </Text>
          <SegmentedControl
            value={which}
            onChange={(v) => setWhich(v as 'all' | 'some')}
            data={[
              { value: 'all', label: 'All of them' },
              { value: 'some', label: 'Choose' },
            ]}
            w="fit-content"
          />
        </Stack>
        {which === 'some' && <MultiSelect label="Which consoles" placeholder="Pick one or more" data={yours.map((p) => ({ value: p.key, label: p.name }))} value={chosen} onChange={setChosen} searchable clearable />}
        <Group gap="xs">
          <Button color="forest" onClick={() => start.mutate()} loading={start.isPending} disabled={which === 'some' && chosen.length === 0}>
            Start the audit
          </Button>
          {onCancel && (
            <Button variant="default" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </Group>
      </Stack>
    </Card>
  );
}

/** The audit's page: start one, or how far it's got overall and on each console, and the shelves done. */
function AuditHome({ audit, onFinish, finishing }: { audit: AuditSummary | null; onFinish: (id: number) => void; finishing: boolean }) {
  const queryClient = useQueryClient();
  const keepPhotos = useSetting('audit.keepPhotos', true);
  const dateFormat = useSetting('general.dateFormat', 'us');
  const [scanning, setScanning] = useState(false);
  const [starting, setStarting] = useState(false);
  const reopen = useMutation({
    mutationFn: (id: number) => api<{ audit: AuditSummary }>(`/audit/${id}/reopen`, { method: 'POST' }),
    onSuccess: (r) => queryClient.setQueryData(['audit'], r.audit),
    onError: (err) => notifyError(err),
  });
  const header = (
    <PageHeader
      help="collection"
      title="Collection audit"
      description="Photograph each shelf: Squirrelcade reads the spines, ticks off the copies you've logged, and lists the games on the shelf that aren't in Squirrelcade yet. Your progress is kept, so it can take a weekend or a month."
    />
  );

  if (!audit || (audit.finishedAt && starting)) {
    return (
      <Stack maw={640} mx="auto" gap="sm">
        {header}
        <Text size="sm">
          Go shelf by shelf. Pick the shelf's console and take a photo: the copies on it are ticked as seen, and each game on it you haven't logged gets <b>Add it</b>. Barcodes and taps tick the spines a photo couldn't read. At the end, <b>Not seen yet</b> lists what's logged but wasn't on any shelf: found it, sold, lent, gave away or lost.
        </Text>
        <Text size="xs" c="dimmed">
          Only physical games count (no hardware, no PC). {keepPhotos ? "Each shelf's photos are kept, made smaller, so you can look back at a shelf" : "Shelf photos are read and not kept"} (Settings › Collection › Collection audit).
        </Text>
        <StartAudit onCancel={audit ? () => setStarting(false) : undefined} />
      </Stack>
    );
  }

  const t = audit.totals;
  const names = new Map(audit.consoles.map((c) => [c.key, c.name]));
  const going = !audit.finishedAt;
  return (
    <Stack maw={640} mx="auto" gap="sm">
      {header}
      <Card withBorder padding="md" data-testid="audit-progress">
        <Stack gap={6}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            {audit.name} · since {date(audit.startedAt, dateFormat)}
            {audit.finishedAt ? ` · finished ${date(audit.finishedAt, dateFormat)}` : ''}
          </Text>
          <Group gap={8} align="baseline">
            <StashMark size={20} />
            <Text fz={28} fw={700} style={{ fontVariantNumeric: 'tabular-nums' }}>
              {count(t.marked)}
            </Text>
            <Text c="dimmed">of {count(t.copies)} copies seen</Text>
          </Group>
          <Progress value={percent(t.marked, t.copies)} size="md" color="forest" aria-label={`${t.marked} of ${t.copies} copies seen`} />
          <Text size="xs" c="dimmed">
            {[
              `${count(t.shelves)} ${t.shelves === 1 ? 'shelf' : 'shelves'}`,
              `${count(t.added)} ${t.added === 1 ? 'game' : 'games'} added that ${t.added === 1 ? "wasn't" : "weren't"} logged`,
              t.gone > 0 ? `${count(t.gone)} sold, given away or lost` : null,
              t.lent > 0 ? `${count(t.lent)} lent` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </Stack>
      </Card>
      {going ? (
        <>
          <Button component={Link} to="/collection/audit/shelf" size="md" color="forest" leftSection={<IconCamera size={18} />}>
            Photograph a shelf
          </Button>
          {/* Three side by side on a phone too: each icon over its words. */}
          <SimpleGrid cols={3} spacing="xs">
            <Button variant="default" {...TILE} leftSection={<IconBarcode size={18} />} onClick={() => setScanning(true)}>
              Scan a barcode
            </Button>
            <Button component={Link} to="/collection/audit/tick" variant="default" {...TILE} leftSection={<IconHandFinger size={18} />}>
              Tick by hand
            </Button>
            <Button component={Link} to="/collection/audit/unseen" variant="default" {...TILE} leftSection={<IconListSearch size={18} />}>
              Not seen yet
            </Button>
          </SimpleGrid>
        </>
      ) : (
        <Group gap="xs">
          <Button color="forest" onClick={() => reopen.mutate(audit.id)} loading={reopen.isPending}>
            Pick it up again
          </Button>
          <Button component={Link} to="/collection/audit/unseen" variant="default">
            Not seen
          </Button>
          <Button variant="default" onClick={() => setStarting(true)}>
            Start a new audit
          </Button>
        </Group>
      )}
      <Card withBorder padding="sm">
        <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={4}>
          By console
        </Text>
        {audit.consoles.length === 0 ? (
          <Text size="sm" c="dimmed">
            No physical games on this audit's consoles.
          </Text>
        ) : (
          audit.consoles.map((c) => <ConsoleProgress key={c.key} name={c.name} seen={c.seen} copies={c.copies} to={`/collection/audit/unseen?console=${encodeURIComponent(c.key)}`} />)
        )}
      </Card>
      {audit.shelves.length > 0 && (
        <Card withBorder padding="sm">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={4}>
            Recent shelves
          </Text>
          <Stack gap={0}>
            {audit.shelves.map((s, i) => {
              const notAdded = s.notLogged.filter((x) => !x.added);
              return (
                <Stack key={s.id} gap={4} py={8} style={{ borderBottom: '1px solid var(--sc-line)' }}>
                  <Group justify="space-between" wrap="nowrap" gap="xs">
                    <Text size="sm" fw={600} truncate>
                      {s.name || `Shelf ${t.shelves - i}`} · {names.get(s.platformKey) ?? s.platformKey}
                    </Text>
                    <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                      {timeAgo(s.createdAt)}
                    </Text>
                  </Group>
                  <Text size="xs" c="dimmed">
                    {[`${count(s.seen)} seen`, notAdded.length > 0 ? `${notAdded.length} not logged: ${notAdded.map((x) => x.title).join(', ')}` : null, s.reads > 0 ? `${count(s.reads)} spines read` : null].filter(Boolean).join(' · ')}
                  </Text>
                  {s.photos > 0 && (
                    <Group gap={6}>
                      {photoFiles(s).map((f) => (
                        <Anchor key={f} href={`/api/v1/audit/${audit.id}/photos/${f}`} target="_blank" rel="noreferrer" aria-label={`Photo of ${s.name || 'the shelf'}`}>
                          <Image src={`/api/v1/audit/${audit.id}/photos/${f}`} h={56} w={84} fit="cover" radius="sm" loading="lazy" alt="" />
                        </Anchor>
                      ))}
                    </Group>
                  )}
                </Stack>
              );
            })}
          </Stack>
        </Card>
      )}
      {going && (
        <>
          <Button variant="default" onClick={() => onFinish(audit.id)} loading={finishing}>
            Finish the audit
          </Button>
          <Text size="xs" c="dimmed">
            Finishing keeps everything: the copies seen, the shelves and their photos. You can pick it up again if more shelves turn up.
          </Text>
        </>
      )}
      {going && <AuditBarcode audit={audit} opened={scanning} onClose={() => setScanning(false)} />}
    </Stack>
  );
}
