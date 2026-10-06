import { describe, expect, it } from 'vitest';
import { includeStringOf, isPriceChartingExport, moneyCents, parseAnyCollection, parseSpreadsheetCollection } from './spreadsheet.js';

describe('includeStringOf', () => {
  it("reads the ways people write a condition as PriceCharting's words", () => {
    expect(['Sealed', 'NEW', 'factory sealed'].map(includeStringOf)).toEqual(Array(3).fill('New Item, Box, and Manual'));
    expect(['CIB', 'Complete', 'complete in box', 'Game, box and manual'].map(includeStringOf)).toEqual(Array(4).fill('Item, Box, and Manual'));
    expect(['Loose', 'cart only', 'Disc only', 'game only'].map(includeStringOf)).toEqual(Array(4).fill('Item Only'));
    expect(includeStringOf('Game and box')).toBe('Item and Box');
    expect(includeStringOf('no box')).toBe('Item and Manual');
    expect(includeStringOf('Box only')).toBe('Box Only');
    expect(includeStringOf('manual')).toBe('Manual Only');
    expect(includeStringOf('WATA 9.4')).toBe('Graded Item');
    expect(includeStringOf('')).toBe('');
    expect(includeStringOf('Very good')).toBe('');
  });
});

describe('moneyCents', () => {
  it('reads amounts with symbols, thousands and decimal commas', () => {
    expect(moneyCents('$12.34')).toBe(1234);
    expect(moneyCents('12')).toBe(1200);
    expect(moneyCents('1,234.50')).toBe(123450);
    expect(moneyCents('12,50 €')).toBe(1250);
    expect(moneyCents('1.234,50')).toBe(123450);
    expect(moneyCents('1,234')).toBe(123400);
    expect(moneyCents('USD 7.5')).toBe(750);
    expect(moneyCents('')).toBeNull();
    expect(moneyCents('free')).toBeNaN();
  });
});

describe("other apps' exports", () => {
  const read = (text: string) => parseAnyCollection(text);
  const summary = (text: string) => read(text).rows.map((r) => [r.title, r.consoleLabel, r.includeString, r.valueCents, r.costCents, r.datePurchased]);

  it('reads GAMEYE: its console names, only owned games, Ownership, YourPrice and day-first dates', () => {
    const text = [
      'Platform,Category,UserRecordType,Title,Country,ReleaseType,Publisher,Developer,CreatedAt,Ownership,PriceLoose,PriceCIB,PriceNew,YourPrice,PricePaid,ItemCondition,BoxCondition,ManualCondition,Beat,PlayedCompletion,Notes,Tags',
      '"Super Nintendo (SNES)","Games","Owned","Super Metroid","United States of America","Official","Nintendo","Nintendo","25/04/2022","CIB","40.00","120.00","900.00","120.00","80.00","10","9","9"," "," ","",""',
      '"Microsoft Xbox","Games","Owned","Halo","United Kingdom","Official","Microsoft","Bungie","03/05/2022","Loose","5.00","12.00","60.00","5.00","2.00","8","","",""," ","",""',
      '"Nintendo 64","Games","Wishlist","Perfect Dark","United States of America","Official","Rare","Rare","04/05/2022","","20.00","60.00","300.00","","","","","","","","",""',
      '"Nintendo 64","Systems","Owned","Nintendo 64 Console","United States of America","Official","Nintendo","Nintendo","04/05/2022","Loose","","","","","","","","","","","",""',
    ].join('\n');
    const result = read(text);
    expect(result.format).toBe('spreadsheet');
    expect(summary(text)).toEqual([
      ['Super Metroid', 'Super Nintendo', 'Item, Box, and Manual', 12000, 8000, '2022-04-25'],
      ['Halo', 'PAL Xbox', 'Item Only', 500, 200, '2022-05-03'],
    ]);
    expect(result.warnings).toEqual(["1 row that isn't in your collection (a wish list, sold, on order) left out.", '1 console or accessory left out (Squirrelcade counts games).']);
  });

  it("reads CLZ Games: Collection Status, Completeness, Region, and each game's barcode", () => {
    const text = [
      'Title;Platform;Collection Status;Region;Completeness;Purchase Date;Purchase Price;Barcode;Notes',
      'Super Mario World;SNES;In Collection;USA;Complete;2025-03-01;$45.00;045496830434;Box a bit worn',
      'Ico;PlayStation 2;For Sale;Europe;Loose;;€12,50;;',
      'Metroid Dread;Nintendo Switch;Wish List;USA;;;;;',
      'Chrono Trigger;Super Nintendo Entertainment System;Sold;USA;Loose;;;;',
    ].join('\n');
    expect(summary(text)).toEqual([
      ['Super Mario World', 'Super Nintendo', 'Item, Box, and Manual', null, 4500, '2025-03-01'],
      ['Ico', 'PAL PlayStation 2', 'Item Only', null, 1250, null],
    ]);
    const rows = read(text).rows;
    expect(rows[0]!.barcode).toBe('045496830434');
    expect(rows[1]!.barcode).toBeUndefined();
    expect(read(text).warnings).toEqual(["2 rows that aren't in your collection (a wish list, sold, on order) left out."]);
  });

  it("reads VGCollect: region tags, what each copy has, and what was paid", () => {
    const text = [
      'VGC ID,Name,Platform,Notes,Cart,Box,Manual,Other,Price,Purchase Date,Date Added',
      '101,Super Mario 64,Nintendo 64 [US],,1,1,0,0,30.00,2024-01-02,2024-01-02 10:00:00',
      '102,Perfect Dark,Nintendo 64 [EU],Expansion Pak needed,1,1,1,0,,,2024-02-03 11:00:00',
      '103,Doom,Sega 32X [JP],,1,0,0,0,15,,2024-03-04 12:00:00',
      '104,Controller Pak,Nintendo 64 Accessories [US],,1,0,0,0,5,,2024-03-05 12:00:00',
    ].join('\n');
    expect(summary(text)).toEqual([
      ['Super Mario 64', 'Nintendo 64', 'Item and Box', null, 3000, '2024-01-02'],
      ['Perfect Dark', 'PAL Nintendo 64', 'Item, Box, and Manual', null, null, null],
      ['Doom', 'JP Sega 32X', 'Item Only', null, 1500, null],
    ]);
    expect(read(text).warnings).toEqual(['1 console or accessory left out (Squirrelcade counts games).']);
  });
});

describe('parseSpreadsheetCollection', () => {
  it('reads a sheet of your own with columns by other names, into rows like an export', () => {
    const text = [
      'Game Name,Platform,Condition,Qty,Current Value,Price Paid,Purchase Date,Region,Notes',
      'Okami,PlayStation 2,CIB,1,$30.00,$12.00,3/15/2024,,Black label',
      'Mother 3,Game Boy Advance,Loose,2,45,,2024-06-01,Japan,',
      'Halo 3,Xbox 360,Sealed,,,,15.06.2025,PAL,',
    ].join('\n');
    const result = parseSpreadsheetCollection(text);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.copies).toBe(4);
    expect(result.rows.map((r) => [r.title, r.consoleLabel, r.includeString, r.completeness, r.quantity, r.valueCents, r.costCents, r.datePurchased])).toEqual([
      ['Okami', 'PlayStation 2', 'Item, Box, and Manual', 'complete', 1, 3000, 1200, '2024-03-15'],
      // A console written another way becomes PriceCharting's name for it.
      ['Mother 3', 'JP GameBoy Advance', 'Item Only', 'loose', 2, 4500, null, '2024-06-01'],
      ['Halo 3', 'PAL Xbox 360', 'New Item, Box, and Manual', 'sealed', 1, null, null, '2025-06-15'],
    ]);
    expect(result.rows[0]!.notes).toBe('Black label');
    // Each row gets a code of its own that stays the same from one update to the next.
    expect(result.rows[0]!.productId).toMatch(/^s-[0-9a-f]{16}$/);
    expect(parseSpreadsheetCollection(text).rows.map((r) => r.productId)).toEqual(result.rows.map((r) => r.productId));
    expect(new Set(result.rows.map((r) => r.productId)).size).toBe(3);
  });

  it("says what it couldn't read, and leaves out excluded consoles", () => {
    const text = ['Title,Console,Condition,Quantity,Value,Date', 'Okami,PlayStation 2,Very good,one,lots,yesterday', ',Wii,,,,', 'Wii Sports,Wii,Loose,1,5,'].join('\n');
    const result = parseSpreadsheetCollection(text, { excludedLabels: ['Wii'] });
    expect(result.rows.map((r) => r.title)).toEqual(['Okami']);
    expect(result.rows[0]).toMatchObject({ quantity: 1, valueCents: null, includeString: '', completeness: 'unknown', dateEntered: null });
    expect(result.excluded).toEqual([{ label: 'Wii', rows: 1 }]);
    expect(result.warnings).toEqual([
      'Rows without a title or a console were left out: line(s) 3.',
      "Conditions Squirrelcade doesn't know were read as unknown: Very good (use Loose, CIB, New, Graded, Box only or Manual only).",
      "Amounts that couldn't be read were left empty on line(s) 2.",
      "Quantities that aren't whole numbers were read as 1 on line(s) 2.",
      "Dates that couldn't be read were left empty on line(s) 2 (use 2026-09-28 or 9/28/2026).",
    ]);
  });

  it('refuses a file without a title and a console', () => {
    expect(parseSpreadsheetCollection('Name,Price\nOkami,5').errors[0]).toMatch(/^Not a collection Squirrelcade can read/);
    expect(parseSpreadsheetCollection('Title,Console\n').errors).toEqual(['The file has no rows.']);
    expect(parseSpreadsheetCollection('Title,Console\n,\n').errors).toEqual(['No row has both a title and a console.']);
  });
});

describe('parseAnyCollection', () => {
  const EXPORT = 'id,product-name,console-name,price-in-pennies,include-string,condition-string,sku,notes,cost-basis-in-pennies,quantity,date-entered,date-purchased,grading-company,grading-cert-id,folder\n1,"Okami",Playstation 2,3000,"Item, Box, and Manual",,,,0,1,2026-01-01,,,,';

  it("reads PriceCharting's export as one, and anything else as a spreadsheet of your own", () => {
    expect(isPriceChartingExport(EXPORT.split('\n')[0]!.split(','))).toBe(true);
    expect(parseAnyCollection(EXPORT)).toMatchObject({ format: 'pricecharting', rows: [{ productId: '1', title: 'Okami' }] });
    expect(parseAnyCollection('Title,System\nOkami,PlayStation 2')).toMatchObject({ format: 'spreadsheet', rows: [{ title: 'Okami', consoleLabel: 'PlayStation 2' }] });
    // An export missing a column is still read as one, so it names what's missing.
    const broken = parseAnyCollection('id,product-name,console-name\n1,Okami,Playstation 2');
    expect(broken.format).toBe('pricecharting');
    expect(broken.errors[0]).toMatch(/missing column/);
    expect(parseAnyCollection('id,name\n1,x')).toMatchObject({ format: 'pricecharting' });
    // Your own sheet with an id column of its own is still yours.
    expect(parseAnyCollection('ID,Title,Platform\n7,Okami,PlayStation 2')).toMatchObject({ format: 'spreadsheet', rows: [{ title: 'Okami' }] });
  });
});
