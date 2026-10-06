import { SETTINGS_PAGES } from '@squirrelcade/core';
import { ActionIcon, Anchor, AppShell, Badge, Burger, Button, Group, Menu, NavLink, ScrollArea, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { useDisclosure, useMediaQuery } from '@mantine/hooks';
import { IconSun, IconVideoFilled, IconChevronDown, IconBook2, IconDeviceDesktop, IconDeviceGamepad2, IconHelp, IconListCheck, IconLogout, IconMenu2, IconPlus, IconServer, IconSettings, IconUser, IconUsersGroup } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ActivityIndicator } from './Activity';
import { Brand } from './Brand';
import { ErrorBoundary } from './ErrorBoundary';
import { GameDrawer } from './GameDrawer';
import { HeaderSearch } from './Search';
import { api } from './api';
import { clearCopy } from './offline';
import { PasswordModal } from './Password';
import { useFeature, usePageTitle, useSession, useSetting, useSettings } from './hooks';
import { DEEP_BUTTON } from './look';
import { Acorn } from './Acorn';

const SYSTEM_PAGES = [
  { path: '/system/status', label: 'Status' },
  { path: '/system/tasks', label: 'Tasks' },
  { path: '/system/backups', label: 'Backups' },
  { path: '/system/logs', label: 'Logs' },
  { path: '/system/users', label: 'Users' },
];

/** A friend as the menu lists them (GET /api/v1/friends). */
interface MenuFriend {
  id: number;
  name: string;
  createdAt: string;
  file: { receivedAt: string } | null;
}

/** Friends named in the menu: the rest are on All friends. */
const MENU_FRIENDS = 8;
/** When a friend was last active: their last file, or when they were added. */
const activity = (f: MenuFriend) => f.file?.receivedAt ?? f.createdAt;

const MAIN_PAGES: Record<string, string> = {
  '/collection': 'Stash',
  '/collection/add': 'Add a game',
  '/collection/copies': 'Copies',
  '/collection/upgrades': 'Upgrades',
  '/collection/improve': 'Improve your collection',
  '/collection/sales': 'Sales',
  '/collection/backlog': 'Backlog',
  '/collection/loans': 'Loans',
  '/collection/sale': 'For sale',
  '/collection/statistics': 'Statistics',
  '/collection/report': 'Collection report',
  '/platforms': 'Platforms',
  '/sets': 'Sets',
  '/friends': 'Friends',
  '/pc': 'PC library',
  '/pc/wishlist': 'PC wishlist',
  '/review': 'Review',
  '/wishlist': 'Acorns wishlist',
  '/acorns': 'Acorns ranking',
  '/wishlist/coming-soon': 'Coming soon',
  '/wishlist/past': 'Past releases',
  '/wishlist/deals': 'Deals',
  '/today': 'Today',
  '/store': 'Store Mode',
  '/store/list': 'Check a list',
  '/updates': 'Stash updates',
  '/notes': 'Your notes',
};

/** The browser tab title for a page; null for a platform's, a set's or a friend's page, which shows its name. */
function pageTitle(path: string): string | null {
  if (path.startsWith('/platforms/') || path.startsWith('/sets/') || path.startsWith('/friends/') || path.startsWith('/help')) return null;
  const settingsPage = SETTINGS_PAGES.find((p) => path === `/settings/${p.id}`);
  if (settingsPage) return `${settingsPage.title} · Settings`;
  return MAIN_PAGES[path] ?? SYSTEM_PAGES.find((p) => p.path === path)?.label ?? '';
}

/** The frame around every page: the header (activity indicator, account menu) and the navigation, which folds away on phones. */
export function Layout({ children }: { children: ReactNode }) {
  const [opened, { toggle, close }] = useDisclosure();
  // On a phone, the redesign's bar at the bottom (0.51.0): Today, Collection, Store Mode, Wishlist, and More (the menu).
  const phone = useMediaQuery('(max-width: 47.99em)') ?? false;
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const { data: settings } = useSettings();
  const path = location.pathname;
  usePageTitle(pageTitle(path), settings?.['general.instanceName'] || 'Squirrelcade');

  // The badge counts look-alike questions; games the catalog holds for review wait on the Review page without nagging.
  // A viewer looks and changes nothing: the owner's pages (Review, updates, settings, system) aren't in their menu.
  const owner = session?.role !== 'viewer';
  // Optional parts that are off (Settings > Features) leave the menu.
  const pcOn = useFeature('pc');
  // PC deals need PC game prices (IsThereAnyDeal or GG.deals).
  const pricesOn = useFeature('itad');
  const pcView = new URLSearchParams(location.search).get('view');
  // Deals come from PriceCharting's emails: listed while collection updates from email read them.
  const mailOn = useFeature('mail');
  const dealEmails = useSetting('mail.deals', true);
  const dealsOn = mailOn && dealEmails !== false;
  // What the owner played and their copies' details are the owner's, unless shared with viewers.
  const playShown = useSetting('security.viewersSeePlay', true) || owner;
  const detailsShown = useSetting('security.viewersSeeCopyDetails', false) || owner;
  const [password, setPassword] = useState(false);
  const review = useQuery({ queryKey: ['catalogs', 'review'], queryFn: () => api<{ lookAlikes: unknown[] }>('/review'), enabled: !!session?.authenticated && owner });
  // Copies a file no longer has wait there too (0.19.0).
  const goneCopies = useQuery({ queryKey: ['collection', 'missing'], queryFn: () => api<unknown[]>('/collection/missing'), enabled: !!session?.authenticated && owner });
  const reviewCount = (review.data?.lookAlikes.length ?? 0) + (goneCopies.data?.length ?? 0);
  // Friends by name in the menu (0.58.0): the most recently active first, at most MENU_FRIENDS; All friends has them all.
  const friends = useQuery({ queryKey: ['friends'], queryFn: () => api<{ friends: MenuFriend[] }>('/friends'), enabled: !!session?.authenticated && owner });
  const friendList = [...(friends.data?.friends ?? [])].sort((a, b) => activity(b).localeCompare(activity(a)) || a.name.localeCompare(b.name));
  // The menu's sections (0.58.0, the owner's layout): For sale and Sales are games going out, so they're under Acorns.
  const inAcorns = path.startsWith('/wishlist') || path === '/acorns' || path === '/collection/add' || path === '/collection/sale' || path === '/collection/sales';
  // Statistics and Report are the Almanac's (2026-10-06), with the consoles and sets; their addresses stay.
  const inAlmanac = path.startsWith('/platforms') || path.startsWith('/sets') || path === '/collection/statistics' || path === '/collection/report';
  const inCollection = (path.startsWith('/collection') && !inAcorns && !inAlmanac) || path === '/updates';
  const reviewBadge =
    reviewCount > 0 ? (
      <Badge size="xs" variant="light" color="yellow">
        {reviewCount}
      </Badge>
    ) : undefined;

  const link = (to: string, label: string, icon?: ReactNode, badge?: ReactNode) => (
    <NavLink key={to} component={Link} to={to} label={label} leftSection={icon} rightSection={badge} active={path === to} onClick={close} />
  );

  async function signOut() {
    await api('/auth/logout', { method: 'POST' });
    // Store Mode's copy of the collection doesn't stay in the browser of someone who signed out.
    await clearCopy();
    await queryClient.invalidateQueries({ queryKey: ['session'] });
    navigate('/');
  }

  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !opened } }} footer={{ height: 64, collapsed: !phone }} padding="md">
      {/* The kit's chrome: header and menu a step darker than the page, a cade line under the header (0.47.0). */}
      <AppShell.Header style={{ background: 'var(--sc-chrome)', borderBottom: '2px solid var(--sc-cade)' }}>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap" className="sc-brand-bar">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Menu" />
            {/* The squirrel and the name lead home, to Today, from every page (the owner, 2026-10-06). */}
            <Link to="/today" className="sc-brand-link" aria-label={`${settings?.['general.instanceName'] || 'Squirrelcade'}: Today`} onClick={close}>
              <Brand name={settings?.['general.instanceName'] || 'Squirrelcade'} />
            </Link>
          </Group>
          <Group gap="xs" wrap="nowrap">
            {/* Store Mode in one tap, the camera already on: how it's used in a shop, on a phone (an icon there; a
                deep green button with its name on a wider screen, as the redesign draws it). */}
            <Tooltip label="Store Mode: scan a game">
              <ActionIcon component={Link} to="/store?scan=1" variant="subtle" color="gray" size="lg" aria-label="Store Mode: scan a game" hiddenFrom="sm">
                <IconVideoFilled size={20} />
              </ActionIcon>
            </Tooltip>
            <Button component={Link} to="/store?scan=1" visibleFrom="sm" radius={10} style={DEEP_BUTTON} leftSection={<IconVideoFilled size={18} />} aria-label="Store Mode: scan a game">
              Store Mode
            </Button>
            <HeaderSearch />
            {owner && <ActivityIndicator />}
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <UnstyledButton aria-label="Account">
                  <Group gap={8} wrap="nowrap">
                    {session?.username ? (
                      <span className="sc-avatar sc-pixel" aria-hidden="true">
                        {session.username.slice(0, 1).toUpperCase()}
                      </span>
                    ) : (
                      <IconUser size={18} />
                    )}
                    <Text size="sm" visibleFrom="xs">
                      {session?.username ?? (session?.via === 'local' ? 'Local network' : 'Signed in')}
                    </Text>
                    {!owner && (
                      <Badge size="xs" variant="light" color="gray" visibleFrom="xs" style={{ textTransform: 'none' }}>
                        Viewer
                      </Badge>
                    )}
                    <IconChevronDown size={14} />
                  </Group>
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                {owner ? (
                  <Menu.Item leftSection={<IconSettings size={16} />} component={Link} to="/settings/security">
                    Account and security
                  </Menu.Item>
                ) : (
                  <Menu.Item leftSection={<IconSettings size={16} />} onClick={() => setPassword(true)}>
                    Change password
                  </Menu.Item>
                )}
                {session?.via === 'session' && (
                  <Menu.Item leftSection={<IconLogout size={16} />} onClick={signOut}>
                    Sign out
                  </Menu.Item>
                )}
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs" style={{ background: 'var(--sc-chrome)', borderRight: '1px solid var(--sc-line)' }}>
        <AppShell.Section grow component={ScrollArea}>
          {link('/today', 'Today', <IconSun size={18} />)}
          {/*
            Like Radarr's menus: a section opens its first page and shows its pages underneath, open while one of them is
            showing. A NavLink with pages under it cancels its own click (to fold them), so it navigates here.
            The Stash (the collection, named for what a squirrel keeps, 2026-10-06): the games you have, and keeping them
            up to date.
          */}
          <NavLink label="Stash" leftSection={<IconDeviceGamepad2 size={18} />} opened={inCollection} onClick={() => navigate('/collection')} childrenOffset={28}>
            {link('/collection', 'Stash')}
            {link('/collection/copies', 'Copies')}
            {link('/collection/upgrades', 'Upgrades')}
            {owner && link('/collection/improve', 'Improve')}
            {playShown && link('/collection/backlog', 'Backlog')}
            {detailsShown && link('/collection/loans', 'Loans')}
            {owner && link('/updates', 'Stash updates')}
          </NavLink>
          {/* Acorns: games coming in (the Acorns wishlist and its pages), games going out (for sale, sold), and the
              ranking: the rules that give acorns (D121; the owner's layout in 0.58.0). */}
          <NavLink label="Acorns" leftSection={<Acorn size={18} />} opened={inAcorns} onClick={() => navigate('/wishlist')} childrenOffset={28}>
            {owner && link('/collection/add', 'Add a game')}
            {link('/wishlist', 'Acorns wishlist')}
            {link('/wishlist/coming-soon', 'Coming soon')}
            {link('/wishlist/past', 'Past releases')}
            {dealsOn && link('/wishlist/deals', 'Deals')}
            {detailsShown && link('/collection/sale', 'For sale')}
            {owner && link('/collection/sales', 'Sales')}
            {owner && link('/acorns', 'Acorns ranking')}
          </NavLink>
          {/* The Almanac (Data until 2026-10-06): the consoles with their catalogs, sets of your own, and the collection
              counted (Statistics) and listed to print (Report). */}
          <NavLink label="Almanac" leftSection={<IconBook2 size={18} />} opened={inAlmanac} onClick={() => navigate('/platforms')} childrenOffset={28}>
            {link('/platforms', 'Platforms')}
            {link('/sets', 'Sets')}
            {link('/collection/statistics', 'Statistics')}
            {link('/collection/report', 'Report')}
          </NavLink>
          {/* Friends (0.56.0, D131): all of them, then each by name (their page has Compare and Trades), and adding one. */}
          {owner && (
            <NavLink label="Friends" leftSection={<IconUsersGroup size={18} />} opened={path.startsWith('/friends')} onClick={() => navigate('/friends')} childrenOffset={28}>
              {link('/friends', 'All friends', undefined, friendList.length > MENU_FRIENDS ? <Badge size="xs" variant="light" color="gray">{friendList.length}</Badge> : undefined)}
              {friendList.slice(0, MENU_FRIENDS).map((f) => (
                <NavLink key={f.id} component={Link} to={`/friends/${f.id}`} label={f.name} description={f.file ? undefined : 'No file yet'} active={path === `/friends/${f.id}`} onClick={close} />
              ))}
              <NavLink component={Link} to="/friends?add=1" label="Add a friend" leftSection={<IconPlus size={14} />} active={false} onClick={close} />
            </NavLink>
          )}
          {/* The PC library and its pages: its wishlist, and the wishlist's games on sale now (0.45.0). */}
          {pcOn && (
            <NavLink label="PC library" leftSection={<IconDeviceDesktop size={18} />} opened={path.startsWith('/pc')} onClick={() => navigate('/pc')} childrenOffset={28}>
              {link('/pc', 'PC library')}
              <NavLink component={Link} to="/pc/wishlist" label="PC wishlist" active={path === '/pc/wishlist' && pcView !== 'deals'} onClick={close} />
              {pricesOn && <NavLink component={Link} to="/pc/wishlist?view=deals" label="PC deals" active={path === '/pc/wishlist' && pcView === 'deals'} onClick={close} />}
            </NavLink>
          )}
          {owner && (
            <NavLink label="Settings" leftSection={<IconSettings size={18} />} defaultOpened={path.startsWith('/settings')} childrenOffset={28}>
              {SETTINGS_PAGES.filter((p) => p.id !== 'wishlist' && (p.id !== 'pc' || pcOn)).map((p) => link(`/settings/${p.id}`, p.title))}
            </NavLink>
          )}
          {owner && (
            // Review sits under System (0.45.0); its count shows on System too, so it's seen with the menu folded.
            <NavLink
              label="System"
              leftSection={<IconServer size={18} />}
              rightSection={reviewBadge}
              defaultOpened={path.startsWith('/system') || path === '/review'}
              childrenOffset={28}
            >
              {link('/review', 'Review', <IconListCheck size={16} />, reviewBadge)}
              {SYSTEM_PAGES.map((p) => link(p.path, p.label))}
            </NavLink>
          )}
          <NavLink component={Link} to="/help" label="Help" leftSection={<IconHelp size={18} />} active={path.startsWith('/help')} onClick={close} />
          {/* PriceCharting supports Squirrelcade's use of its values on one condition: credit it, with a link (2026-10-06). */}
          <Text size="xs" className="sc-muted" px="sm" pt="md" pb="xs">
            Values from{' '}
            <Anchor href="https://www.pricecharting.com" target="_blank" rel="noreferrer" size="xs" inherit>
              PriceCharting
            </Anchor>
          </Text>
        </AppShell.Section>
      </AppShell.Navbar>
      <PasswordModal opened={password} onClose={() => setPassword(false)} />

      <AppShell.Footer hiddenFrom="sm" withBorder={false}>
        <nav className="sc-tabbar" aria-label="Main places">
          {(
            [
              ['/today', 'Today', <IconSun size={22} />, path === '/today' || path === '/'],
              ['/collection', 'Stash', <IconDeviceGamepad2 size={22} />, inCollection],
            ] as [string, string, ReactNode, boolean][]
          ).map(([to, label, icon, on]) => (
            <Link key={to} to={to} className="sc-tab" aria-current={on ? 'page' : undefined} onClick={close}>
              {icon}
              {label}
            </Link>
          ))}
          <Link to="/store?scan=1" className="sc-tab" aria-current={path === '/store' ? 'page' : undefined} onClick={close}>
            <span className="sc-tab-store" aria-hidden="true">
              <IconVideoFilled size={18} />
            </span>
            Store Mode
          </Link>
          <Link to="/wishlist" className="sc-tab" aria-current={inAcorns ? 'page' : undefined} onClick={close}>
            <Acorn size={22} />
            Acorns
          </Link>
          <button type="button" className="sc-tab" aria-expanded={opened} onClick={toggle}>
            <IconMenu2 size={22} />
            More
          </button>
        </nav>
      </AppShell.Footer>

      <AppShell.Main>
        {children}
        {/* Any page opens a game here with GameTitle (the "game" URL parameter). */}
        <ErrorBoundary resetKey={location.search} compact>
          <GameDrawer />
        </ErrorBoundary>
      </AppShell.Main>
    </AppShell>
  );
}
