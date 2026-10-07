import { Anchor, Badge, Button, Card, Group, Loader, Table, Text } from '@mantine/core';
import { IconCalendar } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { PageHeader, type SortDirection } from '../components';
import { sortRows, useSort } from '../sort';
import { count, releaseDate } from '../format';
import { useSetting } from '../hooks';
import { GameTitle } from '../GameDrawer';
import { PreferencePicker, preferenceLevels } from '../Preference';
import { Acorns, Reviews, StashMark, type ReviewsOf } from '../Acorn';

/** A game not out yet (GET /api/v1/catalogs/upcoming). */
interface Upcoming {
  entryId: number;
  platformKey: string;
  platform: string;
  title: string;
  releaseDate: string;
  format: string | null;
  status: string;
  score: number | null;
  /** IGDB's rating, beside its acorns (0.53.0). */
  reviews?: ReviewsOf;
  /** Your wishlist preference for it. */
  preference: string | null;
}

const STATUS: Record<string, { label: string; color: string }> = {
  owned: { label: 'Owned', color: 'teal' },
  missing: { label: 'Missing', color: 'gray' },
  review: { label: 'To review', color: 'yellow' },
  unconfirmed: { label: 'Not confirmed physical', color: 'orange' },
  upcoming: { label: 'Not counted yet', color: 'gray' },
};

/** The list's sorts and which way each goes first (D144): release dates soonest first, as the list comes; words A to Z; yours first; acorns and reviews most first; preferences most wanted first. */
const SORTS = { release: 'asc', title: 'asc', platform: 'asc', you: 'desc', acorns: 'desc', reviews: 'desc', preference: 'asc' } as const satisfies Record<string, SortDirection>;

/** "2026-10-06" -> "October 2026"; "TBA" and years alone as they are. */
function monthOf(date: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(date);
  if (!m) return /^\d{4}$/.test(date) ? date : 'Date to be announced';
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 15)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Coming soon: the games not out yet on the consoles you collect, soonest first and grouped by month, with
 * whether you already have a copy (a pre-order in your export) and the wishlist's score.
 */
export function ComingSoonPage() {
  const dateFormat = useSetting('general.dateFormat', 'us');
  const points = useSetting('wishlist.preferencePoints', {});
  const [platform, setPlatform] = useState<string | null>(null);
  // A heading sorts each month's games by its column; the months stay soonest first.
  const sorting = useSort(SORTS, 'release');
  const list = useQuery({ queryKey: ['catalogs', 'upcoming'], queryFn: () => api<Upcoming[]>('/catalogs/upcoming') });
  const all = list.data ?? [];
  const consoles = [...new Map(all.map((g) => [g.platformKey, g.platform])).entries()];
  const shown = all.filter((g) => !platform || g.platformKey === platform);
  const groups: [string, Upcoming[]][] = [];
  for (const g of shown) {
    const month = monthOf(g.releaseDate);
    if (groups.at(-1)?.[0] !== month) groups.push([month, []]);
    groups.at(-1)![1].push(g);
  }
  // Each preference's place, most wanted first.
  const places = new Map(preferenceLevels(points).map((l, i) => [l.value, i]));
  // A release that's only "TBA" has no date to sort by.
  const sortValue = (g: Upcoming) =>
    ({ release: /^\d{4}/.test(g.releaseDate) ? g.releaseDate : null, title: g.title, platform: g.platform, you: g.status === 'owned', acorns: g.score, reviews: g.reviews?.rating, preference: places.get(g.preference ?? '') })[sorting.by];

  return (
    <>
      <PageHeader help="wishlist"
        title="Coming soon"
        actions={
          all.length > 0 ? (
            <Button component="a" href="/api/v1/catalogs/upcoming.ics" variant="default" leftSection={<IconCalendar size={16} />}>
              Calendar file
            </Button>
          ) : undefined
        }
        description={
          <>
            Games not out yet on the consoles you collect, from your lists and the catalogs' sources, soonest first. Whether they count as missing before they're out is{' '}
            <Anchor component={Link} to="/settings/catalogs" size="sm">
              a setting
            </Anchor>
            .
          </>
        }
      />
      {list.isLoading ? (
        <Loader />
      ) : all.length === 0 ? (
        <Card withBorder>
          <Text size="sm">No upcoming games in your consoles' catalogs.</Text>
        </Card>
      ) : (
        <>
          {consoles.length > 1 && (
            <Group gap={6} mb="sm">
              <Badge component="button" size="lg" variant={platform === null ? 'filled' : 'light'} style={{ cursor: 'pointer', textTransform: 'none' }} onClick={() => setPlatform(null)}>
                Every console {count(all.length)}
              </Badge>
              {consoles.map(([key, name]) => (
                <Badge
                  key={key}
                  component="button"
                  size="lg"
                  variant={platform === key ? 'filled' : 'light'}
                  color="gray"
                  style={{ cursor: 'pointer', textTransform: 'none' }}
                  onClick={() => setPlatform(platform === key ? null : key)}
                >
                  {name} {count(all.filter((g) => g.platformKey === key).length)}
                </Badge>
              ))}
            </Group>
          )}
          <Card withBorder p={0}>
            <Table highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  {sorting.th('release', 'Release', { w: 120 })}
                  {sorting.th('title', 'Game')}
                  {sorting.th('platform', 'Console', { visibleFrom: 'sm' })}
                  {sorting.th('you', 'You')}
                  {sorting.th('acorns', 'Acorns', { ta: 'right', visibleFrom: 'sm' })}
                  {sorting.th('reviews', 'Reviews', { ta: 'right', visibleFrom: 'sm' })}
                  {sorting.th('preference', 'Your preference', { visibleFrom: 'sm' })}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {groups.map(([month, games]) => [
                  <Table.Tr key={month}>
                    <Table.Td colSpan={7} bg="var(--mantine-color-default-hover)">
                      <Text size="sm" fw={600}>
                        {month}
                      </Text>
                    </Table.Td>
                  </Table.Tr>,
                  ...sortRows(games, sortValue, sorting.dir).map((g) => (
                    <Table.Tr key={`${g.platformKey}|${g.entryId}`}>
                      <Table.Td>
                        <Text size="sm">{/^\d{4}/.test(g.releaseDate) ? releaseDate(g.releaseDate, dateFormat) : g.releaseDate}</Text>
                      </Table.Td>
                      <Table.Td>
                        <GameTitle platformKey={g.platformKey} title={g.title} />
                        {g.format && /game[\s-]*key/i.test(g.format) && (
                          <Badge size="xs" variant="light" color="cyan" ml={6} style={{ textTransform: 'none' }}>
                            Game-Key Card
                          </Badge>
                        )}
                        <Text size="xs" c="dimmed" hiddenFrom="sm">
                          {g.platform}
                        </Text>
                      </Table.Td>
                      <Table.Td visibleFrom="sm">
                        <Text size="sm">{g.platform}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge size="sm" variant="light" color={STATUS[g.status]?.color ?? 'gray'} style={{ textTransform: 'none' }} leftSection={g.status === 'owned' ? <StashMark size={11} /> : undefined}>
                          {STATUS[g.status]?.label ?? g.status}
                        </Badge>
                      </Table.Td>
                      <Table.Td ta="right" visibleFrom="sm">
                        <Text size="sm" c={g.score === null ? 'dimmed' : undefined}>
                          {g.score !== null ? <Acorns n={g.score} /> : '—'}
                        </Text>
                      </Table.Td>
                      <Table.Td ta="right" visibleFrom="sm">
                        <Text size="sm" c={g.reviews ? undefined : 'dimmed'}>
                          {g.reviews ? <Reviews r={g.reviews} /> : '—'}
                        </Text>
                      </Table.Td>
                      <Table.Td visibleFrom="sm">
                        <PreferencePicker platformKey={g.platformKey} title={g.title} value={g.preference} width={170} />
                      </Table.Td>
                    </Table.Tr>
                  )),
                ])}
              </Table.Tbody>
            </Table>
          </Card>
        </>
      )}
    </>
  );
}
