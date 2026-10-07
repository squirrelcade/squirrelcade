import { ActionIcon, Badge, Button, Card, Checkbox, Group, Loader, Modal, Progress, ScrollArea, SegmentedControl, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useLocalStorage } from '@mantine/hooks';
import { matchKey } from '@squirrelcade/core';
import { IconAdjustments, IconArrowDown, IconArrowUp, IconChevronDown, IconChevronRight, IconListNumbers, IconPlus, IconSearch, IconX } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../api';
import type { SortDirection } from '../components';
import { count, releaseDate } from '../format';
import { StashMark } from '../Acorn';
import { GameTitle } from '../GameDrawer';
import { PreferencePicker } from '../Preference';
import { notifyError, notifySuccess, useCanEdit, useSetting } from '../hooks';
import { sortRows, useSort } from '../sort';

/** One series across the consoles' catalogs (GET /api/v1/series). */
interface Series {
  name: string;
  owned: number;
  missing: number;
  ownedElsewhere: number;
  /** Of the missing ones, those you have on PC. */
  onPc: number;
  total: number;
  percent: number;
  platforms: string[];
  /** One of your own series (Set up), not IGDB's. */
  custom?: boolean;
}

/** A series' game on one console (GET /api/v1/series/games). */
interface SeriesGame {
  platformKey: string;
  platform: string;
  title: string;
  status: string;
  released: string | null;
  ownedOn: string[];
  /** Your wishlist preference for it. */
  preference?: string | null;
  /** You don't have it here, but you have it on PC. */
  onPc?: boolean;
  /** For a remake or remaster: the earliest version of it in the series (IGDB's links). */
  original?: { title: string; released: string | null; kind: 'remake' | 'remaster' | 'version' };
}

/** When a game sorts by year: a remake or remaster with the version it follows (so they stand together), else its own release. */
const yearOf = (g: SeriesGame) => g.original?.released ?? g.released ?? '9999';

/** A remake's or remaster's line: "remake of Resident Evil 2". */
const versionOf = (g: SeriesGame) => (g.original ? `${g.original.kind === 'version' ? 'a version' : g.original.kind} of ${g.original.title}` : null);

const STATUS: Record<string, { label: string; color: string }> = {
  owned: { label: 'Owned', color: 'teal' },
  missing: { label: 'Missing', color: 'gray' },
  review: { label: 'To review', color: 'yellow' },
  unconfirmed: { label: 'Not confirmed physical', color: 'orange' },
  upcoming: { label: 'Not out yet', color: 'blue' },
};

/** The series table's columns and which way each sorts first (D144): names A to Z, counts most first. */
const SORTS = { name: 'asc', owned: 'desc', missing: 'desc' } as const satisfies Record<string, SortDirection>;

/** The menu's orders, each a column and a way, so the menu and the headings sort the table alike (D144). */
const ORDERS = { owned: ['owned', 'desc'], closest: ['missing', 'asc'], name: ['name', 'asc'] } as const satisfies Record<string, readonly [keyof typeof SORTS, SortDirection]>;

/** Most owned, then most complete, then A to Z: the order series that tie in a column keep. */
const MOST_OWNED = (a: Series, b: Series) => b.owned - a.owned || b.percent - a.percent || a.name.localeCompare(b.name);

/** The orders an opened series can take; the choice is remembered on this device. */
const GAME_ORDERS = {
  // By release, each remake or remaster right after the game it remakes.
  year: (a: SeriesGame, b: SeriesGame) =>
    yearOf(a).localeCompare(yearOf(b)) || Number(Boolean(a.original)) - Number(Boolean(b.original)) || (a.released ?? '9999').localeCompare(b.released ?? '9999') || a.title.localeCompare(b.title),
  missing: (a: SeriesGame, b: SeriesGame) => Number(a.status === 'owned') - Number(b.status === 'owned') || GAME_ORDERS.year(a, b),
  name: (a: SeriesGame, b: SeriesGame) => a.title.localeCompare(b.title) || a.platform.localeCompare(b.platform),
};

/** A series' story order from Settings > Collection > Story orders ("Name | [titles]"), or null. */
function storyOf(lines: string[], name: string): string[] | null {
  for (const line of lines) {
    const bar = line.indexOf('|');
    if (bar < 0 || line.slice(0, bar).trim() !== name) continue;
    try {
      const titles = JSON.parse(line.slice(bar + 1)) as unknown;
      return Array.isArray(titles) ? titles.filter((t): t is string => typeof t === 'string') : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * A series' games: in its story order where you set one (each game's versions by release year; a remake not placed
 * takes its original's place), else in release order (each remake or remaster right after its original), missing
 * first or A to Z.
 */
function SeriesGames({ name }: { name: string }) {
  const dateFormat = useSetting('general.dateFormat', 'us');
  const stories = useSetting('collection.seriesStoryOrder', [] as string[]);
  const canEdit = useCanEdit();
  const [order, setOrder] = useLocalStorage<string>({ key: 'squirrelcade-series-order', defaultValue: 'story' });
  const [editing, setEditing] = useState(false);
  const games = useQuery({ queryKey: ['series', name], queryFn: () => api<SeriesGame[]>(`/series/games?name=${encodeURIComponent(name)}`) });
  if (games.isLoading) return <Loader size="sm" />;
  const story = storyOf(stories, name);
  const place = new Map((story ?? []).map((t, i) => [matchKey(t), i]));
  // A remake not in the story order takes its original's place there.
  const placeOf = (g: SeriesGame) => place.get(matchKey(g.title)) ?? (g.original ? place.get(matchKey(g.original.title)) : undefined) ?? Infinity;
  const byStory = (a: SeriesGame, b: SeriesGame) => placeOf(a) - placeOf(b) || GAME_ORDERS.year(a, b);
  // The story order is the first choice where the series has one; elsewhere it falls back to release year.
  const chosen = order === 'story' ? (story ? 'story' : 'year') : order in GAME_ORDERS ? order : 'year';
  const sorted = [...(games.data ?? [])].sort(chosen === 'story' ? byStory : GAME_ORDERS[chosen as keyof typeof GAME_ORDERS]);
  // Each title once, in the order shown: what the story order is made of.
  const titles = [...new Set([...(games.data ?? [])].sort(story ? byStory : GAME_ORDERS.year).map((g) => g.title))];
  return (
    <Stack gap={4}>
      <Group gap="xs" mb={4}>
        <SegmentedControl
          size="xs"
          value={chosen}
          onChange={setOrder}
          data={[
            ...(story ? [{ value: 'story', label: 'Story order' }] : []),
            { value: 'year', label: 'Release year' },
            { value: 'missing', label: 'Missing first' },
            { value: 'name', label: 'A to Z' },
          ]}
          aria-label="Order of the series' games"
        />
        {canEdit && (
          <Button size="compact-xs" variant="subtle" leftSection={<IconListNumbers size={14} />} onClick={() => setEditing(true)}>
            {story ? 'Change the story order' : 'Set its story order'}
          </Button>
        )}
      </Group>
      {canEdit && <StoryOrder opened={editing} onClose={() => setEditing(false)} name={name} titles={titles} stories={stories} hasOne={story !== null} onSaved={() => setOrder('story')} />}
      {sorted.map((g) => (
        <Group key={`${g.platformKey}|${g.title}`} gap={8} wrap="nowrap">
          <Badge size="sm" variant="light" color={STATUS[g.status]?.color ?? 'gray'} style={{ textTransform: 'none', flexShrink: 0 }} w={120} leftSection={g.status === 'owned' ? <StashMark size={11} /> : undefined}>
            {STATUS[g.status]?.label ?? g.status}
          </Badge>
          <div style={{ minWidth: 0, flex: 1 }}>
            <GameTitle platformKey={g.platformKey} title={g.title} />
            <Text size="xs" c="dimmed">
              {[g.platform, g.released ? releaseDate(g.released, dateFormat) : null, versionOf(g), g.ownedOn.length > 0 ? `you have it on ${g.ownedOn.join(', ')}` : null, g.onPc ? 'you have it on PC' : null].filter(Boolean).join(' · ')}
            </Text>
          </div>
          {g.status !== 'owned' && <PreferencePicker platformKey={g.platformKey} title={g.title} value={g.preference ?? null} width={170} />}
        </Group>
      ))}
    </Stack>
  );
}

/**
 * Series: every IGDB series with games in your consoles' catalogs that you own a game of, with how many of its
 * games you have and, opened, which ones you don't (on every console at once).
 */
export function SeriesList() {
  const list = useQuery({ queryKey: ['series'], queryFn: () => api<Series[]>('/series') });
  // How many show before "Show all": Settings > Interface > Rows per page.
  const shownAtOnce = useSetting('interface.pageSize', 100);
  // A series named in the address (?series=, from a game's drawer) starts filtered to it and open.
  const [params] = useSearchParams();
  const named = params.get('series');
  const [filter, setFilter] = useState(named ?? '');
  // The headings sort the table and so does the menu above it (D144), in keys of their own: ?sort= is the Your sets tab's.
  const sorting = useSort(SORTS, 'owned', 'series');
  const [open, setOpen] = useState<string | null>(named);
  const [all, setAll] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const hidden = useSetting('collection.seriesHidden', [] as string[]);
  const own = useSetting('collection.customSeries', [] as string[]);
  const canEdit = useCanEdit();
  if (list.isLoading) return <Loader />;
  const phrase = filter.trim().toLowerCase();
  // The series you hid (Set up) stay out of the list, unless the address names one.
  const listed = (list.data ?? []).filter((s) => !hidden.includes(s.name) || s.name === named);
  const found = sortRows(listed.filter((s) => !phrase || s.name.toLowerCase().includes(phrase)).sort(MOST_OWNED), (s) => s[sorting.by], sorting.dir);
  const shown = all ? found : found.slice(0, shownAtOnce);

  if ((list.data ?? []).length === 0) {
    return (
      <Card withBorder>
        <Text size="sm">
          No series yet. Series come from IGDB's details of your consoles' games (Settings &gt; Sources &gt; IGDB), once you own a game of one, and from series of your
          own.
        </Text>
        {canEdit && (
          <>
            <Button size="xs" variant="default" leftSection={<IconAdjustments size={14} />} onClick={() => setSettingUp(true)} mt="sm" w="fit-content">
              Set up your own series
            </Button>
            <SeriesSetup opened={settingUp} onClose={() => setSettingUp(false)} names={[]} hidden={hidden} own={own} />
          </>
        )}
      </Card>
    );
  }
  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        The series (from IGDB) you own a game of, across your consoles' catalogs: {count(list.data!.length)} series. Open one to see its games, the ones you don't have first.
      </Text>
      <Group gap="sm">
        <TextInput placeholder="Filter by series" aria-label="Filter by series" leftSection={<IconSearch size={16} />} value={filter} onChange={(e) => setFilter(e.currentTarget.value)} w={260} />
        <SegmentedControl
          size="xs"
          value={Object.entries(ORDERS).find(([, [by, dir]]) => by === sorting.by && dir === sorting.dir)?.[0] ?? ''}
          onChange={(v) => {
            const [by, dir] = ORDERS[v as keyof typeof ORDERS];
            sorting.set(by, dir);
          }}
          data={[
            { value: 'owned', label: 'Most owned' },
            { value: 'closest', label: 'Fewest missing' },
            { value: 'name', label: 'A to Z' },
          ]}
        />
        {canEdit && (
          <Button size="xs" variant="default" leftSection={<IconAdjustments size={14} />} onClick={() => setSettingUp(true)}>
            Set up
          </Button>
        )}
        {hidden.length > 0 && (
          <Text size="xs" c="dimmed">
            {count(hidden.length)} hidden
          </Text>
        )}
      </Group>
      {canEdit && <SeriesSetup opened={settingUp} onClose={() => setSettingUp(false)} names={(list.data ?? []).map((x) => x.name)} hidden={hidden} own={own} />}
      <Card withBorder p={0}>
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              {sorting.th('name', 'Series')}
              {sorting.th('owned', 'Owned')}
              {sorting.th('missing', 'Missing', { ta: 'right' })}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {shown.map((s) => {
              const expanded = open === s.name;
              return (
                <Fragment key={s.name}>
                  <Table.Tr style={{ cursor: 'pointer' }} onClick={() => setOpen(expanded ? null : s.name)}>
                    <Table.Td>
                      <Group gap={6} wrap="nowrap">
                        {expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                        <div>
                          <Text size="sm" fw={500}>
                            {s.name}{' '}
                            {s.custom && (
                              <Badge size="xs" variant="light" color="squirrel">
                                Yours
                              </Badge>
                            )}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {s.platforms.length === 1 ? s.platforms[0] : `${s.platforms.length} consoles`}
                          </Text>
                        </div>
                      </Group>
                    </Table.Td>
                    <Table.Td miw={160}>
                      <Text size="sm">
                        {count(s.owned)} of {count(s.total)} ({s.percent}%){s.onPc > 0 ? ` · +${count(s.onPc)} on PC` : ''}
                      </Text>
                      {/* Owned on a console in green; then, in blue, the ones you have only on PC. */}
                      <Progress.Root size="sm" mt={4} aria-label={`${s.name}: ${s.percent}% owned${s.onPc > 0 ? `, ${count(s.onPc)} more on PC` : ''}`}>
                        <Progress.Section value={s.percent} color="forest" />
                        {s.onPc > 0 && <Progress.Section value={Math.round((s.onPc / s.total) * 1000) / 10} color="blue" />}
                      </Progress.Root>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="sm">{count(s.missing)}</Text>
                      {s.onPc > 0 && (
                        <Text size="xs" c="dimmed">
                          {count(s.onPc)} on PC
                        </Text>
                      )}
                      {s.ownedElsewhere > 0 && (
                        <Text size="xs" c="dimmed">
                          {count(s.ownedElsewhere)} on another console
                        </Text>
                      )}
                    </Table.Td>
                  </Table.Tr>
                  {expanded && (
                    <Table.Tr>
                      <Table.Td colSpan={3}>
                        <SeriesGames name={s.name} />
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Fragment>
              );
            })}
          </Table.Tbody>
        </Table>
      </Card>
      {!all && found.length > shownAtOnce && (
        <Button variant="default" size="xs" onClick={() => setAll(true)} w="fit-content">
          Show all {count(found.length)}
        </Button>
      )}
    </Stack>
  );
}

/** A line of Settings > Collection > Your own series ("Yakuza | Yakuza, Like a Dragon") as its name and words. */
function ownRow(line: string): { name: string; words: string } {
  const bar = line.indexOf('|');
  return bar < 0 ? { name: line.trim(), words: '' } : { name: line.slice(0, bar).trim(), words: line.slice(bar + 1).trim() };
}

/**
 * Sets > Series > Set up: which series show (a check box for each, with a search, all or none), and series of your
 * own (a name and the words their games' titles have). Saved as Settings > Collection > Series you hid and Your own
 * series.
 */
function SeriesSetup({ opened, onClose, names, hidden, own }: { opened: boolean; onClose: () => void; names: string[]; hidden: string[]; own: string[] }) {
  const queryClient = useQueryClient();
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<{ name: string; words: string }[]>([]);
  const [search, setSearch] = useState('');
  useEffect(() => {
    if (!opened) return;
    setShown(new Set(names.filter((n) => !hidden.includes(n))));
    setRows(own.map(ownRow));
    setSearch('');
    // Only on opening: what you change in the window stays until you save or cancel.
  }, [opened]);
  const save = useMutation({
    mutationFn: () =>
      api('/settings', {
        method: 'PUT',
        json: {
          changes: {
            'collection.seriesHidden': names.filter((n) => !shown.has(n)),
            'collection.customSeries': rows.filter((r) => r.name.trim() && r.words.trim()).map((r) => `${r.name.trim()} | ${r.words.trim()}`),
          },
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      void queryClient.invalidateQueries({ queryKey: ['series'] });
      notifySuccess('Your series are saved.');
      onClose();
    },
    onError: (err) => notifyError(err, "Couldn't save your series"),
  });
  const phrase = search.trim().toLowerCase();
  const listed = names.filter((n) => !phrase || n.toLowerCase().includes(phrase)).sort((a, b) => a.localeCompare(b));
  const setRow = (i: number, change: Partial<{ name: string; words: string }>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...change } : x)));
  return (
    <Modal opened={opened} onClose={onClose} title="Set up your series" size="lg">
      <Stack gap="sm">
        {names.length > 0 && (
          <>
            <Title order={6}>Which series show</Title>
            <Group gap="xs">
              <TextInput placeholder="Find a series" aria-label="Find a series" leftSection={<IconSearch size={14} />} value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={220} />
              <Button size="xs" variant="default" onClick={() => setShown(new Set(names))}>
                All
              </Button>
              <Button size="xs" variant="default" onClick={() => setShown(new Set())}>
                None
              </Button>
              <Text size="xs" c="dimmed">
                {count(shown.size)} of {count(names.length)} shown
              </Text>
            </Group>
            <ScrollArea h={240} type="auto">
              <Stack gap={4}>
                {listed.map((n) => (
                  <Checkbox
                    key={n}
                    label={n}
                    checked={shown.has(n)}
                    onChange={(e) => {
                      const on = e.currentTarget.checked;
                      setShown((old) => {
                        const next = new Set(old);
                        if (on) next.add(n);
                        else next.delete(n);
                        return next;
                      });
                    }}
                  />
                ))}
              </Stack>
            </ScrollArea>
          </>
        )}
        <Title order={6} mt="xs">
          Your own series
        </Title>
        <Text size="xs" c="dimmed">
          A name, and the words its games' titles have, separated by commas: "Yakuza" with "Yakuza, Like a Dragon". Its games come from your consoles' catalogs, and it
          shows with the others, whatever you own of it.
        </Text>
        {rows.map((r, i) => (
          <Group key={i} gap="xs" wrap="nowrap">
            <TextInput placeholder="Name" aria-label="Series name" value={r.name} onChange={(e) => setRow(i, { name: e.currentTarget.value })} w={180} />
            <TextInput placeholder="Words in its titles" aria-label="Words in its titles" value={r.words} onChange={(e) => setRow(i, { words: e.currentTarget.value })} style={{ flex: 1 }} />
            <ActionIcon variant="subtle" color="gray" aria-label={`Remove ${r.name || 'this series'}`} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>
              <IconX size={14} />
            </ActionIcon>
          </Group>
        ))}
        <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setRows((x) => [...x, { name: '', words: '' }])} w="fit-content">
          Add a series
        </Button>
        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/**
 * An opened series' story order: its titles, each moved up or down into the order its story goes (Yakuza 0 first, and
 * a remake right after its original). Saved in Settings > Collection > Story orders; Remove goes back to release order.
 */
function StoryOrder(props: { opened: boolean; onClose: () => void; name: string; titles: string[]; stories: string[]; hasOne: boolean; onSaved: () => void }) {
  const { opened, onClose, name, titles, stories, hasOne, onSaved } = props;
  const queryClient = useQueryClient();
  const [list, setList] = useState<string[]>([]);
  useEffect(() => {
    if (opened) setList(titles);
    // Only on opening: the moves stay until you save or cancel.
  }, [opened]);
  const others = stories.filter((line) => {
    const bar = line.indexOf('|');
    return bar < 0 || line.slice(0, bar).trim() !== name;
  });
  const save = useMutation({
    mutationFn: (lines: string[]) => api('/settings', { method: 'PUT', json: { changes: { 'collection.seriesStoryOrder': lines } } }),
    onSuccess: (_r, lines) => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      notifySuccess(lines.length > others.length ? `${name}'s story order is saved.` : `${name} is back in release order.`);
      if (lines.length > others.length) onSaved();
      onClose();
    },
    onError: (err) => notifyError(err, "Couldn't save the story order"),
  });
  const move = (i: number, by: number) =>
    setList((l) => {
      const j = i + by;
      if (j < 0 || j >= l.length) return l;
      const next = [...l];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  return (
    <Modal opened={opened} onClose={onClose} title={`${name}: story order`} size="md">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          Move each game up or down into the order its story goes, a remake right after its original. Each game's versions on different consoles stay together, by
          release year.
        </Text>
        <ScrollArea h={320} type="auto">
          <Stack gap={2}>
            {list.map((t, i) => (
              <Group key={t} gap={4} wrap="nowrap">
                <Text size="sm" w={28} c="dimmed" ta="right">
                  {i + 1}.
                </Text>
                <Text size="sm" style={{ flex: 1, minWidth: 0 }} truncate>
                  {t}
                </Text>
                <ActionIcon variant="subtle" color="gray" aria-label={`Move ${t} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                  <IconArrowUp size={14} />
                </ActionIcon>
                <ActionIcon variant="subtle" color="gray" aria-label={`Move ${t} down`} disabled={i === list.length - 1} onClick={() => move(i, 1)}>
                  <IconArrowDown size={14} />
                </ActionIcon>
              </Group>
            ))}
          </Stack>
        </ScrollArea>
        <Group justify="space-between">
          {hasOne ? (
            <Button variant="subtle" color="red" onClick={() => save.mutate(others)} loading={save.isPending}>
              Remove the story order
            </Button>
          ) : (
            <span />
          )}
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => save.mutate([...others, `${name} | ${JSON.stringify(list)}`])} loading={save.isPending}>
              Save
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
