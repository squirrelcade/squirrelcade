import { Accordion, Alert, Anchor, Badge, Button, Group, Loader, Stack, Text, TextInput } from '@mantine/core';
import { COMPLETENESS_LABELS, type Completeness } from '@squirrelcade/core';
import { IconMapPin, IconPackage, IconPrinter, IconSearch } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, errorMessage } from '../api';
import { PageHeader } from '../components';
import { count } from '../format';
import { GameTitle } from '../GameDrawer';
import { notifyError, notifySuccess, useCanEdit, usePageTitle, useSetting } from '../hooks';
import { PlaceNote, placesChanged, type Place } from '../places';

/** A place's name and note, changed in place on its panel (the owner's). */
function PlaceEditor({ place }: { place: Place }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(place.name);
  const [note, setNote] = useState(place.note ?? '');
  const rename = useMutation({
    mutationFn: () => api<{ name: string; copies: number }>('/places/rename', { method: 'POST', json: { from: place.name, to: name } }),
    onSuccess: async (r) => {
      notifySuccess(`${place.name} is ${r.name} now, on ${count(r.copies)} ${r.copies === 1 ? 'copy' : 'copies'}. Its old label still says ${place.name}: print a new one.`, 'Renamed');
      await placesChanged(queryClient);
    },
    onError: (err) => notifyError(err),
  });
  const saveNote = useMutation({
    mutationFn: () => api('/places/note', { method: 'PUT', json: { place: place.name, note } }),
    onSuccess: async () => {
      notifySuccess(note.trim() ? `${place.name}: ${note.trim()}` : `${place.name} has no note now.`, 'Saved');
      await placesChanged(queryClient);
    },
    onError: (err) => notifyError(err),
  });
  return (
    <Stack gap="xs">
      <Group gap="xs" wrap="nowrap" align="flex-end">
        <TextInput flex={1} label="Its name" value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={80} />
        <Button variant="default" onClick={() => rename.mutate()} loading={rename.isPending} disabled={!name.trim() || name.trim() === place.name}>
          Rename
        </Button>
      </Group>
      <Group gap="xs" wrap="nowrap" align="flex-end">
        <TextInput flex={1} label="Where the place is" placeholder="Under the master bed, the hall closet..." value={note} onChange={(e) => setNote(e.currentTarget.value)} maxLength={120} />
        <Button variant="default" onClick={() => saveNote.mutate()} loading={saveNote.isPending} disabled={note.trim() === (place.note ?? '')}>
          Save
        </Button>
      </Group>
    </Stack>
  );
}

/**
 * Stash > Places (D157): every storage location with its count and its games. Renaming a place changes it on every
 * copy in it; a note says where the place itself is ("Bag 7 · under the master bed"), so moving a bag is one change.
 */
export function PlacesPage() {
  const canEdit = useCanEdit();
  const appName = useSetting('general.instanceName', 'Squirrelcade') || 'Squirrelcade';
  usePageTitle('Places', appName);
  const places = useQuery({ queryKey: ['places'], queryFn: () => api<{ places: Place[]; unplaced: number }>('/places') });
  const [filter, setFilter] = useState('');
  const f = filter.trim().toLowerCase();
  const shown = (places.data?.places ?? []).filter((p) => !f || p.name.toLowerCase().includes(f) || (p.note ?? '').toLowerCase().includes(f) || p.copies.some((c) => c.title.toLowerCase().includes(f)));
  const placed = (places.data?.places ?? []).reduce((n, p) => n + p.copies.length, 0);
  return (
    <Stack gap="sm">
      <PageHeader
        title="Places"
        help="your-copies"
        description="Where your games are kept: each storage location with its games. A note says where the place itself is, so moving a bag is one change."
        actions={
          canEdit && (
            <>
              <Button component={Link} to="/store/pack" leftSection={<IconPackage size={16} />}>
                Pack a place
              </Button>
              <Button component={Link} to="/collection/places/labels" variant="default" leftSection={<IconPrinter size={16} />}>
                Print labels
              </Button>
            </>
          )
        }
      />
      {places.isPending && <Loader size="sm" />}
      {places.error && <Alert color="red">{errorMessage(places.error)}</Alert>}
      {places.data && (
        <Text size="sm" c="dimmed">
          {count(places.data.places.length)} {places.data.places.length === 1 ? 'place' : 'places'}, {count(placed)} {placed === 1 ? 'copy' : 'copies'} in them
          {places.data.unplaced > 0 && (
            <>
              {', '}
              {canEdit ? (
                <Anchor component={Link} to="/collection/improve?gap=location" size="sm">
                  {count(places.data.unplaced)} without one
                </Anchor>
              ) : (
                `${count(places.data.unplaced)} without one`
              )}
            </>
          )}
          .
        </Text>
      )}
      {places.data && places.data.places.length === 0 && (
        <Alert color="gray" icon={<IconMapPin />}>
          No game has a storage location yet. {canEdit ? 'Pack a place gives a bag or a shelf its games quickly; each copy’s window has it too.' : ''}
        </Alert>
      )}
      {places.data && places.data.places.length > 6 && (
        <TextInput placeholder="Find a place or a game" leftSection={<IconSearch size={16} />} value={filter} onChange={(e) => setFilter(e.currentTarget.value)} aria-label="Find a place or a game" maw={360} />
      )}
      <Accordion multiple variant="separated">
        {shown.map((p) => (
          <Accordion.Item key={p.name.toLowerCase()} value={p.name.toLowerCase()}>
            <Accordion.Control>
              <Group gap="xs" wrap="nowrap" justify="space-between" pr="sm">
                <Text fw={600} style={{ minWidth: 0 }}>
                  {p.name}
                  <PlaceNote note={p.note} size="sm" />
                </Text>
                <Badge variant="light" color="gray" style={{ flex: 'none', textTransform: 'none' }}>
                  {count(p.copies.length)} {p.copies.length === 1 ? 'game' : 'games'}
                </Badge>
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap="sm">
                <Group gap="md">
                  {p.copies.length > 0 && (
                    <Anchor component={Link} to={`/collection?location=${encodeURIComponent(p.name)}`} size="sm">
                      Show on the Stash
                    </Anchor>
                  )}
                  {canEdit && (
                    <Anchor component={Link} to={`/store/pack?place=${encodeURIComponent(p.name)}`} size="sm">
                      Pack it
                    </Anchor>
                  )}
                  {canEdit && (
                    <Anchor component={Link} to={`/collection/places/labels?place=${encodeURIComponent(p.name)}`} size="sm">
                      Its label
                    </Anchor>
                  )}
                </Group>
                {p.copies.length === 0 && (
                  <Text size="sm" c="dimmed">
                    No games in it yet.
                  </Text>
                )}
                <Stack gap={2}>
                  {p.copies.map((c) => (
                    <Text key={c.copyKey} size="sm">
                      {c.platformKey ? <GameTitle platformKey={c.platformKey} title={c.title} withNote={false} /> : c.title}
                      <Text span size="xs" c="dimmed">
                        {' · '}
                        {c.platform ?? 'no console'} · {COMPLETENESS_LABELS[c.completeness as Completeness] ?? c.completeness}
                      </Text>
                    </Text>
                  ))}
                </Stack>
                {canEdit && <PlaceEditor place={p} />}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
    </Stack>
  );
}
