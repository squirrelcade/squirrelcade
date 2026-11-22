import { readFileSync } from 'node:fs';
import { baseTitle, matchKey } from '@squirrelcade/core';
import { SPOT_TYPES } from '../timeMachine.js';

/**
 * The yardstick's release index (docs/leaves-yardstick.md): IGDB's games with a release day, by day, read from the
 * snapshot's releases.jsonl instead of a live database. It answers as TimeMachineService.releasesBetween does, so the
 * yardstick checks an issue for the same games the server would.
 */
export interface ReleaseRow {
  platformKey: string;
  title: string;
  day: string;
  /** IGDB's other names for it. */
  alt: string[];
}

/** One line of releases.jsonl: k console key, t title, alt other names, day released, type IGDB's game type. */
interface ReleaseLine {
  k: string;
  t: string | null;
  alt?: string[];
  day: string | null;
  type: string | null;
}

export class Releases {
  private first: Map<string, string> | null = null;

  /** rows: the releases an issue is checked for; every: all of IGDB's entries with a day (bundles and packs too). */
  constructor(
    private readonly rows: ReleaseRow[],
    private readonly every: ReleaseRow[] = rows,
  ) {
    this.rows.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  }

  /** The day a game first came out on any console, by its title's key (its other names too); null when IGDB has none. */
  firstDay(titleKey: string): string | null {
    if (!this.first) {
      this.first = new Map();
      for (const r of this.every) {
        for (const name of [r.title, ...r.alt]) {
          const k = matchKey(baseTitle(name));
          const had = this.first.get(k);
          if (!had || r.day < had) this.first.set(k, r.day);
        }
      }
    }
    return this.first.get(titleKey) ?? null;
  }

  get size(): number {
    return this.rows.length;
  }

  between(from: string, to: string, keep: (platformKey: string) => boolean = () => true): ReleaseRow[] {
    let lo = 0;
    let hi = this.rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.rows[mid]!.day < from) lo = mid + 1;
      else hi = mid;
    }
    const out: ReleaseRow[] = [];
    for (let i = lo; i < this.rows.length && this.rows[i]!.day <= to; i++) if (keep(this.rows[i]!.platformKey)) out.push(this.rows[i]!);
    return out;
  }
}

export function readReleases(path: string): Releases {
  const rows: ReleaseRow[] = [];
  const every: ReleaseRow[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line) as ReleaseLine;
    if (!r.t || !r.day) continue;
    const row = { platformKey: r.k, title: r.t, day: r.day, alt: r.alt ?? [] };
    every.push(row);
    if (r.type === null || SPOT_TYPES.has(r.type)) rows.push(row);
  }
  return new Releases(rows, every);
}
