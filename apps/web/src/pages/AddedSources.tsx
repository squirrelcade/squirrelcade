import { KNOWN_PLATFORMS } from '@squirrelcade/core';
import { Alert, Anchor, Button, FileButton, Group, List, Modal, Radio, SegmentedControl, Select, Stack, Text, TextInput } from '@mantine/core';
import { IconPlus, IconRefresh, IconTrash } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { count, dateTime } from '../format';
import { notifyError, notifySuccess, useSetting } from '../hooks';

/** A catalog source the user added: an online list or a CSV file (GET /api/v1/catalog-sources). */
export interface AddedSource {
  id: string;
  name: string;
  kind: 'link' | 'file';
  url: string | null;
  fileName: string | null;
  platformKey: string | null;
  counts: 'complete' | 'owned';
  games: number;
  consoles: { key: string; games: number }[];
  readAt: string;
  error: string | null;
}

/** What a list has, before it's added (POST /api/v1/catalog-sources/preview). */
interface ListPreview {
  usable: boolean;
  name: string;
  from: 'csv' | 'page';
  games: number;
  consoles: { key: string; games: number }[];
  regions: Record<string, number>;
  years: { from: number; to: number } | null;
  unknown: { name: string; games: number }[];
  consoleColumn: boolean;
  columns: string[];
  problems: string[];
}

const consoleName = (key: string) => KNOWN_PLATFORMS.find((p) => p.key === key)?.name ?? key;
const REGION_NAMES: Record<string, string> = { 'north-america': 'North America', europe: 'Europe', japan: 'Japan', other: 'other regions', none: 'not given' };
const CONSOLE_CHOICES = [...KNOWN_PLATFORMS].sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ value: p.key, label: p.name }));

/** A list's consoles in a few words: "Nintendo Switch 1,000, PlayStation 4 234 and 3 more consoles". */
export function consolesLine(consoles: { key: string; games: number }[]): string {
  const names = consoles.map((c) => `${consoleName(c.key)} ${count(c.games)}`);
  return names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more consoles`;
}

/** How an added source shows where it applies, beside its name: its console, or how many. */
export const addedWhere = (s: AddedSource) => (s.consoles.length === 1 ? consoleName(s.consoles[0]!.key) : `${s.consoles.length} consoles`);

function refreshAfter(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ['catalog-sources'] });
  void queryClient.invalidateQueries({ queryKey: ['catalogs'] });
}

/** Settings > Sources > Catalog sources: adds a source (an online list or a CSV file), showing what it has first. */
export function AddSourceButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="light" size="xs" leftSection={<IconPlus size={14} />} onClick={() => setOpen(true)} w="fit-content">
        Add a source
      </Button>
      <Modal opened={open} onClose={() => setOpen(false)} title="Add a catalog source" size="lg">
        {open && <AddSourceForm onDone={() => setOpen(false)} />}
      </Modal>
    </>
  );
}

function AddSourceForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<'link' | 'file'>('link');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [platform, setPlatform] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [counts, setCounts] = useState<'complete' | 'owned'>('complete');
  const [preview, setPreview] = useState<ListPreview | null>(null);

  /** The request's body: the address as JSON, or a form with the fields before the file (the server reads them so). */
  const body = (chosen: File | null, console: string | null, extra: Record<string, string> = {}) => {
    if (kind === 'link') return { json: { url, platform: console, ...extra } };
    const form = new FormData();
    if (console) form.append('platform', console);
    for (const [k, v] of Object.entries(extra)) form.append(k, v);
    form.append('file', chosen!);
    return { body: form };
  };
  const read = useMutation({
    mutationFn: ({ chosen, console }: { chosen: File | null; console: string | null }) => api<ListPreview>('/catalog-sources/preview', { method: 'POST', ...body(chosen, console) }),
    onSuccess: (p) => {
      setPreview(p);
      setName((n) => n || p.name);
    },
    onError: (err) => {
      setPreview(null);
      notifyError(err, "The list couldn't be read");
    },
  });
  const add = useMutation({
    mutationFn: () => api<AddedSource>('/catalog-sources', { method: 'POST', ...body(file, platform, { name, counts }) }),
    onSuccess: (s) => {
      notifySuccess(`${count(s.games)} games for ${consolesLine(s.consoles)}. It's at the bottom of the order: move it up to trust it more. Its consoles' catalogs are being rebuilt.`, `${s.name} added`);
      refreshAfter(queryClient);
      onDone();
    },
    onError: (err) => notifyError(err, "The source wasn't added"),
  });
  const restart = (k: 'link' | 'file') => {
    setKind(k);
    setPreview(null);
    setFile(null);
    setName('');
    setPlatform(null);
  };

  return (
    <Stack gap="sm">
      <SegmentedControl
        value={kind}
        onChange={(v) => restart(v as 'link' | 'file')}
        data={[
          { value: 'link', label: 'An online list' },
          { value: 'file', label: 'A CSV file' },
        ]}
      />
      {kind === 'link' ? (
        <Group align="flex-end" gap="xs" wrap="nowrap">
          <TextInput
            label="The list's address"
            description="A CSV file's address, a Google sheet shared with anyone who has the link, or a web page with a table of games. It's read again whenever catalogs are refreshed."
            placeholder="https://"
            value={url}
            onChange={(e) => setUrl(e.currentTarget.value)}
            style={{ flex: 1 }}
            type="url"
          />
          <Button onClick={() => read.mutate({ chosen: null, console: platform })} loading={read.isPending} disabled={!url.trim()}>
            Read it
          </Button>
        </Group>
      ) : (
        <Group gap="xs">
          <FileButton
            accept=".csv,.tsv,.txt,text/csv"
            onChange={(f) => {
              setFile(f);
              setPreview(null);
              if (f) read.mutate({ chosen: f, console: platform });
            }}
          >
            {(props) => (
              <Button {...props} variant="light" loading={read.isPending}>
                Choose a CSV file
              </Button>
            )}
          </FileButton>
          {file && (
            <Text size="sm" c="dimmed">
              {file.name}
            </Text>
          )}
        </Group>
      )}
      <Text size="xs" c="dimmed">
        A list needs a column named Title (or Game, or Name). A Platform (or Console) column spreads its games over several consoles; without one, you choose its console. Release date, Region, Status, Format and Notes are read when it has them.
        Only add lists their owners let you use.
      </Text>
      {preview && (
        <Alert color={preview.usable ? 'green' : 'orange'} title={preview.usable ? `${count(preview.games)} game${preview.games === 1 ? '' : 's'} found` : 'Nothing to add yet'}>
          <Stack gap={4}>
            {preview.consoles.length > 0 && <Text size="sm">For {consolesLine(preview.consoles)}.</Text>}
            {preview.games > 0 && (
              <Text size="sm">
                Regions:{' '}
                {Object.entries(preview.regions)
                  .sort((a, b) => b[1] - a[1])
                  .map(([r, n]) => `${REGION_NAMES[r] ?? r} ${count(n)}`)
                  .join(', ')}
                {preview.years ? `. Released ${preview.years.from === preview.years.to ? preview.years.from : `${preview.years.from} to ${preview.years.to}`}.` : '.'}
              </Text>
            )}
            {preview.columns.length > 0 && (
              <Text size="xs" c="dimmed">
                Read from {preview.from === 'page' ? "the page's table" : 'its columns'}: {preview.columns.join(', ')}.
              </Text>
            )}
            {preview.unknown.length > 0 && (
              <Text size="xs" c="dimmed">
                Left out, consoles Squirrelcade doesn't know: {preview.unknown.map((u) => `${u.name} (${count(u.games)})`).join(', ')}.
              </Text>
            )}
            {preview.problems.length > 0 && (
              <List size="sm">
                {preview.problems.map((p) => (
                  <List.Item key={p}>{p}</List.Item>
                ))}
              </List>
            )}
          </Stack>
        </Alert>
      )}
      {preview && !preview.consoleColumn && (
        <Select
          label="Which console is it for?"
          placeholder="Choose a console"
          data={CONSOLE_CHOICES}
          searchable
          value={platform}
          onChange={(v) => {
            setPlatform(v);
            if (v) read.mutate({ chosen: file, console: v });
          }}
        />
      )}
      {preview?.usable && (
        <>
          <TextInput label="Its name" description="How Settings and the consoles' pages name it." value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={80} />
          <Radio.Group label="Its games" value={counts} onChange={(v) => setCounts(v as 'complete' | 'owned')}>
            <Stack gap={6} mt={4}>
              <Radio value="complete" label="Count toward completion: they're games you collect" />
              <Radio value="owned" label="Count once you own one, as other regions' releases do (never missing)" />
            </Stack>
          </Radio.Group>
          <Group justify="flex-end">
            <Button onClick={() => add.mutate()} loading={add.isPending} disabled={!name.trim()}>
              Add it
            </Button>
          </Group>
        </>
      )}
    </Stack>
  );
}

/** An added source's details in the order (Settings > Sources): what it is, its games, how they count, reading it again, removing it. */
export function AddedSourceDetails({ source }: { source: AddedSource }) {
  const queryClient = useQueryClient();
  const dateFormat = useSetting('general.dateFormat', 'us');
  const [name, setName] = useState(source.name);
  const change = useMutation({
    mutationFn: (changes: { name?: string; counts?: 'complete' | 'owned' }) => api<AddedSource>(`/catalog-sources/${source.id}`, { method: 'PATCH', json: changes }),
    onSuccess: (s, changes) => {
      notifySuccess(changes.counts ? (changes.counts === 'owned' ? 'Its games now count once you own one; its consoles are being rebuilt.' : 'Its games now count toward completion; its consoles are being rebuilt.') : `Now named ${s.name}.`, 'Source changed');
      refreshAfter(queryClient);
    },
    onError: (err) => notifyError(err),
  });
  const readAgain = useMutation({
    mutationFn: () => api<AddedSource & { changed: string[] }>(`/catalog-sources/${source.id}/read`, { method: 'POST' }),
    onSuccess: (s) => {
      notifySuccess(s.changed.length === 0 ? `${count(s.games)} games, as before.` : `${count(s.games)} games; ${s.changed.length} console${s.changed.length === 1 ? "'s" : "s'"} catalog changed and is being rebuilt.`, `${s.name} read again`);
      refreshAfter(queryClient);
    },
    onError: (err) => {
      notifyError(err, "The list couldn't be read");
      refreshAfter(queryClient);
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/catalog-sources/${source.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      notifySuccess('Its games leave the catalogs (those you answered about stay).', `${source.name} removed`);
      refreshAfter(queryClient);
    },
    onError: (err) => notifyError(err),
  });
  return (
    <Stack gap={6}>
      <Text size="xs">
        {source.kind === 'link' ? (
          <>
            An online list,{' '}
            <Anchor href={source.url ?? undefined} target="_blank" rel="noreferrer" size="xs">
              {source.url}
            </Anchor>
            , read {dateTime(source.readAt, dateFormat)} and again whenever catalogs are refreshed.
          </>
        ) : (
          <>
            A CSV file, {source.fileName}, given {dateTime(source.readAt, dateFormat)}.
          </>
        )}{' '}
        {count(source.games)} games: {consolesLine(source.consoles)}. Like your own lists, it counts as proof of a physical release, but for a row whose status says not confirmed.
      </Text>
      <Group gap="xs" align="flex-end">
        <TextInput
          size="xs"
          label="Its name"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          onBlur={() => name.trim() && name.trim() !== source.name && change.mutate({ name })}
          maxLength={80}
        />
        <SegmentedControl
          size="xs"
          value={source.counts}
          onChange={(v) => change.mutate({ counts: v as 'complete' | 'owned' })}
          data={[
            { value: 'complete', label: 'Counts toward completion' },
            { value: 'owned', label: 'Counts once owned' },
          ]}
          aria-label={`How ${source.name}'s games count`}
        />
      </Group>
      <Group gap="xs">
        {source.kind === 'link' && (
          <Button size="xs" variant="light" leftSection={<IconRefresh size={14} />} onClick={() => readAgain.mutate()} loading={readAgain.isPending}>
            Read it again
          </Button>
        )}
        <Button
          size="xs"
          variant="subtle"
          color="red"
          leftSection={<IconTrash size={14} />}
          onClick={() => window.confirm(`Remove ${source.name}? Its games leave the catalogs; games you answered about stay.`) && remove.mutate()}
          loading={remove.isPending}
        >
          Remove
        </Button>
      </Group>
    </Stack>
  );
}
