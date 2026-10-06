import { writeZip } from './zip.js';

/** A cell: text, a number, an amount of money in cents (shown with two decimals), or empty. */
export type Cell = string | number | null | undefined | { cents: number | null };

/** A sheet of a workbook: its tab's name, a header row and the rows under it. */
export interface Sheet {
  name: string;
  header: string[];
  rows: Cell[][];
  /** Column widths in characters; worked out from the contents when left out. */
  widths?: number[];
}

/** Excel's limit on a cell's text. */
const CELL_MAX = 32_767;

/** Text as XML, without the characters XML can't hold. */
const xml = (text: string) =>
  text
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** A column's letters (0 is A, 26 is AA). */
export function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** A tab's name as Excel allows it: at most 31 characters, none of []:*?/\, and not repeated. */
function tabNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((raw) => {
    const base = raw.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet';
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 28)} ${i}`;
    used.add(name.toLowerCase());
    return name;
  });
}

/** Each filter's hidden name for the range it filters, which Excel keeps beside a sheet's filter. */
function filterNames(sheets: Sheet[], names: string[]): string {
  const defined = sheets
    .map((s, i) =>
      s.rows.length === 0
        ? ''
        : `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xml(names[i]!.replace(/'/g, "''"))}'!$A$1:$${columnName(columnsOf(s) - 1)}$${s.rows.length + 1}</definedName>`,
    )
    .join('');
  return defined ? `<definedNames>${defined}</definedNames>` : '';
}

// Styles: 0 plain, 1 bold (the header row), 2 money with two decimals.
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function cellXml(ref: string, cell: Cell, style = 0): string {
  if (cell === null || cell === undefined || cell === '') return '';
  const s = style ? ` s="${style}"` : '';
  if (typeof cell === 'number') return Number.isFinite(cell) ? `<c r="${ref}"${s}><v>${cell}</v></c>` : '';
  if (typeof cell === 'object') return cell.cents === null ? '' : `<c r="${ref}" s="2"><v>${cell.cents / 100}</v></c>`;
  const text = cell.length > CELL_MAX ? cell.slice(0, CELL_MAX) : cell;
  return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
}

/** How many columns a sheet has (counted without spreading its rows, which can be many). */
const columnsOf = (sheet: Sheet) => sheet.rows.reduce((n, r) => Math.max(n, r.length), Math.max(sheet.header.length, 1));

const width = (cell: Cell) => (cell === null || cell === undefined ? 0 : typeof cell === 'object' ? 10 : String(cell).length);

function sheetXml(sheet: Sheet): string {
  const columns = columnsOf(sheet);
  const sample = sheet.rows.slice(0, 2000);
  const widths = sheet.widths ?? Array.from({ length: columns }, (_, i) => Math.min(60, sample.reduce((w, r) => Math.max(w, width(r[i]) + 1), Math.max(8, width(sheet.header[i]) + 2))));
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const rows = [sheet.header as Cell[], ...sheet.rows].map((row, r) => {
    const cells = row.map((cell, c) => cellXml(`${columnName(c)}${r + 1}`, cell, r === 0 ? 1 : 0)).join('');
    return `<row r="${r + 1}">${cells}</row>`;
  });
  const last = `${columnName(columns - 1)}${sheet.rows.length + 1}`;
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    // The header row stays at the top while scrolling, and each column can be filtered.
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${cols}</cols><sheetData>${rows.join('')}</sheetData>` +
    (sheet.rows.length > 0 ? `<autoFilter ref="A1:${last}"/>` : '') +
    '</worksheet>'
  );
}

/**
 * An Excel workbook (.xlsx) of the sheets given, one tab each, which Excel, Google Sheets, Numbers and LibreOffice
 * open: text as text, money as numbers with two decimals, the header row bold and kept in view.
 */
export function buildWorkbook(sheets: Sheet[], at = new Date()): Buffer {
  const list = sheets.length > 0 ? sheets : [{ name: 'Sheet', header: [], rows: [] }];
  const names = tabNames(list.map((s) => s.name));
  const files = [
    {
      name: '[Content_Types].xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
        list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
        '</Relationships>',
    },
    {
      name: 'docProps/core.xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        `<dc:title>Squirrelcade</dc:title><dc:creator>Squirrelcade</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${at.toISOString().replace(/\.\d{3}Z$/, 'Z')}</dcterms:created>` +
        '</cp:coreProperties>',
    },
    {
      name: 'xl/workbook.xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        names.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        '</sheets>' +
        filterNames(list, names) +
        '</workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        '</Relationships>',
    },
    { name: 'xl/styles.xml', data: STYLES },
    ...list.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ];
  return writeZip(
    files.map((f) => ({ name: f.name, data: Buffer.from(f.data, 'utf8') })),
    at,
  );
}
