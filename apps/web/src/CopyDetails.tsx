import { Anchor, Autocomplete, Badge, Button, CloseButton, Divider, FileButton, Group, Image, Loader, Modal, NumberInput, SegmentedControl, Select, SimpleGrid, Stack, TagsInput, Text, TextInput, Tooltip } from '@mantine/core';
import { COMPLETENESS_LABELS, RIP_RESULTS, TEST_RESULTS, type Completeness, type TestKind, type TestResult } from '@squirrelcade/core';
import { SellHelper } from './SellHelper';
import { IconCamera, IconCheck, IconMapPin, IconUserShare } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useState } from 'react';
import { api } from './api';
import { date, money } from './format';
import { overGoalNote } from './Goal';
import { notifyError, notifySuccess, useSetting } from './hooks';

/** The owner's details on a copy (GET /api/v1/copy). */
export interface CopyDetail {
  location: string | null;
  tags: string[];
  sale: 'sale' | 'trade' | null;
  askingCents: number | null;
  saleNote: string | null;
  /** A digital license that came with the disc (Xbox disc-to-digital, a code in the box), 0.55.0. */
  digitalClaim?: 'claimed' | 'unclaimed' | 'not-eligible' | null;
  digitalClaimedAt?: string | null;
  digitalStore?: string | null;
}

/** What the digital license choice says. */
const DIGITAL_CLAIMS = [
  { value: '', label: 'Not said' },
  { value: 'claimed', label: 'Claimed' },
  { value: 'unclaimed', label: 'Not claimed yet' },
  { value: 'not-eligible', label: 'Not offered for this one' },
];

export interface Loan {
  id: number;
  copyKey: string;
  title: string;
  platformKey: string | null;
  platform: string | null;
  lentTo: string;
  lentAt: string;
  dueAt: string | null;
  returnedAt: string | null;
  note: string | null;
  overdue: boolean;
}

export interface PhotoInfo {
  id: number;
  caption: string | null;
  /** The standard photo it is ("Box front"), or null for another photo. */
  slot: string | null;
  mime: string;
  bytes: number;
  createdAt: string;
}

/** The copy itself, which the owner can change (0.20.0): its id, condition, price paid, day bought and notes. */
export interface CopyFields {
  id: number;
  completeness: string;
  costCents: number | null;
  datePurchased: string | null;
  notes: string;
  /** Its standard photos (Settings > Collection), by what it has and its console. */
  slots?: string[];
  /** The owner's estimate of what it cost when they don't know (never a price paid, never sent anywhere). */
  estimatedCents?: number | null;
  /** Its console, for what can be done with it here (a rip, on the consoles whose games are ripped). */
  platformKey?: string;
}

/** Squirrelcade's suggestion for a copy's estimated price (GET /api/v1/collection/copies/<id>/suggestion). */
export interface CostGuess {
  cents: number;
  basis: 'new' | 'used';
  newCents: number;
  date: string | null;
}

/** A test of a copy. */
export interface CopyTest {
  id: number;
  /** test (played) or rip (its disc read in full). */
  kind: TestKind;
  result: TestResult;
  note: string | null;
  testedAt: string;
}

const RESULT_COLORS: Record<TestResult, string> = { works: 'green', issues: 'yellow', broken: 'red' };

/** A test's (or a rip's) result in a word or two, colored. */
export function TestBadge({ kind = 'test', result, testedAt, dateFormat }: { kind?: TestKind; result: TestResult; testedAt: string; dateFormat: 'us' | 'iso' | 'eu' }) {
  return (
    <Badge size="sm" variant="light" color={RESULT_COLORS[result]} style={{ textTransform: 'none' }}>
      {kind === 'rip' ? 'Ripped' : 'Tested'} {date(testedAt, dateFormat)}: {(kind === 'rip' ? RIP_RESULTS : TEST_RESULTS)[result].toLowerCase()}
    </Badge>
  );
}

/** A copy to show or change: its key, and what to call it (with its own fields when they can be changed here). */
export interface CopyRef {
  copyKey: string;
  title: string;
  platform: string;
  condition: string;
  copy?: CopyFields;
}

/** Everything a copy's details show on, refreshed after a change. */
export const TOUCHED = ['copy', 'game', 'collection', 'tags', 'loans', 'sale', 'catalogs', 'wishlist', 'lookup', 'purchases', 'send', 'improve'];

/** The conditions a copy can be given, for a picker. */
export const CONDITIONS = (Object.keys(COMPLETENESS_LABELS) as Completeness[]).filter((c) => c !== 'unknown').map((value) => ({ value, label: COMPLETENESS_LABELS[value] }));

/** Adds a copy of a game to the collection (0.20.0): its condition, and what was paid and when if you like. */
/** Whether the collection comes from PriceCharting's exports (one was ever applied): copies added here go there too then. */
export function useFromPriceCharting(): boolean {
  const summary = useQuery({ queryKey: ['collection', 'summary'], queryFn: () => api<{ currentImport: unknown | null }>('/collection/summary') });
  return Boolean(summary.data?.currentImport);
}

export function AddCopyModal({ game, onClose }: { game: { platformKey: string; platform: string; title: string } | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const fromPriceCharting = useFromPriceCharting();
  const currency = useSetting('general.currency', 'USD');
  const usual = useSetting('collection.boughtCondition', 'complete');
  const [completeness, setCompleteness] = useState<string>(usual);
  const [paid, setPaid] = useState<number | string>('');
  const [bought, setBought] = useState('');
  const [notes, setNotes] = useState('');
  useEffect(() => {
    if (!game) return;
    setCompleteness(usual);
    setPaid('');
    setBought('');
    setNotes('');
  }, [game, usual]);
  const add = useMutation({
    mutationFn: () =>
      api('/collection/copies', {
        method: 'POST',
        json: { platformKey: game!.platformKey, title: game!.title, completeness, costCents: paid === '' ? null : Math.round(Number(paid) * 100), datePurchased: bought || null, notes: notes.trim() },
      }),
    onSuccess: async (answer) => {
      notifySuccess(`${game!.title} is in your collection.${fromPriceCharting ? ' Stash updates › Send to PriceCharting has it for PriceCharting.' : ''}${overGoalNote(answer)}`);
      await Promise.all(TOUCHED.map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
      onClose();
    },
    onError: (err) => notifyError(err),
  });
  return (
    <Modal opened={Boolean(game)} onClose={onClose} title={game ? `Add a copy · ${game.title} · ${game.platform}` : ''} zIndex={350}>
      <Stack gap="xs">
        <Select label="Condition" data={CONDITIONS} value={completeness} onChange={(v) => v && setCompleteness(v)} allowDeselect={false} comboboxProps={{ zIndex: 400 }} />
        <Group grow align="flex-start">
          <NumberInput label={`Price paid (${currency})`} value={paid} onChange={setPaid} min={0} decimalScale={2} allowNegative={false} placeholder="Optional" data-autofocus />
          <TextInput label="Bought on" type="date" value={bought} onChange={(e) => setBought(e.currentTarget.value)} />
        </Group>
        <TextInput label="Notes" value={notes} onChange={(e) => setNotes(e.currentTarget.value)} maxLength={500} placeholder="Optional" />
        <Group>
          <Button onClick={() => add.mutate()} loading={add.isPending}>
            Add it
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export const photoUrl = (id: number) => `/api/v1/photos/${id}`;

/** Makes a photo smaller in the browser (at most `maxSide` pixels on its longest side), as a JPEG. */
export async function shrinkPhoto(file: Blob, maxSide: number): Promise<Blob> {
  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Older browsers: through an image element.
    source = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new window.Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("This photo can't be read here; save it as a JPEG or PNG first."));
      img.src = URL.createObjectURL(file);
    });
  }
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("This photo can't be read here."))), 'image/jpeg', 0.85));
}

/** A copy's details in a line under it: where it is, tags, for sale, who has it, and its photos (each opens full size). */
export function CopyDetailLine({ details, loans, photos, currency, dateFormat }: { details: CopyDetail | null; loans: Loan[]; photos: PhotoInfo[]; currency: string; dateFormat: 'us' | 'iso' | 'eu' }) {
  if (!details && loans.length === 0 && photos.length === 0) return null;
  return (
    <Stack gap={4} mt={4}>
      <Group gap={6} wrap="wrap">
        {details?.location && (
          <Badge size="sm" variant="outline" color="gray" leftSection={<IconMapPin size={11} />} style={{ textTransform: 'none' }}>
            {details.location}
          </Badge>
        )}
        {details?.tags.map((t) => (
          <Badge key={t} size="sm" variant="light" color="gray" style={{ textTransform: 'none' }}>
            {t}
          </Badge>
        ))}
        {details?.digitalClaim === 'claimed' && (
          <Badge size="sm" variant="light" color="teal" style={{ textTransform: 'none' }}>
            Digital copy claimed{details.digitalStore ? ` (${details.digitalStore})` : ''}
          </Badge>
        )}
        {details?.sale && (
          <Badge size="sm" variant="light" color="orange" style={{ textTransform: 'none' }}>
            {details.sale === 'sale' ? 'For sale' : 'For trade'}
            {details.askingCents !== null ? ` · ${money(details.askingCents, currency)}` : ''}
          </Badge>
        )}
        {loans.map((l) => (
          <Badge key={l.id} size="sm" variant="light" color={l.overdue ? 'red' : 'blue'} leftSection={<IconUserShare size={11} />} style={{ textTransform: 'none' }}>
            Lent to {l.lentTo}
            {l.dueAt ? ` · ${l.overdue ? 'was due' : 'due'} ${date(l.dueAt, dateFormat)}` : ''}
          </Badge>
        ))}
      </Group>
      {photos.length > 0 && (
        <Group gap={6}>
          {photos.map((p) => (
            <Anchor key={p.id} href={photoUrl(p.id)} target="_blank" rel="noreferrer" aria-label={p.caption ? `Photo: ${p.caption}` : 'Photo'}>
              <Image src={photoUrl(p.id)} w={44} h={44} radius={3} fit="cover" alt={p.caption ?? ''} loading="lazy" />
            </Anchor>
          ))}
        </Group>
      )}
    </Stack>
  );
}

/**
 * A copy's details, for the owner: where it's kept, tags, for sale or trade (and the asking price), lending it and
 * getting it back, and its photos (made smaller in the browser before they're sent).
 */
export function CopyDetailsModal({
  copy,
  onClose,
  onNext,
  position,
}: {
  copy: CopyRef | null;
  onClose: () => void;
  /** Collection > Improve's walk through its list: the next copy, and where this one is in it. */
  onNext?: () => void;
  position?: string;
}) {
  const queryClient = useQueryClient();
  const currency = useSetting('general.currency', 'USD');
  const dateFormat = useSetting('general.dateFormat', 'us');
  const loanDays = useSetting('collection.loanDays', 30);
  const maxSide = useSetting('collection.photoMaxSide', 1600);
  const key = copy?.copyKey ?? '';
  const current = useQuery({
    queryKey: ['copy', key],
    queryFn: () => api<{ copyKey: string; details: CopyDetail; loans: Loan[]; photos: PhotoInfo[]; tests: CopyTest[] }>(`/copy?key=${encodeURIComponent(key)}`),
    enabled: Boolean(copy),
  });
  const vocabulary = useQuery({ queryKey: ['tags'], queryFn: () => api<{ tags: { name: string }[]; locations: { name: string }[] }>('/tags'), enabled: Boolean(copy) });
  const [location, setLocation] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [sale, setSale] = useState<'none' | 'sale' | 'trade'>('none');
  const [asking, setAsking] = useState<number | string>('');
  const [saleNote, setSaleNote] = useState('');
  const [digitalClaim, setDigitalClaim] = useState('');
  const [digitalClaimedAt, setDigitalClaimedAt] = useState('');
  const [digitalStore, setDigitalStore] = useState('');
  const [lentTo, setLentTo] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [uploading, setUploading] = useState(0);
  const [testNote, setTestNote] = useState('');
  const [selling, setSelling] = useState<'list' | 'sold' | null>(null);
  const ripConsoles = useSetting('collection.ripConsoles', []);
  const own = copy?.copy;
  const canRip = Boolean(own?.platformKey && ripConsoles.includes(own.platformKey));
  const [completeness, setCompleteness] = useState('');
  const [paid, setPaid] = useState<number | string>('');
  const [bought, setBought] = useState('');
  const [notes, setNotes] = useState('');
  const [estimated, setEstimated] = useState<number | string>('');
  // What Suggest proposed, said beside the field (why that amount).
  const [suggested, setSuggested] = useState<CostGuess | null>(null);
  const suggestionsOn = useSetting('collection.estimates', true);
  useLayoutEffect(() => {
    if (!own) return;
    setCompleteness(own.completeness);
    // PriceCharting writes 0 for a price it wasn't given: it shows as not known.
    setPaid(own.costCents ? own.costCents / 100 : '');
    setBought(own.datePurchased ?? '');
    setNotes(own.notes);
    setEstimated(own.estimatedCents != null ? own.estimatedCents / 100 : '');
    setSuggested(null);
  }, [own]);
  const suggest = useMutation({
    mutationFn: () => api<{ suggestion: CostGuess | null }>(`/collection/copies/${own!.id}/suggestion`),
    onSuccess: ({ suggestion }) => {
      if (!suggestion) {
        notifyError(new Error("Squirrelcade has no usual price for this console (Settings › Collection › Suggested estimates)."));
        return;
      }
      setSuggested(suggestion);
      setEstimated(suggestion.cents / 100);
    },
    onError: (err) => notifyError(err),
  });
  const d = current.data?.details;
  // The form starts from what's saved, once each time a copy is opened: its fields wait until the saved values are in
  // them (typed into sooner, a value would be overwritten when they came), and a later answer for the same copy never
  // replaces what was typed since.
  const [filledFor, setFilledFor] = useState<string | null>(null);
  const waiting = !d || filledFor !== key;
  useLayoutEffect(() => {
    if (!copy) {
      setFilledFor(null);
      return;
    }
    if (!d || filledFor === key) return;
    setLocation(d.location ?? '');
    setTags(d.tags);
    setSale(d.sale ?? 'none');
    setAsking(d.askingCents !== null ? d.askingCents / 100 : '');
    setSaleNote(d.saleNote ?? '');
    setDigitalClaim(d.digitalClaim ?? '');
    setDigitalClaimedAt(d.digitalClaimedAt ?? '');
    setDigitalStore(d.digitalStore ?? '');
    setFilledFor(key);
  }, [copy, d, key, filledFor]);
  useEffect(() => {
    setLentTo('');
    setDueAt(loanDays > 0 ? new Date(Date.now() + loanDays * 86_400_000).toISOString().slice(0, 10) : '');
  }, [key, loanDays]);
  const refresh = () => Promise.all(TOUCHED.map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
  const change = useMutation({
    mutationFn: (c: { path: string; method: 'PUT' | 'POST' | 'DELETE'; json?: unknown; done?: string }) => api(c.path, { method: c.method, json: c.json }),
    onSuccess: async (_r, c) => {
      if (c.done) notifySuccess(c.done);
      await refresh();
    },
    onError: (err) => notifyError(err),
  });

  const saveDetails = () =>
    change.mutate({
      path: '/copy',
      method: 'PUT',
      json: {
        key,
        location: location.trim() || null,
        tags,
        sale: sale === 'none' ? null : sale,
        askingCents: sale !== 'none' && asking !== '' ? Math.round(Number(asking) * 100) : null,
        saleNote: sale !== 'none' ? saleNote.trim() || null : null,
        digitalClaim: digitalClaim || null,
        digitalClaimedAt: digitalClaim === 'claimed' && digitalClaimedAt ? digitalClaimedAt : null,
        digitalStore: digitalClaim ? digitalStore.trim() || null : null,
      },
      done: 'Saved.',
    });

  /** A standard photo (its slot), taking the place of the one it had. */
  async function addSlotPhoto(slot: string, file: File) {
    setUploading(1);
    try {
      const form = new FormData();
      form.append('key', key);
      form.append('slot', slot);
      form.append('file', await shrinkPhoto(file, maxSide), 'photo.jpg');
      await api('/photos', { method: 'POST', body: form });
      notifySuccess(`${slot}: kept.`);
    } catch (err) {
      notifyError(err, "The photo couldn't be kept");
    } finally {
      setUploading(0);
      await refresh();
    }
  }

  const addTest = (result: TestResult, kind: TestKind = 'test') => {
    const said = (kind === 'rip' ? RIP_RESULTS : TEST_RESULTS)[result].toLowerCase();
    change.mutate({ path: '/copy/tests', method: 'POST', json: { key, kind, result, note: testNote.trim() || null }, done: `${kind === 'rip' ? 'Ripped' : 'Tested'}: ${said}.` });
    setTestNote('');
  };

  async function addPhotos(files: File[]) {
    setUploading(files.length);
    try {
      for (const file of files) {
        const small = await shrinkPhoto(file, maxSide);
        const form = new FormData();
        form.append('key', key);
        form.append('caption', file.name.replace(/\.[^.]+$/, '').slice(0, 100));
        form.append('file', small, 'photo.jpg');
        await api('/photos', { method: 'POST', body: form });
        setUploading((n) => n - 1);
      }
      notifySuccess(files.length === 1 ? 'Photo kept.' : `${files.length} photos kept.`);
    } catch (err) {
      notifyError(err, "A photo couldn't be kept");
    } finally {
      setUploading(0);
      await refresh();
    }
  }

  const saveCopy = () =>
    change.mutate({
      path: `/collection/copies/${own!.id}`,
      method: 'PUT',
      json: {
        ...(completeness !== 'unknown' ? { completeness } : {}),
        costCents: paid === '' ? null : Math.round(Number(paid) * 100),
        estimatedCents: estimated === '' ? null : Math.round(Number(estimated) * 100),
        datePurchased: bought || null,
        notes: notes.trim(),
      },
      done: 'Saved. What you change here stays, whatever the next export says.',
    });
  const takeOut = (reason: 'sold' | 'removed') => {
    if (!own || !window.confirm(`${reason === 'sold' ? 'Sold' : 'Remove'} this copy of ${copy?.title}? It leaves your collection (its details stay in the history).`)) return;
    change.mutate({ path: `/collection/copies/${own.id}/remove`, method: 'POST', json: { reason }, done: `${copy?.title}: ${reason === 'sold' ? 'sold' : 'removed'}.` });
    onClose();
  };

  const slots = own?.slots ?? [];
  const inSlot = new Map((current.data?.photos ?? []).filter((p) => p.slot).map((p) => [p.slot!, p]));
  const others = (current.data?.photos ?? []).filter((p) => !p.slot || !slots.includes(p.slot));
  const open = (current.data?.loans ?? []).filter((l) => l.returnedAt === null);
  const history = (current.data?.loans ?? []).filter((l) => l.returnedAt !== null);
  const busy = change.isPending;

  return (
    // Above the game drawer it opens from (a drawer is 200), with its lists above it in turn.
    <Modal opened={Boolean(copy)} onClose={onClose} title={copy ? `${copy.title} · ${copy.platform} · ${copy.condition}` : ''} size="lg" zIndex={350}>
      {!current.data ? (
        <Loader />
      ) : (
        <Stack gap="md">
          {own && (
            <>
              <Stack gap="xs">
                <Group grow align="flex-start">
                  <Select label="Condition" data={CONDITIONS} value={completeness === 'unknown' ? null : completeness} onChange={(v) => v && setCompleteness(v)} allowDeselect={false} placeholder="Unknown" comboboxProps={{ zIndex: 400 }} />
                  <NumberInput label={`Price paid (${currency})`} value={paid} onChange={setPaid} min={0} decimalScale={2} allowNegative={false} placeholder="Not known" />
                  <TextInput label="Bought on" type="date" value={bought} onChange={(e) => setBought(e.currentTarget.value)} />
                </Group>
                {paid === '' && (
                  <Stack gap={2}>
                    <Group align="flex-end" gap="xs" wrap="nowrap">
                      <NumberInput
                        label={`Estimated price (${currency})`}
                        description="If you don't know what you paid"
                        value={estimated}
                        onChange={setEstimated}
                        min={0}
                        decimalScale={2}
                        allowNegative={false}
                        placeholder="Empty"
                        maw={220}
                      />
                      {suggestionsOn && (
                        <Button variant="default" size="sm" loading={suggest.isPending} onClick={() => suggest.mutate()}>
                          Suggest
                        </Button>
                      )}
                    </Group>
                    <Text size="xs" c="dimmed">
                      {suggested
                        ? `Suggested: ${suggested.basis === 'new' ? 'a new game on this console' : `used, ${Math.round((suggested.cents / suggested.newCents) * 100)}% of a new game`}${suggested.date ? `, which came out ${date(suggested.date, dateFormat)}` : ''}. Change it if you know better, then save. `
                        : ''}
                      Yours alone, for what you've spent: never a price paid, never sent to PriceCharting or put in a download.
                    </Text>
                  </Stack>
                )}
                <TextInput label="Notes" value={notes} onChange={(e) => setNotes(e.currentTarget.value)} maxLength={500} />
                <Group justify="space-between">
                  <Button onClick={saveCopy} loading={busy}>
                    Save the copy
                  </Button>
                  <Group gap="xs">
                    <Button variant="light" color="green" size="compact-sm" onClick={() => setSelling('list')} disabled={busy}>
                      Ready to sell
                    </Button>
                    <Button variant="default" size="compact-sm" onClick={() => setSelling('sold')} disabled={busy}>
                      Sold
                    </Button>
                    <Button variant="subtle" color="gray" size="compact-sm" onClick={() => takeOut('removed')} disabled={busy}>
                      Remove
                    </Button>
                  </Group>
                </Group>
              </Stack>
              <Divider label="Tested" labelPosition="left" />
              <Stack gap={6}>
                <Group gap="xs" align="flex-end" wrap="wrap">
                  <TextInput label="A note (optional)" placeholder="Saves fine, the battery's dead..." value={testNote} onChange={(e) => setTestNote(e.currentTarget.value)} maxLength={200} w={260} />
                  <Button size="compact-sm" color="green" variant="light" leftSection={<IconCheck size={14} />} loading={busy} onClick={() => addTest('works')}>
                    It works
                  </Button>
                  <Button size="compact-sm" color="yellow" variant="light" loading={busy} onClick={() => addTest('issues')}>
                    Works, with problems
                  </Button>
                  <Button size="compact-sm" color="red" variant="light" loading={busy} onClick={() => addTest('broken')}>
                    Doesn't work
                  </Button>
                </Group>
                {canRip && (
                  <Group gap="xs" align="center" wrap="wrap">
                    <Text size="sm">Ripped:</Text>
                    <Button size="compact-sm" color="green" variant="light" loading={busy} onClick={() => addTest('works', 'rip')}>
                      Read fully
                    </Button>
                    <Button size="compact-sm" color="yellow" variant="light" loading={busy} onClick={() => addTest('issues', 'rip')}>
                      Read with errors
                    </Button>
                    <Button size="compact-sm" color="red" variant="light" loading={busy} onClick={() => addTest('broken', 'rip')}>
                      Couldn't be read
                    </Button>
                  </Group>
                )}
                {(current.data.tests ?? []).map((t) => (
                  <Group key={t.id} gap={6} wrap="nowrap">
                    <TestBadge kind={t.kind} result={t.result} testedAt={t.testedAt} dateFormat={dateFormat} />
                    {t.note && (
                      <Text size="xs" c="dimmed">
                        {t.note}
                      </Text>
                    )}
                    <CloseButton size="sm" aria-label={`Remove the test of ${date(t.testedAt, dateFormat)}`} onClick={() => change.mutate({ path: `/copy/tests/${t.id}`, method: 'DELETE' })} />
                  </Group>
                ))}
              </Stack>
              <Divider label="Where it is, tags, selling and its digital copy" labelPosition="left" />
            </>
          )}
          <Stack gap="xs">
            <Autocomplete label="Where it is" placeholder="Shelf A, the closet, the office..." disabled={waiting} value={location} onChange={setLocation} data={(vocabulary.data?.locations ?? []).map((l) => l.name)} maxLength={80} comboboxProps={{ zIndex: 400 }} />
            <TagsInput label="Your tags" placeholder="Favorite, signed, to sell..." disabled={waiting} value={tags} onChange={setTags} data={(vocabulary.data?.tags ?? []).map((t) => t.name)} maxTags={20} clearable comboboxProps={{ zIndex: 400 }} />
            <SegmentedControl
              aria-label="For sale or trade"
              disabled={waiting}
              value={sale}
              onChange={(v) => setSale(v as typeof sale)}
              data={[
                { value: 'none', label: 'Keeping it' },
                { value: 'sale', label: 'For sale' },
                { value: 'trade', label: 'For trade' },
              ]}
            />
            {sale !== 'none' && (
              <Group grow align="flex-start">
                <NumberInput label={`Asking (${currency})`} value={asking} onChange={setAsking} min={0} decimalScale={2} allowNegative={false} placeholder="Optional" />
                <TextInput label="A note for buyers" value={saleNote} onChange={(e) => setSaleNote(e.currentTarget.value)} maxLength={200} placeholder="Optional" />
              </Group>
            )}
            <Group grow align="flex-start">
              <Select
                label="Its digital copy"
                description="A license that came with the disc (Xbox disc-to-digital, a code in the box)"
                data={DIGITAL_CLAIMS}
                value={digitalClaim}
                onChange={(v) => setDigitalClaim(v ?? '')}
                allowDeselect={false}
                disabled={waiting}
                comboboxProps={{ zIndex: 400 }}
              />
              {digitalClaim === 'claimed' && <TextInput label="Claimed on" type="date" value={digitalClaimedAt} onChange={(e) => setDigitalClaimedAt(e.currentTarget.value)} disabled={waiting} />}
              {digitalClaim !== '' && digitalClaim !== 'not-eligible' && (
                <Autocomplete label="Store" placeholder="Xbox" value={digitalStore} onChange={setDigitalStore} data={['Xbox', 'PlayStation', 'Nintendo', 'Steam']} maxLength={40} disabled={waiting} comboboxProps={{ zIndex: 400 }} />
              )}
            </Group>
            <Group>
              <Button onClick={saveDetails} loading={busy} disabled={waiting}>
                Save
              </Button>
            </Group>
          </Stack>

          <Divider label="Lending" labelPosition="left" />
          {open.map((l) => (
            <Group key={l.id} justify="space-between" wrap="wrap" gap="xs">
              <Text size="sm" c={l.overdue ? 'red' : undefined}>
                Lent to {l.lentTo} on {date(l.lentAt, dateFormat)}
                {l.dueAt ? `, ${l.overdue ? 'was due' : 'due'} back ${date(l.dueAt, dateFormat)}` : ''}
                {l.note ? ` (${l.note})` : ''}
              </Text>
              <Button size="compact-sm" variant="light" loading={busy} onClick={() => change.mutate({ path: `/loans/${l.id}/return`, method: 'POST', json: {}, done: `${copy?.title} is back.` })}>
                It's back
              </Button>
            </Group>
          ))}
          <Group align="flex-end" wrap="wrap" gap="xs">
            <TextInput label="Lend it to" placeholder="A name" value={lentTo} onChange={(e) => setLentTo(e.currentTarget.value)} maxLength={60} w={200} />
            <TextInput label="Due back" type="date" value={dueAt} onChange={(e) => setDueAt(e.currentTarget.value)} w={170} />
            <Button
              variant="default"
              disabled={!lentTo.trim()}
              loading={busy}
              onClick={() => {
                change.mutate({ path: '/loans', method: 'POST', json: { key, lentTo: lentTo.trim(), dueAt: dueAt || null }, done: `Lent to ${lentTo.trim()}.` });
                setLentTo('');
              }}
            >
              Lend
            </Button>
          </Group>
          {history.length > 0 && (
            <Text size="xs" c="dimmed">
              Lent before: {history.map((l) => `${l.lentTo} (${date(l.lentAt, dateFormat)} to ${date(l.returnedAt, dateFormat)})`).join('; ')}
            </Text>
          )}

          <Divider label="Photos" labelPosition="left" />
          {slots.length > 0 && (
            <SimpleGrid cols={{ base: 3, xs: 5 }} spacing="xs">
              {slots.map((slot) => {
                const p = inSlot.get(slot);
                return (
                  <Stack key={slot} gap={2}>
                    {p ? (
                      <Anchor href={photoUrl(p.id)} target="_blank" rel="noreferrer">
                        <Image src={photoUrl(p.id)} radius="sm" h={90} fit="cover" alt={slot} />
                      </Anchor>
                    ) : (
                      <FileButton onChange={(file) => file && void addSlotPhoto(slot, file)} accept="image/*" capture="environment">
                        {(props) => (
                          <Button {...props} variant="default" h={90} leftSection={<IconCamera size={16} />} loading={uploading > 0} aria-label={`Take ${slot}`} styles={{ label: { whiteSpace: 'normal' } }}>
                            {slot}
                          </Button>
                        )}
                      </FileButton>
                    )}
                    {p && (
                      <Group gap={2} wrap="nowrap" justify="space-between">
                        <Text size="xs" truncate="end">
                          {slot}
                        </Text>
                        <FileButton onChange={(file) => file && void addSlotPhoto(slot, file)} accept="image/*" capture="environment">
                          {(props) => (
                            <Anchor {...props} component="button" type="button" size="xs" aria-label={`Retake ${slot}`}>
                              retake
                            </Anchor>
                          )}
                        </FileButton>
                      </Group>
                    )}
                  </Stack>
                );
              })}
            </SimpleGrid>
          )}
          {others.length > 0 && (
            <SimpleGrid cols={{ base: 3, xs: 4 }} spacing="xs">
              {others.map((p) => (
                <Stack key={p.id} gap={2}>
                  <Anchor href={photoUrl(p.id)} target="_blank" rel="noreferrer">
                    <Image src={photoUrl(p.id)} radius="sm" h={110} fit="cover" alt={p.caption ?? ''} />
                  </Anchor>
                  <Group gap={2} wrap="nowrap" justify="space-between">
                    <Tooltip label={p.caption ?? 'No caption'}>
                      <Text size="xs" c="dimmed" truncate="end">
                        {p.caption ?? ''}
                      </Text>
                    </Tooltip>
                    <CloseButton size="sm" aria-label={`Remove photo ${p.caption ?? ''}`} onClick={() => change.mutate({ path: `/photos/${p.id}`, method: 'DELETE', done: 'Photo removed.' })} />
                  </Group>
                </Stack>
              ))}
            </SimpleGrid>
          )}
          <Group>
            <FileButton onChange={(files) => files.length > 0 && void addPhotos(files)} accept="image/jpeg,image/png,image/webp,image/heic,image/*" multiple>
              {(props) => (
                <Button {...props} variant="default" leftSection={<IconCamera size={16} />} loading={uploading > 0}>
                  Add photos
                </Button>
              )}
            </FileButton>
            <Text size="xs" c="dimmed">
              Made smaller in your browser first (Settings › Collection › Photo size); kept in Squirrelcade's database and its backups.
            </Text>
          </Group>
          {own && (
            <SellHelper
              copy={selling ? { id: own.id, title: copy?.title ?? '' } : null}
              justSold={selling === 'sold'}
              onClose={() => setSelling(null)}
              onSold={onClose}
              onTakeOut={() => {
                setSelling(null);
                takeOut('sold');
              }}
            />
          )}
          {onNext && (
            <Group justify="flex-end" gap="sm">
              {position && (
                <Text size="sm" c="dimmed">
                  {position}
                </Text>
              )}
              <Button onClick={onNext}>Next copy</Button>
            </Group>
          )}
        </Stack>
      )}
    </Modal>
  );
}
