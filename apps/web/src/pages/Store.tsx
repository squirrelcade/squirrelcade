import { Alert, Anchor, Button, Card, Group, Loader, NumberInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { useDebouncedValue, useMediaQuery } from '@mantine/hooks';
import { COMPLETENESS_LABELS, priceChartingBarcodeUrl, priceChartingUrl, shopLinksFor, shopUrl, SHOPS_IN_LISTS, type Completeness } from '@squirrelcade/core';
import { IconCurrencyDollar, IconPlus, IconSearch, IconVideoFilled } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, errorMessage } from '../api';
import { BarcodeLookupsLeft, HelpLink, RetryCountdown } from '../components';
import { RegionBadge } from '../Region';
import type { RommLink } from '../Romm';
import { count, date, money, timeAgo } from '../format';
import { overGoalNote } from '../Goal';
import { notifyError, notifySuccess, useCanEdit, useSetting, useSettings } from '../hooks';
import {
  BARCODE_WAIT_MS,
  clearCopy,
  NotSquirrelcade,
  OFFLINE_WAIT_MS,
  offlineBarcode,
  offlineSearch,
  queuedPurchases,
  queuePurchase,
  readCopy,
  refreshCopy,
  sendQueued,
  unreachable,
  waitAtMost,
  type QueuedPurchase,
  type SavedCopy,
} from '../offline';
import { ScannerModal } from '../ScannerModal';
import { CopyDetailsModal, type CopyRef } from '../CopyDetails';
import { isBarcode } from '../lines';
import { GameCover, GameTitle } from '../GameDrawer';
import { GameStars, RommChip, type GameStar } from '../GameHeader';
import { useOrdersOn } from '../OrderEmails';
import { type Answer } from '../choices';
import { Verdict } from '../Verdict';
import { PreferencePicker } from '../Preference';
import { Link, useSearchParams } from 'react-router';
import { ConsoleChips } from '../ConsoleChips';
import { Acorns, Reviews, type ReviewsOf } from '../Acorn';


interface Result {
  platformKey: string;
  platform: string;
  title: string;
  answer: Answer;
  ownedAs: string[];
  ownedOn: string[];
  /** PC storefronts where the same game is owned for good. */
  ownedOnPc?: string[];
  maybe: string[];
  wishlist: { score: number; priority: string; rank: number | null } | null;
  coverId?: string | null;
  entryId?: number;
  pending?: boolean;
  ownedValueCents?: number | null;
  /** Which releases the owned copies are (region, PriceCharting's console name), for region badges. */
  ownedReleases?: { region: string; consoleLabel: string }[];
  /** The owner's sets the game is in. */
  sets?: string[];
  /** The owned game in the user's RomM, when it's there. */
  romm?: RommLink | null;
  /** Your own note on the game. */
  note?: string | null;
  /** Your wishlist preference for a catalog game. */
  preference?: string | null;
  /** IGDB's rating, beside its acorns (0.53.0). */
  reviews?: ReviewsOf;
  /** Bought and on the way (D156): Add it then makes it arrive, with what its email said. */
  onTheWay?: { id: number; store: string; orderDate: string | null; paidCents: number | null } | null;
  /** The stars beside its name, as on the game page (D165). */
  stars?: GameStar[];
}

/** The fields of a game's copy that its window needs (GET /api/v1/game). */
interface GameCopy {
  id: number;
  copyKey: string;
  title: string;
  completeness: string;
  costCents: number | null;
  datePurchased: string | null;
  notes: string;
  slots: string[];
  estimatedCents: number | null;
  gradingCompany: string;
  gradingCertId: string;
}

/** The answers a game can be added from (a game you have on another console, or one to check, may be bought here too). */
const ADDABLE: readonly Answer[] = ['need', 'unconfirmed', 'own-elsewhere', 'check'];

/** A copy added in Squirrelcade that no export has yet (Add it, Add a copy): GET /api/v1/purchases. */
interface Purchase {
  id: number;
  key: string;
  entryId: number | null;
  title: string;
  platform: string;
  condition: string;
  costCents: number | null;
  createdAt: string;
  sentAt: string | null;
}

/**
 * What you paid for a copy just bought, asked right in the store (0.32.0): "what you paid?" beside undo opens a field;
 * saved on the copy, it reads "paid $12.50" (tap to change).
 */
function PaidInStore({ purchase, currency }: { purchase: Purchase; currency: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [paid, setPaid] = useState<number | string>(purchase.costCents ? purchase.costCents / 100 : '');
  const save = useMutation({
    mutationFn: () => api(`/collection/copies/${purchase.id}`, { method: 'PUT', json: { costCents: paid === '' ? null : Math.round(Number(paid) * 100) } }),
    onSuccess: async () => {
      setOpen(false);
      await Promise.all(['purchases', 'collection', 'copy', 'improve'].map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
    },
    onError: (err) => notifyError(err),
  });
  if (!open) {
    return (
      <Anchor component="button" type="button" size="xs" onClick={() => setOpen(true)}>
        {purchase.costCents ? `paid ${money(purchase.costCents, currency)}` : 'what you paid?'}
      </Anchor>
    );
  }
  return (
    <Group gap={6} mt={4} wrap="nowrap" component="span" style={{ display: 'inline-flex' }}>
      <NumberInput
        size="xs"
        w={110}
        aria-label={`What you paid for ${purchase.title} (${currency})`}
        placeholder={currency}
        value={paid}
        onChange={setPaid}
        min={0}
        decimalScale={2}
        allowNegative={false}
        inputMode="decimal"
        autoFocus
        onKeyDown={(e) => e.key === 'Enter' && save.mutate()}
      />
      <Button size="compact-xs" onClick={() => save.mutate()} loading={save.isPending}>
        Save
      </Button>
    </Group>
  );
}

interface BarcodeAnswer {
  code: string;
  known: boolean;
  productName: string | null;
  searchedFor: string | null;
  /** The console the barcode service's name names, whose games come first. */
  platformKey?: string | null;
  platformName?: string | null;
  results: Result[];
  message: string | null;
  /** Waiting its turn with the barcode service (6 lookups a minute): ask again in this many seconds. */
  retryInSeconds?: number | null;
  /** The barcode service's lookups left today, when this answer asked it or waits for it. */
  lookups?: { left: number | null; resetAt: string | null } | null;
}

/** What Store Mode says when something other than Squirrelcade answers. */
const NOT_SQUIRRELCADE = "Something other than Squirrelcade answered (a Wi-Fi network's sign-in page?).";

/** Store Mode: scan or type, get an instant owned / needed answer. Built for one hand on a phone. */
export function StorePage() {
  const [text, setText] = useState('');
  const [query] = useDebouncedValue(text.trim(), 300);
  const [scanning, setScanning] = useState(false);
  // The header's camera button (and any link with ?scan=1) opens Store Mode with the camera already on.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get('scan') !== '1') return;
    setScanning(true);
    params.delete('scan');
    setParams(params, { replace: true });
  }, [params, setParams]);
  // A new barcode Squirrelcade couldn't name: kept while you search by title, so the game you find can be linked to it.
  const [linkCode, setLinkCode] = useState<string | null>(null);
  // On a phone the answer goes under the title: beside it, a long answer squeezes the title into a narrow column.
  const narrow = useMediaQuery('(max-width: 36em)');
  const barcode = isBarcode(query) ? query.replace(/\D/g, '') : null;
  const queryClient = useQueryClient();
  const canEdit = useCanEdit();
  // Find in my email on (Settings > Email): the haul's prices from the order emails, in Recently added.
  const ordersOn = useOrdersOn();

  // This browser's copy of Store Mode's answers, updated each time Store Mode opens, for answering without a
  // connection (Settings > Interface > "Answer without a connection"; off removes it).
  const settingsLoaded = useSettings().data !== undefined;
  const offlineOn = useSetting('interface.storeOffline', true);
  const [saved, setSaved] = useState<SavedCopy | null>(null);
  useEffect(() => {
    if (!settingsLoaded) return;
    let live = true;
    if (!offlineOn) {
      void clearCopy();
      setSaved(null);
    } else {
      void readCopy().then((c) => live && setSaved(c));
      void refreshCopy().then((c) => live && setSaved(c));
    }
    return () => {
      live = false;
    };
  }, [settingsLoaded, offlineOn]);

  // Each search asks Squirrelcade; when it can't be reached (no signal, a store's Wi-Fi sign-in page, a server
  // that's down, or no answer in a few seconds), the copy answers instead, and the page says so.
  const titleSearch = useQuery({
    queryKey: ['lookup', 'title', query],
    queryFn: async ({ signal }): Promise<{ results: Result[]; offlineAt: string | null }> => {
      const copy = offlineOn ? await readCopy() : null;
      try {
        const results = await api<Result[]>(`/lookup?q=${encodeURIComponent(query)}`, { signal: copy ? waitAtMost(signal, OFFLINE_WAIT_MS) : signal });
        if (!Array.isArray(results)) throw new NotSquirrelcade(NOT_SQUIRRELCADE);
        return { results, offlineAt: null };
      } catch (err) {
        if (!copy || signal?.aborted || !unreachable(err)) throw err;
        return { results: offlineSearch(copy.copy, query), offlineAt: copy.savedAt };
      }
    },
    enabled: !barcode && query.length >= 2,
    // Asked even when the browser says it's offline (React Query would wait for the connection): the copy answers.
    networkMode: 'always',
  });
  const barcodeSearch = useQuery({
    queryKey: ['lookup', 'barcode', barcode],
    queryFn: async ({ signal }): Promise<BarcodeAnswer & { offlineAt: string | null }> => {
      const copy = offlineOn ? await readCopy() : null;
      try {
        const found = await api<BarcodeAnswer>(`/lookup/barcode/${barcode}`, { signal: copy ? waitAtMost(signal, BARCODE_WAIT_MS) : signal });
        if (!found || !Array.isArray(found.results)) throw new NotSquirrelcade(NOT_SQUIRRELCADE);
        return { ...found, offlineAt: null };
      } catch (err) {
        if (!copy || signal?.aborted || !unreachable(err)) throw err;
        const known = offlineBarcode(copy.copy, barcode!);
        return {
          code: barcode!,
          known: known !== null,
          productName: null,
          searchedFor: known?.title ?? null,
          results: known?.results ?? [],
          message: known ? null : "This barcode isn't one you saved, so this browser's copy doesn't know it. Type the game's title instead.",
          offlineAt: copy.savedAt,
        };
      }
    },
    enabled: barcode !== null,
    networkMode: 'always',
    // A barcode waiting its turn with the barcode service: asked again when the server says (it looks it up meanwhile).
    refetchInterval: (q) => (q.state.data?.retryInSeconds ? q.state.data.retryInSeconds * 1000 : false),
  });
  const link = useMutation({
    mutationFn: (r: Result) => api('/barcodes', { method: 'POST', json: { code: barcode ?? linkCode, platformKey: r.platformKey, title: r.title } }),
    onSuccess: async (_d, r) => {
      notifySuccess(`This barcode is now ${r.title} (${r.platform}).`, 'Barcode saved');
      setLinkCode(null);
      await queryClient.invalidateQueries({ queryKey: ['lookup', 'barcode'] });
    },
    onError: (err) => notifyError(err),
  });
  // A barcode linked to the wrong game (a mis-tap on "This is it", or another app's export): forgotten, so the
  // answer comes from its name again and the right game can be linked.
  const forget = useMutation({
    mutationFn: (code: string) => api(`/barcodes/${code}`, { method: 'DELETE' }),
    onSuccess: async () => {
      notifySuccess('Tap “This is it” on the right game, or search for it by title.', 'Barcode link forgotten');
      await queryClient.invalidateQueries({ queryKey: ['lookup', 'barcode'] });
    },
    onError: (err) => notifyError(err),
  });
  const shops = useSetting('interface.shopLinks', []);
  // What Add it records a game as at first (Settings > Collection > Adding copies), until its window says otherwise.
  const boughtCondition = useSetting('collection.boughtCondition', 'complete');
  // The window of the copy just added (D153): what was paid, the day, notes and photos, all at once.
  const [editing, setEditing] = useState<CopyRef | null>(null);
  const openCopy = async (r: Result, added: { id: number; key: string }) => {
    let found: GameCopy | undefined;
    try {
      const view = await api<{ copies: GameCopy[] }>(`/game?platform=${encodeURIComponent(r.platformKey)}&title=${encodeURIComponent(r.title)}`);
      found = view.copies.find((c) => c.id === added.id);
    } catch {
      // Its window opens anyway, with what Add it gave it (only its standard photos are missing).
    }
    const completeness = found?.completeness ?? boughtCondition;
    setEditing({
      copyKey: found?.copyKey ?? added.key,
      title: r.title,
      platform: r.platform,
      condition: COMPLETENESS_LABELS[completeness as Completeness] ?? completeness,
      copy: {
        id: added.id,
        completeness,
        costCents: found?.costCents ?? null,
        datePurchased: found?.datePurchased ?? null,
        notes: found?.notes ?? '',
        slots: found?.slots ?? [],
        estimatedCents: found?.estimatedCents ?? null,
        platformKey: r.platformKey,
        gradingCompany: found?.gradingCompany ?? '',
        gradingCertId: found?.gradingCertId ?? '',
      },
    });
  };

  const purchases = useQuery({ queryKey: ['purchases'], queryFn: () => api<Purchase[]>('/purchases') });
  // How many of the copies added here still miss something Collection › Improve counts (a price, the day, photos, a test).
  const toFill = useQuery({
    queryKey: ['improve', 'added-here'],
    queryFn: () => api<{ total: number }>('/collection/improve?added=here&pageSize=1'),
    enabled: canEdit && (purchases.data?.length ?? 0) > 0,
  });
  const currency = useSetting('general.currency', 'USD');
  const dateFormat = useSetting('general.dateFormat', 'us');
  const summary = useQuery({ queryKey: ['collection', 'summary'], queryFn: () => api<{ currentImport: { appliedAt: string | null } | null }>('/collection/summary') });
  const valueDate = summary.data?.currentImport?.appliedAt ?? null;
  const purchaseOf = new Map((purchases.data ?? []).map((p) => [p.entryId, p]));
  const afterPurchase = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['purchases'] }),
      queryClient.invalidateQueries({ queryKey: ['improve'] }),
      queryClient.invalidateQueries({ queryKey: ['coming'] }),
      queryClient.invalidateQueries({ queryKey: ['lookup'] }),
      queryClient.invalidateQueries({ queryKey: ['catalogs'] }),
      queryClient.invalidateQueries({ queryKey: ['wishlist'] }),
    ]);
  // Games marked bought without a connection: kept in this browser, and sent (oldest first) as soon as
  // Squirrelcade answers again: when Store Mode opens, when the browser is back online, and after a search that
  // reached it.
  const [queued, setQueued] = useState<QueuedPurchase[]>([]);
  const flushing = useRef(false);
  const flush = async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      const sent = await sendQueued((entryId) => api('/purchases', { method: 'POST', json: { entryId } }));
      setQueued([...(await queuedPurchases())]);
      if (sent.length > 0) {
        notifySuccess(`${sent.map((x) => x.title).join(', ')} ${sent.length === 1 ? 'is' : 'are'} in your collection now.`, 'Bought without a connection');
        await afterPurchase();
      }
    } finally {
      flushing.current = false;
    }
  };
  useEffect(() => {
    void queuedPurchases().then((list) => {
      setQueued([...list]);
      if (list.length > 0) void flush();
    });
    const online = () => void flush();
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, []);
  const reached = titleSearch.data?.offlineAt === null || barcodeSearch.data?.offlineAt === null;
  useEffect(() => {
    if (reached && queued.length > 0) void flush();
  }, [reached, titleSearch.dataUpdatedAt, barcodeSearch.dataUpdatedAt]);
  const queuedIds = new Set(queued.map((x) => x.entryId));

  const buy = useMutation({
    mutationFn: async (r: Result): Promise<{ how: 'sent' | 'kept'; answer?: unknown }> => {
      try {
        // A game on the way arrives (D156): its price and the day of its order come with it.
        if (r.onTheWay) return { how: 'sent', answer: await api(`/coming/${r.onTheWay.id}/arrived`, { method: 'POST' }) };
        return { how: 'sent', answer: await api('/purchases', { method: 'POST', json: { entryId: r.entryId } }) };
      } catch (err) {
        // A game on the way arrives with its email's price, so it waits for a connection rather than being kept here.
        if (!offlineOn || !unreachable(err) || r.onTheWay) throw err;
        await queuePurchase({ entryId: r.entryId!, title: r.title, platform: r.platform });
        return { how: 'kept' };
      }
    },
    // Tried even when the browser says it's offline: without a connection, the purchase is kept.
    networkMode: 'always',
    onSuccess: async ({ how, answer }, r) => {
      if (how === 'kept') {
        setQueued([...(await queuedPurchases())]);
        notifySuccess(`Squirrelcade can't be reached, so ${r.title} is kept in this browser and counts as bought as soon as it answers.`, 'Bought, without a connection');
        return;
      }
      // Over the spending goal says so; then the copy's window, to put in what was paid, the day, notes and photos.
      const over = overGoalNote(answer);
      if (over) notifySuccess(`${r.title} is in your collection.${over}`, 'Bought');
      await afterPurchase();
      const added = answer as { id?: number; key?: string } | undefined;
      if (added?.id !== undefined && added.key) await openCopy(r, { id: added.id, key: added.key });
    },
    onError: (err) => notifyError(err),
  });
  /** Add it: the copy in hand is this game, so a new barcode waiting to be linked is linked to it too. */
  const addIt = (r: Result) => {
    if (linking && !offlineAt) link.mutate(r);
    buy.mutate(r);
  };
  // A copy on the shelf proves the physical release: confirming makes the game count.
  const confirm = useMutation({
    mutationFn: (r: Result) => api(`/catalogs/entries/${r.entryId}`, { method: 'PATCH', json: { targetStatus: 'required' } }),
    onSuccess: afterPurchase,
    onError: (err) => notifyError(err),
  });
  const unbuy = useMutation({
    mutationFn: (id: number) => api(`/purchases/${id}`, { method: 'DELETE' }),
    onSuccess: afterPurchase,
    onError: (err) => notifyError(err),
  });

  const results = barcode ? barcodeSearch.data?.results : titleSearch.data?.results;
  // One console's answers only, when they span several (the owner, 2026-10-16); a new search shows them all again.
  const [consoleKey, setConsoleKey] = useState<string | null>(null);
  useEffect(() => setConsoleKey(null), [query]);
  const shown = consoleKey ? results?.filter((r) => r.platformKey === consoleKey) : results;
  const loading = barcode ? barcodeSearch.isFetching : titleSearch.isFetching;
  const failed = barcode ? barcodeSearch.error : titleSearch.error;
  const offlineAt = (barcode ? barcodeSearch.data?.offlineAt : titleSearch.data?.offlineAt) ?? null;
  const b = barcode ? barcodeSearch.data : undefined;
  // A barcode that's new to Squirrelcade stays at hand for linking after a search by title.
  useEffect(() => {
    if (b && !b.known && !b.offlineAt) setLinkCode(b.code);
  }, [b?.code, b?.known, b?.offlineAt]);
  // The game a scanned barcode is (the console its name gives, else the first answer): its price goes by the barcode.
  const scannedKey = b ? (b.platformKey ?? b.results[0]?.platformKey) : undefined;
  const priceHref = (r: Result) => (b && r.platformKey === scannedKey ? priceChartingBarcodeUrl(b.code) : priceChartingUrl(r.title, r.platform));
  const linking = (b && !b.known) || (!barcode && linkCode !== null);

  // The verdict's second line: the one thing that matters most for this answer (said there, so not again below).
  const reasonOf = (r: Result): { text: ReactNode; said: 'wishlist' | 'worth' | 'ownedOn' | 'maybe' | null } => {
    switch (r.answer) {
      case 'need':
        return r.wishlist
          ? {
              text: (
                <>
                  {r.wishlist.rank ? `#${r.wishlist.rank} on your wishlist · ` : ''}
                  {r.wishlist.priority} priority, <Acorns n={r.wishlist.score} size={14} />
                  {r.reviews && (
                    <>
                      {' · '}
                      <Reviews r={r.reviews} size={14} />
                    </>
                  )}
                </>
              ),
              said: 'wishlist',
            }
          : { text: `Missing from your ${r.platform} games.`, said: null };
      case 'unconfirmed':
        return { text: 'The catalog lists it, but not as a physical release yet.', said: null };
      case 'own':
      case 'own-not-in-catalog':
        return r.ownedValueCents != null && r.ownedValueCents > 0
          ? { text: `Yours is worth ${money(r.ownedValueCents, currency)}${valueDate ? ` (PriceCharting, ${date(valueDate, dateFormat)})` : ''}.`, said: 'worth' }
          : { text: null, said: null };
      case 'own-elsewhere':
        return r.ownedOn.length > 0 ? { text: `You have it on ${r.ownedOn.join(', ')}.`, said: 'ownedOn' } : { text: null, said: null };
      case 'check':
        return r.maybe.length > 0 ? { text: `Might be ${r.maybe.join(' or ')} in your collection.`, said: 'maybe' } : { text: 'A copy of yours may be it: answer on Review.', said: null };
      case 'not-a-target':
        return { text: "Not a release you collect, or you said it isn't a target.", said: null };
      case 'not-tracked':
        return { text: "Squirrelcade doesn't collect this console.", said: null };
    }
  };
  // A viewer gets the answers, not the buttons that change the collection. Adding a game is the big Add it beside the
  // verdict (D153); these are the smaller answers about it.
  const hasActions = (r: Result) => canEdit && ((linking && !offlineAt) || (r.entryId !== undefined && r.answer === 'unconfirmed' && !offlineAt));
  const actions = (r: Result) => !canEdit ? null : (
    <>
      {linking && !offlineAt && (
        <Button size="compact-xs" variant="light" onClick={() => link.mutate(r)} loading={link.isPending}>
          This is it
        </Button>
      )}
      {r.entryId !== undefined && r.answer === 'unconfirmed' && !offlineAt && (
        <Button size="compact-xs" variant="light" onClick={() => confirm.mutate(r)} loading={confirm.isPending && confirm.variables?.entryId === r.entryId}>
          It's physical
        </Button>
      )}
    </>
  );
  const addable = (r: Result) => canEdit && r.entryId !== undefined && !queuedIds.has(r.entryId) && ADDABLE.includes(r.answer);

  return (
    <Stack maw={640} mx="auto" gap="sm">
      <Group justify="space-between" align="baseline">
        <Group gap={6} wrap="nowrap">
          <Title order={2}>Store Mode</Title>
          <HelpLink topic="store-mode" />
        </Group>
        <Group gap="md">
          {canEdit && (
            <Anchor component={Link} to="/store/shelf" size="sm">
              Scan my shelf
            </Anchor>
          )}
          {canEdit && (
            <Anchor component={Link} to="/store/pack" size="sm">
              Pack a place
            </Anchor>
          )}
          <Anchor component={Link} to="/store/photo" size="sm">
            Check a shelf
          </Anchor>
          <Anchor component={Link} to="/store/list" size="sm">
            Check a list
          </Anchor>
        </Group>
      </Group>
      <Group gap="xs" wrap="nowrap" align="flex-end">
        <TextInput
          flex={1}
          size="lg"
          placeholder="Barcode or title"
          leftSection={<IconSearch size={20} />}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          inputMode="search"
          autoFocus
        />
        <Button size="lg" leftSection={<IconVideoFilled size={20} />} onClick={() => setScanning(true)}>
          Scan
        </Button>
      </Group>
      {loading && <Loader size="sm" />}
      {offlineAt && !loading && (
        <Alert color="yellow" variant="light" title="Squirrelcade can't be reached">
          These answers come from this browser's copy, saved {timeAgo(offlineAt)}. A game you mark bought is kept here and counts once Squirrelcade answers again; notes and new barcodes wait for it.
        </Alert>
      )}
      {failed && !loading && (
        <Alert color="red" variant="light" title="No answer">
          {failed instanceof NotSquirrelcade ? failed.message : unreachable(failed) ? "Squirrelcade can't be reached right now." : errorMessage(failed)}
          {!saved && offlineOn && unreachable(failed) && " Open Store Mode while you're connected, and it keeps a copy of its answers for times like this."}
        </Alert>
      )}
      {b?.productName && (
        <Text size="sm" c="dimmed">
          New barcode. The barcode service calls it “{b.productName}”. Tap the game it is to remember it.
        </Text>
      )}
      {b?.known && (
        <Text size="sm" c="dimmed">
          Barcode {b.code}, linked before.
          {canEdit && !offlineAt && (
            <>
              {' '}
              <Anchor component="button" type="button" size="sm" onClick={() => forget.mutate(b.code)} disabled={forget.isPending}>
                Not this game?
              </Anchor>
            </>
          )}
        </Text>
      )}
      <BarcodeLookupsLeft lookups={b?.lookups} />
      {!barcode && linkCode && canEdit && !offlineAt && (
        <Text size="sm" c="dimmed">
          Barcode {linkCode}: tap “This is it” on the game it is, and Squirrelcade will know it next time.{' '}
          <Anchor size="sm" onClick={() => setLinkCode(null)}>
            Don't
          </Anchor>
        </Text>
      )}
      {b?.message && (
        <Alert color="gray">
          <Stack gap="xs">
            <Text size="sm">{b.message}</Text>
            {b.retryInSeconds ? <RetryCountdown seconds={b.retryInSeconds} since={barcodeSearch.dataUpdatedAt} /> : null}
            {!offlineAt && (
              <Group gap="xs">
                {/* PriceCharting knows most games' barcodes: its page names the game (and its price). */}
                <Button component="a" href={priceChartingBarcodeUrl(b.code)} target="_blank" rel="noreferrer" size="compact-sm" variant="default">
                  Look it up on PriceCharting
                </Button>
              </Group>
            )}
          </Stack>
        </Alert>
      )}
      {b && !b.message && results?.length === 0 && !loading && (
        <Alert color="gray" title="Nothing found">
          <Stack gap="xs">
            <Text size="sm">
              No catalog or collection game matches “{b.searchedFor ?? b.code}”{b.platformName ? ` on the ${b.platformName}` : ''}. If it's a game for a console you collect, it may be missing from that console's catalog, or its name may be written another way: search by title and tap “This is it” on the game.
            </Text>
            <Group gap="xs">
              {b.searchedFor && (
                <Button size="compact-sm" variant="light" leftSection={<IconSearch size={14} />} onClick={() => setText(b.searchedFor!)}>
                  Search by title
                </Button>
              )}
              {!offlineAt && (
                <Button component="a" href={priceChartingBarcodeUrl(b.code)} target="_blank" rel="noreferrer" size="compact-sm" variant="default">
                  Look it up on PriceCharting
                </Button>
              )}
            </Group>
          </Stack>
        </Alert>
      )}
      {!barcode && results?.length === 0 && !loading && query.length >= 2 && (
        <Alert color="gray" title="Nothing found">
          No catalog or collection game matches “{query}”. If it's a real game for a console you collect, it may be missing from that console's catalog.
        </Alert>
      )}
      {results && results.length > 0 && <ConsoleChips results={results} value={consoleKey} onChange={setConsoleKey} />}
      {shown?.map((r) => {
        const reason = reasonOf(r);
        return (
        <Card key={`${r.platformKey}|${r.title}`} withBorder padding="sm">
          {/* The verdict, and beside it, as tall as it, Add it for a game you can buy here (D153). */}
          <div className="sc-verdict-row">
            <Verdict answer={r.answer} reason={reason.text} />
            {addable(r) && (
              <button type="button" className="sc-verdict-add" onClick={() => addIt(r)} disabled={buy.isPending}>
                {buy.isPending && buy.variables?.entryId === r.entryId ? <Loader size={22} color="currentColor" /> : <IconPlus size={24} stroke={3} aria-hidden="true" />}
                <span>Add it</span>
              </button>
            )}
          </div>
          <Group justify="space-between" align="flex-start" wrap="nowrap" mt="sm">
            <Group gap="sm" align="flex-start" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
            {r.coverId && <GameCover platformKey={r.platformKey} title={r.title} id={r.coverId} width={48} />}
            <Stack gap={2} style={{ minWidth: 0 }}>
              <GameTitle platformKey={r.platformKey} title={r.title} fw={600} size="md" withNote={false} />
              <GameStars stars={r.stars ?? []} />
              <Group gap={6}>
                <Text size="sm" c="dimmed">
                  {r.platform}
                </Text>
                {r.ownedReleases?.map((x) => <RegionBadge key={`${x.region}|${x.consoleLabel}`} region={x.region} consoleLabel={x.consoleLabel} />)}
              </Group>
              {r.note && (
                <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                  <Text span size="sm" fw={600}>
                    Your note:
                  </Text>{' '}
                  {r.note}
                </Text>
              )}
              {r.onTheWay && (
                <Text size="sm">
                  <Text span size="sm" fw={600}>
                    On the way:
                  </Text>{' '}
                  bought from {r.onTheWay.store}
                  {r.onTheWay.orderDate ? ` on ${date(r.onTheWay.orderDate, dateFormat)}` : ''}
                  {r.onTheWay.paidCents !== null ? ` for ${money(r.onTheWay.paidCents, currency)}` : ''}.{canEdit && addable(r) ? ' Add it uses that.' : ''}
                </Text>
              )}
              {narrow && hasActions(r) && (
                <Group gap="xs" my={4}>
                  {actions(r)}
                </Group>
              )}
              {r.entryId !== undefined && queuedIds.has(r.entryId) ? (
                <Text size="xs">Bought without a connection: it's added to your collection as soon as Squirrelcade answers.</Text>
              ) : r.pending || (r.entryId !== undefined && purchaseOf.has(r.entryId)) ? (
                // Bought here (Add it, now a copy of its own): undo, what was paid, and its window again, right where it was tapped.
                <Text size="xs" component="div">
                  Bought here, not on PriceCharting yet.{' '}
                  {canEdit && r.entryId !== undefined && purchaseOf.has(r.entryId) && (
                    <>
                      <Anchor size="xs" onClick={() => unbuy.mutate(purchaseOf.get(r.entryId!)!.id)}>
                        undo
                      </Anchor>
                      {' · '}
                      <PaidInStore purchase={purchaseOf.get(r.entryId!)!} currency={currency} />
                      {' · '}
                      <Anchor size="xs" onClick={() => void openCopy(r, { id: purchaseOf.get(r.entryId!)!.id, key: purchaseOf.get(r.entryId!)!.key })}>
                        photos and notes
                      </Anchor>
                    </>
                  )}
                </Text>
              ) : (
                r.ownedAs.length > 0 && r.ownedAs[0] !== r.title && <Text size="xs">Owned as {r.ownedAs.join(', ')}</Text>
              )}
              {r.ownedValueCents != null && r.ownedValueCents > 0 && reason.said !== 'worth' && (
                <Text size="xs">
                  Worth {money(r.ownedValueCents, currency)}
                  {valueDate ? ` (PriceCharting, ${date(valueDate, dateFormat)})` : ''}
                </Text>
              )}
              {r.ownedOn.length > 0 && reason.said !== 'ownedOn' && <Text size="xs">You have it on {r.ownedOn.join(', ')}</Text>}
              {(r.ownedOnPc?.length ?? 0) > 0 && <Text size="xs">You have it on PC ({r.ownedOnPc!.join(', ')})</Text>}
              {(r.sets?.length ?? 0) > 0 && <Text size="xs">In your {r.sets!.length === 1 ? 'set' : 'sets'} {r.sets!.join(', ')}</Text>}
              {r.romm && (
                <span>
                  <RommChip link={r.romm} />
                </span>
              )}
              {r.maybe.length > 0 && reason.said !== 'maybe' && <Text size="xs">Might be {r.maybe.join(' or ')} in your collection</Text>}
              {r.answer === 'need' && r.wishlist && reason.said !== 'wishlist' && (
                <Text size="xs">
                  {r.wishlist.rank ? `#${r.wishlist.rank} on your wishlist · ` : ''}
                  {r.wishlist.priority} priority, <Acorns n={r.wishlist.score} size={11} />
                </Text>
              )}
              {/* What it sells for: PriceCharting (by the barcode, for a scanned game: that edition's page) and your shop links. */}
              {r.answer !== 'own' && r.answer !== 'own-not-in-catalog' && (
                <Group gap="xs" mt={4}>
                  <Button component="a" href={priceHref(r)} target="_blank" rel="noreferrer" size="compact-sm" variant="light" leftSection={<IconCurrencyDollar size={14} />}>
                    Price on PriceCharting
                  </Button>
                  {shopLinksFor(shops ?? [], r.platformKey)
                    .slice(0, SHOPS_IN_LISTS)
                    .map((x) => (
                    <Anchor key={x.name} href={shopUrl(x.template, r.title, r.platform)} target="_blank" rel="noreferrer" size="xs">
                      {x.name}
                    </Anchor>
                  ))}
                </Group>
              )}
              {/* Your preference for a catalog game you don't have (not from the phone's copy: it needs Squirrelcade to answer). */}
              {r.entryId !== undefined && r.answer !== 'own' && !offlineAt && (
                <Group mt={4}>
                  <PreferencePicker platformKey={r.platformKey} title={r.title} value={r.preference ?? null} width={170} />
                </Group>
              )}
            </Stack>
            </Group>
            {!narrow && hasActions(r) && (
              <Stack gap={6} align="flex-end">
                {actions(r)}
              </Stack>
            )}
          </Group>
        </Card>
        );
      })}
      {/* After an answer, the camera again without scrolling back up (the way Store Mode is used in a shop). */}
      {(b !== undefined || narrow) && (results?.length ?? 0) > 0 && !loading && (
        <Button variant="light" size="md" leftSection={<IconVideoFilled size={18} />} onClick={() => setScanning(true)}>
          Scan another
        </Button>
      )}
      {(purchases.data?.length ?? 0) > 0 && (
        <Card withBorder padding="sm" mt="md">
          <Text fw={600} size="sm" mb={4}>
            Added here, not on PriceCharting yet ({purchases.data!.length})
          </Text>
          <Text size="xs" c="dimmed" mb={6}>
            They're in your collection. Stash updates › Send to PriceCharting has them as lines for PriceCharting's importer.
          </Text>
          {/* Games added one after another in a store get their details in one sitting later: Improve walks them (D153). */}
          <Group gap="xs" mb={6}>
            {canEdit && (toFill.data?.total ?? 0) > 0 && (
              <Button component={Link} to="/collection/improve?added=here" size="compact-sm" variant="light">
                Fill in their details ({count(toFill.data!.total)})
              </Button>
            )}
            {/* The haul: their prices from your order emails at once, confirmed in Recently added. */}
            {canEdit && ordersOn && (
              <Button component={Link} to="/collection/recent?days=7" size="compact-sm" variant="default">
                Find their prices in my email
              </Button>
            )}
          </Group>
          <Stack gap={2}>
            {purchases.data!.map((p) => (
              <Text key={p.id} size="sm" component="div">
                {p.title}{' '}
                <Text span size="xs" c="dimmed">
                  {p.platform} · {p.condition}
                </Text>{' '}
                {canEdit && (
                  <>
                    <Anchor size="xs" onClick={() => unbuy.mutate(p.id)}>
                      undo
                    </Anchor>
                    {' · '}
                    <PaidInStore purchase={p} currency={currency} />
                  </>
                )}
              </Text>
            ))}
          </Stack>
        </Card>
      )}
      {queued.length > 0 && (
        <Card withBorder padding="sm" mt="md">
          <Text fw={600} size="sm" mb={4}>
            Bought without a connection ({queued.length})
          </Text>
          <Text size="xs" c="dimmed">
            Kept in this browser until Squirrelcade can be reached: {queued.map((x) => `${x.title} (${x.platform})`).join(', ')}.
          </Text>
        </Card>
      )}
      {saved && (
        <Text size="xs" c="dimmed" ta="center" mt="md">
          Ready without a connection: this browser's copy of {count(saved.copy.games.length)} answers was updated {timeAgo(saved.savedAt)}.
        </Text>
      )}
      <CopyDetailsModal
        copy={editing}
        added
        onClose={() => setEditing(null)}
        onScanNext={() => {
          setEditing(null);
          setScanning(true);
        }}
      />
      <ScannerModal
        opened={scanning}
        onClose={() => setScanning(false)}
        onCode={(code) => {
          setScanning(false);
          setText(code);
        }}
      />
    </Stack>
  );
}
