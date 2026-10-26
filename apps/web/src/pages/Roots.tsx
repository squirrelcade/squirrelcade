import { Anchor, Card, Group, Loader, SimpleGrid, Stack, Switch, Tabs, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconArrowLeft } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { RootsMark } from '../Acorn';
import { api } from '../api';
import { PageHeader } from '../components';
import { notifyError, useCanEdit, useFeature, usePageTitle, useSetting, useSettings } from '../hooks';
import { ConsoleMark } from '../ConsoleMark';
import { ConsoleHistoryTab, generationName, TimelinePanel, Top100Tab, useAllConsoles } from './History';

/** The consoles as the timeline knows them (GET /api/v1/history/timeline). */
interface Consoles {
  consoles: {
    platformKey: string;
    name: string;
    manufacturer: string | null;
    generation: number | null;
    launched: number | null;
    ended: number | null;
    tracked: boolean;
    hasHistory: boolean;
    hasTop100: boolean;
    /** Followed without collecting it (D169): box art, RomM and its games' pages. */
    followed: boolean;
    /** Your RomM's ROMs for it, with RomM on. */
    romm: number | null;
  }[];
}

/** Follow or stop following a console you don't collect (Settings > Platforms > Consoles you follow, D169). */
function useFollow() {
  const queryClient = useQueryClient();
  const unfollowed = useSetting('platforms.unfollowed', [] as string[]);
  return useMutation({
    mutationFn: ({ key, follow }: { key: string; follow: boolean }) =>
      api('/settings', { method: 'PUT', json: { changes: { 'platforms.unfollowed': follow ? unfollowed.filter((k) => k !== key) : [...new Set([...unfollowed, key])] } } }),
    onSuccess: () => Promise.all([queryClient.invalidateQueries({ queryKey: ['settings'] }), queryClient.invalidateQueries({ queryKey: ['history'] })]),
    onError: (err) => notifyError(err),
  });
}

/** A console you don't collect: whether it's followed (with a button to change it) and what your RomM has of it. */
function FollowLine({ c, canEdit, followOn }: { c: Consoles['consoles'][number]; canEdit: boolean; followOn: boolean }) {
  const follow = useFollow();
  if (c.tracked) return null;
  return (
    <Group gap={8} mt={4} wrap="wrap" onClick={(e) => e.stopPropagation()}>
      {c.romm !== null && c.romm > 0 && (
        <Text size="xs" c="dimmed">
          In RomM {c.romm}
        </Text>
      )}
      <Text size="xs" c="dimmed">
        {c.followed ? 'Followed' : "You don't collect it"}
      </Text>
      {canEdit && followOn && (
        <Anchor component="button" type="button" size="xs" onClick={() => follow.mutate({ key: c.platformKey, follow: !c.followed })}>
          {c.followed ? 'Stop following' : 'Follow'}
        </Anchor>
      )}
    </Group>
  );
}

/**
 * Roots (D165, "Games in their time, and since"): the games as they were seen when they came out, what they came from,
 * and how they're remembered. Here: each console's history and its Top 100 list, by generation, and the timeline of
 * consoles and landmark games; on every game's page, its own Roots part. (The Time machine and videos come later.)
 */
export function RootsPage() {
  // Consoles or the timeline: the menu's (Roots > Consoles, Roots > Timeline), so no switch of its own here.
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const on = useFeature('history');
  const view = params.get('view') === 'timeline' ? 'timeline' : 'consoles';
  const timeline = useQuery({ queryKey: ['history', 'timeline'], queryFn: () => api<Consoles>('/history/timeline'), enabled: on && view === 'consoles' });
  const listed = (timeline.data?.consoles ?? []).filter((c) => c.hasHistory || c.hasTop100);
  // The consoles you collect, or all of them with the switch (remembered; the timeline follows it).
  const [all, setAll] = useAllConsoles();
  const canEdit = useCanEdit();
  const followOn = useSetting('platforms.followRoots', true);
  const collected = listed.filter((c) => c.tracked);
  const consoles = all || collected.length === 0 ? listed : collected;
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
          {view === 'timeline' ? (
            <TimelinePanel />
          ) : timeline.isLoading ? (
            <Loader />
          ) : (
            <>
              <Group justify="space-between" wrap="wrap" align="flex-start">
                <Text size="sm" c="dimmed" maw={760}>
                  Each console's history, with a few games to start with, and its Top 100 list with what you have of it. Every game's own page has its Roots
                  too: its Top 100 place and why it matters.
                </Text>
                {collected.length > 0 && <Switch size="sm" label="Consoles you don't collect too" checked={all} onChange={(e) => setAll(e.currentTarget.checked)} />}
              </Group>
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
                        // The whole card opens the console's page in Roots: its history first, else its Top 100.
                        <Card
                          key={c.platformKey}
                          withBorder
                          padding="sm"
                          className="sc-card-link"
                          onClick={() => navigate(`/roots/${c.platformKey}?tab=${c.hasHistory ? 'history' : 'top100'}`)}
                        >
                          <Group gap={8} wrap="nowrap">
                            <ConsoleMark platformKey={c.platformKey} name={c.name} owned={c.tracked} size={16} />
                            <Anchor component={Link} to={`/roots/${c.platformKey}?tab=${c.hasHistory ? 'history' : 'top100'}`} fw={600} size="sm" c="inherit" underline="hover" onClick={(e) => e.stopPropagation()}>
                              {c.name}
                            </Anchor>
                            {c.launched && (
                              <Text size="xs" c="dimmed">
                                {c.launched}
                              </Text>
                            )}
                          </Group>
                          <Group gap={12} mt={6}>
                            {c.hasHistory && (
                              <Anchor component={Link} to={`/roots/${c.platformKey}?tab=history`} size="sm" onClick={(e) => e.stopPropagation()}>
                                History
                              </Anchor>
                            )}
                            {c.hasTop100 && (
                              <Anchor component={Link} to={`/roots/${c.platformKey}?tab=top100`} size="sm" onClick={(e) => e.stopPropagation()}>
                                Top 100
                              </Anchor>
                            )}
                          </Group>
                          <FollowLine c={c} canEdit={canEdit} followOn={followOn} />
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

/**
 * A console in Roots (/roots/:key; the owner: Roots' consoles opened the Nutshell's page): its history and its Top
 * 100 list, with Roots lit in the menu. Its checklist stays the Nutshell's (Platforms), linked from here.
 */
export function RootsConsolePage() {
  const { key = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { data: settings } = useSettings();
  const on = useFeature('history');
  const narrow = useMediaQuery('(max-width: 48em)');
  const timeline = useQuery({ queryKey: ['history', 'timeline'], queryFn: () => api<Consoles>('/history/timeline'), enabled: on });
  const c = timeline.data?.consoles.find((x) => x.platformKey === key);
  usePageTitle(c?.name ?? 'Roots', settings?.['general.instanceName'] || 'Squirrelcade');
  const asked = params.get('tab');
  const tab = asked === 'top100' || asked === 'history' ? asked : c && !c.hasHistory && c.hasTop100 ? 'top100' : 'history';
  return (
    <>
      <Anchor component={Link} to="/roots" size="sm" mb={4} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <IconArrowLeft size={14} /> All consoles
      </Anchor>
      <PageHeader
        help="roots"
        title={
          <Group gap={10} wrap="nowrap" component="span">
            <ConsoleMark platformKey={key} name={c?.name ?? key} owned={Boolean(c?.tracked)} size={22} />
            {c?.name ?? key}
          </Group>
        }
        description={
          <>
            {c?.hasTop100 && c.hasHistory ? 'Its history and its Top 100 list, with what you have of it.' : c?.hasTop100 ? 'Its Top 100 list, with what you have of it.' : 'Its history.'}
            {c?.tracked && (
              <>
                {' '}
                <Anchor component={Link} to={`/platforms/${key}`} size="sm">
                  Its checklist
                </Anchor>{' '}
                is in the Nutshell.
              </>
            )}
          </>
        }
      />
      {!on ? (
        <Text c="dimmed">Roots is off (Settings › Features).</Text>
      ) : timeline.isLoading ? (
        <Loader />
      ) : (
        <>
          <Tabs
            value={tab}
            onChange={(v) => {
              // A tab of its own: the Top 100's view and filters (in the address) start afresh.
              setParams(v ? { tab: v } : {}, { replace: true });
            }}
            mb="sm"
          >
            <Tabs.List>
              {(c?.hasHistory || tab === 'history') && <Tabs.Tab value="history">History</Tabs.Tab>}
              {(c?.hasTop100 || tab === 'top100') && <Tabs.Tab value="top100">Top 100</Tabs.Tab>}
            </Tabs.List>
          </Tabs>
          {tab === 'top100' ? <Top100Tab platformKey={key} narrow={Boolean(narrow)} /> : <ConsoleHistoryTab platformKey={key} />}
        </>
      )}
    </>
  );
}
