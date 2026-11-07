import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { zipContents, zipRead } from './magazines.js';
import { ZipFileWriter } from './zip.js';

describe('a zip written a file at a time (D209)', () => {
  it('reads back whole, in zip64 form past 65,535 files (a library of magazines is ~77,000 pages)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'squirrelcade-zip-'));
    try {
      const small = join(dir, 'small.zip');
      const w = await ZipFileWriter.create(small);
      await w.add('a/ocr/one/001.hocr', Buffer.from('<p>one</p>'));
      await w.add('manifest.json', Buffer.from('{"x":1}'));
      await w.close();
      const items = await zipContents(small);
      expect(items.map((i) => i.name)).toEqual(['a/ocr/one/001.hocr', 'manifest.json']);
      expect((await zipRead(small, items[1]!)).toString()).toBe('{"x":1}');

      const big = join(dir, 'big.zip');
      const z = await ZipFileWriter.create(big);
      for (let i = 0; i < 66_000; i++) await z.add(`m/ocr/i/${String(i).padStart(5, '0')}.hocr`, Buffer.from(`page ${i}`));
      await z.close();
      const all = await zipContents(big);
      expect(all).toHaveLength(66_000);
      expect((await zipRead(big, all[65_999]!)).toString()).toBe('page 65999');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
