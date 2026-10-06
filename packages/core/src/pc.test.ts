import { describe, expect, it } from 'vitest';
import { parsePcAudit, parsePlayniteSnapshot, pcFamilyKey, pcOwnership, SnapshotError, storefrontOwnership, STOREFRONT_OWNERSHIP_DEFAULT } from './pc.js';

/** A tiny snapshot shaped like the Playnite reader's. */
export const SNAPSHOT = JSON.stringify({
  schemaVersion: 'vgcm-playnite-library-v1',
  generatedAtUtc: '2026-09-27T12:00:00Z',
  source: { fileName: 'PlayniteBackup-2026-09-26.zip', lastWriteUtc: '2026-09-26T12:53:59Z', fingerprint: 'abc', sizeBytes: 1000 },
  statistics: { gameRecords: 3 },
  records: [
    { recordKey: 'STEAM|1', playniteId: 'p1', storefrontGameId: '1', sourceName: 'Steam', name: 'Hades', platforms: ['PC (Windows)'], genres: ['Action'], series: [], favorite: true, hidden: false, installed: true, playtimeSeconds: 36000, playCount: 3, links: [{ name: 'Steam', url: 'https://store.steampowered.com/app/1145360' }, { name: 'bad', url: 'javascript:alert(1)' }] },
    { recordKey: 'xbox|9', playniteId: 'p2', storefrontGameId: '9', sourceName: 'Xbox', name: 'Halo Infinite', platforms: ['PC (Windows)'], genres: [], series: ['Halo'], favorite: false, hidden: false, installed: false, playtimeSeconds: 0, playCount: 0, links: [] },
    { recordKey: 'ea|3', playniteId: 'p3', storefrontGameId: '', sourceName: 'EA app', name: 'Mass Effect Legendary Edition', platforms: [], genres: [], series: [], favorite: false, hidden: false, installed: false, playtimeSeconds: 0, playCount: 0, links: [] },
    { recordKey: '', name: 'No key' },
  ],
});

describe('parsePlayniteSnapshot', () => {
  it('reads the records the reader wrote, and counts them by storefront', () => {
    const s = parsePlayniteSnapshot(SNAPSHOT);
    expect(s.records.map((r) => r.recordKey)).toEqual(['steam|1', 'xbox|9', 'ea|3']);
    expect(s.statistics.bySource).toEqual({ Steam: 1, Xbox: 1, 'EA app': 1 });
    expect(s.records[0]!.links).toEqual([{ name: 'Steam', url: 'https://store.steampowered.com/app/1145360' }]);
    expect(s.source.fileName).toBe('PlayniteBackup-2026-09-26.zip');
  });

  it('refuses what is not a snapshot', () => {
    expect(() => parsePlayniteSnapshot('not json')).toThrow(SnapshotError);
    expect(() => parsePlayniteSnapshot('{"schemaVersion":"other","records":[]}')).toThrow(/Playnite reader snapshot/);
  });
});

describe('PC ownership', () => {
  const defaults = storefrontOwnership(STOREFRONT_OWNERSHIP_DEFAULT);

  it('counts storefront games as owned unless the storefront is named, and the audit decides single games', () => {
    const audit = parsePcAudit(
      [
        'PC Ownership Audit — Video Game Collection Manager',
        '"Protected one-time live entitlement baseline for EA, Ubisoft, and Xbox."',
        'Source,Storefront Game ID,Source Title,Canonical Title,Ownership Status,Verification Source,Verified At,Confidence,Manual Override,Active,Notes',
        'EA app,,Mass Effect Legendary Edition,Mass Effect Legendary Edition,Permanent / Claimed,EA app Library,2026-08-13,High,No,Yes,Bought.',
        'Xbox,9,Halo Infinite,Halo Infinite,Subscription Access,Game Pass,2026-08-13,High,No,Yes,',
        'Xbox,10,Old Game,Old Game,Permanent / Claimed,,,,,No,Inactive rows are left out',
        'Ubisoft Connect,,Weird,Weird,Maybe,,,,,Yes,',
      ].join('\n'),
    );
    expect(audit.entries).toHaveLength(2);
    expect(audit.problems).toEqual(["1 row(s) had an ownership Squirrelcade doesn't know (use Permanent, Subscription or Historical) and were left out."]);
    expect(pcOwnership({ sourceName: 'Steam', storefrontGameId: '1', name: 'Hades' }, defaults, audit.entries)).toEqual({ ownership: 'permanent', audited: false });
    expect(pcOwnership({ sourceName: 'Xbox', storefrontGameId: '9', name: 'Halo Infinite' }, defaults, audit.entries)).toEqual({ ownership: 'subscription', audited: true });
    expect(pcOwnership({ sourceName: 'Xbox', storefrontGameId: '11', name: 'Forza Horizon 5' }, defaults, audit.entries)).toEqual({ ownership: 'historical', audited: false });
    // Without a storefront game id, the title decides within the storefront.
    expect(pcOwnership({ sourceName: 'EA app', storefrontGameId: '', name: 'Mass Effect Legendary Edition' }, defaults, audit.entries)).toEqual({ ownership: 'permanent', audited: true });
  });

  it('shares one family key across storefronts and editions', () => {
    expect(pcFamilyKey('DOOM Eternal: Deluxe Edition')).toBe(pcFamilyKey('Doom Eternal'));
    expect(pcFamilyKey('Hades II')).not.toBe(pcFamilyKey('Hades'));
  });
});
