import { describe, expect, it } from 'vitest';
import { hardwareKind } from './hardware.js';

describe('hardware from PriceCharting names (T-217)', () => {
  it('knows consoles, controllers and accessories by their names', () => {
    for (const t of ['Nintendo 64 Console', 'Magnavox Odyssey Console', 'Super Famicom Console', 'Nintendo Switch 2 Console', 'Odyssey 2 System', 'Nintendo 64 Console Jungle Green', 'PlayStation 2 Slim Console', 'Xbox 360 S Console 250GB', 'Nintendo Switch OLED Console White']) {
      expect([t, hardwareKind(t)]).toEqual([t, 'console']);
    }
    for (const t of ['Nintendo 64 Controller', 'DualShock 4 Controller Black', 'Joy-Con Pair Neon', 'Pro Controller']) expect([t, hardwareKind(t)]).toEqual([t, 'controller']);
    for (const t of ['Memory Card 8MB', 'Controller Pak', 'Rumble Pak', 'Expansion Pak', 'AC Adapter', 'Zapper', 'Game Boy Player']) expect([t, hardwareKind(t)]).toEqual([t, 'accessory']);
  });

  it('leaves games with those words in their names alone', () => {
    for (const t of ['System Shock', 'System Shock 2', 'Catan: Console Edition', 'Super Mario 64', 'Controller Shock Edition Game', 'Jet Set Radio Future', 'Star Wars: Rogue Squadron', 'Console Wars', 'Ratchet & Clank', 'The Legend of Zelda']) {
      expect([t, hardwareKind(t)]).toEqual([t, null]);
    }
  });
});
