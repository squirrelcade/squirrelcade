import { describe, expect, it } from 'vitest';
import { parseSetCsv, platformsIn, setKey, setPlatform, wikiPageTitle, wikiSetGames } from './sets.js';

/** Shaped like "List of Limited Run Games releases": a platform summary, then the games with their consoles in the "Limited run #" column. */
const LRG = `
<table class="wikitable sortable"><tbody>
<tr><th>Platform</th><th>Limited run #</th><th>Dates released</th></tr>
<tr><td><a href="/wiki/PlayStation_Vita">PlayStation Vita</a></td><td>001–015</td><td>October 28, 2015 – July 30, 2021</td></tr>
</tbody></table>
<table class="wikitable sortable"><tbody>
<tr><th>Title</th><th>Limited run #</th><th>Developer(s)</th><th>Genre(s)</th><th>Standard edition release date(s)</th><th>Ref</th></tr>
<tr><td><i><a href="/wiki/2064:_Read_Only_Memories">2064: Read Only Memories</a></i></td><td>105 (PS4)<br>161 (Vita)<p>054 (Switch)</p></td><td>MidBoss</td><td>Graphic adventure</td><td>November 17, 2017 (PS4)</td><td><sup>[1]</sup></td></tr>
<tr><td><i>8bit Music Power</i></td><td>Distro (NES)</td><td>RIKI</td><td>Music</td><td>March 19, 2021</td><td></td></tr>
<tr><td><i><a href="/wiki/A-Train_Express">A-Train Express</a></i></td><td>264 (PSVR)</td><td>Artdink</td><td>Simulation</td><td>May 22, 2019</td><td></td></tr>
<tr><td><i>Catlateral Damage: Remeowstered</i></td><td>Distro (Switch, PS4, PS 5)</td><td>Manekoware</td><td></td><td>May 10, 2022</td><td></td></tr>
<tr><td><i>Some PC Game</i></td><td>Distro (PC)</td><td>Someone</td><td>Puzzle</td><td>2020</td><td></td></tr>
</tbody></table>
`;

describe('set platforms', () => {
  it('knows consoles by their names and short names', () => {
    expect(setPlatform('PS4')).toBe('playstation-4');
    expect(setPlatform('PSVR')).toBe('playstation-4');
    expect(setPlatform('Vita')).toBe('playstation-vita');
    expect(setPlatform('Switch')).toBe('nintendo-switch');
    expect(setPlatform('Nintendo Switch 2')).toBe('nintendo-switch-2');
    expect(setPlatform('Xbox Series X|S')).toBe('xbox-series-x');
    expect(setPlatform('PC')).toBeNull();
    expect(platformsIn('105 (PS4)\n161 (Vita)\n054 (Switch)')).toEqual(['playstation-4', 'playstation-vita', 'nintendo-switch']);
    expect(platformsIn('PS4, PS5 / Switch')).toEqual(['playstation-4', 'playstation-5', 'nintendo-switch']);
  });
});

describe('wikiSetGames', () => {
  it('reads a publisher list: each game with the consoles its row names, PC-only games left out', () => {
    const { games, skipped } = wikiSetGames(LRG);
    expect(games).toEqual([
      { title: '2064: Read Only Memories', platforms: ['playstation-4', 'playstation-vita', 'nintendo-switch'] },
      { title: '8bit Music Power', platforms: ['nintendo-entertainment-system'] },
      { title: 'A-Train Express', platforms: ['playstation-4'] },
      { title: 'Catlateral Damage: Remeowstered', platforms: ['nintendo-switch', 'playstation-4', 'playstation-5'] },
    ]);
    expect(skipped).toBe(1);
  });

  it("takes a table's console from the heading it's under when its rows name none (Super Rare Games' article)", () => {
    const srg = `
<h2 id="Releases">Releases</h2>
<h3 id="Nintendo_Switch">Nintendo Switch</h3>
<table class="wikitable sortable"><tbody>
<tr><th>Release No.</th><th>Date released</th><th>Game title</th><th>Developer</th><th>Collector's Edition available?</th><th>Units produced</th></tr>
<tr><td>#1</td><td>8 March 2018</td><td><i><a href="/wiki/Human:_Fall_Flat">Human: Fall Flat</a></i></td><td>No Brake Games</td><td>No</td><td>5000</td></tr>
<tr><td>#2</td><td>27 April 2018</td><td><i>The Flame in the Flood</i></td><td>The Molasses Flood</td><td>No</td><td>5000</td></tr>
</tbody></table>
<h3 id="Nintendo_Switch_2">Nintendo Switch 2</h3>
<table class="wikitable sortable"><tbody>
<tr><th>Release No.</th><th>Date released</th><th>Game title</th><th>Developer</th></tr>
<tr><td>#1</td><td>2026</td><td><i>Some Switch 2 Game</i></td><td>Someone</td></tr>
</tbody></table>
<h3 id="PlayStation_4">PlayStation 4</h3>
<table class="wikitable sortable"><tbody>
<tr><th>Release No.</th><th>Date released</th><th>Game title</th><th>Developer</th></tr>
<tr><td>#1</td><td>2019</td><td><i>The Flame in the Flood</i></td><td>The Molasses Flood</td></tr>
</tbody></table>
<h2 id="References">References</h2>`;
    expect(wikiSetGames(srg)).toEqual({
      games: [
        { title: 'Human: Fall Flat', platforms: ['nintendo-switch'] },
        { title: 'The Flame in the Flood', platforms: ['nintendo-switch', 'playstation-4'] },
        { title: 'Some Switch 2 Game', platforms: ['nintendo-switch-2'] },
      ],
      skipped: 0,
    });
  });
});

describe('parseSetCsv', () => {
  it('reads titles and consoles, joins a game listed on several rows, and says what it left out', () => {
    const csv = ['Title,Platform,Notes', 'Shantae,Switch,Collector', 'Shantae,PS4;PS5,', 'Doom 64,PC,', 'River City Girls,Nintendo Switch,'].join('\n');
    const { games, problems } = parseSetCsv(csv);
    expect(games).toEqual([
      { title: 'Shantae', platforms: ['nintendo-switch', 'playstation-4', 'playstation-5'], notes: 'Collector' },
      { title: 'River City Girls', platforms: ['nintendo-switch'] },
    ]);
    expect(problems).toEqual(['1 row(s) had no console Squirrelcade knows (PC games, for example) and were left out.']);
    expect(parseSetCsv('Title\nShantae').problems[0]).toMatch(/No platform column/);
  });
});

describe('set names', () => {
  it('makes keys and reads Wikipedia addresses', () => {
    expect(setKey('Limited Run Games')).toBe('limited-run-games');
    expect(setKey('Pokémon!')).toBe('pokemon');
    expect(wikiPageTitle('https://en.wikipedia.org/wiki/List_of_Limited_Run_Games_releases')).toBe('List of Limited Run Games releases');
    expect(wikiPageTitle(' List of Limited Run Games releases ')).toBe('List of Limited Run Games releases');
  });
});
