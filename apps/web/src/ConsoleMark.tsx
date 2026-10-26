import { baseTitle, consoleMark, coverMarks, KNOWN_PLATFORMS, MARK_DRAWINGS, markInk, markPixels, matchKey, regionalConsole, type MarkDrawing } from '@squirrelcade/core';
import { Box, Group, Tooltip } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useId, type CSSProperties, type MouseEvent, type ReactElement } from 'react';
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

/**
 * A console's mark: Squirrelcade's drawing of it (D185, after its hardware and symbols) in its color where you have the
 * game (or the console's games), faded grey where you don't; a console without a drawing keeps its pixel mark (D175).
 * Every place a console is named uses this one. `size` is its height in pixels.
 */
export function ConsoleMark({
  platformKey,
  name,
  owned = true,
  size = 16,
  onClick,
  style,
}: {
  platformKey: string;
  /** The console's name, for its label (and the mark of a console the table has none for). */
  name: string;
  owned?: boolean;
  size?: number;
  onClick?: (ev: MouseEvent) => void;
  style?: CSSProperties;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const drawing = drawingOf(platformKey);
  const label = `${name}${owned ? '' : ' (not yours)'}`;
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

/**
 * The banner in a cover's top right corner (D175, the owner's design; D185, light): the two newest consoles you have
 * the game on, one per company, and PC at the right end (faded when you don't have it on PC, or none: Settings > Interface).
 * Nothing when you don't have the game, or the setting is off.
 */
export function CoverMarks({ title, coverWidth }: { title: string; coverWidth: number }) {
  const on = useSetting('interface.coverMarks', true);
  const pcStyle = useSetting('interface.coverMarksPc', 'dotted');
  const owned = useOwnedMarks()(title);
  if (!on || owned.length === 0) return null;
  const consoles = coverMarks(owned);
  const onPc = owned.includes('pc');
  if (consoles.length === 0 && !onPc) return null;
  // Big enough to read at a glance on the smallest tiles, small enough to leave the art be.
  const size = coverWidth >= 120 ? 12 : coverWidth >= 64 ? 10 : 8;
  const small = coverWidth < 120;
  return (
    <Group
      className="sc-cover-marks"
      gap={small ? 4 : 6}
      wrap="nowrap"
      aria-label="The consoles you have it on"
      style={{ position: 'absolute', top: 5, right: 5, padding: small ? '3px 4px' : '4px 6px', borderRadius: 6, background: 'rgba(255, 255, 255, 0.93)', boxShadow: '0 1px 3px rgba(0, 0, 0, 0.3)', pointerEvents: 'auto' }}
    >
      {consoles.map((k) => (
        <ConsoleMark key={k} platformKey={k} name={consoleName(k)} size={size} />
      ))}
      {(onPc || pcStyle === 'dotted') && <ConsoleMark platformKey="pc" name="PC" owned={onPc} size={size} />}
    </Group>
  );
}
