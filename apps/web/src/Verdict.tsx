import type { ReactNode } from 'react';
import { ANSWERS, type Answer } from './choices';

/** Each answer's tone (brand.css): go for a game you need, own for yours, warn for one to check, info and plain for the rest. */
const TONE: Record<Answer, 'go' | 'own' | 'warn' | 'info' | 'plain'> = {
  need: 'go',
  unconfirmed: 'warn',
  own: 'own',
  'own-not-in-catalog': 'own',
  'own-elsewhere': 'info',
  check: 'warn',
  'not-a-target': 'plain',
  'not-tracked': 'plain',
};

/**
 * Store Mode's verdict (0.50.0, the redesign's): the answer in large pixel type on its tone's color, and the one thing
 * that matters most about it under it (its place on the wishlist, what yours is worth, where you have it).
 */
export function Verdict({ answer, reason }: { answer: Answer; reason: ReactNode }) {
  return (
    <div className="sc-verdict" data-tone={TONE[answer]}>
      <span className="sc-verdict-word">{ANSWERS[answer].label}</span>
      {reason && <span className="sc-verdict-reason">{reason}</span>}
    </div>
  );
}
