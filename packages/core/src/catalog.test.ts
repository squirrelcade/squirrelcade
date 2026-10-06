import { describe, expect, it } from 'vitest';
import { baseTitle, editionBase, isGameKeyCard, isUpcoming, matchCatalog, similarityReason, type CatalogTarget, type OwnedProduct } from './catalog.js';
import { matchKey } from './text.js';

let nextId = 1;
const target = (title: string, status: CatalogTarget['status'] = 'required'): CatalogTarget => ({ id: nextId++, title, status });
const owned = (productId: string, title: string, copies = 1): OwnedProduct => ({ productId, title, copies });

describe('baseTitle', () => {
  it('drops PriceCharting edition brackets', () => {
    expect(baseTitle('Uncharted [Greatest Hits]')).toBe('Uncharted');
    expect(baseTitle('Halo 3 [Limited Edition] [Platinum Hits]')).toBe('Halo 3');
    expect(baseTitle('Tetris')).toBe('Tetris');
  });
});

describe('similarityReason', () => {
  it('flags the alias cases that caused duplicate purchases', () => {
    expect(similarityReason('Cars 2: The Video Game', 'Cars 2')).not.toBeNull();
    expect(similarityReason('Beijing 2008', 'Beijing Olympics 2008')).not.toBeNull();
    // EndWar and H.A.W.X are now the same title outright (matchKey), not look-alikes.
    expect(matchKey("Tom Clancy's EndWar")).toBe(matchKey('End War'));
    expect(matchKey("Tom Clancy's H.A.W.X 2")).toBe(matchKey('HAWX 2'));
    expect(similarityReason('Rise of the Argonauts', 'Rise Of Argonauts')).not.toBeNull();
  });

  it('asks about Japanese titles romanized differently', () => {
    expect(similarityReason('Jikkyou Powerful Pro Yakyuu 3', 'Jikkyō Powerful Pro Yakyū 3')).toBe('The same title, romanized differently');
    // PriceCharting leaves the subtitle out and writes the long vowels out.
    expect(similarityReason('Super Kokou Yakyuu', 'Super Kōkō Yakyū: Ichikyuu Jikkon')).toBe('One title contains the other (romanized differently)');
    expect(similarityReason('Jikkyou Powerful Pro Yakyuu 2', 'Jikkyō Powerful Pro Yakyū 3')).toBeNull();
  });

  it('keeps different games apart', () => {
    expect(similarityReason('Doom', 'Doom 3')).toBeNull();
    expect(similarityReason('Cars 2', 'Cars 3: Driven to Win')).toBeNull();
    expect(similarityReason('Ico', 'Iconoclasts')).toBeNull();
    expect(similarityReason('Halo', 'Halo')).toBeNull();
    expect(similarityReason('Tomb Raider II', 'Tomb Raider [Black Label]')).toBeNull();
    expect(similarityReason('Monstrum', 'Ys IX: Monstrum NOX [Pact Edition]')).toBeNull();
    expect(similarityReason('Moon', 'Moonstone Island')).toBeNull();
  });
});

describe('matchCatalog', () => {
  it('matches exact titles and edition variants, and counts completion', () => {
    const t = [target('Uncharted'), target('Journey'), target('Flower'), target('Kiosk Demo Disc', 'excluded')];
    const result = matchCatalog(t, [owned('1', 'Uncharted [Greatest Hits]'), owned('2', 'journey')]);
    expect(result.targets.map((r) => r.status)).toEqual(['owned', 'owned', 'missing', 'excluded']);
    expect(result.targets[0]!.matches[0]!.method).toBe('variant');
    expect(result.counts).toEqual({ targets: 4, owned: 2, missing: 1, review: 0, excluded: 1, unconfirmed: 0, upcoming: 0, extra: 0 });
    expect(result.percent).toBeCloseTo(66.7, 1);
  });

  it("keeps a copy to its own catalog game: other games' alternative names don't claim it too", () => {
    // IGDB gives Donkey Kong Country the Japanese name, and Pokémon Stadium the name of its Japanese sequel.
    const t = [
      { ...target('Donkey Kong Country'), altTitles: ['Super Donkey Kong'] },
      target('Super Donkey Kong'),
      { ...target('Pokemon Stadium'), altTitles: ['Pokemon Stadium 2'] },
      target('Pokemon Stadium 2'),
      { ...target('Mega Man X2'), altTitles: ['Rockman X2'] },
    ];
    const result = matchCatalog(t, [owned('1', 'Super Donkey Kong'), owned('2', 'Pokemon Stadium 2'), owned('3', 'Rockman X2 [Japan]')]);
    expect(result.targets.map((r) => [r.target.title, r.status])).toEqual([
      ['Donkey Kong Country', 'missing'],
      ['Super Donkey Kong', 'owned'],
      ['Pokemon Stadium', 'missing'],
      ['Pokemon Stadium 2', 'owned'],
      // No catalog game of its own: the Japanese copy still counts as its North American game.
      ['Mega Man X2', 'owned'],
    ]);
  });

  it('lists unconfirmed games without counting them, unless owned', () => {
    const t = [target('Owned Download Game', 'unconfirmed'), target('Unowned Download Game', 'unconfirmed'), target('Retail Game'), target('Owned Retail')];
    const result = matchCatalog(t, [owned('1', 'Owned Download Game'), owned('2', 'Owned Retail')]);
    expect(result.targets.map((r) => r.status)).toEqual(['owned', 'unconfirmed', 'missing', 'owned']);
    expect(result.counts).toEqual({ targets: 4, owned: 2, missing: 1, review: 0, excluded: 0, unconfirmed: 1, upcoming: 0, extra: 0 });
    // The unconfirmed game is left out of the share: 2 owned of 3 that count.
    expect(result.percent).toBeCloseTo(66.7, 1);
  });

  it('matches any of a game\'s other names', () => {
    const t = [
      { ...target('The 3-D Battles of WorldRunner'), altTitles: ['3D WorldRunner', 'Tobidase Daisakusen'] },
      { ...target('Elnard'), altTitles: ['The 7th Saga'] },
      target('Abadox: The Deadly Inner War'),
    ];
    const result = matchCatalog(t, [owned('1', '3D WorldRunner'), owned('2', 'The 7th Saga [Player\'s Choice]'), owned('3', 'Abadox')]);
    // Both through the games' other names.
    expect(result.targets.map((r) => [r.status, r.matches[0]?.method])).toEqual([
      ['owned', 'alias'],
      ['owned', 'alias'],
      ['review', undefined],
    ]);
    expect(result.targets[2]!.suggestions).toEqual([expect.objectContaining({ productId: '3', title: 'Abadox' })]);
  });

  it('lets reviewed mappings satisfy compilations and aliases', () => {
    const t = [target('Mass Effect'), target('Mass Effect 2'), target('Far Cry 3: Blood Dragon')];
    const result = matchCatalog(
      t,
      [owned('10', 'Mass Effect Trilogy'), owned('11', 'Far Cry Compilation')],
      [
        { ownedTitle: 'Mass Effect Trilogy', satisfies: 'Mass Effect', counts: 'yes' },
        { ownedTitle: 'Mass Effect Trilogy', satisfies: 'Mass Effect 2', counts: 'yes' },
        { ownedTitle: 'Far Cry Compilation', satisfies: 'Far Cry 3: Blood Dragon', counts: 'conditional' },
      ],
    );
    expect(result.targets.map((r) => r.status)).toEqual(['owned', 'owned', 'review']);
    expect(result.targets[0]!.matches[0]).toMatchObject({ productId: '10', method: 'mapping' });
  });

  it('suggests look-alikes for review instead of calling them missing', () => {
    const t = [target('Cars 2: The Video Game'), target('Contra')];
    const result = matchCatalog(t, [owned('31515', 'Cars 2')]);
    expect(result.targets[0]).toMatchObject({ status: 'review', suggestions: [{ productId: '31515', title: 'Cars 2' }] });
    expect(result.targets[1]!.status).toBe('missing');
    expect(result.unmatched.map((p) => p.productId)).toEqual(['31515']);
  });

  it('does not suggest a generic owned title for many games', () => {
    const cards = ['Air Hockey E-Reader', 'Balloon Fight E-Reader', 'Baseball E-Reader', 'Donkey Kong E-Reader', 'Excitebike E-Reader', 'Golf E-Reader'].map((t) => target(t));
    const result = matchCatalog([...cards, target('Cars 2: The Video Game')], [owned('1', 'E-Reader'), owned('2', 'Cars 2')]);
    expect(result.targets.slice(0, 6).every((r) => r.status === 'missing' && r.suggestions.length === 0)).toBe(true);
    expect(result.targets[6]).toMatchObject({ status: 'review', suggestions: [{ productId: '2' }] });
  });

  it('remembers confirmed and rejected suggestions', () => {
    const cars = target('Cars 2: The Video Game');
    const confirmed = matchCatalog([cars], [owned('31515', 'Cars 2')], [], [{ targetId: cars.id, productId: '31515', decision: 'confirmed' }]);
    expect(confirmed.targets[0]).toMatchObject({ status: 'owned', matches: [{ method: 'confirmed' }] });
    expect(confirmed.unmatched).toEqual([]);
    const rejected = matchCatalog([cars], [owned('31515', 'Cars 2')], [], [{ targetId: cars.id, productId: '31515', decision: 'rejected' }]);
    expect(rejected.targets[0]).toMatchObject({ status: 'missing', suggestions: [] });
  });

  it('can be told that edition variants do not count', () => {
    const result = matchCatalog([target('Halo 3')], [owned('5', 'Halo 3 [Limited Edition]')], [], [], { variantsSatisfy: false, suggest: false });
    expect(result.targets[0]!.status).toBe('missing');
  });

  it('leaves ignored products out of the unmatched list and the suggestions', () => {
    const t = [target('Cars 2: The Video Game'), target('Demo Disc Volume 1')];
    const products = [owned('31515', 'Cars 2'), owned('900', 'Demo Disc Volume 1'), owned('901', 'Bundle Pack')];
    const result = matchCatalog(t, products, [], [], { ignored: new Set(['31515', '900', '901']) });
    expect(result.unmatched).toEqual([]);
    expect(result.targets[0]).toMatchObject({ status: 'missing', suggestions: [] });
    // An ignored product still counts when its title is a catalog game.
    expect(result.targets[1]!.status).toBe('owned');
  });

  it('counts editions both ways', () => {
    const t = [target('Just Dance 2016: Gold Edition'), target('Just Dance 2017 Gold Edition'), target('Deadly Premonition'), target('Just Dance 2018')];
    const result = matchCatalog(t, [owned('1', 'Just Dance 2016'), owned('2', 'Just Dance 2017'), owned('3', "Deadly Premonition: Director's Cut")]);
    expect(result.targets.map((r) => r.status)).toEqual(['owned', 'owned', 'owned', 'missing']);
    expect(result.targets[0]!.matches).toEqual([{ productId: '1', title: 'Just Dance 2016', method: 'variant' }]);
    const strict = matchCatalog(t, [owned('1', 'Just Dance 2016')], [], [], { variantsSatisfy: false, suggest: false });
    expect(strict.targets[0]!.status).toBe('missing');
  });

  it("counts a collector's edition as every edition of its game, unless editions are off", () => {
    const t = [target('Dredge'), target('Dredge: Deluxe Edition'), target('Dredge 2')];
    const result = matchCatalog(t, [owned('1', "Dredge: Collector's Edition")]);
    expect(result.targets.map((r) => r.status)).toEqual(['owned', 'owned', 'missing']);
    expect(result.targets[1]!.matches).toEqual([{ productId: '1', title: "Dredge: Collector's Edition", method: 'variant' }]);
    const strict = matchCatalog(t, [owned('1', "Dredge: Collector's Edition")], [], [], { variantsSatisfy: false, suggest: false });
    expect(strict.targets.map((r) => r.status)).toEqual(['missing', 'missing', 'missing']);
  });

  it('lets the user overrule an edition match', () => {
    const fireFades = target('Dark Souls III: The Fire Fades Edition');
    const result = matchCatalog([fireFades], [owned('9', 'Dark Souls III [Day One Edition]')], [], [{ targetId: fireFades.id, productId: '9', decision: 'rejected' }]);
    expect(result.targets[0]).toMatchObject({ status: 'missing', matches: [], rejected: [{ productId: '9', title: 'Dark Souls III [Day One Edition]' }] });
  });

  it('counts a game marked as just bought as owned', () => {
    const t = target('Okami');
    const result = matchCatalog([t], [], [], [], { pending: [{ targetId: t.id, id: 3, title: 'Okami' }] });
    expect(result.targets[0]).toMatchObject({ status: 'owned', matches: [{ productId: 'pending:3', title: 'Okami', method: 'pending' }] });
    expect(result.unmatched).toEqual([]);
  });

  it('matches Japanese titles romanized differently on catalogs of Japanese titles, and only suggests them elsewhere', () => {
    const t = [target('Jikkyō Powerful Pro Yakyū 3'), target('Nintama Rantarou'), target('Nintama Rantaro')];
    const o = [owned('p1', 'Jikkyou Powerful Pro Yakyuu 3'), owned('p2', 'Nintama Rantaro')];
    const japanese = matchCatalog(t, o, [], [], { romaji: true });
    expect(japanese.targets[0]).toMatchObject({ status: 'owned', matches: [{ productId: 'p1', method: 'spelling' }] });
    // A copy whose own title is a catalog game belongs to that one.
    expect(japanese.targets[1]!.status).toBe('missing');
    expect(japanese.targets[2]).toMatchObject({ status: 'owned', matches: [{ productId: 'p2', method: 'exact' }] });
    const elsewhere = matchCatalog(t.slice(0, 1), o.slice(0, 1));
    expect(elsewhere.targets[0]).toMatchObject({ status: 'review', suggestions: [{ productId: 'p1', reason: 'The same title, romanized differently' }] });
    // "Not the same game" overrules a spelling match.
    const said = matchCatalog(t.slice(0, 1), o.slice(0, 1), [], [{ targetId: t[0]!.id, productId: 'p1', decision: 'rejected' }], { romaji: true });
    expect(said.targets[0]!.status).toBe('missing');
  });

  it('can count a title without its subtitle as the one catalog game it starts, when the setting says so', () => {
    const t = [
      target('Doraemon 2: Nobita no Toys Land Daibouken'),
      target('UFO Kamen Yakisoban: Kettler no Kuroi Inbō'),
      target('UFO Kamen Yakisoban: Kettler no Kuroi Inbō - Keihin Ban'),
      target('Pachinko Fan: Shouri Sengen 2'),
      target('Torneko no Daibōken: Fushigi no Dungeon'),
      target('Overcooked: All You Can Eat'),
    ];
    const o = [owned('p1', 'Doraemon 2'), owned('p2', 'UFO Kamen Yakisoban'), owned('p3', 'Pachinko Fan'), owned('p4', 'Torneko no Daiboken'), owned('p5', 'Overcooked [Special Edition]')];
    // Off (the default), they're review questions.
    expect(matchCatalog(t, o).targets[0]!.status).toBe('review');
    const on = matchCatalog(t, o, [], [], { shortTitles: true, romaji: true });
    expect(on.targets[0]).toMatchObject({ status: 'owned', matches: [{ productId: 'p1', method: 'short' }] });
    // Two catalog games start the same way: still a question. Numbers must agree ("2" only in the subtitle).
    expect(on.targets[1]!.status).not.toBe('owned');
    expect(on.targets[3]!.status).not.toBe('owned');
    // Long vowels fold on a Japanese catalog.
    expect(on.targets[4]).toMatchObject({ status: 'owned', matches: [{ productId: 'p4', method: 'short' }] });
    // A copy with an edition in brackets is a product of its own: its whole title has to be the start.
    expect(on.targets[5]!.status).not.toBe('owned');
    // "Not the same game" overrules it.
    const said = matchCatalog(t, o, [], [{ targetId: t[0]!.id, productId: 'p1', decision: 'rejected' }], { shortTitles: true });
    expect(said.targets[0]!.status).not.toBe('owned');
  });

  it('keeps review targets in review until something owned matches', () => {
    const result = matchCatalog([target('Odd Release', 'review')], [], [], [], {});
    expect(result.targets[0]!.status).toBe('review');
  });
});

describe('editionBase', () => {
  it('finds the game an edition belongs to', () => {
    expect(editionBase('Just Dance 2016: Gold Edition')).toBe('Just Dance 2016');
    expect(editionBase('Just Dance 2017 Gold Edition')).toBe('Just Dance 2017');
    expect(editionBase("Deadly Premonition: Director's Cut")).toBe('Deadly Premonition');
    expect(editionBase('Marvel Spiderman 2 [Launch Edition]')).toBe('Marvel Spiderman 2');
    expect(editionBase('Xenoblade Chronicles: Definitive Edition')).toBe('Xenoblade Chronicles');
    expect(editionBase("Assassin's Creed IV Black Flag - Skull Edition")).toBe("Assassin's Creed IV Black Flag");
  });

  it('leaves other titles alone', () => {
    for (const t of ['Final Fantasy XII: The Zodiac Age', 'Edition', 'The Edition Game', 'Resident Evil 4', 'Street Fighter 30th Anniversary Collection']) {
      expect(editionBase(t)).toBe(t);
    }
  });
});

describe('isUpcoming and isGameKeyCard', () => {
  it('knows the games not out yet, counting a partial date from its first day', () => {
    const today = '2026-09-27';
    expect(isUpcoming('2026-09-28', today)).toBe(true);
    expect(isUpcoming('2026-12', today)).toBe(true);
    expect(isUpcoming('2027', today)).toBe(true);
    expect(isUpcoming('TBA', today)).toBe(true);
    expect(isUpcoming('2026-09-27', today)).toBe(false);
    expect(isUpcoming('2026-09', today)).toBe(false);
    expect(isUpcoming('2026', today)).toBe(false);
    expect(isUpcoming(null, today)).toBe(false);
    expect(isUpcoming('Game Cartridge', today)).toBe(false);
  });

  it('knows a Game-Key Card by its format', () => {
    expect(isGameKeyCard('Game-Key Card')).toBe(true);
    expect(isGameKeyCard('game key card')).toBe(true);
    expect(isGameKeyCard('Full Game Card')).toBe(false);
    expect(isGameKeyCard(null)).toBe(false);
  });

  it('leaves upcoming games out of completion', () => {
    const t: CatalogTarget[] = [
      { id: 1, title: 'Out Now', status: 'required' },
      { id: 2, title: 'Coming Soon', status: 'upcoming' },
    ];
    const result = matchCatalog(t, [{ productId: '1', title: 'Out Now', copies: 1 }]);
    expect(result.targets.map((r) => r.status)).toEqual(['owned', 'upcoming']);
    expect(result.counts).toMatchObject({ upcoming: 1, missing: 0 });
    expect(result.percent).toBe(100);
  });
});

describe('games that count once owned (other regions, on a console that is not region-locked)', () => {
  it('counts one owned as owned, and leaves one not owned out of missing and of the percentage', () => {
    const result = matchCatalog([target('PAL Only Game', 'extra'), target('Owned PAL Game', 'extra'), target('A Normal Game')], [owned('p1', 'Owned PAL Game')]);
    expect(result.targets.map((t) => [t.target.title, t.status])).toEqual([
      ['PAL Only Game', 'extra'],
      ['Owned PAL Game', 'owned'],
      ['A Normal Game', 'missing'],
    ]);
    expect(result.counts).toMatchObject({ owned: 1, missing: 1, extra: 1 });
    expect(result.percent).toBe(50);
  });
});

describe("another region's entry for a game the catalog already has", () => {
  it("leaves the copy with the catalog's own game", () => {
    const result = matchCatalog([target('Sonic Frontiers'), target('Sonic Frontiers [Day One Edition]', 'extra')], [owned('p1', 'Sonic Frontiers [Day One Edition]')]);
    expect(result.targets.map((x) => [x.target.title, x.status])).toEqual([
      ['Sonic Frontiers', 'owned'],
      ['Sonic Frontiers [Day One Edition]', 'extra'],
    ]);
    expect(result.counts).toMatchObject({ owned: 1, missing: 0, extra: 1 });
  });
});
