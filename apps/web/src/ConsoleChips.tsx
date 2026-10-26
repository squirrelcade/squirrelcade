import { Chip, Group } from '@mantine/core';
import { ConsoleMark } from './ConsoleMark';

/** Whether the focus went to a console chip (a chip's label moves it to its box when clicked): a search box stays open then. */
export const isConsoleChip = (el: EventTarget | null): boolean => el instanceof Element && el.closest('[data-console-chips]') !== null;

/**
 * A search's consoles as chips (the owner, 2026-10-16: "filter results by different consoles that it's seen"): All,
 * then each console among the results with how many there are, the most first. One at a time; tapping the chosen one
 * again goes back to All. Shown only when the results span two consoles or more (or one is chosen). `keepFocus` keeps
 * a search box focused while a chip is pressed, so its dropdown stays open.
 */
export function ConsoleChips({
  results,
  value,
  onChange,
  keepFocus = false,
}: {
  results: readonly { platformKey: string; platform: string }[];
  value: string | null;
  onChange: (platformKey: string | null) => void;
  keepFocus?: boolean;
}) {
  const counts = new Map<string, { name: string; n: number }>();
  for (const r of results) {
    const c = counts.get(r.platformKey) ?? { name: r.platform, n: 0 };
    c.n++;
    counts.set(r.platformKey, c);
  }
  if (counts.size < 2 && value === null) return null;
  const consoles = [...counts.entries()].sort((a, b) => b[1].n - a[1].n || a[1].name.localeCompare(b[1].name));
  return (
    <Group gap={4} wrap="wrap" role="group" aria-label="Filter by console" data-console-chips onMouseDown={keepFocus ? (e) => e.preventDefault() : undefined}>
      <Chip size="xs" variant="light" checked={value === null} onChange={() => onChange(null)}>
        All
      </Chip>
      {consoles.map(([key, c]) => (
        <Chip key={key} size="xs" variant="light" checked={value === key} onChange={() => onChange(value === key ? null : key)}>
          <ConsoleMark platformKey={key} name={c.name} size={10} style={{ marginRight: 4 }} />
          {`${c.name} ${c.n}`}
        </Chip>
      ))}
    </Group>
  );
}
