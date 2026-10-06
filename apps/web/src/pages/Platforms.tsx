import { REGION_LABELS, type Region } from '@squirrelcade/core';
import { Anchor, Badge, Group, Progress, SegmentedControl, Table, Text, Tooltip } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { api } from '../api';
import { PageHeader, SortableTh, type SortDirection } from '../components';
import { count, date, wholeMoney } from '../format';
import { useFeature, useSetting } from '../hooks';
import { TimelinePanel } from './History';

interface PlatformRow {
  id: number;
  key: string;
  name: string;
  source: 'builtin' | 'auto' | 'user';
  games: number;
  copies: number;
  valueCents: number;
  /** Its value at the previous update, and that update's date (null without one). */
  valueBeforeCents: number | null;
  valueSince: string | null;
  eligible: boolean;
  labels: { label: string; region: Region }[];
}

/** The columns the platforms table sorts by, and which way each sorts first (names A to Z, numbers biggest first). */
const COLUMNS = { name: 'asc', games: 'desc', copies: 'desc', value: 'desc', tracked: 'desc', complete: 'desc' } as const satisfies Record<string, SortDirection>;
type Column = keyof typeof COLUMNS;

/** Every platform in the collection: games, copies, value, whether it's tracked, and its completion; click a heading to sort by it. */
export function PlatformsPage() {
  const currency = useSetting('general.currency', 'USD');
  const dateFormat = useSetting('general.dateFormat', 'us');
  const minGames = useSetting('platforms.minUniqueGames', 6);
  const { data } = useQuery({ queryKey: ['platforms'], queryFn: () => api<PlatformRow[]>('/platforms') });
  const catalogs = useQuery({
    queryKey: ['catalogs', 'summary'],
    queryFn: () => api<{ key: string; percent: number; owned: number; targets: number; excluded: number; review: number; unconfirmed: number; upcoming: number }[]>('/catalogs'),
  });
  const completion = new Map(catalogs.data?.map((c) => [c.key, c]));
  // The sort lives in the address (?sort=value&dir=asc), so it survives a reload and the back button.
  const [params, setParams] = useSearchParams();
  const by: Column = (params.get('sort') ?? '') in COLUMNS ? (params.get('sort') as Column) : 'games';
  const direction: SortDirection = params.get('dir') === 'asc' || params.get('dir') === 'desc' ? (params.get('dir') as SortDirection) : COLUMNS[by];
  const sortBy = (column: Column) => setParams({ sort: column, dir: column === by ? (direction === 'asc' ? 'desc' : 'asc') : COLUMNS[column] }, { replace: true });
  const heading = (column: Column, label: string, ta?: 'right') => <SortableTh label={label} active={by === column} direction={direction} onSort={() => sortBy(column)} ta={ta} />;
  const value = (p: PlatformRow): number | string | null =>
    by === 'name' ? p.name : by === 'copies' ? p.copies : by === 'value' ? p.valueCents : by === 'tracked' ? Number(p.eligible) : by === 'complete' ? (completion.get(p.key)?.percent ?? null) : p.games;
  const rows = (data ?? [])
    .filter((p) => p.games > 0)
    .sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      // Platforms without a completion figure stay at the bottom either way.
      if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
      const order = typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number);
      return (direction === 'asc' ? order : -order) || b.games - a.games || a.name.localeCompare(b.name);
    });
  // On a phone the table keeps platform, games and completion.
  const narrow = useMediaQuery('(max-width: 48em)');
  // The timeline of consoles and landmark games (with Top 100 lists and history on, Settings > Features).
  const historyOn = useFeature('history');
  const timeline = historyOn && params.get('view') === 'timeline';

  return (
    <>
      <PageHeader help="catalogs"
        title="Platforms"
        description={
          <>
            A platform is tracked (gets a catalog and completion tracking) once you own at least {minGames} different games for it. Change this in{' '}
            <Anchor component={Link} to="/settings/platforms" size="sm">
              Settings › Platforms
            </Anchor>
            .
          </>
        }
        actions={
          historyOn ? (
            <SegmentedControl
              size="xs"
              value={timeline ? 'timeline' : 'consoles'}
              onChange={(v) => setParams(v === 'timeline' ? { view: 'timeline' } : {}, { replace: true })}
              data={[
                { value: 'consoles', label: 'Your consoles' },
                { value: 'timeline', label: 'Timeline' },
              ]}
              aria-label="What to show"
            />
          ) : undefined
        }
      />
      {timeline ? (
        <TimelinePanel />
      ) : (
      <>
      <Table.ScrollContainer minWidth={narrow ? 0 : 700}>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              {heading('name', 'Platform')}
              {heading('games', 'Games', 'right')}
              {!narrow && heading('copies', 'Copies', 'right')}
              {!narrow && heading('value', 'Value', 'right')}
              {!narrow && heading('tracked', 'Tracked')}
              {heading('complete', 'Complete')}
              {!narrow && <Table.Th>PriceCharting names</Table.Th>}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((p) => (
              <Table.Tr key={p.id}>
                <Table.Td>
                  <Group gap={6}>
                    <Anchor component={Link} to={completion.has(p.key) ? `/platforms/${p.key}` : `/collection?platform=${p.key}`} fw={500}>
                      {p.name}
                    </Anchor>
                    {p.source === 'auto' && (
                      <Tooltip label="Not a console Squirrelcade knew; created from the name in your export.">
                        <Badge size="xs" color="yellow" variant="light">
                          new
                        </Badge>
                      </Tooltip>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td ta="right">{count(p.games)}</Table.Td>
                {!narrow && <Table.Td ta="right">{count(p.copies)}</Table.Td>}
                {!narrow && (
                  <Table.Td ta="right">
                    {wholeMoney(p.valueCents, currency)}
                    {p.valueBeforeCents !== null && p.valueSince && Math.abs(p.valueCents - p.valueBeforeCents) >= 100 && (
                      <Tooltip label={`Since the update of ${date(p.valueSince, dateFormat)}: copies added or removed, and prices`}>
                        <Text size="xs" c={p.valueCents > p.valueBeforeCents ? 'teal' : 'red'}>
                          {p.valueCents > p.valueBeforeCents ? '+' : '−'}
                          {wholeMoney(Math.abs(p.valueCents - p.valueBeforeCents), currency)}
                        </Text>
                      </Tooltip>
                    )}
                  </Table.Td>
                )}
                {!narrow && (
                  <Table.Td>
                    {p.eligible ? (
                      <Badge color="green" variant="light">
                        Yes
                      </Badge>
                    ) : (
                      <Text size="sm" c="dimmed">
                        Needs {minGames - p.games} more
                      </Text>
                    )}
                  </Table.Td>
                )}
                <Table.Td miw={narrow ? undefined : 150}>
                  {completion.has(p.key) ? (
                    <Group gap={6} wrap="nowrap">
                      <Tooltip label={completionTip(completion.get(p.key)!)}>
                        <Anchor component={Link} to={`/platforms/${p.key}`} underline="never">
                          <Group gap={6} wrap="nowrap">
                            <Progress aria-label={`${p.name} complete`} value={completion.get(p.key)!.percent} w={narrow ? 40 : 70} size="sm" color={completion.get(p.key)!.percent >= 90 ? 'green' : 'forest'} />
                            <Text size="sm">{completion.get(p.key)!.percent}%</Text>
                          </Group>
                        </Anchor>
                      </Tooltip>
                      {/*
                        Most of a catalog not known to be physical (a Switch list without IGDB, say): its percentage counts
                        only the rest, so it says how many wait, where they are, and what tells them apart.
                      */}
                      {completion.get(p.key)!.unconfirmed > completion.get(p.key)!.targets / 2 && (
                        <Tooltip
                          multiline
                          w={300}
                          label="Wikipedia's list of this console's games mixes in download-only ones, so these aren't counted until something shows they came out physically. IGDB (free keys, Settings › Features) knows most of them; a copy on your shelf, It's physical, or your own list settle the rest."
                        >
                          <Anchor component={Link} to={`/platforms/${p.key}?tab=unconfirmed`} underline="never">
                            <Badge size="sm" color="yellow" variant="light" tt="none">
                              {count(completion.get(p.key)!.unconfirmed)} not confirmed
                            </Badge>
                          </Anchor>
                        </Tooltip>
                      )}
                    </Group>
                  ) : (
                    <Text size="sm" c="dimmed">
                      {p.eligible ? 'No catalog yet' : '—'}
                    </Text>
                  )}
                </Table.Td>
                {!narrow && (
                  <Table.Td>
                    <Group gap={4}>
                      {p.labels.map((l) => (
                        <Tooltip key={l.label} label={REGION_LABELS[l.region] ?? l.region}>
                          <Badge size="sm" variant="outline" color="gray" tt="none">
                            {l.label}
                          </Badge>
                        </Tooltip>
                      ))}
                    </Group>
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {data && rows.length === 0 && (
        <Text c="dimmed" ta="center" mt="md">
          Consoles appear here once your first games are in: from an export (Stash updates), or added by hand (Add a game).
        </Text>
      )}
      </>
      )}
    </>
  );
}

function completionTip(c: { owned: number; targets: number; excluded: number; review: number; unconfirmed: number; upcoming: number }): string {
  const counted = c.targets - c.excluded - c.unconfirmed - c.upcoming;
  return [
    `${count(c.owned)} of ${count(counted)} catalog games owned`,
    c.review > 0 && `${count(c.review)} to review`,
    c.unconfirmed > 0 && `${count(c.unconfirmed)} not confirmed physical`,
    c.upcoming > 0 && `${count(c.upcoming)} upcoming`,
  ]
    .filter(Boolean)
    .join(', ');
}
