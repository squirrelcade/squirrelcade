/**
 * Typing a price, and catching one that's out of line (the owner, 2026-11-12: "I'm used to the way that price charting
 * does it, where you just take the numbers and you don't have to type the decimal place... I'm concerned that I'm going
 * to type in the wrong price for something").
 */

/** How a price box takes what's typed (Settings > General > How you type prices). */
export type PriceTyping = 'decimal' | 'digits';

/** Digits after the point in a currency's amounts, as Squirrelcade shows them (yen have none). */
export function currencyDecimals(currency: string): number {
  return currency === 'JPY' ? 0 : 2;
}

/**
 * What a price box's text is worth in the currency's smallest unit (cents; whole yen), or null when it's empty or
 * can't be read.
 * - "decimal", as usual: the point where it goes ("14", "14.5", "$1,400.00"); a comma before the last two digits
 *   only ("14,50") is a decimal comma.
 * - "digits", PriceCharting's way: every digit and no point, the last ones the cents ("1400" is 14.00, "999" is 9.99;
 *   a yen amount is all yen). Anything that isn't a digit is left out.
 */
export function typedPriceCents(text: string, typing: PriceTyping, decimals = 2): number | null {
  const t = String(text ?? '').trim();
  if (typing === 'digits') {
    const digits = t.replace(/\D/g, '');
    if (!digits) return null;
    const n = Number(digits);
    return Number.isSafeInteger(n) ? n : null;
  }
  let s = t.replace(/[\s$€£¥]|[A-Za-z]/g, '');
  if (s === '') return null;
  if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '');
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  else s = s.replace(/,/g, '');
  if (!/^\d*\.?\d*$/.test(s) || !/\d/.test(s)) return null;
  const cents = Math.round(Number(s) * 10 ** decimals);
  return Number.isSafeInteger(cents) ? cents : null;
}

/** An amount in the currency's smallest unit as digits-only typing writes it back ("1400" for 14.00). */
export function digitsOf(cents: number | null | undefined): string {
  return cents === null || cents === undefined || !Number.isFinite(cents) ? '' : String(Math.max(0, Math.round(cents)));
}

/** The limits of the price check, in the currency's smallest unit. */
export interface PriceCheckLimits {
  /** More than this many times the game's value (0: no check against values). */
  times: number;
  /** ...and more than this over it. */
  overCents: number;
  /** With no value known, more than this (0: no check without a value). */
  ceilingCents: number;
}

/**
 * The check's limits from Settings > Collection > Checking prices paid, whose amounts are whole units of the currency
 * (as the monthly budget is).
 */
export function priceCheckLimits(settings: { times: number; over: number; ceiling: number }, currency: string): PriceCheckLimits {
  const unit = 10 ** currencyDecimals(currency);
  return { times: Math.max(0, settings.times), overCents: Math.max(0, Math.round(settings.over * unit)), ceilingCents: Math.max(0, Math.round(settings.ceiling * unit)) };
}

/** Why a price paid is out of line: far above the game's value in that condition, or above the ceiling with no value known. */
export type PriceOutOfLine = { kind: 'value'; valueCents: number; times: number } | { kind: 'ceiling'; ceilingCents: number };

/**
 * Whether a price paid for a copy is out of line (a typo: an extra zero, 1400 typed for 14.00): more than `times` its
 * value AND more than `overCents` over it, so a cheap game bought new isn't questioned; with no value known, more than
 * the ceiling. Null when it looks fine, when nothing was paid, or when the check is off.
 */
export function priceOutOfLine(paidCents: number | null | undefined, valueCents: number | null | undefined, limits: PriceCheckLimits): PriceOutOfLine | null {
  if (paidCents === null || paidCents === undefined || !Number.isFinite(paidCents) || paidCents <= 0) return null;
  if (valueCents !== null && valueCents !== undefined && valueCents > 0) {
    if (limits.times <= 0) return null;
    return paidCents > valueCents * limits.times && paidCents - valueCents > limits.overCents ? { kind: 'value', valueCents, times: paidCents / valueCents } : null;
  }
  return limits.ceilingCents > 0 && paidCents > limits.ceilingCents ? { kind: 'ceiling', ceilingCents: limits.ceilingCents } : null;
}

/** "12×" or "3.5×": how many times its value, for the words. */
function timesWord(times: number): string {
  return `${times >= 10 ? Math.round(times) : Math.round(times * 10) / 10}×`;
}

/** What's out of line, in a few words ("$140.00 is 10× its value, $14.00"), with amounts as `money` writes them. */
export function priceOutOfLineWords(found: PriceOutOfLine, paidCents: number, money: (cents: number) => string): string {
  return found.kind === 'value'
    ? `${money(paidCents)} is ${timesWord(found.times)} its value, ${money(found.valueCents)}`
    : `${money(paidCents)} is over ${money(found.ceilingCents)}, and no value is known for it`;
}
