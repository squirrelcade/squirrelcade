import { KNOWN_PLATFORMS } from '@squirrelcade/core';
import { Anchor, Badge, Button, Card, Group, Stack, Table, Text, Textarea } from '@mantine/core';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { PageHeader, type SortDirection } from '../components';
import { count } from '../format';
import { StashMark } from '../Acorn';
import { GameTitle } from '../GameDrawer';
import { PreferencePicker } from '../Preference';
import { notifyError } from '../hooks';
import { parseLine, type Line } from '../lines';
import { sortRows, useSort } from '../sort';

/** One answer of POST /api/v1/owned. */
interface Owned {
  title: string;
  platform: string | null;
  owned: boolean;
  ownedOn: string[];
  ownedOnPc: string[];
  answers: { platformKey: string; platform: string; title: string; answer: string; preference?: string | null }[];
}

/** Store Mode's answer to a barcode (GET /api/v1/lookup/barcode/<digits>): the games it may be. */
interface BarcodeAnswer {
  results: { platformKey: string; title: string }[];
}

/** How many lines one check reads, and how many go in each question to the server. */
const MAX_LINES = 500;
const BATCH = 100;

type Verdict = 'own' | 'need' | 'elsewhere' | 'check' | 'unknown' | 'other';

const VERDICTS: Record<Verdict, { label: string; color: string }> = {
  own: { label: 'You own it', color: 'blue' },
  need: { label: 'Need it', color: 'green' },
  elsewhere: { label: 'Owned on another console', color: 'yellow' },
  check: { label: 'Maybe owned: check', color: 'orange' },
  unknown: { label: 'Not in your catalogs', color: 'gray' },
  other: { label: 'Not a collecting target', color: 'gray' },
};

/**
 * The answers' columns and which way each sorts first (D144): as the list had them (no heading), games A to Z, and
 * answers in the order of the counts above them (you own it first).
 */
const SORTS = { listed: 'asc', title: 'asc', answer: 'asc' } as const satisfies Record<string, SortDirection>;

/** What a line comes to, from the server's answers for it. */
function verdict(r: Owned): Verdict {
  if (r.owned) return 'own';
  if (r.ownedOn.length > 0) return 'elsewhere';
  if (r.answers.some((a) => a.answer === 'need' || a.answer === 'unconfirmed')) return 'need';
  if (r.answers.some((a) => a.answer === 'check')) return 'check';
  return r.answers.length === 0 ? 'unknown' : 'other';
}

/**
 * Check a list: paste titles (a store's list, a lot for sale), one per line with its console if you like, and see
 * which you own, which you need and which you have on another console, with the same title rules as the catalogs.
 */
export function ListCheckPage() {
  const [text, setText] = useState('');
  // A heading sorts the answers by its column (D144); until one is clicked they stay in the list's order.
  const sorting = useSort(SORTS, 'listed');
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, MAX_LINES)
    .map(parseLine);
  const check = useMutation({
    mutationFn: async (lines: Line[]) => {
      // Barcodes first, one at a time as Store Mode looks them up (known ones, else the barcode service): each
      // becomes the game it's most likely to be.
      const asked: Line[] = [];
      for (const line of lines) {
        if (!line.barcode) {
          asked.push(line);
          continue;
        }
        const best = (await api<BarcodeAnswer>(`/lookup/barcode/${line.barcode}`).catch(() => null))?.results[0];
        asked.push(best ? { ...line, title: best.title, platformKey: best.platformKey } : line);
      }
      const out: Owned[] = [];
      for (let i = 0; i < asked.length; i += BATCH) {
        const games = asked.slice(i, i + BATCH).map((l) => ({ title: l.title, platform: l.platformKey }));
        out.push(...(await api<{ results: Owned[] }>('/owned', { method: 'POST', json: { games } })).results);
      }
      return asked.map((line, i) => ({ line, result: out[i]! }));
    },
    onError: (err) => notifyError(err),
  });
  const rows = check.data ?? [];
  const tally = new Map<Verdict, number>();
  for (const r of rows) tally.set(verdict(r.result), (tally.get(verdict(r.result)) ?? 0) + 1);
  const sorted = sortRows(
    rows.map((r, i) => ({ ...r, i })),
    (r) => (sorting.by === 'title' ? (r.result.answers[0]?.title ?? r.line.title) : sorting.by === 'answer' ? Object.keys(VERDICTS).indexOf(verdict(r.result)) : r.i),
    sorting.dir,
  );

  return (
    <Stack maw={900} gap="md">
      <PageHeader help="store-mode"
        title="Check a list"
        description={
          <>
            Paste a list of games (a store&apos;s, or a lot for sale), one per line, with its console if you like: &quot;Chrono Trigger (SNES)&quot; or &quot;Okami - Wii&quot;. A line without a console asks about all of them. Barcodes work too, one per line, as a handheld scanner types them.{' '}
            <Anchor component={Link} to="/store" size="sm">
              Store Mode
            </Anchor>{' '}
            checks one game at a time.
          </>
        }
      />
      <Textarea
        aria-label="Games to check, one per line"
        placeholder={'Chrono Trigger (SNES)\nOkami - Wii\nHalo 3'}
        autosize
        minRows={6}
        maxRows={16}
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
      />
      <Group>
        <Button onClick={() => check.mutate(lines)} loading={check.isPending} disabled={lines.length === 0}>
          Check {lines.length > 0 ? count(lines.length) : ''} {lines.length === 1 ? 'game' : 'games'}
        </Button>
        {text.split('\n').filter((l) => l.trim()).length > MAX_LINES && (
          <Text size="sm" c="dimmed">
            The first {MAX_LINES} lines are checked.
          </Text>
        )}
      </Group>
      {rows.length > 0 && (
        <>
          <Group gap={6}>
            {(Object.keys(VERDICTS) as Verdict[])
              .filter((v) => tally.get(v))
              .map((v) => (
                <Badge key={v} variant="light" color={VERDICTS[v].color} style={{ textTransform: 'none' }} leftSection={v === 'own' ? <StashMark size={12} /> : undefined}>
                  {VERDICTS[v].label}: {count(tally.get(v)!)}
                </Badge>
              ))}
          </Group>
          <Card withBorder p={0}>
            <Table.ScrollContainer minWidth={520}>
              <Table verticalSpacing={6}>
                <Table.Thead>
                  <Table.Tr>
                    {sorting.th('title', 'Game')}
                    {sorting.th('answer', 'Answer')}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {sorted.map(({ line, result, i }) => {
                    const v = verdict(result);
                    const first = result.answers[0];
                    return (
                      <Table.Tr key={i}>
                        <Table.Td>
                          {first ? <GameTitle platformKey={first.platformKey} title={first.title} /> : <Text size="sm">{line.title}</Text>}
                          <Text size="xs" c="dimmed">
                            {[
                              line.platformKey ? (KNOWN_PLATFORMS.find((p) => p.key === line.platformKey)?.name ?? line.platformKey) : 'any console',
                              line.barcode ? `barcode ${line.barcode}` : first && first.title !== line.title ? `you wrote "${line.title}"` : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Badge variant="light" color={VERDICTS[v].color} style={{ textTransform: 'none' }} leftSection={v === 'own' ? <StashMark size={12} /> : undefined}>
                            {VERDICTS[v].label}
                          </Badge>
                          {(result.ownedOn.length > 0 || result.ownedOnPc.length > 0) && (
                            <Text size="xs" c="dimmed">
                              {[result.ownedOn.length > 0 ? `on ${result.ownedOn.join(', ')}` : null, result.ownedOnPc.length > 0 ? `PC: ${result.ownedOnPc.join(', ')}` : null].filter(Boolean).join(' · ')}
                            </Text>
                          )}
                          {first && !result.owned && first.preference !== undefined && (
                            <Group mt={4}>
                              <PreferencePicker platformKey={first.platformKey} title={first.title} value={first.preference} width={170} />
                            </Group>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Card>
        </>
      )}
    </Stack>
  );
}
