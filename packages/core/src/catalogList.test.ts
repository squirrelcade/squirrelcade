import { describe, expect, it } from 'vitest';
import { listDownloadUrl, listPlatform, listRows, parseCatalogList, parseOwnershipMappings, readSourceList, summarizeSourceList } from './catalogList.js';
import { KNOWN_PLATFORMS } from './platforms.js';

describe('console lists from CSV', () => {
  it('reads titles with their other columns, whatever their order and names', () => {
    const csv = [
      'Canonical Title,Platform,Region,Target Status,Physical Format,Release Date,Also known as',
      '"Zelda Link\'s Awakening",Nintendo Switch,US/Canada,Current,Game Card,2019-09-20,The Legend of Zelda: Link\'s Awakening',
      'Odd Import,Nintendo Switch,Japan / import,Review,Game Card,,',
      'Next Year,Nintendo Switch,North America,Upcoming,,,',
      'Store Demo,Nintendo Switch,,Not required,,,',
      '"Tetris 99",Nintendo Switch,,Soon,,"February 13, 2019",',
      '"Zelda Link\'s Awakening",Nintendo Switch,US/Canada,Current,,,',
    ].join('\n');
    const { entries, problems } = parseCatalogList(csv);
    expect(entries).toEqual([
      { title: "Zelda Link's Awakening", altTitles: ["The Legend of Zelda: Link's Awakening"], releaseDate: '2019-09-20', region: 'north-america', targetStatus: 'required', format: 'Game Card' },
      { title: 'Odd Import', region: 'japan', targetStatus: 'review', format: 'Game Card' },
      { title: 'Next Year', region: 'north-america', targetStatus: 'required' },
      { title: 'Store Demo', targetStatus: 'excluded' },
      { title: 'Tetris 99', releaseDate: '2019-02-13' },
    ]);
    expect(problems).toEqual(["1 status value(s) weren't recognized; those games count as required."]);
  });

  it('needs a title column', () => {
    expect(parseCatalogList('Name of thing,Year\n').problems).toEqual(['No title column: the first row needs a column named Title (or Game, or Name).']);
    expect(parseCatalogList('Game\n\n').problems).toEqual(['The list has no games under its title column.']);
    expect(parseCatalogList('Game\nPikmin 4\n').entries).toEqual([{ title: 'Pikmin 4' }]);
    // A Master Catalog tab of the old workbook, downloaded as CSV, works as it is.
    const tab = 'Canonical Title,Target Status,Source Titles,Source Rows\nOwlboy,Current,Owlboy | Owlboy Limited Edition,4\n';
    expect(parseCatalogList(tab).entries).toEqual([{ title: 'Owlboy', altTitles: ['Owlboy Limited Edition'], targetStatus: 'required' }]);
  });
});

describe('ownership mappings from CSV', () => {
  it("reads the old workbook's Ownership Mappings tabs", () => {
    const csv = [
      'Owned Physical Title,Satisfies Canonical Title,Mapping Type,Counts as Complete,Review Status,Notes',
      "Uncharted & Uncharted 2 Dual Pack,Uncharted: Drake's Fortune,Compilation,Yes,Ready,",
      'Uncharted & Uncharted 2 Dual Pack,Uncharted 2: Among Thieves,Compilation,Yes,Ready,',
      'Far Cry Compilation,Far Cry 3: Blood Dragon,Conditional compilation,Conditional,Ready,Only when on disc',
      'Uncharted & Uncharted 2 Dual Pack,Uncharted 2: Among Thieves,Compilation,Yes,Ready,',
    ].join('\n');
    const { mappings, problems } = parseOwnershipMappings(csv);
    expect(problems).toEqual([]);
    expect(mappings).toEqual([
      { ownedTitle: 'Uncharted & Uncharted 2 Dual Pack', satisfies: "Uncharted: Drake's Fortune", type: 'Compilation', counts: 'yes' },
      { ownedTitle: 'Uncharted & Uncharted 2 Dual Pack', satisfies: 'Uncharted 2: Among Thieves', type: 'Compilation', counts: 'yes' },
      { ownedTitle: 'Far Cry Compilation', satisfies: 'Far Cry 3: Blood Dragon', type: 'Conditional compilation', counts: 'conditional', notes: 'Only when on disc' },
    ]);
    // Short column names work too; a console list isn't a mappings file.
    expect(parseOwnershipMappings('Owned,Counts as\nSBK: Superbike World Championship,Superbike World Championship SBK').mappings).toHaveLength(1);
    expect(parseOwnershipMappings('Canonical Title,Target Status\nFlower,Required').mappings).toEqual([]);
  });
});

describe('which console a list is for', () => {
  const platforms = KNOWN_PLATFORMS;
  it('reads the Platform column, then the file name', () => {
    expect(listPlatform('Master Catalog.csv', 'Canonical Title,Platform\nHalo 3,Xbox 360\nFable II,Xbox 360\n', platforms)).toBe('xbox-360');
    expect(listPlatform('a.csv', 'Title,Platform\nF-Zero,Super Nintendo / Super Famicom\n', platforms)).toBe('super-nintendo');
    expect(listPlatform('PS3 Master Catalog.csv', 'Canonical Title\nHeavy Rain\n', platforms)).toBe('playstation-3');
    expect(listPlatform('Nintendo Switch 2 games.csv', 'Game\nMario Kart World\n', platforms)).toBe('nintendo-switch-2');
    expect(listPlatform('Wii U.csv', 'Game\nPikmin 3\n', platforms)).toBe('wii-u');
    expect(listPlatform('Odyssey 2 games.csv', 'Game\nK.C. Munchkin!\n', platforms)).toBe('magnavox-odyssey-2');
    expect(listPlatform('my list.csv', 'Game\nPikmin 3\n', platforms)).toBeNull();
  });
});

describe('list release dates', () => {
  it('keeps dates and "TBA", not other text a Release column may hold', () => {
    const { entries } = parseCatalogList('Title,Release\nA,2026-10-01\nB,TBA\nC,Game Cartridge');
    expect(entries.map((e) => e.releaseDate ?? null)).toEqual(['2026-10-01', 'TBA', null]);
  });
});

describe('lists added as catalog sources', () => {
  it("spreads a list's games over its consoles by its Platform column, and says which consoles it doesn't know", () => {
    const rows = listRows(['Title;Platform;Region;Release Date', 'Dorfromantik;Switch;PAL;2023-04-27', 'Unrailed;Nintendo Switch;Europe;', 'Haiku the Robot;PS4;PAL;2022-12-01', 'Odd One;Sega Pico;PAL;', 'No Console;;PAL;'].join('\n'));
    expect(rows?.from).toBe('csv');
    const list = readSourceList(rows!.rows, KNOWN_PLATFORMS, null);
    expect(list.games['nintendo-switch']?.map((e) => e.title)).toEqual(['Dorfromantik', 'Unrailed']);
    expect(list.games['playstation-4']).toEqual([{ title: 'Haiku the Robot', region: 'europe', releaseDate: '2022-12-01' }]);
    expect(list.unknown).toEqual([
      { name: 'Sega Pico', games: 1 },
      { name: '(no console)', games: 1 },
    ]);
    expect(list.consoleColumn).toBe(true);
    expect(list.columns).toEqual(['Title', 'Platform', 'Region', 'Release Date']);
    expect(summarizeSourceList(list.games)).toEqual({
      games: 3,
      consoles: [
        { key: 'nintendo-switch', games: 2 },
        { key: 'playstation-4', games: 1 },
      ],
      regions: { europe: 3 },
      years: { from: 2022, to: 2023 },
    });
  });

  it('puts a list without a console column on the console chosen, and asks for one until then', () => {
    const rows = listRows('Game,Status\nShovel Knight,Required\nShovel Knight,Required\n')!.rows;
    expect(readSourceList(rows, KNOWN_PLATFORMS, 'nintendo-switch').games).toEqual({ 'nintendo-switch': [{ title: 'Shovel Knight', targetStatus: 'required' }] });
    const unsure = readSourceList(rows, KNOWN_PLATFORMS, null);
    expect(unsure.games).toEqual({});
    expect(unsure.problems).toEqual(['It has no console column (Platform, Console or System): choose the console it is for.']);
    expect(readSourceList([['Year'], ['2020']], KNOWN_PLATFORMS, null).problems).toEqual(['No title column: the list needs a column named Title (or Game, or Name).']);
  });

  it("reads a web page's tables that have a title column, joining those split by letter", () => {
    const page = `<html><head><title>Physical releases</title></head><body>
      <table class="nav"><tr><td>Home</td><td>About</td></tr></table>
      <h2>A</h2><table><tr><th>Name</th><th>Console</th></tr><tr><td>Absolum</td><td>Nintendo Switch</td></tr></table>
      <h2>B</h2><table><tr><th>Name</th><th>Console</th></tr><tr><td><a href="/b">Blasphemous</a></td><td>PS4</td></tr></table>
      </body></html>`;
    const rows = listRows(page, 'text/html; charset=utf-8');
    expect(rows).toEqual({ from: 'page', rows: [['Name', 'Console'], ['Absolum', 'Nintendo Switch'], ['Blasphemous', 'PS4']] });
    expect(listRows('<html><body><p>No list here</p></body></html>')).toBeNull();
  });

  it("takes a table's console from the heading over it, as on a page with a table for each console", () => {
    const table = (rows: string) => `<table class="wikitable"><tr><th>Release No.</th><th>Date released</th><th>Game title</th></tr>${rows}</table>`;
    const page = `<h2>Releases</h2><h3>Nintendo Switch</h3>${table('<tr><td>#1</td><td>8 March 2018</td><td>Human: Fall Flat</td></tr><tr><td>#2</td><td>2 May 2018</td><td>Dust</td></tr>')}<h3>PlayStation 5</h3>${table('<tr><td>#1</td><td>22 June 2023</td><td>Source of Madness</td></tr>')}`;
    const list = readSourceList(listRows(page, 'text/html', KNOWN_PLATFORMS)!.rows, KNOWN_PLATFORMS, null);
    expect(list.games).toEqual({
      'nintendo-switch': [
        { title: 'Human: Fall Flat', releaseDate: '2018-03-08' },
        { title: 'Dust', releaseDate: '2018-05-02' },
      ],
      'playstation-5': [{ title: 'Source of Madness', releaseDate: '2023-06-22' }],
    });
    expect(list.columns).toEqual(['Date released', 'Game title', 'Platform']);
  });

  it('makes a row for each console a cell names on its lines, each with its own date', () => {
    const rows = [
      ['Title', 'Limited run #', 'Developer(s)', 'Standard edition release date(s)'],
      ['2064: Read Only Memories', '105 (PS4)\n161 (Vita)\n054 (Switch)', 'MidBoss', 'November 17, 2017 (PS4)\nJune 29, 2018 (Vita)\nNovember 29, 2019 (Switch)'],
      ['Shovel Knight', '001 (PS4)', 'Yacht Club', 'March 1, 2016'],
    ];
    const list = readSourceList(rows, KNOWN_PLATFORMS, null);
    expect(list.games).toEqual({
      'playstation-4': [
        { title: '2064: Read Only Memories', releaseDate: '2017-11-17' },
        { title: 'Shovel Knight', releaseDate: '2016-03-01' },
      ],
      'playstation-vita': [{ title: '2064: Read Only Memories', releaseDate: '2018-06-29' }],
      'nintendo-switch': [{ title: '2064: Read Only Memories', releaseDate: '2019-11-29' }],
    });
    expect(list.consoleColumn).toBe(true);
  });

  it("downloads a Google sheet as its CSV, and any other address as given", () => {
    expect(listDownloadUrl('https://docs.google.com/spreadsheets/d/abc_DEF-123/edit?gid=42#gid=42')).toBe('https://docs.google.com/spreadsheets/d/abc_DEF-123/export?format=csv&gid=42');
    expect(listDownloadUrl('https://docs.google.com/spreadsheets/d/abc/edit')).toBe('https://docs.google.com/spreadsheets/d/abc/export?format=csv');
    expect(listDownloadUrl('https://docs.google.com/spreadsheets/d/e/2PACX-x/pubhtml?gid=0&single=true')).toBe('https://docs.google.com/spreadsheets/d/e/2PACX-x/pub?gid=0&single=true&output=csv');
    expect(listDownloadUrl('https://example.com/games.csv')).toBe('https://example.com/games.csv');
  });
});
