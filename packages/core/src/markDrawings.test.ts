import { describe, expect, it } from 'vitest';
import { CONSOLE_MARKS } from './marks.js';
import { MARK_DRAWINGS } from './markDrawings.js';
import { IGDB_EXTRA_PLATFORM_IDS, IGDB_PLATFORM_IDS } from './igdb.js';
import { KNOWN_PLATFORMS, regionalConsole } from './platforms.js';

describe("the consoles' drawn marks (D185)", () => {
  it('are paths and masks only, each mask id filled in at its use, on the 24-unit grid', () => {
    for (const [key, d] of Object.entries(MARK_DRAWINGS)) {
      for (const body of [d.svg, d.faded ?? '']) {
        expect(body, key).not.toMatch(/<text|var\(--knock/);
        // A mask is named by __ID__, so two marks on a page never share one.
        for (const id of body.matchAll(/mask id="([^"]+)"/g)) expect(id[1], key).toMatch(/^__ID__\d+$/);
      }
      expect(d.width, key).toBeGreaterThan(0);
      expect(d.color, key).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("stand the chest's height, each part placed whole (D247)", () => {
    // A drawing and its word or number are each one group, scaled and moved onto the 24-unit height.
    const placed = /^<g transform="translate\(-?[\d.]+ -?[\d.]+\) scale\([\d.]+\)">/;
    const words = ['playstation-5', 'nintendo-switch-2', 'xbox-series-x', 'atari-2600', 'wii-u'];
    for (const [key, d] of Object.entries(MARK_DRAWINGS)) {
      const parts = d.svg.replace(/^<defs>.*?<\/defs>/, '').split(/(?=<g transform="translate\(-?[\d.]+ -?[\d.]+\) scale)/);
      for (const p of parts) expect(p, key).toMatch(placed);
      if (words.includes(key)) expect(parts, key).toHaveLength(2);
      if (d.faded) expect(d.faded, key).toMatch(placed);
    }
    // PlayStation's drawing grew to the full height, so its mark is now wider than Switch 2's (40 units).
    expect(MARK_DRAWINGS['playstation-5']!.width).toBeGreaterThan(MARK_DRAWINGS['nintendo-switch-2']!.width);
  });

  it('is drawn for consoles Squirrelcade knows (collected, or followed in Roots)', () => {
    // A collected console's key, or a followed one's (Roots: IGDB's consoles).
    const known = new Set([...KNOWN_PLATFORMS.map((p) => p.key), ...Object.keys(IGDB_PLATFORM_IDS), ...Object.keys(IGDB_EXTRA_PLATFORM_IDS), 'pc', 'arcade']);
    for (const key of Object.keys(MARK_DRAWINGS)) expect(known.has(key) || regionalConsole(key) !== null || key in CONSOLE_MARKS, key).toBe(true);
    expect(Object.keys(MARK_DRAWINGS)).toHaveLength(58);
  });
});
