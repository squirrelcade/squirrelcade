# How Squirrelcade decides what you own

Each tracked console has a **catalog**: the games there are to collect on it. Your **copies** come from your PriceCharting export. A console's page shows, for every catalog game, whether one of your copies counts for it. This page explains when one does, and what to do when Squirrelcade gets it wrong.

## Where a catalog's games come from

In the order Settings > Sources > Catalog sources gives them (most trusted first):

- **Your own list** of the console's games, if you added one (a CSV with a title column, on the console's page).
- **Wikipedia's list** of the console's games, for your home region. Under your own list it adds only games released after it, unless Settings > Catalogs and matching says otherwise.
- Other sources you switch on, such as Nintendo Life's Switch 2 lists (Game-Key Cards).

Physical releases come first. On consoles whose lists mix in download-only games, a game counts once something shows it had a physical release: your list, IGDB, owning it, or you pressing **It's physical**. Until then it waits as "Not confirmed physical". Bundles and compilations Wikipedia lists separately wait under Review > "Marked in the catalog".

## When a copy counts for a catalog game

A copy counts when it is the same game, by one of these, from the surest to the least sure. Each copy shows how it counts in the game's drawer (click the game's title) and on the console's Owned tab.

| How | Example | Can be undone |
| --- | --- | --- |
| **Same title**, written the same way once case, accents, punctuation, a leading "The", "Tom Clancy's", roman numerals and "&" are set aside | "Tomb Raider II" and "Tomb Raider 2"; "Zelda Twilight Princess" (PriceCharting's way) and "The Legend of Zelda: Twilight Princess" | no, it's the same title |
| **Edition**: the copy is the game plus an edition in brackets or a collector's edition | "Halo 3 [Limited Edition]" counts for "Halo 3" | "not the same" |
| **Other name**: one of the game's other titles (another region's name, a retitle, IGDB's alternative names, but not a name IGDB gives two games, or a file name such as "Game.exe") | a Japanese copy under its Japanese title | "not the same" |
| **Spelled differently**, on consoles of Japanese releases only: long vowels written out or not, n or m before b, m and p | "Jikkyou" and "Jikkyō" | "not the same" |
| **Without its subtitle**, only if you switch it on (Settings > Catalogs and matching > "Titles without their subtitle") | "Doraemon 2" for "Doraemon 2: Nobita no Toys Land Daibouken" | "not the same" |
| **Other generation** (Settings > Catalogs and matching > "Cross-generation games count for both consoles", on by default): the same game owned on the console before or after this one in its family, the two released within two years | Hollow Knight: Silksong on Switch 2 counts for the Switch catalog's Silksong | turn the setting off |
| **Mapping**: your own CSV of owned titles that count as catalog games (compilations, odd names), on the console's page | a compilation that counts for each game in it | edit the mapping |
| **You confirmed** it: "Same game" on a Review question | | "undo" |
| **Just bought**: "I bought it" in Store Mode or the drawer, until your next export includes the game | | "Undo" |

A copy never counts for two games by name alone: if its own title is a catalog game, other games' alternative names don't claim it.

## When Squirrelcade isn't sure

A copy whose title only looks like a catalog game's (one contains the other, a few letters differ) is never counted on its own. It becomes a **Review question**: "Is it one of these you own?", with **Same game** or **Different**. Until you answer, the game counts as neither owned nor missing, and the wishlist leaves it out.

Owned copies that match nothing are listed on the console's "Not in catalog" tab: link one to a game, add it to the catalog, or ignore it.

## Regions

On region-locked consoles (Settings > Platforms > Region-locked consoles), copies from another region are a console of their own: Japanese Super Nintendo games are the Super Famicom, with its own catalog of Japanese releases. On region-free consoles, such as the Switch, every region's copy counts for the same game, and the catalog takes in other regions' physical releases too: IGDB's PAL, Japanese and Asian discs and cartridges that the other sources don't list come in at the bottom of the source order (Settings > Sources > Catalog sources, "IGDB (other regions)"). Each counts once you own a copy; until then it waits on the console's "Other regions" tab, neither missing nor recommended, so the percentages don't drop. Which consoles are region-locked is yours to change, console by console.

## When it's wrong

- A copy counted for the wrong game: open the game's drawer, and under the copy press **not the same** (or **undo** for one you confirmed).
- A game missing that you own: look at the console's "Not in catalog" and Review tabs; the copy may be waiting there under another title.
- A game in the catalog that shouldn't be: **Not a target** in its drawer (or on Review) takes it out of the console's completion.
- Something else: the support file (System > Status) and a note of the game's title help whoever looks into it.
