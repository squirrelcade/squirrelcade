import { CATALOG_SOURCES, isAddedSource, type SourceConflict, type SourceContribution } from '@squirrelcade/core';
import { Alert, Anchor, Button, Card, FileButton, Group, List, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconArrowsJoin, IconRefresh, IconTable, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useEffect, useState } from 'react';
import { api } from '../api';
import { count, date, dateTime, releaseDate } from '../format';
import { notifyError, notifySuccess, useSetting } from '../hooks';
import type { AddedSource } from './AddedSources';

/** Where a console's catalog comes from and how its last build went (GET /api/v1/catalogs/sources). */
export interface CatalogSourceStatus {
  key: string;
  name: string;
  tracked: boolean;
  pages: string[];
  builtAt: string | null;
  games: number;
  skipped: { region: number; digital: number; download?: number; unlicensed: number; other: number; older?: number } | null;
  error: string | null;
  queued: boolean;
  list: { fileName: string; games: number; uploadedAt: string } | null;
  /** Games Wikipedia marks as download titles: they count once shown physical. */
  downloads: number;
  /** Mappings from the user's file: owned titles that count as catalog games. */
  mappings: number;
  /** What each source gave the last build, most trusted first (Settings > Sources). */
  sources: SourceContribution[];
  /** Where the sources disagreed in the last build: the higher source's value stands. */
  conflicts: SourceConflict[];
}

/** A source's name in a sentence: "your list", "Nintendo Life", or the name of a source the user added. */
const nameOf = (id: string, added: readonly AddedSource[] = []) =>
  id === 'list' ? 'your list' : (CATALOG_SOURCES.find((c) => c.id === id)?.name ?? added.find((a) => a.id === id)?.name ?? (isAddedSource(id) ? 'a list you added' : id));

/** What a source gave a build, in a few words: "155 games", "8 added, 17 facts used". */
function contribution(c: SourceContribution): string {
  if (c.id === 'list') return `${count(c.listed)} games`;
  const parts = [`${count(c.added)} added`, c.filled > 0 && `${count(c.filled)} facts used`].filter(Boolean);
  return parts.join(', ');
}

const FACT_WORDS: Record<SourceConflict['fact'], string> = { format: 'format', releaseDate: 'release date' };

/** The address of a Wikipedia page by its title. */
export const wikipediaUrl = (page: string) => `https://en.wikipedia.org/wiki/${encodeURIComponent(page.replace(/ /g, '_'))}`;

/**
 * Where a console's catalog comes from (your own list, Wikipedia) and when it was last built, and the
 * console's mappings (owned titles that count as catalog games), with the controls to change them.
 */
export function CatalogSourceCard({ platformKey }: { platformKey: string }) {
  const queryClient = useQueryClient();
  const dateFormat = useSetting('general.dateFormat', 'us');
  const listFill = useSetting('catalogs.listFill', 'newer');
  // The build time before a build we started: polling stops when it changes.
  const [waitingSince, setWaitingSince] = useState<string | null>(null);
  const [showConflicts, setShowConflicts] = useState(false);
  const sources = useQuery({
    queryKey: ['catalogs', 'sources'],
    queryFn: () => api<CatalogSourceStatus[]>('/catalogs/sources'),
    refetchInterval: waitingSince !== null ? 3000 : false,
  });
  const s = sources.data?.find((x) => x.key === platformKey);
  // The sources the user added, for their names.
  const added = useQuery({ queryKey: ['catalog-sources'], queryFn: () => api<AddedSource[]>('/catalog-sources'), retry: false });
  const sourceName = (id: string) => nameOf(id, added.data);
  useEffect(() => {
    if (waitingSince !== null && s && !s.queued && (s.builtAt ?? '') !== waitingSince) {
      setWaitingSince(null);
      void queryClient.invalidateQueries({ queryKey: ['catalogs'] });
      void queryClient.invalidateQueries({ queryKey: ['wishlist'] });
    }
  }, [waitingSince, s, queryClient]);
  const started = () => setWaitingSince(s?.builtAt ?? '');
  const rebuild = useMutation({
    mutationFn: () => api('/catalogs/build', { method: 'POST', json: { platforms: [platformKey] } }),
    onSuccess: started,
    onError: (err) => notifyError(err),
  });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api<{ games: number; problems: string[] }>(`/catalogs/${platformKey}/list`, { method: 'PUT', body: form });
    },
    onSuccess: (r) => {
      notifySuccess(`${count(r.games)} games from your list; the catalog is being rebuilt.${r.problems.length > 0 ? ` ${r.problems.join(' ')}` : ''}`, 'List saved');
      started();
    },
    onError: (err) => notifyError(err),
  });
  const mapped = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['catalogs'] }), queryClient.invalidateQueries({ queryKey: ['wishlist'] })]);
  const uploadMappings = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api<{ mappings: number; problems: string[] }>(`/catalogs/${platformKey}/mappings`, { method: 'PUT', body: form });
    },
    onSuccess: (r) => {
      notifySuccess(`${count(r.mappings)} owned titles now count as the catalog games they map to.${r.problems.length > 0 ? ` ${r.problems.join(' ')}` : ''}`, 'Mappings saved');
      void mapped();
    },
    onError: (err) => notifyError(err),
  });
  const removeMappings = useMutation({
    mutationFn: () => api(`/catalogs/${platformKey}/mappings`, { method: 'DELETE' }),
    onSuccess: () => {
      notifySuccess('Your mappings for this console are gone.', 'Mappings removed');
      void mapped();
    },
    onError: (err) => notifyError(err),
  });
  const remove = useMutation({
    mutationFn: () => api(`/catalogs/${platformKey}/list`, { method: 'DELETE' }),
    onSuccess: () => {
      notifySuccess('The catalog goes back to the automatic sources.', 'List removed');
      started();
    },
    onError: (err) => notifyError(err),
  });
  if (!s) return null;
  const building = waitingSince !== null;
  const shown = (fact: SourceConflict['fact'], value: string) => (fact === 'releaseDate' ? releaseDate(value, dateFormat) : value);
  const left = s.skipped
    ? [
        s.skipped.older && `${count(s.skipped.older)} older games your list covers`,
        s.skipped.region && `${count(s.skipped.region)} not released in your region`,
        s.skipped.digital && `${count(s.skipped.digital)} download-only`,
        s.skipped.download && `${count(s.skipped.download)} download titles`,
        s.skipped.unlicensed && `${count(s.skipped.unlicensed)} unlicensed or homebrew`,
      ].filter(Boolean)
    : [];
  // Under a list, the other sources add the games released after it (a month's overlap), unless set to add every game.
  const after = s.list && listFill === 'newer' ? new Date(Date.parse(s.list.uploadedAt) - 30 * 86_400_000).toISOString() : null;
  // The sources after your list, in the order the last build trusted them (Wikipedia alone before there were more).
  const others = (s.sources.length > 0 ? s.sources.map((c) => c.id) : ['wikipedia']).filter((id) => id !== 'list');

  return (
    <Card withBorder mb="md">
      <Group justify="space-between" align="flex-start" gap="sm">
        <Stack gap={4} style={{ flex: 1, minWidth: 240 }}>
          <Text fw={600} size="sm">
            Where this catalog comes from
          </Text>
          {s.list && (
            <Text size="sm">
              Your list {s.list.fileName} ({count(s.list.games)} games, {date(s.list.uploadedAt, dateFormat)}) comes first.
            </Text>
          )}
          <Text size="sm">
            {s.list ? (after ? `Then, for games released after ${date(after, dateFormat)}: ` : 'Then: ') : 'From: '}
            {others.map((id, i) => {
              const info = CATALOG_SOURCES.find((c) => c.id === id);
              return (
                <Fragment key={id}>
                  {i > 0 && ', then '}
                  {id === 'wikipedia' ? (
                    s.pages.length > 0 ? (
                      <>
                        Wikipedia&apos;s{' '}
                        {s.pages.map((p, j) => (
                          <Fragment key={p}>
                            {j > 0 && ', '}
                            <Anchor href={wikipediaUrl(p)} target="_blank" size="sm">
                              {p}
                            </Anchor>
                          </Fragment>
                        ))}
                      </>
                    ) : (
                      'Wikipedia, which has no list known for this console (Settings > Catalogs and matching can name one)'
                    )
                  ) : info ? (
                    <Anchor href={info.url} target="_blank" size="sm">
                      {info.name}&apos;s lists
                    </Anchor>
                  ) : (
                    sourceName(id)
                  )}
                </Fragment>
              );
            })}
            {others.length === 0 && 'no other source (Settings > Sources).'}
          </Text>
          <Text size="xs" c="dimmed">
            {building
              ? 'Building…'
              : s.builtAt
                ? `Built ${dateTime(s.builtAt, dateFormat)}: ${count(s.games)} games${s.downloads > 0 ? ` (${count(s.downloads)} marked as download titles, counted once shown physical)` : ''}${left.length > 0 ? `; left out ${left.join(', ')}` : ''}.`
                : 'Not built yet.'}
          </Text>
          {s.sources.length > 1 && (
            <Text size="xs" c="dimmed">
              Sources, most trusted first (Settings &gt; Sources): {s.sources.map((c) => `${sourceName(c.id)} ${contribution(c)}`).join(' · ')}.
            </Text>
          )}
          {s.conflicts.length > 0 && (
            <Stack gap={2}>
              <UnstyledButton onClick={() => setShowConflicts((v) => !v)}>
                <Text size="xs" c="blue">
                  {showConflicts ? 'Hide' : 'Show'} {count(s.conflicts.length)} difference{s.conflicts.length === 1 ? '' : 's'} between sources (the more trusted one stands)
                </Text>
              </UnstyledButton>
              {showConflicts && (
                <List size="xs" spacing={2}>
                  {s.conflicts.map((c) => (
                    <List.Item key={`${c.title}|${c.fact}|${c.other.source}`}>
                      {c.title}: {FACT_WORDS[c.fact]} {shown(c.fact, c.kept.value)} ({sourceName(c.kept.source)}), not {shown(c.fact, c.other.value)} ({sourceName(c.other.source)})
                    </List.Item>
                  ))}
                </List>
              )}
            </Stack>
          )}
          {s.error && !building && (
            <Alert color="orange" p="xs">
              {s.error}
            </Alert>
          )}
          {s.mappings > 0 && (
            <Text size="xs" c="dimmed">
              Your mappings: {count(s.mappings)} owned titles that count as catalog games (compilations, other names, packages).
            </Text>
          )}
        </Stack>
        <Group gap="xs">
          <Button size="xs" variant="default" leftSection={<IconRefresh size={14} />} loading={building || rebuild.isPending} onClick={() => rebuild.mutate()}>
            Rebuild now
          </Button>
          <FileButton onChange={(f) => f && upload.mutate(f)} accept=".csv,text/csv">
            {(props) => (
              <Button {...props} size="xs" variant="default" leftSection={<IconTable size={14} />} loading={upload.isPending}>
                {s.list ? 'Replace your list' : 'Use your own list'}
              </Button>
            )}
          </FileButton>
          {s.list && (
            <Button
              size="xs"
              variant="subtle"
              color="red"
              leftSection={<IconTrash size={14} />}
              onClick={() => window.confirm(`Remove your list for ${s.name}? The catalog goes back to the automatic sources; games you answered about stay.`) && remove.mutate()}
            >
              Remove your list
            </Button>
          )}
          {/* A CSV of owned titles and the catalog games they count as, like the old workbook's Ownership Mappings tabs. */}
          <FileButton onChange={(f) => f && uploadMappings.mutate(f)} accept=".csv,text/csv">
            {(props) => (
              <Button {...props} size="xs" variant="default" leftSection={<IconArrowsJoin size={14} />} loading={uploadMappings.isPending}>
                {s.mappings > 0 ? 'Replace your mappings' : 'Use your mappings'}
              </Button>
            )}
          </FileButton>
          {s.mappings > 0 && (
            <Button
              size="xs"
              variant="subtle"
              color="red"
              leftSection={<IconTrash size={14} />}
              onClick={() => window.confirm(`Remove your mappings for ${s.name}? Owned titles go back to counting only as the games they are.`) && removeMappings.mutate()}
            >
              Remove your mappings
            </Button>
          )}
        </Group>
      </Group>
    </Card>
  );
}
