import { parseCsvRecords } from './csv.js';

/** Columns a PriceCharting collection export must have (same check the old n8n import made). */
export const REQUIRED_COLUMNS = ['id', 'product-name', 'console-name', 'price-in-pennies'] as const;

/** How complete a copy is, from PriceCharting's included-items text. */
export type Completeness =
  | 'sealed'
  | 'complete'
  | 'item-box'
  | 'item-manual'
  | 'loose'
  | 'box-only'
  | 'manual-only'
  | 'graded'
  | 'unknown';

/** Completeness names for the interface. */
export const COMPLETENESS_LABELS: Record<Completeness, string> = {
  sealed: 'Sealed',
  complete: 'Complete in box',
  'item-box': 'Game and box',
  'item-manual': 'Game and manual',
  loose: 'Loose',
  'box-only': 'Box only',
  'manual-only': 'Manual only',
  graded: 'Graded',
  unknown: 'Unknown',
};

/** Short forms for badges and narrow columns. */
export const COMPLETENESS_SHORT: Record<Completeness, string> = {
  sealed: 'Sealed',
  complete: 'CIB',
  'item-box': 'Game + box',
  'item-manual': 'Game + manual',
  loose: 'Loose',
  'box-only': 'Box',
  'manual-only': 'Manual',
  graded: 'Graded',
  unknown: '?',
};

/** What a copy includes, read from its condition and included-items text. */
export interface Includes {
  completeness: Completeness;
  sealed: boolean;
  hasItem: boolean;
  hasBox: boolean;
  hasManual: boolean;
}

/**
 * Reads PriceCharting's include-string ("Item, Box, and Manual", "New Item, Box, and Manual",
 * "Item Only", "Box Only", "Graded Item"...) into flags.
 */
export function classifyIncludes(includeString: string): Includes {
  const s = includeString.trim().toLowerCase();
  const sealed = s.startsWith('new');
  const graded = s.includes('graded');
  const hasItem = s.includes('item') || s.includes('game') || s.includes('cart') || s.includes('disc');
  const hasBox = s.includes('box') || s.includes('case');
  const hasManual = s.includes('manual');
  let completeness: Completeness = 'unknown';
  if (graded) completeness = 'graded';
  else if (sealed) completeness = 'sealed';
  else if (hasItem && hasBox && hasManual) completeness = 'complete';
  else if (hasItem && hasBox) completeness = 'item-box';
  else if (hasItem && hasManual) completeness = 'item-manual';
  else if (hasItem) completeness = 'loose';
  else if (hasBox && !hasManual) completeness = 'box-only';
  else if (hasManual && !hasBox) completeness = 'manual-only';
  return { completeness, sealed, hasItem: hasItem || sealed, hasBox: hasBox || sealed, hasManual: hasManual || sealed };
}

/** One row of a PriceCharting collection export, as Squirrelcade reads it. */
export interface CollectionRow {
  /** PriceCharting product ID; copies of the same product share it. */
  productId: string;
  title: string;
  consoleLabel: string;
  valueCents: number | null;
  includeString: string;
  conditionString: string;
  completeness: Completeness;
  sealed: boolean;
  hasBox: boolean;
  hasManual: boolean;
  sku: string;
  notes: string;
  costCents: number | null;
  quantity: number;
  dateEntered: string | null;
  datePurchased: string | null;
  gradingCompany: string;
  gradingCertId: string;
  folder: string;
  /** Line in the CSV file (the header is line 1). */
  line: number;
  /** The copy's barcode, when the file has one (another app's export: CLZ's Barcode column); saved as a known barcode. */
  barcode?: string;
}

/** A parsed export: its rows, and what was skipped or couldn't be read. */
export interface CollectionParseResult {
  rows: CollectionRow[];
  headers: string[];
  /** Rows skipped because their console name is excluded (for example PC). */
  excluded: { label: string; rows: number }[];
  /** Problems that stop the import. */
  errors: string[];
  /** Problems that were fixed or ignored. */
  warnings: string[];
  copies: number;
}

function toCents(value: string): number | null {
  const v = value.trim();
  if (v === '') return null;
  if (!/^-?\d+$/.test(v)) return Number.NaN;
  return Number.parseInt(v, 10);
}

function toDate(value: string): string | null | undefined {
  const v = value.trim();
  if (v === '') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (us) return `${us[3]}-${us[1]!.padStart(2, '0')}-${us[2]!.padStart(2, '0')}`;
  return undefined;
}

/** Parses and checks a PriceCharting collection export. Import only when `errors` is empty. */
export function parseCollectionExport(
  text: string,
  options: { excludedLabels?: string[] } = {},
): CollectionParseResult {
  const { headers, records, rowNumbers, overlong } = parseCsvRecords(text);
  const errors: string[] = [];
  const warnings: string[] = [];
  const excludedSet = new Set((options.excludedLabels ?? []).map((l) => l.trim().toLowerCase()));

  const missing = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
  if (missing.length > 0) {
    errors.push(`Not a PriceCharting collection export: missing column(s) ${missing.join(', ')}.`);
    return { rows: [], headers, excluded: [], errors, warnings, copies: 0 };
  }
  if (records.length === 0) {
    errors.push('The file has no rows.');
  }

  const excludedCounts = new Map<string, number>();
  const identityById = new Map<string, { title: string; label: string }>();
  const blankIdLines: number[] = [];
  const conflicting = new Set<string>();
  const badNumbers: number[] = [];
  const badDates: number[] = [];
  const badQuantity: number[] = [];
  const rows: CollectionRow[] = [];

  records.forEach((r, index) => {
    const line = rowNumbers[index] ?? index + 2;
    const consoleLabel = (r['console-name'] ?? '').trim();
    if (excludedSet.has(consoleLabel.toLowerCase())) {
      excludedCounts.set(consoleLabel, (excludedCounts.get(consoleLabel) ?? 0) + 1);
      return;
    }
    const productId = (r['id'] ?? '').trim();
    const title = (r['product-name'] ?? '').trim();
    if (!productId) {
      blankIdLines.push(line);
      return;
    }
    const known = identityById.get(productId);
    if (known && (known.title !== title || known.label !== consoleLabel)) conflicting.add(productId);
    else if (!known) identityById.set(productId, { title, label: consoleLabel });

    let valueCents = toCents(r['price-in-pennies'] ?? '');
    let costCents = toCents(r['cost-basis-in-pennies'] ?? '');
    if (Number.isNaN(valueCents) || Number.isNaN(costCents)) {
      badNumbers.push(line);
      if (Number.isNaN(valueCents)) valueCents = null;
      if (Number.isNaN(costCents)) costCents = null;
    }
    const qtyText = (r['quantity'] ?? '').trim();
    let quantity = qtyText === '' ? 1 : Number(qtyText);
    if (!Number.isInteger(quantity) || quantity < 1) {
      badQuantity.push(line);
      quantity = 1;
    }
    const dateEntered = toDate(r['date-entered'] ?? '');
    const datePurchased = toDate(r['date-purchased'] ?? '');
    if (dateEntered === undefined || datePurchased === undefined) badDates.push(line);

    const includeString = (r['include-string'] ?? '').trim();
    const inc = classifyIncludes(includeString);
    rows.push({
      productId,
      title,
      consoleLabel,
      valueCents,
      includeString,
      conditionString: (r['condition-string'] ?? '').trim(),
      completeness: inc.completeness,
      sealed: inc.sealed,
      hasBox: inc.hasBox,
      hasManual: inc.hasManual,
      sku: (r['sku'] ?? '').trim(),
      notes: (r['notes'] ?? '').trim(),
      costCents,
      quantity,
      dateEntered: dateEntered ?? null,
      datePurchased: datePurchased ?? null,
      gradingCompany: (r['grading-company'] ?? '').trim(),
      gradingCertId: (r['grading-cert-id'] ?? '').trim(),
      folder: (r['folder'] ?? '').trim(),
      line,
    });
  });

  const lines = (list: number[]) => list.slice(0, 10).join(', ') + (list.length > 10 ? ` and ${list.length - 10} more` : '');
  if (blankIdLines.length > 0) errors.push(`Rows without a PriceCharting id on line(s) ${lines(blankIdLines)}.`);
  if (conflicting.size > 0) {
    errors.push(`The same id is used for different games or consoles: ${[...conflicting].slice(0, 10).join(', ')}.`);
  }
  if (badNumbers.length > 0) warnings.push(`Prices that aren't whole cents were left empty on line(s) ${lines(badNumbers)}.`);
  if (badQuantity.length > 0) warnings.push(`Quantities that aren't whole numbers were read as 1 on line(s) ${lines(badQuantity)}.`);
  if (badDates.length > 0) warnings.push(`Dates that couldn't be read were left empty on line(s) ${lines(badDates)}.`);
  if (overlong.length > 0) {
    warnings.push(
      `Line(s) ${lines(overlong)} have more values than the file has columns (probably a comma outside quotes), so some of their values may be in the wrong columns.`,
    );
  }

  return {
    rows,
    headers,
    excluded: [...excludedCounts].map(([label, count]) => ({ label, rows: count })),
    errors,
    warnings,
    copies: rows.reduce((sum, row) => sum + row.quantity, 0),
  };
}

/** A product whose number of copies changed between two collection updates. */
export interface ProductChange {
  productId: string;
  title: string;
  consoleLabel: string;
  before: number;
  after: number;
}

/** What changed between two collection updates. */
export interface CollectionDiff {
  /** Products owned now that weren't before. */
  added: ProductChange[];
  /** Products no longer owned at all. */
  removed: ProductChange[];
  /** Products still owned with a different number of copies. */
  quantityChanged: ProductChange[];
  copiesBefore: number;
  copiesAfter: number;
}

type ProductLike = Pick<CollectionRow, 'productId' | 'title' | 'consoleLabel' | 'quantity'>;

function countCopies(rows: ProductLike[]) {
  const map = new Map<string, { title: string; consoleLabel: string; copies: number }>();
  for (const r of rows) {
    const entry = map.get(r.productId);
    if (entry) entry.copies += r.quantity;
    else map.set(r.productId, { title: r.title, consoleLabel: r.consoleLabel, copies: r.quantity });
  }
  return map;
}

/** Compares two collection snapshots product by product. */
export function diffCollections(before: ProductLike[], after: ProductLike[]): CollectionDiff {
  const a = countCopies(before);
  const b = countCopies(after);
  const added: ProductChange[] = [];
  const removed: ProductChange[] = [];
  const quantityChanged: ProductChange[] = [];
  for (const [productId, now] of b) {
    const was = a.get(productId);
    if (!was) added.push({ productId, title: now.title, consoleLabel: now.consoleLabel, before: 0, after: now.copies });
    else if (was.copies !== now.copies) {
      quantityChanged.push({ productId, title: now.title, consoleLabel: now.consoleLabel, before: was.copies, after: now.copies });
    }
  }
  for (const [productId, was] of a) {
    if (!b.has(productId)) removed.push({ productId, title: was.title, consoleLabel: was.consoleLabel, before: was.copies, after: 0 });
  }
  const byTitle = (x: ProductChange, y: ProductChange) => x.title.localeCompare(y.title);
  return {
    added: added.sort(byTitle),
    removed: removed.sort(byTitle),
    quantityChanged: quantityChanged.sort(byTitle),
    copiesBefore: [...a.values()].reduce((s, v) => s + v.copies, 0),
    copiesAfter: [...b.values()].reduce((s, v) => s + v.copies, 0),
  };
}

/** Share of previously owned products an import would remove, from 0 to 100. */
export function removalPercent(diff: CollectionDiff, productsBefore: number): number {
  if (productsBefore === 0) return 0;
  return (diff.removed.length / productsBefore) * 100;
}

/** Matches a file name against a simple pattern where * means anything (case-insensitive). */
export function matchesFilePattern(fileName: string, pattern: string): boolean {
  // Several patterns can be given, separated by ";" (or ",").
  return pattern
    .split(/[;,]/)
    .map((p) => p.trim())
    .filter(Boolean)
    .some((p) => {
      const escaped = p
        .split('*')
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*');
      return new RegExp(`^${escaped}$`, 'i').test(fileName);
    });
}
