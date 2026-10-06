import { CATALOG_SOURCES, KNOWN_PLATFORMS, SOURCE_FACT_LABELS, sourceOrder, type SourceSetting } from '@squirrelcade/core';
import { ActionIcon, Anchor, Badge, Button, Checkbox, Collapse, Group, NumberInput, Paper, SimpleGrid, Stack, Switch, Text, TextInput } from '@mantine/core';
import { IconChevronDown, IconChevronUp, IconPlus, IconTrash } from '@tabler/icons-react';
import { useState, type ReactNode } from 'react';
import { AddedSourceDetails, AddSourceButton, addedWhere, type AddedSource } from './AddedSources';

/** Editor for named point values (points per genre, per platform...). */
export function PointsEditor({
  label,
  description,
  value,
  onChange,
  keyLabel,
  keyHint,
  error,
}: {
  label: ReactNode;
  description: string;
  value: Record<string, number>;
  onChange: (v: Record<string, number>) => void;
  keyLabel: string;
  /** Extra text shown next to a key, such as a platform's name. */
  keyHint?: (key: string) => string | undefined;
  error?: string;
}) {
  const rows = Object.entries(value);
  const update = (index: number, key: string, points: number) => {
    const next = rows.map((r, i) => (i === index ? ([key, points] as [string, number]) : r));
    onChange(Object.fromEntries(next));
  };
  return (
    <Stack gap={4} maw={520}>
      <Text size="sm" fw={500} component="div">
        {label}
      </Text>
      <Text size="xs" c="dimmed">
        {description}
      </Text>
      {rows.length === 0 && (
        <Text size="xs" c="dimmed" fs="italic">
          Nothing yet: every {keyLabel.toLowerCase()} gets 0 acorns.
        </Text>
      )}
      {rows.map(([key, points], i) => (
        <Group key={i} gap="xs" wrap="nowrap">
          <TextInput
            size="xs"
            value={key}
            onChange={(e) => update(i, e.currentTarget.value, points)}
            placeholder={keyLabel}
            w={240}
            rightSection={keyHint?.(key) ? <Text size="xs" c="dimmed" pr={6} truncate>{keyHint(key)}</Text> : undefined}
            rightSectionWidth={keyHint?.(key) ? 110 : undefined}
          />
          <NumberInput size="xs" aria-label={`Acorns for ${key || 'this row'}`} value={points} onChange={(v) => update(i, key, typeof v === 'number' ? v : Number(v) || 0)} w={100} allowDecimal={false} />
          <ActionIcon variant="subtle" color="red" aria-label="Remove" onClick={() => onChange(Object.fromEntries(rows.filter((_, j) => j !== i)))}>
            <IconTrash size={14} />
          </ActionIcon>
        </Group>
      ))}
      <Group>
        <Button size="compact-xs" variant="subtle" leftSection={<IconPlus size={12} />} onClick={() => onChange({ ...value, [`New ${keyLabel.toLowerCase()} ${rows.length + 1}`]: 0 })}>
          Add
        </Button>
      </Group>
      {error && (
        <Text size="xs" c="red">
          {error}
        </Text>
      )}
    </Stack>
  );
}

/** Editor for count tiers: "up to N → points". */
export function TiersEditor({
  label,
  description,
  value,
  onChange,
  countLabel,
  error,
}: {
  label: ReactNode;
  description: string;
  value: { max: number; points: number }[];
  onChange: (v: { max: number; points: number }[]) => void;
  countLabel: string;
  error?: string;
}) {
  const update = (index: number, row: { max: number; points: number }) => onChange(value.map((r, i) => (i === index ? row : r)));
  return (
    <Stack gap={4} maw={520}>
      <Text size="sm" fw={500} component="div">
        {label}
      </Text>
      <Text size="xs" c="dimmed">
        {description}
      </Text>
      {value.map((t, i) => (
        <Group key={i} gap="xs" wrap="nowrap">
          <Text size="xs" w={70}>
            {countLabel}: up to
          </Text>
          <NumberInput size="xs" aria-label={`${countLabel}: up to (row ${i + 1})`} value={t.max} min={1} onChange={(v) => update(i, { ...t, max: typeof v === 'number' ? v : Number(v) || 1 })} w={90} allowDecimal={false} />
          <Text size="xs">→</Text>
          <NumberInput size="xs" aria-label={`Acorns (row ${i + 1})`} value={t.points} onChange={(v) => update(i, { ...t, points: typeof v === 'number' ? v : Number(v) || 0 })} w={90} allowDecimal={false} rightSection={<Text size="xs" c="dimmed" pr={4}>pts</Text>} />
          <ActionIcon variant="subtle" color="red" aria-label="Remove" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <IconTrash size={14} />
          </ActionIcon>
        </Group>
      ))}
      <Group>
        <Button
          size="compact-xs"
          variant="subtle"
          leftSection={<IconPlus size={12} />}
          onClick={() => onChange([...value, { max: (value[value.length - 1]?.max ?? 0) + 1, points: 0 }])}
        >
          Add tier
        </Button>
      </Group>
      {error && (
        <Text size="xs" c="red">
          {error}
        </Text>
      )}
    </Stack>
  );
}

/** Editor for percentage tiers: "at least N% → points" (the highest tier reached applies). */
export function PercentTiersEditor({
  label,
  description,
  value,
  onChange,
  countLabel,
  error,
}: {
  label: ReactNode;
  description: string;
  value: { min: number; points: number }[];
  onChange: (v: { min: number; points: number }[]) => void;
  countLabel: string;
  error?: string;
}) {
  const update = (index: number, row: { min: number; points: number }) => onChange(value.map((r, i) => (i === index ? row : r)));
  return (
    <Stack gap={4} maw={520}>
      <Text size="sm" fw={500} component="div">
        {label}
      </Text>
      <Text size="xs" c="dimmed">
        {description}
      </Text>
      {value.map((t, i) => (
        <Group key={i} gap="xs" wrap="nowrap">
          <Text size="xs" w={70}>
            {countLabel}: at least
          </Text>
          <NumberInput
            size="xs"
            aria-label={`${countLabel}: at least (row ${i + 1})`}
            value={t.min}
            min={0}
            max={100}
            decimalScale={1}
            onChange={(v) => update(i, { ...t, min: typeof v === 'number' ? v : Number(v) || 0 })}
            w={90}
            rightSection={<Text size="xs" c="dimmed" pr={4}>%</Text>}
          />
          <Text size="xs">→</Text>
          <NumberInput size="xs" aria-label={`Acorns (row ${i + 1})`} value={t.points} onChange={(v) => update(i, { ...t, points: typeof v === 'number' ? v : Number(v) || 0 })} w={90} allowDecimal={false} rightSection={<Text size="xs" c="dimmed" pr={4}>pts</Text>} />
          <ActionIcon variant="subtle" color="red" aria-label="Remove" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <IconTrash size={14} />
          </ActionIcon>
        </Group>
      ))}
      <Group>
        <Button size="compact-xs" variant="subtle" leftSection={<IconPlus size={12} />} onClick={() => onChange([...value, { min: Math.max(0, (value[value.length - 1]?.min ?? 100) - 10), points: 0 }])}>
          Add tier
        </Button>
      </Group>
      {error && (
        <Text size="xs" c="red">
          {error}
        </Text>
      )}
    </Stack>
  );
}

/**
 * Editor for a list of platform keys as checkboxes, one per console by name. Keys already chosen
 * that aren't among the options (a console no longer tracked) stay, checked, so nothing is lost.
 */
export function PlatformCheckboxes({
  label,
  description,
  value,
  onChange,
  options,
  error,
}: {
  label: ReactNode;
  description: string;
  value: string[];
  onChange: (v: string[]) => void;
  options: { key: string; name: string }[];
  error?: string;
}) {
  const known = new Set(options.map((o) => o.key));
  const all = [...options, ...value.filter((k) => !known.has(k)).map((k) => ({ key: k, name: k }))];
  return (
    <Stack gap={6}>
      <Text size="sm" fw={500} component="div">
        {label}
      </Text>
      <Text size="xs" c="dimmed">
        {description}
      </Text>
      <Checkbox.Group value={value} onChange={onChange}>
        <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }} spacing={6} verticalSpacing={6}>
          {all.map((o) => (
            <Checkbox key={o.key} value={o.key} label={o.name} size="sm" />
          ))}
        </SimpleGrid>
      </Checkbox.Group>
      {error && (
        <Text size="xs" c="red">
          {error}
        </Text>
      )}
    </Stack>
  );
}

/**
 * The catalog sources, most trusted first: one compact row each (arrows to trust it more or less, a
 * switch, its last reading), with what it gives, where it applies and its terms behind "Details".
 */
export function SourceOrderEditor({
  label,
  description,
  value,
  onChange,
  status,
  error,
  added = [],
}: {
  label: ReactNode;
  description: string;
  value: SourceSetting[];
  onChange: (v: SourceSetting[]) => void;
  /** Each source's last reading, by id. */
  status?: Record<string, { summary: string; error: string | null; at: string | null }>;
  error?: string;
  /** The sources the user added (an online list or a CSV file each). */
  added?: AddedSource[];
}) {
  const order = sourceOrder(value, added);
  const [open, setOpen] = useState<string | null>(null);
  const move = (from: number, to: number) => {
    const next = [...order];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    onChange(next);
  };
  return (
    <Stack gap={6} maw={720}>
      <Text size="sm" fw={500} component="div">
        {label}
      </Text>
      <Text size="xs" c="dimmed">
        {description}
      </Text>
      {order.map((s, i) => {
        const own = added.find((a) => a.id === s.id);
        const builtIn = CATALOG_SOURCES.find((c) => c.id === s.id);
        const info = { name: own?.name ?? builtIn?.name ?? s.id };
        const where = own ? addedWhere(own) : builtIn?.platforms?.map((k) => KNOWN_PLATFORMS.find((p) => p.key === k)?.name ?? k).join(', ');
        const st = status?.[s.id];
        return (
          <Paper key={s.id} withBorder px="sm" py={6} radius="md" style={s.on ? undefined : { borderStyle: 'dashed' }}>
            <Group justify="space-between" wrap="nowrap" gap="sm">
              <Group wrap="nowrap" gap={6} style={{ minWidth: 0 }}>
                <ActionIcon variant="subtle" size="sm" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label={`Trust ${info.name} more`}>
                  <IconChevronUp size={14} />
                </ActionIcon>
                <ActionIcon variant="subtle" size="sm" disabled={i === order.length - 1} onClick={() => move(i, i + 1)} aria-label={`Trust ${info.name} less`}>
                  <IconChevronDown size={14} />
                </ActionIcon>
                {/* A source that's off: its name dimmed and a dashed border (a faded row would be too faint to read). */}
                <Text size="sm" fw={600} c={s.on ? undefined : 'dimmed'} style={{ whiteSpace: 'nowrap' }}>
                  {i + 1}. {info.name}
                </Text>
                {where && (
                  <Badge size="xs" variant="light">
                    {where}
                  </Badge>
                )}
                <Anchor component="button" type="button" size="xs" onClick={() => setOpen(open === s.id ? null : s.id)}>
                  {open === s.id ? 'Hide details' : 'Details'}
                </Anchor>
              </Group>
              <Switch size="sm" checked={s.on} onChange={(e) => onChange(order.map((o) => (o.id === s.id ? { ...o, on: e.currentTarget.checked } : o)))} aria-label={`Read ${info.name}`} />
            </Group>
            {st && s.on && (
              <Text size="xs" c={st.error ? 'orange' : 'dimmed'} pl={52}>
                {st.summary}
                {st.error ? ` Last try: ${st.error}` : ''}
              </Text>
            )}
            <Collapse expanded={open === s.id}>
              {own ? (
                <Stack gap={4} pl={52} pt={4}>
                  <AddedSourceDetails source={own} />
                </Stack>
              ) : (
                builtIn && (
                  <Stack gap={4} pl={52} pt={4}>
                    <Text size="xs">{builtIn.description}</Text>
                    <Group gap={4}>
                      {builtIn.provides.map((f) => (
                        <Badge key={f} size="xs" variant="outline" color="gray">
                          {SOURCE_FACT_LABELS[f]}
                        </Badge>
                      ))}
                    </Group>
                    {builtIn.terms && (
                      <Text size="xs" c="dimmed" fs="italic">
                        {builtIn.terms}
                      </Text>
                    )}
                    {builtIn.url && (
                      <Anchor href={builtIn.url} target="_blank" rel="noreferrer" size="xs">
                        Open {builtIn.name}
                      </Anchor>
                    )}
                  </Stack>
                )
              )}
            </Collapse>
          </Paper>
        );
      })}
      <AddSourceButton />
      {error && (
        <Text c="red" size="xs">
          {error}
        </Text>
      )}
    </Stack>
  );
}
