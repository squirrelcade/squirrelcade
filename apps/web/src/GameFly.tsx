import { matchKey } from '@squirrelcade/core';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { money } from './format';

/** A game's prices at GameFly (GET /api/v1/gamefly, D174), read by a task in the background. */
export interface GameFlyPrice {
  platformKey: string;
  title: string;
  newCents: number | null;
  usedCents: number | null;
  url: string | null;
}

/** GameFly's price for a game, when Settings > Sources > GameFly is on and it sells it: one fetch, kept for every list. */
export function useGameFly(): (platformKey: string, title: string) => GameFlyPrice | undefined {
  const prices = useQuery({
    queryKey: ['gamefly'],
    queryFn: () => api<{ on: boolean; prices: GameFlyPrice[] }>('/gamefly'),
    staleTime: 10 * 60_000,
    select: (d) => new Map(d.prices.map((p) => [`${p.platformKey}|${matchKey(p.title)}`, p])),
  });
  return (platformKey, title) => prices.data?.get(`${platformKey}|${matchKey(title)}`);
}

/** "GameFly $7.50 used · $14.99 new": its cheapest used price first, as the owner shops. */
export function gameFlyLabel(p: GameFlyPrice, currency = 'USD'): string {
  const parts = [p.usedCents !== null ? `${money(p.usedCents, currency)} used` : null, p.newCents !== null ? `${money(p.newCents, currency)} new` : null].filter(Boolean);
  return `GameFly ${parts.join(' · ')}`;
}
