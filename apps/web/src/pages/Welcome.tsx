import { KNOWN_PLATFORMS, listPlatform, parseCatalogList, settingDefinitions } from '@squirrelcade/core';
import { Alert, Anchor, Badge, Button, Card, FileButton, Group, List, Loader, NumberInput, Select, Stack, Stepper, Table, Text, Title } from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { useDebouncedCallback, useMediaQuery } from '@mantine/hooks';
import { IconCheck, IconFileSpreadsheet, IconPlugConnected, IconPlus, IconTable, IconUpload } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api';
import { SavedLabel } from '../SavedLabel';
import { TypedPasswordInput, TypedTextInput } from '../typedOnly';
import { PageHeader } from '../components';
import { count, dateTime } from '../format';
import { notifyError, notifySuccess, usePageTitle, useSetting, useSettingsState } from '../hooks';
import type { CatalogSourceStatus } from './CatalogSource';
import { EXPORT_FILES } from './Imports';
import { WishlistStep } from './WishlistSetup';

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
 * The welcome guide for a new install: the collection export, which consoles to track, their
 * catalogs (with the user's own lists, several at once), IGDB, and the wishlist's first order of
 * consoles and genres. Every step can be changed later.
 */
export function WelcomePage() {
  const appName = useSetting('general.instanceName', 'Squirrelcade') || 'Squirrelcade';
  usePageTitle('Welcome', appName);
  const narrow = useMediaQuery('(max-width: 48em)');
  const [step, setStep] = useState(0);
  const next = () => setStep((s) => s + 1);

  return (
    <>
      <PageHeader help="getting-started" title={`Welcome to ${appName}`} description="Five steps set it up. Each can be changed later in Settings, and this guide is on System › Status." />
      {/* The rest (covers, messages, your phone, the services you use) with the owner's own AI (0.32.1). */}
      <Text size="sm" c="dimmed" mb="md" maw={900}>
        After these, an AI you use (Claude, ChatGPT...) can take you through connecting everything else, one step at a time:{' '}
        <Anchor component={Link} to="/help/ai-setup" size="sm">
          AI-assisted setup
        </Anchor>
        .
      </Text>
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
        <Stepper.Step label="Covers" description={narrow ? undefined : 'IGDB, recommended'}>
          <IgdbStep onNext={next} />
        </Stepper.Step>
        <Stepper.Step label="Wishlist" description={narrow ? undefined : 'What you want most'}>
          <WishlistStep onNext={next} />
        </Stepper.Step>
        <Stepper.Completed>
          <DoneStep />
        </Stepper.Completed>
      </Stepper>
    </>
  );
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

function IgdbStep({ onNext }: { onNext: () => void }) {
  const queryClient = useQueryClient();
  const state = useSettingsState();
  const [clientId, setClientId] = useState<string | null>(null);
  const [secret, setSecret] = useState('');
  const secretSaved = state.data?.secretsSet.includes('sources.igdbClientSecret') ?? false;
  const savedId = state.data?.values['sources.igdbClientId'] ?? '';
  const id = clientId ?? savedId;
  const connect = useMutation({
    mutationFn: async () => {
      const changes: Record<string, string> = { 'sources.igdbClientId': id.trim() };
      if (secret.trim()) changes['sources.igdbClientSecret'] = secret.trim();
      await api('/settings', { method: 'PUT', json: { changes } });
      const result = await api<{ ok: boolean; message: string }>('/sources/igdb/test', { method: 'POST' });
      if (!result.ok) throw new Error(result.message);
      await api('/tasks/igdb-sync/run', { method: 'POST' });
      return result;
    },
    onSuccess: async (r) => {
      setSecret('');
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
      notifySuccess(`${r.message} The download runs in the background for a few minutes.`, 'IGDB');
    },
    onError: (err) => notifyError(err, 'IGDB'),
  });

  return (
    <StepCard title="Covers and game details (recommended)">
      <Text size="sm">
        IGDB is free and gives covers, genres and series, which the wishlist uses, and it tells which games had physical releases. Without it, the wishlist guesses from the names of the series you collect, and on consoles whose lists mix in download-only games (the Switch, PlayStation 4 and 5, Xbox One and Series X) most games wait as "not confirmed physical" instead of counting as missing. It takes about five minutes, with a Twitch developer app:
      </Text>
      <List size="sm" type="ordered">
        <List.Item>
          Sign in at{' '}
          <Anchor href="https://dev.twitch.tv/console/apps" target="_blank" size="sm">
            dev.twitch.tv/console/apps
          </Anchor>{' '}
          (a Twitch account with two-factor sign-in turned on).
        </List.Item>
        <List.Item>Register Your Application: any name, OAuth redirect URL http://localhost, category Application Integration, client type Confidential.</List.Item>
        <List.Item>Manage: copy the Client ID, then "New Secret" and copy the secret. Apps such as RomM can share the same pair.</List.Item>
      </List>
      <Group align="flex-end" gap="sm">
        <TypedTextInput label="Client ID" value={id} onValue={setClientId} w={280} autoComplete="off" />
        <TypedPasswordInput label={secretSaved ? <SavedLabel label="Client secret" /> : 'Client secret'} placeholder={secretSaved ? 'Saved' : ''} value={secret} onValue={setSecret} w={280} autoComplete="off" data-1p-ignore data-bwignore data-form-type="other" />
        <Button leftSection={<IconPlugConnected size={16} />} onClick={() => connect.mutate()} loading={connect.isPending} disabled={!id.trim() || (!secret.trim() && !secretSaved)}>
          Connect
        </Button>
      </Group>
      {connect.isSuccess && (
        <Alert color="green" icon={<IconCheck />}>
          Connected. Covers appear as the download finishes (System › Tasks shows it).
        </Alert>
      )}
      <NextButton onNext={onNext} label={connect.isSuccess || secretSaved ? 'Next' : 'Skip for now'} />
    </StepCard>
  );
}

function DoneStep() {
  const navigate = useNavigate();
  return (
    <StepCard title="You're set up">
      <List size="sm" spacing={4}>
        <List.Item>
          <Anchor component={Link} to="/platforms" size="sm">
            Platforms
          </Anchor>
          : completion per console, and each console's missing games.
        </List.Item>
        <List.Item>
          <Anchor component={Link} to="/review" size="sm">
            Review
          </Anchor>
          : titles that look alike, for you to answer once.
        </List.Item>
        <List.Item>
          <Anchor component={Link} to="/wishlist" size="sm">
            Wishlist
          </Anchor>
          : what to buy next, every acorn explained. Your tastes go in Acorns, in the menu.
        </List.Item>
        <List.Item>
          <Anchor component={Link} to="/store" size="sm">
            Store Mode
          </Anchor>
          : on your phone in a store, scan or type a game to see if you need it. Add it to your home screen from the browser's menu.
        </List.Item>
        <List.Item>
          <Anchor component={Link} to="/pc" size="sm">
            PC library
          </Anchor>{' '}
          (optional): your PC games from every storefront, read from Playnite's backups, and a{' '}
          <Anchor component={Link} to="/pc/wishlist" size="sm">
            PC wishlist
          </Anchor>
          . The PC library page says how to set it up.
        </List.Item>
        <List.Item>
          <Anchor component={Link} to="/settings/notifications" size="sm">
            Notifications
          </Anchor>
          : a summary after each collection update, by email, a phone app (Pushover, ntfy...) or a chat (Discord, Telegram...).
        </List.Item>
      </List>
      <Group justify="flex-end">
        <Button onClick={() => navigate('/platforms')}>Go to Platforms</Button>
      </Group>
    </StepCard>
  );
}
