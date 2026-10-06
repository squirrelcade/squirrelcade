import matching from '../../../docs/MATCHING.md?raw';
import type { LinkResolver } from './Markdown';

/** The help guides (docs/help/*.md), shown in the app for owners and viewers without the repository. */
const files = import.meta.glob('../../../docs/help/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** The guides in the order of the help's index (docs/help/README.md), with "How matching works" (docs/MATCHING.md). */
export const HELP_ORDER = ['getting-started', 'ai-setup', 'collection', 'playing', 'your-copies', 'selling', 'catalogs', 'matching', 'wishlist', 'store-mode', 'sets', 'top100-history', 'features', 'services', 'pc-library', 'romm', 'sharing', 'friends', 'ai-apps', 'notifications', 'backups', 'troubleshooting'];

/** Every guide's text by its name ("store-mode"); "README" is the index. */
export const HELP_TEXTS = new Map(Object.entries(files).map(([path, text]) => [path.split('/').pop()!.replace(/\.md$/, ''), text]));
HELP_TEXTS.set('matching', matching);

/** A guide's title: its first heading. */
export const helpTitle = (text: string, fallback: string) => /^# (.+)$/m.exec(text)?.[1] ?? fallback;

export const HELP_TOPICS = HELP_ORDER.filter((k) => HELP_TEXTS.has(k)).map((key) => ({ key, title: helpTitle(HELP_TEXTS.get(key)!, key) }));

/** A link between the guides ("store-mode.md", "../MATCHING.md") is its help page; other documents keep their words. */
export const resolveHelpLink: LinkResolver = (href) => {
  const file = href.split('#')[0] ?? '';
  const name = file.split('/').pop()?.replace(/\.md$/, '') ?? '';
  if (name === 'MATCHING') return '/help/matching';
  if (name === 'README' && !file.includes('..')) return '/help';
  return name && HELP_TEXTS.has(name) && name !== 'README' ? `/help/${name}` : null;
};
