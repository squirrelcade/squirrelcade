import { SETTINGS_PAGES, settingDefinitions, type FeatureKey } from '@squirrelcade/core';
import { describe, expect, it } from 'vitest';
import readme from '../../../README.md?raw';
import { BRIEF_TEMPLATE } from './aiSetup';
import { HELP_ORDER, HELP_TEXTS, resolveHelpLink } from './helpTopics';

/** The install and setup guide (docs/guide), for readers on GitHub. */
const guides = import.meta.glob('../../../docs/guide/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** Links in a guide: [words](target). */
const linksOf = (text: string) => [...text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((m) => m[1]!);

describe('help guides', () => {
  it("uses only what the app's Markdown shows: no link inside bold, no italics", () => {
    for (const [name, text] of HELP_TEXTS) {
      const prose = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
      expect([name, /\*\*\[/.test(prose)]).toEqual([name, false]);
      expect([name, /(^|[^*\w])\*[A-Za-z][^*\n]*[^*\s]\*($|[^*])/m.test(prose)]).toEqual([name, false]);
      expect([name, /(^|\s)_[A-Za-z][^_\n]*_(\s|[.,;:]|$)/m.test(prose)]).toEqual([name, false]);
    }
  });

  it('names in Services and tools every optional part, way to send messages and barcode service', () => {
    const services = HELP_TEXTS.get('services') ?? '';
    // What each optional part uses, as the page names it (a new part must say here what it uses; null: nothing outside).
    const uses: Record<FeatureKey, string | null> = {
      igdb: 'IGDB',
      history: null,
      pc: 'Playnite',
      romm: 'RomM',
      itad: 'IsThereAnyDeal',
      mail: 'mailbox',
      retroachievements: 'RetroAchievements',
      xbox: 'OpenXBL',
      playstation: 'psn-api',
      steam: 'Steam Web API',
    };
    for (const [part, name] of Object.entries(uses)) if (name) expect([part, services.includes(name)]).toEqual([part, true]);
    for (const name of ['Pushover', 'Pushbullet', 'ntfy', 'Gotify', 'Discord', 'Telegram', 'Slack', 'webhook', 'Apprise', 'UPCitemdb', 'UPC Database', 'PriceCharting', 'OmniDrive', 'redumper']) {
      expect([name, services.includes(name)]).toEqual([name, true]);
    }
    // Every outside link is to a site's own address (https, or Redump's own http sites).
    for (const link of linksOf(services).filter((l) => /^[a-z]+:/.test(l))) expect(link).toMatch(/^https:\/\/[a-z0-9.-]+\.[a-z]+/);
  });

  it('lists every guide in the index, in the app and in docs/help/README.md', () => {
    const guides = [...HELP_TEXTS.keys()].filter((k) => k !== 'README');
    expect([...guides].sort()).toEqual([...HELP_ORDER].sort());
    const index = HELP_TEXTS.get('README')!;
    for (const k of HELP_ORDER) expect([k, index.includes(k === 'matching' ? '../MATCHING.md' : `${k}.md`)]).toEqual([k, true]);
  });

  it("leads every link to another guide to that guide's page, and every other link somewhere real", () => {
    // Documents outside the guides keep their words in the app (and work on GitHub).
    const outside = new Set(['../API.md', '../../README.md#running-it-with-docker', '../../README.md', '../../CHANGELOG.md', '../guide/README.md', '../guide/install.md#updating-later']);
    for (const [name, text] of HELP_TEXTS) {
      for (const link of linksOf(text)) {
        if (/^https?:\/\//.test(link)) continue;
        expect([name, link, resolveHelpLink(link) !== null || outside.has(link)]).toEqual([name, link, true]);
      }
    }
    expect(resolveHelpLink('store-mode.md')).toBe('/help/store-mode');
    expect(resolveHelpLink('collection.md#copies')).toBe('/help/collection');
    expect(resolveHelpLink('../MATCHING.md')).toBe('/help/matching');
    expect(resolveHelpLink('../API.md')).toBeNull();
  });

  it('starts each guide with its title', () => {
    for (const [name, text] of HELP_TEXTS) expect([name, /^# \S/.test(text)]).toEqual([name, true]);
  });

  it('names only the settings pages and sections the app has', () => {
    // The guides, the AI's prompt, the install guide, the README and every setting's description.
    const texts: [string, string][] = [
      ...HELP_TEXTS,
      ['the AI prompt', BRIEF_TEMPLATE],
      ...Object.entries(guides),
      ['README', readme],
      ...Object.entries(settingDefinitions).map(([key, def]) => [key, def.description ?? ''] as [string, string]),
    ];
    // Other apps' own settings (Playnite's backups, Fastmail's and Pushbullet's accounts, the iPhone's, RetroAchievements' keys, Claude's connectors).
    const elsewhere = ['Backup', 'Privacy & Security', 'Account', 'POP3 & IMAP', 'Safari', 'Keys', 'Connectors'];
    // What a settings page shows besides its settings, and the buttons above them.
    const extras: Record<string, string[]> = { security: ['API key'], ai: ['Claude Code and Cowork on your network', "Claude's apps on the internet", 'Guests', 'Connected apps', 'Latest calls'] };
    const actions = ['Import', 'Export', 'Show advanced'];
    // "IGDB" names "IGDB (game details and covers)", and a path's last part runs on into its sentence.
    const named = (part: string, names: string[]) => names.flatMap((n) => [n, n.replace(/ \(.*\)$/, '')]).some((n) => part === n || part.startsWith(`${n} `));
    const partsOf = (page: string) => [
      ...Object.values(settingDefinitions).flatMap((d) => (d.page === page ? [d.section, d.label].filter((x): x is string => !!x) : [])),
      ...(extras[page] ?? []),
    ];
    const pageOf = (words: string) =>
      SETTINGS_PAGES.filter((p) => words === p.title || words.startsWith(`${p.title} `)).sort((a, b) => b.title.length - a.title.length)[0];
    let paths = 0;
    for (const [name, text] of texts) {
      for (const m of text.matchAll(/(Settings|Wishlist|Acorns ranking) ?(?:>|›) ?([^>›\n.,;:()"*\]`]+)(?: ?(?:>|›) ?([^>›\n.,;:()"*\]`]+))?/g)) {
        const [, root, first = '', rest = ''] = m;
        // A part in bold or code ends the match: its words are checked only when they're plain.
        const head = first.trim();
        const second = rest.trim();
        // Acorns > Acorns ranking is the wishlist's settings page (0.58.0).
        if (root === 'Acorns ranking') {
          expect([name, m[0], named(head, partsOf('wishlist'))]).toEqual([name, m[0], true]);
          continue;
        }
        if (root === 'Wishlist') {
          // Wishlist > Scoring is the wishlist's settings page.
          if (head === 'Scoring' && second) expect([name, m[0], named(second, partsOf('wishlist'))]).toEqual([name, m[0], true]);
          continue;
        }
        paths++;
        if (elsewhere.some((e) => head === e || head.startsWith(`${e} `)) || actions.some((a) => head === a || head.startsWith(`${a} `))) continue;
        // The wishlist's settings are on Wishlist > Scoring, not in the Settings menu.
        const page = pageOf(head);
        expect([name, m[0], page !== undefined && page.id !== 'wishlist']).toEqual([name, m[0], true]);
        if (page && second) expect([name, m[0], named(second, [...partsOf(page.id), ...actions])]).toEqual([name, m[0], true]);
      }
    }
    expect(paths).toBeGreaterThan(150);
  });
});
