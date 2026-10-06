import { describe, expect, it } from 'vitest';
import {
  CHANNEL_GUIDES,
  CHANNELS,
  channelsOn,
  discordRequest,
  fit,
  gotifyPriority,
  MAIL_PROVIDERS,
  ntfyPriority,
  ntfyRequest,
  searchUrl,
  telegramRequest,
  webhookRequest,
} from './notify.js';
import { settingDefinitions, settingKeys, type SettingDefinition } from './settings.js';

const message = { subject: 'Squirrelcade: test', text: 'Full text', html: '<p>Full text</p>', short: 'Short text' };

describe('sending messages', () => {
  it('turns an importance into each service’s priority', () => {
    expect([-2, -1, 0, 1, 2].map(ntfyPriority)).toEqual([1, 2, 3, 4, 5]);
    expect([-2, -1, 0, 1, 2].map(gotifyPriority)).toEqual([0, 2, 5, 8, 10]);
    expect(ntfyPriority(9)).toBe(5);
    expect(gotifyPriority(-7)).toBe(0);
  });

  it('keeps each message within its service’s limit', () => {
    expect(fit('abcdef', 10)).toBe('abcdef');
    expect(fit('abcdefghijkl', 10)).toBe('abcdefg...');
    const long = { ...message, short: 'x'.repeat(5000) };
    expect(JSON.parse(discordRequest('https://discord.example.test/hook', long, '').body).content).toHaveLength(2000);
    expect(JSON.parse(telegramRequest('1:t', '42', long, '').body).text).toHaveLength(4096);
  });

  it('builds each request as its service expects', () => {
    // A server's address with or without its slash; ntfy.sh when it's empty.
    expect(ntfyRequest('https://ntfy.example.test/', 'topic', '', message, '', 0)).toMatchObject({ url: 'https://ntfy.example.test/', headers: { 'content-type': 'application/json' } });
    expect(ntfyRequest('', 'topic', '', message, '', 0).url).toBe('https://ntfy.sh/');
    expect(JSON.parse(ntfyRequest('', ' topic ', '', message, 'https://g.example.test/x', 1).body)).toEqual({ topic: 'topic', title: 'Squirrelcade: test', message: 'Short text', priority: 4, tags: ['video_game'], click: 'https://g.example.test/x' });
    const hook = webhookRequest('https://n8n.example.test/webhook/x', '', message, '', 'summary', 5, '2026-09-28T00:00:00.000Z');
    expect(hook.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(hook.body)).toEqual({ app: 'Squirrelcade', kind: 'summary', importance: 2, title: 'Squirrelcade: test', message: 'Short text', text: 'Full text', html: '<p>Full text</p>', url: null, sentAt: '2026-09-28T00:00:00.000Z' });
  });

  it('knows which ways to send are on', () => {
    expect(channelsOn({ 'notifications.emailEnabled': true, 'notifications.ntfyEnabled': true, 'notifications.discordEnabled': false })).toEqual(['Email', 'ntfy']);
    expect(channelsOn({})).toEqual([]);
  });

  it('makes a web search in the engine chosen, Google otherwise', () => {
    expect(searchUrl('duckduckgo', 'Gmail app password')).toBe('https://duckduckgo.com/?q=Gmail%20app%20password');
    expect(searchUrl('nothing', 'x y')).toBe('https://www.google.com/search?q=x%20y');
  });
});

describe('setup guides', () => {
  it('offers each email provider with a server, a port and steps whose links are secure pages', () => {
    expect(new Set(MAIL_PROVIDERS.map((m) => m.id)).size).toBe(MAIL_PROVIDERS.length);
    for (const m of MAIL_PROVIDERS) {
      expect([m.id, /^[a-z0-9.-]+\.[a-z]{2,}$/.test(m.host), [465, 587].includes(m.port), m.guide.steps.length > 0]).toEqual([m.id, true, true, true]);
      for (const step of m.guide.steps) if (step.link) expect(step.link.url).toMatch(/^https:\/\//);
    }
    // Gmail first, with its app password page and a search to fall back on.
    expect(MAIL_PROVIDERS[0]).toMatchObject({ id: 'gmail', host: 'smtp.gmail.com', port: 587 });
    expect(MAIL_PROVIDERS[0]!.guide.steps.find((s) => s.link?.url === 'https://myaccount.google.com/apppasswords')?.search).toBeTruthy();
    // Outlook.com is there to say it doesn't work any more.
    expect(MAIL_PROVIDERS.find((m) => m.id === 'outlook')?.guide.warning).toMatch(/September 2024/);
  });

  it('has steps for every other way to send, with a search wherever a link might move', () => {
    for (const c of CHANNELS.filter((x) => x !== 'email')) {
      const guide = CHANNEL_GUIDES[c];
      expect([c, Boolean(guide && guide.steps.length > 0)]).toEqual([c, true]);
      for (const step of guide!.steps) if (step.link) expect([c, step.link.url.startsWith('https://')]).toEqual([c, true]);
    }
  });

  it('shows each service’s fields under a switch that exists', () => {
    const under = settingKeys.filter((k) => (settingDefinitions[k] as SettingDefinition).shownWhen);
    expect(under.length).toBeGreaterThan(15);
    for (const k of under) {
      const when = (settingDefinitions[k] as SettingDefinition).shownWhen!;
      expect([k, (settingDefinitions as Record<string, SettingDefinition>)[when]?.kind]).toEqual([k, 'boolean']);
    }
    // Every provider is a choice of the provider setting, and "Another provider" too.
    const providers = (settingDefinitions['notifications.emailProvider'] as SettingDefinition).options!.map((o) => o.value);
    expect(providers).toEqual([...MAIL_PROVIDERS.map((m) => m.id), 'custom']);
  });
});
