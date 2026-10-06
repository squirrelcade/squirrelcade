// Fails when a tracked text file has Windows (CRLF) line endings. Files are stored
// byte-for-byte (see .gitattributes), so everything should be written with LF.
// Run with --fix to convert the files in place.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const fix = process.argv.includes('--fix');
const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', windowsHide: true })
  .split('\0')
  .filter(Boolean);
const bad = [];
for (const file of files) {
  let data;
  try {
    data = readFileSync(file);
  } catch {
    continue; // deleted in the working tree
  }
  if (data.includes(0) || !data.includes('\r\n')) continue; // binary, or already LF
  bad.push(file);
  if (fix) writeFileSync(file, data.toString('utf8').replace(/\r\n/g, '\n'));
}
if (bad.length > 0 && !fix) {
  console.error(`These files have CRLF line endings (run "npm run fix:eol"):\n${bad.map((f) => `  ${f}`).join('\n')}`);
  process.exit(1);
}
if (fix && bad.length > 0) console.log(`Converted ${bad.length} file(s) to LF.`);
