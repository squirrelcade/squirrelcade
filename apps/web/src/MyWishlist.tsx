import { Button } from '@mantine/core';
import { IconHeart, IconHeartFilled } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from './api';
import { notifyError, useCanEdit, useSetting } from './hooks';

/** Where a game on My wishlist came from (the server's `source`). */
export type WishSource = 'suggestions' | 'game' | 'store';

export interface MyWish {
  platformKey: string;
  platform: string;
  title: string;
  source: string;
  addedAt: string;
}

/** What the wishlist is (Settings > Acorns ranking > Your wishlist > What your wishlist is): 'mine' is picked by hand. */
export function useWishlistIsMine(): boolean {
  return useSetting('wishlist.source', 'suggested') === 'mine';
}

const norm = (title: string) => title.trim().toLowerCase();
export const wishKey = (platformKey: string, title: string) => `${platformKey}|${norm(title)}`;

/** My wishlist's games, fetched once and kept (TanStack Query): every Want it and Add button reads the same list. */
export function useMyWishlist(enabled = true) {
  const query = useQuery({ queryKey: ['wishlist', 'mine'], queryFn: () => api<{ games: MyWish[] }>('/wishlist/mine'), enabled, staleTime: 60_000 });
  const keys = new Set((query.data?.games ?? []).map((g) => wishKey(g.platformKey, g.title)));
  return { ready: query.data !== undefined, has: (platformKey: string, title: string) => keys.has(wishKey(platformKey, title)) };
}

/** A change to My wishlist makes the server work the wishlist out again, so everything built on it is read again. */
function refresh(queryClient: QueryClient) {
  for (const key of ['wishlist', 'game', 'acorns', 'places', 'platform', 'today']) void queryClient.invalidateQueries({ queryKey: [key] });
}

/** Put a game on My wishlist, or take it off. */
export function useWishlistChange() {
  const queryClient = useQueryClient();
  const add = useMutation({
    mutationFn: (v: { platformKey: string; title: string; source: WishSource }) => api('/wishlist/mine', { method: 'POST', json: v }),
    onSuccess: () => refresh(queryClient),
    onError: (err) => notifyError(err),
  });
  const remove = useMutation({
    mutationFn: (v: { platformKey: string; title: string }) => api(`/wishlist/mine?platform=${encodeURIComponent(v.platformKey)}&title=${encodeURIComponent(v.title)}`, { method: 'DELETE' }),
    onSuccess: () => refresh(queryClient),
    onError: (err) => notifyError(err),
  });
  return { add, remove, busy: add.isPending || remove.isPending };
}

/**
 * Want it / On your wishlist: shown only when the wishlist is the owner's own and the game isn't owned on that console
 * (the caller checks that). `big` is Store Mode's, beside Add it.
 */
export function WantButton({ platformKey, title, source, big }: { platformKey: string; title: string; source: WishSource; big?: boolean }) {
  const mine = useWishlistIsMine();
  const canEdit = useCanEdit();
  const list = useMyWishlist(mine && canEdit);
  const change = useWishlistChange();
  if (!mine || !canEdit || !list.ready) return null;
  const on = list.has(platformKey, title);
  const toggle = () => (on ? change.remove.mutate({ platformKey, title }) : change.add.mutate({ platformKey, title, source }));
  if (big) {
    return (
      <button type="button" className="sc-verdict-add" onClick={toggle} disabled={change.busy} aria-pressed={on} style={{ minWidth: 84, fontSize: 15 }}>
        {on ? <IconHeartFilled size={22} aria-hidden="true" /> : <IconHeart size={22} stroke={2.5} aria-hidden="true" />}
        <span>{on ? 'On your wishlist' : 'Want it'}</span>
      </button>
    );
  }
  return (
    <Button size="compact-sm" variant={on ? 'light' : 'default'} loading={change.busy} onClick={toggle} aria-pressed={on} leftSection={on ? <IconHeartFilled size={14} /> : <IconHeart size={14} />}>
      {on ? 'On your wishlist' : 'Want it'}
    </Button>
  );
}
