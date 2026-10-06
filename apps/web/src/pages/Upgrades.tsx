import { Anchor, Badge, Group, Loader, SegmentedControl, Stack, Switch, Table, Text } from '@mantine/core';
import { IconExternalLink } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { PageHeader } from '../components';
import { money } from '../format';
import { GameTitle } from '../GameDrawer';
import { useSetting } from '../hooks';

/** GET /api/v1/collection/upgrades: an owned game whose best copy isn't complete. */
interface Upgrade {
  platformKey: string;
  platform: string;
  title: string;
  includeString: string;
  completeness: 'loose' | 'item-box' | 'item-manual';
  valueCents: number | null;
  missing: ('box' | 'manual')[];
  status: string | null;
  rating: number | null;
  igdbRating: number | null;
  priceUrl: string;
}

type Filter = 'all' | 'loose' | 'box' | 'manual';

/**
 * Collection > Upgrades: the games whose best copy isn't complete (loose, or without its box or its manual), the
 * ones you like best first (your rating in What you played, then IGDB's, then the copy's value), each with
 * PriceCharting's page for what a complete copy costs. A complete copy of one makes a good gift, so viewers see it too.
 */
export function UpgradesPage() {
  const currency = useSetting('general.currency', 'USD');
  const [filter, setFilter] = useState<Filter>('all');
  const [ratedOnly, setRatedOnly] = useState(false);
  const upgrades = useQuery({ queryKey: ['collection', 'upgrades'], queryFn: () => api<{ items: Upgrade[] }>('/collection/upgrades') });
  const all = upgrades.data?.items ?? [];
  const anyRating = all.some((u) => u.rating !== null);
  const count = (f: Filter) => all.filter((u) => matches(u, f)).length;
  const shown = all.filter((u) => matches(u, filter) && (!ratedOnly || u.rating !== null));
  return (
    <>
      <PageHeader
        help="your-copies"
        title="Upgrades"
        description="Games whose best copy isn't complete, the ones you like best first: your rating, then IGDB's. A complete copy of one makes a good gift."
      />
      {upgrades.isPending ? (
        <Loader />
      ) : all.length === 0 ? (
        <Text c="dimmed">Every game you have has a complete copy: nothing to upgrade.</Text>
      ) : (
        <Stack gap="sm">
          <Group gap="md" wrap="wrap">
            <SegmentedControl
              size="xs"
              value={filter}
              onChange={(v) => setFilter(v as Filter)}
              data={[
                { value: 'all', label: `All (${all.length})` },
                { value: 'loose', label: `Loose (${count('loose')})` },
                { value: 'box', label: `No box (${count('box')})` },
                { value: 'manual', label: `No manual (${count('manual')})` },
              ]}
            />
            {anyRating && <Switch size="sm" label="Only games you rated" checked={ratedOnly} onChange={(e) => setRatedOnly(e.currentTarget.checked)} />}
          </Group>
          <Table.ScrollContainer minWidth={600}>
            <Table verticalSpacing={6} striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Game</Table.Th>
                  <Table.Th>Your copy</Table.Th>
                  <Table.Th ta="right">Worth</Table.Th>
                  {anyRating && <Table.Th ta="right">Your rating</Table.Th>}
                  <Table.Th ta="right">IGDB</Table.Th>
                  <Table.Th>Complete copy</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {shown.map((u) => (
                  <Table.Tr key={`${u.platformKey}|${u.title}`}>
                    <Table.Td>
                      <GameTitle platformKey={u.platformKey} title={u.title} fw={500} />
                      <Text size="xs" c="dimmed">
                        {u.platform}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="light" color={u.completeness === 'loose' ? 'gray' : 'blue'} tt="none">
                        {u.completeness === 'loose' ? 'Loose' : u.missing.includes('box') ? 'No box' : 'No manual'}
                      </Badge>
                    </Table.Td>
                    <Table.Td ta="right">{u.valueCents !== null ? money(u.valueCents, currency) : '—'}</Table.Td>
                    {anyRating && <Table.Td ta="right">{u.rating !== null ? `${u.rating}/10` : ''}</Table.Td>}
                    <Table.Td ta="right">{u.igdbRating !== null ? Math.round(u.igdbRating) : ''}</Table.Td>
                    <Table.Td>
                      <Anchor href={u.priceUrl} target="_blank" rel="noreferrer" size="sm">
                        Price on PriceCharting <IconExternalLink size={12} />
                      </Anchor>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {shown.length === 0 && (
            <Text size="sm" c="dimmed">
              None of these.
            </Text>
          )}
          <Text size="xs" c="dimmed">
            A game's rating (in its drawer, under What you played) moves it up. Sealed games you play another way are on{' '}
            <Anchor component={Link} to="/collection/copies" size="xs">
              Copies
            </Anchor>
            .
          </Text>
        </Stack>
      )}
    </>
  );
}

function matches(u: Upgrade, filter: Filter): boolean {
  if (filter === 'all') return true;
  if (filter === 'loose') return u.completeness === 'loose';
  return u.missing.includes(filter) && u.completeness !== 'loose';
}
