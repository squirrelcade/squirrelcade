import { describe, expect, it } from 'vitest';
import { fileChanges } from './settingsFile';

describe('a settings file before it is imported', () => {
  it('lists what it changes in words, a secret only as replaced, and the names that are not settings', () => {
    const saved = { 'features.romm': false, 'sources.rommUrl': '', 'general.currency': 'USD', 'security.trustedProxies': [], 'notifications.ntfyTopic': 'mine' };
    const { changes, unknown } = fileChanges(
      {
        'features.romm': true,
        'sources.rommUrl': 'http://192.0.2.20:8080',
        'sources.rommToken': 'a-token-from-the-file',
        'security.trustedProxies': ['172.18.0.1'],
        'notifications.ntfyTopic': 'mine',
        'features.teleport': true,
      },
      saved,
    );
    expect(changes).toEqual([
      { key: 'features.romm', where: 'Features › RomM links', before: 'Off', after: 'On' },
      { key: 'sources.rommUrl', where: 'Sources › RomM address', before: '(empty)', after: 'http://192.0.2.20:8080' },
      { key: 'sources.rommToken', where: 'Sources › API token', before: '(kept as you have it)', after: '(replaced by the file)' },
      { key: 'security.trustedProxies', where: 'Security › Trusted proxies', before: '(empty)', after: '172.18.0.1' },
    ]);
    expect(JSON.stringify(changes)).not.toContain('a-token-from-the-file');
    expect(unknown).toEqual(['features.teleport']);
    // A choice reads as its label.
    expect(fileChanges({ 'general.currency': 'EUR' }, saved).changes[0]).toMatchObject({ before: 'US dollar', after: 'Euro' });
  });
});
