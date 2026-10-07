import { useRef, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { SortableTh, type SortDirection } from './components';

/** What a row has in a column: words, a number, a date as ISO text, yes or no. Nothing sorts last either way. */
export type SortValue = string | number | boolean | null | undefined;

const empty = (v: SortValue) => v === null || v === undefined || v === '';

/**
 * The rows in a column's order, either way (D144): words A to Z with the numbers in them in order ("Mega Man 2" before
 * "Mega Man 10"), numbers and dates as they are, no before yes. Rows with nothing in the column come last either way,
 * and rows that tie keep the order they came in.
 */
export function sortRows<T>(rows: readonly T[], value: (row: T) => SortValue, dir: SortDirection): T[] {
  const keyed = rows.map((row, index) => ({ row, index, v: value(row) }));
  keyed.sort((a, b) => {
    if (empty(a.v) || empty(b.v)) return empty(a.v) === empty(b.v) ? a.index - b.index : empty(a.v) ? 1 : -1;
    const x = typeof a.v === 'boolean' ? Number(a.v) : a.v!;
    const y = typeof b.v === 'boolean' ? Number(b.v) : b.v!;
    const order = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
    return (dir === 'asc' ? order : -order) || a.index - b.index;
  });
  return keyed.map((k) => k.row);
}

/**
 * A table that sorts by its headings (D144): click one to sort by its column, click it again to reverse. A column
 * sorts first the way that's most useful (`columns`: words A to Z, numbers and dates most or newest first). The choice
 * lives in the address (?sort=added&dir=desc; `prefix` keeps a page's second table apart), so a reload and the back
 * button keep it; a new choice goes back to the first page.
 */
export function useSort<C extends string>(columns: Record<C, SortDirection>, initial: NoInfer<C>, prefix = '') {
  const [params, setParams] = useSearchParams();
  const sortKey = `${prefix}sort`;
  const dirKey = `${prefix}dir`;
  const asked = params.get(sortKey) ?? '';
  const by = (Object.prototype.hasOwnProperty.call(columns, asked) ? asked : initial) as C;
  const askedDir = params.get(dirKey);
  const dir: SortDirection = askedDir === 'asc' || askedDir === 'desc' ? askedDir : columns[by];
  // The choice as of the last click: a second click before the page has caught up with the first still reverses it.
  const latest = useRef({ by, dir });
  latest.current = { by, dir };
  const set = (column: C, direction: SortDirection) => {
    latest.current = { by: column, dir: direction };
    const next = new URLSearchParams(params);
    next.set(sortKey, column);
    next.set(dirKey, direction);
    next.delete(`${prefix}page`);
    setParams(next, { replace: true });
  };
  const sortBy = (column: C) => {
    const now = latest.current;
    set(column, column === now.by ? (now.dir === 'asc' ? 'desc' : 'asc') : columns[column]);
  };
  /** A heading that sorts by its column. */
  const th = (column: C, label: ReactNode, opts: { ta?: 'left' | 'right'; w?: number | string; visibleFrom?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' } = {}) => (
    <SortableTh key={column} label={label} active={by === column} direction={dir} onSort={() => sortBy(column)} {...opts} />
  );
  return { by, dir, set, sortBy, th };
}
