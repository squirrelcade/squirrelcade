import { baseTitle, consoleMark, coverMarks, KNOWN_PLATFORMS, markInk, markPixels, matchKey, regionalConsole } from '@squirrelcade/core';
import { Box, Group, Tooltip } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import type { CSSProperties, MouseEvent, ReactElement } from 'react';
import { api } from './api';
import { useSetting } from './hooks';

/**
 * A console's mark (D175): Squirrelcade's own pixel mark in the console's colors, filled where you have the game (or
 * the console's games), dotted where you don't. Every place a console is named uses this one, from one table
 * (core's CONSOLE_MARKS). `size` is its height in pixels.
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
  const mark = consoleMark(platformKey, name);
  const rows = markPixels(mark);
  const height = 8;
  const width = Math.max(...rows.map((r) => r.length));
  // A tile is 7 pixels tall: it's centered in the 8 a drawn mark has, so all marks stand the same height.
  const dy = (height - rows.length) / 2;
  const ink = markInk(mark.color);
  // Dotted, a very dark console (the PlayStation 3's black) is drawn in grey, so it shows on a dark page too.
  const line = markInk(mark.color) === '#FFFFFF' && luminance(mark.color) < 60 ? '#8A8A8A' : mark.color;
  const cells: ReactElement[] = [];
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      let fill: string | null;
      // Dotted, a drawn mark keeps its shape with each pixel a dot.
      const dot = mark.icon && !owned;
      if (mark.icon) fill = mark.icon.colors['ABCDEFGH'.indexOf(ch)] ?? mark.color;
      else if (owned) fill = ch === '+' ? ink : mark.color;
      else {
        // Dotted: the tile's edge every other pixel, its letters in its color.
        const edge = y === 0 || y === rows.length - 1 || x === 0 || x === row.length - 1 || row[x - 1] === '.' || row[x + 1] === '.';
        fill = ch === '+' ? line : edge && (x + y) % 2 === 0 ? line : null;
      }
      if (fill) cells.push(<rect key={`${x},${y}`} x={x + (dot ? 0.2 : 0)} y={y + dy + (dot ? 0.2 : 0)} width={dot ? 0.6 : 1} height={dot ? 0.6 : 1} fill={fill} />);
    }),
  );
  const label = `${name}${owned ? '' : ' (not yours)'}`;
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

/** How light a color is, 0 to 255. */
function luminance(color: string): number {
  const n = Number.parseInt(color.replace('#', ''), 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
}

/** The consoles each game is yours on (GET /api/v1/marks, D175): read once and kept while the collection stays the same. */
export function useOwnedMarks(): (title: string) => string[] {
  const marks = useQuery({ queryKey: ['collection', 'marks'], queryFn: () => api<{ owned: Record<string, string[]> }>('/marks'), staleTime: 5 * 60_000 });
  return (title) => marks.data?.owned[matchKey(baseTitle(title))] ?? [];
}

/**
 * The banner in a cover's top right corner (D175, the owner's design): the two newest consoles you have the game on,
 * one per company, and PC at the right end (dotted when you don't have it on PC, or none: Settings > Interface).
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
  const size = coverWidth >= 120 ? 14 : coverWidth >= 64 ? 10 : 8;
  return (
    <Group
      gap={2}
      wrap="nowrap"
      aria-label="The consoles you have it on"
      style={{ position: 'absolute', top: 3, right: 3, padding: 2, borderRadius: 3, background: 'var(--sc-cover-marks-bg, rgba(20, 20, 18, 0.85))', border: '0.5px solid rgba(255, 255, 255, 0.25)', pointerEvents: 'auto' }}
    >
      {consoles.map((k) => (
        <ConsoleMark key={k} platformKey={k} name={consoleName(k)} size={size} />
      ))}
      {(onPc || pcStyle === 'dotted') && <ConsoleMark platformKey="pc" name="PC" owned={onPc} size={size} />}
    </Group>
  );
}
