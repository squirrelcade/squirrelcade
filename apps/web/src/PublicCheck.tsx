import { Alert, Anchor, Badge, Button, Card, FileButton, Group, Loader, Progress, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconCamera, IconCurrencyDollar, IconPhoto, IconVideoFilled } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { StashMark } from './Acorn';
import { api, errorMessage } from './api';
import { Cover, RetryCountdown } from './components';
import { money } from './format';
import { isBarcode } from './lines';
import { ScannerModal } from './ScannerModal';
import { doubtText, photoReader, progressText, progressValue, type ReaderProgress, type ShelfUnsure } from './shelfCheck';

/** What the check answers someone who isn't signed in (GET /api/v1/check). */
interface CheckAnswer {
  platformKey: string;
  platform: string;
  title: string;
  answer: 'own' | 'elsewhere' | 'need' | 'maybe' | 'not-collected';
  ownedOn: string[];
  coverId: string | null;
  valueCents: number | null;
  wishlist: { priority: string; rank: number | null } | null;
  links: { name: string; url: string }[];
}

interface CheckResult {
  currency: string;
  productName: string | null;
  searchedFor: string | null;
  message: string | null;
  /** Waiting its turn with the barcode service: ask again in this many seconds. */
  retryInSeconds?: number | null;
  results: CheckAnswer[];
  /** For a barcode: PriceCharting's page for it (it knows most games' barcodes). */
  lookupUrl?: string;
}

const ANSWERS: Record<CheckAnswer['answer'], { label: string; color: string }> = {
  own: { label: 'They have it', color: 'teal' },
  elsewhere: { label: 'They have it on another console', color: 'blue' },
  need: { label: 'They need it', color: 'orange' },
  maybe: { label: 'Maybe: something like it is in the collection', color: 'yellow' },
  'not-collected': { label: 'Not something they collect', color: 'gray' },
};

/** Whether this looks like a phone or a tablet, where the sign-in page can lead with the camera. */
export function isPhone(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  } catch {
    return false;
  }
}

function CheckCard({ r, currency }: { r: CheckAnswer; currency: string }) {
  const answer = ANSWERS[r.answer];
  return (
    <Card withBorder padding="sm">
      <Group gap="sm" align="flex-start" wrap="nowrap">
        {r.coverId && <Cover id={r.coverId} width={56} />}
        <Stack gap={4} style={{ minWidth: 0 }}>
          <Text fw={600}>{r.title}</Text>
          <Text size="sm" c="dimmed">
            {r.platform}
          </Text>
          <Badge size="lg" color={answer.color} variant="filled" style={{ textTransform: 'none' }} maw="100%" leftSection={r.answer === 'own' ? <StashMark size={14} /> : undefined}>
            {answer.label}
          </Badge>
          {r.answer === 'elsewhere' && r.ownedOn.length > 0 && <Text size="sm">They have it on {r.ownedOn.join(', ')}.</Text>}
          {/* PriceCharting's value, credited with a link to it (as its terms ask of anyone showing its prices). */}
          {r.valueCents !== null && r.valueCents > 0 && (
            <Text size="sm">
              Their copy is worth {money(r.valueCents, currency)} (
              <Anchor href="https://www.pricecharting.com" target="_blank" rel="noreferrer" size="sm">
                PriceCharting
              </Anchor>
              ).
            </Text>
          )}
          {r.wishlist && (
            <Text size="sm">
              On their wishlist: {r.wishlist.priority.toLowerCase()} priority{r.wishlist.rank ? ` (#${r.wishlist.rank})` : ''}.
            </Text>
          )}
          {r.links.length > 0 && (
            <Group gap="xs" mt={4}>
              {/* The first link (PriceCharting) as a button: what it should cost, one tap from the answer. */}
              <Button component="a" href={r.links[0]!.url} target="_blank" rel="noreferrer" size="compact-md" variant="light" leftSection={<IconCurrencyDollar size={16} />}>
                Price on {r.links[0]!.name}
              </Button>
              {r.links.slice(1).map((l) => (
                <Anchor key={l.name} href={l.url} target="_blank" rel="noreferrer" size="sm">
                  {l.name}
                </Anchor>
              ))}
            </Group>
          )}
        </Stack>
      </Group>
    </Card>
  );
}

/** What a shelf check answers someone who isn't signed in (POST /api/v1/check/shelf). */
interface ShelfAnswer {
  platform: string | null;
  games: { title: string; answer: CheckAnswer['answer']; ownedOn: string[]; wishlist: { priority: string; rank: number | null } | null; read: string }[];
  unsure: ShelfUnsure[];
  reads: number;
  model: { id: string | null; state: 'waiting' | 'reading' | 'done' | 'failed'; titles: number; sent: number; error: string | null } | null;
}

/**
 * Checking a shelf without signing in (Settings > Security > "Check a shelf without signing in"): the visitor's phone
 * reads the photo (the same reader as Store Mode's, D147) and sends the text it read; Squirrelcade answers for the
 * games read. With the owner's vision model allowed, pieces of the photo go along too.
 */
function PublicShelf() {
  const consoles = useQuery({
    queryKey: ['check', 'consoles'],
    queryFn: () => api<{ consoles: { key: string; name: string }[]; model: boolean; pieces: number }>('/check/consoles'),
    retry: false,
  });
  const [platformKey, setPlatformKey] = useState<string | null>(null);
  const [progress, setProgress] = useState<ReaderProgress | null>(null);
  const [busy, setBusy] = useState<'reading' | 'asking' | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [answer, setAnswer] = useState<ShelfAnswer | null>(null);
  const run = useRef(0);
  if (!consoles.data) return null;
  const check = async (file: File | null) => {
    if (!file || !platformKey) return;
    const mine = ++run.current;
    setFailure(null);
    setAnswer(null);
    setProgress(null);
    setBusy('reading');
    try {
      const reader = await photoReader();
      const canvas = await reader.decodePhoto(file);
      const read = await reader.readCanvas(canvas, { turns: ['ccw'], onProgress: (p) => mine === run.current && setProgress(p) });
      if (mine !== run.current) return;
      setBusy('asking');
      const pieces = consoles.data.model ? reader.photoPieces(canvas, consoles.data.pieces) : [];
      let found = await api<ShelfAnswer>('/check/shelf', { method: 'POST', json: { platformKey, reads: read.lines.map((l) => ({ text: l.text, score: l.score })), pieces } });
      if (mine !== run.current) return;
      setAnswer(found);
      setBusy(null);
      // The owner's AI reader, when it helps: the answer again, every two seconds, until it has read the photo too.
      const job = found.model?.id;
      const until = Date.now() + 11 * 60_000;
      while (job && found.model && (found.model.state === 'waiting' || found.model.state === 'reading') && Date.now() < until && mine === run.current) {
        await new Promise((r) => setTimeout(r, 2000));
        found = await api<ShelfAnswer>(`/check/shelf/${job}`);
        if (mine === run.current) setAnswer(found);
      }
    } catch (err) {
      if (mine === run.current) setFailure(errorMessage(err));
    } finally {
      if (mine === run.current) setBusy(null);
    }
  };
  return (
    <Stack gap="xs" mt="sm">
      <Title order={4}>Or check a whole shelf</Title>
      <Text size="sm" c="dimmed">
        A photo of a shelf of one console's games: your phone reads the spines{consoles.data.model ? ' (with help from their AI reader)' : ''} and this says which ones they have or need. Spines read only partly are listed as unsure.
      </Text>
      <Select
        placeholder="The shelf's console"
        aria-label="The shelf's console"
        data={consoles.data.consoles.map((c) => ({ value: c.key, label: c.name }))}
        value={platformKey}
        onChange={setPlatformKey}
        searchable
      />
      <Group gap="xs" grow>
        <FileButton onChange={(f) => void check(f)} accept="image/*" capture="environment">
          {(props) => (
            <Button {...props} leftSection={<IconCamera size={18} />} disabled={!platformKey || busy !== null}>
              Take a photo
            </Button>
          )}
        </FileButton>
        <FileButton onChange={(f) => void check(f)} accept="image/*">
          {(props) => (
            <Button {...props} variant="default" leftSection={<IconPhoto size={18} />} disabled={!platformKey || busy !== null}>
              Choose a photo
            </Button>
          )}
        </FileButton>
      </Group>
      {busy && (
        <Stack gap={4}>
          <Progress value={busy === 'asking' ? 100 : progressValue(progress)} animated striped />
          <Text size="sm" c="dimmed">
            {busy === 'asking' ? 'Checking the games read…' : progressText(progress)}
          </Text>
        </Stack>
      )}
      {failure && <Alert color="red">{failure}</Alert>}
      {answer && (
        <Stack gap={6}>
          <Text size="sm">
            {answer.games.length === 0 ? 'No game on the photo was read well enough to name it.' : `${answer.games.length} ${answer.games.length === 1 ? 'game' : 'games'} read`}
            {answer.unsure.length > 0 ? `, ${answer.unsure.length} unsure` : ''}.
          </Text>
          {answer.model && (answer.model.state === 'waiting' || answer.model.state === 'reading') && (
            <Text size="xs" c="dimmed">
              Their AI reader is looking at the photo too (up to a minute)…
            </Text>
          )}
          {answer.model?.state === 'failed' && (
            <Text size="xs" c="dimmed">
              Their AI reader didn't help this time: {answer.model.error}
            </Text>
          )}
          {answer.games.map((g) => (
            <Group key={g.title} gap="xs" wrap="nowrap" justify="space-between">
              <Text size="sm" fw={600} style={{ minWidth: 0 }}>
                {g.title}
              </Text>
              <Badge color={ANSWERS[g.answer].color} variant="filled" style={{ textTransform: 'none', flexShrink: 0 }} leftSection={g.answer === 'own' ? <StashMark size={12} /> : undefined}>
                {g.answer === 'need' && g.wishlist ? `They need it (${g.wishlist.priority.toLowerCase()})` : ANSWERS[g.answer].label}
              </Badge>
            </Group>
          ))}
          {answer.unsure.length > 0 && (
            <Text size="xs" c="dimmed">
              Unsure: {answer.unsure.map((u) => `${u.title} (${doubtText(u)})`).join('; ')}. Scan these games' barcodes above to be sure.
            </Text>
          )}
        </Stack>
      )}
    </Stack>
  );
}

/**
 * Checking a game without signing in (Settings > Security): on the sign-in page, for someone shopping for the
 * collection's owner. Scan a barcode or type a title, and it says whether they have the game or need it, with its
 * cover, their wishlist's priority and links to its prices (and what their copy is worth, if the owner shows that).
 */
export function PublicCheck() {
  const [text, setText] = useState('');
  const [query, setQuery] = useState<Record<string, string> | null>(null);
  const [scanning, setScanning] = useState(false);
  const answer = useQuery({
    queryKey: ['check', query],
    queryFn: () => api<CheckResult>(`/check?${new URLSearchParams(query ?? {})}`),
    enabled: query !== null,
    retry: false,
    // A barcode waiting its turn with the barcode service: asked again when the server says.
    refetchInterval: (q) => (q.state.data?.retryInSeconds ? q.state.data.retryInSeconds * 1000 : false),
  });
  const check = (value: string) => {
    const t = value.trim();
    if (!t) return;
    setQuery(isBarcode(t) ? { barcode: t.replace(/\D/g, '') } : { q: t });
  };
  const data = answer.data;

  return (
    <Card withBorder padding="lg" w="100%" maw={520}>
      <Stack gap="sm">
        <Title order={3}>Shopping for them?</Title>
        <Text size="sm" c="dimmed">
          Scan a game's barcode (or type its title) to see whether it's already in the collection. No account needed.
        </Text>
        <Button size="lg" leftSection={<IconVideoFilled size={22} />} onClick={() => setScanning(true)}>
          Scan a game
        </Button>
        <Group gap="xs" wrap="nowrap">
          <TextInput
            flex={1}
            placeholder="Or type its title"
            aria-label="Title or barcode to check"
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && check(text)}
            inputMode="search"
          />
          <Button variant="default" onClick={() => check(text)} disabled={text.trim().length < 2}>
            Check
          </Button>
        </Group>
        {answer.isFetching && <Loader size="sm" />}
        {answer.error && <Alert color="red">{errorMessage(answer.error)}</Alert>}
        {data?.productName && (
          <Text size="xs" c="dimmed">
            The barcode service calls it “{data.productName}”.
          </Text>
        )}
        {data?.message && (
          <Alert color="gray">
            <Stack gap="xs">
              <Text size="sm">{data.message}</Text>
              {data.retryInSeconds ? <RetryCountdown seconds={data.retryInSeconds} since={answer.dataUpdatedAt} /> : null}
            </Stack>
          </Alert>
        )}
        {data && data.results.length === 0 && !data.message && !answer.isFetching && (
          <Alert color="gray" title="Nothing found">
            No game in the collection or its consoles' lists matches “{data.searchedFor}”.
          </Alert>
        )}
        {data?.results.map((r) => <CheckCard key={`${r.platformKey}|${r.title}`} r={r} currency={data.currency} />)}
        <PublicShelf />
      </Stack>
      <ScannerModal
        opened={scanning}
        onClose={() => setScanning(false)}
        onCode={(code) => {
          setScanning(false);
          setText(code);
          check(code);
        }}
      />
    </Card>
  );
}
