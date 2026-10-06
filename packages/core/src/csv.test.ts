import { describe, expect, it } from 'vitest';
import { csvDelimiter, parseCsv, parseCsvRecords, toCsv } from './csv.js';

describe('parseCsv', () => {
  it('reads quoted fields with commas, quotes and line breaks', () => {
    const rows = parseCsv('a,"b, c","say ""hi""","line\nbreak"\r\n1,2,3,4');
    expect(rows).toEqual([
      ['a', 'b, c', 'say "hi"', 'line\nbreak'],
      ['1', '2', '3', '4'],
    ]);
  });

  it('ignores a byte order mark and a trailing newline', () => {
    expect(parseCsv('﻿x,y\n1,2\n')).toEqual([
      ['x', 'y'],
      ['1', '2'],
    ]);
  });

  it('keeps empty fields', () => {
    expect(parseCsv(',a,,\n')).toEqual([['', 'a', '', '']]);
  });
});

describe('parseCsvRecords', () => {
  it('maps rows by header and skips blank lines', () => {
    const { headers, records } = parseCsvRecords('id,name\n\n1,Zelda\n2,"Mario, Jr."\n');
    expect(headers).toEqual(['id', 'name']);
    expect(records).toEqual([
      { id: '1', name: 'Zelda' },
      { id: '2', name: 'Mario, Jr.' },
    ]);
  });

  it('numbers rows as they are in the file and finds rows with extra values', () => {
    const { rowNumbers, overlong } = parseCsvRecords('id,name\n\n1,Zelda\n2,Mario, Jr.\n');
    expect(rowNumbers).toEqual([3, 4]);
    expect(overlong).toEqual([4]);
  });
});

describe('toCsv', () => {
  const BOM = String.fromCharCode(0xfeff);

  it('quotes when needed and reads back the same', () => {
    const text = toCsv([
      ['Title', 'Score'],
      ['Mario, Jr.', 12],
      ['Say "hi"', -20],
      ['Two\nlines', null],
    ]);
    expect(text.startsWith(BOM)).toBe(true);
    expect(parseCsv(text.slice(1))).toEqual([
      ['Title', 'Score'],
      ['Mario, Jr.', '12'],
      ['Say "hi"', '-20'],
      ['Two\nlines', ''],
    ]);
  });

  it('keeps spreadsheets from running text as a formula', () => {
    expect(toCsv([['=HYPERLINK("x")', '+1 Game', '@home', 'Normal']])).toBe(`${BOM}"'=HYPERLINK(""x"")",'+1 Game,'@home,Normal\r\n`);
  });
});


describe('csvDelimiter', () => {
  it('finds a semicolon or tab separator from the first line, commas otherwise', () => {
    expect(csvDelimiter('Title;Platform;Notes\nA;B;C')).toBe(';');
    expect(csvDelimiter('Title\tPlatform\nA\tB')).toBe('\t');
    expect(csvDelimiter('id,product-name,console-name\n1,"A; B",C')).toBe(',');
    // A semicolon inside quotes doesn't count.
    expect(csvDelimiter('"Title; name",Platform\nA,B')).toBe(',');
  });
});
