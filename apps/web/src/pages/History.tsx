import { COMPLETENESS_SHORT, igdbCoverUrl, normalizeTitle, type Completeness, type ConsoleProfile } from '@squirrelcade/core';
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  List,
  Loader,
  Menu,
  Modal,
  NumberInput,
  Popover,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
  VisuallyHidden,
} from '@mantine/core';
import { IconCheck, IconDots, IconExternalLink, IconPencil, IconSearch } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { StashMark } from '../Acorn';
import { api } from '../api';
import { GameCover, GameTitle, useOpenGame } from '../GameDrawer';
import { notifyError, notifySuccess, useCanEdit, useSetting } from '../hooks';
import { releaseDate } from '../format';
import { PreferencePicker } from '../Preference';
import { RommLinks, type RommLink } from '../Romm';
import { PlayBadge, type Play } from '../Playing';

/** A history text as the API sends it (see apps/server/src/history.ts). */
export interface HistoryText {
  text: string;
  sources: string[];
  status: 'draft' | 'verified';
  origin: 'squirrelcade' | 'yours';
  updatedAt: string | null;
  newerShipped: boolean;
}

type ListOwnership = 'owned' | 'review' | 'maybe' | 'missing';

interface ListGame {
  title: string;
  coverId: string | null;
  owned: ListOwnership;
  copies: { title: string; platform: string; platformKey: string; completeness: Completeness; sealed: boolean; quantity: number }[];
  maybe: string[];
  ownedOn: string[];
  onPc: string[];
  catalogTitle: string | null;
  catalogPlatformKey: string | null;
  catalogStatus: string | null;
  romm: RommLink | null;
  wishlistRank: number | null;
  preference: string | null;
  /** What the owner played of it (when that's shown). */
  play: Play | null;
}

interface Top100Row extends ListGame {
  rank: number;
  altTitles: string[];
  year: number | null;
  developers: string[];
  publishers: string[];
  why: HistoryText | null;
}

interface Top100View {
  platformKey: string;
  platform: string;
  listName: string;
  version: string;
  rows: Top100Row[];
  summary: { total: number; owned: number; review: number; maybe: number; inRomm: number | null; ownedInRomm: number | null; finished: number | null };
  rommUnowned: boolean;
}

export interface ConsoleHistoryView {
  platformKey: string;
  platform: string;
  history: {
    profile: ConsoleProfile;
    startHere: (ListGame & { why: string })[];
    sources: string[];
    status: 'draft' | 'verified';
    asOf: string | null;
    origin: 'squirrelcade' | 'yours';
    updatedAt: string | null;
    newerShipped: boolean;
  } | null;
  hasTop100: boolean;
}

interface TimelineData {
  consoles: { platformKey: string; name: string; manufacturer: string | null; generation: number | null; launched: number | null; ended: number | null; tracked: boolean; hasHistory: boolean; hasTop100: boolean }[];
  games: {
    platformKey: string;
    platform: string;
    title: string;
    catalogTitle: string | null;
    catalogPlatformKey: string | null;
    year: number;
    rank: number | null;
    startHere: boolean;
    owned: ListOwnership;
    /** Your wishlist preference for it, when a catalog has it. */
    preference: string | null;
  }[];
}

/** Region codes in launches, as people say them. */
export const REGIONS: Record<string, string> = { NA: 'North America', JP: 'Japan', EU: 'Europe', PAL: 'Europe', AU: 'Australia', KR: 'South Korea', WW: 'Worldwide', UK: 'United Kingdom', BR: 'Brazil', CN: 'China' };

const ORDINALS = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];
export const generationName = (g: number) => `${ORDINALS[g] ?? `${g}th`} generation`;

/** A launch's day in the owner's date format when it's a whole day, else as written (a month, a year). */
export function launchDay(date: string, format: Parameters<typeof releaseDate>[1]): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? releaseDate(date, format) : /^\d{4}-\d{2}$/.test(date) ? new Date(`${date}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : date;
}

/** Where a text comes from: one link, or a list of them. */
function SourcesLink({ sources }: { sources: string[] }) {
  if (sources.length === 0) return null;
  const label = (url: string) => {
    try {
      const u = new URL(url);
      return `${u.hostname.replace(/^www\./, '')}${decodeURIComponent(u.pathname).replace(/_/g, ' ')}`;
    } catch {
      return url;
    }
  };
  if (sources.length === 1) {
    return (
      <Anchor href={sources[0]} target="_blank" rel="noreferrer" size="xs">
        <Group gap={3} wrap="nowrap" component="span">
          Source <IconExternalLink size={11} />
        </Group>
      </Anchor>
    );
  }
  return (
    <Popover position="bottom-start" withinPortal shadow="md">
      <Popover.Target>
        <Anchor component="button" type="button" size="xs">
          Sources ({sources.length})
        </Anchor>
      </Popover.Target>
      <Popover.Dropdown maw={360}>
        <Stack gap={4}>
          {sources.map((s) => (
            <Anchor key={s} href={s} target="_blank" rel="noreferrer" size="xs" style={{ wordBreak: 'break-word' }}>
              {label(s)}
            </Anchor>
          ))}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

/** A text's standing: draft (drafted with Claude's help from its sources, not checked yet) or verified, whose it is, and its sources. */
export function HistoryMark({ text }: { text: Pick<HistoryText, 'status' | 'sources' | 'origin'> }) {
  return (
    <Group gap={6} wrap="wrap">
      {text.status === 'verified' ? (
        <Badge size="xs" color="green" variant="light" leftSection={<IconCheck size={10} />} style={{ textTransform: 'none' }}>
          Verified
        </Badge>
      ) : (
        <Tooltip label="Drafted with Claude's help from its sources, and not checked yet" multiline maw={260}>
          <Badge size="xs" color="gray" variant="light" style={{ textTransform: 'none' }}>
            Draft
          </Badge>
        </Tooltip>
      )}
      {text.origin === 'yours' && (
        <Badge size="xs" color="blue" variant="outline" style={{ textTransform: 'none' }}>
          Your version
        </Badge>
      )}
      <SourcesLink sources={text.sources} />
    </Group>
  );
}

/** Copies as short labels, alike ones counted together: "CIB ×2 · Sealed · Loose (Super Famicom)". */
function copyLabels(game: ListGame, platformKey: string): string {
  const counts = new Map<string, number>();
  for (const c of game.copies) {
    const label = `${COMPLETENESS_SHORT[c.completeness] ?? c.completeness}${c.platformKey !== platformKey ? ` (${c.platform})` : ''}`;
    counts.set(label, (counts.get(label) ?? 0) + c.quantity);
  }
  return [...counts].map(([label, n]) => (n > 1 ? `${label} ×${n}` : label)).join(' · ');
}

/** What the collection has of a listed game. */
function OwnedCell({ game, platformKey }: { game: ListGame; platformKey: string }) {
  if (game.owned === 'owned') {
    return (
      <Stack gap={2}>
        <Badge size="sm" color="green" variant="light" leftSection={<IconCheck size={12} />} style={{ textTransform: 'none' }}>
          Owned
        </Badge>
        <Text size="xs" c="dimmed">
          {copyLabels(game, platformKey)}
        </Text>
        <PlayBadge play={game.play} size="xs" />
      </Stack>
    );
  }
  const also = [game.ownedOn.length > 0 ? `Have it on ${game.ownedOn.join(', ')}` : null, game.onPc.length > 0 ? `On PC: ${game.onPc.join(', ')}` : null].filter(Boolean);
  return (
    <Stack gap={2}>
      {game.owned === 'review' ? (
        <Tooltip label="A copy you own may be this game: answer on the console's Needs review tab" multiline maw={260}>
          <Badge size="sm" color="yellow" variant="light" style={{ textTransform: 'none' }}>
            To review
          </Badge>
        </Tooltip>
      ) : game.owned === 'maybe' ? (
        <Tooltip label={`You have ${game.maybe.join(', ')}, which looks like it (not counted)`} multiline maw={260}>
          <Badge size="sm" color="gray" variant="light" style={{ textTransform: 'none' }}>
            Maybe
          </Badge>
        </Tooltip>
      ) : (
        <Text size="xs" c="dimmed">
          Not owned
        </Text>
      )}
      {also.map((a) => (
        <Text key={a} size="xs">
          {a}
        </Text>
      ))}
      {game.wishlistRank !== null && (
        <Anchor component={Link} to="/wishlist" size="xs">
          #{game.wishlistRank} on your wishlist
        </Anchor>
      )}
    </Stack>
  );
}

/** Why a game matters, with its standing; the owner can rewrite it or mark it verified. */
function WhyText({ platformKey, title, why, clamp = true }: { platformKey: string; title: string; why: HistoryText | null; clamp?: boolean }) {
  const canEdit = useCanEdit();
  const [editing, setEditing] = useState(false);
  if (!why && !canEdit) return null;
  return (
    <>
      {why ? (
        <Stack gap={2} mt={2}>
          <Text size="xs" lineClamp={clamp ? 3 : undefined} title={clamp ? why.text : undefined}>
            {why.text}
          </Text>
          <Group gap={6}>
            <HistoryMark text={why} />
            {canEdit && (
              <Anchor component="button" type="button" size="xs" c="dimmed" onClick={() => setEditing(true)} aria-label={`Edit why ${title} matters`}>
                Edit
              </Anchor>
            )}
          </Group>
        </Stack>
      ) : (
        <Anchor component="button" type="button" size="xs" c="dimmed" onClick={() => setEditing(true)} style={{ alignSelf: "flex-start" }}>
          Write why it matters
        </Anchor>
      )}
      {editing && <WhyModal platformKey={platformKey} title={title} why={why} onClose={() => setEditing(false)} />}
    </>
  );
}

/** The owner's version of why a game matters: the text, its sources, and whether it's checked. */
export function WhyModal({ platformKey, title, why, onClose }: { platformKey: string; title: string; why: HistoryText | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState(why?.text ?? '');
  const [sources, setSources] = useState((why?.sources ?? []).join('\n'));
  const [verified, setVerified] = useState(why?.status === 'verified' || !why);
  const save = useMutation({
    mutationFn: (body: { text: string | null; sources?: string[]; status?: 'draft' | 'verified' }) => api('/history/games', { method: 'PUT', json: { platformKey, title, ...body } }),
    onSuccess: (_d, body) => {
      notifySuccess(body.text === null ? "Back to Squirrelcade's text." : 'Saved.');
      void queryClient.invalidateQueries({ queryKey: ['history'] });
      void queryClient.invalidateQueries({ queryKey: ['game'] });
      onClose();
    },
    onError: (err) => notifyError(err),
  });
  const lines = sources
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return (
    <Modal opened onClose={onClose} title={`Why ${title} matters`} size="lg">
      <Stack gap="sm">
        <Textarea label="Why it matters" description="A sentence or two: a first, a record, what it changed or started." data-autofocus autosize minRows={3} maxLength={1000} value={text} onChange={(e) => setText(e.currentTarget.value)} />
        <Textarea label="Sources" description="Web addresses, one per line." autosize minRows={2} value={sources} onChange={(e) => setSources(e.currentTarget.value)} />
        <Checkbox label="Verified: I checked it against its sources" checked={verified} onChange={(e) => setVerified(e.currentTarget.checked)} />
        <Group justify="space-between">
          {why?.origin === 'yours' ? (
            <Button variant="subtle" color="gray" loading={save.isPending} onClick={() => save.mutate({ text: null })}>
              Back to Squirrelcade&apos;s text
            </Button>
          ) : (
            <span />
          )}
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={save.isPending} disabled={!text.trim()} onClick={() => save.mutate({ text: text.trim(), sources: lines, status: verified ? 'verified' : 'draft' })}>
              Save
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}

type Show = 'all' | 'owned' | 'missing';

/** A console's Top 100 list: its best games in ranked order, what you have of them, why each matters, and RomM. */
export function Top100Tab({ platformKey, narrow }: { platformKey: string; narrow: boolean }) {
  const [params, setParams] = useSearchParams();
  const show = (['all', 'owned', 'missing'].includes(params.get('show') ?? '') ? params.get('show') : 'all') as Show;
  const onlyRomm = params.get('romm') === 'yes';
  // A board of ten by ten with the hunting list beside it (the redesign's), or the list with why each game matters.
  const view = params.get('view') === 'list' ? 'list' : 'board';
  const [search, setSearch] = useState('');
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const top = useQuery({ queryKey: ['history', 'top100', platformKey], queryFn: () => api<Top100View>(`/history/top100/${platformKey}`) });
  const d = top.data;
  const q = normalizeTitle(search);
  const rows = useMemo(
    () =>
      (d?.rows ?? []).filter(
        (r) =>
          (show === 'all' || (show === 'owned' ? r.owned === 'owned' : r.owned !== 'owned')) &&
          (!onlyRomm || r.romm) &&
          (!q || [r.title, ...r.altTitles, r.catalogTitle ?? ''].some((t) => normalizeTitle(t).includes(q))),
      ),
    [d, show, onlyRomm, q],
  );
  if (top.isError) return <Text c="red">{(top.error as Error).message}</Text>;
  if (!d) return <Loader />;
  const s = d.summary;
  const romm = s.inRomm !== null;
  const summary = [
    `Own ${s.owned} of ${s.total}`,
    s.finished ? `${s.finished} finished` : null,
    romm ? (d.rommUnowned ? `${s.inRomm} in RomM` : `${s.ownedInRomm} of them in RomM`) : null,
    s.review > 0 ? `${s.review} to review` : null,
    s.maybe > 0 ? `${s.maybe} maybe` : null,
  ].filter(Boolean);

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm">
        <Stack gap={2}>
          <h2 className="sc-h2">{summary.join(' · ')}</h2>
          <Text size="xs" c="dimmed">
            The {d.listName} Top 100: a consensus of critics&apos; and retrospective best-of lists (list of {d.version}). Games you don&apos;t have make a hunting list.
          </Text>
        </Stack>
        <Group gap="sm" wrap="wrap">
          <div role="group" aria-label="Which games" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(
              [
                ['all', `All ${s.total}`],
                ['owned', `Owned ${s.owned}`],
                ['missing', `Not owned ${s.total - s.owned}`],
                ...(romm ? [['romm', `In RomM ${s.inRomm}`]] : []),
              ] as [Show | 'romm', string][]
            ).map(([value, label]) => {
              const on = value === 'romm' ? onlyRomm && show === 'all' : show === value && !onlyRomm;
              return (
                <button
                  key={value}
                  type="button"
                  className="sc-toggle"
                  aria-pressed={on}
                  onClick={() => {
                    const next = new URLSearchParams(params);
                    next.delete('show');
                    next.delete('romm');
                    if (value === 'romm') next.set('romm', 'yes');
                    else if (value !== 'all') next.set('show', value);
                    setParams(next, { replace: true });
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div role="group" aria-label="Show as" style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="sc-toggle" aria-pressed={view === 'board'} onClick={() => setParam('view', null)}>
              Board
            </button>
            <button type="button" className="sc-toggle" aria-pressed={view === 'list'} onClick={() => setParam('view', 'list')}>
              List
            </button>
          </div>
          {view === 'list' && <TextInput size="xs" placeholder="Search" leftSection={<IconSearch size={14} />} value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={200} aria-label="Search the list" />}
        </Group>
      </Group>
      {view === 'board' ? (
        <div className="sc-row">
          <Top100Board d={d} platformKey={platformKey} show={show} onlyRomm={onlyRomm} />
          <HuntingList d={d} platformKey={platformKey} />
        </div>
      ) : (
      <Table.ScrollContainer minWidth={narrow ? 0 : 720}>
        <Table verticalSpacing={6} striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={40} ta="right">
                #
              </Table.Th>
              <Table.Th>Game</Table.Th>
              {!narrow && <Table.Th w={190}>You</Table.Th>}
              {romm && !narrow && <Table.Th w={110}>RomM</Table.Th>}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r) => {
              const name = r.catalogTitle ?? r.title;
              const on = r.catalogPlatformKey ?? platformKey;
              const credits = [r.developers.join(', '), r.publishers.filter((p) => !r.developers.includes(p)).join(', ')].filter(Boolean).join(' / ');
              return (
                <Table.Tr key={r.rank}>
                  <Table.Td ta="right" valign="top">
                    <Text fw={700} size="sm">
                      {r.rank}
                    </Text>
                  </Table.Td>
                  <Table.Td valign="top">
                    <Group gap="sm" wrap="nowrap" align="flex-start">
                      <GameCover platformKey={on} title={name} id={r.coverId} width={36} placeholder />
                      <Stack gap={2} style={{ minWidth: 0 }}>
                        <GameTitle platformKey={on} title={name} fw={600}>
                          {r.title}
                        </GameTitle>
                        <Text size="xs" c="dimmed">
                          {[r.year, credits].filter(Boolean).join(' · ')}
                        </Text>
                        <WhyText platformKey={on} title={name} why={r.why} />
                        {narrow && (
                          <Group gap="sm" mt={4} align="flex-start">
                            <OwnedCell game={r} platformKey={platformKey} />
                            <RommLinks link={r.romm} />
                            {r.owned !== 'owned' && r.catalogTitle && <PreferencePicker platformKey={on} title={r.catalogTitle} value={r.preference} width={170} />}
                          </Group>
                        )}
                      </Stack>
                    </Group>
                  </Table.Td>
                  {!narrow && (
                    <Table.Td valign="top">
                      <OwnedCell game={r} platformKey={platformKey} />
                      {r.owned !== 'owned' && r.catalogTitle && (
                        <Group mt={4}>
                          <PreferencePicker platformKey={on} title={r.catalogTitle} value={r.preference} width={170} />
                        </Group>
                      )}
                    </Table.Td>
                  )}
                  {romm && !narrow && (
                    <Table.Td valign="top">
                      <RommLinks link={r.romm} />
                    </Table.Td>
                  )}
                </Table.Tr>
              );
            })}
            {rows.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={4}>
                  <Text size="sm" c="dimmed">
                    No games match.
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      )}
    </Stack>
  );
}

/** Whether a Top 100 game counts as owned, isn't, or waits for an answer (to review, maybe). */
const ownership = (r: Top100Row) => (r.owned === 'owned' ? 'owned' : r.owned === 'missing' ? 'missing' : 'unsure');

/** A legend's sample square. */
const sample = (own: string) => <span className="sc-square" data-own={own} style={{ width: 14, height: 14, display: 'inline-block' }} />;

/**
 * The Top 100 as a board of ten by ten (0.49.0): each square a game, its box art in the middle and its rank in the corner
 * (0.53.0; the rank alone on a phone), the ones the filter leaves out dimmed.
 */
function Top100Board({ d, platformKey, show, onlyRomm }: { d: Top100View; platformKey: string; show: Show; onlyRomm: boolean }) {
  const open = useOpenGame();
  // Each square shows its game's box (the owner's ask, 0.53.0), the rank in its corner; Settings > Interface can hide covers.
  const showArt = useSetting('interface.showCoverArt', true);
  const s = d.summary;
  const unsure = s.review + s.maybe;
  const legend: [string, ReactNode][] = [[`Owned · ${s.owned}`, sample('owned')]];
  if (s.inRomm !== null) legend.push([`In RomM · ${s.inRomm}`, <span className="sc-dot" style={{ background: 'var(--sc-have)', width: 6, height: 6 }} />]);
  legend.push([`Not owned · ${s.total - s.owned - unsure}`, sample('missing')]);
  if (unsure > 0) legend.push([`To answer · ${unsure}`, sample('unsure')]);
  return (
    <section className="sc-card sc-pad sc-wide" aria-label={`The ${d.listName} Top 100 as a board`} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="sc-board">
        {d.rows.map((r) => {
          const own = ownership(r);
          const shown = (show === 'all' || (show === 'owned' ? r.owned === 'owned' : r.owned !== 'owned')) && (!onlyRomm || r.romm !== null);
          const label = `#${r.rank} ${r.title}: ${own === 'owned' ? 'owned' : own === 'missing' ? 'not owned' : 'to answer on Review'}${r.romm ? ', in RomM' : ''}`;
          return (
            <button
              key={r.rank}
              type="button"
              className="sc-square"
              data-own={own}
              data-dim={!shown}
              data-art={Boolean(showArt && r.coverId)}
              title={label}
              aria-label={label}
              onClick={() => open(r.catalogPlatformKey ?? platformKey, r.catalogTitle ?? r.title)}
            >
              <span className="sc-square-rank">{r.rank}</span>
              {showArt && r.coverId && <img className="sc-square-art" src={igdbCoverUrl(r.coverId, 'cover_big')} alt="" loading="lazy" decoding="async" />}
              {r.romm && <span className="sc-romm-dot" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      <Group gap="8px 20px" className="sc-soft" style={{ fontSize: 14 }}>
        {legend.map(([label, mark]) => (
          <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span aria-hidden="true" style={{ display: 'inline-flex' }}>
              {mark}
            </span>
            {label}
          </span>
        ))}
      </Group>
    </section>
  );
}

/** How many of the games you don't have the hunting list shows before pointing to the list. */
const HUNT_SHOWN = 12;

/** The Top 100 games you don't have, best first: where each one is (on PC, on another console, on the wishlist). */
function HuntingList({ d, platformKey }: { d: Top100View; platformKey: string }) {
  const hunt = d.rows.filter((r) => r.owned !== 'owned');
  const onPc = hunt.filter((r) => r.onPc.length > 0).length;
  const note = (r: Top100Row) =>
    r.owned === 'review'
      ? 'To answer on Review'
      : r.owned === 'maybe'
        ? `Maybe: ${r.maybe.join(', ')}`
        : r.onPc.length > 0
          ? `On PC: ${r.onPc.join(', ')}`
          : r.ownedOn.length > 0
            ? `You have it on ${r.ownedOn.join(', ')}`
            : r.wishlistRank !== null
              ? `#${r.wishlistRank} on your wishlist`
              : 'Not owned';
  const lead =
    hunt.length === 0
      ? 'You have every game on this list.'
      : `The ${hunt.length} Top 100 ${hunt.length === 1 ? 'game' : 'games'} you don't have.${onPc > 0 ? ` ${onPc} ${onPc === 1 ? 'is' : 'are'} in your PC library.` : ''}`;
  return (
    <section className="sc-card sc-pad sc-narrow" aria-labelledby="hunt-h" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <h2 id="hunt-h" className="sc-h2">
        Hunting list
      </h2>
      <Text size="sm" className="sc-muted" mb={6}>
        {lead}
      </Text>
      <div className="sc-rows">
        {hunt.slice(0, HUNT_SHOWN).map((r) => {
          const on = r.catalogPlatformKey ?? platformKey;
          const name = r.catalogTitle ?? r.title;
          return (
            <div key={r.rank} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0' }}>
              <span className="sc-pixel" style={{ flex: 'none', width: 40, fontSize: 14, color: 'var(--sc-gold)' }}>
                #{r.rank}
              </span>
              <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                <GameTitle platformKey={on} title={name} fw={700}>
                  {r.title}
                </GameTitle>
                <Text size="xs" className="sc-muted">
                  {note(r)}
                </Text>
              </span>
              {r.catalogTitle && <PreferencePicker platformKey={on} title={r.catalogTitle} value={r.preference} compact />}
            </div>
          );
        })}
      </div>
      {hunt.length > HUNT_SHOWN && (
        <Anchor component={Link} to="?tab=top100&view=list&show=missing" size="sm" fw={700} mt={6}>
          All {hunt.length} in the list
        </Anchor>
      )}
    </section>
  );
}

/** One fact of a console's history, as a tile (0.49.0). */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  if (!children) return null;
  return (
    <div className="sc-fact">
      <span className="sc-tile-label">{label}</span>
      <Text size="sm" fw={600} component="div">
        {children}
      </Text>
    </div>
  );
}

/** The latest year a text names ("March 2016 (Europe), May 29, 2017 (Japan)" is 2017), or null. */
const lastYear = (text: string) => {
  const years = [...text.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => Number(m[0]));
  return years.length > 0 ? Math.max(...years) : null;
};

/** A console's launches by region, then its end, along a line (scrolling sideways on a phone). */
function LaunchTimeline({ profile, dateFormat }: { profile: ConsoleProfile; dateFormat: Parameters<typeof releaseDate>[1] }) {
  const ended = profile.discontinued ? lastYear(profile.discontinued) : null;
  const events = [
    ...[...profile.launches]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((l) => ({ key: `${l.region}|${l.date}`, year: l.date.slice(0, 4), title: `${REGIONS[l.region] ?? l.region} launch`, body: [launchDay(l.date, dateFormat), l.price].filter(Boolean).join(' · '), ends: false })),
    ...(profile.discontinued && ended ? [{ key: 'end', year: String(ended), title: 'Discontinued', body: profile.discontinued, ends: true }] : []),
  ];
  if (events.length < 2) return null;
  // Focusable, so a keyboard can scroll it sideways where it doesn't fit.
  return (
    <div style={{ overflowX: 'auto' }} tabIndex={0} role="region" aria-label="Launches and end">
      <div className="sc-timeline" style={{ gridTemplateColumns: `repeat(${events.length}, minmax(160px, 1fr))` }}>
        {events.map((e, i) => (
          <div key={e.key} className="sc-timeline-step" data-ends={i === 0 || e.ends}>
            <span className="sc-timeline-dot" aria-hidden="true" />
            <span className="sc-pixel sc-timeline-year">{e.year}</span>
            <span style={{ fontWeight: 800, lineHeight: 1.25 }}>{e.title}</span>
            <span className="sc-muted" style={{ fontSize: 14 }}>
              {e.body}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A console's history: the facts, why it succeeded or failed, its firsts, and a few games to start with. */
export function ConsoleHistoryTab({ platformKey }: { platformKey: string }) {
  const canEdit = useCanEdit();
  const queryClient = useQueryClient();
  const dateFormat = useSetting('general.dateFormat', 'us');
  const [editing, setEditing] = useState(false);
  const view = useQuery({ queryKey: ['history', 'consoles', platformKey], queryFn: () => api<ConsoleHistoryView>(`/history/consoles/${platformKey}`) });
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/history/consoles/${platformKey}`, { method: 'PUT', json: body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['history'] });
      notifySuccess('Saved.');
    },
    onError: (err) => notifyError(err),
  });
  if (view.isError) return <Text c="red">{(view.error as Error).message}</Text>;
  if (!view.data) return <Loader />;
  const h = view.data.history;
  if (!h) {
    return (
      <Card withBorder>
        <Stack gap="xs">
          <Text size="sm">Squirrelcade has no history of this console yet.</Text>
          {canEdit && (
            <Group>
              <Button size="xs" variant="default" leftSection={<IconPencil size={14} />} onClick={() => setEditing(true)}>
                Write its history
              </Button>
            </Group>
          )}
        </Stack>
        {editing && <ConsoleEditor platformKey={platformKey} history={null} onClose={() => setEditing(false)} />}
      </Card>
    );
  }
  const p = h.profile;
  return (
    <Stack gap="md">
      {h.newerShipped && canEdit && (
        <Alert color="blue" title="Squirrelcade's text changed">
          <Text size="sm">
            Squirrelcade&apos;s history of this console was updated since you made your version.{' '}
            <Anchor size="sm" onClick={() => save.mutate({ reset: true })}>
              Use Squirrelcade&apos;s
            </Anchor>{' '}
            (your version goes).
          </Text>
        </Alert>
      )}
      <Card withBorder>
        <Group justify="space-between" align="flex-start" mb="sm" wrap="nowrap">
          <Stack gap={4}>
            <Title order={4}>{view.data.platform}</Title>
            <HistoryMark text={h} />
            {h.asOf && (
              <Text size="xs" c="dimmed">
                Figures as of {h.asOf}
              </Text>
            )}
          </Stack>
          {canEdit && (
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon variant="default" aria-label="History actions">
                  <IconDots size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item onClick={() => save.mutate({ status: h.status === 'verified' ? 'draft' : 'verified' })}>{h.status === 'verified' ? 'Mark as draft' : 'Mark verified (I checked it)'}</Menu.Item>
                <Menu.Item leftSection={<IconPencil size={14} />} onClick={() => setEditing(true)}>
                  Edit
                </Menu.Item>
                {h.origin === 'yours' && <Menu.Item onClick={() => save.mutate({ reset: true })}>Back to Squirrelcade&apos;s</Menu.Item>}
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>
        <div className="sc-facts">
          <Fact label="Made by">{p.manufacturer}</Fact>
          <Fact label="Generation">{p.generation ? generationName(p.generation) : null}</Fact>
          <Fact label="Launched">
            {p.launches.length > 0 ? (
              <Stack gap={0}>
                {p.launches.map((l) => (
                  <span key={`${l.region}|${l.date}`}>
                    {REGIONS[l.region] ?? l.region}: {launchDay(l.date, dateFormat)}
                    {l.price ? ` · ${l.price}` : ''}
                  </span>
                ))}
              </Stack>
            ) : null}
          </Fact>
          <Fact label="Discontinued">{p.discontinued}</Fact>
          <Fact label="Units sold">{p.unitsSold}</Fact>
          <Fact label="Competed with">{p.competitors.length > 0 ? p.competitors.join(', ') : null}</Fact>
        </div>
        <Stack gap={4} mt="md">
          <LaunchTimeline profile={p} dateFormat={dateFormat} />
        </Stack>
        {p.hardware.length > 0 && (
          <Stack gap={4} mt="md">
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              Hardware
            </Text>
            <List size="sm" spacing={2}>
              {p.hardware.map((x) => (
                <List.Item key={x}>{x}</List.Item>
              ))}
            </List>
          </Stack>
        )}
      </Card>
      {(p.story || p.firsts.length > 0 || p.endOfLife) && (
        <Card withBorder>
          <Stack gap="sm">
            {p.story && (
              <>
                <Title order={5}>How it did, and why</Title>
                {p.story.split(/\n\s*\n/).map((para, i) => (
                  <Text key={i} size="sm">
                    {para}
                  </Text>
                ))}
              </>
            )}
            {p.firsts.length > 0 && (
              <>
                <Title order={5}>Firsts</Title>
                <List size="sm" spacing={2}>
                  {p.firsts.map((x) => (
                    <List.Item key={x}>{x}</List.Item>
                  ))}
                </List>
              </>
            )}
            {p.endOfLife && (
              <>
                <Title order={5}>End of life</Title>
                <Text size="sm">{p.endOfLife}</Text>
              </>
            )}
          </Stack>
        </Card>
      )}
      {h.startHere.length > 0 && (
        <Card withBorder>
          <Title order={5} mb="xs">
            Start here
          </Title>
          <Text size="xs" c="dimmed" mb="sm">
            Games that show what the {view.data.platform} was about.
          </Text>
          <Stack gap="sm">
            {h.startHere.map((g) => {
              const name = g.catalogTitle ?? g.title;
              const on = g.catalogPlatformKey ?? platformKey;
              return (
                <Group key={g.title} gap="sm" wrap="nowrap" align="flex-start">
                  <GameCover platformKey={on} title={name} id={g.coverId} width={40} placeholder />
                  <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                    <GameTitle platformKey={on} title={name} fw={600}>
                      {g.title}
                    </GameTitle>
                    <Text size="sm">{g.why}</Text>
                    <Group gap="md" align="flex-start">
                      <OwnedCell game={g} platformKey={platformKey} />
                      <RommLinks link={g.romm} />
                      {g.owned !== 'owned' && g.catalogTitle && <PreferencePicker platformKey={on} title={g.catalogTitle} value={g.preference} width={170} />}
                    </Group>
                  </Stack>
                </Group>
              );
            })}
          </Stack>
        </Card>
      )}
      {view.data.hasTop100 && (
        <Text size="sm">
          <Anchor component={Link} to={`/platforms/${platformKey}?tab=top100`}>
            Its Top 100 games
          </Anchor>
        </Text>
      )}
      {editing && <ConsoleEditor platformKey={platformKey} history={h} onClose={() => setEditing(false)} />}
    </Stack>
  );
}

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/** The owner's version of a console's history, as plain fields and lines. */
function ConsoleEditor({ platformKey, history, onClose }: { platformKey: string; history: ConsoleHistoryView['history']; onClose: () => void }) {
  const queryClient = useQueryClient();
  const p = history?.profile;
  const [f, setF] = useState({
    manufacturer: p?.manufacturer ?? '',
    generation: p?.generation ?? '',
    launches: (p?.launches ?? []).map((l) => `${l.region}: ${l.date}${l.price ? `: ${l.price}` : ''}`).join('\n'),
    discontinued: p?.discontinued ?? '',
    unitsSold: p?.unitsSold ?? '',
    asOf: history?.asOf ?? '',
    hardware: (p?.hardware ?? []).join('\n'),
    competitors: (p?.competitors ?? []).join('\n'),
    story: p?.story ?? '',
    firsts: (p?.firsts ?? []).join('\n'),
    endOfLife: p?.endOfLife ?? '',
    startHere: (history?.startHere ?? []).map((s) => `${s.title} | ${s.why}`).join('\n'),
    sources: (history?.sources ?? []).join('\n'),
    verified: history ? history.status === 'verified' : true,
  });
  const set = (key: keyof typeof f) => (value: string | number | boolean) => setF((x) => ({ ...x, [key]: value }));
  const save = useMutation({
    mutationFn: () => {
      const launches = lines(f.launches).map((l) => {
        const [region = '', date = '', ...price] = l.split(':').map((x) => x.trim());
        return { region, date, ...(price.join(':').trim() ? { price: price.join(':').trim() } : {}) };
      });
      const startHere = lines(f.startHere).map((l) => {
        const at = l.indexOf(' | ');
        return at < 0 ? { title: l, why: '' } : { title: l.slice(0, at).trim(), why: l.slice(at + 3).trim() };
      });
      const text = (v: string) => (v.trim() ? v.trim() : null);
      return api(`/history/consoles/${platformKey}`, {
        method: 'PUT',
        json: {
          profile: {
            manufacturer: text(f.manufacturer),
            generation: f.generation === '' ? null : Number(f.generation),
            launches,
            discontinued: text(f.discontinued),
            unitsSold: text(f.unitsSold),
            hardware: lines(f.hardware),
            competitors: lines(f.competitors),
            story: text(f.story),
            firsts: lines(f.firsts),
            endOfLife: text(f.endOfLife),
          },
          startHere,
          sources: lines(f.sources),
          asOf: text(f.asOf),
          status: f.verified ? 'verified' : 'draft',
        },
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['history'] });
      notifySuccess('Saved.');
      onClose();
    },
    onError: (err) => notifyError(err),
  });
  return (
    <Modal opened onClose={onClose} title="The console's history" size="xl">
      <Stack gap="sm">
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Made by" value={f.manufacturer} onChange={(e) => set('manufacturer')(e.currentTarget.value)} />
          <NumberInput label="Generation" min={1} max={20} value={f.generation} onChange={(v) => set('generation')(v === '' ? '' : Number(v))} />
          <TextInput label="Discontinued" value={f.discontinued} onChange={(e) => set('discontinued')(e.currentTarget.value)} />
          <TextInput label="Units sold" value={f.unitsSold} onChange={(e) => set('unitsSold')(e.currentTarget.value)} />
          <TextInput label="Figures as of" description="YYYY-MM" value={f.asOf} onChange={(e) => set('asOf')(e.currentTarget.value)} />
        </SimpleGrid>
        <Textarea label="Launches" description='One per line: "NA: 2006-11-17: US$499 (20 GB)" (region, day or month, price)' autosize minRows={2} value={f.launches} onChange={(e) => set('launches')(e.currentTarget.value)} />
        <Textarea label="Hardware" description="One fact per line." autosize minRows={2} value={f.hardware} onChange={(e) => set('hardware')(e.currentTarget.value)} />
        <Textarea label="Competed with" description="One console per line." autosize minRows={1} value={f.competitors} onChange={(e) => set('competitors')(e.currentTarget.value)} />
        <Textarea label="How it did, and why" description="A blank line starts a new paragraph." autosize minRows={3} value={f.story} onChange={(e) => set('story')(e.currentTarget.value)} />
        <Textarea label="Firsts" description="One per line." autosize minRows={2} value={f.firsts} onChange={(e) => set('firsts')(e.currentTarget.value)} />
        <Textarea label="End of life" autosize minRows={1} value={f.endOfLife} onChange={(e) => set('endOfLife')(e.currentTarget.value)} />
        <Textarea label="Start here" description='One game per line: "Title | why it shows what the console was about"' autosize minRows={3} value={f.startHere} onChange={(e) => set('startHere')(e.currentTarget.value)} />
        <Textarea label="Sources" description="Web addresses, one per line." autosize minRows={2} value={f.sources} onChange={(e) => set('sources')(e.currentTarget.value)} />
        <Checkbox label="Verified: I checked it against its sources" checked={f.verified} onChange={(e) => set('verified')(e.currentTarget.checked)} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Consoles and landmark games on one timeline: the generations side by side, then year by year. */
export function TimelinePanel() {
  const [all, setAll] = useState(false);
  const timeline = useQuery({ queryKey: ['history', 'timeline'], queryFn: () => api<TimelineData>('/history/timeline') });
  if (timeline.isError) return <Text c="red">{(timeline.error as Error).message}</Text>;
  if (!timeline.data) return <Loader />;
  const collected = timeline.data.consoles.filter((c) => c.tracked);
  const consoles = all || collected.length === 0 ? timeline.data.consoles : collected;
  const shown = new Set(consoles.map((c) => c.platformKey));
  const games = timeline.data.games.filter((g) => shown.has(g.platformKey));
  const generations = [...new Set(consoles.map((c) => c.generation ?? 0))].sort((a, b) => a - b);
  const years = [...new Set([...consoles.map((c) => c.launched).filter((y): y is number => y !== null), ...games.map((g) => g.year)])].sort((a, b) => a - b);
  // A game you have: the Stash's chest (D142); one that might be yours: a question mark.
  const mark = (o: ListOwnership) => (o === 'owned' ? <StashMark size={12} /> : o === 'review' || o === 'maybe' ? '?' : '');

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap">
        <Text size="sm" c="dimmed">
          Consoles by the year they came out, with their best games from the Top 100 lists and their &quot;Start here&quot; games (<StashMark size={12} /> you have it).
        </Text>
        {collected.length > 0 && <Switch size="sm" label="Consoles you don't collect too" checked={all} onChange={(e) => setAll(e.currentTarget.checked)} />}
      </Group>
      <Title order={4}>Generations</Title>
      <SimpleGrid cols={{ base: 1, xs: 2, md: 3, lg: 4 }}>
        {generations.map((gen) => (
          <Card key={gen} withBorder padding="sm">
            <Text fw={600} size="sm" mb={4}>
              {gen ? generationName(gen) : 'Other'}
            </Text>
            <Stack gap={2}>
              {consoles
                .filter((c) => (c.generation ?? 0) === gen)
                .map((c) => (
                  <Text key={c.platformKey} size="sm">
                    <Anchor component={Link} to={`/platforms/${c.platformKey}?tab=${c.hasHistory ? 'history' : 'top100'}`} size="sm">
                      {c.name}
                    </Anchor>{' '}
                    <Text span size="xs" c="dimmed">
                      {c.launched ?? '?'}
                      {c.ended && c.ended !== c.launched ? `–${c.ended}` : ''}
                      {c.manufacturer ? ` · ${c.manufacturer}` : ''}
                    </Text>
                  </Text>
                ))}
            </Stack>
          </Card>
        ))}
      </SimpleGrid>
      <Title order={4}>Year by year</Title>
      <Table verticalSpacing={6}>
        <Table.Tbody>
          {years.map((y) => {
            const launched = consoles.filter((c) => c.launched === y);
            const those = games.filter((g) => g.year === y);
            return (
              <Table.Tr key={y}>
                <Table.Td w={60} valign="top">
                  <Text fw={700}>{y}</Text>
                </Table.Td>
                <Table.Td>
                  {launched.length > 0 && (
                    <Group gap={6} mb={those.length > 0 ? 4 : 0}>
                      {launched.map((c) => (
                        <Badge key={c.platformKey} variant="light" style={{ textTransform: 'none' }} component={Link} to={`/platforms/${c.platformKey}?tab=${c.hasHistory ? 'history' : 'top100'}`}>
                          {c.name} launches
                        </Badge>
                      ))}
                    </Group>
                  )}
                  <Text size="sm" component="div">
                    {those.map((g, i) => (
                      <Fragment key={`${g.platformKey}|${g.title}`}>
                        {i > 0 && ' · '}
                        <GameTitle platformKey={g.catalogPlatformKey ?? g.platformKey} title={g.catalogTitle ?? g.title}>
                          {g.title}
                        </GameTitle>{' '}
                        <Text span size="xs" c="dimmed">
                          ({g.platform}
                          {g.rank ? ` #${g.rank}` : ''}
                          {g.startHere ? ', start here' : ''})
                        </Text>
                        {mark(g.owned) && (
                          <Text span size="xs" c={g.owned === 'owned' ? 'green' : 'yellow'} fw={700}>
                            {' '}
                            <span aria-hidden="true">{mark(g.owned)}</span>
                            <VisuallyHidden>{g.owned === 'owned' ? 'you have it' : 'maybe'}</VisuallyHidden>
                          </Text>
                        )}
                        {g.owned !== 'owned' && g.catalogTitle && (
                          <span style={{ display: 'inline-block', verticalAlign: 'middle' }}>
                            <PreferencePicker platformKey={g.catalogPlatformKey ?? g.platformKey} title={g.catalogTitle} value={g.preference} compact />
                          </span>
                        )}
                      </Fragment>
                    ))}
                  </Text>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

/** The game drawer's history: its place in the console's Top 100 and why it matters (the owner can write it for any game). */
export function DrawerHistory({ platformKey, title, history }: { platformKey: string; title: string; history: { why: HistoryText | null; top100: { rank: number; of: number } | null } | null }) {
  const canEdit = useCanEdit();
  if (!history || (!history.why && !history.top100 && !canEdit)) return null;
  return (
    <Stack gap={4}>
      {history.top100 && (
        <Group gap={6}>
          <Badge variant="light" color="squirrel" style={{ textTransform: 'none' }} component={Link} to={`/platforms/${platformKey}?tab=top100`}>
            #{history.top100.rank} in the console&apos;s Top 100
          </Badge>
        </Group>
      )}
      <WhyText platformKey={platformKey} title={title} why={history.why} clamp={false} />
    </Stack>
  );
}
