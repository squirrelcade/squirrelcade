import { ActionIcon, Alert, Anchor, AspectRatio, Badge, Box, Button, Card, Group, Image, Loader, NumberInput, Select, SimpleGrid, Stack, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { useDebouncedValue, useHotkeys, useMediaQuery } from '@mantine/hooks';
import { IconArrowLeft, IconChevronLeft, IconChevronRight, IconRefresh, IconSearch, IconZoomIn, IconZoomOut } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { LeavesMark } from '../Acorn';
import { api } from '../api';
import { PageHeader } from '../components';
import { count } from '../format';
import { IssueGames, PageGames } from './LeavesGames';
import { notifyError, notifySuccess, useCanEdit, useSetting } from '../hooks';

/** A magazine (GET /api/v1/magazines). */
interface Magazine {
  id: number;
  name: string;
  publisher: string | null;
  issues: number;
  from: number | null;
  to: number | null;
  coverIssue: number | null;
  withText: number;
}

/** An issue (GET /api/v1/magazines/:id). */
interface Issue {
  id: number;
  magazineId: number;
  magazine: string;
  label: string;
  number: string | null;
  volume: string | null;
  year: number | null;
  month: number | null;
  title: string | null;
  pages: number;
  needsDate: boolean;
  /** A date nobody gave (D181): from the magazine index, or worked out from its number. */
  dateFrom: 'index' | 'numbering' | null;
  /** The file's page of printed page 1 less one, when set (D191). */
  pageOffset: number | null;
  text: 'none' | 'hocr' | 'ocr' | 'failed';
  version: number;
}

interface Status {
  folder: string | null;
  found: boolean;
  issues: number;
  withText: number;
  failed: number;
  estimate: { perIssueSeconds: number; issuesLeft: number; hoursLeft: number } | null;
}

/**
 * A page's picture: the same address while its file is the same, so the browser keeps it. With a width (CSS pixels),
 * the server makes it that wide for this screen (D182) instead of sending the whole scan.
 */
const pageUrl = (issueId: number, n: number, version = 0, width = 0) =>
  `/api/v1/magazines/issues/${issueId}/pages/${n}?v=${version}${width > 0 ? `&w=${Math.ceil(width * (window.devicePixelRatio || 1))}` : ''}`;

/** An issue's cover (its first page), as a tile: opens the issue. */
function IssueCover({ issue, cover, caption }: { issue: { id: number; version?: number } | null; cover?: ReactNode; caption: ReactNode }) {
  return (
    <Stack gap={4}>
      <AspectRatio ratio={3 / 4}>
        {issue ? <Image src={pageUrl(issue.id, 1, issue.version, 200)} radius="sm" alt="" loading="lazy" fit="cover" /> : (cover ?? <Box bg="var(--mantine-color-default-hover)" style={{ borderRadius: 4 }} />)}
      </AspectRatio>
      <Text size="xs" component="div" lineClamp={3}>
        {caption}
      </Text>
    </Stack>
  );
}

const COVERS = { base: 3, xs: 4, sm: 5, md: 6, lg: 8 } as const;

/** The search box Leaves' pages share: it opens Search magazines. */
function SearchBox({ initial = '' }: { initial?: string }) {
  const navigate = useNavigate();
  const [q, setQ] = useState(initial);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim()) navigate(`/leaves/search?q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <TextInput leftSection={<IconSearch size={16} />} placeholder='Search the magazines ("Chrono Trigger", Tecmo Bowl review)' value={q} onChange={(e) => setQ(e.currentTarget.value)} aria-label="Search the magazines" maw={520} />
    </form>
  );
}

/** Leaves (D177): your magazines, each as its first issue's cover, with its issues and years. */
export function LeavesPage() {
  const canEdit = useCanEdit();
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ['magazines'], queryFn: () => api<{ magazines: Magazine[]; status: Status }>('/magazines') });
  const undated = useQuery({ queryKey: ['magazines', 'undated'], queryFn: () => api<{ issues: Issue[] }>('/magazines/undated'), enabled: canEdit });
  const scan = useMutation({
    mutationFn: () => api('/magazines/scan', { method: 'POST' }),
    onSuccess: () => {
      notifySuccess('Squirrelcade is reading the magazines folder; new issues show here in a moment.', 'Reading');
      setTimeout(() => void queryClient.invalidateQueries({ queryKey: ['magazines'] }), 6000);
    },
    onError: (err) => notifyError(err),
  });
  const s = list.data?.status;
  return (
    <>
      <PageHeader
        help="magazines"
        title={
          <Group gap={10} component="span">
            <LeavesMark size={26} /> Leaves
          </Group>
        }
        description="Your magazine scans: each magazine and its issues, read on any screen, and their text searched."
        actions={
          canEdit && (
            <Button variant="default" leftSection={<IconRefresh size={16} />} loading={scan.isPending} onClick={() => scan.mutate()}>
              Read the folder now
            </Button>
          )
        }
      />
      <Stack gap="md">
        <SearchBox />
        {s && !s.found && (
          <Alert color="yellow">
            The magazines folder{s.folder ? ` (${s.folder})` : ''} can't be found.{' '}
            <Anchor component={Link} to="/settings/magazines" c="inherit" fw={600} underline="always">
              Settings › Magazines
            </Anchor>
          </Alert>
        )}
        {s && s.issues > 0 && (
          <Text size="sm" c="dimmed">
            {count(s.issues)} issues, {count(s.withText)} with their text{s.estimate ? `; the rest read at night, about ${s.estimate.hoursLeft} hours of reading left` : ''}.
          </Text>
        )}
        {(undated.data?.issues.length ?? 0) > 0 && (
          <Alert variant="light" color="gray">
            {undated.data!.issues.length === 1 ? 'One issue has' : `${count(undated.data!.issues.length)} issues have`} no date in its file{undated.data!.issues.length === 1 ? '' : 's'}.{' '}
            <Anchor component={Link} to="/leaves/undated">
              Name these
            </Anchor>
          </Alert>
        )}
        {!list.data ? (
          <Loader />
        ) : list.data.magazines.length === 0 ? (
          <Text c="dimmed">No magazines yet. Once the folder is read, they're here.</Text>
        ) : (
          <SimpleGrid cols={COVERS} spacing="sm">
            {list.data.magazines.map((m) => (
              <Anchor key={m.id} component={Link} to={`/leaves/${m.id}`} underline="never" c="inherit">
                <IssueCover
                  issue={m.coverIssue ? { id: m.coverIssue } : null}
                  caption={
                    <>
                      <Text size="sm" fw={600} lineClamp={2}>
                        {m.name}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {count(m.issues)} {m.issues === 1 ? 'issue' : 'issues'}
                        {m.from ? ` · ${m.from}${m.to && m.to !== m.from ? `–${m.to}` : ''}` : ''}
                      </Text>
                    </>
                  }
                />
              </Anchor>
            ))}
          </SimpleGrid>
        )}
      </Stack>
    </>
  );
}

/** A magazine's issues as covers, by year (a bar of its years to jump to one). */
export function MagazinePage() {
  const id = Number(useParams().id);
  const list = useQuery({ queryKey: ['magazines'], queryFn: () => api<{ magazines: Magazine[]; status: Status }>('/magazines') });
  const issues = useQuery({ queryKey: ['magazines', id], queryFn: () => api<{ issues: Issue[] }>(`/magazines/${id}`) });
  const m = list.data?.magazines.find((x) => x.id === id);
  const years = new Map<string, Issue[]>();
  for (const i of issues.data?.issues ?? []) {
    const y = i.year ? String(i.year) : 'No date';
    years.set(y, [...(years.get(y) ?? []), i]);
  }
  return (
    <>
      <Anchor component={Link} to="/leaves" size="sm" mb={4} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <IconArrowLeft size={14} /> All magazines
      </Anchor>
      <PageHeader help="magazines" title={m?.name ?? 'Magazine'} description={m ? `${count(m.issues)} issues${m.from ? `, ${m.from} to ${m.to}` : ''}${m.publisher ? `, from ${m.publisher}` : ''}.` : undefined} />
      {!issues.data ? (
        <Loader />
      ) : (
        <Stack gap="lg">
          {/* The years, to jump to one. */}
          {years.size > 3 && (
            <Group gap={4} wrap="wrap" aria-label="Years">
              {[...years.keys()].map((y) => (
                <Anchor key={y} href={`#year-${y}`} size="xs">
                  {y}
                </Anchor>
              ))}
            </Group>
          )}
          {[...years].map(([y, list]) => (
            <Stack key={y} gap="xs" id={`year-${y}`}>
              <Title order={3} size="h4">
                {y}
              </Title>
              <SimpleGrid cols={COVERS} spacing="sm">
                {list.map((i) => (
                  <Anchor key={i.id} component={Link} to={`/leaves/issue/${i.id}`} underline="never" c="inherit">
                    <IssueCover issue={i} caption={i.label.replace(`${i.magazine} `, '') + (i.title ? ` · ${i.title}` : '')} />
                  </Anchor>
                ))}
              </SimpleGrid>
            </Stack>
          ))}
        </Stack>
      )}
    </>
  );
}

/** A page's words found by a search, marked on it (their boxes in the picture's own pixels). */
function Marks({ issueId, page, words, img }: { issueId: number; page: number; words: string[]; img: HTMLImageElement | null }) {
  const found = useQuery({ queryKey: ['magazines', 'words', issueId, page], queryFn: () => api<{ words: { text: string; box: [number, number, number, number] }[]; width: number | null; height: number | null }>(`/magazines/issues/${issueId}/pages/${page}/words`), enabled: words.length > 0 });
  if (!img || !found.data || words.length === 0 || !img.naturalWidth) return null;
  // The boxes are in the scan's own pixels; the page shown may have been made smaller (D182).
  const W = found.data.width ?? img.naturalWidth;
  const H = found.data.height ?? img.naturalHeight;
  const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const want = new Set(words.map(norm));
  return (
    <>
      {found.data.words
        .filter((w) => want.has(norm(w.text)))
        .map((w, k) => (
          <Box
            key={k}
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: `${(w.box[0] / W) * 100}%`,
              top: `${(w.box[1] / H) * 100}%`,
              width: `${((w.box[2] - w.box[0]) / W) * 100}%`,
              height: `${((w.box[3] - w.box[1]) / H) * 100}%`,
              background: 'rgba(255, 200, 0, 0.35)',
              outline: '1px solid rgba(255, 170, 0, 0.9)',
              pointerEvents: 'none',
            }}
          />
        ))}
    </>
  );
}

/**
 * The reader (D177): a page at a time on a phone, two side by side on a wide screen (Settings > Magazines), turned by
 * the arrows, the arrow keys or a swipe; zoomed with the buttons or a double tap. It opens at ?page=, the searched
 * words marked when it came from a search; the place is kept for each issue.
 */
export function IssueReaderPage() {
  const id = Number(useParams().id);
  const editable = useCanEdit();
  const [outlines, setOutlines] = useState(true);
  const [marking, setMarking] = useState(false);
  const [params, setParams] = useSearchParams();
  const issue = useQuery({ queryKey: ['magazines', 'issue', id], queryFn: () => api<Issue>(`/magazines/issues/${id}`) });
  const wide = useMediaQuery('(min-width: 62em)') ?? false;
  const twoPages = useSetting('magazines.twoPages', true) && wide;
  const keyOf = `squirrelcade:leaves:${id}`;
  const stored = (() => {
    try {
      return Number(localStorage.getItem(keyOf)) || 1;
    } catch {
      return 1;
    }
  })();
  const page = Math.max(1, Number(params.get('page')) || stored);
  const words = (params.get('q') ?? '').match(/[\p{L}\p{N}]+/gu) ?? [];
  const [zoom, setZoom] = useState(1);
  const pages = issue.data?.pages ?? 0;
  // A spread: the cover alone, then 2-3, 4-5...
  const left = twoPages && page > 1 ? (page % 2 === 0 ? page : page - 1) : page;
  const shown = twoPages && left > 1 && left + 1 <= pages ? [left, left + 1] : [left];
  const step = shown.length;
  const go = (n: number) => {
    const to = Math.min(Math.max(1, n), Math.max(1, pages));
    try {
      localStorage.setItem(keyOf, String(to));
    } catch {
      // Storage off: the place isn't kept.
    }
    const next = new URLSearchParams(params);
    next.set('page', String(to));
    setParams(next, { replace: true });
  };
  useHotkeys([
    ['ArrowRight', () => go(left + step)],
    ['ArrowLeft', () => go(left - (twoPages && left > 2 ? 2 : 1))],
  ]);
  const touch = useRef<number | null>(null);
  const imgs = useRef<(HTMLImageElement | null)[]>([]);
  const [, setLoaded] = useState(0);
  useEffect(() => setZoom(1), [left]);
  if (!issue.data) return issue.isError ? <Text c="red">This issue couldn't be shown.</Text> : <Loader />;
  const i = issue.data;
  return (
    <Stack gap="xs">
      <Group justify="space-between" wrap="wrap" gap="xs">
        <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
          <ActionIcon component={Link} to={`/leaves/${i.magazineId}`} variant="subtle" aria-label={`All of ${i.magazine}`}>
            <IconArrowLeft size={18} />
          </ActionIcon>
          <Text fw={600} truncate>
            {i.label}
            {i.title ? ` · ${i.title}` : ''}
          </Text>
        </Group>
        <Group gap={4}>
          <ActionIcon variant="default" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} aria-label="Zoom out" disabled={zoom <= 1}>
            <IconZoomOut size={16} />
          </ActionIcon>
          <ActionIcon variant="default" onClick={() => setZoom((z) => Math.min(4, z + 0.5))} aria-label="Zoom in">
            <IconZoomIn size={16} />
          </ActionIcon>
          <ActionIcon variant="default" onClick={() => go(left - (twoPages && left > 2 ? 2 : 1))} disabled={left <= 1} aria-label="Previous page">
            <IconChevronLeft size={16} />
          </ActionIcon>
          <NumberInput size="xs" w={70} min={1} max={pages} value={page} onChange={(v) => typeof v === 'number' && go(v)} aria-label="Page" />
          <Text size="xs" c="dimmed">
            of {pages}
          </Text>
          <ActionIcon variant="default" onClick={() => go(left + step)} disabled={left + step > pages} aria-label="Next page">
            <IconChevronRight size={16} />
          </ActionIcon>
          {editable && <PrintedPage issueId={i.id} filePage={left} offset={i.pageOffset} />}
          {/* The games on the page (D192): their outlines on or off; marking one the text can't read. */}
          <Button size="compact-xs" variant={outlines ? 'light' : 'default'} onClick={() => setOutlines((x) => !x)}>
            Games
          </Button>
          {editable && (
            <Button size="compact-xs" variant={marking ? 'filled' : 'default'} onClick={() => setMarking((x) => !x)}>
              {marking ? 'Draw a box' : 'Mark a game'}
            </Button>
          )}
        </Group>
      </Group>
      <Box
        style={{ overflow: 'auto', maxHeight: 'calc(100dvh - 140px)', touchAction: zoom > 1 ? 'pan-x pan-y' : 'pan-y' }}
        onTouchStart={(e) => {
          touch.current = zoom === 1 ? (e.touches[0]?.clientX ?? null) : null;
        }}
        onTouchEnd={(e) => {
          const start = touch.current;
          const end = e.changedTouches[0]?.clientX;
          touch.current = null;
          if (start === null || end === undefined || Math.abs(end - start) < 60) return;
          go(end < start ? left + step : left - (twoPages && left > 2 ? 2 : 1));
        }}
        onDoubleClick={() => setZoom((z) => (z > 1 ? 1 : 2))}
      >
        <Group gap={4} wrap="nowrap" justify="center" align="flex-start" style={{ width: `${zoom * 100}%` }}>
          {shown.map((n, k) => (
            <Box key={n} pos="relative" style={{ flex: `0 1 ${100 / shown.length}%`, lineHeight: 0 }}>
              <img
                ref={(el) => {
                  imgs.current[k] = el;
                }}
                src={pageUrl(i.id, n, i.version, (window.innerWidth * zoom) / shown.length)}
                alt={`Page ${n}`}
                style={{ width: '100%', height: 'auto', display: 'block' }}
                onLoad={() => setLoaded((x) => x + 1)}
              />
              <Marks issueId={i.id} page={n} words={words} img={imgs.current[k] ?? null} />
              <PageGames issueId={i.id} page={n} marking={marking} shown={outlines} />
            </Box>
          ))}
        </Group>
      </Box>
      <IssueGames issueId={i.id} />
      {/* The next pages, fetched ahead so a turn is at once. */}
      <div style={{ display: 'none' }} aria-hidden="true">
        {[left + step, left + step + 1].filter((n) => n <= pages).map((n) => (
          <img key={n} src={pageUrl(i.id, n, i.version, (window.innerWidth * zoom) / shown.length)} alt="" loading="eager" />
        ))}
      </div>
    </Stack>
  );
}

/** Search magazines (D177): each page whose text has the words, its words marked; a tap opens the reader there. */
export function MagazineSearchPage() {
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  const list = useQuery({ queryKey: ['magazines'], queryFn: () => api<{ magazines: Magazine[]; status: Status }>('/magazines') });
  const [magazine, setMagazine] = useState<string | null>(null);
  const [from, setFrom] = useState<number | string>('');
  const [to, setTo] = useState<number | string>('');
  const [fromD] = useDebouncedValue(from, 400);
  const [toD] = useDebouncedValue(to, 400);
  const hits = useQuery({
    queryKey: ['magazines', 'search', q, magazine, fromD, toD],
    queryFn: () => api<{ hits: { issueId: number; label: string; page: number; snippet: string }[] }>(`/magazines/search?q=${encodeURIComponent(q)}${magazine ? `&magazine=${magazine}` : ''}${fromD ? `&from=${fromD}` : ''}${toD ? `&to=${toD}` : ''}`),
    enabled: q.trim().length > 0,
  });
  return (
    <>
      <Anchor component={Link} to="/leaves" size="sm" mb={4} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <IconArrowLeft size={14} /> All magazines
      </Anchor>
      <PageHeader help="magazines" title="Search the magazines" description="Every page whose text has the words (or the phrase, in quotes), best first." />
      <Stack gap="sm">
        <SearchBox initial={q} key={q} />
        <Group gap="xs" wrap="wrap">
          <Select size="xs" placeholder="Every magazine" data={(list.data?.magazines ?? []).map((m) => ({ value: String(m.id), label: m.name }))} value={magazine} onChange={setMagazine} clearable w={220} aria-label="Magazine" />
          <NumberInput size="xs" placeholder="From year" value={from} onChange={setFrom} min={1950} max={2100} w={110} aria-label="From year" />
          <NumberInput size="xs" placeholder="To year" value={to} onChange={setTo} min={1950} max={2100} w={110} aria-label="To year" />
        </Group>
        {hits.isFetching && <Loader size="sm" />}
        {hits.data && hits.data.hits.length === 0 && <Text c="dimmed">No page has those words{(list.data?.status.withText ?? 0) < (list.data?.status.issues ?? 0) ? ' yet: not every issue has its text read' : ''}.</Text>}
        {hits.data?.hits.map((h) => (
          <Card key={`${h.issueId}|${h.page}`} withBorder padding="xs" component={Link} to={`/leaves/issue/${h.issueId}?page=${h.page}&q=${encodeURIComponent(q)}`}>
            <Group gap="sm" wrap="nowrap" align="flex-start">
              <Image src={pageUrl(h.issueId, h.page, 0, 60)} w={60} h={80} fit="cover" radius="sm" alt="" loading="lazy" />
              <Stack gap={2} style={{ minWidth: 0 }}>
                <Text size="sm" fw={600}>
                  {h.label}, page {h.page}
                </Text>
                <Text size="sm" c="dimmed" lineClamp={3}>
                  {h.snippet.split(/(\[[^\]]*\])/).map((part, k) =>
                    part.startsWith('[') ? (
                      <mark key={k} style={{ background: 'var(--mantine-color-yellow-light)', color: 'inherit' }}>
                        {part.slice(1, -1)}
                      </mark>
                    ) : (
                      <span key={k}>{part}</span>
                    ),
                  )}
                </Text>
              </Stack>
            </Group>
          </Card>
        ))}
      </Stack>
    </>
  );
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Name these: the issues whose files give no date, a date for each (kept over what the file says). */
export function UndatedIssuesPage() {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ['magazines', 'undated'], queryFn: () => api<{ issues: Issue[]; guessed: Issue[] }>('/magazines/undated') });
  const save = useMutation({
    mutationFn: (v: { id: number; year: number; month: number | null }) => api(`/magazines/issues/${v.id}`, { method: 'PUT', json: { year: v.year, month: v.month } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['magazines'] }),
    onError: (err) => notifyError(err),
  });
  return (
    <>
      <Anchor component={Link} to="/leaves" size="sm" mb={4} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <IconArrowLeft size={14} /> All magazines
      </Anchor>
      <PageHeader help="magazines" title="Name these" description="The issues whose files don't say when they came out: give each its cover date, and it takes its place among its magazine's years." />
      {!list.data ? (
        <Loader />
      ) : list.data.issues.length === 0 ? (
        <Text c="dimmed">Every issue has its date.</Text>
      ) : (
        <Stack gap="xs">
          {list.data.issues.map((i) => (
            <UndatedRow key={i.id} issue={i} onSave={(year, month) => save.mutate({ id: i.id, year, month })} />
          ))}
        </Stack>
      )}
      {(list.data?.guessed.length ?? 0) > 0 && (
        <>
          <Title order={3} size="h4" mt="xl" mb={4}>
            Dated by Squirrelcade ({count(list.data!.guessed.length)})
          </Title>
          <Text size="sm" c="dimmed" mb="sm">
            Their files don't say either: these dates come from the magazine index, or from each issue's number between two dated issues of its magazine. Give one another date if it's wrong.
          </Text>
          <Stack gap="xs">
            {list.data!.guessed.map((i) => (
              <UndatedRow key={i.id} issue={i} onSave={(year, month) => save.mutate({ id: i.id, year, month })} />
            ))}
          </Stack>
        </>
      )}
    </>
  );
}

function UndatedRow({ issue, onSave }: { issue: Issue; onSave: (year: number, month: number | null) => void }) {
  const [year, setYear] = useState<number | string>(issue.year ?? '');
  const [month, setMonth] = useState<string | null>(issue.month ? String(issue.month) : null);
  return (
    <Card withBorder padding="xs">
      <Group gap="sm" wrap="wrap" align="flex-end">
        <Anchor component={Link} to={`/leaves/issue/${issue.id}`}>
          <Image src={pageUrl(issue.id, 1, issue.version, 45)} w={45} h={60} fit="cover" radius="sm" alt="" loading="lazy" />
        </Anchor>
        <Text size="sm" fw={600} style={{ flex: '1 1 180px' }}>
          {issue.label}
          {issue.title ? ` · ${issue.title}` : ''}
        </Text>
        <Select size="xs" placeholder="Month" data={MONTHS.map((m, k) => ({ value: String(k + 1), label: m }))} value={month} onChange={setMonth} clearable w={130} aria-label="Month" />
        <NumberInput size="xs" placeholder="Year" value={year} onChange={setYear} min={1950} max={2100} w={90} aria-label="Year" />
        <Button size="compact-sm" disabled={typeof year !== 'number'} onClick={() => typeof year === 'number' && onSave(year, month ? Number(month) : null)}>
          Save
        </Button>
        {issue.dateFrom && <Badge size="xs" variant="light" color="blue">{issue.dateFrom === 'index' ? 'from the magazine index' : 'from its number'}</Badge>}
        {issue.text !== 'none' && <Badge size="xs" variant="light" color="gray">{issue.text === 'failed' ? "text couldn't be read" : 'text read'}</Badge>}
      </Group>
    </Card>
  );
}

/**
 * The number printed on this page (D191): set once ("this is page 28"), it lines up the issue's printed page numbers
 * with its file's, so a review cited at page 28 opens there.
 */
function PrintedPage({ issueId, filePage, offset }: { issueId: number; filePage: number; offset: number | null }) {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (printed: number) => api(`/magazines/issues/${issueId}/page-offset`, { method: 'PUT', json: { filePage, printed } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['magazines'] }),
    onError: (err) => notifyError(err),
  });
  const shown = offset === null ? null : filePage - offset;
  return (
    <Tooltip label="The number printed on this page: set once, the issue's page numbers line up with the reviews that cite them" openDelay={400}>
      <NumberInput
        size="xs"
        w={92}
        placeholder="Printed #"
        aria-label="The number printed on this page"
        value={shown ?? ''}
        onChange={(v) => typeof v === 'number' && save.mutate(v)}
        min={-20}
        max={2000}
        leftSection={<Text size="xs">p.</Text>}
      />
    </Tooltip>
  );
}
