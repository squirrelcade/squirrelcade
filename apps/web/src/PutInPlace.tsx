import { Alert, Anchor, Autocomplete, Button, Card, Checkbox, Group, Loader, Stack, Text } from '@mantine/core';
import { COMPLETENESS_LABELS, type Completeness } from '@squirrelcade/core';
import { IconMapPin } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from './api';
import { notifyError } from './hooks';
import { PLACE_EXAMPLE, PlaceNote, placesChanged, type PlaceCopy, type PlaceGame, type Placed, type Vocabulary } from './places';

const condition = (c: PlaceCopy) => COMPLETENESS_LABELS[c.completeness as Completeness] ?? c.completeness;

/**
 * "Put the games I have here in a place" (D157), under Check a shelf's list: a photo of a bag's games, and their
 * copies get that bag as their storage location in one go, after a look at the list. Each game's first copy is ticked
 * (one without a place first); a game with several copies lists each, to tick the one in the photo.
 */
export function PutInPlace({ platformKey, titles }: { platformKey: string; titles: string[] }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState('');
  const where = place.trim().replace(/\s+/g, ' ');
  const vocabulary = useQuery({ queryKey: ['tags'], queryFn: () => api<Vocabulary>('/tags'), enabled: open });
  const found = useQuery({
    queryKey: ['places', 'games', platformKey, titles],
    queryFn: () => api<{ games: (PlaceGame | null)[] }>('/places/games', { method: 'POST', json: { games: titles.map((title) => ({ platformKey, title })) } }),
    enabled: open && titles.length > 0,
  });
  const games = useMemo(() => (found.data?.games ?? []).filter((g): g is PlaceGame => g !== null), [found.data]);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  useEffect(() => setTicked(new Set(games.map((g) => g.copies[0]!.copyKey))), [games]);
  const [done, setDone] = useState<{ place: string; placed: Placed[] } | null>(null);

  const put = useMutation({
    mutationFn: () => api<{ place: string; placed: Placed[] }>('/places/put', { method: 'POST', json: { place: where, keys: [...ticked] } }),
    onSuccess: async (answer) => {
      setDone(answer);
      await placesChanged(queryClient);
    },
    onError: (err) => notifyError(err),
  });
  // Undo: each copy back where it was (one call for each place it came from).
  const undo = useMutation({
    mutationFn: async (placed: Placed[]) => {
      const byBefore = new Map<string | null, string[]>();
      for (const p of placed) byBefore.set(p.before, [...(byBefore.get(p.before) ?? []), p.copyKey]);
      for (const [before, keys] of byBefore) await api('/places/put', { method: 'POST', json: { place: before, keys } });
    },
    onSuccess: async () => {
      setDone(null);
      await placesChanged(queryClient);
    },
    onError: (err) => notifyError(err),
  });

  if (titles.length === 0) return null;
  if (!open) {
    return (
      <Button variant="light" leftSection={<IconMapPin size={16} />} onClick={() => setOpen(true)}>
        Put the games I have here in a place
      </Button>
    );
  }
  const noteOf = (name: string) => vocabulary.data?.locations.find((l) => l.name.toLowerCase() === name.toLowerCase())?.note ?? null;
  const toggle = (key: string, on: boolean) =>
    setTicked((s) => {
      const next = new Set(s);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  if (done) {
    const moved = done.placed.filter((p) => p.before && p.before.toLowerCase() !== done.place.toLowerCase());
    return (
      <Alert color="green" title={`${done.placed.length} ${done.placed.length === 1 ? 'copy is' : 'copies are'} in ${done.place}`}>
        {moved.length > 0 && <Text size="sm">Moved: {moved.map((p) => `${p.title} (from ${p.before})`).join(', ')}.</Text>}
        <Anchor component="button" type="button" size="sm" onClick={() => undo.mutate(done.placed)} disabled={undo.isPending}>
          Undo
        </Anchor>
      </Alert>
    );
  }

  return (
    <Card withBorder padding="sm">
      <Stack gap="xs">
        <Text fw={700}>Put the games I have here in a place</Text>
        <Autocomplete
          label="The place"
          description={`Storage location: ${PLACE_EXAMPLE}`}
          placeholder="Type a place, or choose one"
          data={(vocabulary.data?.locations ?? []).map((l) => l.name)}
          value={place}
          onChange={setPlace}
          maxLength={80}
        />
        {where && noteOf(where) && (
          <Text size="xs" c="dimmed">
            {where}
            <PlaceNote note={noteOf(where)} />
          </Text>
        )}
        {found.isPending && <Loader size="xs" />}
        {found.error && <Alert color="red">{errorMessage(found.error)}</Alert>}
        {games.map((g) => (
          <Stack key={g.title} gap={2}>
            {g.copies.length === 1 ? (
              <Checkbox
                checked={ticked.has(g.copies[0]!.copyKey)}
                onChange={(e) => toggle(g.copies[0]!.copyKey, e.currentTarget.checked)}
                label={
                  <>
                    {g.title}
                    <Text span size="xs" c="dimmed">
                      {' · '}
                      {condition(g.copies[0]!)}
                      {g.copies[0]!.place ? ` · in ${g.copies[0]!.place}` : ''}
                    </Text>
                  </>
                }
              />
            ) : (
              <>
                <Text size="sm">{g.title}</Text>
                {g.copies.map((c) => (
                  <Checkbox
                    key={c.copyKey}
                    ml="md"
                    checked={ticked.has(c.copyKey)}
                    onChange={(e) => toggle(c.copyKey, e.currentTarget.checked)}
                    label={
                      <Text span size="sm">
                        {condition(c)}
                        <Text span size="xs" c="dimmed">
                          {c.place ? ` · in ${c.place}` : ' · no place yet'}
                        </Text>
                      </Text>
                    }
                  />
                ))}
              </>
            )}
          </Stack>
        ))}
        <Group gap="xs">
          <Button onClick={() => put.mutate()} loading={put.isPending} disabled={!where || ticked.size === 0}>
            Put {ticked.size} {ticked.size === 1 ? 'copy' : 'copies'} in {where || 'the place'}
          </Button>
          <Button variant="subtle" color="gray" onClick={() => setOpen(false)}>
            Not now
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
