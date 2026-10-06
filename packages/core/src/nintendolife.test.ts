import { describe, expect, it } from 'vitest';
import { nintendoLifeGames } from './nintendolife.js';

/** Shaped like Nintendo Life's guide: contents, the confirmed list, rumours, Japanese releases, questions. */
const PAGE = `
<h1>Every Nintendo Switch 2 Game-Key Card Release</h1>
<ol><li class="open"><span class="toc-item"><a href="/guides/every-nintendo-switch-2-game-key-card-release#confirmed">Confirmed Switch 2 Game-Key Cards List</a></span></li></ol>
<h2 id="confirmed-switch-2-game-key-cards-list">Confirmed Switch 2 Game-Key Cards List</h2>
<p>We'll keep this list updated with <strong>officially confirmed</strong> NS2 Game-Key Card releases only.</p>
<ul class="games games-style-list"><li class=" first"><a href="games/nintendo-switch-2/007-first-light">007 First Light</a> (Switch 2)<br /><em>Mar 2027 / IO Interactive</em></li><li><a href="games/nintendo-switch-2/attack_on_titan_3">Attack on Titan 3</a> (Switch 2)<br /><em>10th Dec 2026 / Koei Tecmo / Omega Force</em></li><li><a href="games/nintendo-switch-2/borderlands-4">Borderlands 4</a> (Switch 2)<br /><em>TBA / 2K Games / Gearbox Software</em></li><li><a href="games/nintendo-switch-2/brigandine-abyss">Brigandine: Abyss &amp; Friends</a> (Switch 2)<br /><em>27th Aug 2026 / NIS America</em></li></ul>
<h2 id="rumoured-switch-2-game-key-cards">Rumoured Switch 2 Game-Key Cards</h2>
<ul class="games games-style-list"><li><a href="games/nintendo-switch-2/rumoured-game">Rumoured Game</a> (Switch 2)<br /><em>TBA / Someone</em></li></ul>
<h3 id="confirmed-switch-2-game-key-cards-japan">Confirmed Switch 2 Game-Key Cards (Japan)</h3>
<ul> <li><a href="games/nintendo-switch-2/daemon-x-machina-titanic-scion">Daemon X Machina: Titanic Scion</a> (This is not a Game-Key release in the West)</li> <li><a href="https://www.nintendolife.com/games/nintendo-switch-2/wild-hearts-s">Wild Hearts S</a></li> </ul>
<h2 id="game-key-card-faq">Game-Key Card FAQ</h2>
<ul><li><a href="/news/2025/06/why">Why make a cartridge with no data?</a></li></ul>
<h2>Related Articles</h2>
<ul><li><a href="games/nintendo-switch-2/some-other-guide-game">Guide Every Nintendo Switch 2 Physical Release</a></li></ul>
`;

describe('nintendoLifeGames', () => {
  it('reads the confirmed games with their dates, and the Japanese ones apart', () => {
    expect(nintendoLifeGames(PAGE, 'Game-Key Card')).toEqual([
      { title: '007 First Light', format: 'Game-Key Card', releaseDate: '2027-03', japan: false, note: null },
      { title: 'Attack on Titan 3', format: 'Game-Key Card', releaseDate: '2026-12-10', japan: false, note: null },
      { title: 'Borderlands 4', format: 'Game-Key Card', releaseDate: 'TBA', japan: false, note: null },
      { title: 'Brigandine: Abyss & Friends', format: 'Game-Key Card', releaseDate: '2026-08-27', japan: false, note: null },
      { title: 'Daemon X Machina: Titanic Scion', format: 'Game-Key Card', releaseDate: null, japan: true, note: 'This is not a Game-Key release in the West' },
      { title: 'Wild Hearts S', format: 'Game-Key Card', releaseDate: null, japan: true, note: null },
    ]);
  });

  it('finds nothing on a page without a confirmed list', () => {
    expect(nintendoLifeGames('<h2>Something else</h2><ul><li><a href="games/nintendo-switch-2/x">X</a></li></ul>', 'Full Game Card')).toEqual([]);
  });
});
