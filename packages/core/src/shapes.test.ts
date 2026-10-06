import { describe, expect, it } from 'vitest';
import { followsShape, rankOrder, shapePoints, shapeShare } from './shapes.js';

const order = ['RPG', 'Platformer', 'Puzzle', 'Racing', 'Sports'];

describe('point shapes', () => {
  it('shares the points out from the top rank to the bottom one', () => {
    expect(shapePoints({ shape: 'linear', top: 30, bottom: 10, order })).toEqual({ RPG: 30, Platformer: 25, Puzzle: 20, Racing: 15, Sports: 10 });
    // Exponential: the first few stand out; logarithmic: most stay near the top.
    expect(shapePoints({ shape: 'exponential', top: 30, bottom: 10, order })).toEqual({ RPG: 30, Platformer: 19, Puzzle: 14, Racing: 11, Sports: 10 });
    expect(shapePoints({ shape: 'logarithmic', top: 30, bottom: 10, order })).toEqual({ RPG: 30, Platformer: 28, Puzzle: 26, Racing: 22, Sports: 10 });
    expect(shapePoints({ shape: 'steps', top: 30, bottom: 10, order: [...order, 'Horror'] })).toEqual({ RPG: 30, Platformer: 30, Puzzle: 20, Racing: 20, Sports: 10, Horror: 10 });
    // The ends are always the top and bottom points; a single entry gets the top; bottom may be above top or below zero.
    for (const shape of ['linear', 'exponential', 'logarithmic', 'steps'] as const) {
      expect(shapeShare(shape, 0, 7)).toBeCloseTo(1);
      expect(shapeShare(shape, 6, 7)).toBeCloseTo(0);
      expect(shapePoints({ shape, top: 12, bottom: -4, order: ['Only'] })).toEqual({ Only: 12 });
    }
    expect(shapePoints({ shape: 'linear', top: 0, bottom: -12, order: ['A', 'B', 'C'] })).toEqual({ A: 0, B: -6, C: -12 });
  });

  it('ranks by points, keeping the saved order among equal points', () => {
    const points = { Puzzle: 20, RPG: 30, Racing: 20, Sports: 5 };
    expect(rankOrder(points)).toEqual(['RPG', 'Puzzle', 'Racing', 'Sports']);
    expect(rankOrder(points, ['Racing', 'Puzzle'])).toEqual(['RPG', 'Racing', 'Puzzle', 'Sports']);
    // Entries the saved order no longer has are ignored; new ones fall in by points.
    expect(rankOrder({ A: 1, B: 1 }, ['Gone', 'B'])).toEqual(['B', 'A']);
  });

  it('knows when the points still follow the shape', () => {
    const spec = { shape: 'linear' as const, top: 30, bottom: 10, order };
    const points = shapePoints(spec);
    expect(followsShape(points, spec)).toBe(true);
    expect(followsShape({ ...points, RPG: 31 }, spec)).toBe(false);
    expect(followsShape({ ...points, Horror: 0 }, spec)).toBe(false);
    expect(followsShape({ Anything: 3 }, { ...spec, shape: 'custom' })).toBe(true);
    // Rounding can give neighbours equal points; the saved order keeps them apart.
    const tight = { shape: 'linear' as const, top: 2, bottom: 0, order: ['A', 'B', 'C', 'D', 'E'] };
    expect(shapePoints(tight)).toEqual({ A: 2, B: 2, C: 1, D: 1, E: 0 });
    expect(followsShape(shapePoints(tight), { ...tight, order: ['B', 'A', 'D', 'C', 'E'] })).toBe(true);
  });
});
