import { describe, expect, it } from 'vitest';
import { changesOf } from './WhatsNew';

describe("what's new", () => {
  it("shows a build's version from the changelog, and the newest for a development build", () => {
    // A published build is "<version>-<commit>": its version's section.
    expect(changesOf('0.2.0-abcdef1').map((s) => s.version)).toEqual(['0.2.0']);
    expect(changesOf('0.1.0').map((s) => s.version)).toEqual(['0.1.0']);
    expect(changesOf('0.1.0')[0]!.lines.length).toBeGreaterThan(0);
    // A development build ("0.2.0-dev") has no commit: the newest section.
    expect(changesOf('0.2.0-dev')).toHaveLength(1);
  });
});

describe("what's new, in a few words", () => {
  it("gives each change's bold lead-in, else its first words", async () => {
    const { gist } = await import('./WhatsNew');
    expect(gist('**Today** (at the top of the menu): what matters today.')).toBe('Today');
    expect(gist('**Scanning a game in Store Mode** (the report): the name...')).toBe('Scanning a game in Store Mode');
    expect(gist('The mailbox search leaves out a sender left empty. More words.')).toBe('The mailbox search leaves out a sender left empty');
    expect(gist('`scripts/demo.mjs`: a demo install')).toBe('scripts/demo.mjs');
    // A label with its colon or question mark inside the bold.
    expect(gist('**Locked out?** A command prints a link.')).toBe('Locked out?');
    expect(gist('**apps/x/NOTICE.md:** what it says')).toBe('apps/x/NOTICE.md');
    // A link in the aside after the label is still an aside.
    expect(gist('**Install and set up Squirrelcade** ([docs/guide](docs/guide/README.md), the request): step by step.')).toBe('Install and set up Squirrelcade');
    expect(gist('**An Unraid template** ([docs/unraid/squirrelcade.xml](docs/unraid/squirrelcade.xml)) until it is listed (by (them)).')).toBe('An Unraid template until it is listed');
  });

  it('gives the sentence when a bold lead-in is its subject, or a bold word is inside it, without asides', async () => {
    const { gist } = await import('./WhatsNew');
    expect(gist('**Today** lists the setup steps first (the collection, its catalogs) while some are left: more.')).toBe('Today lists the setup steps first while some are left');
    expect(gist('**A barcode scanned again** (twice in a store) no longer asks the service again: what it said is kept.')).toBe('A barcode scanned again no longer asks the service again');
    expect(gist('The welcome guide calls IGDB **recommended** instead of optional, and says why.')).toBe('The welcome guide calls IGDB recommended instead of optional, and says why');
  });

  it('shortens a long sentence at a comma, else between words, never mid-word', async () => {
    const { gist } = await import('./WhatsNew');
    expect(gist('With no connection, the sign-in check waited for one instead of failing, so a page could stay on its spinner for good.')).toBe('With no connection, the sign-in check waited for one instead of failing');
    const long = gist(`${'word '.repeat(30)}end.`);
    expect(long).toMatch(/^(word )+word…$/);
    expect(long.length).toBeLessThanOrEqual(101);
  });
});
