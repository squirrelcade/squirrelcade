import { deflateRawSync, inflateRawSync } from 'node:zlib';

/** A zip file that can't be read, with a message to show the user. */
export class ZipError extends Error {}

/** Unpacked files are capped, so a damaged or hostile archive can't fill the memory. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** A file in a zip archive; read() unpacks it. */
export interface ZipEntry {
  name: string;
  read: () => Buffer;
}

/** Whether data starts like a zip archive. */
export const isZip = (data: Buffer) => data.length >= 4 && data.readUInt32LE(0) === 0x04034b50;

/**
 * The files in a zip archive, from its central directory. Handles the stored and deflated files
 * that zip tools and PriceCharting's collection.zip use; not encrypted or split archives.
 */
export function readZip(data: Buffer): ZipEntry[] {
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 65_535); i--) {
    if (data.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new ZipError("The zip file is damaged: its table of contents wasn't found.");
  const count = data.readUInt16LE(end + 10);
  let at = data.readUInt32LE(end + 16);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (at + 46 > data.length || data.readUInt32LE(at) !== 0x02014b50) throw new ZipError('The zip file is damaged.');
    const flags = data.readUInt16LE(at + 8);
    const method = data.readUInt16LE(at + 10);
    const packedSize = data.readUInt32LE(at + 20);
    const size = data.readUInt32LE(at + 24);
    const nameLength = data.readUInt16LE(at + 28);
    const local = data.readUInt32LE(at + 42);
    const name = data.toString('utf8', at + 46, at + 46 + nameLength);
    at += 46 + nameLength + data.readUInt16LE(at + 30) + data.readUInt16LE(at + 32);
    entries.push({
      name,
      read: () => {
        if (flags & 1) throw new ZipError(`${name} in the zip file is encrypted.`);
        if (size > MAX_FILE_BYTES) throw new ZipError(`${name} in the zip file is too large.`);
        if (local + 30 > data.length || data.readUInt32LE(local) !== 0x04034b50) throw new ZipError('The zip file is damaged.');
        const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
        const packed = data.subarray(start, start + packedSize);
        if (method === 0) return Buffer.from(packed);
        if (method === 8) return inflateRawSync(packed, { maxOutputLength: MAX_FILE_BYTES });
        throw new ZipError(`${name} in the zip file uses a compression Squirrelcade can't read (method ${method}).`);
      },
    });
  }
  return entries;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip archive of the files given, each deflated (a spreadsheet workbook is one). Files and the archive stay under 4 GB. */
export function writeZip(files: { name: string; data: Buffer }[], at = new Date()): Buffer {
  // MS-DOS time and date, which zip keeps.
  const time = (at.getHours() << 11) | (at.getMinutes() << 5) | Math.floor(at.getSeconds() / 2);
  const date = ((Math.max(at.getFullYear(), 1980) - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate();
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const packed = deflateRawSync(file.data);
    const crc = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // names are UTF-8
    local.writeUInt16LE(8, 8); // deflated
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, packed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4); // made by
    entry.writeUInt16LE(20, 6); // needed
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(time, 12);
    entry.writeUInt16LE(date, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(file.data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += 30 + name.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/**
 * A collection export as uploaded or dropped: a CSV as it is, or the CSV inside a zip (PriceCharting
 * sends collection.zip), named after the file inside so the history shows the export's own name.
 */
export function unpackExport(fileName: string, data: Buffer): { fileName: string; data: Buffer } {
  if (!isZip(data)) return { fileName, data };
  const csvs = readZip(data).filter((e) => /\.csv$/i.test(e.name) && !e.name.startsWith('__MACOSX/'));
  if (csvs.length === 0) throw new ZipError(`${fileName} has no CSV file in it.`);
  if (csvs.length > 1) throw new ZipError(`${fileName} has ${csvs.length} CSV files in it; upload the one to use.`);
  const entry = csvs[0]!;
  return { fileName: entry.name.split('/').pop() || fileName, data: entry.read() };
}
