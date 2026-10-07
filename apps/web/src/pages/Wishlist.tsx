import { ActionIcon, Alert, Anchor, Badge, Button, Card, Group, Loader, Menu, Select, Stack, Table, Tabs, Text, TextInput, Tooltip } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconChevronDown, IconChevronRight, IconClock, IconDownload, IconSearch } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../api';
import { PageHeader, type SortDirection } from '../components';
import { sortRows, useSort } from '../sort';
import { count, date, dateTime } from '../format';
import { notifyError, useCanEdit, useSetting, useSettingsState } from '../hooks';
import { GameCover, GameTitle } from '../GameDrawer';
import { PreferencePicker, preferenceLevels } from '../Preference';
import { monthsFromNow, SNOOZES } from '../choices';
import { ShareButton } from '../ShareLinks';
import { GameOfTheDayCard } from './GameOfTheDay';
import { Acorn, Acorns, Reviews, type ReviewsOf } from '../Acorn';

interface Entry {
  platformKey: string;
  platform: string;
  title: string;
  score: number;
  priority: 'High' | 'Medium' | 'Low';
  components: { label: string; points: number }[];
  flags: string[];
  franchise: string;
  preference: string | null;
  ownedOn: string[];
  /** PC storefronts where the same game is owned for good. */
  ownedOnPc?: string[];
  coverId: string | null;
  /** IGDB's rating, beside its acorns (0.53.0). */
  reviews?: ReviewsOf;
  rank?: number;
  masterScore?: number;
  consolePenalty?: number;
  franchisePenalty?: number;
}

interface Overview {
  generatedAt: string;
  counts: { candidates: number; scored: number; hidden: number };
  platforms: { key: string; name: string; candidates: number }[];
  snoozed: { platformKey: string; platform: string; title: string; until: string }[];
  master: Entry[];
}


function useSnooze() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: { platformKey: string; title: string; until: string | null }) => api('/wishlist/snooze', { method: 'PUT', json: v }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['wishlist'] }),
    onError: (err) => notifyError(err),
  });
}

const PRIORITY_COLORS = { High: 'green', Medium: 'yellow', Low: 'gray' } as const;

/** The wishlist's sorts and which way each goes first (D144): the rank from the top, words A to Z, acorns, reviews and priority most first, preferences most wanted first. */
const SORTS = { rank: 'asc', title: 'asc', platform: 'asc', acorns: 'desc', reviews: 'desc', priority: 'desc', preference: 'asc' } as const satisfies Record<string, SortDirection>;

/** The wishlist: the top picks and each console's list, every score explained point by point, with snoozes and preferences. */
export function WishlistPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'top';
  const platform = params.get('platform') ?? '';
  const dateFormat = useSetting('general.dateFormat', 'us');
  const overview = useQuery({ queryKey: ['wishlist'], queryFn: () => api<Overview>('/wishlist') });
  const perPlatform = useQuery({
    queryKey: ['wishlist', 'platform', platform],
    queryFn: () => api<{ entries: Entry[] }>(`/wishlist/platforms/${platform}`),
    enabled: tab === 'platform' && platform !== '',
  });

  const o = overview.data;
  const snooze = useSnooze();
  const canEdit = useCanEdit();
  return (
    <>
      <PageHeader help="wishlist"
        title={
          <>
            Acorns wishlist <Acorn size={24} />
          </>
        }
        actions={
          <Group gap="xs">
            {canEdit && <ShareButton kind="wishlist" />}
            <Menu position="bottom-end">
              <Menu.Target>
                <Button variant="default" leftSection={<IconDownload size={16} />}>
                  Download
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item component="a" href="/api/v1/wishlist/export" download>
                  Top picks (CSV)
                </Menu.Item>
                <Menu.Item component="a" href="/api/v1/wishlist/export?list=platforms" download>
                  Each platform's list (CSV)
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        }
        description={
          o ? (
            <>
              Missing games from your catalogs, given acorns by your rules ({count(o.counts.scored)} of them, {count(o.counts.hidden)} hidden by your exclusions).
              Change the rules in{' '}
              <Anchor component={Link} to="/acorns" size="sm">
                Acorns
              </Anchor>
              . Worked out {dateTime(o.generatedAt, dateFormat)}.
            </>
          ) : undefined
        }
      />
      <GameOfTheDayCard mb="md" />
      <WithoutIgdb />
      <Tabs value={tab} onChange={(v) => setParams({ tab: v ?? 'top', ...(platform ? { platform } : {}) }, { replace: true })} mb="md">
        <Tabs.List>
          <Tabs.Tab value="top">Top picks</Tabs.Tab>
          <Tabs.Tab value="platform">By platform</Tabs.Tab>
        </Tabs.List>
      </Tabs>
      {!o ? (
        <Loader />
      ) : tab === 'top' ? (
        o.master.length === 0 ? (
          <Text c="dimmed" ta="center">
            Nothing to recommend yet. The wishlist is built from missing games in your catalogs.
          </Text>
        ) : (
          <EntryTable entries={o.master} ranked />
        )
      ) : (
        <Stack>
          <Select
            placeholder="Choose a platform"
            data={o.platforms.filter((p) => p.candidates > 0).map((p) => ({ value: p.key, label: `${p.name} (${p.candidates})` }))}
            value={platform || null}
            onChange={(v) => setParams({ tab: 'platform', ...(v ? { platform: v } : {}) }, { replace: true })}
            searchable
            w={320}
          />
          {perPlatform.isFetching && <Loader size="sm" />}
          {perPlatform.data && <EntryTable entries={perPlatform.data.entries} />}
        </Stack>
      )}
      {o && o.snoozed.length > 0 && (
        <Card withBorder mt="lg">
          <Text fw={600} size="sm" mb={6}>
            Snoozed ({o.snoozed.length})
          </Text>
          <Stack gap={4}>
            {o.snoozed.map((z) => (
              <Group key={`${z.platformKey}|${z.title}`} gap={8}>
                <Text size="sm">
                  {z.title}{' '}
                  <Text span size="xs" c="dimmed">
                    {z.platform}, until {date(z.until, dateFormat)}
                  </Text>
                </Text>
                {canEdit && (
                  <Anchor size="xs" onClick={() => snooze.mutate({ platformKey: z.platformKey, title: z.title, until: null })}>
                    wake up
                  </Anchor>
                )}
              </Group>
            ))}
          </Stack>
        </Card>
      )}
    </>
  );
}

function EntryTable({ entries: all, ranked }: { entries: Entry[]; ranked?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  // Until a heading is clicked, the top picks keep their rank and a console's list its acorns, the order they come in.
  const sorting = useSort(SORTS, ranked ? 'rank' : 'acorns');
  const points = useSetting('wishlist.preferencePoints', {});
  // Each preference's place, most wanted first.
  const places = new Map(preferenceLevels(points).map((l, i) => [l.value, i]));
  // The whole phrase anywhere ("wii u"), or every word as the start of a word ("dq swo").
  const phrase = filter.trim().toLowerCase();
  const words = phrase.split(/\s+/).filter(Boolean);
  const matches = (e: Entry) => {
    const text = `${e.title} ${e.platform} ${e.franchise ?? ''}`.toLowerCase();
    if (text.includes(phrase)) return true;
    const starts = text.split(/[^a-z0-9]+/).filter(Boolean);
    return words.every((w) => starts.some((s) => s.startsWith(w)));
  };
  const entries = sortRows(
    phrase ? all.filter(matches) : all,
    (e) => ({ rank: e.rank, title: e.title, platform: e.platform, acorns: e.masterScore ?? e.score, reviews: e.reviews?.rating, priority: { High: 3, Medium: 2, Low: 1 }[e.priority], preference: places.get(e.preference ?? '') })[sorting.by],
    sorting.dir,
  );
  const snooze = useSnooze();
  // A viewer sees the wishlist, not the snooze.
  const canEdit = useCanEdit();
  // On a phone the table keeps game, score and snooze: the platform goes under the title, the score takes the
  // priority's color, and the preference and notes are in the opened row.
  const narrow = useMediaQuery('(max-width: 48em)');
  const columns = (ranked ? 1 : 0) + (narrow ? 3 : 7);
  const preferenceSelect = (e: Entry) => <PreferencePicker platformKey={e.platformKey} title={e.title} value={e.preference} width={170} />;

  return (
    <>
    <TextInput
      placeholder="Filter by title, platform or series"
      leftSection={<IconSearch size={16} />}
      value={filter}
      onChange={(e) => setFilter(e.currentTarget.value)}
      w={320}
      mb="sm"
    />
    {entries.length === 0 && (
      <Text c="dimmed" size="sm">
        Nothing matches “{filter}”.
      </Text>
    )}
    <Table.ScrollContainer minWidth={narrow ? 0 : 760}>
      <Table verticalSpacing={6} highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            {ranked && sorting.th('rank', '#', { w: 50 })}
            {sorting.th('title', 'Game')}
            {!narrow && sorting.th('platform', 'Platform')}
            {sorting.th('acorns', 'Acorns', { ta: 'right' })}
            {!narrow && sorting.th('reviews', 'Reviews', { ta: 'right' })}
            {!narrow && sorting.th('priority', 'Priority')}
            {!narrow && sorting.th('preference', 'Your preference')}
            <Table.Th w={1} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {entries.map((e, _i, shown) => {
            const anyCover = shown.some((x) => x.coverId);
            const key = `${e.platformKey}|${e.title}`;
            const expanded = open === key;
            return (
              <Fragment key={key}>
                <Table.Tr style={{ cursor: 'pointer' }} onClick={() => setOpen(expanded ? null : key)}>
                  {ranked && <Table.Td>{e.rank}</Table.Td>}
                  <Table.Td>
                    <Group gap={6} wrap="nowrap">
                      {expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                      <GameCover platformKey={e.platformKey} title={e.title} id={e.coverId} width={24} placeholder={anyCover} />
                      <Stack gap={0}>
                        <GameTitle platformKey={e.platformKey} title={e.title} fw={500} />
                        {narrow && (
                          <Anchor size="xs" c="dimmed" component={Link} to={`/platforms/${e.platformKey}`} onClick={(ev) => ev.stopPropagation()}>
                            {e.platform}
                          </Anchor>
                        )}
                      </Stack>
                      {!narrow && e.flags.length > 0 && (
                        <Tooltip label={e.flags.join('; ')} multiline w={280}>
                          <Badge size="xs" variant="outline" color="gray" miw="max-content">
                            {e.flags.length} note{e.flags.length === 1 ? '' : 's'}
                          </Badge>
                        </Tooltip>
                      )}
                    </Group>
                  </Table.Td>
                  {!narrow && (
                    <Table.Td>
                      <Anchor size="sm" component={Link} to={`/platforms/${e.platformKey}`} onClick={(ev) => ev.stopPropagation()}>
                        {e.platform}
                      </Anchor>
                    </Table.Td>
                  )}
                  <Table.Td ta="right">
                    <Tooltip label={e.masterScore !== undefined && e.masterScore !== e.score ? `${e.score} acorns, minus ${(e.consolePenalty ?? 0) + (e.franchisePenalty ?? 0)} for variety` : 'Its acorns'}>
                      <Text size="sm" fw={600} span c={narrow ? PRIORITY_COLORS[e.priority] : undefined}>
                        <Acorns n={e.masterScore ?? e.score} />
                      </Text>
                    </Tooltip>
                  </Table.Td>
                  {!narrow && (
                    <Table.Td ta="right">
                      <Text size="sm" span c={e.reviews ? undefined : 'dimmed'}>
                        {e.reviews ? <Reviews r={e.reviews} /> : '—'}
                      </Text>
                    </Table.Td>
                  )}
                  {!narrow && (
                    <Table.Td>
                      <Badge size="sm" variant="light" color={PRIORITY_COLORS[e.priority]} miw="max-content">
                        {e.priority}
                      </Badge>
                    </Table.Td>
                  )}
                  {!narrow && <Table.Td onClick={(ev) => ev.stopPropagation()}>{preferenceSelect(e)}</Table.Td>}
                  <Table.Td onClick={(ev) => ev.stopPropagation()}>
                    {canEdit && (
                    <Menu position="bottom-end" withinPortal>
                      <Menu.Target>
                        <Tooltip label="Snooze: leave it off the wishlist for a while">
                          <ActionIcon variant="subtle" color="gray" aria-label={`Snooze ${e.title}`}>
                            <IconClock size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Label>Snooze for</Menu.Label>
                        {SNOOZES.map(([label, months]) => (
                          <Menu.Item key={label} onClick={() => snooze.mutate({ platformKey: e.platformKey, title: e.title, until: monthsFromNow(months) })}>
                            {label}
                          </Menu.Item>
                        ))}
                      </Menu.Dropdown>
                    </Menu>
                    )}
                  </Table.Td>
                </Table.Tr>
                {expanded && (
                  <Table.Tr>
                    <Table.Td colSpan={columns}>
                      {narrow && (
                        <Group gap="xs" mb="xs">
                          <Badge size="sm" variant="light" color={PRIORITY_COLORS[e.priority]}>
                            {e.priority}
                          </Badge>
                          {preferenceSelect(e)}
                        </Group>
                      )}
                      <Group align="flex-start" gap="xl" pl={narrow ? 0 : 'lg'}>
                        <Stack gap={2}>
                          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                            Where its acorns come from
                          </Text>
                          {e.components.map((c) => (
                            <Group key={c.label} gap="xs" justify="space-between" miw={280}>
                              <Text size="sm">{c.label}</Text>
                              <Text size="sm" c={c.points < 0 ? 'red' : c.points > 0 ? undefined : 'dimmed'}>
                                {c.points > 0 ? `+${c.points}` : c.points}
                              </Text>
                            </Group>
                          ))}
                          {(e.consolePenalty ?? 0) + (e.franchisePenalty ?? 0) > 0 && (
                            <Group gap="xs" justify="space-between" miw={280}>
                              <Text size="sm">Variety in the top picks</Text>
                              <Text size="sm" c="red">
                                -{(e.consolePenalty ?? 0) + (e.franchisePenalty ?? 0)}
                              </Text>
                            </Group>
                          )}
                        </Stack>
                        {e.flags.length > 0 && (
                          <Stack gap={2}>
                            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                              Notes
                            </Text>
                            {e.flags.map((f) => (
                              <Text key={f} size="sm">
                                {f}
                              </Text>
                            ))}
                          </Stack>
                        )}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                )}
              </Fragment>
            );
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
    </>
  );
}

/**
 * For the owner of a wishlist scored without IGDB (switched off, or no keys yet): the scores then lean on the
 * series and consoles collected (every "Mario" game rises), so it says so and where the free keys go.
 */
function WithoutIgdb() {
  const canEdit = useCanEdit();
  const state = useSettingsState().data;
  if (!canEdit || !state) return null;
  const ready = state.values['features.igdb'] && state.values['sources.igdbClientId'].trim() !== '' && state.secretsSet.includes('sources.igdbClientSecret');
  if (ready) return null;
  return (
    <Alert color="blue" variant="light" mb="md" title="The wishlist is guessing without IGDB">
      Without IGDB's reviews and genres, acorns lean on the series and consoles you collect, so games that share a name with ones you have rise to the top. Free IGDB keys take about five minutes:{' '}
      <Anchor component={Link} to="/settings/features#setting-features.igdb" c="inherit" fw={600} underline="always">
        Settings › Features
      </Anchor>
      .
    </Alert>
  );
}
