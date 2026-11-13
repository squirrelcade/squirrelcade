import { Alert, Anchor, Badge, Button, Card, Checkbox, Group, List, Loader, Stack, Table, Text, Textarea, TextInput, Title, Tooltip } from '@mantine/core';
import { priceChartingBarcodeUrl, priceChartingIdIn, priceChartingProductUrl, priceChartingUrl } from '@squirrelcade/core';
import { IconAlertTriangle, IconCheck, IconClipboard, IconCopy, IconDownload, IconExternalLink, IconQuestionMark, IconSend, IconX } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { copyText } from '../Copy';
import { count, date, money } from '../format';
import { notifyError, notifySuccess, useSetting } from '../hooks';
import { usePriceCheck } from '../PriceInput';

/** A copy of Squirrelcade's own on its way to PriceCharting, or sold here and still listed there (GET /api/v1/send/pricecharting). */
interface SendCopy {
  id: number;
  title: string;
  platform: string | null;
  platformKey: string | null;
  condition: string;
  line: string;
  conditionReadThere: boolean;
  sentAt: string | null;
  goneAt: string | null;
  goneReason: string | null;
  /** Its PriceCharting product id, when Squirrelcade knows it: then it goes in the CSV with its details. */
  pcId: string | null;
  /** The ID's check (D187): ok, confirmed (said right after a flag), or flagged. */
  check: 'ok' | 'confirmed' | 'flagged' | null;
  why: string[];
  /** PriceCharting's name and console for the ID. */
  pcName: string | null;
  /** The check (the owner, 2026-11-12): PriceCharting's name and console for the ID beside the copy's. */
  verdict: 'match' | 'mismatch' | 'unknown' | null;
  /** Where PriceCharting's name for the ID came from, or why there's none. */
  lookup: 'export' | 'page' | 'pending' | 'failed' | 'missing' | 'off' | null;
  lookupMessage: string | null;
  pcTitle: string | null;
  pcConsole: string | null;
  /** Whether the check starts with it ticked (Settings › Collection › Sending to PriceCharting). */
  inCsv: boolean;
  /** The game's value in its condition, from the owner's exports. */
  valueCents: number | null;
  /** A barcode Squirrelcade knows for the game on its console: "Find it" opens that product on PriceCharting (D154). */
  barcode: string | null;
  costCents: number | null;
  datePurchased: string | null;
  notes: string;
  /** Who graded a graded copy and its certificate, and its own PriceCharting folder (D151). */
  gradingCompany: string;
  gradingCertId: string;
  folder: string;
}

/** The folder the CSV puts every game in on PriceCharting, remembered on this browser (D151). */
const FOLDER_KEY = 'squirrelcade.pricechartingFolder';
function rememberedFolder(): string {
  try {
    return localStorage.getItem(FOLDER_KEY) ?? '';
  } catch {
    return '';
  }
}

interface ForPriceCharting {
  toSend: SendCopy[];
  waiting: SendCopy[];
  toRemove: SendCopy[];
  /** The paste importer's lines: the copies whose product isn't known. */
  text: string;
}

/** PriceCharting's page that takes pasted lines ("Title Console Condition"), one import a week on a free account. */
export const PRICECHARTING_IMPORTER = 'https://www.pricecharting.com/collection-text-importer';
/** PriceCharting's page that takes a CSV by product id, with what you paid, the day bought and notes. */
export const PRICECHARTING_CSV_IMPORTER = 'https://www.pricecharting.com/collection-import-csv';

/**
 * Whether this browser lets a page read what was copied: only a secure page (https, or the server itself) has the
 * clipboard, so a Squirrelcade opened over plain http:// has no Paste button and takes a paste in the box instead.
 */
const canReadClipboard = () => window.isSecureContext && typeof navigator.clipboard?.readText === 'function';

/** What was pasted had no PriceCharting ID in it. */
const noId = () =>
  notifyError(new Error("What you copied has no number in it: on the game's page on PriceCharting, copy the number under Item Details, PriceCharting ID."), 'No PriceCharting ID');

/**
 * A copy without a known product: the box for its PriceCharting ID, and where to find it (the product itself when
 * Squirrelcade knows the game's barcode, else PriceCharting's search by title). Paste reads what was copied there
 * within the tap (an iPhone shows its own Paste button first), picks the ID out of it and saves (D154). nextAt, set
 * when this copy is the next one waiting for an ID after a save, brings it into view with the focus on Find it.
 */
function PriceChartingId({ c, currency, nextAt, onSaved, compact = false }: { c: SendCopy; currency: string; nextAt: number; onSaved: (id: number) => Promise<unknown>; compact?: boolean }) {
  const [value, setValue] = useState('');
  // What was pasted with the ID (Item Details whole): its UPC is checked against the game's barcode (D187).
  const pasted = useRef('');
  const row = useRef<HTMLDivElement>(null);
  const find = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (!nextAt) return;
    row.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    find.current?.focus({ preventScroll: true });
  }, [nextAt]);
  const save = useMutation({
    mutationFn: (pcId: string) => api(`/send/pricecharting/${c.id}/product`, { method: 'PUT', json: { pcId, pasted: pasted.current } }),
    onSuccess: async () => {
      notifySuccess(`${c.title} has its PriceCharting ID: it's on the check above, beside what PriceCharting calls it, and in the CSV with its details.`);
      pasted.current = '';
      setValue('');
      await onSaved(c.id);
    },
    onError: (err) => notifyError(err),
  });
  async function paste() {
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      notifyError(new Error("This browser didn't let Squirrelcade read what you copied: paste it in the box, or type the number."), "Couldn't paste");
      return;
    }
    const id = priceChartingIdIn(text);
    if (!id) return noId();
    pasted.current = text;
    setValue(id);
    save.mutate(id);
  }
  return (
    <Group ref={row} gap="xs" wrap="wrap" align="center" role="group" aria-label={c.title}>
      {!compact && (
        <Text size="sm" style={{ minWidth: 0, flex: '1 1 12rem' }}>
          {nextAt > 0 && (
            <Badge size="xs" variant="light" mr={6} style={{ verticalAlign: 'middle' }}>
              Next
            </Badge>
          )}
          {c.title}{' '}
          <Text span size="xs" c="dimmed">
            {c.platform ?? '?'} · {c.condition}
            {c.costCents ? ` · paid ${money(c.costCents, currency)}` : ''}
          </Text>
        </Text>
      )}
      <Anchor ref={find} href={c.barcode ? priceChartingBarcodeUrl(c.barcode) : priceChartingUrl(c.title, c.platform ?? '')} target="_blank" rel="noreferrer" size="xs">
        Find it on PriceCharting
      </Anchor>
      <TextInput
        size="xs"
        w={130}
        placeholder="PriceCharting ID"
        aria-label={`PriceCharting ID of ${c.title}`}
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.currentTarget.value.replace(/\D/g, ''))}
        // What was copied with its label ("PriceCharting ID: 12345", or Item Details whole) gives just the ID.
        onPaste={(e) => {
          const text = e.clipboardData.getData('text');
          const id = priceChartingIdIn(text);
          e.preventDefault();
          if (id) {
            pasted.current = text;
            setValue(id);
          } else noId();
        }}
        onKeyDown={(e) => e.key === 'Enter' && value && save.mutate(value)}
      />
      {canReadClipboard() && (
        <Button size="compact-xs" variant="light" leftSection={<IconClipboard size={12} />} aria-label={`Paste the PriceCharting ID of ${c.title}`} disabled={save.isPending} onClick={() => void paste()}>
          Paste
        </Button>
      )}
      <Button size="compact-xs" variant="default" disabled={!value} loading={save.isPending} onClick={() => save.mutate(value)}>
        Save
      </Button>
    </Group>
  );
}

/**
 * A copy's PriceCharting ID fixed after the fact (D187): another ID typed or pasted, or taken back (it goes by title
 * again), until the copy is marked sent.
 */
function FixId({ c, currency, onDone }: { c: SendCopy; currency: string; onDone: () => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const clear = useMutation({
    mutationFn: () => api(`/send/pricecharting/${c.id}/product`, { method: 'PUT', json: { pcId: '' } }),
    onSuccess: async () => {
      notifySuccess(`${c.title}'s PriceCharting ID is taken back: it goes by title again.`);
      await onDone();
    },
    onError: (err) => notifyError(err),
  });
  return (
    <Group gap={4} wrap="wrap">
      {open ? (
        <PriceChartingId c={c} currency={currency} nextAt={0} compact onSaved={async () => { setOpen(false); await onDone(); }} />
      ) : (
        <Button size="compact-xs" variant="subtle" onClick={() => setOpen(true)} aria-label={`Change the PriceCharting ID of ${c.title}`}>
          Change
        </Button>
      )}
      <Button size="compact-xs" variant="subtle" color="gray" loading={clear.isPending} onClick={() => clear.mutate()} aria-label={`Take back the PriceCharting ID of ${c.title}`}>
        Take it back
      </Button>
    </Group>
  );
}

/**
 * Send to PriceCharting (0.20.0, D83; the CSV, D150): the copies added in Squirrelcade that PriceCharting doesn't have
 * yet, two ways. Those whose PriceCharting product Squirrelcade knows (from an export that had the game, or an ID
 * typed here) go in a CSV for PriceCharting's CSV importer, with their condition, what you paid, the day bought and
 * your notes, after one look down the check (what PriceCharting calls each ID, and what was paid beside the value); the rest go by title, as lines for its paste importer. Then the ones sent and
 * waiting for an export, and the copies sold or removed here that PriceCharting still lists. Shown on Stash updates
 * while there's something to do.
 */
export function SendToPriceCharting() {
  const queryClient = useQueryClient();
  const currency = useSetting('general.currency', 'USD');
  // While any ID is still being looked up on PriceCharting (in the background), the list is asked for again.
  const data = useQuery({
    queryKey: ['send', 'pricecharting'],
    queryFn: () => api<ForPriceCharting>('/send/pricecharting'),
    refetchInterval: (q) => (q.state.data?.toSend.some((c) => c.lookup === 'pending') ? 2500 : false),
  });
  const dateFormat = useSetting('general.dateFormat', 'us');
  const [folder, setFolder] = useState(rememberedFolder);
  const keepFolder = (v: string) => {
    setFolder(v);
    try {
      localStorage.setItem(FOLDER_KEY, v);
    } catch {
      // Storage is off: the folder lasts as long as the page.
    }
  };
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['send'] }), queryClient.invalidateQueries({ queryKey: ['game'] }), queryClient.invalidateQueries({ queryKey: ['purchases'] })]);
  const mark = useMutation({
    mutationFn: (v: { path: 'sent' | 'removed'; ids: number[] }) => api(`/send/pricecharting/${v.path}`, { method: 'POST', json: { ids: v.ids } }),
    onSuccess: async (_r, v) => {
      notifySuccess(v.path === 'sent' ? 'Noted: they wait for your next PriceCharting export.' : 'Noted: nothing left to remove on PriceCharting.');
      await refresh();
    },
    onError: (err) => notifyError(err),
  });
  // The check's ticks, where the owner changed one: every other row is as the check starts it (inCsv).
  const [ticks, setTicks] = useState<Record<number, boolean>>({});
  // After an ID is saved, the next copy still waiting for one (n tells one save from the next); id 0: none is left, so
  // the CSV's download is next.
  const [next, setNext] = useState<{ id: number; n: number } | null>(null);
  const download = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (next?.id !== 0) return;
    download.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    download.current?.focus({ preventScroll: true });
  }, [next]);
  const d = data.data;
  if (!d || d.toSend.length + d.waiting.length + d.toRemove.length === 0) return null;
  // Every copy with a PriceCharting ID is on the check, and goes in the CSV while it's ticked.
  const withId = d.toSend.filter((c) => c.pcId !== null);
  const ticked = withId.filter((c) => ticks[c.id] ?? c.inCsv);
  const byTitle = d.toSend.filter((c) => c.pcId === null);
  const unread = byTitle.filter((c) => !c.conditionReadThere);
  const csvHref = `/api/v1/send/pricecharting.csv?ids=${ticked.map((c) => c.id).join(',')}${folder.trim() ? `&folder=${encodeURIComponent(folder.trim())}` : ''}`;

  // A run through the list: the copy after the one just given its ID, or the first one before it.
  async function idSaved(id: number) {
    const i = byTitle.findIndex((c) => c.id === id);
    const after = [...byTitle.slice(i + 1), ...byTitle.slice(0, Math.max(i, 0))][0];
    await refresh();
    setNext((p) => ({ id: after?.id ?? 0, n: (p?.n ?? 0) + 1 }));
  }

  async function copyList() {
    if (await copyText(d!.text)) notifySuccess(`${count(byTitle.length)} line${byTitle.length === 1 ? '' : 's'} copied. Paste them into PriceCharting's importer.`);
    else notifyError(new Error("This browser didn't let Squirrelcade copy: select the list and copy it yourself."));
  }

  return (
    <Card withBorder padding="sm" mb="lg" id="send">
      <Stack gap="sm">
        <Group gap={6}>
          <IconSend size={18} />
          <Title order={4}>Send to PriceCharting</Title>
        </Group>
        {d.toSend.length > 0 && (
          <Text size="sm" maw={720}>
            {count(d.toSend.length)} cop{d.toSend.length === 1 ? 'y' : 'ies'} you added in Squirrelcade {d.toSend.length === 1 ? "isn't" : "aren't"} on PriceCharting yet. After you send them, export
            from PriceCharting as usual: the export brings each copy's value back to the same copy here, and what you paid stays Squirrelcade's.
          </Text>
        )}

        {withId.length > 0 && (
          <Stack gap="xs">
            <Title order={5}>Check, then send: PriceCharting's CSV importer ({count(ticked.length)} of {count(withId.length)} ticked)</Title>
            <Text size="sm" maw={760}>
              These go with everything PriceCharting's CSV importer takes: condition, what you paid, the day bought and your notes. Each row has your copy beside what PriceCharting
              calls the ID you gave it, looked up by Squirrelcade, with what you paid beside the game's value: look down the list once. Every ticked row goes in the file; untick one
              that's wrong and fix it (Change), or leave it for another time. Upload the file once: PriceCharting adds every row as a new copy, so a second upload adds them again.
            </Text>
            <CheckTable copies={withId} ticked={(c) => ticks[c.id] ?? c.inCsv} onTick={(c, on) => setTicks((t) => ({ ...t, [c.id]: on }))} currency={currency} dateFormat={dateFormat} onDone={refresh} />
            <TextInput
              size="xs"
              maw={320}
              label="Folder on PriceCharting (optional)"
              description="Every game in the file goes in this folder there; PriceCharting makes it if it doesn't exist (free accounts can have only a few folders)."
              placeholder="No folder"
              maxLength={60}
              value={folder}
              onChange={(e) => keepFolder(e.currentTarget.value)}
            />
            <Group gap="xs">
              <Button ref={download} size="compact-sm" variant="light" leftSection={<IconDownload size={14} />} component="a" href={csvHref} download disabled={ticked.length === 0}>
                Download the CSV ({count(ticked.length)})
              </Button>
              <Button size="compact-sm" variant="default" component="a" href={PRICECHARTING_CSV_IMPORTER} target="_blank" rel="noreferrer" rightSection={<IconExternalLink size={14} />}>
                Open PriceCharting's CSV importer
              </Button>
              <Button size="compact-sm" variant="default" loading={mark.isPending} disabled={ticked.length === 0} onClick={() => mark.mutate({ path: 'sent', ids: ticked.map((c) => c.id) })}>
                I've uploaded it
              </Button>
            </Group>
          </Stack>
        )}

        {byTitle.length > 0 && (
          <Stack gap="xs">
            <Title order={5}>By title: PriceCharting's paste importer ({count(byTitle.length)})</Title>
            <Text size="sm" maw={720}>
              PriceCharting doesn't know which of its games {byTitle.length === 1 ? 'this is' : 'these are'} yet, so {byTitle.length === 1 ? 'it goes' : 'they go'} by title: it reads CIB and
              Sealed, not what you paid (that stays here). To send one with its details instead, give it its PriceCharting ID: Find it on PriceCharting, copy the number
              under Item Details, PriceCharting ID, and come back to Paste it.
            </Text>
            <Stack gap={6}>
              {byTitle.map((c) => (
                <PriceChartingId key={c.id} c={c} currency={currency} nextAt={next?.id === c.id ? next.n : 0} onSaved={idSaved} />
              ))}
            </Stack>
            <Textarea value={d.text} readOnly autosize minRows={2} maxRows={10} aria-label="Lines for PriceCharting's importer" styles={{ input: { fontFamily: 'monospace' } }} onFocus={(e) => e.currentTarget.select()} />
            {unread.length > 0 && (
              <Text size="xs" c="dimmed" maw={720}>
                PriceCharting's paste importer reads CIB and Sealed; these come in as loose, so set their condition there after pasting:{' '}
                {unread.map((c) => `${c.title} (${c.condition})`).join(', ')}.
              </Text>
            )}
            <Group gap="xs">
              <Button size="compact-sm" variant="light" leftSection={<IconCopy size={14} />} onClick={() => void copyList()}>
                Copy the list
              </Button>
              <Button size="compact-sm" variant="default" component="a" href={PRICECHARTING_IMPORTER} target="_blank" rel="noreferrer" rightSection={<IconExternalLink size={14} />}>
                Open PriceCharting's importer
              </Button>
              <Button size="compact-sm" variant="default" loading={mark.isPending} onClick={() => mark.mutate({ path: 'sent', ids: byTitle.map((c) => c.id) })}>
                I've added them there
              </Button>
            </Group>
          </Stack>
        )}

        {d.waiting.length > 0 && (
          <Text size="sm" c="dimmed">
            Sent, waiting for an export that has them ({count(d.waiting.length)}): {d.waiting.map((c) => `${c.title} (${c.platform ?? '?'}, ${date(c.sentAt, dateFormat)})`).join('; ')}.
          </Text>
        )}
        {d.toRemove.length > 0 && (
          <Stack gap={4}>
            <Text size="sm" maw={720}>
              Sold or removed here, still on PriceCharting ({count(d.toRemove.length)}): remove {d.toRemove.length === 1 ? 'it' : 'them'} there, or they'll keep counting in
              PriceCharting's totals.{' '}
              <Anchor href="https://www.pricecharting.com/my-collection" target="_blank" rel="noreferrer" size="sm">
                Your collection on PriceCharting
              </Anchor>
            </Text>
            <Text size="sm" c="dimmed">
              {d.toRemove.map((c) => `${c.title} (${c.platform ?? '?'}, ${c.condition}, ${c.goneReason === 'sold' ? 'sold' : 'removed'} ${date(c.goneAt, dateFormat)})`).join('; ')}
            </Text>
            <Group>
              <Button size="compact-sm" variant="default" loading={mark.isPending} onClick={() => mark.mutate({ path: 'removed', ids: d.toRemove.map((c) => c.id) })}>
                I've removed them there
              </Button>
            </Group>
          </Stack>
        )}
      </Stack>
    </Card>
  );
}

/** What the check's mark says, and its color. */
const VERDICT: Record<'match' | 'mismatch' | 'unknown', { label: string; color: string; icon: typeof IconCheck }> = {
  match: { label: 'Matches', color: 'green', icon: IconCheck },
  mismatch: { label: "Doesn't match", color: 'red', icon: IconX },
  unknown: { label: "Can't check", color: 'gray', icon: IconQuestionMark },
};

/**
 * The check before the CSV (the owner, 2026-11-12: "one page that has Squirrelcade do the lookup for it and have it on a
 * table, and you can just visually inspect it. You don't have to go through and click entry by entry"). One row a copy:
 * its title and console beside the PriceCharting ID given to it and what PriceCharting calls that ID (from the owner's
 * exports, or its page, read once in the background when Settings › Collection › Sending to PriceCharting allows it),
 * a mark, and what was paid beside the game's value. The rows that disagree, and the prices out of line, are listed at
 * the top. Every row is in the CSV while it's ticked; nothing waits for a click per row.
 */
function CheckTable({
  copies,
  ticked,
  onTick,
  currency,
  dateFormat,
  onDone,
}: {
  copies: SendCopy[];
  ticked: (c: SendCopy) => boolean;
  onTick: (c: SendCopy, on: boolean) => void;
  currency: string;
  dateFormat: Parameters<typeof date>[1];
  onDone: () => Promise<unknown>;
}) {
  const prices = usePriceCheck();
  const priceFlag = (c: SendCopy) => prices.words(c.costCents, c.valueCents);
  const again = useMutation({
    mutationFn: (c: SendCopy) => api(`/send/pricecharting/${c.id}/lookup`, { method: 'POST' }),
    onSuccess: () => onDone(),
    onError: (err) => notifyError(err),
  });
  const mismatched = copies.filter((c) => c.verdict === 'mismatch');
  const pricey = copies.filter((c) => priceFlag(c) !== null);
  const unknown = copies.filter((c) => c.verdict === 'unknown' && c.lookup !== 'pending');
  const pending = copies.filter((c) => c.lookup === 'pending').length;
  const off = unknown.some((c) => c.lookup === 'off');
  const name = (c: SendCopy) => `${c.title} (${c.platform ?? '?'})`;
  return (
    <Stack gap="xs">
      {(mismatched.length > 0 || pricey.length > 0) && (
        <Alert variant="light" color="red" icon={<IconAlertTriangle size={18} />} title={`To look at (${count(new Set([...mismatched, ...pricey].map((c) => c.id)).size)})`} id="check-these">
          <List size="sm" spacing={2}>
            {mismatched.map((c) => (
              <List.Item key={`id-${c.id}`}>
                <b>{name(c)}</b>, #{c.pcId}: {c.why.join('; ')}.{ticked(c) ? ' In the CSV unless you untick it.' : ' Not in the CSV.'}
              </List.Item>
            ))}
            {pricey.map((c) => (
              <List.Item key={`paid-${c.id}`}>
                <b>{name(c)}</b>: paid {priceFlag(c)}.{' '}
                {c.platformKey && (
                  <Anchor component={Link} to={`/consoles/${c.platformKey}?game=${encodeURIComponent(`${c.platformKey}|${c.title}`)}`} size="sm">
                    Open the game to fix it
                  </Anchor>
                )}
              </List.Item>
            ))}
          </List>
        </Alert>
      )}
      {(unknown.length > 0 || pending > 0) && (
        <Text size="sm" c="dimmed" maw={760}>
          {pending > 0 ? `Looking up ${count(pending)} on PriceCharting, one at a time; the rows fill in as they come. ` : ''}
          {unknown.length > 0 && (
            <>
              {count(unknown.length)} can't be checked here: {off ? "your PriceCharting exports don't have their IDs" : "PriceCharting's page couldn't be read"}. Open each on PriceCharting from its ID
              {off ? (
                <>
                  , or let Squirrelcade look IDs up there:{' '}
                  <Anchor component={Link} to="/settings/collection#setting-collection.pcLookup" size="sm">
                    Settings › Collection › Sending to PriceCharting
                  </Anchor>
                  .
                </>
              ) : (
                '.'
              )}
            </>
          )}
        </Text>
      )}
      <div style={{ overflowX: 'auto' }}>
        <Table verticalSpacing={4} fz="sm" miw={760} aria-label="What the CSV has">
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={36}>
                <Checkbox
                  size="xs"
                  aria-label="Tick every row"
                  checked={copies.every(ticked)}
                  indeterminate={!copies.every(ticked) && copies.some(ticked)}
                  onChange={(e) => {
                    const on = e.currentTarget.checked;
                    for (const c of copies) onTick(c, on);
                  }}
                />
              </Table.Th>
              <Table.Th>Your copy</Table.Th>
              <Table.Th>PriceCharting ID</Table.Th>
              <Table.Th>PriceCharting says</Table.Th>
              <Table.Th>Check</Table.Th>
              <Table.Th ta="right">Paid</Table.Th>
              <Table.Th ta="right">Value</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {copies.map((c) => {
              const v = VERDICT[c.verdict ?? 'unknown'];
              const flag = priceFlag(c);
              const on = ticked(c);
              return (
                // A bar down the left of a row to look at: red for an ID that doesn't match, orange for a price out of line.
                <Table.Tr key={c.id} style={c.verdict === 'mismatch' || flag ? { boxShadow: `inset 4px 0 0 var(--mantine-color-${c.verdict === 'mismatch' ? 'red' : 'orange'}-6)` } : undefined}>
                  <Table.Td>
                    <Checkbox size="xs" aria-label={`${c.title} in the CSV`} checked={on} onChange={(e) => onTick(c, e.currentTarget.checked)} />
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" fw={500}>
                      {c.title}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {c.platform ?? '?'} · {c.condition}
                      {c.gradingCompany && c.condition === 'Graded' ? ` (${c.gradingCompany}${c.gradingCertId ? ` #${c.gradingCertId}` : ''})` : ''}
                      {c.datePurchased ? ` · bought ${date(c.datePurchased, dateFormat)}` : ''}
                    </Text>
                    {c.notes && (
                      <Text size="xs" c="dimmed" lineClamp={1} maw={260}>
                        {c.notes.slice(0, 300)}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Anchor href={priceChartingProductUrl(c.pcId!)} target="_blank" rel="noreferrer" size="sm" aria-label={`PriceCharting ID ${c.pcId}: open it on PriceCharting`}>
                      #{c.pcId} <IconExternalLink size={11} />
                    </Anchor>
                  </Table.Td>
                  <Table.Td>
                    {c.pcTitle ? (
                      <>
                        <Text size="sm">{c.pcTitle}</Text>
                        <Text size="xs" c="dimmed">
                          {c.pcConsole}
                          {c.lookup === 'export' ? ' · from your export' : ''}
                        </Text>
                      </>
                    ) : c.lookup === 'pending' ? (
                      <Group gap={6} wrap="nowrap">
                        <Loader size={12} />
                        <Text size="xs" c="dimmed">
                          Looking it up…
                        </Text>
                      </Group>
                    ) : c.lookup === 'missing' ? (
                      <Text size="sm" c="red">
                        No such product on PriceCharting
                      </Text>
                    ) : c.lookup === 'failed' ? (
                      <Stack gap={2}>
                        <Text size="xs" c="dimmed">
                          Couldn't look it up{c.lookupMessage ? `: ${c.lookupMessage}` : ''}
                        </Text>
                        <Button size="compact-xs" variant="subtle" loading={again.isPending && again.variables?.id === c.id} onClick={() => again.mutate(c)} w="fit-content">
                          Try again
                        </Button>
                      </Stack>
                    ) : (
                      <Text size="xs" c="dimmed">
                        Not in your exports: open it to check
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>
                    <Tooltip label={c.why.join('; ') || (c.verdict === 'match' ? 'The same game, console and region' : v.label)} multiline maw={320} disabled={c.lookup === 'pending'}>
                      <Badge size="sm" variant="light" color={v.color} leftSection={<v.icon size={11} />} style={{ textTransform: 'none', flexShrink: 0 }} styles={{ label: { overflow: 'visible' } }}>
                        {c.lookup === 'pending' ? 'Looking…' : v.label}
                      </Badge>
                    </Tooltip>
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text size="sm" c={flag ? 'orange.8' : undefined} fw={flag ? 600 : undefined} title={flag ?? undefined}>
                      {flag && <IconAlertTriangle size={12} style={{ verticalAlign: '-1px' }} aria-label="Out of line" />} {c.costCents ? money(c.costCents, currency) : '—'}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right">{c.valueCents ? money(c.valueCents, currency) : '—'}</Table.Td>
                  <Table.Td>
                    <FixId c={c} currency={currency} onDone={onDone} />
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </div>
    </Stack>
  );
}
