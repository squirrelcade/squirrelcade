import { Text, UnstyledButton } from '@mantine/core';
import type { ConsoleActivity } from '@squirrelcade/core';
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import { useMemo } from 'react';
import { recentGames } from './GameDrawer';
import { searchWeights } from './oneLine';

/** Each console's weight for a game's first marks (T-407): the server's activity, and the games this browser opened lately. */
export function useSearchWeights(activity: Record<string, ConsoleActivity> | undefined): Map<string, number> {
  return useMemo(() => searchWeights(activity, recentGames()), [activity]);
}

/**
 * "+n more" after a game's first consoles' marks, and "fewer" once open (T-407): every console the game came out on is a
 * tap away, none dropped. `keepFocus` keeps a search box focused while it's pressed, so its list stays open.
 */
export function MoreConsoles({ hidden, open, onToggle, size = 'xs', keepFocus = false }: { hidden: number; open: boolean; onToggle: () => void; size?: 'xs' | 'sm'; keepFocus?: boolean }) {
  if (!open && hidden === 0) return null;
  return (
    <UnstyledButton
      type="button"
      onMouseDown={keepFocus ? (e) => e.preventDefault() : undefined}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      aria-expanded={open}
      aria-label={open ? 'Show fewer consoles' : `Show ${hidden} more ${hidden === 1 ? 'console' : 'consoles'}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}
    >
      <Text span size={size} c="dimmed">
        {open ? 'fewer' : `+${hidden} more`}
      </Text>
      {open ? <IconChevronUp size={12} aria-hidden="true" /> : <IconChevronDown size={12} aria-hidden="true" />}
    </UnstyledButton>
  );
}
