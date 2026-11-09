import { bannerMarks, baseTitle, consoleMark, KNOWN_PLATFORMS, MARK_DRAWINGS, markInk, markPixels, matchKey, regionalConsole, type MarkDrawing } from '@squirrelcade/core';
import { Box, Group, Tooltip } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useId, type CSSProperties, type MouseEvent, type ReactElement } from 'react';
import { StashMark } from './Acorn';
import { api } from './api';
import { useSetting } from './hooks';

/** A console's drawing (D185): its own, or its region's base console's (a Japanese PlayStation 2 is a PlayStation 2). */
function drawingOf(key: string): MarkDrawing | undefined {
  return MARK_DRAWINGS[key] ?? MARK_DRAWINGS[regionalConsole(key)?.base ?? ''];
}

/** A drawing faded (you don't have it): its fixed colors grey too, worked out once per console. */
const fadedBodies = new Map<string, string>();
function fadedBody(key: string, d: MarkDrawing): string {
  let body = fadedBodies.get(key);
  if (body === undefined) {
    // Every fixed color but the masks' white and black becomes the mark's grey.
    body = (d.faded ?? d.svg).replace(/fill="#(?!fff"|000")[0-9a-f]{3,6}"/gi, 'fill="currentColor"');
    fadedBodies.set(key, body);
  }
  return body;
}

/** A console mark's hover text and label: the console, and whether you have the game there ("Wii U (owned)", "Wii U (unowned)"). */
export function markLabel(name: string, owned?: boolean): string {
  return owned === undefined ? name : `${name} (${owned ? 'owned' : 'unowned'})`;
}

/** The Stash's chest's hover text and label on a cover: whether you have the game anywhere (1.5.1, as the marks say it). */
export function chestLabel(owned: boolean, playable?: string | null): string {
  // A game you can play another way you have (a collection, a remaster: 1.5.1) says so.
  return `Stash (${owned ? 'owned' : playable ? `unowned; ${playable}` : 'unowned'})`;
}

/** A way to play it, in a few words for the chest: "playable in a collection you have". */
export function playablePhrase(ways: readonly { kind: 'collection' | 'remaster' | 'remake' }[] | undefined): string | null {
  if (!ways || ways.length === 0) return null;
  return ways.some((w) => w.kind === 'collection') ? 'playable in a collection you have' : ways.some((w) => w.kind === 'remaster') ? 'playable as a remaster you have' : 'playable as a remake you have';
}

/**
 * A console's mark: Squirrelcade's drawing of it (D185, after its hardware and symbols) in its color where you have the
 * game (or the console's games), faded grey where you don't; a console without a drawing keeps its pixel mark (D175).
 * Every place a console is named uses this one. `size` is its height in pixels. Where it says whether you have the
 * game there (`owned` given), its hover text says so: "Wii U (owned)", "Wii U (unowned)" (1.5.1); a mark that only
 * names a console (a filter chip, a list of consoles) says its name.
 */
export function ConsoleMark({
  platformKey,
  name,
  owned: ownedGiven,
  size = 16,
  onClick,
  style,
}: {
  platformKey: string;
  /** The console's name, for its label (and the mark of a console the table has none for). */
  name: string;
  /** Whether you have the game there: in color and "(owned)", or grey and "(unowned)". Left out: in color, its name alone. */
  owned?: boolean;
  size?: number;
  onClick?: (ev: MouseEvent) => void;
  style?: CSSProperties;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const drawing = drawingOf(platformKey);
  const owned = ownedGiven ?? true;
  const label = markLabel(name, ownedGiven);
  if (drawing) {
    const body = (owned ? drawing.svg : fadedBody(platformKey, drawing)).replaceAll('__ID__', `m${id}`);
    return (
      <Tooltip label={label} openDelay={300}>
        <Box
          component="svg"
          className={owned ? 'sc-mark sc-mark-on' : 'sc-mark sc-mark-off'}
          viewBox={`0 0 ${drawing.width} 24`}
          width={(size / 24) * drawing.width}
          height={size}
          role="img"
          aria-label={label}
          onClick={onClick}
          style={{ display: 'inline-block', flex: 'none', overflow: 'visible', color: owned ? drawing.color : 'var(--sc-mark-off)', cursor: onClick ? 'pointer' : undefined, verticalAlign: 'middle', ...style }}
          dangerouslySetInnerHTML={{ __html: body }}
        />
      </Tooltip>
    );
  }
  const mark = consoleMark(platformKey, name);
  const rows = markPixels(mark);
  const height = 8;
  const width = Math.max(...rows.map((r) => r.length));
  // A tile is 7 pixels tall: it's centered in the 8 a drawn mark has, so all marks stand the same height.
  const dy = (height - rows.length) / 2;
  const ink = markInk(mark.color);
  const cells: ReactElement[] = [];
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      let fill: string | null;
      if (mark.icon) fill = owned ? (mark.icon.colors['ABCDEFGH'.indexOf(ch)] ?? mark.color) : 'var(--sc-mark-off)';
      // Faded like a drawn mark's (D185): the tile grey, its letters cut out.
      else if (owned) fill = ch === '+' ? ink : mark.color;
      else fill = ch === '+' ? null : 'var(--sc-mark-off)';
      if (fill) cells.push(<rect key={`${x},${y}`} x={x} y={y + dy} width={1} height={1} fill={fill} />);
    }),
  );
  return (
    <Tooltip label={label} openDelay={300}>
      <Box
        component="svg"
        viewBox={`0 0 ${width} ${height}`}
        width={(size / height) * width}
        height={size}
        role="img"
        aria-label={label}
        shapeRendering="crispEdges"
        onClick={onClick}
        style={{ display: 'inline-block', flex: 'none', cursor: onClick ? 'pointer' : undefined, verticalAlign: 'middle', ...style }}
      >
        {cells}
      </Box>
    </Tooltip>
  );
}

/** A console's name from its key, for a mark's label (another region's own console by its name). */
export function consoleName(key: string): string {
  if (key === 'pc') return 'PC';
  return KNOWN_PLATFORMS.find((p) => p.key === key)?.name ?? regionalConsole(key)?.name ?? key;
}

/** The consoles each game is yours on (GET /api/v1/marks, D175): read once and kept while the collection stays the same. */
export function useOwnedMarks(): (title: string) => string[] {
  const marks = useQuery({ queryKey: ['collection', 'marks'], queryFn: () => api<{ owned: Record<string, string[]> }>('/marks'), staleTime: 5 * 60_000 });
  return (title) => marks.data?.owned[matchKey(baseTitle(title))] ?? [];
}

/** Title keys waiting to be asked about, and who waits for each: asked together a moment later (one request a page). */
const releasedWaiting = new Map<string, ((consoles: string[]) => void)[]>();
let releasedTimer: number | null = null;

async function askReleased(): Promise<void> {
  releasedTimer = null;
  const batch = new Map(releasedWaiting);
  releasedWaiting.clear();
  const keys = [...batch.keys()];
  for (let i = 0; i < keys.length; i += 500) {
    const slice = keys.slice(i, i + 500);
    const answer = await api<{ released: Record<string, string[]> }>('/marks/released', { method: 'POST', json: { keys: slice } }).catch(() => ({ released: {} as Record<string, string[]> }));
    for (const k of slice) for (const done of batch.get(k) ?? []) done(answer.released[k] ?? []);
  }
}

function releasedOn(key: string): Promise<string[]> {
  return new Promise((resolve) => {
    releasedWaiting.set(key, [...(releasedWaiting.get(key) ?? []), resolve]);
    releasedTimer ??= window.setTimeout(() => void askReleased(), 30);
  });
}

/** The consoles a game came out on (IGDB's lists and the catalogs, POST /api/v1/marks/released), asked for with the page's other covers and kept. */
export function useReleasedOn(title: string, enabled = true): string[] {
  const key = matchKey(baseTitle(title));
  const q = useQuery({ queryKey: ['released', key], queryFn: () => releasedOn(key), enabled: enabled && Boolean(key), staleTime: 60 * 60_000 });
  return q.data ?? [];
}

/**
 * The banner in a cover's top right corner (D175, the owner's design; D185, light; D197, every cover): the Stash's chest
 * (filled when you have the game on any console or PC, grey when you don't), the two newest consoles you have it on,
 * one per company, the places left going to the newest other consoles it came out on, grey, and PC at the right end
 * (grey when you don't have it on PC, or none: Settings > Interface). A game you don't have shows it all in grey.
 * `platformKey` is the console whose version the cover is (the game of the day, a console's list, a game's page on one
 * console): that console takes the first place, in color when you have it there, grey when you don't (1.5.1); leave it
 * out for a cover of the game across its consoles (a series, a year's Top 20).
 */
export function CoverMarks({ title, coverWidth, platformKey, playable }: { title: string; coverWidth: number; platformKey?: string | null; playable?: string | null }) {
  const on = useSetting('interface.coverMarks', true);
  const pcStyle = useSetting('interface.coverMarksPc', 'dotted');
  const owned = useOwnedMarks()(title);
  const released = useReleasedOn(title, on);
  if (!on) return null;
  const consoles = bannerMarks(owned, released, 2, platformKey ?? null);
  const onPc = owned.includes('pc');
  const yours = owned.length > 0;
  // Big enough to read at a glance on the smallest tiles, small enough to leave the art be.
  const size = coverWidth >= 120 ? 12 : coverWidth >= 64 ? 10 : 8;
  const small = coverWidth < 120;
  return (
    <Group
      className="sc-cover-marks"
      gap={small ? 4 : 6}
      wrap="nowrap"
      aria-label={yours ? 'Yours, and the consoles you have it on' : "You don't have it"}
      style={{ position: 'absolute', top: 5, right: 5, padding: small ? '3px 4px' : '4px 6px', borderRadius: 6, background: 'rgba(255, 255, 255, 0.93)', boxShadow: '0 1px 3px rgba(0, 0, 0, 0.3)', pointerEvents: 'auto' }}
    >
      <StashMark size={size} owned={yours} label={chestLabel(yours, playable)} />
      {consoles.map((m) => (
        <ConsoleMark key={m.key} platformKey={m.key} name={consoleName(m.key)} owned={m.owned} size={size} />
      ))}
      {(onPc || pcStyle === 'dotted') && <ConsoleMark platformKey="pc" name="PC" owned={onPc} size={size} />}
    </Group>
  );
}
