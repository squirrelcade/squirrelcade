import { Box, Button, Group, RingProgress, Stack, Text, Tooltip, UnstyledButton, type MantineSpacing } from '@mantine/core';
import { IconArrowsShuffle, IconCurrencyDollar, IconExternalLink } from '@tabler/icons-react';
import { useMediaQuery } from '@mantine/hooks';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { GameCover, useOpenGame } from '../GameDrawer';
import { count, money, timeAgo } from '../format';
import { Acorn, Acorns, Star } from '../Acorn';
import { notifyError, useCanEdit, useSetting } from '../hooks';
import { DEEP_BUTTON, dot } from '../look';
import { PreferencePicker } from '../Preference';

/** Today's game (GET /api/v1/gotd). */
interface DayGame {
  date: string;
  /** Which of the day's draws it is (1 for the first). */
  pick: number;
  platformKey: string;
  platform: string;
  title: string;
  score: number;
  priority: string;
  rank: number;
  reasons: { label: string; points: number }[];
  /** Its other points together, before the score is fitted to the scale. */
  otherPoints: number;
  /** IGDB's rating of it (critics and players, out of 100) and how many ratings that rests on. */
  reviews: { rating: number; count: number } | null;
  why: string | null;
  released: string | null;
  anniversary: boolean;
  coverId: string | null;
  preference: string | null;
  links: { name: string; url: string }[];
  /** A fresh deal on it from PriceCharting's emails. */
  deal: { date: string; priceCents: number | null; saveCents: number | null; listingTitle: string | null; listingUrl: string | null } | null;
}

/** The card's tag: the best reason it's today's game. */
function tagOf(g: DayGame, years: number): string {
  if (g.deal) return 'Deal today';
  if (g.anniversary && years > 0) return `Out ${years} ${years === 1 ? 'year' : 'years'} ago this week`;
  if (g.reasons.some((r) => /top 100/i.test(r.label))) return 'Fills a Top 100 gap';
  return 'From your wishlist';
}

/**
 * The game of the day, on Today and at the top of the Wishlist page (Settings > Notifications > Game of the day): one
 * game you don't have, picked from the top of the wishlist by its own rules, as the redesign draws it (0.48.0): a green
 * strip with why it's today's, its box, its score as a ring with the points that count most, the price and shop
 * buttons, your preference and "Another one".
 */
export function GameOfTheDayCard({ mb, className }: { mb?: MantineSpacing; className?: string }) {
  const on = useSetting('gotd.enabled', false);
  const currency = useSetting('general.currency', 'USD');
  const canEdit = useCanEdit();
  const open = useOpenGame();
  // The box a little smaller on a phone, so the name and the score come sooner.
  const wide = useMediaQuery('(min-width: 40em)') ?? true;
  const queryClient = useQueryClient();
  const day = useQuery({ queryKey: ['gotd'], queryFn: () => api<{ game: DayGame | null }>('/gotd'), enabled: on === true, staleTime: 5 * 60_000 });
  const another = useMutation({
    mutationFn: () => api<{ game: DayGame | null }>('/gotd/another', { method: 'POST' }),
    onSuccess: (data) => queryClient.setQueryData(['gotd'], data),
    onError: (err) => notifyError(err),
  });
  const g = day.data?.game;
  if (!on || !g) return null;
  const years = g.released ? Number(g.date.slice(0, 4)) - Number(g.released.slice(0, 4)) : 0;
  const [price, ...shops] = g.links;
  // Its biggest points, and its other points together ("Everything else"), each as long as its share of the largest.
  const rest = Math.round(g.otherPoints ?? 0);
  const bars = [...g.reasons.map((r) => ({ label: r.label, points: r.points, faint: false })), ...(rest > 0 ? [{ label: 'Everything else', points: rest, faint: true }] : [])];
  const largest = Math.max(1, ...bars.map((b) => b.points));
  return (
    <Box component="article" mb={mb} className={`sc-card ${className ?? ''}`} aria-label="Game of the day" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div className="sc-strip">
        <Group gap={12} wrap="wrap">
          <span className="sc-pixel" style={{ fontSize: 15 }}>
            Game of the Day
          </span>
          <span className="sc-strip-pill">{tagOf(g, years)}</span>
        </Group>
        {g.pick > 1 && <span style={{ fontSize: 13 }}>Pick {g.pick} today</span>}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, padding: 24 }}>
        <GameCover platformKey={g.platformKey} title={g.title} id={g.coverId} width={wide ? 150 : 96} placeholder />
        <Stack gap={12} style={{ flex: '1 1 320px', minWidth: 0 }}>
          <h2 className="sc-gotd-title">
            <UnstyledButton onClick={() => open(g.platformKey, g.title)} aria-label={`Show ${g.title}`} style={{ font: 'inherit', color: 'inherit', textAlign: 'start' }}>
              {g.title}
            </UnstyledButton>
          </h2>
          <Group gap={8}>
            <span className="sc-chip">
              <span className="sc-dot" style={dot(g.platformKey, g.platform)} />
              {g.platform}
            </span>
            <span className="sc-chip">#{g.rank} on your wishlist</span>
            <span className="sc-chip">{g.priority} priority</span>
          </Group>
          <Group gap={24} align="center" wrap="wrap" mt={4}>
            <RingProgress
              size={104}
              thickness={7}
              roundCaps
              rootColor="var(--sc-line)"
              sections={[{ value: Math.max(0, Math.min(100, g.score)), color: 'var(--sc-cade)' }]}
              aria-label={`${g.score} acorns`}
              label={
                <Stack gap={2} align="center">
                  <span className="sc-score">{g.score}</span>
                  <span className="sc-muted" style={{ fontSize: 10, letterSpacing: '0.06em', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    <Acorn size={11} />
                    ACORNS
                  </span>
                </Stack>
              }
            />
            {g.reviews && (
              <Tooltip label={`IGDB's rating, from ${count(g.reviews.count)} ${g.reviews.count === 1 ? 'rating' : 'ratings'} (critics and players)`}>
                <RingProgress
                  size={104}
                  thickness={7}
                  roundCaps
                  rootColor="var(--sc-line)"
                  sections={[{ value: Math.max(0, Math.min(100, g.reviews.rating)), color: 'var(--sc-gold-fill)' }]}
                  aria-label={`Reviews ${g.reviews.rating} out of 100, from ${count(g.reviews.count)} ratings`}
                  label={
                    <Stack gap={2} align="center">
                      <span className="sc-score">{g.reviews.rating}</span>
                      <span className="sc-muted" style={{ fontSize: 10, letterSpacing: '0.06em', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <Star size={10} />
                        REVIEWS
                      </span>
                    </Stack>
                  }
                />
              </Tooltip>
            )}
            {bars.length > 0 && (
              <Stack gap={8} style={{ flex: '1 1 240px', minWidth: 0 }}>
                <span className="sc-label">Where its acorns come from</span>
                {bars.map((b) => (
                  <div key={b.label} title={`${b.label}: +${b.points} acorns`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(60px, 140px) 52px', gap: 10, alignItems: 'center', fontSize: 14 }}>
                    <span className="sc-soft" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {b.label}
                    </span>
                    <span className="sc-meter" aria-hidden="true">
                      <span style={{ width: `${Math.round((b.points / largest) * 100)}%`, ...(b.faint ? { '--fill': 'var(--sc-line-strong)' } : {}) }} />
                    </span>
                    <span style={{ fontWeight: 700, textAlign: 'right' }}>
                      <Acorns n={`+${b.points}`} size={11} />
                    </span>
                  </div>
                ))}
              </Stack>
            )}
          </Group>
          {g.deal && g.deal.priceCents !== null && (
            <Text size="sm">
              <span className="sc-tag" data-tone="have" style={{ marginRight: 8 }}>
                Deal
              </span>
              {money(g.deal.priceCents, currency)} on eBay{g.deal.saveCents ? `, ${money(g.deal.saveCents, currency)} below the market value` : ''} (PriceCharting, {timeAgo(g.deal.date)})
            </Text>
          )}
          {g.why && (
            <Text size="sm" className="sc-soft" lineClamp={3}>
              {g.why}
            </Text>
          )}
        </Stack>
      </div>
      <div className="sc-foot" style={{ marginTop: 'auto' }}>
        {price && (
          <Button component="a" href={price.url} target="_blank" rel="noreferrer" size="sm" radius={8} leftSection={<IconCurrencyDollar size={16} />}>
            Price on {price.name}
          </Button>
        )}
        {g.deal?.listingUrl && (
          <Button component="a" href={g.deal.listingUrl} target="_blank" rel="noreferrer" size="sm" radius={8} variant="default" rightSection={<IconExternalLink size={13} />}>
            See the deal
          </Button>
        )}
        {shops.map((s) => (
          <Button key={s.name} component="a" href={s.url} target="_blank" rel="noreferrer" size="sm" radius={8} variant="default">
            {s.name}
          </Button>
        ))}
        <span style={{ flex: '1 1 0' }} />
        {canEdit && <PreferencePicker platformKey={g.platformKey} title={g.title} value={g.preference} compact />}
        {canEdit && (
          <Button size="sm" radius={8} style={DEEP_BUTTON} leftSection={<IconArrowsShuffle size={16} />} loading={another.isPending} onClick={() => another.mutate()}>
            Another one
          </Button>
        )}
      </div>
    </Box>
  );
}
