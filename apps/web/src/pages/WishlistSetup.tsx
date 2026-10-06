import { IGDB_GENRE_NAMES, IGDB_STYLE_NAMES, rankOrder, settingDefinitions, shapePoints, type ShapeSpec } from '@squirrelcade/core';
import { ActionIcon, Alert, Anchor, Button, Card, Group, List, Loader, Select, SimpleGrid, Stack, Text, Title, Tooltip } from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconCheck, IconX } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { notifyError, useSettingsState } from '../hooks';

/** What the wishlist learned from the collection (GET /api/v1/wishlist/tastes). */
interface Tastes {
  months: number;
  minGames: number;
  platforms: { key: string; name: string; recent: number; owned: number }[];
  genres: { name: string; lift: number }[];
  learning: { platforms: boolean; genres: boolean };
}

/** The wishlist's top picks (GET /api/v1/wishlist). */
interface Picks {
  master: { title: string; platformName: string; masterScore: number }[];
}

const PLATFORMS = 'wishlist.platformPoints';
const GENRES = 'wishlist.genrePoints';
const STYLES = 'wishlist.stylePoints';
/** A new list's curve when it has none yet: styles add a little on top of a game's genre. */
const NEW_LIST: Record<string, ShapeSpec> = { [STYLES]: { shape: 'linear', top: 6, bottom: 1, order: [] } };
type Shapes = Record<string, ShapeSpec>;

/** A ranked list to put in order: up, down, or off the list. */
function OrderList({ title, hint, items, name, onChange, add }: { title: string; hint: string; items: string[]; name: (key: string) => string; onChange: (items: string[]) => void; add: { value: string; label: string }[] }) {
  const move = (i: number, by: number) => {
    const next = [...items];
    const [item] = next.splice(i, 1);
    next.splice(i + by, 0, item!);
    onChange(next);
  };
  return (
    <Card withBorder padding="sm">
      <Title order={5}>{title}</Title>
      <Text size="xs" c="dimmed" mb="xs">
        {hint}
      </Text>
      <Stack gap={2}>
        {items.map((key, i) => (
          <Group key={key} gap={4} wrap="nowrap" justify="space-between">
            <Text size="sm" style={{ flex: 1 }} truncate>
              {i + 1}. {name(key)}
            </Text>
            <Group gap={0} wrap="nowrap">
              <ActionIcon size="sm" variant="subtle" color="gray" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${name(key)} up`}>
                <IconArrowUp size={14} />
              </ActionIcon>
              <ActionIcon size="sm" variant="subtle" color="gray" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${name(key)} down`}>
                <IconArrowDown size={14} />
              </ActionIcon>
              <Tooltip label="Off the list (no acorns)">
                <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => onChange(items.filter((k) => k !== key))} aria-label={`Take ${name(key)} off the list`}>
                  <IconX size={14} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>
        ))}
      </Stack>
      {add.length > 0 && <Select mt="xs" size="xs" placeholder="Add…" data={add} value={null} onChange={(v) => v && onChange([...items, v])} searchable />}
    </Card>
  );
}

/**
 * The welcome guide's wishlist step: the consoles and genres the wishlist learned from the collection, in
 * order, to rearrange with up and down, and the styles the owner likes (the same lists as Wishlist > Scoring,
 * which has the curves and the rest). Keeping them as they are keeps them learning; any change makes them
 * the owner's own.
 */
export function WishlistStep({ onNext }: { onNext: () => void }) {
  const queryClient = useQueryClient();
  const state = useSettingsState();
  const tastes = useQuery({ queryKey: ['wishlist', 'tastes'], queryFn: () => api<Tastes>('/wishlist/tastes') });
  const [consoles, setConsoles] = useState<string[] | null>(null);
  const [genres, setGenres] = useState<string[] | null>(null);
  const [styles, setStyles] = useState<string[] | null>(null);
  const [picks, setPicks] = useState<Picks['master'] | null>(null);

  const values: Record<string, unknown> = state.data?.values ?? {};
  const shapes = (values['wishlist.pointShapes'] as Shapes | undefined) ?? (settingDefinitions['wishlist.pointShapes'].default as Shapes);
  const t = tastes.data;
  // Where the lists start: the owner's own order when they have one, else what the collection shows.
  const ownOrder = (key: string) => rankOrder((values[key] as Record<string, number> | undefined) ?? {}, shapes[key]?.order ?? []);
  const learnedConsoles = t ? (t.platforms.some((p) => p.recent >= t.minGames) ? t.platforms.filter((p) => p.recent >= t.minGames) : [...t.platforms].sort((a, b) => b.owned - a.owned).slice(0, 8)).map((p) => p.key) : [];
  const startConsoles = t && !t.learning.platforms ? ownOrder(PLATFORMS) : learnedConsoles;
  const startGenres = t && !t.learning.genres ? ownOrder(GENRES) : (t?.genres.map((g) => g.name) ?? []);
  const shownConsoles = consoles ?? startConsoles;
  const shownGenres = genres ?? startGenres;
  // Styles aren't learned: the owner's own list, or none yet.
  const shownStyles = styles ?? ownOrder(STYLES);
  const platformName = (key: string) => t?.platforms.find((p) => p.key === key)?.name ?? key;

  const save = useMutation({
    mutationFn: async () => {
      const nextShapes: Shapes = { ...shapes };
      const changes: Record<string, unknown> = {};
      for (const [key, order] of [
        [PLATFORMS, consoles],
        [GENRES, genres],
        [STYLES, styles],
      ] as const) {
        if (!order) continue;
        const spec: ShapeSpec = { ...(shapes[key] ?? NEW_LIST[key] ?? { shape: 'linear', top: 22, bottom: 0, order: [] }), order: [...order] };
        if (spec.shape === 'custom') spec.shape = 'linear';
        changes[key] = shapePoints(spec);
        nextShapes[key] = spec;
      }
      changes['wishlist.pointShapes'] = nextShapes;
      await api('/settings', { method: 'PUT', json: { changes } });
      return api<Picks>('/wishlist');
    },
    onSuccess: (r) => {
      setPicks(r.master.slice(0, 5));
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      void queryClient.invalidateQueries({ queryKey: ['wishlist'] });
    },
    onError: (err) => notifyError(err),
  });

  if (!t) return <Loader />;
  const changed = consoles !== null || genres !== null || styles !== null;
  return (
    <Card withBorder mt="md" maw={900}>
      <Title order={4} mb="xs">
        What you want most (optional)
      </Title>
      <Stack gap="sm">
        <Text size="sm">
          The wishlist ranks the games you're missing by what you collect.{' '}
          {t.learning.platforms && t.learning.genres
            ? 'It learned these from your collection: the consoles you added the most games to lately, and the genres you own more of than the catalogs hold. Put them in your order, or leave them learning.'
            : 'These are your lists from Acorns (a list you never set is learned from your collection). Put them in another order, or leave them as they are.'}{' '}
          Acorns, in the menu, has the curves and every other rule.
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
          <OrderList
            title="Consoles"
            hint="Games for the first ones get the most acorns; consoles not listed get none for their console."
            items={shownConsoles}
            name={platformName}
            onChange={(items) => {
              setConsoles(items);
              setPicks(null);
            }}
            add={t.platforms.filter((p) => !shownConsoles.includes(p.key)).map((p) => ({ value: p.key, label: p.name }))}
          />
          <OrderList
            title="Genres"
            hint={
              shownGenres.length === 0 && !genres
                ? 'Learned once IGDB’s game details are in (the Covers step); or add the genres you like, the favorite first.'
                : 'A game gets its genre’s acorns (several genres are averaged).'
            }
            items={shownGenres}
            name={(g) => g}
            onChange={(items) => {
              setGenres(items);
              setPicks(null);
            }}
            add={IGDB_GENRE_NAMES.filter((g) => !shownGenres.includes(g)).map((g) => ({ value: g, label: g }))}
          />
          <OrderList
            title="Styles"
            hint="Optional: styles you like, the favorite first (JRPG, open world...). A game of the style gets a few acorns on top of its genre's."
            items={shownStyles}
            name={(g) => g}
            onChange={(items) => {
              setStyles(items);
              setPicks(null);
            }}
            add={IGDB_STYLE_NAMES.filter((g) => !shownStyles.includes(g)).map((g) => ({ value: g, label: g }))}
          />
        </SimpleGrid>
        {picks && (
          <Alert color="green" icon={<IconCheck />} title={picks.length > 0 ? 'Saved. Your top picks now:' : 'Saved.'}>
            {picks.length === 0 && (
              <Text size="sm">The wishlist fills in once your consoles' catalogs are built, a few minutes after a console has enough games.</Text>
            )}
            <List size="sm" type="ordered">
              {picks.map((p) => (
                <List.Item key={`${p.platformName}|${p.title}`}>
                  {p.title} ({p.platformName}), {p.masterScore}
                </List.Item>
              ))}
            </List>
            <Anchor component={Link} to="/wishlist" size="sm">
              Open the wishlist
            </Anchor>
          </Alert>
        )}
        <Group justify="flex-end">
          {!picks && (
            <Button variant="default" onClick={onNext}>
              {changed ? 'Skip: leave them as they were' : 'Leave them as they are'}
            </Button>
          )}
          {picks ? (
            <Button onClick={onNext}>Next</Button>
          ) : (
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!changed}>
              Use my order
            </Button>
          )}
        </Group>
      </Stack>
    </Card>
  );
}
