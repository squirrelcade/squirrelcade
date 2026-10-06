// The made-up collection of the demo install and the guide's screenshots (never anyone's own): well-known games,
// with made-up conditions, values and prices paid, as a PriceCharting collection export.

export const GAMES = {
  'Super Nintendo': [
    'Super Mario World', 'Zelda Link to the Past', 'Super Metroid', 'Donkey Kong Country', 'Super Mario Kart', 'Chrono Trigger',
    'Final Fantasy III', 'Earthbound', 'Mega Man X', 'F-Zero', 'Star Fox', 'Super Castlevania IV', 'Kirby Super Star',
    'Super Mario World 2 Yoshi\'s Island', 'Secret of Mana', 'Contra III The Alien Wars', 'Super Punch-Out', 'Pilotwings',
    'Street Fighter II Turbo', 'Donkey Kong Country 2',
  ],
  'Nintendo 64': [
    'Super Mario 64', 'Mario Kart 64', '007 GoldenEye', 'Zelda Ocarina of Time', 'Star Fox 64', 'Banjo-Kazooie', 'Paper Mario',
    'Super Smash Bros', 'Donkey Kong 64', 'Diddy Kong Racing', 'Wave Race 64', 'F-Zero X', 'Pokemon Stadium', 'Perfect Dark',
    'Kirby 64 The Crystal Shards', 'Yoshi\'s Story', 'Mario Party', 'Mario Tennis',
  ],
  'Playstation 3': [
    'Uncharted 2 Among Thieves', 'The Last of Us', 'Demon\'s Souls', 'LittleBigPlanet', 'Metal Gear Solid 4 Guns of the Patriots',
    'Red Dead Redemption', 'God of War III', 'Ratchet & Clank Future A Crack in Time', 'Infamous', 'Heavy Rain', 'Batman Arkham City',
    'Portal 2', 'Elder Scrolls V Skyrim', 'Grand Theft Auto IV', 'Bioshock', 'Mass Effect 2', 'Persona 5', 'Ni no Kuni Wrath of the White Witch',
  ],
  'Nintendo Switch': [
    'Zelda Breath of the Wild', 'Super Mario Odyssey', 'Mario Kart 8 Deluxe', 'Animal Crossing New Horizons', 'Super Smash Bros Ultimate',
    'Splatoon 2', 'Metroid Dread', 'Xenoblade Chronicles 2', 'Fire Emblem Three Houses', 'Luigi\'s Mansion 3', 'Pokemon Sword',
    'Hades', 'Hollow Knight', 'Kirby and the Forgotten Land', 'Astral Chain', 'Octopath Traveler', 'Bayonetta 2',
    'Super Mario 3D World + Bowser\'s Fury', 'Pikmin 4',
  ],
};
export const CONDITIONS = ['Item, Box, and Manual', 'Item Only', 'Item and Box', 'New', 'Item, Box, and Manual'];

/** The collection as PriceCharting's export CSV. */
export function exportCsv() {
  const header = 'id,product-name,console-name,price-in-pennies,include-string,condition-string,sku,notes,cost-basis-in-pennies,quantity,date-entered,date-purchased,grading-company,grading-cert-id,folder';
  const rows = [];
  let id = 1;
  for (const [console, titles] of Object.entries(GAMES)) {
    for (const [i, title] of titles.entries()) {
      const value = 1500 + ((i * 1237 + console.length * 311) % 9000);
      const paid = Math.round(value * (0.5 + ((i * 7) % 5) / 10));
      const month = String(1 + ((i + console.length) % 12)).padStart(2, '0');
      rows.push(`${id++},"${title.replace(/"/g, '""')}",${console},${value},"${CONDITIONS[i % CONDITIONS.length]}",,,,${paid},1,2025-${month}-15,2025-${month}-14,,,`);
    }
  }
  return [header, ...rows].join('\n');
}
