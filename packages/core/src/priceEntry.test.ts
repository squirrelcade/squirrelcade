import { describe, expect, it } from 'vitest';
import { currencyDecimals, digitsOf, priceCheckLimits, priceOutOfLine, priceOutOfLineWords, typedPriceCents } from './priceEntry.js';

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

describe('typing a price', () => {
  it('reads digits only the way PriceCharting does: the last two digits are the cents', () => {
    expect(typedPriceCents('1400', 'digits')).toBe(1400);
    expect(typedPriceCents('999', 'digits')).toBe(999);
    expect(typedPriceCents('5', 'digits')).toBe(5);
    expect(typedPriceCents('0050', 'digits')).toBe(50);
    // Whatever isn't a digit is left out: a point typed out of habit doesn't move the cents.
    expect(typedPriceCents('14.00', 'digits')).toBe(1400);
    expect(typedPriceCents('$1,400', 'digits')).toBe(1400);
    expect(typedPriceCents('', 'digits')).toBeNull();
    expect(typedPriceCents('abc', 'digits')).toBeNull();
    // Yen have no cents: every digit is yen.
    expect(typedPriceCents('1400', 'digits', currencyDecimals('JPY'))).toBe(1400);
    expect(digitsOf(1400)).toBe('1400');
    expect(digitsOf(null)).toBe('');
  });

  it('reads the usual way with the point where it goes', () => {
    expect(typedPriceCents('14', 'decimal')).toBe(1400);
    expect(typedPriceCents('14.5', 'decimal')).toBe(1450);
    expect(typedPriceCents('14.99', 'decimal')).toBe(1499);
    expect(typedPriceCents('$1,400.00', 'decimal')).toBe(140000);
    expect(typedPriceCents('14,50', 'decimal')).toBe(1450);
    expect(typedPriceCents('.99', 'decimal')).toBe(99);
    expect(typedPriceCents('', 'decimal')).toBeNull();
    expect(typedPriceCents('1.2.3', 'decimal')).toBeNull();
    expect(typedPriceCents('1400', 'decimal', 0)).toBe(1400);
  });
});

describe('a price paid out of line', () => {
  const limits = priceCheckLimits({ times: 3, over: 50, ceiling: 300 }, 'USD');

  it('takes the settings in whole units of the currency', () => {
    expect(limits).toEqual({ times: 3, overCents: 5000, ceilingCents: 30000 });
    expect(priceCheckLimits({ times: 3, over: 50, ceiling: 300 }, 'JPY')).toEqual({ times: 3, overCents: 50, ceilingCents: 300 });
  });

  it('asks about a price far above the value, but not a cheap game bought new', () => {
    // 1400 typed for 14.00, in the usual way: 100 times a 14.00 game.
    expect(priceOutOfLine(140000, 1400, limits)).toEqual({ kind: 'value', valueCents: 1400, times: 100 });
    // A 10.00 game: more than 3 times, but only from 60.01 is it also more than 50 over.
    expect(priceOutOfLine(4000, 1000, limits)).toBeNull();
    expect(priceOutOfLine(6000, 1000, limits)).toBeNull();
    expect(priceOutOfLine(6001, 1000, limits)?.kind).toBe('value');
    // A 40.00 game: from 120.01.
    expect(priceOutOfLine(12000, 4000, limits)).toBeNull();
    expect(priceOutOfLine(12001, 4000, limits)?.kind).toBe('value');
    // A pricey game is pricey: 500.00 for a 400.00 game is fine, even above the ceiling.
    expect(priceOutOfLine(50000, 40000, limits)).toBeNull();
  });

  it('asks above the ceiling when no value is known, and never about nothing paid', () => {
    expect(priceOutOfLine(30000, null, limits)).toBeNull();
    expect(priceOutOfLine(30001, null, limits)).toEqual({ kind: 'ceiling', ceilingCents: 30000 });
    expect(priceOutOfLine(30001, 0, limits)?.kind).toBe('ceiling');
    expect(priceOutOfLine(null, 1000, limits)).toBeNull();
    expect(priceOutOfLine(0, 1000, limits)).toBeNull();
  });

  it('can be turned off, each half on its own', () => {
    const noValues = priceCheckLimits({ times: 0, over: 50, ceiling: 300 }, 'USD');
    expect(priceOutOfLine(140000, 1400, noValues)).toBeNull();
    expect(priceOutOfLine(30001, null, noValues)?.kind).toBe('ceiling');
    const noCeiling = priceCheckLimits({ times: 3, over: 50, ceiling: 0 }, 'USD');
    expect(priceOutOfLine(999999, null, noCeiling)).toBeNull();
  });

  it('says what is out of line', () => {
    expect(priceOutOfLineWords(priceOutOfLine(140000, 1400, limits)!, 140000, money)).toBe('$1400.00 is 100× its value, $14.00');
    expect(priceOutOfLineWords(priceOutOfLine(9000, 2000, limits)!, 9000, money)).toBe('$90.00 is 4.5× its value, $20.00');
    expect(priceOutOfLineWords(priceOutOfLine(45000, null, limits)!, 45000, money)).toBe('$450.00 is over $300.00, and no value is known for it');
  });
});
