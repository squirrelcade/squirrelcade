import { Alert, Anchor, Button, Card, Group, Loader, Progress, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconBarcode, IconCheck, IconSearch, IconVideoFilled } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { HelpLink } from '../components';
import { count } from '../format';
import { notifyError, usePageTitle, useSetting } from '../hooks';
import { isBarcode } from '../lines';
import { ScannerModal } from '../ScannerModal';

/** GET /api/v1/barcodes/coverage: each console's owned games, and how many have their barcode. */
interface Coverage {
  key: string;
  name: string;
  games: number;
  withBarcode: number;
}

/** GET /api/v1/barcodes/<code>: the game Squirrelcade has saved for a barcode, or null. */
interface Saved {
  code: string;
  platformKey: string;
  platform: string;
  title: string;
}

/** A game of Store Mode's search (GET /api/v1/lookup): here, only the ones owned count. */
interface Found {
  platformKey: string;
  title: string;
  answer: string;
  ownedAs: string[];
}

/** The console last scanned, kept in this browser (a shelf is often one console). */
const CONSOLE = 'squirrelcade-shelf-console';

/**
 * Scan my shelf (0.33.0, the owner's plan in GitHub issue 1): at home, at an easy pace, each of your games' barcodes
 * scanned (or typed) and matched to the game by a few letters of its title, on the console on the shelf. Store Mode
 * then knows them at once in a store, even with no signal, without the barcode service (never asked here).
 */
export function ShelfPage() {
  const queryClient = useQueryClient();
  const appName = useSetting('general.instanceName', 'Squirrelcade') || 'Squirrelcade';
  usePageTitle('Scan my shelf', appName);
  const coverage = useQuery({ queryKey: ['barcodes', 'coverage'], queryFn: () => api<Coverage[]>('/barcodes/coverage') });
  const [platform, setPlatform] = useState<string | null>(() => {
    try {
      return localStorage.getItem(CONSOLE);
    } catch {
      return null;
    }
  });
  // The console with the most games, until one is chosen.
  useEffect(() => {
    const list = coverage.data ?? [];
    if (list.length > 0 && (!platform || !list.some((c) => c.key === platform))) setPlatform([...list].sort((a, b) => b.games - a.games)[0]!.key);
  }, [coverage.data, platform]);
  const choose = (key: string | null) => {
    setPlatform(key);
    try {
      if (key) localStorage.setItem(CONSOLE, key);
    } catch {
      // No storage: chosen for this visit only.
    }
  };
  const here = coverage.data?.find((c) => c.key === platform) ?? null;

  const [scanning, setScanning] = useState(false);
  const [typed, setTyped] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [learned, setLearned] = useState<{ code: string; title: string; platform: string; known: boolean }[]>([]);
  const saved = useQuery({ queryKey: ['barcodes', 'saved', code], queryFn: () => api<{ saved: Saved | null }>(`/barcodes/${code}`), enabled: code !== null });
  // A barcode Squirrelcade already knows is noted once, and the next one can be scanned.
  useEffect(() => {
    const s = saved.data?.saved;
    if (s && !learned.some((l) => l.code === s.code)) setLearned((list) => [{ code: s.code, title: s.title, platform: s.platform, known: true }, ...list].slice(0, 20));
  }, [saved.data]);

  const [q, setQ] = useState('');
  const [debounced] = useDebouncedValue(q, 250);
  const unknown = code !== null && saved.data?.saved === null;
  const found = useQuery({
    queryKey: ['lookup', 'shelf', platform, debounced],
    queryFn: () => api<Found[]>(`/lookup?q=${encodeURIComponent(debounced)}&platform=${encodeURIComponent(platform!)}&limit=30`),
    enabled: unknown && Boolean(platform) && debounced.trim().length >= 2,
  });
  const owned = (found.data ?? []).filter((f) => f.answer === 'own' || f.answer === 'own-not-in-catalog').slice(0, 8);

  const link = useMutation({
    mutationFn: (f: Found) => api('/barcodes', { method: 'POST', json: { code, platformKey: f.platformKey, title: f.title } }),
    onSuccess: async (_d, f) => {
      setLearned((list) => [{ code: code!, title: f.title, platform: here?.name ?? f.platformKey, known: false }, ...list].slice(0, 20));
      setCode(null);
      setQ('');
      await queryClient.invalidateQueries({ queryKey: ['barcodes'] });
      await queryClient.invalidateQueries({ queryKey: ['lookup'] });
    },
    onError: (err) => notifyError(err),
  });
  // A wrong link (a mis-tap on "This is it", or another app's export) is forgotten, and the game chosen again.
  const forget = useMutation({
    mutationFn: (c: string) => api(`/barcodes/${c}`, { method: 'DELETE' }),
    onSuccess: async (_d, c) => {
      setLearned((list) => list.filter((l) => l.code !== c));
      setQ('');
      setCode(c);
      await queryClient.invalidateQueries({ queryKey: ['barcodes'] });
      await queryClient.invalidateQueries({ queryKey: ['lookup'] });
    },
    onError: (err) => notifyError(err),
  });

  const take = (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    if (!isBarcode(raw)) {
      notifyError(new Error('A barcode has 8 to 14 digits.'), "That isn't a barcode");
      return;
    }
    setTyped('');
    setQ('');
    setCode(digits);
  };

  const percent = here && here.games > 0 ? Math.round((here.withBarcode / here.games) * 1000) / 10 : 0;
  return (
    <Stack maw={640} mx="auto" gap="sm">
      <Group justify="space-between" align="baseline">
        <Group gap={6} wrap="nowrap">
          <Title order={2}>Scan my shelf</Title>
          <HelpLink topic="store-mode" />
        </Group>
        <Anchor component={Link} to="/store" size="sm">
          Store Mode
        </Anchor>
      </Group>
      <Text size="sm" c="dimmed">
        Teach Squirrelcade your own games&apos; barcodes, at home at an easy pace: each one then answers at once in a store, even with no signal, and never needs the barcode service. Choose the console on the shelf, then scan each game.
      </Text>
      {coverage.isPending && <Loader size="sm" />}
      {coverage.data && coverage.data.length === 0 && <Alert color="gray">Your collection has no copies yet: bring in your first export on the welcome guide.</Alert>}
      {coverage.data && coverage.data.length > 0 && (
        <>
          <Select
            label="The console on the shelf"
            data={coverage.data.map((c) => ({ value: c.key, label: `${c.name} (${count(c.withBarcode)} of ${count(c.games)})` }))}
            value={platform}
            onChange={choose}
            allowDeselect={false}
            searchable
          />
          {here && (
            <div>
              <Progress value={percent} size="sm" aria-label={`${here.name}: ${count(here.withBarcode)} of ${count(here.games)} games have their barcode`} />
              <Text size="xs" c="dimmed" mt={4}>
                {here.name}: {count(here.withBarcode)} of {count(here.games)} games have their barcode ({percent}%).
              </Text>
            </div>
          )}
          <Button size="lg" fullWidth leftSection={<IconVideoFilled size={20} />} onClick={() => setScanning(true)}>
            Scan a game
          </Button>
          <Group gap="xs" wrap="nowrap" align="flex-end">
            <TextInput
              flex={1}
              label="Or type the barcode"
              placeholder="The digits under the bars"
              leftSection={<IconBarcode size={18} />}
              value={typed}
              onChange={(e) => setTyped(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && typed.trim() && take(typed)}
              inputMode="numeric"
            />
            <Button variant="default" onClick={() => typed.trim() && take(typed)} disabled={!typed.trim()}>
              Look
            </Button>
          </Group>
        </>
      )}

      {code !== null && saved.isPending && <Loader size="sm" />}
      {saved.data?.saved && (
        <Alert color="green" icon={<IconCheck />}>
          Already known: {saved.data.saved.code} is {saved.data.saved.title} ({saved.data.saved.platform}).{' '}
          <Anchor component="button" type="button" size="sm" onClick={() => setScanning(true)}>
            Scan the next one
          </Anchor>
          {' · '}
          <Anchor component="button" type="button" size="sm" onClick={() => forget.mutate(saved.data!.saved!.code)} disabled={forget.isPending}>
            Not this game?
          </Anchor>
        </Alert>
      )}
      {unknown && (
        <Card withBorder padding="sm">
          <Stack gap="xs">
            <Text fw={600}>Which of your games is {code}?</Text>
            <TextInput
              label={`A few letters of its title (your games on ${here?.name ?? 'this console'})`}
              placeholder="zelda, mario kart..."
              leftSection={<IconSearch size={16} />}
              value={q}
              onChange={(e) => setQ(e.currentTarget.value)}
              data-autofocus
              autoFocus
            />
            {found.isFetching && <Loader size="xs" />}
            {debounced.trim().length >= 2 && !found.isFetching && owned.length === 0 && (
              <Text size="sm" c="dimmed">
                None of your games on {here?.name ?? 'this console'} matches. On another console? Choose it above.
              </Text>
            )}
            {owned.map((f) => (
              <Group key={`${f.platformKey}|${f.title}`} justify="space-between" wrap="nowrap">
                <Text size="sm">
                  {f.title}
                  {f.ownedAs.length > 0 && f.ownedAs[0] !== f.title && (
                    <Text span size="xs" c="dimmed">
                      {' '}
                      (your copy: {f.ownedAs.join(', ')})
                    </Text>
                  )}
                </Text>
                <Button size="compact-sm" onClick={() => link.mutate(f)} loading={link.isPending && link.variables?.title === f.title}>
                  This is it
                </Button>
              </Group>
            ))}
            <Anchor component="button" type="button" size="xs" c="dimmed" onClick={() => setCode(null)}>
              Skip this one
            </Anchor>
          </Stack>
        </Card>
      )}

      {learned.length > 0 && (
        <Card withBorder padding="sm">
          <Text fw={600} size="sm" mb={4}>
            This visit: {count(learned.filter((l) => !l.known).length)} learned, {count(learned.filter((l) => l.known).length)} already known
          </Text>
          <Stack gap={2}>
            {learned.map((l) => (
              <Text key={l.code} size="xs">
                {l.code}: {l.title} ({l.platform}){l.known ? ', already known' : ''}
                {!l.known && (
                  <>
                    {' '}
                    <Anchor component="button" type="button" size="xs" onClick={() => forget.mutate(l.code)} disabled={forget.isPending} aria-label={`Undo: ${l.code} isn't ${l.title}`}>
                      Undo
                    </Anchor>
                  </>
                )}
              </Text>
            ))}
          </Stack>
        </Card>
      )}
      <ScannerModal
        opened={scanning}
        onClose={() => setScanning(false)}
        onCode={(scanned) => {
          setScanning(false);
          take(scanned);
        }}
      />
    </Stack>
  );
}
