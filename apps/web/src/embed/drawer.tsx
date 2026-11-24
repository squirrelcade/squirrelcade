import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import '@fontsource/silkscreen/400.css';
import '../brand.css';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate, useSearchParams } from 'react-router';
import { apiTransport } from '../api';
import { GameDrawer } from '../GameDrawer';
import { playerOptions } from '../RootsPart';
import { makeQueryClient, readableColors, theme } from '../theme';

/**
 * The game drawer on a store's page (D245): the Deal check extension opens this page in a frame over the store's page,
 * and it shows Squirrelcade's own drawer for one game. It runs inside the extension, so it asks Squirrelcade through
 * the extension (with its key): a store's https page can't show the http address Squirrelcade has at home.
 */

declare const chrome: { runtime: { sendMessage: (m: unknown) => Promise<({ status: number; type: string; body: string } & { dataUrl?: string }) | undefined> } };

const params = new URLSearchParams(location.search);
const game = params.get('game') ?? '';
const server = params.get('server') ?? '';

apiTransport.fetch = async (url, init) => {
  const answer = await chrome.runtime.sendMessage({
    type: 'api',
    url,
    method: init.method ?? 'GET',
    contentType: (init.headers as Record<string, string> | undefined)?.['content-type'] ?? null,
    body: typeof init.body === 'string' ? init.body : null,
  });
  if (!answer) return new Response(JSON.stringify({ error: 'error', message: 'The extension didn’t answer.' }), { status: 502, headers: { 'content-type': 'application/json' } });
  return new Response(answer.status === 204 ? null : answer.body, { status: answer.status, headers: { 'content-type': answer.type } });
};

/**
 * The drawer closed: the store's page takes the frame away. A move to another of Squirrelcade's pages (a magazine's
 * issue, a series, a console: a link or a button that navigates) opens that page at home in a new tab, and the drawer
 * stays where it was.
 */
function CloseWatch() {
  const [search] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const open = search.has('game');
  useEffect(() => {
    if (location.pathname !== '/') {
      if (server) window.open(new URL(`${location.pathname}${location.search}`, server).href, '_blank', 'noopener');
      navigate(-1);
      return;
    }
    if (!open) window.parent.postMessage({ type: 'squirrelcade-drawer-close' }, '*');
  }, [open, location.pathname, location.search, navigate]);
  return null;
}

// Pictures kept by Squirrelcade (videos' thumbnails, magazine pages): the frame can't load them from its http address,
// so each comes through the extension as data, once.
const pictures = new Map<string, Promise<string | null>>();
function picture(path: string): Promise<string | null> {
  let p = pictures.get(path);
  if (!p) {
    p = chrome.runtime.sendMessage({ type: 'picture', url: path }).then((a) => (a as { dataUrl?: string } | undefined)?.dataUrl ?? null);
    pictures.set(path, p);
  }
  return p;
}
const lift = (img: HTMLImageElement) => {
  const src = img.getAttribute('src');
  if (!src?.startsWith('/api/')) return;
  img.removeAttribute('src');
  void picture(src).then((d) => {
    if (d) img.src = d;
  });
};
new MutationObserver((changes) => {
  for (const c of changes) {
    if (c.type === 'attributes' && c.target instanceof HTMLImageElement) lift(c.target);
    for (const n of c.addedNodes) {
      if (n instanceof HTMLImageElement) lift(n);
      else if (n instanceof Element) n.querySelectorAll('img').forEach(lift);
    }
  }
}).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });

playerOptions.external = true;

// A link to one of Squirrelcade's pages opens it in a new tab, at home.
document.addEventListener(
  'click',
  (ev) => {
    const a = (ev.target as HTMLElement | null)?.closest?.('a[href^="/"]');
    if (!a || !server) return;
    ev.preventDefault();
    window.open(new URL(a.getAttribute('href')!, server).href, '_blank', 'noopener');
  },
  true,
);

const queryClient = makeQueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="dark" cssVariablesResolver={readableColors}>
      <Notifications position="top-right" />
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/?${new URLSearchParams({ game })}`]}>
          <CloseWatch />
          <GameDrawer />
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
);
