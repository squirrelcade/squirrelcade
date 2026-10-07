import { PLAY_STATUSES, type PlayStatus } from '@squirrelcade/core';
import { Badge, Button, Card, Group, Loader, Pagination, Select, Stack, Table, Tabs, Text, TextInput } from '@mantine/core';
import { useDebouncedValue, useMediaQuery } from '@mantine/hooks';
import { IconDice5, IconPlayerPlay, IconSearch } from '@tabler/icons-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../api';
import { PageHeader, type SortDirection } from '../components';
import { count } from '../format';
import { GameCover, GameTitle } from '../GameDrawer';
import { notifySuccess, useCanEdit, useSetting } from '../hooks';
import { PlayBadge, PlayPicker, useSetPlay } from '../Playing';
import { sortRows, useSort } from '../sort';
import { useCollectionSummary } from './Collection';

/** An owned game and where the owner is with it (GET /api/v1/play). */
interface PlayGame {
  platformKey: string;
  platform: string;
  title: string;
  coverId: string | null;
  status: PlayStatus | null;
  rating: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  igdbRating: number | null;
}

interface PlayList {
  status: string;
  counts: Record<string, number>;
  total: number;
  items: PlayGame[];
}

/** The tabs: the backlog first, then each status, games not marked, and the ones you rated. */
const TABS: { value: string; label: string }[] = [
  { value: 'backlog', label: 'Backlog' },
  ...PLAY_STATUSES.filter((s) => s.value !== 'backlog').map((s) => ({ value: s.value, label: s.short })),
  { value: 'unmarked', label: 'Not marked' },
  { value: 'rated', label: 'Rated' },
];

/** The backlog's headings sort it (D144): games A to Z, your ratings highest first. */
const SORTS = { title: 'asc', rating: 'desc' } as const satisfies Record<string, SortDirection>;

/** "What to play next": one game from the backlog, with a button to start it and one for another pick. */
function NextPick({ platform, canEdit }: { platform: string; canEdit: boolean }) {
  const [round, setRound] = useState(0);
  const pick = useQuery({
    // Its own key, so saving a game's status (which refreshes the lists) doesn't draw another game.
    queryKey: ['play-next', platform, round],
    queryFn: () => api<{ game: PlayGame | null }>(`/play/next${platform ? `?platform=${encodeURIComponent(platform)}` : ''}`),
    enabled: round > 0,
  });
  const save = useSetPlay();
  const game = pick.data?.game;
  return (
    <Card withBorder mb="md" padding="md">
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
        <Stack gap={4} maw={520}>
          <Text fw={600}>What to play next</Text>
          <Text size="sm" c="dimmed">
            A game from your backlog, picked at random but leaning toward the ones IGDB rates well.
          </Text>
        </Stack>
        <Button leftSection={<IconDice5 size={16} />} variant="light" onClick={() => setRound((r) => r + 1)} loading={pick.isFetching}>
          {round === 0 ? 'Pick one' : 'Another'}
        </Button>
      </Group>
      {round > 0 && pick.data && (
        <Group mt="md" gap="md" wrap="nowrap" align="flex-start">
          {game ? (
            <>
              <GameCover platformKey={game.platformKey} title={game.title} id={game.coverId} width={70} placeholder />
              <Stack gap={4}>
                <GameTitle platformKey={game.platformKey} title={game.title} fw={600} size="md" />
                <Text size="sm" c="dimmed">
                  {[game.platform, game.igdbRating !== null ? `IGDB ${Math.round(game.igdbRating)}` : null].filter(Boolean).join(' · ')}
                </Text>
                {canEdit && (
                  <Group gap="xs">
                    <Button
                      size="compact-sm"
                      leftSection={<IconPlayerPlay size={14} />}
                      loading={save.isPending}
                      onClick={() => save.mutate({ platformKey: game.platformKey, title: game.title, status: 'playing' }, { onSuccess: () => notifySuccess(`Playing ${game.title} now.`) })}
                    >
                      Start playing
                    </Button>
                    <Button
                      size="compact-sm"
                      variant="subtle"
                      color="gray"
                      loading={save.isPending}
                      onClick={() => save.mutate({ platformKey: game.platformKey, title: game.title, status: 'shelf' }, { onSuccess: () => setRound((r) => r + 1) })}
                    >
                      Just for the shelf
                    </Button>
                  </Group>
                )}
              </Stack>
            </>
          ) : (
            <Text size="sm">Nothing waits in your backlog{platform ? ' on this console' : ''}.</Text>
          )}
        </Group>
      )}
    </Card>
  );
}

/**
 * Collection > Backlog: the games you own and haven't played yet, what you're playing, and what you finished,
 * dropped or keep for the shelf, with your rating. "What to play next" picks one from the backlog.
 */
export function BacklogPage() {
  const [params, setParams] = useSearchParams();
  const canEdit = useCanEdit();
  const dateFormat = useSetting('general.dateFormat', 'us');
  const pageSize = useSetting('interface.pageSize', 100);
  const narrow = useMediaQuery('(max-width: 48em)');
  const summary = useCollectionSummary();
  const status = params.get('status') ?? 'backlog';
  const platform = params.get('platform') ?? '';
  const page = Number(params.get('page') ?? 1);
  const sorting = useSort(SORTS, 'title');
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [debounced] = useDebouncedValue(search, 250);
  const query = new URLSearchParams({ status });
  if (platform) query.set('platform', platform);
  if (debounced) query.set('q', debounced);
  const list = useQuery({ queryKey: ['play', 'list', query.toString()], queryFn: () => api<PlayList>(`/play?${query}`), placeholderData: keepPreviousData });

  function set(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  }

  // The server sends every game in the tab: sorted here, then paged.
  const items = sortRows(list.data?.items ?? [], (g) => (sorting.by === 'rating' ? g.rating : g.title), sorting.dir);
  const shown = items.slice((page - 1) * pageSize, page * pageSize);
  return (
    <>
      <PageHeader
        help="playing"
        title="Backlog"
        description="What you've played of the games you own. Mark a game in its drawer, or here."
      />
      <NextPick platform={platform} canEdit={canEdit} />
      <Tabs value={status} onChange={(v) => set('status', v === 'backlog' ? '' : (v ?? ''))} mb="sm">
        <Tabs.List>
          {TABS.map((t) => (
            <Tabs.Tab key={t.value} value={t.value} rightSection={list.data ? <Badge size="xs" variant="light" color="gray">{count(list.data.counts[t.value] ?? 0)}</Badge> : undefined}>
              {t.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>
      <Group mb="sm" gap="sm">
        <TextInput
          placeholder="Search titles"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => {
            setSearch(e.currentTarget.value);
            set('q', e.currentTarget.value);
          }}
          w={240}
        />
        <Select
          aria-label="Platform"
          placeholder="All platforms"
          data={(summary.data?.platforms ?? []).map((p) => ({ value: p.key, label: p.name }))}
          value={platform || null}
          onChange={(v) => set('platform', v ?? '')}
          clearable
          searchable
          w={220}
        />
        {list.isFetching && <Loader size="xs" />}
      </Group>
      <Table.ScrollContainer minWidth={narrow ? 0 : 640}>
        <Table striped verticalSpacing={6}>
          <Table.Thead>
            <Table.Tr>
              {sorting.th('title', 'Game')}
              {sorting.th('rating', canEdit ? 'Played, and your rating' : 'Played')}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {shown.map((g) => (
              <Table.Tr key={`${g.platformKey}|${g.title}`}>
                <Table.Td>
                  <Group gap="sm" wrap="nowrap">
                    <GameCover platformKey={g.platformKey} title={g.title} id={g.coverId} placeholder={shown.some((x) => x.coverId)} />
                    <div>
                      <GameTitle platformKey={g.platformKey} title={g.title} fw={500} />
                      <Text size="xs" c="dimmed">
                        {[g.platform, g.igdbRating !== null ? `IGDB ${Math.round(g.igdbRating)}` : null].filter(Boolean).join(' · ')}
                      </Text>
                    </div>
                  </Group>
                </Table.Td>
                <Table.Td>
                  {canEdit ? (
                    <PlayPicker platformKey={g.platformKey} title={g.title} play={g} canEdit dateFormat={dateFormat} compact />
                  ) : (
                    <PlayBadge play={g} />
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {list.data && items.length === 0 && (
        <Text c="dimmed" ta="center" mt="md">
          {status === 'backlog' ? 'Nothing waits in your backlog.' : 'No games here.'}
        </Text>
      )}
      {items.length > pageSize && (
        <Group justify="center" mt="md">
          <Pagination total={Math.ceil(items.length / pageSize)} value={page} onChange={(p) => set('page', String(p))} />
        </Group>
      )}
      {list.data && (
        <Text size="xs" c="dimmed" ta="center" mt="xs">
          {count(list.data.total)} games
        </Text>
      )}
    </>
  );
}
