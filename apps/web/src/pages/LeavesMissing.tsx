import { Alert, Anchor, Badge, Button, Card, Collapse, Group, Loader, Menu, NumberInput, Select, Stack, Text, Title } from '@mantine/core';
import { IconArrowLeft, IconCopy, IconExternalLink, IconSearch } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../api';
import { PageHeader } from '../components';
import { count } from '../format';
import { notifyError, notifySuccess } from '../hooks';

type YearMonth = [number, number];

/** A missing issue (GET /api/v1/magazines/missing, D221). */
interface MissingIssue {
  key: string;
  number: number;
  volume: number | null;
  year: number | null;
  month: number | null;
  after: YearMonth | null;
  before: YearMonth | null;
  where: 'between' | 'before' | 'after';
  /** How many of your games it reviews, from Wikipedia's citations. */
  cited: number;
}

interface NumberJump {
  key: string;
  volume: number | null;
  from: number;
  to: number;
  fromDate: YearMonth;
  toDate: YearMonth;
  months: number;
}

interface MissingMonth {
  key: string;
  year: number;
  month: number;
  cited: number;
}

interface MissingMagazine {
  id: number;
  name: string;
  issues: number;
  first: { number: number; volume: number | null } | null;
  last: { number: number; volume: number | null } | null;
  unnumbered: number;
  byVolume: boolean;
  runFirst: number | null;
  runLast: number | null;
  missing: MissingIssue[];
  jumps: NumberJump[];
  months: MissingMonth[];
  answers: { key: string; answer: string }[];
  /** Numbers or months it never printed (the magazine index): not counted. */
  neverPrinted: string[];
}

interface Suggested {
  name: string;
  games: number;
  examples: string[];
}

interface FindLink {
  name: string;
  url: string;
}

export interface MissingAnswer {
  magazines: MissingMagazine[];
  suggestions: Suggested[];
  links: FindLink[];
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = ([y, m]: YearMonth) => `${MONTHS[m - 1]} ${y}`;
const issueName = (i: { number: number; volume: number | null }) => `${i.volume !== null ? `Vol. ${i.volume} ` : ''}#${i.number}`;

/** The never-printed keys as words: "#81–90", "Vol. 6 #1, #3", "January 1982". */
function neverWords(keys: string[]): string {
  const months = keys.filter((k) => /^\d{4}-\d{2}$/.test(k)).map((k) => monthName([Number(k.slice(0, 4)), Number(k.slice(5))]));
  const numbers = new Map<string, number[]>();
  for (const k of keys) {
    const m = /^(?:v(\d+))?#(\d+)$/.exec(k);
    if (m) numbers.set(m[1] ?? '', [...(numbers.get(m[1] ?? '') ?? []), Number(m[2])]);
  }
  const parts = [...numbers].map(([v, list]) => {
    const runs: string[] = [];
    const sorted = list.sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; ) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
      runs.push(j > i ? `#${sorted[i]}–${sorted[j]}` : `#${sorted[i]}`);
      i = j + 1;
    }
    return `${v ? `Vol. ${v} ` : ''}${runs.join(', ')}`;
  });
  return [...parts, ...months].join('; ');
}

/** When a missing issue came out: its month, or the months of the issues you have on each side. */
function whenOf(i: MissingIssue): string {
  if (i.year && i.month) return monthName([i.year, i.month]);
  if (i.after && i.before) return `between ${monthName(i.after)} and ${monthName(i.before)}`;
  if (i.before) return `before ${monthName(i.before)}`;
  if (i.after) return `after ${monthName(i.after)}`;
  return '';
}

/** The search words for an issue: its magazine and number, or its month. */
function wordsOf(magazine: string, i: { number?: number; volume?: number | null; year?: number | null; month?: number | null }): Record<string, string> {
  const month = i.month ? MONTHS[i.month - 1]! : '';
  const year = i.year ? String(i.year) : '';
  const number = i.number !== undefined ? String(i.number) : '';
  const q = number ? `${magazine}${i.volume ? ` Vol ${i.volume}` : ''} ${number}` : [magazine, month, year].filter(Boolean).join(' ');
  return { q, magazine, number, year, month };
}

const fill = (url: string, words: Record<string, string>) => url.replace(/\{(q|magazine|number|year|month)\}/g, (_, k: string) => encodeURIComponent(words[k] ?? ''));

/** Look for it: the places in Settings > Magazines > Where to look for an issue. */
function LookFor({ links, words }: { links: FindLink[]; words: Record<string, string> }) {
  if (links.length === 0) return null;
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <Button size="compact-xs" variant="light" leftSection={<IconSearch size={12} />}>
          Look for it
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        {links.map((l) => (
          <Menu.Item key={l.name} component="a" href={fill(l.url, words)} target="_blank" rel="noopener noreferrer" rightSection={<IconExternalLink size={12} />}>
            {l.name}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}

/** "Reviews 3 of your games": from Wikipedia's citations of the games you have. */
function Cited({ n }: { n: number }) {
  return n > 0 ? (
    <Badge size="xs" variant="light" color="teal">
      reviews {n} of your games
    </Badge>
  ) : null;
}

function IssueRow({ magazine, issue, links, onNot }: { magazine: string; issue: MissingIssue; links: FindLink[]; onNot: () => void }) {
  return (
    <Group gap="xs" wrap="wrap" py={2}>
      <Text size="sm" fw={600} miw={70}>
        {issueName(issue)}
      </Text>
      <Text size="sm" c="dimmed" style={{ flex: '1 1 160px' }}>
        {whenOf(issue)}
      </Text>
      <Cited n={issue.cited} />
      <LookFor links={links} words={wordsOf(magazine, issue)} />
      <Button size="compact-xs" variant="subtle" color="gray" onClick={onNot}>
        Not an issue
      </Button>
    </Group>
  );
}

/** Consecutive missing issues, as one line that opens to each (a short run shows them at once). */
function Run({ magazine, run, links, onNot }: { magazine: string; run: MissingIssue[]; links: FindLink[]; onNot: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  if (run.length <= 3) return run.map((i) => <IssueRow key={i.key} magazine={magazine} issue={i} links={links} onNot={() => onNot(i.key)} />);
  const a = run[0]!;
  const b = run.at(-1)!;
  const span = a.year && a.month && b.year && b.month ? `${monthName([a.year, a.month])} to ${monthName([b.year, b.month])}` : a.where === 'before' && a.before ? `before your first (${monthName(a.before)})` : a.after && b.before ? `between ${monthName(a.after)} and ${monthName(b.before)}` : a.after ? `after ${monthName(a.after)}` : '';
  const cited = run.reduce((t, i) => t + i.cited, 0);
  return (
    <Stack gap={0}>
      <Group gap="xs" wrap="wrap" py={2}>
        <Text size="sm" fw={600} miw={70}>
          {issueName(a)}–{b.number}
        </Text>
        <Text size="sm" c="dimmed" style={{ flex: '1 1 160px' }}>
          {count(run.length)} issues{span ? ` · ${span}` : ''}
        </Text>
        <Cited n={cited} />
        <Button size="compact-xs" variant="subtle" onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide them' : 'Show them'}
        </Button>
      </Group>
      <Collapse expanded={open}>
        <Stack gap={0} pl="md">
          {open && run.map((i) => <IssueRow key={i.key} magazine={magazine} issue={i} links={links} onNot={() => onNot(i.key)} />)}
        </Stack>
      </Collapse>
    </Stack>
  );
}

/** Missing issues split into runs of consecutive numbers (in the same volume, on the same side of your run). */
function runsOf(missing: MissingIssue[]): MissingIssue[][] {
  const runs: MissingIssue[][] = [];
  for (const i of missing) {
    const last = runs.at(-1)?.at(-1);
    if (last && last.volume === i.volume && last.where === i.where && last.number + 1 === i.number) runs.at(-1)!.push(i);
    else runs.push([i]);
  }
  return runs;
}

/** The run's first and last issue, as the owner names them ("It ran from #1 to #112"). */
function RunEnds({ m, onSave }: { m: MissingMagazine; onSave: (key: 'first' | 'last', value: number | null) => void }) {
  const [first, setFirst] = useState<number | string>(m.runFirst ?? '');
  const [last, setLast] = useState<number | string>(m.runLast ?? '');
  const commit = (key: 'first' | 'last', v: number | string, was: number | null) => {
    const value = typeof v === 'number' ? v : null;
    if (value !== was) onSave(key, value);
  };
  return (
    <Group gap={6} wrap="wrap">
      <Text size="xs" c="dimmed">
        It ran from #
      </Text>
      <NumberInput size="xs" w={78} min={1} max={99999} placeholder={m.byVolume ? '' : '1'} value={first} onChange={setFirst} onBlur={() => commit('first', first, m.runFirst)} aria-label={`${m.name}: its first issue`} disabled={m.byVolume} />
      <Text size="xs" c="dimmed">
        to #
      </Text>
      <NumberInput size="xs" w={78} min={1} max={99999} placeholder="?" value={last} onChange={setLast} onBlur={() => commit('last', last, m.runLast)} aria-label={`${m.name}: its last issue`} disabled={m.byVolume} />
    </Group>
  );
}

function MagazineGaps({ m, links, answer }: { m: MissingMagazine; links: FindLink[]; answer: (id: number, key: string, value: string | null) => void }) {
  const [answersOpen, setAnswersOpen] = useState(false);
  const missing = m.missing.length + m.months.length;
  const have = m.first && m.last ? `${issueName(m.first)} to ${issueName(m.last)}` : null;
  return (
    <Card withBorder padding="sm">
      <Stack gap={6}>
        <Group justify="space-between" wrap="wrap" gap="xs">
          <div>
            <Anchor component={Link} to={`/leaves/${m.id}`} fw={600}>
              {m.name}
            </Anchor>
            <Text size="xs" c="dimmed">
              You have {count(m.issues)} {m.issues === 1 ? 'issue' : 'issues'}
              {have ? `, ${have}` : ''}
              {m.unnumbered > 0 ? ` (${count(m.unnumbered)} without a number)` : ''} · {missing === 0 ? 'nothing missing' : `${count(missing)} missing`}
            </Text>
          </div>
          {m.first && !m.byVolume && <RunEnds m={m} onSave={(key, value) => answer(m.id, key, value === null ? null : String(value))} />}
        </Group>
        {m.neverPrinted.length > 0 && (
          <Text size="xs" c="dimmed">
            Never printed, so not counted: {neverWords(m.neverPrinted)}.
          </Text>
        )}
        {m.jumps.map((j) => (
          <Alert key={j.key} variant="light" color="gray" p="xs">
            <Text size="sm">
              {j.volume !== null ? `Vol. ${j.volume} ` : ''}#{j.from} to #{j.to} ({monthName(j.fromDate)} to {monthName(j.toDate)}): the numbers jump ahead of the months
              {j.months > 0 ? `, with ${j.months} ${j.months === 1 ? 'month' : 'months'} between` : ''}. The magazine may have skipped numbers, or a file's number is off.
            </Text>
            <Group gap="xs" mt={6}>
              <Button size="compact-xs" variant="default" onClick={() => answer(m.id, j.key, 'none')}>
                No issues there
              </Button>
              <Button size="compact-xs" variant="default" onClick={() => answer(m.id, j.key, 'missing')}>
                They're missing
              </Button>
            </Group>
          </Alert>
        ))}
        {runsOf(m.missing).map((run) => (
          <Run key={run[0]!.key} magazine={m.name} run={run} links={links} onNot={(key) => answer(m.id, key, 'not')} />
        ))}
        {m.months.length > 0 && (
          <>
            <Text size="xs" c="dimmed">
              Months with no issue (it may not have come out every month):
            </Text>
            {m.months.map((mo) => (
              <Group key={mo.key} gap="xs" wrap="wrap" py={2}>
                <Text size="sm" fw={600} style={{ flex: '1 1 160px' }}>
                  {monthName([mo.year, mo.month])}
                </Text>
                <Cited n={mo.cited} />
                <LookFor links={links} words={wordsOf(m.name, mo)} />
                <Button size="compact-xs" variant="subtle" color="gray" onClick={() => answer(m.id, mo.key, 'not')}>
                  It didn't come out
                </Button>
              </Group>
            ))}
          </>
        )}
        {m.answers.length > 0 && (
          <>
            <Anchor component="button" type="button" size="xs" c="dimmed" ta="left" onClick={() => setAnswersOpen((o) => !o)}>
              Your answers ({m.answers.length})
            </Anchor>
            <Collapse expanded={answersOpen}>
              <Group gap="xs" wrap="wrap">
                {m.answers.map((a) => (
                  <Badge
                    key={a.key}
                    variant="default"
                    rightSection={
                      <Anchor component="button" type="button" size="xs" onClick={() => answer(m.id, a.key, null)} aria-label={`Take back ${a.key}`}>
                        undo
                      </Anchor>
                    }
                  >
                    {a.key.replace(/^jump:/, '').replace(/^v(\d+)#/, 'Vol. $1 #')} · {a.answer === 'not' ? 'not an issue' : a.answer === 'none' ? 'no issues there' : 'missing'}
                  </Badge>
                ))}
              </Group>
            </Collapse>
          </>
        )}
      </Stack>
    </Card>
  );
}

/** What's missing (D221): the issues missing from each run, where to look for them, and magazines your games' reviews are in. */
export function MissingIssuesPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const list = useQuery({ queryKey: ['magazines', 'missing'], queryFn: () => api<MissingAnswer>('/magazines/missing') });
  const answer = useMutation({
    mutationFn: (v: { id: number; key: string; value: string | null }) => api(`/magazines/${v.id}/gaps`, { method: 'PUT', json: { key: v.key, answer: v.value } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['magazines', 'missing'] }),
    onError: (err) => notifyError(err),
  });
  const skip = useMutation({
    mutationFn: (name: string) => api('/magazines/suggestions/skip', { method: 'POST', json: { name } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['magazines', 'missing'] }),
    onError: (err) => notifyError(err),
  });
  const data = list.data;
  const shownId = Number(params.get('magazine')) || null;
  const shown = (data?.magazines ?? []).filter((m) => (shownId ? m.id === shownId : m.missing.length + m.months.length + m.jumps.length > 0));
  const total = shown.reduce((t, m) => t + m.missing.length + m.months.length, 0);
  const before = shown.reduce((t, m) => t + m.missing.filter((i) => i.where === 'before').length, 0);
  const mostCited = shown
    .flatMap((m) => m.missing.filter((i) => i.cited > 0).map((i) => ({ m, i })))
    .sort((a, b) => b.i.cited - a.i.cited)
    .slice(0, 12);
  const copy = async () => {
    const lines = shown.flatMap((m) => [...m.missing.map((i) => `${m.name} ${issueName(i)}${whenOf(i) ? ` (${whenOf(i)})` : ''}`), ...m.months.map((mo) => `${m.name}, ${monthName([mo.year, mo.month])}`)]);
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      notifySuccess(`${count(lines.length)} missing issues copied.`, 'Copied');
    } catch (err) {
      notifyError(err);
    }
  };
  return (
    <>
      <Anchor component={Link} to="/leaves" size="sm" mb={4} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <IconArrowLeft size={14} /> All magazines
      </Anchor>
      <PageHeader
        help="magazines"
        title="What's missing"
        description="The issues missing from your runs, worked out from the numbers and dates of the ones you have; where to look for them; and the magazines your games' reviews are in that you don't have yet."
        actions={
          total > 0 && (
            <Button variant="default" leftSection={<IconCopy size={16} />} onClick={() => void copy()}>
              Copy the list
            </Button>
          )
        }
      />
      {!data ? (
        <Loader />
      ) : (
        <Stack gap="md">
          <Group gap="sm" wrap="wrap">
            <Select
              size="sm"
              w={280}
              aria-label="Magazine"
              placeholder="Every magazine with something missing"
              clearable
              data={data.magazines.map((m) => ({ value: String(m.id), label: `${m.name} (${count(m.missing.length + m.months.length)})` }))}
              value={shownId ? String(shownId) : null}
              onChange={(v) => setParams(v ? { magazine: v } : {}, { replace: true })}
            />
            <Text size="sm" c="dimmed">
              {total === 0 ? 'Nothing missing.' : `${count(total)} missing${before > 0 ? `, ${count(before)} of them before the first issue you have` : ''}.`}
            </Text>
          </Group>
          {mostCited.length > 0 && (
            <Card withBorder padding="sm">
              <Title order={3} size="h5" mb={4}>
                The missing issues that review the most of your games
              </Title>
              <Stack gap={0}>
                {mostCited.map(({ m, i }) => (
                  <Group key={`${m.id}${i.key}`} gap="xs" wrap="wrap" py={2}>
                    <Text size="sm" fw={600} style={{ flex: '1 1 220px' }}>
                      {m.name} {issueName(i)}
                      <Text span size="sm" c="dimmed" fw={400}>
                        {whenOf(i) ? ` · ${whenOf(i)}` : ''}
                      </Text>
                    </Text>
                    <Cited n={i.cited} />
                    <LookFor links={data.links} words={wordsOf(m.name, i)} />
                  </Group>
                ))}
              </Stack>
            </Card>
          )}
          {shown.map((m) => (
            <MagazineGaps key={m.id} m={m} links={data.links} answer={(id, key, value) => answer.mutate({ id, key, value })} />
          ))}
          <Title order={3} size="h4" mt="md">
            Magazines your games' reviews are in
          </Title>
          {data.suggestions.length === 0 ? (
            <Text size="sm" c="dimmed">
              None yet: they're worked out each night, from the review tables Roots reads in your games' Wikipedia articles (Settings › Magazines › What's missing).
            </Text>
          ) : (
            <>
              <Text size="sm" c="dimmed">
                The print magazines Wikipedia cites most for the reviews of the games you have, that you don't have yet.
              </Text>
              <Stack gap={4}>
                {data.suggestions.map((s) => (
                  <Card key={s.name} withBorder padding="xs">
                    <Group gap="xs" wrap="wrap">
                      <div style={{ flex: '1 1 240px' }}>
                        <Text size="sm" fw={600}>
                          {s.name}
                        </Text>
                        <Text size="xs" c="dimmed">
                          Reviews {count(s.games)} of your games{s.examples.length > 0 ? `, like ${s.examples.join(', ')}` : ''}
                        </Text>
                      </div>
                      <LookFor links={data.links} words={wordsOf(s.name, {})} />
                      <Button size="compact-xs" variant="subtle" color="gray" loading={skip.isPending && skip.variables === s.name} onClick={() => skip.mutate(s.name)}>
                        Not for me
                      </Button>
                    </Group>
                  </Card>
                ))}
              </Stack>
            </>
          )}
        </Stack>
      )}
    </>
  );
}
