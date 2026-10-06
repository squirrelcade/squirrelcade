import { followsShape, POINT_SHAPES, rankOrder, shapePoints, type PointShape, type ShapeSpec } from '@squirrelcade/core';
import { ActionIcon, Autocomplete, Box, Group, NumberInput, Select, SimpleGrid, Stack, Text, Tooltip } from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconX } from '@tabler/icons-react';
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

/** The chart's drawing size (it scales to the space it gets) and margins. */
const W = 560;
const H = 230;
const PAD = { left: 38, right: 14, top: 14, bottom: 26 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;
const LIMIT = 1000;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const move = <T,>(list: T[], from: number, to: number) => {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
};

/**
 * Editor for a ranked points list (points by console, genre, style...): pick a shape and the list
 * shares out its points from the top rank down, or give every entry its own number. Every entry is a
 * dot on the chart; drag one along the line to give it another rank (with a shape) or other points
 * (with your own numbers), and the list beside the chart shows the points as they change.
 */
export function ShapeEditor({
  label,
  description,
  value,
  spec,
  onChange,
  keyLabel,
  keyHint,
  addOptions,
  freeAdd = true,
  fixedKeys = false,
  error,
  learned,
  onShapeOnly,
}: {
  label: ReactNode;
  description: string;
  value: Record<string, number>;
  /** The list's saved shape; none (or one its points no longer follow) shows as your own numbers. */
  spec: ShapeSpec | undefined;
  onChange: (points: Record<string, number>, spec: ShapeSpec) => void;
  keyLabel: string;
  /** Extra text shown next to an entry, such as a platform's name. */
  keyHint?: (key: string) => string | undefined;
  /** Entries to offer when adding one. */
  addOptions?: { value: string; label: string }[];
  /** Whether any name can be added (genres) or only one of addOptions (platforms). */
  freeAdd?: boolean;
  /** The entries are fixed names the scoring knows (interest levels...): no adding or removing. */
  fixedKeys?: boolean;
  error?: string;
  /** For a list learned from the collection: what it was learned from, shown above the chart. */
  learned?: ReactNode;
  /** For a learned list: a new shape, top or bottom only, which keeps the list learning (other edits make it the user's own). */
  onShapeOnly?: (spec: ShapeSpec) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [adding, setAdding] = useState('');
  // While a dot is dragged the scale stays put, so the dot stays under the pointer.
  const frozen = useRef<{ lo: number; hi: number } | null>(null);

  const order = rankOrder(value, spec?.order);
  const shaped = spec !== undefined && spec.shape !== 'custom' && followsShape(value, spec);
  const shape: PointShape = shaped ? spec.shape : 'custom';
  const values = order.map((k) => value[k]!);
  const top = shaped ? spec.top : values.length > 0 ? Math.max(...values) : 10;
  const bottom = shaped ? spec.bottom : values.length > 0 ? Math.min(...values) : 0;
  const n = order.length;

  // The scale: everything drawn, zero included, with room above for dragging a number up.
  const lowest = Math.min(0, bottom, ...values);
  const highest = Math.max(top, ...values, lowest + 1);
  const room = shape === 'custom' ? Math.max(5, Math.round((highest - lowest) * 0.2)) : 0;
  const live = { lo: lowest < 0 ? lowest - room : lowest, hi: highest + room };
  const scale = frozen.current ?? live;
  const x = (rank: number) => PAD.left + (n <= 1 ? PLOT_W / 2 : (PLOT_W * rank) / (n - 1));
  const y = (points: number) => PAD.top + PLOT_H * (1 - (points - scale.lo) / (scale.hi - scale.lo || 1));

  /** Sends the new list: with a shape, the points follow from the order; with your own numbers, they are as given. */
  function emit(next: { order?: string[]; shape?: PointShape; top?: number; bottom?: number; points?: Record<string, number> }) {
    const s: ShapeSpec = { shape: next.shape ?? shape, top: next.top ?? top, bottom: next.bottom ?? bottom, order: next.order ?? order };
    if (onShapeOnly && next.order === undefined && next.points === undefined && s.shape !== 'custom') {
      onShapeOnly(s);
      return;
    }
    if (s.shape === 'custom') {
      const points = next.points ?? value;
      onChange(points, { ...s, order: rankOrder(points, s.order) });
    } else {
      onChange(shapePoints(s), s);
    }
  }

  const setPoints = (key: string, points: number) => emit({ points: { ...value, [key]: clamp(Math.round(points), -LIMIT, LIMIT) } });

  /** Moves an entry up or down a rank: with a shape it takes the neighbour's place; with your own numbers the two swap points. */
  function step(key: string, by: -1 | 1) {
    const from = order.indexOf(key);
    const to = from + by;
    if (to < 0 || to >= n) return;
    if (shape === 'custom') {
      const other = order[to]!;
      emit({ points: { ...value, [key]: value[other]!, [other]: value[key]! }, order: move(order, from, to) });
    } else {
      emit({ order: move(order, from, to) });
    }
  }

  function add(name: string) {
    const key = name.trim();
    if (!key || key in value) return;
    // A new entry starts at the bottom rank.
    if (shape === 'custom') emit({ points: { ...value, [key]: Math.min(0, bottom) }, order: [...order, key] });
    else emit({ order: [...order, key] });
    setAdding('');
  }

  function remove(key: string) {
    const rest = Object.fromEntries(Object.entries(value).filter(([k]) => k !== key));
    emit({ points: rest, order: order.filter((k) => k !== key) });
  }

  function pointer(e: ReactPointerEvent) {
    const box = svgRef.current!.getBoundingClientRect();
    return { px: ((e.clientX - box.left) / box.width) * W, py: ((e.clientY - box.top) / box.height) * H };
  }

  function endDrag() {
    frozen.current = null;
    setDragging(null);
  }

  function onDrag(e: ReactPointerEvent) {
    if (!dragging) return;
    const { px, py } = pointer(e);
    if (shape === 'custom') {
      const points = Math.round(scale.lo + (1 - (py - PAD.top) / PLOT_H) * (scale.hi - scale.lo));
      if (points !== value[dragging]) setPoints(dragging, clamp(points, Math.ceil(scale.lo), Math.floor(scale.hi)));
    } else {
      const rank = n <= 1 ? 0 : clamp(Math.round(((px - PAD.left) / PLOT_W) * (n - 1)), 0, n - 1);
      const from = order.indexOf(dragging);
      if (rank !== from) emit({ order: move(order, from, rank) });
    }
  }

  const grid = [...new Set([scale.lo, 0, top, bottom, scale.hi].map((v) => Math.round(v)))].filter((v) => v >= scale.lo && v <= scale.hi);
  const shown = dragging ?? hover;
  const about = POINT_SHAPES.find((s) => s.value === shape)?.description ?? '';
  const hint = (k: string) => keyHint?.(k);

  return (
    <Stack gap={6}>
      <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm">
        <Box style={{ flex: 1, minWidth: 220 }}>
          <Text size="sm" fw={500} component="div">
            {label}
          </Text>
          <Text size="xs" c="dimmed">
            {description}
          </Text>
        </Box>
        <Group gap="xs" align="flex-end" wrap="nowrap">
          <Select
            size="xs"
            label="Shape"
            w={170}
            data={POINT_SHAPES.map((s) => ({ value: s.value, label: s.label }))}
            value={shape}
            allowDeselect={false}
            onChange={(v) => v && emit({ shape: v as PointShape })}
          />
          {shape !== 'custom' && (
            <>
              <NumberInput size="xs" label="Top" w={72} value={top} min={-LIMIT} max={LIMIT} allowDecimal={false} onChange={(v) => emit({ top: Number(v) || 0 })} />
              <NumberInput size="xs" label="Bottom" w={72} value={bottom} min={-LIMIT} max={LIMIT} allowDecimal={false} onChange={(v) => emit({ bottom: Number(v) || 0 })} />
            </>
          )}
        </Group>
      </Group>
      {learned && (
        <Text size="xs" c="var(--sc-accent-text)">
          {learned}
        </Text>
      )}
      {n === 0 ? (
        <Text size="xs" c="dimmed" fs="italic">
          Nothing yet: every {keyLabel.toLowerCase()} gets 0 acorns.
        </Text>
      ) : (
        <>
          <Text size="xs" c="dimmed">
            {about} Drag a dot along the line to {shape === 'custom' ? 'give it more or fewer acorns' : 'give it another rank'}; the arrows do the same.
          </Text>
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              width="100%"
              role="img"
              aria-label={`${keyLabel} acorns chart`}
              style={{ touchAction: 'none', userSelect: 'none', maxHeight: 260 }}
              onPointerMove={onDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              {grid.map((v) => (
                <g key={v}>
                  <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--mantine-color-default-border)" strokeDasharray={v === 0 ? undefined : '3 4'} />
                  <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--mantine-color-dimmed)">
                    {v}
                  </text>
                </g>
              ))}
              <text x={PAD.left} y={H - 6} fontSize={11} fill="var(--mantine-color-dimmed)">
                Top rank
              </text>
              <text x={W - PAD.right} y={H - 6} fontSize={11} textAnchor="end" fill="var(--mantine-color-dimmed)">
                Bottom rank
              </text>
              <polyline
                points={order.map((k, i) => `${x(i)},${y(value[k]!)}`).join(' ')}
                fill="none"
                stroke="var(--mantine-color-forest-5)"
                strokeWidth={2}
                strokeLinejoin="round"
              />
              {order.map((k, i) => {
                const active = shown === k;
                return (
                  <g
                    key={k}
                    style={{ cursor: shape === 'custom' ? 'ns-resize' : 'ew-resize' }}
                    onPointerEnter={() => setHover(k)}
                    onPointerLeave={() => setHover((h) => (h === k ? null : h))}
                    onPointerDown={(e) => {
                      frozen.current = live;
                      setDragging(k);
                      // Keeps the drag going when the pointer leaves the chart (browsers refuse pointers they don't track).
                      try {
                        svgRef.current?.setPointerCapture(e.pointerId);
                      } catch {
                        // The drag still works while the pointer stays over the chart.
                      }
                    }}
                  >
                    <circle cx={x(i)} cy={y(value[k]!)} r={14} fill="transparent" />
                    <circle cx={x(i)} cy={y(value[k]!)} r={active ? 8 : 6} fill={active ? 'var(--mantine-color-forest-7)' : 'var(--mantine-color-forest-5)'} stroke="var(--mantine-color-body)" strokeWidth={2} />
                    <title>{`${k}${hint(k) ? ` (${hint(k)})` : ''}: ${value[k]} acorns, rank ${i + 1}`}</title>
                  </g>
                );
              })}
              {shown && order.includes(shown) && (
                <text
                  x={clamp(x(order.indexOf(shown)), PAD.left + 40, W - PAD.right - 40)}
                  y={Math.max(PAD.top + 10, y(value[shown]!) - 14)}
                  textAnchor="middle"
                  fontSize={12}
                  fontWeight={600}
                  fill="var(--mantine-color-text)"
                >
                  {`${hint(shown) ?? shown}: ${value[shown]}`}
                </text>
              )}
            </svg>
            <Stack gap={0} style={{ maxHeight: 260, overflowY: 'auto' }}>
              {order.map((k, i) => (
                <Group
                  key={k}
                  gap={4}
                  wrap="nowrap"
                  px={4}
                  py={1}
                  onMouseEnter={() => setHover(k)}
                  onMouseLeave={() => setHover((h) => (h === k ? null : h))}
                  style={{ borderRadius: 4, background: shown === k ? 'var(--mantine-color-default-hover)' : undefined }}
                >
                  <Text size="xs" c="dimmed" w={22} ta="right">
                    {i + 1}
                  </Text>
                  <Tooltip label={k} disabled={!hint(k)} openDelay={400}>
                    <Text size="sm" truncate style={{ flex: 1, minWidth: 0 }}>
                      {hint(k) ?? k}
                    </Text>
                  </Tooltip>
                  {shape === 'custom' ? (
                    <NumberInput size="xs" w={72} value={value[k]} min={-LIMIT} max={LIMIT} allowDecimal={false} onChange={(v) => setPoints(k, Number(v) || 0)} aria-label={`${k} points`} />
                  ) : (
                    <Text size="sm" fw={600} w={40} ta="right">
                      {value[k]}
                    </Text>
                  )}
                  <ActionIcon size="sm" variant="subtle" color="gray" disabled={i === 0} onClick={() => step(k, -1)} aria-label={`Move ${k} up`}>
                    <IconArrowUp size={14} />
                  </ActionIcon>
                  <ActionIcon size="sm" variant="subtle" color="gray" disabled={i === n - 1} onClick={() => step(k, 1)} aria-label={`Move ${k} down`}>
                    <IconArrowDown size={14} />
                  </ActionIcon>
                  {!fixedKeys && (
                    <ActionIcon size="sm" variant="subtle" color="red" onClick={() => remove(k)} aria-label={`Remove ${k}`}>
                      <IconX size={14} />
                    </ActionIcon>
                  )}
                </Group>
              ))}
            </Stack>
          </SimpleGrid>
        </>
      )}
      {!fixedKeys &&
        (freeAdd ? (
          <Autocomplete
            size="xs"
            maw={300}
            placeholder={`Add a ${keyLabel.toLowerCase()} (type, then Enter)`}
            data={(addOptions ?? []).filter((o) => !(o.value in value)).map((o) => o.value)}
            value={adding}
            onChange={setAdding}
            onOptionSubmit={add}
            onKeyDown={(e) => e.key === 'Enter' && add(adding)}
          />
        ) : (
          <Select
            size="xs"
            maw={300}
            placeholder={`Add a ${keyLabel.toLowerCase()}`}
            data={(addOptions ?? []).filter((o) => !(o.value in value))}
            value={null}
            onChange={(v) => v && add(v)}
            searchable
          />
        ))}
      {error && (
        <Text size="xs" c="red">
          {error}
        </Text>
      )}
    </Stack>
  );
}
