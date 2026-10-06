/**
 * The settings pages, in menu order. Kept apart from the settings themselves (settings.ts), so the web
 * app's menu doesn't bring in every setting's checks.
 */
export const SETTINGS_PAGES = [
  { id: 'general', title: 'General', description: 'Name, time zone, currency, region and logging.' },
  { id: 'email', title: 'Email', description: "Your email account, entered once: Squirrelcade sends your notifications from it and reads PriceCharting's export and deal emails in it. One Test checks both." },
  { id: 'features', title: 'Features', description: "The optional parts of Squirrelcade, and the outside services they use: turn on what you want. Help's Services and tools lists every service and tool, with links." },
  { id: 'interface', title: 'Interface', description: 'Theme, cover art, tables and the start page.' },
  { id: 'collection', title: 'Collection', description: "Your collection: updates from PriceCharting's exports and your own files, copies you add, their photos, tests and estimates." },
  { id: 'platforms', title: 'Platforms', description: 'Which consoles count and how they are recognized.' },
  { id: 'catalogs', title: 'Catalogs and matching', description: 'Where catalogs come from and what counts as owning a catalog game.' },
  { id: 'pc', title: 'PC library', description: 'Your PC games from Playnite, and how each storefront counts.' },
  { id: 'wishlist', title: 'Acorns', description: 'Your tastes, as the acorns behind every recommendation (Acorns, in the menu).' },
  { id: 'sources', title: 'Sources', description: 'Outside services Squirrelcade may ask for information.' },
  { id: 'notifications', title: 'Notifications', description: 'Messages after collection updates and when something fails: by email, a phone app, a chat, a webhook or Apprise. Turn one on for its setup steps.' },
  { id: 'storage', title: 'Storage and backups', description: 'Folders and automatic backups.' },
  { id: 'tasks', title: 'Tasks', description: 'How often background jobs run.' },
  { id: 'friends', title: 'Friends', description: "What you share with friends' Squirrelcades, and how trades are balanced." },
  { id: 'ai', title: 'Claude and AI apps', description: 'Let Claude and other AI apps read your collection: the connector, who can connect, guests, and what answers include.' },
  { id: 'security', title: 'Security', description: 'Login, sessions and proxies.' },
] as const;

/** The id of a settings page (see SETTINGS_PAGES). */
export type SettingsPageId = (typeof SETTINGS_PAGES)[number]['id'];
