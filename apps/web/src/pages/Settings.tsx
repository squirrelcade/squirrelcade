import {
  CHANNEL_GUIDES,
  CUSTOM_MAIL_GUIDE,
  FEATURE_SETTINGS,
  FEATURE_HOME,
  MAIL_PROVIDERS,
  featureOfSwitch,
  IGDB_GENRE_NAMES,
  IGDB_STYLE_NAMES,
  KNOWN_PLATFORMS,
  SETTINGS_EXPORT_FORMAT,
  SERVICE_GUIDES,
  SETTINGS_PAGES,
  settingDefinitions,
  settingFeature,
  settingKeys,
  shapePoints,
  type SettingDefinition,
  type Channel,
  type FeatureKey,
  type SettingKey,
  type ServiceGuideId,
  type ShapeSpec,
  type SourceSetting,
} from '@squirrelcade/core';
import {
  ActionIcon,
  Affix,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  FileButton,
  Group,
  List,
  Modal,
  NumberInput,
  Paper,
  Select,
  Stack,
  Switch,
  TagsInput,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { useLocalStorage, useMediaQuery } from '@mantine/hooks';
import { IconDownload, IconRestore, IconUpload } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router';
import { api, ApiError, type Issue } from '../api';
import { Acorn } from '../Acorn';
import { PageHeader } from '../components';
import { SavedLabel } from '../SavedLabel';
import { notifyError, notifySuccess, useSettingsState, type SettingsState } from '../hooks';
import { IgdbButtons, IgdbStatusTable } from './IgdbExtras';
import { RommButtons, RommStatusTable } from './RommExtras';
import { NotificationExtras } from './NotificationExtras';
import { timeZoneOptions } from '../timezones';
import { fileChanges, same, type FileChange } from '../settingsFile';
import { AiExtras } from './AiExtras';
import { SecurityExtras } from './SecurityExtras';
import { FeatureExtras } from './FeatureExtras';
import { ItadButtons } from './ItadExtras';
import { EmailTest } from './EmailExtras';
import { RaButtons } from './RaExtras';
import { AchievementButtons } from './AchievementExtras';
import { TelegramChatFinder } from './TelegramExtras';
import { SetupGuide } from '../SetupGuide';
import { TypedPasswordInput, TypedTextInput } from '../typedOnly';
import { PercentTiersEditor, PlatformCheckboxes, PointsEditor, SourceOrderEditor, TiersEditor } from './SettingEditors';
import type { AddedSource } from './AddedSources';
import { ShapeEditor } from './ShapeEditor';
import { SettingSearch } from './SettingSearch';

type Values = Partial<Record<SettingKey, unknown>>;

/** Each way to send messages by its switch on Settings > Notifications, for its setup steps under the switch. */
const CHANNEL_SWITCH: Partial<Record<string, Channel>> = {
  'notifications.pushoverEnabled': 'pushover',
  'notifications.pushbulletEnabled': 'pushbullet',
  'notifications.ntfyEnabled': 'ntfy',
  'notifications.gotifyEnabled': 'gotify',
  'notifications.discordEnabled': 'discord',
  'notifications.telegramEnabled': 'telegram',
  'notifications.slackEnabled': 'slack',
  'notifications.webhookEnabled': 'webhook',
  'notifications.appriseEnabled': 'apprise',
};

/** Sections that are a service without a switch of its own, and their setup steps. */
const SECTION_GUIDES: Record<string, ServiceGuideId> = {
  [settingDefinitions['sources.barcodeLookup'].section]: 'barcodes',
  [settingDefinitions['sources.ggdealsKey'].section]: 'ggdeals',
};

/** What the wishlist learned from the collection (GET /api/v1/wishlist/tastes), for the learned points lists. */
interface Tastes {
  months: number;
  minGames: number;
  platforms: { key: string; name: string; recent: number; owned: number; points: number | null }[];
  genres: { name: string; owned: number; catalog: number; lift: number; points: number | null }[];
}

/** The help guide for each settings page (docs/help). */
const SETTINGS_HELP: Record<string, string> = {
  general: 'getting-started',
  features: 'features',
  interface: 'getting-started',
  collection: 'collection',
  platforms: 'catalogs',
  catalogs: 'catalogs',
  pc: 'pc-library',
  wishlist: 'wishlist',
  sources: 'features',
  email: 'notifications',
  notifications: 'notifications',
  storage: 'backups',
  tasks: 'troubleshooting',
  security: 'sharing',
  friends: 'friends',
  ai: 'ai-apps',
};

/**
 * One settings page, built from the settings list: its fields by section, saving, reset, search, and
 * export and import. The wishlist's page is Wishlist > Scoring instead, where ranked points lists get
 * the shape editor.
 */
export function SettingsPage({ pageId: fixedPage }: { pageId?: string } = {}) {
  const { page: routePage } = useParams();
  const pageId = fixedPage ?? routePage;
  const scoring = pageId === 'wishlist';
  const page = SETTINGS_PAGES.find((p) => p.id === pageId);
  const queryClient = useQueryClient();
  const { data: state } = useSettingsState();
  const saved = state?.values;
  const secretsSet = new Set(state?.secretsSet);
  const [draft, setDraft] = useState<Values>({});
  const [issues, setIssues] = useState<Issue[]>([]);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState<{
    fileName: string;
    data: { settings?: Record<string, unknown> };
    count: number;
    missing: SettingKey[];
    /** What the file changes, as the window lists it, and the names in it that aren't settings. */
    changes: FileChange[];
    unknown: string[];
  } | null>(null);
  const [advanced, setAdvanced] = useLocalStorage({ key: 'squirrelcade-show-advanced', defaultValue: false });

  useEffect(() => {
    setDraft({});
    setIssues([]);
  }, [pageId]);

  // "Find a setting" links to /settings/<page>#setting-<key>: scroll to it and highlight it briefly.
  const { hash } = useLocation();
  // Once the settings are there (a slow load had nothing to scroll to yet).
  const loaded = Boolean(state);
  useEffect(() => {
    if (!hash.startsWith('#setting-') || !loaded) return;
    // A link to an advanced setting (from the AI setup prompt, say) shows the advanced settings first.
    const linked = settingDefinitions[decodeURIComponent(hash.slice('#setting-'.length)) as SettingKey] as SettingDefinition | undefined;
    if (linked?.advanced && !advanced) {
      setAdvanced(true);
      return;
    }
    const timer = setTimeout(() => {
      const el = document.getElementById(hash.slice(1));
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: el.offsetHeight > window.innerHeight * 0.6 ? 'start' : 'center' });
      el.style.transition = 'box-shadow 0.3s';
      el.style.boxShadow = '0 0 0 2px var(--mantine-color-forest-5)';
      el.style.borderRadius = '4px';
      setTimeout(() => (el.style.boxShadow = ''), 1800);
    }, 150);
    return () => clearTimeout(timer);
  }, [hash, pageId, advanced, loaded]);

  // Point shapes aren't a field: the shape editors keep them.
  const keys = useMemo(() => settingKeys.filter((k) => settingDefinitions[k].page === pageId && settingDefinitions[k].kind !== 'shapes'), [pageId]);
  const hiddenAdvanced = keys.filter((k) => (settingDefinitions[k] as SettingDefinition).advanced).length;
  // Console completion counts by percent or by games left: only the tiers in use show.
  const completionBy = pageId === 'wishlist' ? String(draft['wishlist.completionBy'] ?? state?.values['wishlist.completionBy'] ?? '') : '';
  const unused = new Set<SettingKey>(completionBy === 'left' ? ['wishlist.completionPercentTiers'] : completionBy === 'percent' ? ['wishlist.completionTiers'] : []);
  // Settings of an optional part that's off hide, keeping their values, except where the part is set up (its home:
  // a service's card on Sources, Email, the PC library's page), which shows them with the part's switch.
  const featureOff = (k: SettingKey) => {
    const f = settingFeature(k);
    return f !== null && FEATURE_HOME[f] !== pageId && state?.values[FEATURE_SETTINGS[f]] === false;
  };
  // A service's fields show under its switch, while the switch is on (as the page has it, before saving too).
  const switchedOff = (k: SettingKey) => {
    const when = (settingDefinitions[k] as SettingDefinition).shownWhen as SettingKey | undefined;
    if (!when) return false;
    return (when in draft ? draft[when] : state?.values[when]) !== true;
  };
  // The parts whose settings on this page are hidden, each with how many.
  const offParts = [...new Set(keys.filter(featureOff).map((k) => settingFeature(k)!))].map((f) => ({ feature: f, count: keys.filter((k) => settingFeature(k) === f).length }));
  const visible = keys.filter((k) => (advanced || !(settingDefinitions[k] as SettingDefinition).advanced) && !unused.has(k) && !featureOff(k) && !switchedOff(k));
  // The parts set up on this page, each by the first of its sections here: their switch and steps open that card.
  const homeFeatures = new Map<string, FeatureKey>();
  for (const k of visible) {
    const f = settingFeature(k);
    if (f !== null && FEATURE_HOME[f] === pageId && ![...homeFeatures.values()].includes(f)) homeFeatures.set(settingDefinitions[k].section, f);
  }
  const sections = [...new Set(visible.map((k) => settingDefinitions[k].section))];

  // On a phone the unsaved-changes bar sits above the bar at the bottom of the screen (0.51.0).
  const phone = useMediaQuery('(max-width: 47.99em)') ?? false;
  if (!page) return <Navigate to="/settings/general" replace />;
  if (pageId === 'wishlist' && !fixedPage) return <Navigate to={`/acorns${hash}`} replace />;
  if (!saved) return null;

  const value = (key: SettingKey) => (key in draft ? draft[key] : saved[key]);
  // Secrets come back blank. Typing a new one is a change; null in the draft means "remove the saved one".
  const isChanged = (k: SettingKey) =>
    settingDefinitions[k].kind === 'secret' ? (draft[k] === null ? secretsSet.has(k) : draft[k] !== '') : !same(draft[k], saved[k]);
  const changedKeys = (Object.keys(draft) as SettingKey[]).filter(isChanged);
  const restartNeeded = changedKeys.some((k) => (settingDefinitions[k] as SettingDefinition).restartRequired);

  function update(key: SettingKey, v: unknown) {
    setDraft((d) => {
      const next: Values = { ...d, [key]: v };
      // Choosing an email provider fills in its mail server and port.
      const provider = key === 'notifications.emailProvider' ? MAIL_PROVIDERS.find((m) => m.id === v) : undefined;
      if (provider) {
        next['notifications.smtpHost'] = provider.host;
        next['notifications.smtpPort'] = provider.port;
      }
      return next;
    });
    setIssues((list) => list.filter((i) => i.key !== key));
  }

  /** The setup steps that go under a setting: an email provider's, or a service's under its switch while it's on. */
  function guideAfter(k: SettingKey) {
    if (k === 'notifications.emailProvider') {
      const provider = MAIL_PROVIDERS.find((m) => m.id === value(k));
      return <SetupGuide guide={provider?.guide ?? CUSTOM_MAIL_GUIDE} title={provider ? `Setting up ${provider.name}` : 'Another provider'} folded />;
    }
    const channel = CHANNEL_SWITCH[k];
    const guide = channel ? CHANNEL_GUIDES[channel] : undefined;
    return guide && value(k) === true ? <SetupGuide guide={guide} folded /> : null;
  }

  /** A ranked points list's shape on the Scoring page (undefined forgets it: the list is your own numbers). */
  function shapeOf(key: SettingKey) {
    const all = (value('wishlist.pointShapes') ?? {}) as Record<string, ShapeSpec>;
    return {
      spec: all[key],
      onChange: (spec: ShapeSpec | undefined) =>
        setDraft((d) => {
          const current = { ...(('wishlist.pointShapes' in d ? d['wishlist.pointShapes'] : saved?.['wishlist.pointShapes']) as Record<string, ShapeSpec>) };
          if (spec) current[key] = spec;
          else delete current[key];
          return { ...d, 'wishlist.pointShapes': current };
        }),
    };
  }

  /** The test (and update) buttons that go right under a service's key. */
  const buttonsAfter = (k: SettingKey) =>
    k === 'sources.igdbClientSecret' ? (
      <IgdbButtons unsaved={changedKeys.length > 0} save={save} />
    ) : k === 'sources.rommToken' ? (
      <RommButtons unsaved={changedKeys.length > 0} save={save} />
    ) : k === 'sources.itadKey' ? (
      <ItadButtons unsaved={changedKeys.length > 0} save={save} />
    ) : k === 'notifications.smtpPassword' ? (
      <EmailTest unsaved={changedKeys.length > 0} save={save} />
    ) : k === 'sources.raApiKey' ? (
      <RaButtons unsaved={changedKeys.length > 0} save={save} />
    ) : k === 'sources.xboxApiKey' ? (
      <AchievementButtons source="xbox" unsaved={changedKeys.length > 0} save={save} />
    ) : k === 'sources.psnToken' ? (
      <AchievementButtons source="playstation" unsaved={changedKeys.length > 0} save={save} />
    ) : k === 'sources.steamId' ? (
      <AchievementButtons source="steam" unsaved={changedKeys.length > 0} save={save} />
    ) : k === 'notifications.telegramToken' ? (
      <TelegramChatFinder unsaved={changedKeys.length > 0} save={save} onPick={(id) => update('notifications.telegramChatId', id)} />
    ) : null;

  /** Under a switch of Settings > Features: where the part is set up (its keys and steps are there, and only there). */
  function setupLink(feature: FeatureKey) {
    const home = FEATURE_HOME[feature];
    if (!home) return null;
    const title = SETTINGS_PAGES.find((p) => p.id === home)?.title ?? home;
    return (
      <Button component={Link} to={`/settings/${home}#setting-${FEATURE_SETTINGS[feature]}`} size="xs" variant="light" mt="xs">
        Set it up on Settings › {title}
      </Button>
    );
  }

  /** At the top of a part's card on its home page: its switch, then its steps, folded under "Set it up". */
  function homeTop(section: string) {
    const f = homeFeatures.get(section);
    const guide = f !== undefined && f in SERVICE_GUIDES ? SERVICE_GUIDES[f as ServiceGuideId] : SECTION_GUIDES[section] ? SERVICE_GUIDES[SECTION_GUIDES[section]] : undefined;
    if (f === undefined && !guide) return null;
    const sw = f !== undefined ? (FEATURE_SETTINGS[f] as SettingKey) : null;
    return (
      <>
        {sw && (
          <div id={`setting-${sw}`}>
            <Field settingKey={sw} value={value(sw)} secretSaved={false} onChange={(v) => update(sw, v)} issue={issues.find((i) => i.key === sw)?.message} />
          </div>
        )}
        {f === 'itad' && value(FEATURE_SETTINGS.pc) !== true && (
          <Alert color="yellow" p="xs">
            PC game prices are for the PC wishlist: turn on the PC library too.
          </Alert>
        )}
        {guide && <SetupGuide guide={guide} folded />}
      </>
    );
  }


  /** Saves the changes on this page; false when they couldn't be saved (the problems are shown). */
  async function save(): Promise<boolean> {
    setSaving(true);
    try {
      const changes = Object.fromEntries(changedKeys.map((k) => [k, draft[k] ?? '']));
      const res = await api<SettingsState>('/settings', { method: 'PUT', json: { changes } });
      queryClient.setQueryData(['settings'], res);
      setDraft({});
      setIssues([]);
      // The wishlist and what it learned follow the new scoring.
      if (scoring) void queryClient.invalidateQueries({ queryKey: ['wishlist'] });
      notifySuccess(restartNeeded ? 'Saved. Some changes take effect after a restart.' : 'Settings saved.');
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.issues.length > 0) setIssues(err.issues);
      else notifyError(err, "Couldn't save");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function exportFile() {
    const data = await api<object>('/settings/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `squirrelcade-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /** Reads a settings file and asks how to apply it, naming the settings of yours it doesn't have. */
  async function importFile(file: File | null) {
    if (!file || !saved) return;
    try {
      const data = JSON.parse(await file.text()) as { format?: string; settings?: Record<string, unknown> };
      if (data?.format !== SETTINGS_EXPORT_FORMAT || typeof data.settings !== 'object' || data.settings === null) throw new Error('Not a Squirrelcade settings file.');
      const inFile = data.settings;
      const missing = settingKeys.filter(
        (k) => settingDefinitions[k].kind !== 'secret' && !(k in inFile) && !same(saved[k], (settingDefinitions[k] as SettingDefinition).default),
      );
      setImporting({ fileName: file.name, data, count: Object.keys(inFile).length, missing, ...fileChanges(inFile, saved) });
    } catch (err) {
      notifyError(err, "Couldn't read the settings file");
    }
  }

  /** Imports the file. Keeping adds the user's current values the file doesn't have, so only the file's settings change. */
  async function applyImport(keep: boolean) {
    if (!importing || !saved) return;
    const { data, missing } = importing;
    const settings = keep ? { ...Object.fromEntries(missing.map((k) => [k, saved[k]])), ...data.settings } : data.settings;
    try {
      const res = await api<SettingsState>('/settings/import', { method: 'POST', json: { ...data, settings } });
      queryClient.setQueryData(['settings'], res);
      setDraft({});
      setImporting(null);
      notifySuccess(keep ? "The file's settings were applied; the rest stayed as they were." : 'Settings replaced by the file.');
    } catch (err) {
      notifyError(err, "Couldn't import settings");
    }
  }

  return (
    <>
      <PageHeader
        help={SETTINGS_HELP[page.id]}
        title={
          scoring ? (
            <>
              Acorns ranking <Acorn size={24} />
            </>
          ) : (
            page.title
          )
        }
        description={
          scoring
            ? "Acorns are how much you'd want a game you don't have: each rule below gives a game acorns (or takes some away), and the games with the most lead your wishlist. They're never a review score. Give a ranked list a shape (a straight line, exponential...) and drag its entries along the line, or set every number yourself."
            : page.description
        }
        actions={
          scoring ? (
            <Switch label="Show advanced" checked={advanced} onChange={(e) => setAdvanced(e.currentTarget.checked)} />
          ) : (
          <>
            <SettingSearch onAdvancedNeeded={() => setAdvanced(true)} />
            <Switch label="Show advanced" checked={advanced} onChange={(e) => setAdvanced(e.currentTarget.checked)} />
            <Tooltip label="Download all your settings as a file">
              <Button variant="default" size="xs" leftSection={<IconDownload size={14} />} onClick={exportFile}>
                Export
              </Button>
            </Tooltip>
            <FileButton onChange={importFile} accept="application/json">
              {(props) => (
                <Button {...props} variant="default" size="xs" leftSection={<IconUpload size={14} />}>
                  Import
                </Button>
              )}
            </FileButton>
          </>
          )
        }
      />
      <Stack pb={changedKeys.length > 0 ? 80 : 0}>
        {(pageId === 'notifications' || pageId === 'collection') && (
          <Alert color="gray" variant="light">
            <Text size="sm">
              {pageId === 'notifications'
                ? 'Notifications by email use your email account, set up once on Settings › Email. '
                : "Stash updates from PriceCharting's export emails are set up on Settings › Email. "}
              <Anchor component={Link} to="/settings/email" size="sm">
                Go to Settings › Email
              </Anchor>
            </Text>
          </Alert>
        )}
        {sections.map((section) => (
          <Card key={section} withBorder>
            <Title order={5} mb="sm">
              {section}
            </Title>
            <Stack gap="md">
              {homeTop(section)}
              {visible
                .filter((k) => settingDefinitions[k].section === section)
                .map((k) => (
                  <div key={k} id={`setting-${k}`}>
                    <Field
                      settingKey={k}
                      value={value(k)}
                      secretSaved={secretsSet.has(k)}
                      onChange={(v) => update(k, v)}
                      issue={issues.find((i) => i.key === k)?.message}
                      shape={scoring && settingDefinitions[k].kind === 'points' ? shapeOf(k) : undefined}
                    />
                    {/* A service's test goes right under its key; its setup steps under its switch. */}
                    {buttonsAfter(k) && <Box mt="sm">{buttonsAfter(k)}</Box>}
                    {guideAfter(k)}
                    {pageId === 'features' && featureOfSwitch(k) && setupLink(featureOfSwitch(k)!)}
                  </div>
                ))}
              {pageId === 'sources' && section === settingDefinitions['sources.igdbClientId'].section && <IgdbStatusTable />}
              {pageId === 'sources' && section === settingDefinitions['sources.rommUrl'].section && <RommStatusTable />}
            </Stack>
          </Card>
        ))}
        {!advanced && hiddenAdvanced > 0 && (
          <Text size="xs" c="dimmed">
            {hiddenAdvanced} advanced setting{hiddenAdvanced === 1 ? ' is' : 's are'} hidden. Turn on "Show advanced" to see {hiddenAdvanced === 1 ? 'it' : 'them'}.
          </Text>
        )}
        {offParts.map(({ feature, count: n }) => (
          <Alert key={feature} color="gray" variant="light" title={`${(settingDefinitions[FEATURE_SETTINGS[feature]] as SettingDefinition).label} is off`}>
            <Text size="sm">
              {n === keys.length ? "This page's settings belong" : `${n} of this page's settings belong`} to it, and show here once it's on. Turn it on where it is
              set up.
            </Text>
            <Button
              component={Link}
              to={`/settings/${FEATURE_HOME[feature] ?? 'features'}#setting-${FEATURE_SETTINGS[feature]}`}
              size="xs"
              variant="light"
              mt="xs"
            >
              Go to Settings › {SETTINGS_PAGES.find((p) => p.id === (FEATURE_HOME[feature] ?? 'features'))?.title}
            </Button>
          </Alert>
        ))}
        {pageId === 'features' && <FeatureExtras />}
        {pageId === 'ai' && <AiExtras />}
        {pageId === 'security' && <SecurityExtras />}
        {pageId === 'notifications' && <NotificationExtras unsaved={changedKeys.length > 0} />}
      </Stack>
      {changedKeys.length > 0 && (
        <Affix position={{ bottom: phone ? 80 : 16, right: 16 }}>
          <Paper withBorder shadow="lg" p="sm">
            <Group gap="sm">
              <Text size="sm">
                {changedKeys.length} unsaved change{changedKeys.length === 1 ? '' : 's'}
              </Text>
              <Button variant="default" onClick={() => (setDraft({}), setIssues([]))}>
                Discard
              </Button>
              <Button onClick={save} loading={saving}>
                Save changes
              </Button>
            </Group>
          </Paper>
        </Affix>
      )}
      <Modal opened={importing !== null} onClose={() => setImporting(null)} title="Import settings" size="lg">
        {importing && (
          <Stack gap="sm">
            <Text size="sm">
              {importing.fileName} has {importing.count} setting{importing.count === 1 ? '' : 's'}. Saved passwords and keys are kept either way.
            </Text>
            {importing.unknown.length > 0 && (
              <Alert color="red" variant="light">
                Squirrelcade has no setting called {importing.unknown.join(', ')}, so it won't take this file. Take {importing.unknown.length === 1 ? 'it' : 'them'} out of the file, or ask whoever wrote it.
              </Alert>
            )}
            {importing.changes.length > 0 ? (
              <>
                <Text size="sm">What the file changes:</Text>
                <List size="sm" spacing={2} withPadding>
                  {importing.changes.slice(0, 40).map((c) => (
                    <List.Item key={c.key}>
                      {c.where}: {c.before} → <b>{c.after}</b>
                    </List.Item>
                  ))}
                </List>
                {importing.changes.length > 40 && <Text size="sm">And {importing.changes.length - 40} more.</Text>}
              </>
            ) : (
              <Text size="sm">It changes nothing: every setting in it is as you have it.</Text>
            )}
            {importing.missing.length > 0 ? (
              <>
                <Text size="sm">These settings of yours aren't in the file:</Text>
                <List size="sm" spacing={2} withPadding>
                  {importing.missing.map((k) => (
                    <List.Item key={k}>
                      {SETTINGS_PAGES.find((p) => p.id === settingDefinitions[k].page)?.title} › {settingDefinitions[k].label}
                    </List.Item>
                  ))}
                </List>
                <Group justify="flex-end" gap="sm">
                  <Button variant="subtle" color="red" onClick={() => void applyImport(false)}>
                    Replace all settings
                  </Button>
                  <Button onClick={() => void applyImport(true)}>Apply the file, keep these</Button>
                </Group>
              </>
            ) : (
              <Group justify="flex-end" gap="sm">
                <Button variant="default" onClick={() => setImporting(null)}>
                  Cancel
                </Button>
                <Button onClick={() => void applyImport(false)}>Import</Button>
              </Group>
            )}
          </Stack>
        )}
      </Modal>
      {issues.length > 0 && (
        <Alert color="red" mt="md" title="Some values need fixing">
          {issues.map((i) => `${settingDefinitions[i.key as SettingKey]?.label ?? i.key}: ${i.message}`).join(' ')}
        </Alert>
      )}
    </>
  );
}

function Field({
  settingKey,
  value,
  secretSaved,
  onChange,
  issue,
  shape,
}: {
  settingKey: SettingKey;
  value: unknown;
  secretSaved: boolean;
  onChange: (v: unknown) => void;
  issue?: string;
  /** For a points list on the Scoring page: its shape, edited with the shape editor. */
  shape?: { spec: ShapeSpec | undefined; onChange: (spec: ShapeSpec | undefined) => void };
}) {
  const def = settingDefinitions[settingKey] as SettingDefinition & { keyLabel?: string; countLabel?: string };
  const platformNames = useQuery({
    queryKey: ['platforms'],
    queryFn: () => api<{ key: string; name: string; eligible: boolean }[]>('/platforms'),
    enabled: settingKey === 'wishlist.platformPoints' || def.platforms !== undefined || settingKey === 'sources.igdbPlatformIds' || settingKey === 'sources.igdbExtraPlatformIds',
  });
  const names = new Map(platformNames.data?.map((p) => [p.key, p.name]));
  // Platform and genre points left empty are learned from the collection (see the server's tastes.ts).
  const learnable = !!shape && (settingKey === 'wishlist.platformPoints' || settingKey === 'wishlist.genrePoints');
  const tastes = useQuery({ queryKey: ['wishlist', 'tastes'], queryFn: () => api<Tastes>('/wishlist/tastes'), enabled: learnable });
  // The catalog sources' last readings, shown beside each source.
  const sourceStatus = useQuery({
    queryKey: ['catalogs', 'source-status'],
    queryFn: () => api<Record<string, { summary: string; error: string | null; at: string | null }>>('/catalogs/source-status'),
    enabled: def.kind === 'sources',
  });
  // The sources the user added (an online list or a CSV file each), in the order with the built-in ones.
  const addedSources = useQuery({ queryKey: ['catalog-sources'], queryFn: () => api<AddedSource[]>('/catalog-sources'), enabled: def.kind === 'sources' });
  const isDefault = same(value, def.default);
  const label = (
    <Group gap={6} component="span">
      <span>{def.label}</span>
      {def.restartRequired && (
        <Badge size="xs" variant="light" color="orange">
          restart
        </Badge>
      )}
      {!isDefault && (
        <Tooltip label={`Reset to default (${formatDefault(def)})`}>
          <ActionIcon size="xs" variant="subtle" onClick={() => (onChange(structuredClone(def.default)), shape?.onChange(undefined))} aria-label="Reset to default">
            <IconRestore size={12} />
          </ActionIcon>
        </Tooltip>
      )}
    </Group>
  );
  const common = { label, description: def.description, error: issue, maw: 520 };

  if (def.kind === 'secret') {
    const removing = value === null;
    return (
      <Group align="flex-end" gap="xs" maw={520} wrap="nowrap">
        <TypedPasswordInput
          label={secretSaved && !removing ? <SavedLabel label={def.label} /> : def.label}
          description={def.description}
          error={issue}
          style={{ flex: 1 }}
          autoComplete="new-password"
          data-1p-ignore
          data-bwignore
          data-form-type="other"
          value={removing ? '' : String(value ?? '')}
          onValue={onChange}
          placeholder={removing ? 'Will be removed when you save' : secretSaved ? 'Saved. Type a new one to replace it.' : 'Not set'}
        />
        {secretSaved && !removing && (
          <Button variant="default" onClick={() => onChange(null)}>
            Remove
          </Button>
        )}
      </Group>
    );
  }
  if (settingKey === 'general.timeZone') {
    return <Select {...common} data={timeZoneOptions()} value={String(value ?? '')} onChange={(v) => onChange(v ?? '')} searchable allowDeselect={false} />;
  }
  switch (def.kind) {
    case 'points':
      if (shape) {
        const platformList = settingKey === 'wishlist.platformPoints';
        const t = tastes.data;
        if (learnable && t && Object.keys(value as Record<string, number>).length === 0) {
          const order = platformList ? t.platforms.filter((p) => p.recent >= t.minGames).map((p) => p.key) : t.genres.map((g) => g.name);
          const base = shape.spec ?? { shape: 'linear' as const, top: 22, bottom: 0, order: [] };
          const spec: ShapeSpec = { ...base, shape: base.shape === 'custom' ? 'linear' : base.shape, order };
          const top = t.genres[0];
          return (
            <ShapeEditor
              label={label}
              description={def.description}
              value={shapePoints(spec)}
              spec={spec}
              learned={
                <>
                  {platformList
                    ? `Learned from your collection: the consoles you added at least ${t.minGames} games to in the last ${t.months} months, the most first.`
                    : `Learned from your collection: genres you own more of than the catalogs hold come first${top ? ` (${top.name}: ${top.lift} times its share)` : ''}.`}{' '}
                  A new shape keeps it learning; moving, adding or changing an entry makes the list your own (the reset button next to its name goes back to learning).
                </>
              }
              onShapeOnly={(s) => shape.onChange({ ...s, order: [] })}
              onChange={(points, s) => {
                onChange(points);
                shape.onChange(s);
              }}
              keyLabel={def.keyLabel ?? 'Name'}
              keyHint={platformList ? (k) => names.get(k) : undefined}
              addOptions={platformList ? (platformNames.data ?? []).map((p) => ({ value: p.key, label: p.name })) : IGDB_GENRE_NAMES.map((g) => ({ value: g, label: g }))}
              freeAdd={!platformList}
              error={issue}
            />
          );
        }
        return (
          <ShapeEditor
            label={label}
            description={def.description}
            value={value as Record<string, number>}
            spec={shape.spec}
            onChange={(points, spec) => {
              onChange(points);
              shape.onChange(spec);
            }}
            keyLabel={def.keyLabel ?? 'Name'}
            keyHint={platformList ? (k) => names.get(k) : undefined}
            addOptions={
              platformList
                ? (platformNames.data ?? []).map((p) => ({ value: p.key, label: p.name }))
                : settingKey === 'wishlist.genrePoints'
                  ? IGDB_GENRE_NAMES.map((g) => ({ value: g, label: g }))
                  : settingKey === 'wishlist.stylePoints'
                    ? IGDB_STYLE_NAMES.map((g) => ({ value: g, label: g }))
                    : undefined
            }
            freeAdd={!platformList}
            fixedKeys={Object.keys(def.default as Record<string, number>).length > 0}
            error={issue}
          />
        );
      }
      return (
        <PointsEditor
          label={label}
          description={def.description}
          value={value as Record<string, number>}
          onChange={onChange}
          keyLabel={def.keyLabel ?? 'Name'}
          keyHint={settingKey === 'wishlist.platformPoints' || settingKey === 'sources.igdbPlatformIds' || settingKey === 'sources.igdbExtraPlatformIds' ? (k) => names.get(k) : undefined}
          error={issue}
        />
      );
    case 'tiers':
      return <TiersEditor label={label} description={def.description} value={value as { max: number; points: number }[]} onChange={onChange} countLabel={def.countLabel ?? 'Count'} error={issue} />;
    case 'sources':
      return <SourceOrderEditor label={label} description={def.description} value={value as SourceSetting[]} onChange={onChange} status={sourceStatus.data} added={addedSources.data} error={issue} />;
    case 'percentTiers':
      return <PercentTiersEditor label={label} description={def.description} value={value as { min: number; points: number }[]} onChange={onChange} countLabel={def.countLabel ?? 'Share'} error={issue} />;
    case 'boolean':
      return <Switch label={label} description={def.description} checked={Boolean(value)} onChange={(e) => onChange(e.currentTarget.checked)} error={issue} />;
    case 'number':
      return (
        <NumberInput
          {...common}
          value={value as number}
          onChange={(v) => onChange(typeof v === 'number' ? v : Number(v))}
          min={def.min}
          max={def.max}
          allowDecimal={Boolean(def.decimals)}
          decimalScale={def.decimals}
          rightSection={def.unit ? <Text size="xs" c="dimmed" pr="sm">{def.unit}</Text> : undefined}
          rightSectionWidth={def.unit ? 70 : undefined}
        />
      );
    case 'select':
      return <Select {...common} data={(def.options ?? []).map((o) => ({ value: o.value, label: o.label }))} value={String(value)} onChange={(v) => v && onChange(v)} allowDeselect={false} />;
    case 'list':
      if (def.platforms) {
        // Consoles are ticked, not typed: the tracked ones, or every console Squirrelcade knows.
        const options =
          def.platforms === 'tracked'
            ? (platformNames.data ?? []).filter((p) => p.eligible).map((p) => ({ key: p.key, name: p.name }))
            : KNOWN_PLATFORMS.map((p) => ({ key: p.key, name: names.get(p.key) ?? p.name }));
        return <PlatformCheckboxes label={label} description={def.description} value={value as string[]} onChange={onChange} options={options.sort((a, b) => a.name.localeCompare(b.name))} error={issue} />;
      }
      return <TagsInput {...common} value={value as string[]} onChange={onChange} placeholder="Type and press Enter" clearable />;
    default:
      return <TypedTextInput {...common} value={String(value ?? '')} onValue={onChange} placeholder={def.kind === 'path' ? 'Automatic' : undefined} />;
  }
}

function formatDefault(def: SettingDefinition): string {
  if (def.kind === 'select') return def.options?.find((o) => o.value === def.default)?.label ?? String(def.default);
  if (def.kind === 'boolean') return def.default ? 'on' : 'off';
  if (Array.isArray(def.default)) return def.default.length ? def.default.join(', ') : 'empty';
  if (def.default === '') return 'automatic';
  return `${String(def.default)}${def.unit ? ` ${def.unit}` : ''}`;
}
