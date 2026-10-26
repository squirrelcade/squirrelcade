import { COMPLETENESS_LABELS, priceChartingUrl, shopLinksFor, shopUrl, SHOPS_IN_LISTS, type Completeness, type SettingsValues } from '@squirrelcade/core';
import { Anchor, Box, Button, Group, Image, Modal, Stack, Table, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { IconExternalLink, IconPencil } from '@tabler/icons-react';
import { useState, type ReactNode } from 'react';
import { photoUrl, type PhotoInfo } from './CopyDetails';
import { count, date, money } from './format';
import { usePlaceNotes } from './places';
import { Acorns } from './Acorn';
import { gameFlyLabel, useGameFly } from './GameFly';

/**
 * The game page's copies (D165, the owner: "this is still primarily a collecting application"): first on the page,
 * each copy a card with its condition, what was paid, what it's worth (its price graph a click away), where it's kept,
 * its photos and its own Edit this copy; a game on several consoles with a row of every console it came out on (yours
 * lit, the rest dashed, PC apart at the end), the other consoles a line each, and PC's storefronts apart; a game you
 * don't have gets Get it in the same place.
 */

type DateFormat = SettingsValues['general.dateFormat'];

/** One of the game's copies on another console (GET /api/v1/game's consoles). */
export interface ConsoleCopy {
  id: number;
  copyKey: string;
  title: string;
  completeness: string;
  quantity: number;
  valueCents: number | null;
  costCents: number | null;
  datePurchased: string | null;
  notes: string;
  location: string | null;
  slots: string[];
  estimatedCents: number | null;
  gradingCompany: string;
  gradingCertId: string;
}

/** A console the game is on, with your copies there (GET /api/v1/game's consoles). */
export interface ConsoleRow {
  platformKey: string;
  platform: string;
  released: string | null;
  current: boolean;
  status: string | null;
  /** Owned there through a neighbor console's copy (cross-generation): that console's name. */
  via: string | null;
  copies: ConsoleCopy[];
}

/** A PC storefront the game is in (GET /api/v1/game's pc). */
export interface PcRow {
  storefront: string;
  ownership: string;
  playtimeHours: number;
}

const OWNERSHIP: Record<string, string> = { permanent: 'owned', subscription: 'subscription', historical: 'not verified' };
const condition = (c: string) => COMPLETENESS_LABELS[c as Completeness] ?? c;
const year = (d: string | null) => (d && /^\d{4}/.test(d) ? d.slice(0, 4) : null);
const copiesWord = (n: number) => `${count(n)} ${n === 1 ? 'copy' : 'copies'}`;

/** A copy's value at each collection update, oldest first. */
type History = { date: string; cents: number }[];

/** A small line of the copy's value over time, beside its worth: a button that opens the graph. */
function Spark({ history }: { history: History }) {
  const width = 40;
  const height = 14;
  const values = history.map((p) => p.cents);
  const low = Math.min(...values);
  const span = Math.max(...values) - low || 1;
  const points = values.map((v, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${(height - 2 - ((v - low) / span) * (height - 4)).toFixed(1)}`).join(' ');
  const up = values.at(-1)! >= values[0]!;
  return (
    <svg width={width} height={height} aria-hidden="true" style={{ verticalAlign: '-2px', marginLeft: 6 }}>
      <polyline points={points} fill="none" stroke={up ? 'var(--sc-cade)' : 'var(--mantine-color-red-6)'} strokeWidth={1.6} strokeLinejoin="round" />
    </svg>
  );
}

/** The month of a date, as the graph's axis says it: "Sep 2025". */
const month = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * What a copy is worth over time (the owner: "graph the price data for a particular copy... just click the copy, and
 * that is where it comes up"): its value at each collection update, the price paid as a dashed line, the value now and
 * how it moved, every point's value on hover or tap, and the same as a table.
 */
export function WorthGraph({
  copy,
  onClose,
  currency,
  dateFormat,
}: {
  copy: { title: string; completeness: string; valueCents: number | null; costCents: number | null; dateEntered: string | null; history: History } | null;
  onClose: () => void;
  currency: string;
  dateFormat: DateFormat;
}) {
  const [table, setTable] = useState(false);
  const [at, setAt] = useState<number | null>(null);
  const history = copy?.history ?? [];
  const W = 560;
  const H = 230;
  const left = 56;
  const right = 70;
  const top = 18;
  const bottom = 30;
  const times = history.map((p) => new Date(p.date).getTime());
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const values = history.map((p) => p.cents);
  const paid = copy?.costCents ?? null;
  const lowRaw = Math.min(...values, ...(paid !== null ? [paid] : []));
  const highRaw = Math.max(...values, ...(paid !== null ? [paid] : []));
  const pad = Math.max(100, (highRaw - lowRaw) * 0.12);
  const low = Math.max(0, lowRaw - pad);
  const high = highRaw + pad;
  const x = (t: number) => left + (t1 === t0 ? (W - left - right) / 2 : ((t - t0) / (t1 - t0)) * (W - left - right));
  const y = (v: number) => top + (1 - (v - low) / (high - low || 1)) * (H - top - bottom);
  const ticks = [0, 1, 2, 3].map((i) => low + ((high - low) * i) / 3);
  const first = history[0];
  const last = history.at(-1);
  const now = copy?.valueCents ?? last?.cents ?? null;
  const labels = history.length > 0 ? [...new Set([0, Math.floor((history.length - 1) / 2), history.length - 1])] : [];
  const pointAt = (clientX: number, box: DOMRect) => {
    const px = ((clientX - box.left) / box.width) * W;
    let best = 0;
    for (let i = 1; i < history.length; i++) if (Math.abs(x(times[i]!) - px) < Math.abs(x(times[best]!) - px)) best = i;
    return best;
  };
  const sel = at !== null ? history[at] : undefined;
  return (
    <Modal opened={copy !== null} onClose={onClose} centered size={620} title={<Text fw={700}>What your copy is worth</Text>}>
      {copy && (
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            {copy.title} · {condition(copy.completeness).toLowerCase()}
            {first ? ` · since ${date(first.date, dateFormat)}` : ''}
          </Text>
          <Group gap="xl">
            <Stack gap={0}>
              <Text size="xs" c="dimmed">
                Now
              </Text>
              <Text fw={700} size="xl" c="var(--sc-cade-text)">
                {money(now, currency)}
              </Text>
            </Stack>
            {first && now !== null && history.length > 1 && (
              <Stack gap={0}>
                <Text size="xs" c="dimmed">
                  Since {date(first.date, dateFormat)}
                </Text>
                <Text fw={700}>
                  {now - first.cents >= 0 ? '+' : ''}
                  {money(now - first.cents, currency)}
                </Text>
              </Stack>
            )}
            {paid !== null && now !== null && (
              <Stack gap={0}>
                <Text size="xs" c="dimmed">
                  Over what you paid
                </Text>
                <Text fw={700}>
                  {now - paid >= 0 ? '+' : ''}
                  {money(now - paid, currency)}
                </Text>
              </Stack>
            )}
          </Group>
          {history.length < 2 ? (
            <Text size="sm" c="dimmed">
              Its value has one reading so far ({money(history[0]?.cents ?? now, currency)}{history[0] ? `, ${date(history[0].date, dateFormat)}` : ''}). Each collection update that changes it adds a point here.
            </Text>
          ) : table ? (
            <Table striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Update</Table.Th>
                  <Table.Th ta="right">Worth</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {history.map((p) => (
                  <Table.Tr key={p.date}>
                    <Table.Td>{date(p.date, dateFormat)}</Table.Td>
                    <Table.Td ta="right">{money(p.cents, currency)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          ) : (
            <Box pos="relative">
              <svg
                viewBox={`0 0 ${W} ${H}`}
                width="100%"
                role="img"
                aria-label={`Worth from ${money(first!.cents, currency)} on ${date(first!.date, dateFormat)} to ${money(last!.cents, currency)} on ${date(last!.date, dateFormat)}${paid !== null ? `; paid ${money(paid, currency)}` : ''}`}
                style={{ display: 'block', touchAction: 'none', fontFamily: 'inherit' }}
                onPointerMove={(e) => setAt(pointAt(e.clientX, e.currentTarget.getBoundingClientRect()))}
                onPointerDown={(e) => setAt(pointAt(e.clientX, e.currentTarget.getBoundingClientRect()))}
                onPointerLeave={() => setAt(null)}
              >
                {ticks.map((t) => (
                  <g key={t}>
                    <line x1={left} x2={W - right} y1={y(t)} y2={y(t)} stroke="var(--sc-line)" strokeWidth={1} />
                    <text x={left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--sc-muted)">
                      {money(Math.round(t / 100) * 100, currency).replace(/\.00$/, '')}
                    </text>
                  </g>
                ))}
                {paid !== null && (
                  <g>
                    <line x1={left} x2={W - right} y1={y(paid)} y2={y(paid)} stroke="var(--sc-muted)" strokeWidth={1.5} strokeDasharray="5 4" />
                    <text x={W - right} y={y(paid) - 6} textAnchor="end" fontSize={11.5} fill="var(--sc-soft)">
                      Paid {money(paid, currency)}
                    </text>
                  </g>
                )}
                {sel && <line x1={x(new Date(sel.date).getTime())} x2={x(new Date(sel.date).getTime())} y1={top} y2={H - bottom} stroke="var(--sc-line-strong)" strokeWidth={1} />}
                <polyline points={history.map((p, i) => `${x(times[i]!).toFixed(1)},${y(p.cents).toFixed(1)}`).join(' ')} fill="none" stroke="var(--sc-cade)" strokeWidth={2} strokeLinejoin="round" />
                {history.map((p, i) => (
                  <circle key={p.date} cx={x(times[i]!)} cy={y(p.cents)} r={at === i ? 6 : 4} fill="var(--sc-cade)" stroke="var(--sc-surface)" strokeWidth={2} />
                ))}
                <text x={x(times.at(-1)!) + 9} y={y(last!.cents) + 4} fontSize={12} fontWeight={700} fill="var(--sc-text)">
                  {money(last!.cents, currency)}
                </text>
                {labels.map((i) => (
                  <text key={i} x={x(times[i]!)} y={H - 10} textAnchor="middle" fontSize={11} fill="var(--sc-muted)">
                    {month(history[i]!.date)}
                  </text>
                ))}
              </svg>
              {sel && (
                <div
                  style={{
                    position: 'absolute',
                    left: `${(x(new Date(sel.date).getTime()) / W) * 100}%`,
                    top: 0,
                    transform: 'translateX(-50%)',
                    background: 'var(--sc-surface)',
                    border: '1px solid var(--sc-line-strong)',
                    borderRadius: 8,
                    padding: '4px 9px',
                    pointerEvents: 'none',
                    whiteSpace: 'nowrap',
                    fontSize: 12,
                  }}
                >
                  <b>{money(sel.cents, currency)}</b> · {date(sel.date, dateFormat)}
                </div>
              )}
            </Box>
          )}
          <Group justify="space-between" gap="xs">
            <Text size="xs" c="dimmed" style={{ flex: '1 1 280px' }}>
              PriceCharting's price for a copy in this condition at each of your collection updates that changed it.
            </Text>
            {history.length > 1 && (
              <Anchor component="button" type="button" size="xs" onClick={() => setTable((t) => !t)}>
                {table ? 'Show as a graph' : 'Show as a table'}
              </Anchor>
            )}
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

/** A copy's worth as the card shows it: the value, and its small line (a button to the graph) when it has moved. */
export function WorthValue({ valueCents, history, currency, onGraph }: { valueCents: number | null; history: History; currency: string; onGraph: () => void }) {
  if (valueCents === null && history.length === 0) return <Text fw={600}>—</Text>;
  return (
    <Tooltip label="Its value over time">
      <UnstyledButton onClick={onGraph} aria-label={`Worth ${money(valueCents, currency)}: show its value over time`} style={{ fontWeight: 600, color: 'var(--sc-cade-text)', textDecoration: 'underline dotted', textUnderlineOffset: 3 }}>
        {money(valueCents ?? history.at(-1)?.cents ?? null, currency)}
        {history.length > 1 && <Spark history={history} />}
      </UnstyledButton>
    </Tooltip>
  );
}

/** One fact of a copy: a small label over its value. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack gap={0} style={{ minWidth: 0 }}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Box fz="sm">{children}</Box>
    </Stack>
  );
}

/** Where a copy is kept, and where that place is (D157). */
export function KeptIn({ location }: { location: string | null }) {
  const note = usePlaceNotes(Boolean(location))(location);
  if (!location) return <Text fw={600}>—</Text>;
  return (
    <Text fw={600}>
      {location}
      {note && (
        <Text span size="xs" c="dimmed" fw={400}>
          {' '}
          · {note}
        </Text>
      )}
    </Text>
  );
}

/** A copy's photos as small thumbnails with their names, the standard ones first; each opens full size. */
export function Thumbs({ photos }: { photos: PhotoInfo[] }) {
  if (photos.length === 0) return null;
  const sorted = [...photos].sort((a, b) => Number(b.slot !== null) - Number(a.slot !== null));
  return (
    <Group gap={6} wrap="wrap" align="flex-start">
      {sorted.map((p) => (
        <Anchor key={p.id} href={photoUrl(p.id)} target="_blank" rel="noreferrer" aria-label={p.slot ?? p.caption ?? 'Photo'} underline="never">
          <Stack gap={2} align="center" w={54}>
            <Image src={photoUrl(p.id)} w={54} h={54} radius={6} fit="cover" alt={p.slot ?? p.caption ?? ''} loading="lazy" style={{ border: '1px solid var(--sc-line-strong)' }} />
            <Text size="10px" c="dimmed" lineClamp={1} ta="center">
              {p.slot ?? p.caption ?? 'Photo'}
            </Text>
          </Stack>
        </Anchor>
      ))}
    </Group>
  );
}

/** The card the copies sit in: green-edged, like the mockups' Your copy. */
export function CopiesFrame({ title, aside, children, tone = 'have' }: { title: string; aside?: ReactNode; children: ReactNode; tone?: 'have' | 'want' }) {
  return (
    <Box
      p="sm"
      style={{
        border: `1px solid ${tone === 'have' ? 'var(--sc-deep-line)' : 'var(--sc-gold-line)'}`,
        background: `linear-gradient(180deg, ${tone === 'have' ? 'var(--sc-deep)' : 'var(--sc-gold-bg)'}, var(--sc-surface) 70%)`,
        borderRadius: 12,
      }}
    >
      <Group justify="space-between" gap="xs" mb={6} wrap="wrap">
        <Text fw={700} ff="Fredoka, var(--mantine-font-family)" fz={17}>
          {title}
        </Text>
        {aside && (
          <Text size="xs" c="dimmed">
            {aside}
          </Text>
        )}
      </Group>
      <Stack gap="xs">{children}</Stack>
    </Box>
  );
}

/**
 * Every console the game is on, as chips (the owner, 2026-10-23: chronological, and "I always want the PC one to be
 * considered separate... all the way on the right"): yours lit with how many, the rest dashed to want, the one shown
 * outlined, then PC alone after a divider. A chip opens that console's page.
 */
export function ConsoleRowChips({ rows, pc, onOpen, pcCurrent = false }: { rows: ConsoleRow[]; pc: PcRow[]; onOpen: (platformKey: string) => void; pcCurrent?: boolean }) {
  if (rows.length + (pc.length > 0 ? 1 : 0) < 2) return null;
  const stores = [...new Set(pc.map((p) => p.storefront))];
  return (
    <Group gap={6} wrap="wrap" align="stretch">
      {rows.map((r) => {
        const n = r.copies.reduce((s, c) => s + c.quantity, 0);
        const label = [r.platform, year(r.released), n > 0 ? copiesWord(n) : r.via ? `counts with ${r.via}` : 'want it'].filter(Boolean).join(' · ');
        return (
          <button
            key={r.platformKey}
            type="button"
            className="sc-chip"
            data-tone={n > 0 || r.via ? 'have' : 'missing'}
            aria-current={r.current ? 'true' : undefined}
            style={r.current ? { outline: '2px solid var(--sc-cade)', outlineOffset: 1 } : undefined}
            onClick={() => !r.current && onOpen(r.platformKey)}
          >
            {label}
          </button>
        );
      })}
      {pc.length > 0 && (
        <>
          <span aria-hidden="true" style={{ width: 1, alignSelf: 'stretch', background: 'var(--sc-line-strong)', margin: '0 4px' }} />
          <button
            type="button"
            className="sc-chip"
            data-tone="info"
            aria-current={pcCurrent ? 'true' : undefined}
            style={pcCurrent ? { outline: '2px solid var(--sc-info)', outlineOffset: 1 } : undefined}
            onClick={() => !pcCurrent && onOpen('pc')}
          >
            PC · {stores.join(', ')}
          </button>
        </>
      )}
    </Group>
  );
}

/** The game's copies on its other consoles, a line each: how many, their condition and place, their worth; one copy's Edit, or Open. */
export function OtherConsoles({ rows, currency, canEdit, onEdit, onOpen }: { rows: ConsoleRow[]; currency: string; canEdit: boolean; onEdit: (row: ConsoleRow, copy: ConsoleCopy) => void; onOpen: (platformKey: string) => void }) {
  const others = rows.filter((r) => !r.current && r.copies.length > 0);
  if (others.length === 0) return null;
  return (
    <Stack gap={2}>
      <Text size="xs" c="dimmed" fw={600}>
        On your other consoles
      </Text>
      {others.map((r) => {
        const n = r.copies.reduce((s, c) => s + c.quantity, 0);
        const conditions = [...new Set(r.copies.map((c) => condition(c.completeness)))];
        const places = [...new Set(r.copies.map((c) => c.location).filter(Boolean))];
        const worth = r.copies.reduce((s, c) => s + (c.valueCents ?? 0) * c.quantity, 0);
        const single = r.copies.length === 1 && r.copies[0]!.quantity === 1 ? r.copies[0]! : null;
        return (
          <Group key={r.platformKey} gap="xs" wrap="nowrap" justify="space-between" style={{ borderTop: '1px solid var(--sc-line)', paddingTop: 4 }}>
            <Text size="sm" style={{ minWidth: 0 }}>
              <b>{r.platform}</b>
              <Text span size="xs" c="dimmed">
                {' · '}
                {copiesWord(n)} · {conditions.join(', ')}
                {places.length > 0 ? ` · ${places.join(', ')}` : ''}
              </Text>
            </Text>
            <Group gap={10} wrap="nowrap">
              {worth > 0 && (
                <Text size="xs" c="dimmed">
                  {money(worth, currency)}
                </Text>
              )}
              {single && canEdit ? (
                <Anchor component="button" type="button" size="xs" onClick={() => onEdit(r, single)}>
                  <IconPencil size={12} aria-hidden /> Edit
                </Anchor>
              ) : (
                <Anchor component="button" type="button" size="xs" onClick={() => onOpen(r.platformKey)}>
                  Open ›
                </Anchor>
              )}
            </Group>
          </Group>
        );
      })}
    </Stack>
  );
}

/** The game on PC: its storefronts, apart from the consoles, with how each owns it and the hours played. */
export function OnPc({ pc, links, onOpen, current }: { pc: PcRow[]; links: { storefront: string; name: string; url: string }[]; onOpen: () => void; current: boolean }) {
  if (pc.length === 0) return null;
  return (
    <Stack gap={2}>
      <Text size="xs" c="dimmed" fw={600}>
        On PC{' '}
        <Text span size="xs" c="dimmed" fw={400}>
          · storefronts, apart from your consoles
        </Text>
      </Text>
      {pc.map((p) => {
        const link = links.find((l) => l.storefront === p.storefront);
        return (
          <Group key={p.storefront} gap="xs" wrap="nowrap" justify="space-between" style={{ borderTop: '1px solid var(--sc-line)', paddingTop: 4 }}>
            <Text size="sm">
              <b>{p.storefront}</b>
              <Text span size="xs" c="dimmed">
                {' · '}
                {OWNERSHIP[p.ownership] ?? p.ownership}
                {p.playtimeHours > 0 ? ` · ${p.playtimeHours} hours played` : ''}
              </Text>
            </Text>
            {link ? (
              <Anchor href={link.url} target="_blank" rel="noreferrer" size="xs">
                {link.name} <IconExternalLink size={11} aria-hidden />
              </Anchor>
            ) : !current ? (
              <Anchor component="button" type="button" size="xs" onClick={onOpen}>
                Open ›
              </Anchor>
            ) : null}
          </Group>
        );
      })}
    </Stack>
  );
}

/**
 * Get it (the owner: "if I don't have it, how do I look it up and buy"): in Your copy's place for a game you don't
 * have, in gold: your shops (used marketplaces first, the rest folded), PriceCharting for what it sells for, why it has
 * its acorns, and the actions (I bought it, Snooze, Not a target), with the versions you do have.
 */
export function GetItCard({
  platformKey,
  platform,
  title,
  shops,
  wishlist,
  priority,
  actions,
  versions,
}: {
  platformKey: string;
  platform: string;
  title: string;
  shops: readonly string[];
  wishlist: { score: number; rank: number | null; priority: string; components: { label: string; points: number }[] } | null;
  priority?: string;
  actions: ReactNode;
  versions: ReactNode;
}) {
  const [more, setMore] = useState(false);
  // GameFly's price, when it sells the game (D174): first, with its price, as a place to buy.
  const gamefly = useGameFly()(platformKey, title);
  const mine = shopLinksFor(shops, platformKey);
  const firsts = [...mine.filter((s) => s.group === 'Used marketplaces'), ...mine.filter((s) => s.group !== 'Used marketplaces')].slice(0, SHOPS_IN_LISTS);
  const rest = mine.filter((s) => !firsts.includes(s));
  // The game's own reasons, not the lines that fit or cap the total ("Fitted to the scale", "Capped at 100").
  const reasons = (wishlist?.components ?? []).filter((c) => c.points !== 0 && !/^(Fitted to the scale|Capped at)/.test(c.label));
  return (
    <CopiesFrame title="Get it" tone="want" aside={wishlist ? `On your Acorns list${wishlist.rank ? `, #${wishlist.rank}` : ''} · ${wishlist.priority}` : priority}>
      <Group gap="xl" align="flex-start" wrap="wrap">
        {(mine.length > 0 || gamefly?.url) && (
          <Stack gap={4}>
            <Text size="xs" c="dimmed">
              Look for it
            </Text>
            <Group gap={6} wrap="wrap">
              {gamefly?.url && (
                <Button component="a" href={gamefly.url} target="_blank" rel="noreferrer" size="compact-sm" variant="light" rightSection={<IconExternalLink size={12} />}>
                  {gameFlyLabel(gamefly)}
                </Button>
              )}
              {[...firsts, ...(more ? rest : [])].map((s) => (
                <Button key={s.name} component="a" href={shopUrl(s.template, title, platform)} target="_blank" rel="noreferrer" size="compact-sm" variant="default" rightSection={<IconExternalLink size={12} />}>
                  {s.name}
                </Button>
              ))}
              {rest.length > 0 && !more && (
                <Anchor component="button" type="button" size="sm" onClick={() => setMore(true)}>
                  {rest.length} more {rest.length === 1 ? 'shop' : 'shops'}
                </Anchor>
              )}
            </Group>
          </Stack>
        )}
        <Stack gap={4}>
          <Text size="xs" c="dimmed">
            What it sells for
          </Text>
          <Group gap={6}>
            <Button component="a" href={priceChartingUrl(title, platform)} target="_blank" rel="noreferrer" size="compact-sm" variant="default" rightSection={<IconExternalLink size={12} />}>
              PriceCharting
            </Button>
          </Group>
        </Stack>
      </Group>
      {wishlist && reasons.length > 0 && (
        <Group gap={6} wrap="wrap">
          <Text size="xs" fw={700} c="var(--sc-gold)">
            Why <Acorns n={wishlist.score} size={10} />:
          </Text>
          {reasons.map((c) => (
              <Text key={c.label} size="xs" c="dimmed" px={8} style={{ border: '1px solid var(--sc-line-strong)', borderRadius: 999 }}>
                {c.label} {c.points > 0 ? `+${c.points}` : c.points}
              </Text>
            ))}
        </Group>
      )}
      <Group gap="xs" wrap="wrap">
        {actions}
      </Group>
      {versions}
    </CopiesFrame>
  );
}
