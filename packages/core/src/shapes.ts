/**
 * Point shapes: a ranked points list (consoles, genres, styles...) can share out its points along
 * a curve from the top rank down to the bottom one, instead of one number at a time. The points
 * that result are what scoring uses; the shape only decides them.
 */

/** How a ranked list's points fall from the top rank to the bottom one. */
export type PointShape = 'custom' | 'linear' | 'exponential' | 'logarithmic' | 'steps';

/** The shapes, as the Scoring page offers them. */
export const POINT_SHAPES: readonly { value: PointShape; label: string; description: string }[] = [
  { value: 'custom', label: 'Your own numbers', description: 'Every entry keeps the points you give it.' },
  { value: 'linear', label: 'Straight line', description: 'Even steps from the top rank down to the bottom one.' },
  { value: 'exponential', label: 'Exponential', description: 'The first few stand out; the rest bunch up near the bottom.' },
  { value: 'logarithmic', label: 'Logarithmic', description: 'Most stay near the top; the last few drop away.' },
  { value: 'steps', label: 'Three steps', description: 'The top third gets the top points, the middle third half-way, the bottom third the bottom points.' },
];

/** A ranked list's shape: the curve, the points of the top and bottom ranks, and the ranking itself. */
export interface ShapeSpec {
  shape: PointShape;
  top: number;
  bottom: number;
  /** The entries from the top rank down. */
  order: string[];
}

/** How strongly the exponential and logarithmic shapes bend. */
const BEND = 3;

/** The share of the range at a point t of a continuous scale, from its top (t = 0, share 1) to its bottom (t = 1, share 0). */
export function shapeAt(shape: PointShape, t: number): number {
  const x = Math.min(1, Math.max(0, t));
  switch (shape) {
    case 'exponential':
      return (Math.exp(-BEND * x) - Math.exp(-BEND)) / (1 - Math.exp(-BEND));
    case 'logarithmic':
      return Math.log1p((Math.exp(BEND) - 1) * (1 - x)) / BEND;
    case 'steps':
      return x < 1 / 3 ? 1 : x < 2 / 3 ? 0.5 : 0;
    default:
      return 1 - x;
  }
}

/** The share of the top-to-bottom range the entry at a rank gets: 1 at the top rank, 0 at the bottom one. */
export function shapeShare(shape: PointShape, rank: number, count: number): number {
  if (count <= 1) return 1;
  if (shape === 'steps') {
    // By thirds of the entries, so every step holds its share of them.
    const third = Math.floor((3 * rank) / count);
    return third === 0 ? 1 : third === 1 ? 0.5 : 0;
  }
  return shapeAt(shape, rank / (count - 1));
}

/** Each entry's points from its rank, in whole points (a custom list has none of its own: use its points as they are). */
export function shapePoints(spec: ShapeSpec): Record<string, number> {
  const n = spec.order.length;
  return Object.fromEntries(spec.order.map((key, rank) => [key, Math.round(spec.bottom + (spec.top - spec.bottom) * shapeShare(spec.shape, rank, n))]));
}

/** A points list's entries from the top rank down: by points, ties in the saved order, then by name. */
export function rankOrder(points: Record<string, number>, order: readonly string[] = []): string[] {
  const at = new Map(order.map((key, i) => [key, i]));
  return Object.keys(points).sort(
    (a, b) => points[b]! - points[a]! || (at.get(a) ?? Number.MAX_SAFE_INTEGER) - (at.get(b) ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b),
  );
}

/**
 * Whether a list's points are exactly what its shape gives them. They stop being so when the
 * points are changed elsewhere (a settings import, the API), and the list then counts as custom.
 */
export function followsShape(points: Record<string, number>, spec: ShapeSpec): boolean {
  if (spec.shape === 'custom') return true;
  const expected = shapePoints({ ...spec, order: rankOrder(points, spec.order) });
  const keys = Object.keys(points);
  return keys.length === Object.keys(expected).length && keys.every((k) => expected[k] === points[k]);
}
