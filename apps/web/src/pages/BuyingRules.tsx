import { ActionIcon, Alert, Anchor, Badge, Button, Card, Checkbox, Collapse, FileButton, Group, Loader, Modal, SegmentedControl, Stack, Switch, Table, Text, Textarea, TextInput, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconArrowDown, IconArrowUp, IconPencil, IconPlus, IconTrash, IconUpload } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, errorMessage } from '../api';
import { PageHeader } from '../components';

interface Rule {
  id: number;
  number: number | null;
  title: string;
  text: string;
  kind: 'rule' | 'preference';
  area: string;
  ref: string;
  notes: string;
  active: boolean;
  source: string;
}

interface ImportRow {
  title: string;
  console: string;
  platformKey: string | null;
  matched: string | null;
  fate: 'add' | 'skip' | 'unknown';
  why: string;
  what: string;
}

interface Preview {
  files: { name: string; kind: string | null; rows: number; problem?: string }[];
  rules: { ref: string; title: string; text: string; add: boolean; why?: string }[];
  exclusions: ImportRow[];
  preferences: ImportRow[];
  details: (ImportRow & { fields: string[]; proofPending: boolean })[];
  applied?: { rules: number; exclusions: number; preferences: number; details: number };
}

type Draft = Pick<Rule, 'title' | 'text' | 'kind' | 'area' | 'notes' | 'active'>;
const EMPTY: Draft = { title: '', text: '', kind: 'rule', area: '', notes: '', active: true };

/**
 * Your buying rules (1.5.0, T-278): the owner's own rules for buying, numbered and in their words, kept here and read by
 * Claude through the connector's get_buying_rules. Scoring stays in Acorns ranking. Bringing in a spreadsheet's wishlist
 * (its rules, the games not to recommend, the owner's say on games, what's known about them) only adds.
 */
export function BuyingRulesPage() {
  const qc = useQueryClient();
  const rules = useQuery({ queryKey: ['buying-rules'], queryFn: () => api<{ rules: Rule[] }>('/wishlist/rules') });
  const [editing, setEditing] = useState<{ id: number | null; draft: Draft } | null>(null);
  const [removing, setRemoving] = useState<Rule | null>(null);
  const [openNotes, setOpenNotes] = useState<Set<number>>(new Set());
  const refresh = () => qc.invalidateQueries({ queryKey: ['buying-rules'] });

  const save = useMutation({
    mutationFn: (e: { id: number | null; draft: Draft }) => (e.id === null ? api('/wishlist/rules', { method: 'POST', json: e.draft }) : api(`/wishlist/rules/${e.id}`, { method: 'PUT', json: e.draft })),
    onSuccess: () => {
      setEditing(null);
      refresh();
    },
    onError: (err) => notifications.show({ color: 'red', message: errorMessage(err) }),
  });
  const patch = useMutation({
    mutationFn: (e: { id: number; active: boolean }) => api(`/wishlist/rules/${e.id}`, { method: 'PUT', json: { active: e.active } }),
    onSuccess: refresh,
    onError: (err) => notifications.show({ color: 'red', message: errorMessage(err) }),
  });
  const order = useMutation({
    mutationFn: (ids: number[]) => api('/wishlist/rules/order', { method: 'PUT', json: { ids } }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api(`/wishlist/rules/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setRemoving(null);
      refresh();
    },
  });

  const list = rules.data?.rules ?? [];
  const move = (i: number, by: number) => {
    const ids = list.map((r) => r.id);
    const [id] = ids.splice(i, 1);
    ids.splice(i + by, 0, id!);
    order.mutate(ids);
  };

  return (
    <>
      <PageHeader
        help="wishlist"
        title="Your buying rules"
        description={
          <>
            Your own rules for buying, numbered and in your words: what a copy must have, which consoles you buy which games on, how you judge a deal or a shop. Claude reads them through the Squirrelcade connector when it looks for deals or answers what to buy. How much you want each game (acorns) is worked out from{' '}
            <Anchor component={Link} to="/acorns" size="sm">
              Acorns ranking
            </Anchor>
            .
          </>
        }
        actions={
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing({ id: null, draft: EMPTY })}>
            Add a rule
          </Button>
        }
      />
      {rules.isLoading ? (
        <Loader />
      ) : list.length === 0 ? (
        <Stack align="center" my="xl" gap="xs">
          <Text size="lg">No buying rules yet.</Text>
          <Text c="dimmed" size="sm" ta="center" maw={520}>
            Add one, such as "Only copies with the manual, seen in the seller's own photos", or bring in the rules you keep in a spreadsheet below.
          </Text>
        </Stack>
      ) : (
        <Stack gap="sm" mb="xl">
          {list.map((r, i) => (
            <Card key={r.id} withBorder padding="sm" opacity={r.active ? 1 : 0.6} data-rule={r.id}>
              <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
                <Group align="flex-start" gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                  <Text fw={700} w={28} ta="right" c={r.active ? undefined : 'dimmed'} style={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                    {r.number ?? '–'}
                  </Text>
                  <Stack gap={4} style={{ minWidth: 0 }}>
                    <Group gap={6} wrap="wrap">
                      <Text fw={600}>{r.title}</Text>
                      <Badge size="xs" variant="light" color={r.kind === 'rule' ? 'forest' : 'gray'}>
                        {r.kind === 'rule' ? 'Rule' : 'Preference'}
                      </Badge>
                      {!r.active && (
                        <Badge size="xs" variant="outline" color="gray">
                          Off
                        </Badge>
                      )}
                      {r.ref && (
                        <Text size="xs" c="dimmed">
                          {r.source === 'import' ? `from your spreadsheet, ${r.ref}` : r.ref}
                        </Text>
                      )}
                    </Group>
                    {r.area && (
                      <Text size="xs" c="dimmed">
                        For: {r.area}
                      </Text>
                    )}
                    <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                      {r.text}
                    </Text>
                    {r.notes && (
                      <>
                        <Anchor component="button" type="button" size="xs" w="fit-content" onClick={() => setOpenNotes((s) => new Set(s.has(r.id) ? [...s].filter((x) => x !== r.id) : [...s, r.id]))}>
                          {openNotes.has(r.id) ? 'Hide the notes' : 'Notes and exceptions'}
                        </Anchor>
                        <Collapse expanded={openNotes.has(r.id)}>
                          <Text size="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap' }}>
                            {r.notes}
                          </Text>
                        </Collapse>
                      </>
                    )}
                  </Stack>
                </Group>
                <Group gap={2} wrap="nowrap" style={{ flexShrink: 0 }}>
                  <Tooltip label={r.active ? 'On: Claude follows it' : 'Off: kept, not followed'}>
                    <Switch size="xs" checked={r.active} onChange={(e) => patch.mutate({ id: r.id, active: e.currentTarget.checked })} aria-label={`${r.title}: on`} mr={4} />
                  </Tooltip>
                  <ActionIcon variant="subtle" color="gray" aria-label={`Move ${r.title} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                    <IconArrowUp size={16} />
                  </ActionIcon>
                  <ActionIcon variant="subtle" color="gray" aria-label={`Move ${r.title} down`} disabled={i === list.length - 1} onClick={() => move(i, 1)}>
                    <IconArrowDown size={16} />
                  </ActionIcon>
                  <ActionIcon variant="subtle" color="gray" aria-label={`Change ${r.title}`} onClick={() => setEditing({ id: r.id, draft: { title: r.title, text: r.text, kind: r.kind, area: r.area, notes: r.notes, active: r.active } })}>
                    <IconPencil size={16} />
                  </ActionIcon>
                  <ActionIcon variant="subtle" color="red" aria-label={`Remove ${r.title}`} onClick={() => setRemoving(r)}>
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              </Group>
            </Card>
          ))}
        </Stack>
      )}

      <BringIn onDone={refresh} />

      <Modal opened={editing !== null} onClose={() => setEditing(null)} title={editing?.id === null ? 'Add a rule' : 'Change the rule'} size="lg">
        {editing && (
          <Stack gap="sm">
            <TextInput label="Name" description="A few words: Condition, Sports games, Shipping." value={editing.draft.title} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, title: e.currentTarget.value } })} />
            <Textarea label="The rule" autosize minRows={3} maxRows={14} value={editing.draft.text} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, text: e.currentTarget.value } })} />
            <SegmentedControl
              value={editing.draft.kind}
              onChange={(v) => setEditing({ ...editing, draft: { ...editing.draft, kind: v as Draft['kind'] } })}
              data={[
                { value: 'rule', label: 'A rule (must hold)' },
                { value: 'preference', label: 'A preference (leans one way)' },
              ]}
            />
            <TextInput label="What it's for" description="Optional: the consoles, games or deals it covers." value={editing.draft.area} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, area: e.currentTarget.value } })} />
            <Textarea label="Notes and exceptions" description="Optional." autosize minRows={2} maxRows={10} value={editing.draft.notes} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, notes: e.currentTarget.value } })} />
            <Switch label="On (Claude follows it)" checked={editing.draft.active} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, active: e.currentTarget.checked } })} />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button loading={save.isPending} disabled={!editing.draft.text.trim() && !editing.draft.title.trim()} onClick={() => save.mutate(editing)}>
                Save
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
      <Modal opened={removing !== null} onClose={() => setRemoving(null)} title="Remove this rule?">
        <Stack gap="sm">
          <Text size="sm">
            "{removing?.title}" is removed for good. To keep it without Claude following it, switch it off instead.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setRemoving(null)}>
              Keep it
            </Button>
            <Button color="red" loading={remove.isPending} onClick={() => removing && remove.mutate(removing.id)}>
              Remove
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

const KIND_NAMES: Record<string, string> = { rules: 'Rules', exclusions: 'Games not to recommend', preferences: 'Your say on games', details: "Games' facts" };

/** Bringing in a wishlist kept in a spreadsheet: its tabs saved as CSV, previewed, then added (never over what you set). */
function BringIn({ onDone }: { onDone: () => void }) {
  const [files, setFiles] = useState<{ name: string; text: string }[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [parts, setParts] = useState({ exclusions: true, preferences: true, details: true, proofPending: true });
  const [done, setDone] = useState<Preview['applied'] | null>(null);
  const read = useMutation({
    mutationFn: (fs: { name: string; text: string }[]) => api<Preview>('/wishlist/bring-in', { method: 'POST', json: { files: fs } }),
    onSuccess: (p) => {
      setPreview(p);
      setDone(null);
      setPicked(new Set(p.rules.filter((r) => r.add).map((r) => r.ref || r.title)));
    },
    onError: (err) => notifications.show({ color: 'red', message: errorMessage(err) }),
  });
  const apply = useMutation({
    mutationFn: () => api<Preview>('/wishlist/bring-in', { method: 'POST', json: { files, apply: { rules: [...picked], ...parts } } }),
    onSuccess: (p) => {
      setDone(p.applied ?? null);
      setPreview(null);
      setFiles([]);
      onDone();
    },
    onError: (err) => notifications.show({ color: 'red', message: errorMessage(err) }),
  });
  const choose = async (chosen: File[]) => {
    const fs = await Promise.all(chosen.map(async (f) => ({ name: f.name, text: await f.text() })));
    setFiles(fs);
    if (fs.length > 0) read.mutate(fs);
  };
  const count = (rows: ImportRow[], fate: ImportRow['fate']) => rows.filter((r) => r.fate === fate).length;
  const proof = preview?.details.filter((d) => d.fate === 'add' && d.proofPending).length ?? 0;

  return (
    <Card withBorder padding="md" id="bring-in">
      <Stack gap="sm">
        <div>
          <Text fw={600}>Bring in from a spreadsheet</Text>
          <Text size="sm" c="dimmed">
            Save each tab as CSV and choose them together: a tab of rules (Rule ID, Rule), games not to recommend (Title, Console, Action), your say on games (Owner Preference) and games' facts (Personal Interest, Release Class, Market Urgency...). You'll see what each row would do first. It only adds: a game you've set something for keeps what you set.
          </Text>
        </div>
        <Group>
          <FileButton onChange={(f) => void choose(f)} accept=".csv,text/csv" multiple>
            {(props) => (
              <Button {...props} variant="light" leftSection={<IconUpload size={16} />} loading={read.isPending}>
                Choose CSV files
              </Button>
            )}
          </FileButton>
          {files.length > 0 && <Text size="sm">{files.map((f) => f.name).join(', ')}</Text>}
        </Group>
        {done && (
          <Alert color="forest" variant="light" title="Brought in">
            {done.rules} rules, {done.exclusions} games not to recommend, {done.preferences} of your say on games, {done.details} games' facts.
          </Alert>
        )}
        {preview && (
          <Stack gap="sm">
            {preview.files.map((f) => (
              <Text key={f.name} size="sm" c={f.kind ? undefined : 'red'}>
                {f.name}: {f.kind ? `${KIND_NAMES[f.kind]}, ${f.rows} rows` : f.problem}
              </Text>
            ))}
            {preview.rules.length > 0 && (
              <Stack gap={4}>
                <Text fw={600} size="sm">
                  Rules: tick the ones to add
                </Text>
                {preview.rules.map((r) => (
                  <Checkbox
                    key={r.ref || r.title}
                    disabled={!r.add}
                    checked={r.add && picked.has(r.ref || r.title)}
                    onChange={(e) => {
                      const k = r.ref || r.title;
                      const on = e.currentTarget.checked;
                      setPicked((s) => new Set(on ? [...s, k] : [...s].filter((x) => x !== k)));
                    }}
                    label={
                      <Text size="sm">
                        <b>{r.ref ? `${r.ref} ` : ''}{r.title}</b>
                        {r.why ? <Text span c="dimmed" size="xs">{` (${r.why})`}</Text> : null}
                        <Text span c="dimmed" size="xs" lineClamp={2} display="block">
                          {r.text}
                        </Text>
                      </Text>
                    }
                  />
                ))}
              </Stack>
            )}
            <Rows title="Games not to recommend" rows={preview.exclusions} on={parts.exclusions} onChange={(v) => setParts({ ...parts, exclusions: v })} count={count} />
            <Rows title="Your say on games" rows={preview.preferences} on={parts.preferences} onChange={(v) => setParts({ ...parts, preferences: v })} count={count} />
            <Rows title="Games' facts" rows={preview.details} on={parts.details} onChange={(v) => setParts({ ...parts, details: v })} count={count} />
            {proof > 0 && parts.details && (
              <Checkbox
                checked={parts.proofPending}
                onChange={(e) => setParts({ ...parts, proofPending: e.currentTarget.checked })}
                label={`${proof} games are marked "Physical proof pending": keep them off the wishlist until their physical release is proven`}
                description="Unticked, their release class isn't brought in and they stay on the wishlist as they are."
              />
            )}
            <Group>
              <Button loading={apply.isPending} onClick={() => apply.mutate()}>
                Bring them in
              </Button>
              <Button
                variant="default"
                onClick={() => {
                  setPreview(null);
                  setFiles([]);
                }}
              >
                Cancel
              </Button>
            </Group>
          </Stack>
        )}
      </Stack>
    </Card>
  );
}

function Rows({ title, rows, on, onChange, count }: { title: string; rows: ImportRow[]; on: boolean; onChange: (v: boolean) => void; count: (rows: ImportRow[], fate: ImportRow['fate']) => number }) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  const adds = count(rows, 'add');
  return (
    <Stack gap={4}>
      <Group gap="sm">
        <Checkbox checked={on && adds > 0} disabled={adds === 0} onChange={(e) => onChange(e.currentTarget.checked)} label={<Text fw={600} size="sm">{title}: {adds} to add</Text>} />
        <Text size="xs" c="dimmed">
          {count(rows, 'skip')} already set or switched off, {count(rows, 'unknown')} on a console you don't have
        </Text>
        <Anchor component="button" type="button" size="xs" onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide the list' : 'See the list'}
        </Anchor>
      </Group>
      <Collapse expanded={open}>
        <Table.ScrollContainer minWidth={560} mah={320}>
          <Table striped withTableBorder fz="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Game</Table.Th>
                <Table.Th>Console</Table.Th>
                <Table.Th>What</Table.Th>
                <Table.Th>Bring in</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r, i) => (
                <Table.Tr key={i}>
                  <Table.Td>
                    {r.matched ?? r.title}
                    {r.matched && r.matched !== r.title && <Text size="xs" c="dimmed">{`sheet: ${r.title}`}</Text>}
                  </Table.Td>
                  <Table.Td>{r.console}</Table.Td>
                  <Table.Td>{r.what}</Table.Td>
                  <Table.Td>
                    {r.fate === 'add' ? 'Yes' : 'No'}
                    {r.why && <Text size="xs" c="dimmed">{r.why}</Text>}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Collapse>
    </Stack>
  );
}
