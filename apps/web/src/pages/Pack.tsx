import { Alert, Anchor, Autocomplete, Button, Card, Group, Loader, Stack, Text, TextInput, Title } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { COMPLETENESS_LABELS, type Completeness } from '@squirrelcade/core';
import { IconBarcode, IconCheck, IconSearch, IconVideoFilled } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, errorMessage } from '../api';
import { HelpLink } from '../components';
import { count } from '../format';
import { notifyError, usePageTitle, useSetting } from '../hooks';
import { isBarcode } from '../lines';
import { PLACE_EXAMPLE, PlaceNote, placeOfLabel, placesChanged, type Place, type PlaceCopy, type PlaceGame, type Placed } from '../places';
import { ScannerModal } from '../ScannerModal';

/** The place being packed, kept in this browser (a bag is often packed over more than one visit). */
const PLACE = 'squirrelcade.packPlace';

function rememberedPlace(): string {
  try {
    return localStorage.getItem(PLACE) ?? '';
  } catch {
    return '';
  }
}

/** A barcode's answer (GET /api/v1/places/find?code=): its game when Squirrelcade knows it, with its copies. */
interface CodeAnswer {
  code: string;
  known: { platformKey: string; platform: string; title: string } | null;
  games: PlaceGame[];
}

/** What became of the last thing read or chosen, said on the page and under the camera: done, a question, or a problem. */
interface Said {
  tone: 'done' | 'ask' | 'problem';
  text: string;
}

const condition = (c: PlaceCopy) => COMPLETENESS_LABELS[c.completeness as Completeness] ?? c.completeness;
const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase();

/** Your games a typed title finds, each with the button that takes it. */
function GameSearch({ label, action, onPick, busy }: { label: string; action: string; onPick: (g: PlaceGame) => void; busy: boolean }) {
  const [q, setQ] = useState('');
  const [debounced] = useDebouncedValue(q, 250);
  const found = useQuery({
    queryKey: ['places', 'find', debounced],
    queryFn: () => api<{ games: PlaceGame[] }>(`/places/find?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.trim().length >= 2,
  });
  return (
    <Stack gap="xs">
      <TextInput label={label} placeholder="zelda, mario kart..." leftSection={<IconSearch size={16} />} value={q} onChange={(e) => setQ(e.currentTarget.value)} />
      {found.isFetching && <Loader size="xs" />}
      {debounced.trim().length >= 2 && !found.isFetching && found.data?.games.length === 0 && (
        <Text size="sm" c="dimmed">
          None of your games matches “{debounced.trim()}”.
        </Text>
      )}
      {(found.data?.games ?? []).map((g) => (
        <Group key={`${g.platformKey}|${g.title}`} justify="space-between" wrap="nowrap" gap="xs">
          <Stack gap={0} style={{ minWidth: 0 }}>
            <Text size="sm">{g.title}</Text>
            <Text size="xs" c="dimmed">
              {g.platform}
              {g.copies.length > 1 ? ` · ${g.copies.length} copies` : g.copies[0]?.place ? ` · in ${g.copies[0].place}` : ''}
            </Text>
          </Stack>
          <Button size="compact-sm" onClick={() => onPick(g)} disabled={busy} aria-label={`${action}: ${g.title} (${g.platform})`}>
            {action}
          </Button>
        </Group>
      ))}
    </Stack>
  );
}

/**
 * Pack a place (D157, under Store Mode beside Scan my shelf): choose a place, or scan its label, then scan each game's
 * barcode or type its title, one after another; each game you own gets that place. A game with several copies asks
 * which (the ones without a place first); a copy that was somewhere else moves, and the list says so, with Undo. A
 * barcode Squirrelcade doesn't know yet is matched by title and remembered, as Scan my shelf does. Barcodes are only
 * looked up in what Squirrelcade has saved, never a barcode service.
 */
export function PackPage() {
  const queryClient = useQueryClient();
  const appName = useSetting('general.instanceName', 'Squirrelcade') || 'Squirrelcade';
  usePageTitle('Pack a place', appName);
  const [params] = useSearchParams();
  const [place, setPlaceText] = useState(() => params.get('place')?.trim() || rememberedPlace());
  const where = place.trim().replace(/\s+/g, ' ');
  const setPlace = (value: string) => {
    setPlaceText(value);
    try {
      localStorage.setItem(PLACE, value.trim());
    } catch {
      // No storage: chosen for this visit only.
    }
  };
  // A place a label opened (?place=) is the one to come back to.
  useEffect(() => {
    const labeled = params.get('place')?.trim();
    if (labeled) setPlace(labeled);
  }, [params]);
  const places = useQuery({ queryKey: ['places'], queryFn: () => api<{ places: Place[]; unplaced: number }>('/places') });
  const here = places.data?.places.find((p) => same(p.name, where)) ?? null;

  const [scanning, setScanning] = useState(false);
  const [said, setSaid] = useState<Said | null>(null);
  const [typedCode, setTypedCode] = useState('');
  // A game with several copies, waiting for the one in hand; a barcode to match by title.
  const [choosing, setChoosing] = useState<{ game: PlaceGame; fromCamera: boolean } | null>(null);
  const [unknown, setUnknown] = useState<(CodeAnswer & { fromCamera: boolean }) | null>(null);
  const [packed, setPacked] = useState<Placed[]>([]);
  const busy = useRef(false);

  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const saveNote = useMutation({
    mutationFn: () => api('/places/note', { method: 'PUT', json: { place: where, note } }),
    onSuccess: async () => {
      setNoteOpen(false);
      await placesChanged(queryClient);
    },
    onError: (err) => notifyError(err),
  });

  const say = (s: Said) => setSaid(s);

  /** Puts these copies in the place; from the camera, it opens again for the next game. */
  const put = async (copies: PlaceCopy[], fromCamera: boolean) => {
    if (!where) {
      say({ tone: 'problem', text: 'Choose the place first, or scan its label.' });
      setScanning(false);
      return;
    }
    const moving = copies.filter((c) => !same(c.place, where));
    if (moving.length === 0) {
      say({ tone: 'done', text: `${copies[0]!.title} is already in ${where}.` });
      if (fromCamera) setScanning(true);
      return;
    }
    const answer = await api<{ place: string; placed: Placed[] }>('/places/put', { method: 'POST', json: { place: where, keys: moving.map((c) => c.copyKey) } });
    setPacked((list) => [...answer.placed, ...list.filter((p) => !answer.placed.some((a) => a.copyKey === p.copyKey))]);
    const first = answer.placed[0]!;
    const moved = answer.placed.filter((p) => p.before).map((p) => p.before);
    say({
      tone: 'done',
      text: `${first.title}${answer.placed.length > 1 ? ` (${answer.placed.length} copies)` : ''} is in ${answer.place}${moved.length > 0 ? `, moved from ${[...new Set(moved)].join(' and ')}` : ''}.`,
    });
    setChoosing(null);
    setUnknown(null);
    await placesChanged(queryClient);
    if (fromCamera) setScanning(true);
  };

  /** A game found: its one copy goes in at once; with several, which one is asked. */
  const take = async (game: PlaceGame, fromCamera: boolean) => {
    if (game.copies.length === 1) return put(game.copies, fromCamera);
    setScanning(false);
    setUnknown(null);
    setChoosing({ game, fromCamera });
    say({ tone: 'ask', text: `You have ${game.copies.length} copies of ${game.title}: which one is going in?` });
  };

  const guarded = async (work: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    try {
      await work();
    } catch (err) {
      say({ tone: 'problem', text: errorMessage(err) });
    } finally {
      busy.current = false;
    }
  };

  /** A barcode (scanned or typed), or a place's label. */
  const read = (code: string, fromCamera: boolean) =>
    guarded(async () => {
      const label = placeOfLabel(code);
      if (label) {
        setPlace(label);
        setChoosing(null);
        say({ tone: 'done', text: `Now packing ${label}.` });
        return;
      }
      if (!isBarcode(code)) {
        say({ tone: 'problem', text: 'A barcode has 8 to 14 digits.' });
        return;
      }
      const answer = await api<CodeAnswer>(`/places/find?code=${encodeURIComponent(code)}`);
      const game = answer.games[0];
      if (game) return take(game, fromCamera);
      // Not known yet (or known as a game you have no copy of): matched by title, and remembered.
      setScanning(false);
      setChoosing(null);
      setUnknown({ ...answer, fromCamera });
      say({ tone: 'ask', text: answer.known ? `${answer.code} is ${answer.known.title} (${answer.known.platform}) to Squirrelcade, a game you have no copy of.` : `Squirrelcade doesn't know ${answer.code} yet.` });
    });

  /** A barcode matched by title: remembered for that game (as Scan my shelf does), then the game goes in. */
  const link = (game: PlaceGame) =>
    guarded(async () => {
      if (!unknown) return;
      await api('/barcodes', { method: 'POST', json: { code: unknown.code, platformKey: game.platformKey, title: game.title } });
      void queryClient.invalidateQueries({ queryKey: ['barcodes'] });
      await take(game, unknown.fromCamera);
    });

  const undo = useMutation({
    mutationFn: (p: Placed) => api('/places/put', { method: 'POST', json: { place: p.before, keys: [p.copyKey] } }),
    onSuccess: async (_d, p) => {
      setPacked((list) => list.filter((x) => x.copyKey !== p.copyKey));
      say({ tone: 'done', text: p.before ? `${p.title} is back in ${p.before}.` : `${p.title} has no place again.` });
      await placesChanged(queryClient);
    },
    onError: (err) => notifyError(err),
  });

  const saidLine = said && (
    <Text size="sm" c={said.tone === 'problem' ? 'orange' : undefined} fw={said.tone === 'ask' ? 600 : undefined} role="status">
      {said.tone === 'done' && <IconCheck size={14} style={{ verticalAlign: -2, marginRight: 4 }} />}
      {said.text}
    </Text>
  );
  const names = (places.data?.places ?? []).map((p) => p.name);

  return (
    <Stack maw={640} mx="auto" gap="sm">
      <Group justify="space-between" align="baseline">
        <Group gap={6} wrap="nowrap">
          <Title order={2}>Pack a place</Title>
          <HelpLink topic="your-copies" />
        </Group>
        <Group gap="md">
          <Anchor component={Link} to="/collection/places" size="sm">
            Places
          </Anchor>
          <Anchor component={Link} to="/store" size="sm">
            Store Mode
          </Anchor>
        </Group>
      </Group>
      <Text size="sm" c="dimmed">
        Put your games in a bag, a case or on a shelf, and Squirrelcade notes where they are: choose the place (or scan its label), then scan each game&apos;s barcode or type its title, one after another.
      </Text>
      <Autocomplete
        label="The place"
        description={`Storage location: ${PLACE_EXAMPLE}`}
        placeholder="Type a place, or choose one"
        data={names}
        value={place}
        onChange={setPlace}
        maxLength={80}
        limit={30}
      />
      {where && (
        <Text size="sm" c="dimmed">
          {here ? `${count(here.copies.length)} ${here.copies.length === 1 ? 'game' : 'games'} in ${here.name}` : `${where} is a new place`}
          <PlaceNote note={here?.note ?? null} size="sm" />
          {' · '}
          <Anchor
            component="button"
            type="button"
            size="sm"
            onClick={() => {
              setNote(here?.note ?? '');
              setNoteOpen((o) => !o);
            }}
          >
            {here?.note ? 'change where it is' : 'say where it is'}
          </Anchor>
        </Text>
      )}
      {where && noteOpen && (
        <Group gap="xs" wrap="nowrap" align="flex-end">
          <TextInput flex={1} label={`Where ${where} is`} placeholder="Under the master bed, the hall closet..." value={note} onChange={(e) => setNote(e.currentTarget.value)} maxLength={120} />
          <Button variant="default" onClick={() => saveNote.mutate()} loading={saveNote.isPending}>
            Save
          </Button>
        </Group>
      )}
      <Button size="lg" fullWidth leftSection={<IconVideoFilled size={20} />} onClick={() => setScanning(true)}>
        Scan games{where ? ` into ${where}` : ''}
      </Button>
      <Group gap="xs" wrap="nowrap" align="flex-end">
        <TextInput
          flex={1}
          label="Or type the barcode"
          placeholder="The digits under the bars"
          leftSection={<IconBarcode size={18} />}
          value={typedCode}
          onChange={(e) => setTypedCode(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && typedCode.trim()) {
              void read(typedCode.trim(), false);
              setTypedCode('');
            }
          }}
          inputMode="numeric"
        />
        <Button
          variant="default"
          disabled={!typedCode.trim()}
          onClick={() => {
            void read(typedCode.trim(), false);
            setTypedCode('');
          }}
        >
          Look
        </Button>
      </Group>
      {saidLine}

      {choosing && (
        <Card withBorder padding="sm">
          <Stack gap="xs">
            <Text fw={600}>
              Which copy of {choosing.game.title} ({choosing.game.platform}) goes in {where || 'the place'}?
            </Text>
            {[...choosing.game.copies]
              .map((c) => ({ c, n: [...choosing.game.copies].sort((a, b) => a.id - b.id).findIndex((x) => x.copyKey === c.copyKey) + 1 }))
              .map(({ c, n }) => (
                <Group key={c.copyKey} justify="space-between" wrap="nowrap" gap="xs">
                  <Text size="sm">
                    Copy {n} · {condition(c)}
                    <Text span size="xs" c="dimmed">
                      {' · '}
                      {same(c.place, where) ? 'already here' : c.place ? `in ${c.place}` : 'no place yet'}
                    </Text>
                  </Text>
                  <Button size="compact-sm" onClick={() => void guarded(() => put([c], choosing.fromCamera))} disabled={same(c.place, where)} aria-label={`Copy ${n} (${condition(c)}) goes in`}>
                    This one
                  </Button>
                </Group>
              ))}
            <Group gap="md">
              <Anchor component="button" type="button" size="xs" onClick={() => void guarded(() => put(choosing.game.copies, choosing.fromCamera))}>
                All {choosing.game.copies.length}
              </Anchor>
              <Anchor component="button" type="button" size="xs" c="dimmed" onClick={() => setChoosing(null)}>
                Skip this one
              </Anchor>
            </Group>
          </Stack>
        </Card>
      )}

      {unknown && (
        <Card withBorder padding="sm">
          <Stack gap="xs">
            <Text fw={600}>Which of your games is {unknown.code}?</Text>
            <GameSearch label="A few letters of its title" action="This is it" onPick={(g) => void link(g)} busy={false} />
            <Anchor component="button" type="button" size="xs" c="dimmed" onClick={() => setUnknown(null)}>
              Skip this one
            </Anchor>
          </Stack>
        </Card>
      )}

      {!unknown && (
        <Card withBorder padding="sm">
          <GameSearch label="Or type a title" action="Put it here" onPick={(g) => void guarded(() => take(g, false))} busy={!where} />
          {!where && (
            <Text size="xs" c="dimmed" mt={4}>
              Choose the place first.
            </Text>
          )}
        </Card>
      )}

      {places.data && places.data.places.length === 0 && packed.length === 0 && (
        <Alert color="gray">No game has a storage location yet: this is the quick way to give them one. Each copy&apos;s window has it too.</Alert>
      )}

      {packed.length > 0 && (
        <Card withBorder padding="sm">
          <Text fw={600} size="sm" mb={4}>
            Packed this visit: {count(packed.length)} {packed.length === 1 ? 'copy' : 'copies'}
          </Text>
          <Stack gap={2}>
            {packed.map((p) => (
              <Text key={p.copyKey} size="xs">
                {p.title} ({p.platform ?? 'no console'}, {condition(p)}) → {p.place}
                {p.before ? `, moved from ${p.before}` : ''}{' '}
                <Anchor component="button" type="button" size="xs" onClick={() => undo.mutate(p)} disabled={undo.isPending} aria-label={`Undo: ${p.title} back ${p.before ? `in ${p.before}` : 'to no place'}`}>
                  Undo
                </Anchor>
              </Text>
            ))}
          </Stack>
        </Card>
      )}
      <ScannerModal
        opened={scanning}
        onClose={() => setScanning(false)}
        onCode={(code) => void read(code, true)}
        qr={(text) => placeOfLabel(text) !== null}
        keepOpen
        title={where ? `Scan the games going in ${where}` : "Scan the place's label first"}
      >
        {saidLine}
      </ScannerModal>
    </Stack>
  );
}
