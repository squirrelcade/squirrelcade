import { describe, expect, it } from 'vitest';
import {
  classifyIncludes,
  diffCollections,
  matchesFilePattern,
  parseCollectionExport,
  removalPercent,
} from './pricecharting.js';

const HEADER =
  'id,product-name,console-name,price-in-pennies,include-string,condition-string,sku,notes,cost-basis-in-pennies,quantity,date-entered,date-purchased,grading-company,grading-cert-id,folder';

function csv(...lines: string[]) {
  return [HEADER, ...lines].join('\n');
}

describe('classifyIncludes', () => {
  it('reads the common PriceCharting include strings', () => {
    expect(classifyIncludes('Item, Box, and Manual').completeness).toBe('complete');
    expect(classifyIncludes('New Item, Box, and Manual')).toMatchObject({ completeness: 'sealed', sealed: true });
    expect(classifyIncludes('Item Only').completeness).toBe('loose');
    expect(classifyIncludes('Item and Box').completeness).toBe('item-box');
    expect(classifyIncludes('Item and Manual').completeness).toBe('item-manual');
    expect(classifyIncludes('Box Only').completeness).toBe('box-only');
    expect(classifyIncludes('Manual Only').completeness).toBe('manual-only');
    expect(classifyIncludes('Graded Item').completeness).toBe('graded');
    expect(classifyIncludes('').completeness).toBe('unknown');
  });
});

describe('parseCollectionExport', () => {
  it('parses rows and counts copies', () => {
    const result = parseCollectionExport(
      csv(
        '2932815,Dusk Diver,Nintendo Switch,2549,"New Item, Box, and Manual",Normal wear,,,0,1,2023-04-29,,,,',
        '31515,Cars 2,Playstation 3,799,"Item, Box, and Manual",,,,500,2,2024-01-02,12/25/2023,,,',
      ),
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.copies).toBe(3);
    expect(result.rows[0]).toMatchObject({
      productId: '2932815',
      title: 'Dusk Diver',
      consoleLabel: 'Nintendo Switch',
      valueCents: 2549,
      sealed: true,
      costCents: 0,
      quantity: 1,
      dateEntered: '2023-04-29',
      line: 2,
    });
    expect(result.rows[1]).toMatchObject({ datePurchased: '2023-12-25', costCents: 500, completeness: 'complete' });
  });

  it('warns about rows whose values spill into extra columns', () => {
    const result = parseCollectionExport(
      csv('1,Test Game,Nintendo Switch,1999,New Item, Box, and Manual,,,,0,1,2026-09-27,,,,', '31515,Cars 2,Playstation 3,799,"Item, Box, and Manual",,,,500,2,2024-01-02,,,,'),
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toContain(
      'Line(s) 2 have more values than the file has columns (probably a comma outside quotes), so some of their values may be in the wrong columns.',
    );
    expect(result.rows).toHaveLength(2);
  });

  it('reads an export saved with a byte-order mark (as Excel saves UTF-8 CSV)', () => {
    const result = parseCollectionExport(String.fromCharCode(0xfeff) + csv('31515,Cars 2,Playstation 3,799,"Item, Box, and Manual",,,,500,1,2024-01-02,,,,'));
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({ productId: '31515', title: 'Cars 2' });
  });

  it('refuses a file that is not a collection export', () => {
    const result = parseCollectionExport('name,price\nZelda,10');
    expect(result.errors[0]).toMatch(/missing column/);
    expect(result.rows).toEqual([]);
  });

  it('refuses blank ids and ids reused for different games', () => {
    const result = parseCollectionExport(
      csv(',No Id,NES,100,,,,,,1,,,,,', '5,Game A,NES,100,,,,,,1,,,,,', '5,Game B,NES,100,,,,,,1,,,,,'),
    );
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toMatch(/line\(s\) 2/);
    expect(result.errors[1]).toMatch(/5/);
  });

  it('allows several rows for the same product (separate copies)', () => {
    const result = parseCollectionExport(csv('7,Tetris,GameBoy,500,Item Only,,,,,1,,,,,', '7,Tetris,GameBoy,900,"Item, Box, and Manual",,,,,1,,,,,'));
    expect(result.errors).toEqual([]);
    expect(result.copies).toBe(2);
  });

  it('skips excluded console names such as PC', () => {
    const result = parseCollectionExport(csv('1,Doom,PC Games,100,,,,,,1,,,,,', '2,Doom,Playstation,100,,,,,,1,,,,,'), {
      excludedLabels: ['PC Games', 'PC'],
    });
    expect(result.rows.map((r) => r.consoleLabel)).toEqual(['Playstation']);
    expect(result.excluded).toEqual([{ label: 'PC Games', rows: 1 }]);
  });

  it('warns about and repairs bad numbers, quantities and dates', () => {
    const result = parseCollectionExport(csv('1,Game,NES,abc,,,,,,x,yesterday,,,,'));
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(3);
    expect(result.rows[0]).toMatchObject({ valueCents: null, quantity: 1, dateEntered: null });
  });
});

describe('diffCollections', () => {
  const row = (productId: string, title: string, quantity = 1) => ({ productId, title, consoleLabel: 'NES', quantity });

  it('reports added, removed and changed products', () => {
    const diff = diffCollections([row('1', 'Zelda'), row('2', 'Metroid'), row('3', 'Kirby', 1)], [row('1', 'Zelda'), row('3', 'Kirby', 2), row('4', 'Contra')]);
    expect(diff.added.map((c) => c.title)).toEqual(['Contra']);
    expect(diff.removed.map((c) => c.title)).toEqual(['Metroid']);
    expect(diff.quantityChanged).toEqual([{ productId: '3', title: 'Kirby', consoleLabel: 'NES', before: 1, after: 2 }]);
    expect(diff.copiesBefore).toBe(3);
    expect(diff.copiesAfter).toBe(4);
    expect(removalPercent(diff, 3)).toBeCloseTo(33.33, 1);
  });

  it('counts copies across rows of the same product', () => {
    const diff = diffCollections([row('7', 'Tetris')], [row('7', 'Tetris'), row('7', 'Tetris')]);
    expect(diff.quantityChanged).toHaveLength(1);
    expect(diff.added).toHaveLength(0);
  });
});

describe('matchesFilePattern', () => {
  it('matches PriceCharting export names', () => {
    expect(matchesFilePattern('collection_20260826.csv', 'collection_*.csv')).toBe(true);
    expect(matchesFilePattern('COLLECTION_20260826.CSV', 'collection_*.csv')).toBe(true);
    expect(matchesFilePattern('collection_20260826.csv.part', 'collection_*.csv')).toBe(false);
    expect(matchesFilePattern('notes.txt', 'collection_*.csv')).toBe(false);
  });

  it('takes several patterns separated by semicolons', () => {
    const pattern = 'collection_*.csv; collection*.zip';
    expect(matchesFilePattern('collection_20260927.csv', pattern)).toBe(true);
    expect(matchesFilePattern('collection (1).zip', pattern)).toBe(true);
    expect(matchesFilePattern('collection.zip', pattern)).toBe(true);
    expect(matchesFilePattern('photos.zip', pattern)).toBe(false);
  });
});
