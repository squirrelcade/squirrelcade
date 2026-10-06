import { VisuallyHidden } from '@mantine/core';
import type { ReactNode } from 'react';

/**
 * The acorn (D121): Squirrelcade's unit for how much you'd want a game, so it's never taken for a review score. The
 * pixel acorn of the squirrel's logo (a dark brown cap, a green nut, as the first logo had it, D140), drawn at whole
 * pixels. Decorative: the words or numbers beside it say what it means.
 */
export function Acorn({ size = 14 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 5 6"
      width={Math.round((size * 5) / 6)}
      height={size}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'inline-block', flex: 'none', verticalAlign: '-0.12em' }}
    >
      <path d="M2 0h1v1H2zM0 1h5v2H0z" fill="#6b3a10" />
      <path d="M1 3h3v2H1zM2 5h1v1H2z" fill="#46a36b" />
    </svg>
  );
}

/**
 * The Stash's mark (D142): a pixel treasure chest for what you have, as the acorn is for what you want. It stands for
 * the Stash in the menu and on its page, and before whatever says you have a game ("Have it", "You own it", "Owned").
 * Decorative: the words beside it say what it means.
 */
export function StashMark({ size = 14 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 7 6"
      width={Math.round((size * 7) / 6)}
      height={size}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'inline-block', flex: 'none', verticalAlign: '-0.12em' }}
    >
      <path d="M1 0h5v1H1zM0 1h1v5H0zM6 1h1v5H6zM1 2h2v1H1zM4 2h2v1H4zM1 5h5v1H1z" fill="#6b3a10" />
      <path d="M1 1h5v1H1zM1 3h2v2H1zM4 3h2v2H4zM3 4h1v1H3z" fill="#c27a3f" />
      <path d="M3 2h1v2H3z" fill="#e9b44c" />
    </svg>
  );
}

/** Words that say you have a game ("Have it", "Owned") with the Stash's mark before them (D142). */
export function Have({ children, size = 12 }: { children: ReactNode; size?: number }) {
  return (
    <span className="sc-marked">
      <StashMark size={size} />
      {children}
    </span>
  );
}

/** A game's acorns: the number with the acorn after it, read aloud as "82 acorns". */
export function Acorns({ n, size = 13 }: { n: number | string; size?: number }) {
  return (
    <span className="sc-acorns">
      {n}
      <Acorn size={size} />
      <VisuallyHidden> acorns</VisuallyHidden>
    </span>
  );
}

/** IGDB's rating of a game (0.53.0): out of 100, and how many ratings it rests on. */
export type ReviewsOf = { rating: number; count: number } | null | undefined;

/** The pixel star: a game's review rating (IGDB's), shown beside its acorns. Decorative like the acorn. */
export function Star({ size = 13 }: { size?: number }) {
  return (
    <svg viewBox="0 0 7 7" width={size} height={size} shapeRendering="crispEdges" aria-hidden="true" focusable="false" style={{ display: 'inline-block', flex: 'none', verticalAlign: '-0.12em' }}>
      <path d="M3 0h1v2H3zM0 2h7v1H0zM1 3h5v1H1zM2 4h3v1H2zM1 5h2v1H1zM4 5h2v1H4zM1 6h1v1H1zM5 6h1v1H5z" fill="#e9b44c" />
    </svg>
  );
}

/** A game's reviews beside its acorns: IGDB's rating with the star after it ("86" and the star), its count on hover. */
export function Reviews({ r, size = 13 }: { r: ReviewsOf; size?: number }) {
  if (!r) return null;
  const ratings = `${r.count.toLocaleString('en-US')} ${r.count === 1 ? 'rating' : 'ratings'}`;
  return (
    <span className="sc-acorns" title={`Reviews: ${r.rating}/100 on IGDB, from ${ratings}`}>
      {r.rating}
      <Star size={size} />
      <VisuallyHidden> out of 100 in reviews, from {ratings}</VisuallyHidden>
    </span>
  );
}
