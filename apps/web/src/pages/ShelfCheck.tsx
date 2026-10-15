import { Alert, Anchor, Badge, Button, Card, Checkbox, FileButton, Group, Progress, Select, Stack, Text, Title } from '@mantine/core';
import { IconCamera, IconPhoto } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Acorns, Have } from '../Acorn';
import { api, errorMessage } from '../api';
import { ANSWERS } from '../choices';
import { HelpLink } from '../components';
import { GameTitle } from '../GameDrawer';
import { notifyError, notifySuccess, useCanEdit } from '../hooks';
import { queuePurchase, readCopy, refreshCopy, unreachable, type OfflineCopy } from '../offline';
import { PutInPlace } from '../PutInPlace';
import {
  allReads,
  checklist,
  doubtText,
  photoReader,
  progressText,
  progressValue,
  shelfConsoles,
  shelfMatcher,
  type ReadLine,
  type ReaderProgress,
  type ShelfChecklist,
  type ShelfFound,
} from '../shelfCheck';

/** A photo's pieces being read by the vision model (POST /api/v1/shelf/read, then GET /api/v1/shelf/read/:id). */
interface ModelJob {
  id: string;
  state: 'waiting' | 'reading' | 'done' | 'failed';
  titles: string[];
  error: string | null;
  sent: number;
  left: number | null;
}

const LAST_CONSOLE = 'squirrelcade.shelfConsole';
const UPRIGHT_TOO = 'squirrelcade.shelfUpright';

function remembered(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage is off: nothing remembered.
  }
}

/** Store Mode's copy of its answers: the one kept in this browser, or fetched now when none is kept. */
async function loadCopy(): Promise<OfflineCopy> {
  const saved = (await refreshCopy()) ?? (await readCopy());
  if (saved) return saved.copy;
  return api<OfflineCopy>('/lookup/offline');
}

/** The colors of the boxes drawn on the photo, by group. */
const BOX = { need: '#2f9e44', own: '#1c7ed6', elsewhere: '#f59f00', other: '#868e96', unsure: '#e8590c' } as const;

/** The photo with a box around each spine read as a game, colored by its answer (unsure ones dashed). */
function PhotoBoxes({ url, width, height, lines, list }: { url: string; width: number; height: number; lines: ReadLine[]; list: ShelfChecklist }) {
  const color = new Map<string, { color: string; dashed: boolean }>();
  for (const group of ['need', 'own', 'elsewhere', 'other'] as const) for (const f of list[group]) color.set(f.read, { color: BOX[group], dashed: false });
  for (const u of list.unsure) if (!color.has(u.read)) color.set(u.read, { color: BOX.unsure, dashed: true });
  const stroke = Math.max(2, Math.round(Math.max(width, height) / 400));
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <img src={url} alt="Your shelf photo, with a box around each game read" style={{ width: '100%', display: 'block', borderRadius: 6 }} />
      <svg viewBox={`0 0 ${width} ${height}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} aria-hidden>
        {lines.map((l, i) => {
          const c = color.get(l.text);
          if (!c) return null;
          return <polygon key={i} points={l.box.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" stroke={c.color} strokeWidth={stroke} strokeDasharray={c.dashed ? `${stroke * 3} ${stroke * 2}` : undefined} />;
        })}
      </svg>
    </div>
  );
}

function FoundRow({ f, platformKey, canEdit, bought, onBuy }: { f: ShelfFound; platformKey: string; canEdit: boolean; bought: boolean; onBuy?: () => void }) {
  const g = f.game;
  return (
    <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
      <Stack gap={0} style={{ minWidth: 0 }}>
        <GameTitle platformKey={platformKey} title={f.title} fw={600} withNote={false} />
        <Text size="xs" c="dimmed">
          {f.answer === 'own-elsewhere' && g.on?.length ? `You have it on ${g.on.join(', ')}` : ANSWERS[f.answer].label}
          {g.w ? (
            <>
              {' · '}
              {g.w.rank ? `#${g.w.rank} on your wishlist, ` : ''}
              <Acorns n={g.w.score} size={10} />
            </>
          ) : null}
          {g.n ? ` · Your note: ${g.n}` : ''}
        </Text>
        <Text size="xs" c="dimmed" fs="italic">
          read “{f.read}”
        </Text>
      </Stack>
      {canEdit && onBuy && g.e !== undefined && (
        <Button size="compact-xs" variant={bought ? 'light' : 'default'} disabled={bought} onClick={onBuy}>
          {bought ? 'Bought' : 'I bought it'}
        </Button>
      )}
    </Group>
  );
}

/**
 * Check a shelf (Store Mode, D147): a photo of a shelf of one console's games in, a checklist out. The phone reads
 * the spines (nothing leaves it) and checks each against Store Mode's copy of your collection, so it works with no
 * signal; a game is never called missing on a doubtful read. With a vision model on (Settings > Features) and a
 * connection, pieces of the photo also go to it, and what it reads is matched the same way.
 */
export function ShelfCheckPage() {
  const canEdit = useCanEdit();
  const queryClient = useQueryClient();
  const copy = useQuery({ queryKey: ['shelf', 'copy'], queryFn: loadCopy, staleTime: 60_000, networkMode: 'always' });
  const model = useQuery({ queryKey: ['shelf', 'model'], queryFn: () => api<{ available: boolean; left: number | null; pieces: number; helper: boolean | null }>('/shelf/model'), retry: false });
  const consoles = useMemo(() => (copy.data ? shelfConsoles(copy.data) : []), [copy.data]);
  const [consoleKey, setConsoleKey] = useState<string | null>(remembered(LAST_CONSOLE));
  const chosen = consoles.find((c) => c.key === consoleKey) ?? null;
  const [upright, setUpright] = useState(remembered(UPRIGHT_TOO) === '1');
  const [progress, setProgress] = useState<ReaderProgress | null>(null);
  const [busy, setBusy] = useState<'reading' | 'model' | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [photo, setPhoto] = useState<{ url: string; width: number; height: number; lines: ReadLine[] } | null>(null);
  const [modelTitles, setModelTitles] = useState<string[]>([]);
  const [modelNote, setModelNote] = useState<string | null>(null);
  const [bought, setBought] = useState<Set<string>>(new Set());
  const run = useRef(0);

  useEffect(() => () => {
    if (photo) URL.revokeObjectURL(photo.url);
  }, [photo]);

  const matched = useMemo(() => (copy.data && chosen ? shelfMatcher(copy.data, chosen.index) : null), [copy.data, chosen]);
  const list = useMemo(() => (matched && photo ? checklist(matched.matcher.match(allReads(photo.lines, modelTitles)), matched.games) : null), [matched, photo, modelTitles]);

  const check = async (file: File | null) => {
    if (!file || !chosen) return;
    const mine = ++run.current;
    setFailure(null);
    setModelTitles([]);
    setModelNote(null);
    setProgress(null);
    setBusy('reading');
    try {
      const reader = await photoReader();
      const canvas = await reader.decodePhoto(file);
      const read = await reader.readCanvas(canvas, { turns: upright ? ['ccw', '0'] : ['ccw'], onProgress: (p) => mine === run.current && setProgress(p) });
      if (mine !== run.current) return;
      setPhoto({ url: URL.createObjectURL(file), width: read.width, height: read.height, lines: read.lines });
      // The vision model, when it's on and Squirrelcade answers: pieces of the photo, read there, matched here.
      // (A helper that isn't asking for work just now would leave the photo waiting: then the phone's reading is all.)
      if (model.data?.available && model.data.left !== 0 && model.data.helper !== false) {
        setBusy('model');
        try {
          // A job: started at once, then asked about every two seconds until it's read (a helper may take a minute).
          const started = await api<ModelJob>('/shelf/read', { method: 'POST', json: { pieces: reader.photoPieces(canvas, model.data.pieces), console: chosen.name } });
          let answer = started;
          const until = Date.now() + 11 * 60_000;
          while ((answer.state === 'waiting' || answer.state === 'reading') && Date.now() < until && mine === run.current) {
            await new Promise((r) => setTimeout(r, 2000));
            answer = await api<ModelJob>(`/shelf/read/${started.id}`);
          }
          if (mine !== run.current) return;
          if (answer.state !== 'done') throw new Error(answer.error ?? 'it took too long');
          setModelTitles(answer.titles);
          setModelNote(`Your vision model read ${answer.titles.length} ${answer.titles.length === 1 ? 'title' : 'titles'} in ${answer.sent} ${answer.sent === 1 ? 'piece' : 'pieces'} of the photo${answer.left !== null ? ` (${answer.left} pieces left today)` : ''}.`);
          void queryClient.invalidateQueries({ queryKey: ['shelf', 'model'] });
        } catch (err) {
          if (mine === run.current) setModelNote(unreachable(err) ? 'No connection to Squirrelcade, so only this phone read the photo.' : `The vision model didn't read it: ${errorMessage(err)}`);
        }
      }
    } catch (err) {
      if (mine === run.current) setFailure(errorMessage(err));
    } finally {
      if (mine === run.current) setBusy(null);
    }
  };

  const buy = useMutation({
    mutationFn: async (f: ShelfFound) => {
      try {
        await api('/purchases', { method: 'POST', json: { entryId: f.game.e } });
        return 'sent' as const;
      } catch (err) {
        if (!unreachable(err)) throw err;
        await queuePurchase({ entryId: f.game.e!, title: f.title, platform: chosen?.name ?? '' });
        return 'kept' as const;
      }
    },
    networkMode: 'always',
    onSuccess: async (how, f) => {
      setBought((s) => new Set(s).add(f.key));
      notifySuccess(how === 'sent' ? `${f.title} is in your collection.` : `${f.title} counts as bought as soon as Squirrelcade can be reached (Store Mode sends it).`, 'Bought');
      await Promise.all(['purchases', 'lookup', 'catalogs', 'wishlist'].map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
    },
    onError: (err) => notifyError(err),
  });

  const section = (title: string, items: ShelfFound[], tone: string, empty?: string) =>
    (items.length > 0 || empty) && (
      <Card withBorder padding="sm">
        <Group gap="xs" mb={6}>
          <Text fw={700}>{title === 'Have it' ? <Have size={16}>{title}</Have> : title}</Text>
          <Badge color={tone} variant="light">
            {items.length}
          </Badge>
        </Group>
        {items.length === 0 ? (
          <Text size="sm" c="dimmed">
            {empty}
          </Text>
        ) : (
          <Stack gap="xs">
            {items.map((f) => (
              <FoundRow key={f.key} f={f} platformKey={chosen!.key} canEdit={canEdit} bought={bought.has(f.key)} onBuy={title === 'Need it' ? () => buy.mutate(f) : undefined} />
            ))}
          </Stack>
        )}
      </Card>
    );

  return (
    <Stack maw={640} mx="auto" gap="sm">
      <Group justify="space-between" align="baseline">
        <Group gap={6} wrap="nowrap">
          <Title order={2}>Check a shelf</Title>
          <HelpLink topic="store-mode" />
        </Group>
        <Anchor component={Link} to="/store" size="sm">
          Store Mode
        </Anchor>
      </Group>
      <Text size="sm" c="dimmed">
        A photo of a shelf of one console's games: this phone reads the spines and checks each against your collection. The photo stays on the phone
        {model.data?.available ? ', except pieces of it for your vision model' : ''}. A spine read only partly is unsure, never “Need it”.
      </Text>
      {copy.error && <Alert color="red">Store Mode's answers couldn't be loaded: {errorMessage(copy.error)}</Alert>}
      <Select
        label="Console"
        placeholder={copy.isLoading ? 'Loading…' : 'Pick the shelf’s console'}
        data={consoles.map((c) => ({ value: c.key, label: c.name }))}
        value={chosen?.key ?? null}
        onChange={(v) => {
          setConsoleKey(v);
          if (v) remember(LAST_CONSOLE, v);
        }}
        searchable
        allowDeselect={false}
      />
      <Group gap="xs" grow>
        <FileButton onChange={(f) => void check(f)} accept="image/*" capture="environment">
          {(props) => (
            <Button {...props} size="md" leftSection={<IconCamera size={18} />} disabled={!chosen || busy !== null}>
              Take a photo
            </Button>
          )}
        </FileButton>
        <FileButton onChange={(f) => void check(f)} accept="image/*">
          {(props) => (
            <Button {...props} size="md" variant="default" leftSection={<IconPhoto size={18} />} disabled={!chosen || busy !== null}>
              Choose a photo
            </Button>
          )}
        </FileButton>
      </Group>
      <Checkbox
        size="sm"
        label="Also read text that isn't sideways (box fronts, a glass case): takes twice as long"
        checked={upright}
        onChange={(e) => {
          setUpright(e.currentTarget.checked);
          remember(UPRIGHT_TOO, e.currentTarget.checked ? '1' : '0');
        }}
      />
      {busy && (
        <Stack gap={4}>
          <Progress value={busy === 'model' ? 100 : progressValue(progress)} animated striped />
          <Text size="sm" c="dimmed">
            {busy === 'model' ? 'Your vision model is reading the photo too (up to a minute)…' : progressText(progress)}
          </Text>
        </Stack>
      )}
      {failure && <Alert color="red">{failure}</Alert>}
      {photo && list && (
        <>
          <Text size="sm">
            Read {photo.lines.length} lines of text{modelTitles.length > 0 ? ` and ${modelTitles.length} titles from your vision model` : ''}: {list.need.length + list.own.length + list.elsewhere.length + list.other.length} games for sure, {list.unsure.length} unsure.
          </Text>
          {modelNote && (
            <Text size="xs" c="dimmed">
              {modelNote}
            </Text>
          )}
          {section('Need it', list.need, 'green', 'None of the games read is one you need.')}
          {section('Have it', list.own, 'blue')}
          {section('Have it on another console, or maybe', list.elsewhere, 'yellow')}
          {section('Not on your list', list.other, 'gray')}
          {/* A photo of a bag's games: the ones you have get that bag as their place in one go (D157). */}
          {canEdit && list.own.length > 0 && <PutInPlace key={photo.url} platformKey={chosen!.key} titles={list.own.map((f) => f.title)} />}
          {list.unsure.length > 0 && (
            <Card withBorder padding="sm">
              <Group gap="xs" mb={6}>
                <Text fw={700}>Unsure</Text>
                <Badge color="orange" variant="light">
                  {list.unsure.length}
                </Badge>
              </Group>
              <Text size="xs" c="dimmed" mb={6}>
                Best guesses from partial reads: check these spines yourself, or scan their barcodes in Store Mode.
              </Text>
              <Stack gap={4}>
                {list.unsure.map((u) => (
                  <Text key={u.title} size="sm">
                    <GameTitle platformKey={chosen!.key} title={u.title} withNote={false} />{' '}
                    <Text span size="xs" c="dimmed">
                      ({doubtText(u)}; read “{u.read}”)
                    </Text>
                    {u.answer && (
                      <Text span size="xs" fw={600}>
                        {' '}
                        If it is: {ANSWERS[u.answer].label}
                      </Text>
                    )}
                  </Text>
                ))}
              </Stack>
            </Card>
          )}
          <PhotoBoxes url={photo.url} width={photo.width} height={photo.height} lines={photo.lines} list={list} />
          <Text size="xs" c="dimmed">
            Spines with no box weren't read well enough to name a game (stylized logos and very small print are the hardest). A closer photo of part of the shelf reads more.
          </Text>
        </>
      )}
    </Stack>
  );
}
