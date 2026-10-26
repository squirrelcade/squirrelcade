import { RingProgress, Stack, Text, Tooltip } from '@mantine/core';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Acorn, Star } from './Acorn';
import { Cover } from './components';
import { count } from './format';
import { useSetting } from './hooks';
export { RommChip } from './Romm';

/**
 * One header for a game wherever it's shown large (D165, the owner: "consistent with the game of the day... anywhere
 * else"): the game page, Game of the Day, Store Mode's answer. Its pieces: chips, the stars beside the name, and two
 * circles (Worth for a game you have, Acorns for one you don't, and Reviews).
 */

/** A star beside a game's name (GET /api/v1/game's stars): its Top 100 place, best-selling, an award, critics' favorite, a launch title. */
export interface GameStar {
  kind: 'top100' | 'bestselling' | 'award' | 'critics' | 'launch';
  label: string;
  detail: string;
  href: string | null;
}

/** The Reviews circle's number: Metacritic's when known, IGDB's rating otherwise. */
export interface HeaderReviews {
  score: number;
  count: number | null;
  source: 'metacritic' | 'igdb';
}


const clamp = (n: number) => Math.max(0, Math.min(100, n));

/**
 * A circle as Game of the Day draws them: a ring filled to a score with its number in the pixel face, and what it is
 * under the number. Acorns and Worth in the cade green, Reviews in gold.
 */
export function ScoreRing({ kind, fill, text, sub, size = 104, tooltip, label }: { kind: 'acorns' | 'reviews' | 'worth'; fill: number; text: string; sub?: string; size?: number; tooltip?: ReactNode; label: string }) {
  const big = size >= 90;
  const ring = (
    <RingProgress
      size={size}
      thickness={big ? 7 : 6}
      roundCaps
      rootColor="var(--sc-line)"
      sections={[{ value: clamp(fill), color: kind === 'reviews' ? 'var(--sc-gold-fill)' : 'var(--sc-cade)' }]}
      aria-label={label}
      label={
        <Stack gap={2} align="center">
          <span className="sc-score" style={{ fontSize: text.length > 3 ? (big ? 21 : 15) : big ? 30 : 22 }}>
            {text}
          </span>
          <span className="sc-muted" style={{ fontSize: big ? 10 : 9, letterSpacing: '0.06em', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            {kind === 'acorns' && <Acorn size={big ? 11 : 9} />}
            {kind === 'reviews' && <Star size={big ? 10 : 8} />}
            {kind === 'acorns' ? 'ACORNS' : kind === 'reviews' ? 'REVIEWS' : 'WORTH'}
          </span>
          {sub && (
            <span className="sc-muted" style={{ fontSize: big ? 8.5 : 7.5, letterSpacing: '0.06em' }}>
              {sub}
            </span>
          )}
        </Stack>
      }
    />
  );
  return tooltip ? (
    <Tooltip label={tooltip} multiline maw={280}>
      <div style={{ flex: 'none' }}>{ring}</div>
    </Tooltip>
  ) : (
    <div style={{ flex: 'none' }}>{ring}</div>
  );
}

/** The Reviews circle: Metacritic's score or IGDB's rating, saying which. */
export function ReviewsRing({ reviews, size }: { reviews: HeaderReviews; size?: number }) {
  const from = reviews.source === 'metacritic' ? 'Metacritic' : 'IGDB';
  return (
    <ScoreRing
      kind="reviews"
      fill={reviews.score}
      text={String(reviews.score)}
      sub={reviews.source === 'metacritic' ? 'METACRITIC' : 'IGDB'}
      size={size}
      label={`Reviews ${reviews.score} out of 100, from ${from}`}
      tooltip={
        reviews.source === 'metacritic'
          ? "Metacritic's score, from Wikipedia's review table"
          : `IGDB's rating, from ${count(reviews.count ?? 0)} ${reviews.count === 1 ? 'rating' : 'ratings'} (critics and players)`
      }
    />
  );
}

/** A star beside a game's name, with where it comes from on hover, opening its list when it has one. */
function StarChip({ star }: { star: GameStar }) {
  const body = <>★ {star.label}</>;
  const chip = star.href?.startsWith('/') ? (
    <Link className="sc-star" to={star.href}>
      {body}
    </Link>
  ) : star.href ? (
    <a className="sc-star" href={star.href} target="_blank" rel="noreferrer">
      {body}
    </a>
  ) : (
    <span className="sc-star" tabIndex={0}>
      {body}
    </span>
  );
  return (
    <Tooltip label={star.detail} multiline maw={280}>
      {chip}
    </Tooltip>
  );
}

/** A game's stars: a few beside its name (Settings > Interface, three to start), the rest under "+n". */
export function GameStars({ stars }: { stars: GameStar[] }) {
  const shown = useSetting('interface.headerStars', 3);
  if (stars.length === 0 || shown === 0) return null;
  const rest = stars.slice(shown);
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {stars.slice(0, shown).map((s) => (
        <StarChip key={`${s.kind}|${s.label}`} star={s} />
      ))}
      {rest.length > 0 && (
        <Tooltip
          label={
            <Stack gap={2}>
              {rest.map((s) => (
                <Text key={`${s.kind}|${s.label}`} size="xs">
                  ★ {s.label}: {s.detail}
                </Text>
              ))}
            </Stack>
          }
          multiline
          maw={320}
        >
          <span className="sc-star" data-more="" tabIndex={0}>
            +{rest.length}
          </span>
        </Tooltip>
      )}
    </span>
  );
}

/**
 * The game page's head: its cover, its chips, its name with the stars, a line of what it is, and the two circles
 * (beside it on a computer, under it on a phone).
 */
export function GameHeader({ coverId, title, chips, stars, sub, rings }: { coverId: string | null; title: string; chips: ReactNode; stars: GameStar[]; sub?: ReactNode; rings?: ReactNode }) {
  return (
    <div className="sc-game-head">
      <div className="sc-game-head-main">
        <Cover id={coverId} width={90} placeholder title={title} />
        <Stack gap={6} style={{ minWidth: 0 }}>
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{chips}</span>
          <h2 className="sc-game-name">{title}</h2>
          <GameStars stars={stars} />
          {sub}
        </Stack>
      </div>
      {rings && <div style={{ display: 'flex', gap: 12 }}>{rings}</div>}
    </div>
  );
}
