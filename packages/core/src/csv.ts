/**
 * The separator a CSV file uses: a comma, or a semicolon or a tab when its first line has more of those outside
 * quotes (spreadsheets in countries that write decimal commas, CLZ's exports).
 */
export function csvDelimiter(text: string): ',' | ';' | '\t' {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const c of first) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === ',' || c === ';' || c === '\t')) counts[c]++;
  }
  if (counts[';'] > counts[','] && counts[';'] >= counts['\t']) return ';';
  if (counts['\t'] > counts[',']) return '\t';
  return ',';
}

/** Minimal RFC 4180 CSV parser: quoted fields, escaped quotes, CRLF or LF, optional BOM; commas unless told otherwise. */
export function parseCsv(text: string, delimiter: ',' | ';' | '\t' = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  for (; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Parses CSV text with a header row into records keyed by header name (its separator found). Blank lines are skipped. */
export function parseCsvRecords(text: string): {
  headers: string[];
  records: Record<string, string>[];
  /** The row number in the file of each record (the header is row 1; blank rows count). */
  rowNumbers: number[];
  /** Rows with more values than there are headers: usually a comma outside quotes. */
  overlong: number[];
} {
  const rows = parseCsv(text, csvDelimiter(text))
    .map((cells, i) => ({ cells, row: i + 1 }))
    .filter(({ cells }) => !(cells.length === 1 && cells[0] === ''));
  const headers = (rows[0]?.cells ?? []).map((h) => h.trim());
  const body = rows.slice(1);
  const records = body.map(({ cells }) => {
    const record: Record<string, string> = {};
    headers.forEach((h, idx) => {
      record[h] = cells[idx] ?? '';
    });
    return record;
  });
  const overlong = body.filter(({ cells }) => cells.length > headers.length).map(({ row }) => row);
  return { headers, records, rowNumbers: body.map(({ row }) => row), overlong };
}

/**
 * Writes rows as CSV for spreadsheets: fields quoted when needed, CRLF line
 * ends, and a byte-order mark so Excel reads accents and Japanese titles.
 * Text that a spreadsheet would run as a formula (=, +, -, @) gets a leading
 * apostrophe; numbers are written as they are.
 */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return String(v);
    const text = /^[=+\-@]/.test(v) ? `'${v}` : v;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `\uFEFF${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}
