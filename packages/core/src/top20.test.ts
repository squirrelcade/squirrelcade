import { describe, expect, it } from 'vitest';
import { salesRegionOf, yearBestSellers } from './top20.js';

describe("a year's best sellers from Wikipedia (T-218)", () => {
  it('reads a table per region under its heading (1990)', () => {
    const text = `=== Best-selling home systems ===
{| class="wikitable"
! Rank !! System
|-
| 1 || [[Game Boy]]
|}
=== Best-selling home video games ===

====Japan====
In Japan, according to ''[[Famicom Tsūshin]]'':

{| class="wikitable sortable" style="text-align:center"
! Rank
! Title
! Platform
|-
| 1
| ''[[Super Mario World]]''
| [[Super Famicom|SFC]]
|-
| 2
| ''[[Dragon Quest IV: Michibikareshi Monotachi|Dragon Quest IV]]''<ref>x</ref>
| [[Famicom]]
|}

====United States====
{| class="wikitable"
! Rank
! Title
|-
| 1
| ''[[Super Mario Bros. 3]]''
|}
==Events==`;
    expect(yearBestSellers(text)).toEqual({
      japan: [
        { title: 'Super Mario World', article: 'Super Mario World' },
        { title: 'Dragon Quest IV', article: 'Dragon Quest IV: Michibikareshi Monotachi' },
      ],
      us: [{ title: 'Super Mario Bros. 3', article: 'Super Mario Bros. 3' }],
    });
  });

  it('reads one ranked table with its caption (2005) and the regions as columns (2015), leaving Steam out', () => {
    const y2005 = `===Best-selling games by region===
'''Worldwide'''
{| class="wikitable sortable"
|+ Best-selling video games worldwide in 2005
! rowspan="2" | Rank
! rowspan="2" | Title
! rowspan="2" | Platform(s)
|-
|1
|''[[Gran Turismo 4]]''
|PS2
|-
|2
|''[[Madden NFL 06]]''
|PS2, XB
|}`;
    expect(yearBestSellers(y2005)).toEqual({ worldwide: [{ title: 'Gran Turismo 4', article: 'Gran Turismo 4' }, { title: 'Madden NFL 06', article: 'Madden NFL 06' }] });
    const y2015 = `===Best-selling games===
{| class="wikitable sortable" style="text-align:center"
|-
! Rank
! Japan (retail)<ref>a</ref>
! United States (retail)
! [[Steam (service)|Steam]] (digital)
|-
| 1
|''[[Monster Hunter X]]''
|''[[Call of Duty: Black Ops III]]''
| ''[[Grand Theft Auto V]]''
|-
| 2
|''[[Splatoon]]''
|''[[Madden NFL 16]]''
| ''[[Fallout 4]]''
|}`;
    expect(yearBestSellers(y2015)).toEqual({
      japan: [{ title: 'Monster Hunter X', article: 'Monster Hunter X' }, { title: 'Splatoon', article: 'Splatoon' }],
      us: [{ title: 'Call of Duty: Black Ops III', article: 'Call of Duty: Black Ops III' }, { title: 'Madden NFL 16', article: 'Madden NFL 16' }],
    });
  });

  it("knows a region by its words, and that Steam's chart isn't one", () => {
    expect(salesRegionOf('[[Video games in the United States|United States]]')).toBe('us');
    expect(salesRegionOf('Famitsu')).toBe('japan');
    expect(salesRegionOf('United Kingdom (retail)')).toBe('europe');
    expect(salesRegionOf('Steam (digital)')).toBeNull();
  });
});
