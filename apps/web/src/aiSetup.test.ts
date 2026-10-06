import { CHANNEL_NAMES, type FeatureKey } from '@squirrelcade/core';
import { describe, expect, it } from 'vitest';
import { allGuides, BRIEF_TEMPLATE, briefWithGuides, fillBrief } from './aiSetup';

describe('the AI setup prompt', () => {
  it('keeps its rules, and a place for what only an install knows', () => {
    expect(BRIEF_TEMPLATE).toMatch(/^# Help me set up Squirrelcade/);
    expect(BRIEF_TEMPLATE).toContain('Never ask me for a password, API key, token, app password or webhook address in this chat');
    expect(BRIEF_TEMPLATE).toContain('Ask before changing my server');
    expect(BRIEF_TEMPLATE).toMatch(/<!-- squirrelcade:state -->[\s\S]+<!-- \/squirrelcade:state -->/);
    expect(BRIEF_TEMPLATE).toMatch(/<!-- squirrelcade:links -->[\s\S]+<!-- \/squirrelcade:links -->/);
    // Links to the services' own pages, over HTTPS (beside the placeholders for my server, IGDB's localhost, and
    // examples in the documentation range 192.0.2.x); nothing of any one install.
    for (const [, link] of BRIEF_TEMPLATE.matchAll(/(https?:\/\/[^\s)`"]+)/g)) if (!/^http:\/\/(<|localhost|192\.0\.2\.)/.test(link!)) expect(link).toMatch(/^https:\/\//);
    // (Docker's usual gateway, 172.18.0.1, is the one address it gives, as an example.)
    expect(BRIEF_TEMPLATE).not.toMatch(/\b(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)\b/);
  });

  it('covers every optional part and every way of sending messages (a new one must be added to the prompt)', () => {
    const named: Record<FeatureKey, string | null> = {
      igdb: 'IGDB',
      history: null,
      pc: 'Playnite',
      romm: 'RomM',
      itad: 'IsThereAnyDeal',
      mail: 'Stash updates from your email',
      retroachievements: 'RetroAchievements',
      xbox: 'Xbox achievements',
      playstation: 'PlayStation trophies',
      steam: 'Steam achievements',
    };
    for (const [part, name] of Object.entries(named)) if (name) expect([part, BRIEF_TEMPLATE.includes(name)]).toEqual([part, true]);
    for (const name of Object.values(CHANNEL_NAMES)) expect([name, BRIEF_TEMPLATE.toLowerCase().includes(name.toLowerCase())]).toEqual([name, true]);
  });

  it("puts an install's summary and links in their places", () => {
    const filled = fillBrief(BRIEF_TEMPLATE, { state: '- **Installed:** yes, version 9.9.9.', links: '- Steam achievements: http://nas:7575/settings/features#setting-features.steam' });
    expect(filled).not.toContain('<!-- squirrelcade:');
    expect(filled).not.toContain('This brief came from Squirrelcade\'s repository');
    expect(filled).toMatch(/## My Squirrelcade now\n\n- \*\*Installed:\*\* yes, version 9\.9\.9\.\n\n## The interview/);
    expect(filled).toContain('## Where things are\n\n- Steam achievements: http://nas:7575/settings/features#setting-features.steam');
    // A "$" in the summary is kept as it is (not read as a replacement pattern).
    expect(fillBrief(BRIEF_TEMPLATE, { state: 'Spent $& and $1', links: '' })).toContain('Spent $& and $1');
  });

  it('adds every guide after it, headings a level down, pictures as words, code as it is', () => {
    const full = briefWithGuides(fillBrief(BRIEF_TEMPLATE, { state: 'x', links: 'y' }));
    const guides = allGuides();
    expect(guides.map((g) => g.name)).toEqual(expect.arrayContaining(['docs/guide/install.md', 'docs/guide/connect.md', 'docs/help/services.md', 'docs/help/notifications.md', 'docs/MATCHING.md']));
    expect(guides.some((g) => g.name.endsWith('ai-setup.md'))).toBe(false);
    for (const g of guides) expect([g.name, full.includes(`<!-- ${g.name} -->`)]).toEqual([g.name, true]);
    expect(full).toContain("# Appendix: Squirrelcade's guides");
    expect(full).toContain('\n## 1. Install it\n');
    expect(full).not.toMatch(/^# 1\. Install it$/m);
    expect(full).not.toMatch(/<img |!\[/);
    expect(full).toContain('(Picture: ');
    expect(full).toContain('    image: ghcr.io/squirrelcade/squirrelcade:latest');
    // Then every setting, for a settings file: its key and what it takes; a secret named, never valued.
    expect(full).toContain('# Appendix: every setting');
    expect(full).toContain('- `features.steam` (Features > Optional features > Steam achievements): true or false; default false.');
    expect(full).toMatch(/- `notifications\.pushoverToken` \([^)]*\): a secret: never in a file[^;]*\. /);
    expect(full).toContain('- `general.currency` (General > Localization > Currency): one of "USD" (US dollar), "CAD"');
  });
});
