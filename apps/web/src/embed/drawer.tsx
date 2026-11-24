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
import { MemoryRouter, useSearchParams } from 'react-router';
import { apiTransport } from '../api';
import { GameDrawer } from '../GameDrawer';
import { makeQueryClient, readableColors, theme } from '../theme';

/**
 * The game drawer on a store's page (D245): the Deal check extension opens this page in a frame over the store's page,
 * and it shows Squirrelcade's own drawer for one game. It runs inside the extension, so it asks Squirrelcade through
 * the extension (with its key): a store's https page can't show the http address Squirrelcade has at home.
 */

declare const chrome: { runtime: { sendMessage: (m: unknown) => Promise<{ status: number; type: string; body: string } | undefined> } };

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

/** The drawer closed: the store's page takes the frame away. */
function CloseWatch() {
  const [search] = useSearchParams();
  const open = search.has('game');
  useEffect(() => {
    if (!open) window.parent.postMessage({ type: 'squirrelcade-drawer-close' }, '*');
  }, [open]);
  return null;
}

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
