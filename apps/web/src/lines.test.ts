import { describe, expect, it } from 'vitest';
import { isBarcode, parseLine } from './lines';

describe('parseLine', () => {
  it('reads the console a line names, in brackets or after a dash', () => {
    expect(parseLine('Chrono Trigger (SNES)')).toMatchObject({ title: 'Chrono Trigger', platformKey: 'super-nintendo' });
    expect(parseLine('Chrono Trigger [Super Nintendo]')).toMatchObject({ title: 'Chrono Trigger', platformKey: 'super-nintendo' });
    expect(parseLine('Okami - Wii')).toMatchObject({ title: 'Okami', platformKey: 'wii' });
    expect(parseLine('  Metroid Prime – Nintendo GameCube  ')).toMatchObject({ title: 'Metroid Prime', platformKey: 'nintendo-gamecube' });
  });

  it('keeps the whole line as the title when what follows is not a console', () => {
    expect(parseLine('Final Fantasy VII (Greatest Hits)')).toEqual({ text: 'Final Fantasy VII (Greatest Hits)', title: 'Final Fantasy VII (Greatest Hits)', platformKey: null });
    expect(parseLine('Spider-Man 2')).toMatchObject({ title: 'Spider-Man 2', platformKey: null });
    expect(parseLine('Halo 3')).toMatchObject({ title: 'Halo 3', platformKey: null });
  });

  it('takes a line of digits as a barcode', () => {
    expect(parseLine('0 12345-67890 5')).toMatchObject({ barcode: '012345678905', platformKey: null });
    expect(parseLine('1942')).not.toHaveProperty('barcode');
  });
});

describe('isBarcode', () => {
  it('tells barcodes from titles', () => {
    expect(isBarcode('012345678905')).toBe(true);
    expect(isBarcode('4 902370 517316')).toBe(true);
    expect(isBarcode('Super Mario 64')).toBe(false);
    expect(isBarcode('2064')).toBe(false);
  });
});
