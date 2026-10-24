import { Anchor, Card, Group, Loader, SegmentedControl, SimpleGrid, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { RootsMark } from '../Acorn';
import { api } from '../api';
import { PageHeader } from '../components';
import { useFeature } from '../hooks';
import { dot } from '../look';
import { generationName, TimelinePanel } from './History';

/** The consoles as the timeline knows them (GET /api/v1/history/timeline). */
interface Consoles {
  consoles: { platformKey: string; name: string; manufacturer: string | null; generation: number | null; launched: number | null; ended: number | null; tracked: boolean; hasHistory: boolean; hasTop100: boolean }[];
}

/**
 * Roots (D165, "Games in their time, and since"): the games as they were seen when they came out, what they came from,
 * and how they're remembered. Here: each console's history and its Top 100 list, by generation, and the timeline of
 * consoles and landmark games; on every game's page, its own Roots part. (The Time machine and videos come later.)
 */
export function RootsPage() {
  const [params, setParams] = useSearchParams();
  const on = useFeature('history');
  const view = params.get('view') === 'timeline' ? 'timeline' : 'consoles';
  const timeline = useQuery({ queryKey: ['history', 'timeline'], queryFn: () => api<Consoles>('/history/timeline'), enabled: on && view === 'consoles' });
  const consoles = (timeline.data?.consoles ?? []).filter((c) => c.hasHistory || c.hasTop100);
  const generations = [...new Set(consoles.map((c) => c.generation ?? 0))].sort((a, b) => a - b);
  return (
    <>
      <PageHeader
        help="roots"
        title={
          <Group gap={10} wrap="nowrap" component="span">
            <RootsMark size={26} />
            Roots
          </Group>
        }
        description="Games in their time, and since: how each was seen when it came out, what it came from, and how it's remembered."
      />
      {!on ? (
        <Text c="dimmed">
          Roots is off.{' '}
          <Anchor component={Link} to="/settings/features">
            Settings › Features
          </Anchor>{' '}
          turns it on.
        </Text>
      ) : (
        <Stack gap="md">
          <SegmentedControl
            w="fit-content"
            value={view}
            onChange={(v) => setParams(v === 'timeline' ? { view: 'timeline' } : {}, { replace: true })}
            data={[
              { value: 'consoles', label: 'Consoles' },
              { value: 'timeline', label: 'Timeline' },
            ]}
          />
          {view === 'timeline' ? (
            <TimelinePanel />
          ) : timeline.isLoading ? (
            <Loader />
          ) : (
            <>
              <Text size="sm" c="dimmed" maw={760}>
                Each console's history, with a few games to start with, and its Top 100 list with what you have of it. Every game's own page has its Roots
                too: its Top 100 place and why it matters.
              </Text>
              {generations.map((gen) => (
                <Stack key={gen} gap={6}>
                  <Text size="xs" tt="uppercase" fw={700} c="dimmed">
                    {gen > 0 ? generationName(gen) : 'Other consoles'}
                  </Text>
                  <SimpleGrid cols={{ base: 1, xs: 2, md: 3, lg: 4 }} spacing="sm">
                    {consoles
                      .filter((c) => (c.generation ?? 0) === gen)
                      .sort((a, b) => (a.launched ?? 9999) - (b.launched ?? 9999) || a.name.localeCompare(b.name))
                      .map((c) => (
                        <Card key={c.platformKey} withBorder padding="sm">
                          <Group gap={8} wrap="nowrap">
                            <span className="sc-dot" style={dot(c.platformKey, c.name)} />
                            <Text fw={600} size="sm">
                              {c.name}
                            </Text>
                            {c.launched && (
                              <Text size="xs" c="dimmed">
                                {c.launched}
                              </Text>
                            )}
                          </Group>
                          <Group gap={12} mt={6}>
                            {c.hasHistory && (
                              <Anchor component={Link} to={`/platforms/${c.platformKey}?tab=history`} size="sm">
                                History
                              </Anchor>
                            )}
                            {c.hasTop100 && (
                              <Anchor component={Link} to={`/platforms/${c.platformKey}?tab=top100`} size="sm">
                                Top 100
                              </Anchor>
                            )}
                          </Group>
                        </Card>
                      ))}
                  </SimpleGrid>
                </Stack>
              ))}
            </>
          )}
        </Stack>
      )}
    </>
  );
}
