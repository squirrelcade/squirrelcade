import { Group, Text } from '@mantine/core';
import squirrel from './squirrel.svg';

/**
 * The pixel squirrel (docs/brand), `size` pixels square. Part of the page's own code (small enough to be written into
 * it), so it's always the one this version draws, never an earlier one a browser or the offline copy kept.
 */
export function Squirrel({ size }: { size: number }) {
  return <img src={squirrel} alt="" width={size} height={size} />;
}

/**
 * The header's brand: the pixel squirrel at twice its 16 pixels, and the name. The default name is the two-color
 * wordmark (docs/brand), its colors set for light and dark in main.tsx; a name the owner chose is shown as it is. The
 * name's size is index.html's (.sc-brand-name): smaller, then hidden, where the header has little room.
 */
export function Brand({ name }: { name: string }) {
  return (
    <Group gap={8} wrap="nowrap">
      <Squirrel size={32} />
      {name === 'Squirrelcade' ? (
        <Text component="span" className="sc-brand-name" ff="heading" fw={700} lh={1} style={{ letterSpacing: '-0.5px', whiteSpace: 'nowrap' }}>
          <span style={{ color: 'var(--sc-wordmark-squirrel)' }}>squirrel</span>
          <span style={{ color: 'var(--sc-wordmark-cade)' }}>cade</span>
        </Text>
      ) : (
        <Text component="span" className="sc-brand-name" ff="heading" fw={600} lh={1.1} lineClamp={1}>
          {name}
        </Text>
      )}
    </Group>
  );
}
