import { FEATURE_LIST, featureTime, KNOWN_PLATFORMS, listPlatform, parseCatalogList, settingDefinitions } from '@squirrelcade/core';
import { Alert, Anchor, Badge, Button, Card, FileButton, Group, List, Loader, NumberInput, Radio, Select, Stack, Stepper, Table, Text, Title } from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { useDebouncedCallback, useMediaQuery } from '@mantine/hooks';
import { IconCheck, IconFileSpreadsheet, IconPlus, IconSparkles, IconTable, IconUpload } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api';
import { PageHeader } from '../components';
import { count, dateTime } from '../format';
import { notifyError, notifySuccess, usePageTitle, useSetting } from '../hooks';
import type { CatalogSourceStatus } from './CatalogSource';
import { EXPORT_FILES } from './Imports';

interface Summary {
  totals: { games: number; copies: number };
  platforms: { key: string }[];
  currentImport: { fileName: string; appliedAt: string | null } | null;
}

interface PlatformRow {
  key: string;
  name: string;
  games: number;
  eligible: boolean;
  labels: { label: string }[];
}

interface ImportOutcome {
  import: { status: 'applied' | 'pending' | 'discarded' | 'refused'; message: string | null; rowCount: number };
  duplicate: boolean;
}

const optionLabel = (key: 'general.homeRegion' | 'general.currency', value: string) => settingDefinitions[key].options?.find((o) => o.value === value)?.label ?? value;

/**
 * The welcome guide for a new install (shortened in 1.4.0, D219): the collection, which consoles to track, their catalogs
 * (with the user's own lists, several at once) and what the wishlist is, then the features list as "add these any time".
 * It gets the app going and the collection in; every integration is on Settings > Features, not a step here.
 */
export function WelcomePage() {
  const appName = useSetting('general.instanceName', 'Squirrelcade') || 'Squirrelcade';
  usePageTitle('Welcome', appName);
  const narrow = useMediaQuery('(max-width: 48em)');
  const [step, setStep] = useState(0);
  const next = () => setStep((s) => s + 1);

  // A new install is asked what its wishlist is; one that already had games (opening this guide again) isn't, and keeps
  // 'suggested'. The first look at an empty collection is remembered for the session, so adding games one at a time
  // (which leaves this page and comes back) doesn't make the install look old.
  const summary = useQuery({ queryKey: ['collection', 'summary'], queryFn: () => api<Summary>('/collection/summary') });
  const [fresh, setFresh] = useState(() => readFresh());
  useEffect(() => {
    if (summary.data && summary.data.totals.games === 0 && !fresh) {
      rememberFresh();
      setFresh(true);
    }
  }, [summary.data, fresh]);

  return (
    <>
      <PageHeader help="getting-started" title={`Welcome to ${appName}`} description="Four short steps get it going and your games in. Everything else is optional, and on Settings > Features to add any time." />
      <Stepper active={step} onStepClick={setStep} size="sm" orientation={narrow ? 'vertical' : 'horizontal'} maw={900}>
        <Stepper.Step label="Collection" description={narrow ? undefined : 'Your games'}>
          <CollectionStep onNext={next} />
        </Stepper.Step>
        <Stepper.Step label="Consoles" description={narrow ? undefined : 'Which to track'}>
          <ConsolesStep onNext={next} />
        </Stepper.Step>
        <Stepper.Step label="Catalogs" description={narrow ? undefined : 'What there is to collect'}>
          <CatalogsStep onNext={next} />
        </Stepper.Step>
        <Stepper.Step label="Wishlist" description={narrow ? undefined : 'What it is'}>
          <WishlistSourceStep asked={fresh} onNext={next} />
        </Stepper.Step>
        <Stepper.Completed>
          <DoneStep />
        </Stepper.Completed>
      </Stepper>
    </>
  );
}

const FRESH_KEY = 'squirrelcade-welcome-new';
function readFresh(): boolean {
  try {
    return window.sessionStorage.getItem(FRESH_KEY) === '1';
  } catch {
    return false;
  }
}
function rememberFresh() {
  try {
    window.sessionStorage.setItem(FRESH_KEY, '1');
  } catch {
    // Without storage the question is asked only while the collection is still empty.
  }
}

function StepCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card withBorder mt="md" maw={900}>
      <Title order={4} mb="xs">
        {title}
      </Title>
      <Stack gap="sm">{children}</Stack>
    </Card>
  );
}

function NextButton({ onNext, label = 'Next', disabled = false, loading = false }: { onNext: () => void; label?: string; disabled?: boolean; loading?: boolean }) {
  return (
    <Group justify="flex-end">
      <Button onClick={onNext} disabled={disabled} loading={loading}>
        {label}
      </Button>
    </Group>
  );
}

function CollectionStep({ onNext }: { onNext: () => void }) {
  const queryClient = useQueryClient();
  const dateFormat = useSetting('general.dateFormat', 'us');
  const region = useSetting('general.homeRegion', 'north-america');
  const currency = useSetting('general.currency', 'USD');
  const summary = useQuery({ queryKey: ['collection', 'summary'], queryFn: () => api<Summary>('/collection/summary') });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api<ImportOutcome>('/imports', { method: 'POST', body: form });
    },
    onSuccess: async (outcome) => {
      await queryClient.invalidateQueries();
      const i = outcome.import;
      if (i.status === 'applied' || outcome.duplicate) notifySuccess(`${count(i.rowCount)} rows read.`, 'Collection updated');
      else if (i.status === 'pending') notifySuccess(i.message ?? 'Waiting for your confirmation on the Stash updates page.', 'Update held');
      else notifyError(new Error(i.message ?? 'The file was refused.'), 'Update refused');
    },
    onError: (err) => notifyError(err, 'Upload failed'),
  });
  const s = summary.data;
  const games = s?.totals.games ?? 0;

  return (
    <StepCard title="Your collection">
      <Text size="sm">
        Bring your collection in. If you keep it on PriceCharting: My Collection › Download (CSV); it arrives as collection.zip, which you upload here as it is. An export from CLZ Games, GAMEYE or VGCollect works too, or a spreadsheet of your own with a Title and a Console column. No export? Add your games one at a time instead: Back to the welcome guide, at the top of that page, brings you to the next step.
      </Text>
      {s && games > 0 && (
        <Alert color="green" icon={<IconCheck />}>
          {count(games)} games on {s.platforms.length} consoles
          {s.currentImport ? `, from ${s.currentImport.fileName}${s.currentImport.appliedAt ? ` (${dateTime(s.currentImport.appliedAt, dateFormat)})` : ''}` : ''}.
        </Alert>
      )}
      <Dropzone onDrop={(files) => files[0] && upload.mutate(files[0])} loading={upload.isPending} accept={EXPORT_FILES} maxFiles={1}>
        <Group justify="center" gap="xl" mih={90} style={{ pointerEvents: 'none' }}>
          <Dropzone.Accept>
            <IconUpload size={36} />
          </Dropzone.Accept>
          <Dropzone.Idle>
            <IconFileSpreadsheet size={36} />
          </Dropzone.Idle>
          <Text>{games > 0 ? 'Drop a newer export here, or click to choose it' : 'Drop your export or spreadsheet here, or click to choose it'}</Text>
        </Group>
      </Dropzone>
      <Group gap="xs">
        <Button component={Link} to="/collection/add?from=welcome" variant="default" leftSection={<IconPlus size={16} />}>
          Add games one at a time
        </Button>
      </Group>
      <Text size="xs" c="dimmed">
        Home region {optionLabel('general.homeRegion', region)}, prices in {optionLabel('general.currency', currency)}: catalogs are built for your region.{' '}
        <Anchor component={Link} to="/settings/general" size="xs">
          Change
        </Anchor>
      </Text>
      <NextButton onNext={onNext} disabled={games === 0} />
    </StepCard>
  );
}

function ConsolesStep({ onNext }: { onNext: () => void }) {
  const queryClient = useQueryClient();
  const minGames = useSetting('platforms.minUniqueGames', 6);
  const [draft, setDraft] = useState<number | null>(null);
  const platforms = useQuery({ queryKey: ['platforms'], queryFn: () => api<PlatformRow[]>('/platforms') });
  const save = useMutation({
    mutationFn: (value: number) => api('/settings', { method: 'PUT', json: { changes: { 'platforms.minUniqueGames': value } } }),
    onSuccess: () => Promise.all([queryClient.invalidateQueries({ queryKey: ['settings'] }), queryClient.invalidateQueries({ queryKey: ['platforms'] }), queryClient.invalidateQueries({ queryKey: ['catalogs'] })]),
    onError: (err) => notifyError(err),
  });
  const saveSoon = useDebouncedCallback((value: number) => save.mutate(value), 600);
  const rows = (platforms.data ?? []).filter((p) => p.games > 0).sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
  const tracked = rows.filter((p) => p.eligible).length;

  return (
    <StepCard title="Which consoles to track">
      <Text size="sm">
        A tracked console gets a catalog, completion and wishlist picks. A console is tracked once you own enough different games for it; the others stay in your collection.
      </Text>
      <NumberInput
        label="Different games to track a console"
        value={draft ?? minGames}
        min={1}
        max={1000}
        w={260}
        onChange={(v) => {
          const n = typeof v === 'number' ? v : Number.parseInt(v, 10);
          if (!Number.isFinite(n) || n < 1) return;
          setDraft(n);
          saveSoon(n);
        }}
      />
      {platforms.isPending ? (
        <Loader size="sm" />
      ) : (
        <Table.ScrollContainer minWidth={320}>
          <Table striped verticalSpacing={4}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Console</Table.Th>
                <Table.Th ta="right">Games</Table.Th>
                <Table.Th>Tracked</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((p) => (
                <Table.Tr key={p.key}>
                  <Table.Td>{p.name}</Table.Td>
                  <Table.Td ta="right">{count(p.games)}</Table.Td>
                  <Table.Td>
                    {p.eligible ? (
                      <Badge color="green" variant="light">
                        Yes
                      </Badge>
                    ) : (
                      <Text size="xs" c="dimmed">
                        No
                      </Text>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      <Text size="sm" c="dimmed">
        {tracked} of {rows.length} consoles tracked.
      </Text>
      <NextButton onNext={onNext} />
    </StepCard>
  );
}

interface ListFile {
  file: File;
  platformKey: string | null;
  games: number;
  problems: string[];
  state: 'ready' | 'uploading' | 'done' | 'failed';
  message?: string;
}

function CatalogsStep({ onNext }: { onNext: () => void }) {
  const queryClient = useQueryClient();
  const platforms = useQuery({ queryKey: ['platforms'], queryFn: () => api<PlatformRow[]>('/platforms') });
  // Consoles a list can be for: the collection's, plus every console Squirrelcade knows.
  const choices = [...new Map([...KNOWN_PLATFORMS.map((p) => [p.key, { key: p.key, name: p.name, labels: p.labels }] as const), ...(platforms.data ?? []).map((p) => [p.key, { key: p.key, name: p.name, labels: p.labels.map((l) => l.label) }] as const)]).values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const [files, setFiles] = useState<ListFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const sources = useQuery({
    queryKey: ['catalogs', 'sources'],
    queryFn: () => api<CatalogSourceStatus[]>('/catalogs/sources'),
    refetchInterval: (q) => ((q.state.data ?? []).some((s) => s.tracked && (!s.builtAt || s.queued)) ? 3000 : false),
  });
  const tracked = (sources.data ?? []).filter((s) => s.tracked);
  const built = tracked.filter((s) => s.builtAt && !s.queued);
  const build = useMutation({
    mutationFn: (keys: string[]) => api('/catalogs/build', { method: 'POST', json: { platforms: keys } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['catalogs', 'sources'] }),
    onError: (err) => notifyError(err),
  });

  async function choose(chosen: File[]) {
    const read = await Promise.all(
      chosen.map(async (file): Promise<ListFile> => {
        const text = await file.text();
        const { entries, problems } = parseCatalogList(text);
        return { file, platformKey: listPlatform(file.name, text, choices), games: entries.length, problems, state: 'ready' };
      }),
    );
    setFiles((current) => [...current.filter((f) => f.state !== 'ready'), ...read]);
  }

  /** Sends the chosen lists; false when one failed (its row says why). */
  async function uploadAll(): Promise<boolean> {
    setUploading(true);
    let failed = 0;
    for (const f of files) {
      if (f.state !== 'ready' || !f.platformKey || f.games === 0) continue;
      const update = (patch: Partial<ListFile>) => setFiles((current) => current.map((x) => (x.file === f.file ? { ...x, ...patch } : x)));
      update({ state: 'uploading' });
      try {
        const form = new FormData();
        form.append('file', f.file);
        await api(`/catalogs/${f.platformKey}/list`, { method: 'PUT', body: form });
        update({ state: 'done' });
      } catch (err) {
        update({ state: 'failed', message: err instanceof Error ? err.message : String(err) });
        failed++;
      }
    }
    setUploading(false);
    await queryClient.invalidateQueries({ queryKey: ['catalogs'] });
    return failed === 0;
  }

  const ready = files.filter((f) => f.state === 'ready' && f.platformKey && f.games > 0);
  const unbuilt = tracked.filter((s) => !s.builtAt && !s.queued).map((s) => s.key);

  return (
    <StepCard title="Catalogs: what there is to collect">
      <Text size="sm">
        Each tracked console gets a catalog of its games, from Wikipedia's list of them, for your region. Physical releases come first: a game Wikipedia marks as a download title, and any game on consoles whose lists mix in download-only games,
        counts once IGDB lists a physical release, you own it, or you confirm it. Until then it waits under "Not confirmed physical".
      </Text>

      <Title order={5}>Your own lists (optional)</Title>
      <Text size="sm">
        If you keep your own list of a console's games, it comes first: it decides which games count, and Wikipedia only adds games released after it. A list is a CSV with a title column (Title, Game or Name); status, release date, region and
        other names are read too. A spreadsheet's tabs, downloaded as CSV, work as they are. Choose several at once: each one's console is recognized from its Platform column or file name.
      </Text>
      <Group>
        <FileButton onChange={(f) => void choose(f)} accept=".csv,text/csv" multiple>
          {(props) => (
            <Button {...props} variant="default" leftSection={<IconTable size={16} />}>
              Choose lists
            </Button>
          )}
        </FileButton>
      </Group>
      {files.length > 0 && (
        <Table.ScrollContainer minWidth={520}>
          <Table verticalSpacing={4}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>File</Table.Th>
                <Table.Th>Console</Table.Th>
                <Table.Th ta="right">Games</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {files.map((f) => (
                <Table.Tr key={`${f.file.name}-${f.file.lastModified}`}>
                  <Table.Td>
                    <Text size="sm">{f.file.name}</Text>
                    {f.problems.length > 0 && (
                      <Text size="xs" c="orange">
                        {f.problems.join(' ')}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td miw={200}>
                    <Select
                      size="xs"
                      placeholder="Which console?"
                      data={choices.map((p) => ({ value: p.key, label: p.name }))}
                      value={f.platformKey}
                      onChange={(v) => setFiles((current) => current.map((x) => (x.file === f.file ? { ...x, platformKey: v } : x)))}
                      searchable
                      disabled={f.state !== 'ready'}
                    />
                  </Table.Td>
                  <Table.Td ta="right">{count(f.games)}</Table.Td>
                  <Table.Td>
                    {f.state === 'done' ? (
                      <Badge color="green" variant="light">
                        Saved
                      </Badge>
                    ) : f.state === 'failed' ? (
                      <Text size="xs" c="red">
                        {f.message}
                      </Text>
                    ) : f.state === 'uploading' ? (
                      <Loader size="xs" />
                    ) : null}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      {ready.length > 0 && (
        <Group>
          <Button onClick={() => void uploadAll()} loading={uploading}>
            Use {ready.length === 1 ? 'this list' : `these ${ready.length} lists`}
          </Button>
        </Group>
      )}

      <Title order={5}>Building</Title>
      {sources.isPending ? (
        <Loader size="sm" />
      ) : tracked.length === 0 ? (
        <Text size="sm" c="dimmed">
          No console is tracked yet.
        </Text>
      ) : (
        <>
          <Text size="sm">
            {built.length === tracked.length
              ? `All ${tracked.length} catalogs are built: ${count(built.reduce((sum, s) => sum + s.games, 0))} games.`
              : `${built.length} of ${tracked.length} catalogs built. Building takes a minute or two (Wikipedia is read slowly, as it asks).`}
          </Text>
          <Group gap={6}>
            {tracked.map((s) => (
              <Badge key={s.key} variant="light" color={s.error ? 'orange' : s.builtAt && !s.queued ? 'green' : 'gray'} tt="none" title={s.error ?? undefined}>
                {s.name}
                {s.builtAt && !s.queued ? `: ${count(s.games)}` : ''}
              </Badge>
            ))}
          </Group>
          {unbuilt.length > 0 && (
            <Group>
              <Button variant="default" size="xs" onClick={() => build.mutate(unbuilt)} loading={build.isPending}>
                Build the rest now
              </Button>
            </Group>
          )}
        </>
      )}
      <NextButton
        onNext={() => void (ready.length > 0 ? uploadAll().then((ok) => ok && onNext()) : onNext())}
        label={ready.length > 0 ? `Use ${ready.length === 1 ? 'the list' : `the ${ready.length} lists`} and go on` : 'Next'}
        loading={uploading}
      />
    </StepCard>
  );
}

/**
 * The last question for a new install: what the wishlist is (wishlist.source). Suggested is Squirrelcade's own ranked list;
 * Picked by you holds only the games the owner adds. Saved like any setting. An install that already had games isn't asked.
 */
function WishlistSourceStep({ asked, onNext }: { asked: boolean; onNext: () => void }) {
  const queryClient = useQueryClient();
  const def = settingDefinitions['wishlist.source'];
  const current = useSetting('wishlist.source', 'suggested');
  const save = useMutation({
    mutationFn: (value: string) => api('/settings', { method: 'PUT', json: { changes: { 'wishlist.source': value } } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
    onError: (err) => notifyError(err),
  });
  const done = () => {
    try {
      window.sessionStorage.removeItem(FRESH_KEY);
    } catch {
      // Nothing to forget.
    }
    onNext();
  };
  if (!asked) {
    return (
      <StepCard title="Your wishlist">
        <Text size="sm">
          Your wishlist is set to <b>{def.options?.find((o) => o.value === current)?.label ?? current}</b>. It can be changed any time on{' '}
          <Anchor component={Link} to="/acorns#setting-wishlist.source" size="sm">
            Acorns
          </Anchor>
          .
        </Text>
        <NextButton onNext={done} />
      </StepCard>
    );
  }
  return (
    <StepCard title="What your wishlist is">
      <Text size="sm">One question, and it can be changed any time on Acorns (Settings &gt; Acorns &gt; Your wishlist).</Text>
      <Radio.Group value={current} onChange={(v) => save.mutate(v)} name="wishlist-source" label={def.label}>
        <Stack gap="xs" mt="xs">
          <Radio value="suggested" label="Suggested (the ranked list)" description="Squirrelcade's own list of the games you're missing, ranked by acorns. Nothing to do: it fills itself." />
          <Radio
            value="mine"
            label="Picked by you (My wishlist)"
            description="Only the games you add yourself (from Suggestions, a game's page or Store Mode). The ranked list stays as Suggestions to choose from."
          />
        </Stack>
      </Radio.Group>
      <NextButton onNext={done} loading={save.isPending} />
    </StepCard>
  );
}

/** The end of the guide: where to go first, and the features list as "add these any time" (Settings > Features). */
function DoneStep() {
  const navigate = useNavigate();
  return (
    <StepCard title="You're set up">
      <Text size="sm">Squirrelcade works now. Look around before you add anything:</Text>
      <List size="sm" spacing={4}>
        <List.Item>
          <Anchor component={Link} to="/consoles" size="sm">
            Consoles
          </Anchor>
          : completion per console, and each console's missing games.
        </List.Item>
        <List.Item>
          <Anchor component={Link} to="/wishlist" size="sm">
            Acorns wishlist
          </Anchor>
          : what to get next, every acorn explained.
        </List.Item>
        <List.Item>
          <Anchor component={Link} to="/store" size="sm">
            Store Mode
          </Anchor>
          : in a store, type a game to see if you need it. (The phone's barcode camera needs a secure address: it's on the list below.)
        </List.Item>
      </List>
      <Title order={5} mt="xs">
        Add these any time
      </Title>
      <Text size="sm">
        There are a lot of optional features, and most need an outside account, so none is asked now. Each is on Settings &gt; Features with what it needs, how long it takes and a prompt for an AI that takes you through just that one.
      </Text>
      <Table verticalSpacing={2}>
        <Table.Tbody>
          {FEATURE_LIST.map((f) => (
            <Table.Tr key={f.id}>
              <Table.Td>
                <Text size="sm">{f.name}</Text>
              </Table.Td>
              <Table.Td>
                <Text size="xs" c="dimmed">
                  {featureTime(f)}
                </Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Group justify="space-between">
        <Button variant="default" onClick={() => navigate('/consoles')}>
          Go to Consoles
        </Button>
        <Button leftSection={<IconSparkles size={16} />} onClick={() => navigate('/settings/features')}>
          See the features list
        </Button>
      </Group>
    </StepCard>
  );
}
