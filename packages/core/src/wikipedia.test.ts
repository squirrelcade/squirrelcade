import { describe, expect, it } from 'vitest';
import { downloadCategories, releasedIn, sectionKind, wikiDate, wikiGames, wikipediaPages, wikiTables } from './wikipedia.js';

/** Shaped like "List of PlayStation 3 games": a key table, then two header rows (the region names in the second). */
const PS3 = `
<table class="wikitable"><tbody>
<tr><th colspan="3">Key</th></tr>
<tr><td>3D Stereoscopic 3-D</td><td>M PlayStation Move optional</td><td>D Digital only games</td></tr>
</tbody></table>
<table class="wikitable sortable plainrowheaders"><tbody>
<tr><th rowspan="2">Title</th><th rowspan="2">Developer(s)</th><th colspan="3">Release date</th><th rowspan="2">Options</th><th rowspan="2">Ref.</th></tr>
<tr><th>JP</th><th>PAL</th><th>NA</th></tr>
<tr><th scope="row"><i><a href="/wiki/A">Afrika</a></i><sup class="reference">[1]</sup></th><td rowspan="2">Rhino Studios</td>
  <td><span data-sort-value="2008-08-28" style="display:none">000000002008-08-28-0000</span>August 28, 2008</td><td>Unreleased</td><td>June 9, 2009</td><td>M</td><td><sup>[2]</sup></td></tr>
<tr><th scope="row"><i>Only In Japan</i></th><td>March 1, 2010</td><td>Unreleased</td><td>Unreleased</td><td></td><td></td></tr>
<tr><th colspan="7">B</th></tr>
<tr><th scope="row"><i>Bejeweled&#160;2 &amp; Friends</i></th><td>PopCap</td><td>Unreleased</td><td>2008</td><td>December 11, 2008</td><td>D</td><td></td></tr>
</tbody></table>
<table class="navbox"><tr><td><table class="wikitable"><tr><th>Title</th><th>NA</th></tr><tr><td>Nested</td><td>2001</td></tr></table></td></tr></table>
`;

/**
 * Shaped like "List of Xbox 360 games": a key of badge marks (download titles among them, none called
 * download-only), an Addons column that uses them, and title cells linking to articles.
 */
const badge = (code: string) => `<span style="background:#fc8; font-size:10px; margin:1px; padding:2px;">&#160;${code}&#160;</span>`;
const X360 = `
<table class="wikitable" style="float: left;"><tbody><tr>
<td>${badge('K')} Kinect optional ${badge('K')} required</td>
<td>${badge('DL')} Downloadable titles</td>
<td>${badge('XBLIG')} Xbox Live Indie Games</td>
<td>${badge('XBLA')} Xbox Live Arcade titles</td>
<td>${badge('XBO')} Xbox One forward compatible</td>
</tr></tbody></table>
<table class="wikitable sortable" id="softwarelist"><tbody>
<tr><th rowspan="2">Title</th><th rowspan="2">Developer(s)</th><th colspan="2">Release date</th><th rowspan="2">Addons</th><th rowspan="2">Xbox One</th></tr>
<tr><th><abbr title="North America">NA</abbr></th><th><abbr title="Europe">EU</abbr></th></tr>
<tr><td><i><a href="/wiki/1942:_Joint_Strike" title="1942: Joint Strike">1942: Joint Strike</a></i></td><td>Backbone</td><td>Jul 23, 2008</td><td>Unreleased</td><td>${badge('XBLA')}</td><td>${badge('XBO')}</td></tr>
<tr><td><i><a href="/wiki/Halo_3" title="Halo 3">Halo 3</a></i><sup class="reference"><a href="#cite_note-1">[1]</a></sup></td><td>Bungie</td><td>Sep 25, 2007</td><td>Sep 26, 2007</td><td></td><td>${badge('XBO')}</td></tr>
<tr><td><i>Indie Thing</i></td><td>Someone</td><td>2011</td><td>2011</td><td>${badge('XBLIG')}</td><td></td></tr>
<tr><td><i><a href="/wiki/Kinect_Adventures!">Kinect Adventures!</a></i></td><td>Good Science</td><td>Nov 4, 2010</td><td>Nov 10, 2010</td><td>${badge('K')}</td><td></td></tr>
<tr><td><i><a href="/wiki/11eyes:_Tsumi_to_Batsu_to_Aganai_no_Sh%C5%8Djo">11eyes CrossOver</a></i></td><td>Lass</td><td>Unreleased</td><td>Unreleased</td><td></td><td></td></tr>
<tr><td><i><a href="/wiki/.hack//The_Movie#Versus">.hack//Versus</a></i></td><td>CyberConnect2</td><td>2012</td><td>2012</td><td>${badge('DL')}</td><td></td></tr>
<tr><td><i><a href="/w/index.php?title=Missing_Game&amp;action=edit&amp;redlink=1" class="new">Missing Game</a></i></td><td>Nobody</td><td>2010</td><td>2010</td><td></td><td></td></tr>
</tbody></table>
`;

/** Shaped like "List of Nintendo Entertainment System games": several names in one title cell, then other sections. */
const NES = `
<div class="mw-heading mw-heading2"><h2 id="Licensed_games">Licensed games</h2><span class="mw-editsection">[edit]</span></div>
<table class="wikitable sortable">
<tr><th rowspan="2">Title(s)</th><th rowspan="2">Developer(s)</th><th rowspan="2">Publisher(s)</th><th colspan="3">Release date</th></tr>
<tr><th>JP<br></th><th>NA<br></th><th>PAL<br></th></tr>
<tr><td><i>The 3-D Battles of WorldRunner</i><br><i>Tobidase Daisakusen</i> (JP)</td><td>Square</td><td>Acclaim</td><td>March 12, 1987</td><td>September 1987</td><td>Unreleased</td></tr>
<tr><td><i>Abadox: The Deadly Inner War</i>†</td><td>Natsume</td><td>Milton Bradley</td><td>Unreleased</td><td>1990</td><td>—</td></tr>
</table>
<h2><span class="mw-headline">Unlicensed games</span><span class="mw-editsection">[edit]</span></h2>
<h3>Famicom games</h3>
<table class="wikitable"><tr><th>Title</th><th>Year</th><th>Country</th></tr>
<tr><td>Du Ma Racing</td><td>1991</td><td>Taiwan</td></tr>
<tr><td>Somewhere Else</td><td>1992</td><td>North America, Europe</td></tr></table>
`;

/**
 * Shaped like the "Magnavox Odyssey" article, since the console has no list page: an infobox, then a
 * "Games" section whose table has the titles as row headers and a "US version" and an "International
 * version" column that say how each game was sold.
 */
const na = '<td data-sort-value="" class="table-na"><span aria-hidden="true">—</span><span class="sr-only">N/a</span></td>';
const ODYSSEY = `
<table class="infobox hproduct vevent"><caption class="infobox-title">Magnavox Odyssey</caption><tbody>
<tr><th scope="row" class="infobox-label">Manufacturer</th><td class="infobox-data">Magnavox</td></tr>
</tbody></table>
<div class="mw-heading mw-heading2"><h2 id="Legacy">Legacy</h2></div>
<div class="mw-heading mw-heading3"><h3 id="Lawsuits">Lawsuits</h3></div>
<div class="mw-heading mw-heading2"><h2 id="Games">Games</h2><span class="mw-editsection">[<a href="/w/index.php?title=Magnavox_Odyssey&amp;action=edit&amp;section=6">edit</a>]</span></div>
<p>The games came on game cards, most with screen overlays.</p>
<table class="wikitable sortable">
<caption><style>.mw-parser-output .sr-only{position:absolute}</style><span class="sr-only">Games</span></caption>
<tbody><tr><th scope="col">Title<sup class="reference"><a href="#cite_note-4">[4]</a></sup></th><th scope="col">Game card</th><th scope="col" class="unsortable">Description</th><th scope="col">US version</th><th scope="col">International version</th></tr>
<tr><th scope="row"><i>Table Tennis</i></th><td>1</td><td>Paddles and a ball, without an overlay</td><td>Included with console</td><td>Included with console</td></tr>
<tr><th scope="row"><i>Fun Zoo</i></th><td>2</td><td>A race to the animals on a zoo overlay</td><td>Sold separately</td>${na}</tr>
<tr><th scope="row"><i>Soccer</i></th><td>3</td><td>Paddles and a ball on a soccer overlay</td>${na}<td>Included with console</td></tr>
<tr><th scope="row"><i>Shooting Gallery</i></th><td>10</td><td>Shooting at targets with the light gun</td><td>Sold with light gun</td><td>Sold with light gun</td></tr>
</tbody></table>
`;

describe('Wikipedia game lists', () => {
  it('reads the wikitables of a page, filling rowspans and colspans in', () => {
    const tables = wikiTables(PS3);
    expect(tables).toHaveLength(2);
    const main = tables[1]!.rows;
    expect(main[0]!.map((c) => c.text)).toEqual(['Title', 'Developer(s)', 'Release date', 'Release date', 'Release date', 'Options', 'Ref.']);
    expect(main[1]!.map((c) => c.text)).toEqual(['Title', 'Developer(s)', 'JP', 'PAL', 'NA', 'Options', 'Ref.']);
    // The developer spans two rows; the footnote mark and the hidden sort key are dropped.
    expect(main[2]!.map((c) => c.text)).toEqual(['Afrika', 'Rhino Studios', 'August 28, 2008', 'Unreleased', 'June 9, 2009', 'M', '']);
    expect(main[3]![1]!.text).toBe('Rhino Studios');
  });

  it('finds the games, their regions and the download-only ones', () => {
    const games = wikiGames(PS3);
    expect(games.map((g) => g.titles[0])).toEqual(['Afrika', 'Only In Japan', 'Bejeweled 2 & Friends']);
    const [afrika, japanOnly, bejeweled] = games;
    expect(afrika).toMatchObject({ regional: true, digitalOnly: false, developer: 'Rhino Studios' });
    expect(afrika!.releases).toEqual({ japan: 'August 28, 2008', europe: 'Unreleased', 'north-america': 'June 9, 2009' });
    expect(releasedIn(afrika!, 'north-america')).toBe(true);
    expect(releasedIn(afrika!, 'europe')).toBe(false);
    expect(releasedIn(japanOnly!, 'north-america')).toBe(false);
    expect(bejeweled).toMatchObject({ digitalOnly: true });
    expect(bejeweled!.download).toBeUndefined();
    expect(afrika!.article).toBe('A');
  });

  it('reads the marks of download titles, which the key doesn\'t call download-only', () => {
    const games = wikiGames(X360);
    const by = Object.fromEntries(games.map((g) => [g.titles[0], g]));
    expect(by['1942: Joint Strike']).toMatchObject({ digitalOnly: false, download: 'Xbox Live Arcade titles', article: '1942: Joint Strike' });
    expect(by['Indie Thing']).toMatchObject({ digitalOnly: false, download: 'Xbox Live Indie Games' });
    expect(by['.hack//Versus']!.download).toBe('Downloadable titles');
    // The Kinect mark and the Xbox One column's marks aren't about downloads.
    expect(by['Halo 3']!.download).toBeUndefined();
    expect(by['Kinect Adventures!']!.download).toBeUndefined();
    expect(games.every((g) => !g.digitalOnly)).toBe(true);
  });

  it('keeps the article each title links to', () => {
    const by = Object.fromEntries(wikiGames(X360).map((g) => [g.titles[0], g.article]));
    expect(by['Halo 3']).toBe('Halo 3');
    expect(by['Kinect Adventures!']).toBe('Kinect Adventures!');
    expect(by['11eyes CrossOver']).toBe('11eyes: Tsumi to Batsu to Aganai no Shōjo');
    // No link, a link to a section of another article, and a missing page: no article.
    expect(by['Indie Thing']).toBeUndefined();
    expect(by['.hack//Versus']).toBeUndefined();
    expect(by['Missing Game']).toBeUndefined();
  });

  it('keeps every name in a title cell and drops region notes and marks', () => {
    const games = wikiGames(NES);
    expect(games[0]).toMatchObject({ titles: ['The 3-D Battles of WorldRunner', 'Tobidase Daisakusen'], developer: 'Square', publisher: 'Acclaim' });
    expect(releasedIn(games[0]!, 'north-america')).toBe(true);
    expect(releasedIn(games[0]!, 'europe')).toBe(false);
    expect(games[1]!.titles).toEqual(['Abadox: The Deadly Inner War']);
    expect(wikiGames('<table class="wikitable"><tr><th>Title</th></tr><tr><td>Elnard<br>•The 7th Saga</td></tr></table>')[0]!.titles).toEqual(['Elnard', 'The 7th Saga']);
    expect(releasedIn(games[1]!, 'europe')).toBe(false);
    // A game with an article only on the Japanese Wikipedia is followed by a link to it, shown only on screen.
    const ill = '<i><a href="/w/index.php?title=Battle_Commander&action=edit&redlink=1" class="new">Battle Commander: Hachibushuu Shura no Heihou</a><span class="noprint" style="font-size:85%;">&#160;&#91;<a href="https://ja.wikipedia.org/wiki/X" class="extiw" title="ja:X">ja</a>&#93;</span></i>';
    expect(wikiGames(`<table class="wikitable"><tr><th>Title</th></tr><tr><td>${ill}</td></tr></table>`)[0]!.titles).toEqual(['Battle Commander: Hachibushuu Shura no Heihou']);
  });

  it('knows the section each table sits in, and reads regions written as a list', () => {
    const games = wikiGames(NES);
    expect(games.map((g) => g.section)).toEqual(['Licensed games', 'Licensed games', 'Unlicensed games > Famicom games', 'Unlicensed games > Famicom games']);
    expect(releasedIn(games[2]!, 'north-america')).toBe(false);
    expect(games[3]!.releases).toEqual({ 'north-america': 'Released', europe: 'Released' });
    expect(sectionKind('Licensed games')).toBe('retail');
    expect(sectionKind('Unlicensed games > NES\'s lifespan')).toBe('unlicensed');
    expect(sectionKind('Unreleased games')).toBe('skip');
    expect(sectionKind('Applications')).toBe('skip');
    expect(sectionKind('List of Off-TV Play compatible games')).toBe('skip');
    expect(sectionKind('Championship games')).toBe('special');
    expect(sectionKind('')).toBe('retail');
  });

  it('reads regions marked with checkmarks instead of dates', () => {
    const yes = '<td data-sort-value="Yes" class="table-yes2"><span title="Yes"><img alt="Yes" src="check.svg" width="13"></span></td>';
    const no = '<td data-sort-value="No" class="table-no2"><img alt="No" src="x.svg"></td>';
    const html = `<table class="wikitable"><tr><th>Title</th><th>First released</th><th>JP</th><th>EU/PAL</th><th>NA</th></tr>
      <tr><td>Both Sides</td><td>2005-11-23<sup>JP</sup></td>${yes}${no}${yes}</tr>
      <tr><td>Japan Only</td><td>2006</td>${yes}<td data-sort-value="No"></td><td>?</td></tr></table>`;
    const [both, japan] = wikiGames(html);
    expect(both!.releases).toEqual({ japan: 'Yes', europe: 'No', 'north-america': 'Yes' });
    expect(releasedIn(both!, 'north-america')).toBe(true);
    expect(releasedIn(both!, 'europe')).toBe(false);
    expect(releasedIn(japan!, 'north-america')).toBe(false);
    expect(releasedIn(japan!, 'europe')).toBe(false);
  });

  it('treats a table without region columns as released everywhere', () => {
    const html = '<table class="wikitable"><tr><th>Title</th><th>Release date</th></tr><tr><td>Plain Game</td><td>2012</td></tr></table>';
    const [game] = wikiGames(html);
    expect(game).toMatchObject({ titles: ['Plain Game'], regional: false });
    expect(releasedIn(game!, 'japan')).toBe(true);
  });

  it('reads the games table of the Magnavox Odyssey article, which stands in for a list page', () => {
    expect(wikipediaPages([])['magnavox-odyssey']).toEqual(['Magnavox Odyssey']);
    const games = wikiGames(ODYSSEY);
    // Neither the infobox nor the table's caption becomes a game.
    expect(games.map((g) => g.titles)).toEqual([['Table Tennis'], ['Fun Zoo'], ['Soccer'], ['Shooting Gallery']]);
    expect(games.every((g) => g.section === 'Games' && !g.digitalOnly)).toBe(true);
    expect(sectionKind('Games')).toBe('retail');
    // "US version" and "International version" aren't region columns, so every game counts in every home region.
    expect(games.every((g) => !g.regional && releasedIn(g, 'north-america') && releasedIn(g, 'europe'))).toBe(true);
  });

  it('reads release dates', () => {
    expect(wikiDate('November 17, 2006')).toBe('2006-11-17');
    expect(wikiDate('17 November 2006')).toBe('2006-11-17');
    expect(wikiDate('September 1987')).toBe('1987-09');
    expect(wikiDate('1990')).toBe('1990');
    expect(wikiDate('Unreleased')).toBeNull();
    expect(wikiDate(undefined)).toBeNull();
  });

  it('uses built-in page names unless the user names others', () => {
    const pages = wikipediaPages(['playstation-3: List of PS3 retail games; List of more PS3 games', 'broken line', 'my-console: My Page']);
    expect(pages['playstation-3']).toEqual(['List of PS3 retail games', 'List of more PS3 games']);
    expect(pages['wii-u']).toEqual(['List of Wii U games']);
    expect(pages['my-console']).toEqual(['My Page']);
  });

  it('reads the download categories setting', () => {
    expect(downloadCategories(['playstation-3: PlayStation Network games', 'Xbox-360: Category:Xbox 360 Live Arcade games; Xbox_Live_Arcade_games; ', 'no console here'])).toEqual({
      'playstation-3': ['PlayStation Network games'],
      'xbox-360': ['Xbox 360 Live Arcade games', 'Xbox Live Arcade games'],
    });
  });
});
