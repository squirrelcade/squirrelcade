import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HEADER, setUp, testApp } from './test-helpers.js';

let g: Awaited<ReturnType<typeof testApp>>;
let cookies: Record<string, string>;
beforeEach(async () => {
  g = await testApp();
  cookies = await setUp(g);
});
afterEach(async () => {
  await g.cleanup();
});

// id, title, console, include, date entered, date purchased.
const row = (id: string, title: string, label: string, inc: string, entered: string, bought: string) => `${id},"${title}",${label},1000,"${inc}",,,,0,1,${entered},${bought},,,`;
const COLLECTION = [
  HEADER,
  row('1', 'Okami', 'Playstation 2', 'Item, Box, and Manual', '2024-01-10', ''),
  row('1', 'Okami', 'Playstation 2', 'Item Only', '2026-03-01', ''),
  // Bought before it was entered: the day bought counts.
  row('2', 'Journey', 'Playstation 3', 'Item Only', '2026-06-01', '2026-02-01'),
  row('3', 'Flower', 'Playstation 3', 'Item Only', '2023-05-05', ''),
].join('\n');

describe("the collection's goal", () => {
  it('counts copies or games against it, with the last 12 months\' pace and when it gets there', async () => {
    g.collection.importText(COLLECTION, { source: 'upload', fileName: 'collection_20260927.csv' });
    expect((await g.app.inject({ url: '/api/v1/collection/goal', cookies })).json()).toEqual({ goal: null });
    g.settings.update({ 'collection.goal': 10 });
    // A year before 2026-09-29, the complete Okami and Flower were there; the loose Okami and Journey came since.
    expect(g.collection.goal('2026-09-29')).toEqual({ goal: 10, counts: 'copies', now: 4, yearAgo: 2, change: 2, perMonth: 0.2, remaining: 6, reachBy: '2029-09-29' });
    g.settings.update({ 'collection.goalCounts': 'games' });
    expect(g.collection.goal('2026-09-29')).toMatchObject({ counts: 'games', now: 3, yearAgo: 2, change: 1, remaining: 7 });
    // Over the goal: how many over, and no day to reach it.
    g.settings.update({ 'collection.goal': 2, 'collection.goalCounts': 'copies' });
    expect((await g.app.inject({ url: '/api/v1/collection/goal', cookies })).json().goal).toMatchObject({ now: 4, remaining: -2, reachBy: null });
    // A copy sold leaves the count, and a collection that isn't growing never gets there.
    const flower = g.collection.items({ q: 'Flower', all: true }).items[0]!;
    g.collection.removeCopy(flower.id, 'sold');
    g.collection.removeCopy(g.collection.items({ q: 'Journey', all: true }).items[0]!.id, 'sold');
    g.collection.removeCopy(g.collection.items({ q: 'Okami', all: true }).items.find((i) => i.completeness === 'loose')!.id, 'sold');
    g.settings.update({ 'collection.goal': 10 });
    expect(g.collection.goal('2026-09-29')).toMatchObject({ now: 1, yearAgo: 2, change: -1, remaining: 9, reachBy: null });
  });

  it('says when a copy added puts the collection at or over its goal (one in, one out)', async () => {
    g.collection.importText(COLLECTION, { source: 'upload', fileName: 'collection_20260927.csv' });
    const add = async () => (await g.app.inject({ method: 'POST', url: '/api/v1/collection/copies', payload: { platformKey: 'playstation-3', title: 'Flower', completeness: 'loose' }, cookies })).json();
    // No goal, then under it: nothing to say.
    expect((await add()).overGoal).toBeNull();
    g.settings.update({ 'collection.goal': 7 });
    expect((await add()).overGoal).toBeNull();
    // The seventh copy reaches it, the eighth is one over.
    expect((await add()).overGoal).toBe(0);
    expect((await add()).overGoal).toBe(1);
  });
});
