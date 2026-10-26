import { describe, expect, it } from 'vitest';
import { isAccessory, isConsoleHardware, isDigitalCode } from './purchaseKind.js';

describe("what an item bought is (D184)", () => {
  it('knows a digital code from a disc', () => {
    expect(isDigitalCode('Minecraft - Nintendo Switch [Digital Code]')).toBe(true);
    expect(isDigitalCode('Hades - Nintendo Switch Online Game Code')).toBe(true);
    expect(isDigitalCode('Celeste - Digital')).toBe(true);
    expect(isDigitalCode('Some Game', 'Amazon Digital Services LLC')).toBe(true);
    expect(isDigitalCode('Digital Devil Saga - PlayStation 2')).toBe(false);
    expect(isDigitalCode('Okami - PlayStation 2')).toBe(false);
  });

  it('knows accessories and consoles from games', () => {
    expect(isAccessory('Nintendo Switch 2 Pro Controller')).toBe(true);
    expect(isAccessory('8BitDo Ultimate Bluetooth Controller')).toBe(true);
    expect(isAccessory('Mario plush set')).toBe(true);
    expect(isAccessory('Okami - PlayStation 2')).toBe(false);
    expect(isAccessory('The Legend of Zelda: Ocarina of Time - Nintendo Switch 2')).toBe(false);
    expect(isConsoleHardware('PlayStation 2 Slim Console')).toBe(true);
    expect(isConsoleHardware('Nintendo Switch OLED Model w/ White Joy-Con')).toBe(true);
    expect(isConsoleHardware('Stranger of Paradise: Final Fantasy Origin - PlayStation 5')).toBe(false);
  });
});
