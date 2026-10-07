import { Anchor, Badge, Card, Group, Loader, SegmentedControl, Stack, Table, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { PageHeader, type SortDirection } from '../components';
import { sortRows, useSort } from '../sort';
import { count, date, releaseDate } from '../format';
import { GameCover, GameTitle, PriceLinks } from '../GameDrawer';
import { PreferencePicker, preferenceLevels } from '../Preference';
import { useSetting } from '../hooks';
import { Acorns, Reviews, StashMark, type ReviewsOf } from '../Acorn';

/** A past year's releases around this time (GET /api/v1/catalogs/past). */
interface PastYear {
  yearsAgo: number;
  from: string;
  to: string;
  games: PastGame[];
}

interface PastGame {
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
  coverId: string | null;
  /** Your wishlist preference for it. */
  preference: string | null;
}

const STATUS: Record<string, { label: string; color: string }> = {
  owned: { label: 'Owned', color: 'teal' },
  missing: { label: 'Missing', color: 'gray' },
  review: { label: 'To review', color: 'yellow' },
  unconfirmed: { label: 'Not confirmed physical', color: 'orange' },
};

const yearsAgo = (n: number) => `${n} year${n === 1 ? '' : 's'} ago`;

/** Each year's sorts and which way each goes first (D144): release dates oldest first, as the list comes; titles A to Z; yours first; acorns and reviews most first; preferences most wanted first. */
const SORTS = { released: 'asc', title: 'asc', you: 'desc', acorns: 'desc', reviews: 'desc', preference: 'asc' } as const satisfies Record<string, SortDirection>;

/**
 * Past releases: the games that came out around this time of year in each of the last few years, on the consoles
 * you collect, since a game a year or more old often costs less than at release. Each has links to its prices
 * (PriceCharting, and the shop links for its console).
 */
export function PastReleasesPage() {
  const dateFormat = useSetting('general.dateFormat', 'us');
  const points = useSetting('wishlist.preferencePoints', {});
  const [show, setShow] = useState<'missing' | 'all'>('missing');
  // A heading sorts each year's games by its column; By date and By acorns are two of them.
  const sorting = useSort(SORTS, 'released');
  const [platform, setPlatform] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['catalogs', 'past'], queryFn: () => api<PastYear[]>('/catalogs/past') });
  const years = list.data ?? [];
  const wanted = (g: PastGame) => (show === 'all' || g.status !== 'owned') && (!platform || g.platformKey === platform);
  const listed = years.flatMap((y) => y.games).filter((g) => show === 'all' || g.status !== 'owned');
  const consoles = [...new Map(listed.map((g) => [g.platformKey, g.platform])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  // Each preference's place, most wanted first.
  const places = new Map(preferenceLevels(points).map((l, i) => [l.value, i]));
  const sorted = (games: PastGame[]) =>
    sortRows(games, (g) => ({ released: g.releaseDate, title: g.title, you: g.status === 'owned', acorns: g.score, reviews: g.reviews?.rating, preference: places.get(g.preference ?? '') })[sorting.by], sorting.dir);

  return (
    <>
      <PageHeader help="wishlist"
        title="Past releases"
        description={
          <>
            Games that came out around this time of year in past years, on the consoles you collect: a game a year or more old often costs less than it did at release. How many years back, and how
            wide "around this time" is, are{' '}
            <Anchor component={Link} to="/settings/interface" size="sm">
              settings
            </Anchor>
            .
          </>
        }
      />
      {list.isLoading ? (
        <Loader />
      ) : (
        <Stack gap="md">
          <Group gap="sm" wrap="wrap">
            <SegmentedControl
              size="xs"
              value={show}
              onChange={(v) => setShow(v as 'missing' | 'all')}
              data={[
                { value: 'missing', label: "Games you don't have" },
                { value: 'all', label: 'Every game' },
              ]}
            />
            <SegmentedControl
              size="xs"
              value={sorting.by === 'acorns' ? 'score' : sorting.by === 'released' ? 'date' : ''}
              onChange={(v) => (v === 'score' ? sorting.set('acorns', SORTS.acorns) : sorting.set('released', SORTS.released))}
              data={[
                { value: 'date', label: 'By date' },
                { value: 'score', label: 'By acorns' },
              ]}
            />
          </Group>
          {consoles.length > 1 && (
            <Group gap={6}>
              <Badge component="button" size="lg" variant={platform === null ? 'filled' : 'light'} style={{ cursor: 'pointer', textTransform: 'none' }} onClick={() => setPlatform(null)}>
                Every console {count(listed.length)}
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
                  {name} {count(listed.filter((g) => g.platformKey === key).length)}
                </Badge>
              ))}
            </Group>
          )}
          {years.map((y) => {
            const games = sorted(y.games.filter(wanted));
            return (
              <Card key={y.yearsAgo} withBorder p={0}>
                <Group justify="space-between" px="md" py="xs" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
                  <Text fw={600}>
                    {yearsAgo(y.yearsAgo)}{' '}
                    <Text span size="sm" c="dimmed" fw={400}>
                      {date(y.from, dateFormat)} to {date(y.to, dateFormat)}
                    </Text>
                  </Text>
                  <Text size="sm" c="dimmed">
                    {count(games.length)} {games.length === 1 ? 'game' : 'games'}
                  </Text>
                </Group>
                {games.length === 0 ? (
                  <Text size="sm" c="dimmed" px="md" py="sm">
                    {show === 'missing' ? "Nothing you don't have came out on your consoles in those weeks." : 'Nothing with a release date came out on your consoles in those weeks.'}
                  </Text>
                ) : (
                  <Table.ScrollContainer minWidth={800}>
                    <Table highlightOnHover>
                      <Table.Thead>
                        <Table.Tr>
                          {sorting.th('released', 'Released', { w: 110 })}
                          {sorting.th('title', 'Game')}
                          {sorting.th('you', 'You')}
                          {sorting.th('acorns', 'Acorns', { ta: 'right' })}
                          {sorting.th('reviews', 'Reviews', { ta: 'right' })}
                          {sorting.th('preference', 'Your preference')}
                          <Table.Th>Prices</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {games.map((g) => {
                          const status = STATUS[g.status];
                          return (
                            <Table.Tr key={`${g.platformKey}|${g.entryId}`}>
                              <Table.Td>
                                <Text size="sm">{releaseDate(g.releaseDate, dateFormat)}</Text>
                              </Table.Td>
                              <Table.Td>
                                <Group gap="sm" wrap="nowrap" align="flex-start">
                                  <GameCover platformKey={g.platformKey} title={g.title} id={g.coverId} width={24} placeholder={games.some((x) => x.coverId)} />
                                  <div>
                                    <GameTitle platformKey={g.platformKey} title={g.title} />
                                    {g.format && /game[\s-]*key/i.test(g.format) && (
                                      <Badge size="xs" variant="light" color="cyan" ml={6} style={{ textTransform: 'none' }}>
                                        Game-Key Card
                                      </Badge>
                                    )}
                                    <Text size="xs" c="dimmed">
                                      {g.platform}
                                    </Text>
                                  </div>
                                </Group>
                              </Table.Td>
                              <Table.Td>
                                {status ? (
                                  <Badge size="sm" variant="light" color={status.color} style={{ textTransform: 'none' }} leftSection={g.status === 'owned' ? <StashMark size={11} /> : undefined}>
                                    {status.label}
                                  </Badge>
                                ) : (
                                  <Text size="sm">{g.status}</Text>
                                )}
                              </Table.Td>
                              <Table.Td ta="right">
                                <Text size="sm">{g.score !== null ? <Acorns n={g.score} /> : '—'}</Text>
                              </Table.Td>
                              <Table.Td ta="right">
                                <Text size="sm" c={g.reviews ? undefined : 'dimmed'}>
                                  {g.reviews ? <Reviews r={g.reviews} /> : '—'}
                                </Text>
                              </Table.Td>
                              <Table.Td>
                                <PreferencePicker platformKey={g.platformKey} title={g.title} value={g.preference} width={170} />
                              </Table.Td>
                              <Table.Td>
                                <PriceLinks platformKey={g.platformKey} platform={g.platform} title={g.title} />
                              </Table.Td>
                            </Table.Tr>
                          );
                        })}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                )}
              </Card>
            );
          })}
        </Stack>
      )}
    </>
  );
}
