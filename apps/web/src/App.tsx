import { FEATURE_HOME, FEATURE_SETTINGS, SETTINGS_PAGES, type FeatureKey } from '@squirrelcade/core';
import { Alert, Button, Center, Group, Loader, Stack, Text, useMantineColorScheme } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router';
import { api, errorMessage } from './api';
import { offlineSession, rememberSession, unreachable, type RememberedSession } from './offline';
import { ErrorBoundary } from './ErrorBoundary';
import { useCanEdit, useFeature, useSession, useSetting, useSettings } from './hooks';
import { Layout } from './Layout';
import { LoginPage } from './pages/Login';

const RELOADED = 'squirrelcade:reloaded-for-update';

/**
 * A page loaded the first time it's opened, so a first visit (Store Mode on a phone, say) downloads only
 * what it shows. After Squirrelcade is updated, a tab opened before still asks for the old version's files,
 * which are gone: it reloads once to get the new ones.
 */
// Pages take different props (or none), so any props.
function page<C extends ComponentType<any>>(load: () => Promise<C>) {
  return lazy(async () => {
    try {
      const component = await load();
      try {
        sessionStorage.removeItem(RELOADED);
      } catch {
        // Storage can be off (private windows); nothing to clear then.
      }
      return { default: component };
    } catch (err) {
      let reloaded = true;
      try {
        reloaded = sessionStorage.getItem(RELOADED) !== null;
        if (!reloaded) sessionStorage.setItem(RELOADED, '1');
      } catch {
        // Without storage, don't risk reloading in a loop.
      }
      if (!reloaded) {
        window.location.reload();
        return new Promise<never>(() => {});
      }
      throw err;
    }
  });
}

// The first-run setup is used once per install (and brings in every setting's definition), so it loads on its own too.
const SetupPage = page(() => import('./pages/Setup').then((m) => m.SetupPage));
const CollectionPage = page(() => import('./pages/Collection').then((m) => m.CollectionPage));
const AddGamePage = page(() => import('./pages/AddGame').then((m) => m.AddGamePage));
const CopiesPage = page(() => import('./pages/Copies').then((m) => m.CopiesPage));
const UpgradesPage = page(() => import('./pages/Upgrades').then((m) => m.UpgradesPage));
const ImprovePage = page(() => import('./pages/Improve').then((m) => m.ImprovePage));
const SalesPage = page(() => import('./pages/Sales').then((m) => m.SalesPage));
const BacklogPage = page(() => import('./pages/Backlog').then((m) => m.BacklogPage));
const LoansPage = page(() => import('./pages/Loans').then((m) => m.LoansPage));
const ForSalePage = page(() => import('./pages/ForSale').then((m) => m.ForSalePage));
const StatisticsPage = page(() => import('./pages/Statistics').then((m) => m.StatisticsPage));
const ReportPage = page(() => import('./pages/Report').then((m) => m.ReportPage));
const ImportsPage = page(() => import('./pages/Imports').then((m) => m.ImportsPage));
const PlatformDetailPage = page(() => import('./pages/PlatformDetail').then((m) => m.PlatformDetailPage));
const PlatformsPage = page(() => import('./pages/Platforms').then((m) => m.PlatformsPage));
const PcLibraryPage = page(() => import('./pages/PcLibrary').then((m) => m.PcLibraryPage));
const PcWishlistPage = page(() => import('./pages/PcWishlist').then((m) => m.PcWishlistPage));
const ComingSoonPage = page(() => import('./pages/ComingSoon').then((m) => m.ComingSoonPage));
const SettingsPage = page(() => import('./pages/Settings').then((m) => m.SettingsPage));
const StorePage = page(() => import('./pages/Store').then((m) => m.StorePage));
const ReviewPage = page(() => import('./pages/Review').then((m) => m.ReviewPage));
const SetsPage = page(() => import('./pages/Sets').then((m) => m.SetsPage));
const SetDetailPage = page(() => import('./pages/Sets').then((m) => m.SetDetailPage));
const BackupsPage = page(() => import('./pages/system/Backups').then((m) => m.BackupsPage));
const LogsPage = page(() => import('./pages/system/Logs').then((m) => m.LogsPage));
const StatusPage = page(() => import('./pages/system/Status').then((m) => m.StatusPage));
const TasksPage = page(() => import('./pages/system/Tasks').then((m) => m.TasksPage));
const WelcomePage = page(() => import('./pages/Welcome').then((m) => m.WelcomePage));
const WishlistPage = page(() => import('./pages/Wishlist').then((m) => m.WishlistPage));
const NotesPage = page(() => import('./pages/Notes').then((m) => m.NotesPage));
const PastReleasesPage = page(() => import('./pages/PastReleases').then((m) => m.PastReleasesPage));
const DealsPage = page(() => import('./pages/Deals').then((m) => m.DealsPage));
const TodayPage = page(() => import('./pages/Today').then((m) => m.TodayPage));
const UsersPage = page(() => import('./pages/system/Users').then((m) => m.UsersPage));
const JoinPage = lazy(() => import('./pages/Join').then((m) => ({ default: m.JoinPage })));
const SharePage = lazy(() => import('./pages/Share').then((m) => ({ default: m.SharePage })));
const HelpPage = page(() => import('./pages/Help').then((m) => m.HelpPage));
const ListCheckPage = page(() => import('./pages/ListCheck').then((m) => m.ListCheckPage));
const ShelfPage = page(() => import('./pages/Shelf').then((m) => m.ShelfPage));
const FriendsPage = page(() => import('./pages/Friends').then((m) => m.FriendsPage));
const FriendPage = page(() => import('./pages/Friends').then((m) => m.FriendPage));
// After an update, what's new (loaded on its own, after the page).
const WhatsNew = page(() => import('./WhatsNew').then((m) => m.WhatsNew));

/** The whole interface: the first-run setup, the sign-in page, or the app with its pages, depending on the session. */
export function App() {
  const queryClient = useQueryClient();
  const session = useSession();
  // With no connection at all, the page may still open (public/sw.js keeps Squirrelcade's files): then the last
  // sign-in on this browser stands in, while Store Mode's copy is here, and Store Mode answers from it.
  const [offline, setOffline] = useState<RememberedSession | null>(null);
  useEffect(() => {
    if (!session.data) return;
    rememberSession(session.data);
    setOffline(null);
  }, [session.data]);
  useEffect(() => {
    if (!session.isError || !unreachable(session.error)) return;
    let live = true;
    void offlineSession().then((s) => live && setOffline(s));
    return () => {
      live = false;
    };
  }, [session.isError, session.error]);

  useEffect(() => {
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ['session'] });
    window.addEventListener('squirrelcade:session', refresh);
    return () => window.removeEventListener('squirrelcade:session', refresh);
  }, [queryClient]);

  // An invite link's page, signed in or not (it signs its visitor in).
  const joining = /^\/join\/([A-Za-z0-9_-]{16,64})$/.exec(window.location.pathname);
  if (joining) {
    return (
      <Suspense fallback={<Loader />}>
        <JoinPage token={joining[1]!} />
      </Suspense>
    );
  }
  // A share link's page (the wishlist, or the games for sale), for anyone, signed in or not.
  const sharing = /^\/share\/([A-Za-z0-9_-]{16,64})$/.exec(window.location.pathname);
  if (sharing) {
    return (
      <Suspense fallback={<Loader />}>
        <SharePage token={sharing[1]!} />
      </Suspense>
    );
  }
  // With no connection, the last sign-in stands in (while the server is tried again in the background).
  if (!session.data && offline) return <Shell noConnection />;
  if (session.isPending) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }
  if (session.isError) {
    return (
      <Center h="100vh" p="md">
        <Stack align="center">
          <Alert color="red" title="Can't reach Squirrelcade">
            {errorMessage(session.error)}
          </Alert>
          <Button onClick={() => session.refetch()}>Try again</Button>
        </Stack>
      </Center>
    );
  }
  if (session.data.setupRequired)
    return (
      <Suspense fallback={<Loader />}>
        <SetupPage />
      </Suspense>
    );
  if (!session.data.authenticated) return <LoginPage />;
  return <Shell />;
}

/** The start page; a new install with no collection yet starts with the welcome guide. */
function Home({ start }: { start: string }) {
  const canEdit = useCanEdit();
  const summary = useQuery({ queryKey: ['collection', 'summary'], queryFn: () => api<{ totals: { games: number }; currentImport: unknown | null }>('/collection/summary') });
  if (summary.isPending) return <Loader />;
  // The welcome guide is the owner's; a viewer of an empty collection sees the empty Collection page.
  const empty = canEdit && summary.data && summary.data.totals.games === 0 && !summary.data.currentImport;
  return <Navigate to={empty ? '/welcome' : `/${start}`} replace />;
}

/** A page of an optional part (Settings > Features): while the part is off, it says so, and the owner where to turn it on. */
function FeatureOn({ feature, name, children }: { feature: FeatureKey; name: string; children: ReactNode }) {
  const on = useFeature(feature);
  const canEdit = useCanEdit();
  if (on) return <>{children}</>;
  return (
    <Stack align="center" mt="xl" gap="sm">
      <Text>{name} is off.</Text>
      {canEdit && (
        <Button component={Link} to={`/settings/${FEATURE_HOME[feature] ?? 'features'}#setting-${FEATURE_SETTINGS[feature]}`} variant="light">
          Turn it on: Settings › {SETTINGS_PAGES.find((p) => p.id === (FEATURE_HOME[feature] ?? 'features'))?.title}
        </Button>
      )}
    </Stack>
  );
}

/** A page of something a viewer sees only when the owner shares it (Settings > Security > Viewers): otherwise they're told so. */
function SharedWithViewers({ setting, children }: { setting: 'security.viewersSeePlay' | 'security.viewersSeeCopyDetails'; children: ReactNode }) {
  const canEdit = useCanEdit();
  const shared = useSetting(setting, setting === 'security.viewersSeePlay');
  if (canEdit || shared) return <>{children}</>;
  return (
    <Stack align="center" mt="xl" gap="sm">
      <Text>The collection's owner keeps this page to themselves.</Text>
      <Button component={Link} to="/collection" variant="light">
        Go to the collection
      </Button>
    </Stack>
  );
}

/** A page that moved: its new address, keeping the part after # (a setting to go to). */
function KeepHash({ to }: { to: string }) {
  const { hash } = useLocation();
  return <Navigate to={`${to}${hash}`} replace />;
}

/**
 * Back to an AI app's sign-in page (0.55.0): it sends someone not signed in here, to the sign-in, and on to it again.
 * Only its own address is followed.
 */
function AiSignIn() {
  const { search } = useLocation();
  const next = new URLSearchParams(search).get('next') ?? '';
  const ok = /^\/oauth\/authorize\?request=[A-Za-z0-9_-]{8,64}$/.test(next);
  useEffect(() => {
    if (ok) window.location.replace(next);
  }, [ok, next]);
  return ok ? <Loader /> : <Navigate to="/" replace />;
}

/** A page only the collection's owner uses (settings, the system, Review, updates): a viewer who opens it is told so. */
function OwnerOnly({ children }: { children: ReactNode }) {
  const canEdit = useCanEdit();
  if (canEdit) return <>{children}</>;
  return (
    <Stack align="center" mt="xl" gap="sm">
      <Text>This page is for the collection's owner.</Text>
      <Button component={Link} to="/collection" variant="light">
        Go to the collection
      </Button>
    </Stack>
  );
}

function ThemeSync() {
  const { data } = useSettings();
  const { setColorScheme } = useMantineColorScheme();
  useEffect(() => {
    if (data) setColorScheme(data['interface.theme']);
  }, [data, setColorScheme]);
  return null;
}

function Shell({ noConnection = false }: { noConnection?: boolean }) {
  const { data: settings } = useSettings();
  const { pathname } = useLocation();
  const start = settings?.['interface.startPage'] ?? 'today';
  const offline = settings?.['interface.storeOffline'];
  // Store Mode's code loads in the background a few seconds after sign-in, so Store Mode still opens when the
  // connection is gone later (it then answers from its copy; see offline.ts).
  useEffect(() => {
    if (!offline) return;
    const later = window.setTimeout(() => void import('./pages/Store').catch(() => undefined), 3000);
    return () => window.clearTimeout(later);
  }, [offline]);
  // The service worker (public/sw.js) keeps Squirrelcade's own files on the device, so it opens with no connection at
  // all; it goes with the same setting, and turning that off removes it and its files. Never in development.
  useEffect(() => {
    if (offline === undefined || !import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) return;
    if (offline) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    } else {
      void navigator.serviceWorker.getRegistrations().then((all) => all.forEach((r) => void r.unregister()));
      void caches?.delete('squirrelcade-files');
    }
  }, [offline]);
  return (
    <Layout>
      <ThemeSync />
      {noConnection && (
        <Alert color="yellow" variant="light" mb="sm" title="No connection">
          <Stack gap={6}>
            <Text size="sm">Store Mode answers from this phone's copy of its answers; the other pages wait for Squirrelcade.</Text>
            <Group gap="xs">
              <Button size="compact-sm" variant="default" onClick={() => window.location.reload()}>
                Try again
              </Button>
              {pathname !== '/store' && (
                <Button component={Link} to="/store" size="compact-sm" variant="light">
                  Store Mode
                </Button>
              )}
            </Group>
          </Stack>
        </Alert>
      )}
      <Suspense fallback={null}>
        <WhatsNew />
      </Suspense>
      <ErrorBoundary resetKey={pathname}>
        <Suspense fallback={<Loader />}>
          <Routes>
            <Route path="/" element={<Home start={start} />} />
            <Route path="/welcome" element={<OwnerOnly><WelcomePage /></OwnerOnly>} />
            <Route path="/collection" element={<CollectionPage />} />
            <Route path="/collection/add" element={<OwnerOnly><AddGamePage /></OwnerOnly>} />
            <Route path="/collection/copies" element={<CopiesPage />} />
            <Route path="/collection/upgrades" element={<UpgradesPage />} />
            <Route path="/collection/improve" element={<OwnerOnly><ImprovePage /></OwnerOnly>} />
            <Route path="/collection/sales" element={<OwnerOnly><SalesPage /></OwnerOnly>} />
            <Route path="/collection/backlog" element={<SharedWithViewers setting="security.viewersSeePlay"><BacklogPage /></SharedWithViewers>} />
            <Route path="/collection/loans" element={<SharedWithViewers setting="security.viewersSeeCopyDetails"><LoansPage /></SharedWithViewers>} />
            <Route path="/collection/sale" element={<SharedWithViewers setting="security.viewersSeeCopyDetails"><ForSalePage /></SharedWithViewers>} />
            <Route path="/collection/statistics" element={<StatisticsPage />} />
            <Route path="/collection/report" element={<ReportPage />} />
            <Route path="/platforms" element={<PlatformsPage />} />
            <Route path="/platforms/:key" element={<PlatformDetailPage />} />
            <Route path="/sets" element={<SetsPage />} />
            <Route path="/sets/:key" element={<SetDetailPage />} />
            <Route path="/pc" element={<FeatureOn feature="pc" name="The PC library"><PcLibraryPage /></FeatureOn>} />
            <Route path="/wishlist" element={<WishlistPage />} />
            <Route path="/acorns" element={<OwnerOnly><SettingsPage pageId="wishlist" /></OwnerOnly>} />
            <Route path="/wishlist/scoring" element={<KeepHash to="/acorns" />} />
            <Route path="/pc/wishlist" element={<FeatureOn feature="pc" name="The PC library"><PcWishlistPage /></FeatureOn>} />
            {/* The PC wishlist's address before it moved under the PC library (0.45.0). */}
            <Route path="/wishlist/pc" element={<Navigate to="/pc/wishlist" replace />} />
            <Route path="/wishlist/coming-soon" element={<ComingSoonPage />} />
            <Route path="/wishlist/past" element={<PastReleasesPage />} />
            <Route path="/wishlist/deals" element={<DealsPage />} />
            <Route path="/today" element={<TodayPage />} />
            <Route path="/store" element={<StorePage />} />
            <Route path="/store/list" element={<ListCheckPage />} />
            <Route path="/store/shelf" element={<OwnerOnly><ShelfPage /></OwnerOnly>} />
            <Route path="/friends" element={<OwnerOnly><FriendsPage /></OwnerOnly>} />
            <Route path="/friends/:id" element={<OwnerOnly><FriendPage /></OwnerOnly>} />
            <Route path="/updates" element={<OwnerOnly><ImportsPage /></OwnerOnly>} />
            <Route path="/imports" element={<Navigate to="/updates" replace />} />
            <Route path="/ai-sign-in" element={<AiSignIn />} />
            <Route path="/settings" element={<Navigate to="/settings/general" replace />} />
            <Route path="/settings/:page" element={<OwnerOnly><SettingsPage /></OwnerOnly>} />
            <Route path="/system" element={<Navigate to="/system/status" replace />} />
            <Route path="/system/status" element={<OwnerOnly><StatusPage /></OwnerOnly>} />
            <Route path="/system/tasks" element={<OwnerOnly><TasksPage /></OwnerOnly>} />
            <Route path="/system/backups" element={<OwnerOnly><BackupsPage /></OwnerOnly>} />
            <Route path="/system/logs" element={<OwnerOnly><LogsPage /></OwnerOnly>} />
            <Route path="/system/users" element={<OwnerOnly><UsersPage /></OwnerOnly>} />
            <Route path="/review" element={<OwnerOnly><ReviewPage /></OwnerOnly>} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="/help/:topic" element={<HelpPage />} />
            <Route path="/notes" element={<NotesPage />} />
            <Route
              path="*"
              element={
                <Text c="dimmed" ta="center" mt="xl">
                  Page not found.
                </Text>
              }
            />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </Layout>
  );
}
