import { platformInText } from './catalogList.js';
import { parseCsvRecords } from './csv.js';
import { normalizeBarcode } from './lookup.js';
import { KNOWN_PLATFORMS, parseConsoleLabel } from './platforms.js';
import { classifyIncludes, parseCollectionExport, REQUIRED_COLUMNS, type CollectionParseResult, type CollectionRow } from './pricecharting.js';

/**
 * Another way in besides PriceCharting (0.6.0): a spreadsheet of your own, saved as CSV, with a Title and a Console
 * column, and optionally condition, quantity, value, price paid, date, region and notes. Other collection apps'
 * exports are read as they come (0.15.0): CLZ Games (Collection Status, Completeness, Barcode...), GAMEYE (Category,
 * UserRecordType, Ownership, YourPrice, CreatedAt...) and VGCollect (Cart, Box and Manual marks, region tags such as
 * "Nintendo 64 [US]"): their console names become Squirrelcade's consoles, and only the games you own come in. Each
 * update is the whole collection, as a PriceCharting export is.
 */

/** The columns a spreadsheet may have, each by the names it may go by (compared without case, spaces or punctuation). */
const COLUMNS = {
  title: ['title', 'name', 'game', 'gametitle', 'gamename', 'productname', 'product'],
  console: ['console', 'platform', 'system', 'consolename', 'platformname', 'systemname'],
  condition: ['condition', 'completeness', 'includes', 'included', 'whatsincluded', 'contents', 'state', 'ownership'],
  quantity: ['quantity', 'qty', 'copies', 'count'],
  value: ['value', 'currentvalue', 'marketvalue', 'estimatedvalue', 'yourprice', 'price', 'worth'],
  paid: ['pricepaid', 'paid', 'purchaseprice', 'cost', 'costbasis', 'purchasedfor', 'boughtfor'],
  date: ['datepurchased', 'purchasedate', 'purchased', 'dateacquired', 'acquired', 'dateadded', 'addeddate', 'added', 'createdat', 'date'],
  region: ['region', 'regioncode', 'country'],
  notes: ['notes', 'note', 'comments', 'comment'],
  /** Whether a row is a game you own: CLZ's Collection Status ("In Collection", "Wish List"...), GAMEYE's UserRecordType. */
  status: ['collectionstatus', 'userrecordtype', 'ownershipstatus', 'status'],
  /** What kind of item a row is: GAMEYE's Category ("Games", "Systems", "Accessories"...). */
  category: ['category'],
  barcode: ['barcode', 'upc', 'ean', 'upcean', 'gtin'],
  /** VGCollect's marks for what a copy has. */
  cart: ['cart', 'cartridge'],
  box: ['box'],
  manual: ['manual'],
} as const;

type Column = keyof typeof COLUMNS;

const squash = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Which header each column is, when the file has it. */
function findColumns(headers: string[]): Partial<Record<Column, string>> {
  const out: Partial<Record<Column, string>> = {};
  for (const [column, names] of Object.entries(COLUMNS) as [Column, readonly string[]][]) {
    const header = names.map((n) => headers.find((h) => squash(h) === n)).find(Boolean);
    if (header) out[column] = header;
  }
  return out;
}

/** PriceCharting's words for what's included, from the way people write a condition. */
const CONDITIONS: [RegExp, string][] = [
  [/^(new|sealed|brand new|factory sealed|nib|mint in box)$/i, 'New Item, Box, and Manual'],
  [/^(graded|slabbed|wata|vga)/i, 'Graded Item'],
  [/^(cib|complete|complete in box|boxed|game, box(,| and) manual|item, box,? and manual)$/i, 'Item, Box, and Manual'],
  [/^(game and box|box and game|game \+ box|item and box|boxed, no manual|no manual)$/i, 'Item and Box'],
  [/^(game and manual|manual and game|game \+ manual|item and manual|no box)$/i, 'Item and Manual'],
  [/^(box only|box)$/i, 'Box Only'],
  [/^(manual only|manual)$/i, 'Manual Only'],
  [/^(loose|game only|cart only|cartridge only|disc only|disk only|item only|cart|disc)$/i, 'Item Only'],
];

/** A condition as PriceCharting's included-items text; empty when it isn't one Squirrelcade knows. */
export function includeStringOf(condition: string): string {
  const c = condition.trim();
  if (!c) return '';
  return CONDITIONS.find(([pattern]) => pattern.test(c))?.[1] ?? '';
}

/**
 * An amount of money as cents: "$12.34", "12.34", "1,234.50", "12,50 €" (a comma before the last two digits is a
 * decimal comma). NaN when it isn't an amount, null when empty.
 */
export function moneyCents(text: string): number | null {
  let t = text.trim().replace(/[\s$€£¥]|USD|EUR|GBP|JPY|CAD|AUD/gi, '');
  if (!t) return null;
  const comma = t.lastIndexOf(',');
  const dot = t.lastIndexOf('.');
  if (comma > dot) t = /,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else t = t.replace(/,/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return Number.NaN;
  return Math.round(Number(t) * 100);
}

/**
 * A day as YYYY-MM-DD from 2026-09-28, 9/28/2026 (month first; day first when the file writes days that way,
 * 28/09/2026) or 28.09.2026; undefined when it can't be read. A time after the date is left out.
 */
function dayOf(text: string, dayFirst = false): string | null | undefined {
  const t = text.trim().replace(/[ T]\d{1,2}:\d{2}(:\d{2})?.*$/, '');
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (us && dayFirst) return `${us[3]}-${us[2]!.padStart(2, '0')}-${us[1]!.padStart(2, '0')}`;
  if (us) return `${us[3]}-${us[1]!.padStart(2, '0')}-${us[2]!.padStart(2, '0')}`;
  const eu = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
  if (eu) return `${eu[3]}-${eu[2]!.padStart(2, '0')}-${eu[1]!.padStart(2, '0')}`;
  return undefined;
}

/** Countries whose releases are PAL (GAMEYE's Country column names the release's country). */
const PAL_COUNTRIES = /^(united kingdom|great britain|england|scotland|wales|ireland|germany|deutschland|france|italy|spain|portugal|netherlands|belgium|luxembourg|sweden|norway|denmark|finland|austria|switzerland|poland|greece|australia|new zealand)$/;

/**
 * PriceCharting's prefix for a region written in a sheet ("Japan", "PAL", "EU", a country); empty for North America
 * ("USA", "NTSC-U", "United States of America") or unknown.
 */
function regionPrefix(region: string): string {
  const r = region.trim().toLowerCase();
  if (/^(jp|jpn|japan|ntsc-j)$/.test(r)) return 'JP ';
  if (/^(pal|eu|eur|europe|uk|gb|au|aus|australia|ntsc-pal)$/.test(r) || PAL_COUNTRIES.test(r)) return 'PAL ';
  if (/^(asia|as|hk|hong kong)$/.test(r)) return 'Asian English ';
  return '';
}

/** A region tag at the end of a console name, as other apps write it: "Nintendo 64 [US]", "Mega Drive (PAL)". */
const REGION_TAG = /\s*[[(](us|usa|na|ntsc|ntsc-u|eu|eur|pal|uk|au|jp|jpn|ntsc-j|japan|asia)[\])]\s*$/i;

/** VGCollect's words for what isn't a game, in its console names ("Nintendo 64 Hardware [US]"). */
const NOT_A_GAME_CONSOLE = /\b(hardware|accessor(y|ies))\b|^consoles$/i;

/** Statuses of rows that aren't games you own: a wish list, sold, on order (CLZ, GAMEYE). */
const NOT_OWNED = /wish|want|on order|ordered|pre-?order|\bsold\b|not in (the )?collection/i;

/** A mark that a copy has a part (VGCollect's Cart, Box and Manual columns). */
const MARKED = /^(1|y|yes|true|x|✓|✔|checked)$/i;

/**
 * Another app's console name as Squirrelcade's (PriceCharting's) console name, and the region its tag gives: "Super
 * Nintendo (SNES)" and "SNES" are Super Nintendo, "Microsoft Xbox" is Xbox, "Nintendo 64 [EU]" is the PAL Nintendo
 * 64. A name Squirrelcade doesn't recognize is kept as written.
 */
function consoleNameOf(name: string): { console: string; tagRegion: string } {
  const tag = REGION_TAG.exec(name);
  const bare = tag ? name.slice(0, tag.index).trim() : name.trim();
  if (parseConsoleLabel(bare).platform) return { console: bare, tagRegion: tag?.[1] ?? '' };
  const key = platformInText(bare, KNOWN_PLATFORMS);
  const known = key ? KNOWN_PLATFORMS.find((p) => p.key === key) : undefined;
  return { console: known?.labels[0] ?? bare, tagRegion: tag?.[1] ?? '' };
}

/** A short stable code for a copy with no PriceCharting id (FNV-1a over its console, title and condition). */
function codeOf(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/** Whether a file is PriceCharting's export (its own columns). */
export const isPriceChartingExport = (headers: readonly string[]) => REQUIRED_COLUMNS.every((c) => headers.includes(c));

/** Reads a spreadsheet of your own (see the top of this file) into collection rows, as a PriceCharting export is read. */
export function parseSpreadsheetCollection(text: string, options: { excludedLabels?: string[] } = {}): CollectionParseResult {
  const { headers, records, rowNumbers, overlong } = parseCsvRecords(text);
  const errors: string[] = [];
  const warnings: string[] = [];
  const columns = findColumns(headers);
  if (!columns.title || !columns.console) {
    errors.push('Not a collection Squirrelcade can read: a PriceCharting export, or a spreadsheet (CSV) with a Title and a Console (or Platform) column.');
    return { rows: [], headers, excluded: [], errors, warnings, copies: 0 };
  }
  if (records.length === 0) errors.push('The file has no rows.');
  // VGCollect's layout (Cart, Box and Manual marks): its Price is what was paid, not what the copy is worth.
  if (columns.cart && columns.box && columns.manual && !columns.paid && columns.value && /^price$/i.test(columns.value.trim())) {
    columns.paid = columns.value;
    delete columns.value;
  }
  const excludedSet = new Set((options.excludedLabels ?? []).map((l) => l.trim().toLowerCase()));
  const notOwned: number[] = [];
  const notGames: number[] = [];
  const excludedCounts = new Map<string, number>();
  const skipped: number[] = [];
  const unknownCondition = new Set<string>();
  const badMoney: number[] = [];
  const badDates: number[] = [];
  const badQuantity: number[] = [];
  const rows: CollectionRow[] = [];
  const get = (r: Record<string, string>, column: Column) => (columns[column] ? (r[columns[column]!] ?? '').trim() : '');
  // A file that writes a day over 12 first (25/04/2022) writes every slash date day first.
  const dayFirst = records.some((r) => {
    const m = /^(\d{1,2})\/(\d{1,2})\/\d{4}/.exec(get(r, 'date'));
    return m !== null && Number(m[1]) > 12;
  });

  records.forEach((r, index) => {
    const line = rowNumbers[index] ?? index + 2;
    const title = get(r, 'title');
    const written = get(r, 'console');
    if (!title || !written) {
      skipped.push(line);
      return;
    }
    // Only the games you own: not a wish list or a sold copy, and not a console or an accessory.
    if (NOT_OWNED.test(get(r, 'status'))) {
      notOwned.push(line);
      return;
    }
    const category = get(r, 'category');
    if ((category && !/game/i.test(category)) || NOT_A_GAME_CONSOLE.test(written)) {
      notGames.push(line);
      return;
    }
    const { console: consoleName, tagRegion } = consoleNameOf(written);
    const consoleLabel = parseConsoleLabel(consoleName).base !== consoleName ? consoleName : `${regionPrefix(get(r, 'region') || tagRegion)}${consoleName}`;
    if (excludedSet.has(consoleName.toLowerCase()) || excludedSet.has(consoleLabel.toLowerCase())) {
      excludedCounts.set(consoleName, (excludedCounts.get(consoleName) ?? 0) + 1);
      return;
    }
    // VGCollect marks each part a copy has instead of naming its condition.
    const parts = (['cart', 'box', 'manual'] as const).map((c) => MARKED.test(get(r, c)));
    const marked = columns.cart && columns.box && columns.manual ? ['', 'Manual Only', 'Box Only', 'Box and Manual', 'Item Only', 'Item and Manual', 'Item and Box', 'Item, Box, and Manual'][Number(parts[0]) * 4 + Number(parts[1]) * 2 + Number(parts[2])]! : '';
    const condition = get(r, 'condition') || marked;
    const includeString = marked && !get(r, 'condition') ? marked : includeStringOf(condition);
    if (condition && !includeString) unknownCondition.add(condition);
    let valueCents = moneyCents(get(r, 'value'));
    let costCents = moneyCents(get(r, 'paid'));
    if (Number.isNaN(valueCents) || Number.isNaN(costCents)) {
      badMoney.push(line);
      if (Number.isNaN(valueCents)) valueCents = null;
      if (Number.isNaN(costCents)) costCents = null;
    }
    const qtyText = get(r, 'quantity');
    let quantity = qtyText === '' ? 1 : Number(qtyText);
    if (!Number.isInteger(quantity) || quantity < 1) {
      badQuantity.push(line);
      quantity = 1;
    }
    const date = dayOf(get(r, 'date'), dayFirst);
    const barcode = normalizeBarcode(get(r, 'barcode'));
    if (date === undefined) badDates.push(line);
    const inc = classifyIncludes(includeString);
    rows.push({
      productId: `s-${codeOf(`${consoleLabel.toLowerCase()}|${title.toLowerCase()}|${includeString}`)}`,
      title,
      consoleLabel,
      valueCents,
      includeString,
      conditionString: condition,
      completeness: inc.completeness,
      sealed: inc.sealed,
      hasBox: inc.hasBox,
      hasManual: inc.hasManual,
      sku: '',
      notes: get(r, 'notes'),
      costCents,
      quantity,
      dateEntered: date ?? null,
      datePurchased: date ?? null,
      gradingCompany: '',
      gradingCertId: '',
      folder: '',
      line,
      ...(barcode ? { barcode } : {}),
    });
  });

  const lines = (list: number[]) => list.slice(0, 10).join(', ') + (list.length > 10 ? ` and ${list.length - 10} more` : '');
  if (rows.length === 0 && records.length > 0 && errors.length === 0) errors.push('No row has both a title and a console.');
  if (skipped.length > 0) warnings.push(`Rows without a title or a console were left out: line(s) ${lines(skipped)}.`);
  if (notOwned.length > 0) warnings.push(`${notOwned.length} ${notOwned.length === 1 ? 'row that isn\'t' : "rows that aren't"} in your collection (a wish list, sold, on order) left out.`);
  if (notGames.length > 0) warnings.push(`${notGames.length} ${notGames.length === 1 ? 'console or accessory' : 'consoles and accessories'} left out (Squirrelcade counts games).`);
  if (unknownCondition.size > 0) {
    warnings.push(`Conditions Squirrelcade doesn't know were read as unknown: ${[...unknownCondition].slice(0, 5).join(', ')} (use Loose, CIB, New, Graded, Box only or Manual only).`);
  }
  if (badMoney.length > 0) warnings.push(`Amounts that couldn't be read were left empty on line(s) ${lines(badMoney)}.`);
  if (badQuantity.length > 0) warnings.push(`Quantities that aren't whole numbers were read as 1 on line(s) ${lines(badQuantity)}.`);
  if (badDates.length > 0) warnings.push(`Dates that couldn't be read were left empty on line(s) ${lines(badDates)} (use 2026-09-28 or 9/28/2026).`);
  if (overlong.length > 0) warnings.push(`Line(s) ${lines(overlong)} have more values than the file has columns (probably a comma outside quotes).`);
  return {
    rows,
    headers,
    excluded: [...excludedCounts].map(([label, count]) => ({ label, rows: count })),
    errors,
    warnings,
    copies: rows.reduce((sum, row) => sum + row.quantity, 0),
  };
}

/**
 * A collection file: PriceCharting's export, or else a spreadsheet of your own. A file with some of PriceCharting's
 * own columns (or an id and no Title and Console) is read as a damaged export, so its missing columns are named.
 */
export function parseAnyCollection(text: string, options: { excludedLabels?: string[] } = {}): CollectionParseResult & { format: 'pricecharting' | 'spreadsheet' } {
  const { headers } = parseCsvRecords(text.split(/\r?\n/, 1)[0] ?? '');
  const own = findColumns(headers);
  const priceChartingLike = REQUIRED_COLUMNS.some((c) => c !== 'id' && headers.includes(c)) || (headers.includes('id') && !(own.title && own.console));
  if (isPriceChartingExport(headers) || priceChartingLike) return { ...parseCollectionExport(text, options), format: 'pricecharting' };
  return { ...parseSpreadsheetCollection(text, options), format: 'spreadsheet' };
}
