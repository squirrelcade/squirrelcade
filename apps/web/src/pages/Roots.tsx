import { Alert, Anchor, Badge, Box, Button, Card, Group, Loader, Modal, Progress, SimpleGrid, Stack, Switch, Tabs, Text, Tooltip } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconArrowLeft } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { RootsMark, StashMark } from '../Acorn';
import { api } from '../api';
import { PageHeader } from '../components';
import { notifyError, notifySuccess, useCanEdit, useFeature, usePageTitle, useSetting, useSettings } from '../hooks';
import { ConsoleMark } from '../ConsoleMark';
import { ConsoleHistoryTab, generationName, TimelinePanel, Top100Tab, useAllConsoles } from './History';
import { NowInPanel, TimeMachinePanel } from './TimeMachine';
import { Top20Panel } from './Top20';

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
    /** Units sold in short ("87.4 million") with the text it comes from (R16). */
    unitsSold: string | null;
    unitsSoldFull: string | null;
    /** You chose to collect it before owning enough of its games (R15). */
    collecting: boolean;
    /** Its picture from Wikipedia, kept on your server, with the Commons page that credits it (R16). */
    picture?: { url: string; credit: string | null } | null;
  }[];
}

/** A console's Top 100 count (GET /api/v1/history/progress), as Nutshell > Consoles has it. */
interface Top100Count {
  platformKey: string;
  owned: number;
  total: number;
  digital: number;
  elsewhere: number;
}

/** The maker and the years on sale ("Sega · 1988–1997", "Sony · 2020–" while on sale). */
function makerYears(c: Consoles['consoles'][number]): string | null {
  const years = c.launched ? (c.ended && c.ended !== c.launched ? `${c.launched}–${c.ended}` : c.ended ? String(c.launched) : `${c.launched}–`) : null;
  return [c.manufacturer, years].filter(Boolean).join(' · ') || null;
}

/** A console's picture on its card (Wikipedia's, kept on your server), or Squirrelcade's own mark of it while there is none. */
function CardPicture({ c }: { c: Consoles['consoles'][number] }) {
  return (
    <Box h={84} mb={8} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4, background: 'var(--mantine-color-default-hover)' }} data-testid="console-picture">
      {c.picture ? (
        <img src={c.picture.url} alt="" loading="lazy" title="Picture: Wikimedia Commons" style={{ maxWidth: '100%', maxHeight: 84, objectFit: 'contain' }} />
      ) : (
        <ConsoleMark platformKey={c.platformKey} name={c.name} owned={c.tracked} size={36} />
      )}
    </Box>
  );
}

/** How much of a console's Top 100 you have: the chest, "41 of 93" and a small bar, to its Top 100 tab (as Nutshell's column). */
function Top100Line({ t, platformKey, name }: { t: Top100Count; platformKey: string; name: string }) {
  const percent = t.total > 0 ? Math.round((t.owned / t.total) * 100) : 0;
  const tip = [`${t.owned} of the ${t.total} Top 100 games you can have`, t.digital > 0 ? `${t.digital} digital only` : null, t.elsewhere > 0 ? `${t.elsewhere} you have on another console` : null].filter(Boolean).join(', ');
  return (
    <Tooltip label={tip}>
      <Anchor component={Link} to={`/roots/${platformKey}?tab=top100`} underline="never" mt={6} style={{ display: 'inline-flex' }} onClick={(e) => e.stopPropagation()} data-testid="card-top100">
        <Group gap={6} wrap="nowrap">
          <StashMark size={12} />
          <Progress aria-label={`${name} Top 100`} value={percent} w={50} size="sm" color="yellow" />
          <Text size="xs" c="var(--mantine-color-text)">
            {t.owned} of {t.total}
          </Text>
        </Group>
      </Anchor>
    </Tooltip>
  );
}

/** Follow or stop following a console you don't collect (Settings > Consoles > Consoles you follow, D169). */
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
  const navigate = useNavigate();
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
      {canEdit && c.followed && (
        <Anchor component="button" type="button" size="xs" onClick={() => navigate(`/roots/${c.platformKey}?collect=1`)}>
          Start collecting
        </Anchor>
      )}
    </Group>
  );
}

/**
 * How much of a console you have, on its card (item 8 of the owner's 1.3 list): the chest, a bar and the percentage, as
 * Nutshell > Consoles' Complete column has them, opening the console's page there. A console without a catalog says
 * how many of its games you have, opening the Stash on it; none, no line. Read from the catalogs' stored results.
 */
function HaveLine({ platformKey, completion, games }: { platformKey: string; completion?: { percent: number; owned: number }; games?: number }) {
  if (completion) {
    return (
      <Anchor component={Link} to={`/consoles/${platformKey}`} underline="never" mt={6} style={{ display: 'inline-flex' }} onClick={(e) => e.stopPropagation()} aria-label={`You have ${completion.percent}% of it`}>
        <Group gap={6} wrap="nowrap">
          <StashMark size={12} />
          <Progress aria-label={`${completion.percent}% of it yours`} value={completion.percent} w={80} size="sm" color={completion.percent >= 90 ? 'green' : 'forest'} />
          <Text size="xs" c="var(--mantine-color-text)">
            {completion.percent}%
          </Text>
        </Group>
      </Anchor>
    );
  }
  if (!games) return null;
  return (
    <Anchor component={Link} to={`/collection?platform=${platformKey}`} underline="never" mt={6} size="xs" style={{ display: 'inline-flex' }} onClick={(e) => e.stopPropagation()}>
      <Group gap={6} wrap="nowrap">
        <StashMark size={12} />
        <Text size="xs" c="var(--mantine-color-text)">
          {games} {games === 1 ? 'game' : 'games'}
        </Text>
      </Group>
    </Anchor>
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
  const asked = params.get('view');
  const view = asked === 'timeline' || asked === 'now-in' || asked === 'time-machine' || asked === 'top20' ? asked : 'consoles';
  const timeline = useQuery({ queryKey: ['history', 'timeline'], queryFn: () => api<Consoles>('/history/timeline'), enabled: on && view === 'consoles' });
  const listed = (timeline.data?.consoles ?? []).filter((c) => c.hasHistory || c.hasTop100);
  // The consoles you collect, or all of them with the switch (remembered; the timeline follows it).
  const [all, setAll] = useAllConsoles();
  const canEdit = useCanEdit();
  const followOn = useSetting('platforms.followRoots', true);
  const collected = listed.filter((c) => c.tracked);
  const consoles = all || collected.length === 0 ? listed : collected;
  const generations = [...new Set(consoles.map((c) => c.generation ?? 0))].sort((a, b) => a - b);
  // What you have of each console (the catalogs' stored results and the copies' counts): a viewer kept from them gets none.
  const catalogs = useQuery({ queryKey: ['catalogs', 'summary'], queryFn: () => api<{ key: string; percent: number; owned: number }[]>('/catalogs'), enabled: on && view === 'consoles', retry: false });
  const platformCounts = useQuery({ queryKey: ['platforms'], queryFn: () => api<{ key: string; games: number }[]>('/platforms'), enabled: on && view === 'consoles', retry: false });
  // One call for every card's Top 100 count (kept on the server).
  const progress = useQuery({ queryKey: ['history', 'progress'], queryFn: () => api<Top100Count[]>('/history/progress'), enabled: on && view === 'consoles', retry: false });
  const top100 = new Map(progress.data?.map((t) => [t.platformKey, t]));
  const completion = new Map(catalogs.data?.map((c) => [c.key, c]));
  const gameCounts = new Map(platformCounts.data?.map((p) => [p.key, p.games]));
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
          ) : view === 'now-in' ? (
            <NowInPanel />
          ) : view === 'time-machine' ? (
            <TimeMachinePanel />
          ) : view === 'top20' ? (
            <Top20Panel />
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
                          <CardPicture c={c} />
                          <Group gap={8} wrap="nowrap">
                            <ConsoleMark platformKey={c.platformKey} name={c.name} owned={c.tracked} size={16} />
                            <Anchor component={Link} to={`/roots/${c.platformKey}?tab=${c.hasHistory ? 'history' : 'top100'}`} fw={600} size="sm" c="inherit" underline="hover" onClick={(e) => e.stopPropagation()}>
                              {c.name}
                            </Anchor>
                          </Group>
                          {makerYears(c) && (
                            <Text size="xs" c="dimmed" mt={2} data-testid="card-maker">
                              {makerYears(c)}
                            </Text>
                          )}
                          {c.unitsSold && (
                            <Tooltip label={c.unitsSoldFull ?? c.unitsSold} disabled={!c.unitsSoldFull}>
                              <Text size="xs" c="dimmed" data-testid="card-units">
                                {c.unitsSold} sold
                              </Text>
                            </Tooltip>
                          )}
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
                          <HaveLine platformKey={c.platformKey} completion={completion.get(c.platformKey)} games={gameCounts.get(c.platformKey)} />
                          {/* A console you only follow shows no count of what you have (D169), unless you do have some. */}
                          {top100.get(c.platformKey) && (c.tracked || top100.get(c.platformKey)!.owned > 0) && <Top100Line t={top100.get(c.platformKey)!} platformKey={c.platformKey} name={c.name} />}
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

/** What a console's catalog would be built from (GET /api/v1/catalog-plan/:key). */
interface CatalogPlan {
  key: string;
  name: string;
  pages: string[];
  pagesAreDefault: boolean;
  list: { fileName: string; games: number } | null;
  igdb: boolean;
  sources: { id: string; name: string }[];
  labels: string[];
  builtAt: string | null;
}

/** Start or stop collecting a console (Settings > Consoles > Consoles you collect before you own enough games, R15). */
function useCollecting(key: string) {
  const queryClient = useQueryClient();
  const collecting = useSetting('platforms.collecting', [] as string[]);
  return useMutation({
    mutationFn: async (start: boolean) => {
      await api('/settings', { method: 'PUT', json: { changes: { 'platforms.collecting': start ? [...new Set([...collecting, key])] : collecting.filter((k) => k !== key) } } });
      // Its catalog is built in the background, from the sources the checklist named.
      if (start) await api('/catalogs/build', { method: 'POST', json: { platforms: [key] } });
      return start;
    },
    onSuccess: (start) => {
      notifySuccess(start ? 'Collecting it. Its catalog is being built.' : 'No longer collecting it: followed again.');
      return Promise.all(['settings', 'history', 'platforms', 'catalogs'].map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
    },
    onError: (err) => notifyError(err),
  });
}

/**
 * Start collecting a followed console (R15): a short checklist of where its list of games comes from and how your
 * PriceCharting export names it, then the button that makes it a collected console and starts its catalog.
 */
function StartCollecting({ c, opened, onClose, onStarted }: { c: Consoles['consoles'][number]; opened: boolean; onClose: () => void; onStarted: () => void }) {
  const plan = useQuery({ queryKey: ['catalog-plan', c.platformKey], queryFn: () => api<CatalogPlan>(`/catalog-plan/${c.platformKey}`), enabled: opened, retry: false });
  const start = useCollecting(c.platformKey);
  const p = plan.data;
  const pageLink = (title: string) => `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
  return (
    <Modal opened={opened} onClose={onClose} title={`Start collecting ${c.name}`} size="lg">
      {start.isSuccess ? (
        <Stack gap="sm" data-testid="collect-done">
          <Text size="sm">{c.name} is a collected console now. Its catalog is being built in the background.</Text>
          <Group gap="sm">
            <Button component={Link} to={`/consoles/${c.platformKey}`} size="sm">
              Its page in the Nutshell
            </Button>
            <Button component={Link} to="/collection/add" size="sm" variant="default">
              Add a game
            </Button>
          </Group>
          <Text size="xs" c="dimmed">
            On its Nutshell page you can give it a list of your own (a CSV) too.
          </Text>
        </Stack>
      ) : plan.isLoading ? (
        <Loader size="sm" />
      ) : !p ? (
        <Text size="sm" c="dimmed">
          Squirrelcade has no record of this console yet.
        </Text>
      ) : (
        <Stack gap="md" data-testid="collect-checklist">
          <Text size="sm" c="dimmed">
            Collecting it gives {c.name} a catalog, a checklist and a place in your totals. Two things to look at first.
          </Text>
          <Stack gap={4}>
            <Text fw={600} size="sm">
              1. Its list of games
            </Text>
            {p.list && (
              <Text size="sm">
                Your own list, {p.list.fileName} ({p.list.games} games), comes first.
              </Text>
            )}
            {p.pages.length > 0 ? (
              <Text size="sm">
                Its catalog is built from Wikipedia's{' '}
                {p.pages.map((t, i) => (
                  <span key={t}>
                    {i > 0 && ', '}
                    <Anchor href={pageLink(t)} target="_blank" rel="noreferrer" size="sm">
                      {t}
                    </Anchor>
                  </span>
                ))}
                {p.pagesAreDefault ? '.' : ' (the pages you chose).'}
              </Text>
            ) : (
              <Text size="sm">No Wikipedia list is set up for it.{p.igdb ? " IGDB's list of its games fills its catalog instead: each game counts once you own it." : ''}</Text>
            )}
            <Text size="xs" c="dimmed">
              To use your own: its Nutshell page takes a list of your own (a CSV) once you start. For another Wikipedia page,{' '}
              <Anchor component={Link} to="/settings/catalogs" size="xs">
                Settings › Catalogs and matching
              </Anchor>{' '}
              (Wikipedia lists to use).
            </Text>
          </Stack>
          <Stack gap={4}>
            <Text fw={600} size="sm">
              2. How your PriceCharting export names it
            </Text>
            {p.labels.length > 0 ? (
              <>
                <Group gap={6}>
                  {p.labels.map((l) => (
                    <Badge key={l} size="sm" variant="outline" color="gray" tt="none">
                      {l}
                    </Badge>
                  ))}
                </Group>
                <Text size="xs" c="dimmed">
                  An import with these console names lands on {c.name}.
                </Text>
              </>
            ) : (
              <Text size="sm">
                Squirrelcade doesn't know a PriceCharting name for it. An import that names it makes a console of its own: check Nutshell › Consoles after your first one.
              </Text>
            )}
          </Stack>
          {start.isError && <Alert color="red">It didn't start. Try again.</Alert>}
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={onClose}>
              Not now
            </Button>
            <Button loading={start.isPending} onClick={() => start.mutate(true, { onSuccess: onStarted })}>
              Start collecting
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
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
  const canEdit = useCanEdit();
  const platformCounts = useQuery({ queryKey: ['platforms'], queryFn: () => api<{ key: string; copies: number }[]>('/platforms'), enabled: on && canEdit, retry: false });
  const copies = platformCounts.data?.find((x) => x.key === key)?.copies ?? 0;
  const collect = useCollecting(key);
  // It stays open after it starts (the console isn't followed any more) to say where to go next.
  const [started, setStarted] = useState(false);
  const collectOpen = params.get('collect') === '1' && (Boolean(c?.followed) || started);
  const closeCollect = () => {
    setStarted(false);
    const next = new URLSearchParams(params);
    next.delete('collect');
    setParams(next, { replace: true });
  };
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
        actions={
          canEdit && c?.followed ? (
            <Button size="sm" onClick={() => setParams({ ...(asked ? { tab: asked } : {}), collect: '1' }, { replace: true })} data-testid="start-collecting">
              Start collecting
            </Button>
          ) : canEdit && c?.collecting && copies === 0 ? (
            <Tooltip label="Back to following it: its catalog is taken away (your own list and answers stay)">
              <Button size="sm" variant="default" loading={collect.isPending} onClick={() => collect.mutate(false)} data-testid="stop-collecting">
                Stop collecting
              </Button>
            </Tooltip>
          ) : null
        }
        description={
          <>
            {c?.hasTop100 && c.hasHistory ? 'Its history and its Top 100 list, with what you have of it.' : c?.hasTop100 ? 'Its Top 100 list, with what you have of it.' : 'Its history.'}
            {c?.tracked && (
              <>
                {' '}
                <Anchor component={Link} to={`/consoles/${key}`} size="sm">
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
          {c?.picture && (
            <Group gap="sm" mb="sm" wrap="nowrap" align="flex-end" data-testid="console-page-picture">
              <img src={c.picture.url} alt={`${c.name}`} style={{ maxHeight: 120, maxWidth: 220, objectFit: 'contain', borderRadius: 4 }} />
              <Text size="xs" c="dimmed">
                {c.picture.credit ? (
                  <Anchor href={c.picture.credit} target="_blank" rel="noreferrer" size="xs">
                    Picture: Wikimedia Commons
                  </Anchor>
                ) : (
                  'Picture: Wikimedia Commons'
                )}
              </Text>
            </Group>
          )}
          {c && <StartCollecting c={c} opened={collectOpen} onClose={closeCollect} onStarted={() => setStarted(true)} />}
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
