import {
  findPlatforms,
  matchKey,
  normalizeTitle,
  readWishlistSheet,
  SAME_GAME_AT,
  TitleMatcher,
  type GameDetails,
  type SheetDetails,
  type SheetExclusion,
  type SheetPreference,
  type SheetRule,
} from '@squirrelcade/core';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import type { Db } from './db/index.js';
import { buyingRules, catalogEntries, exclusions, gameDetails, ownerPreferences, platforms } from './db/schema.js';
import type { WishlistService } from './wishlist.js';

/** A rule as the page and the connector see it: `number` is its place among the rules that are on. */
export interface BuyingRule {
  id: number;
  number: number | null;
  title: string;
  text: string;
  kind: 'rule' | 'preference';
  area: string;
  ref: string;
  notes: string;
  active: boolean;
  source: string;
  updatedAt: string;
}

export interface RuleInput {
  title?: unknown;
  text?: unknown;
  kind?: unknown;
  area?: unknown;
  ref?: unknown;
  notes?: unknown;
  active?: unknown;
}

export class BuyingRuleError extends Error {}

/** What a spreadsheet would bring in, before it does: each row's fate, by kind. */
export interface ImportPreview {
  files: { name: string; kind: string | null; rows: number; problem?: string }[];
  rules: { ref: string; title: string; text: string; add: boolean; why?: string }[];
  exclusions: ImportRow[];
  preferences: ImportRow[];
  details: (ImportRow & { fields: string[]; proofPending: boolean })[];
}

export interface ImportRow {
  title: string;
  console: string;
  platformKey: string | null;
  /** The console's catalog game it's about (its catalog name), or null when the catalog doesn't list it. */
  matched: string | null;
  /** add, skip (something's already set, or it's switched off in the sheet), or unknown (no such console). */
  fate: 'add' | 'skip' | 'unknown';
  why: string;
  what: string;
}

export interface ImportChoice {
  /** The rules to add, by their ref (or title when they have none); missing: every new one. */
  rules?: string[];
  exclusions?: boolean;
  preferences?: boolean;
  details?: boolean;
  /** Bring "Physical proof pending" release classes (they keep a game off the wishlist until proven). */
  proofPending?: boolean;
}

const KINDS = new Set(['rule', 'preference']);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);

/**
 * Your buying rules (1.5.0, T-278), and bringing a wishlist kept in a spreadsheet into Squirrelcade: its rules, its
 * games not to recommend, the owner's say on games and what's known about them. Bringing in only ever adds: a game the
 * owner has set something for since keeps what they set.
 */
export class BuyingRulesService {
  constructor(
    private readonly db: Db,
    private readonly wishlist: WishlistService,
    private readonly log: Logger,
  ) {}

  list(): BuyingRule[] {
    const rows = this.db.select().from(buyingRules).orderBy(asc(buyingRules.position), asc(buyingRules.id)).all();
    let n = 0;
    return rows.map((r) => ({
      id: r.id,
      number: r.active ? ++n : null,
      title: r.title,
      text: r.text,
      kind: r.kind === 'preference' ? 'preference' : 'rule',
      area: r.area,
      ref: r.ref,
      notes: r.notes,
      active: r.active,
      source: r.source,
      updatedAt: r.updatedAt,
    }));
  }

  add(input: RuleInput, source = 'you'): BuyingRule {
    const title = str(input.title, 200) ?? '';
    const text = str(input.text, 8000) ?? '';
    if (!text && !title) throw new BuyingRuleError('Say what the rule is.');
    const kind = typeof input.kind === 'string' && KINDS.has(input.kind) ? input.kind : 'rule';
    const last = this.db.select({ p: buyingRules.position }).from(buyingRules).orderBy(asc(buyingRules.position)).all().at(-1)?.p ?? 0;
    const now = new Date().toISOString();
    const row = this.db
      .insert(buyingRules)
      .values({ position: last + 1, title: title || text.slice(0, 60), text, kind, area: str(input.area, 300) ?? '', ref: str(input.ref, 40) ?? '', notes: str(input.notes, 8000) ?? '', active: input.active !== false, source, createdAt: now, updatedAt: now })
      .returning()
      .get();
    return this.list().find((r) => r.id === row.id)!;
  }

  update(id: number, input: RuleInput): BuyingRule | null {
    const row = this.db.select().from(buyingRules).where(eq(buyingRules.id, id)).get();
    if (!row) return null;
    const set: Partial<typeof buyingRules.$inferInsert> = { updatedAt: new Date().toISOString() };
    const title = str(input.title, 200);
    const text = str(input.text, 8000);
    if (title !== undefined) set.title = title;
    if (text !== undefined) set.text = text;
    if (typeof input.kind === 'string' && KINDS.has(input.kind)) set.kind = input.kind;
    const area = str(input.area, 300);
    if (area !== undefined) set.area = area;
    const notes = str(input.notes, 8000);
    if (notes !== undefined) set.notes = notes;
    const ref = str(input.ref, 40);
    if (ref !== undefined) set.ref = ref;
    if (typeof input.active === 'boolean') set.active = input.active;
    if ((set.title ?? row.title) === '' && (set.text ?? row.text) === '') throw new BuyingRuleError('Say what the rule is.');
    this.db.update(buyingRules).set(set).where(eq(buyingRules.id, id)).run();
    return this.list().find((r) => r.id === id) ?? null;
  }

  remove(id: number): boolean {
    return this.db.delete(buyingRules).where(eq(buyingRules.id, id)).run().changes > 0;
  }

  /** Puts the rules in this order (ids not given keep their places after these). */
  order(ids: number[]): BuyingRule[] {
    const all = this.db.select({ id: buyingRules.id }).from(buyingRules).orderBy(asc(buyingRules.position), asc(buyingRules.id)).all().map((r) => r.id);
    const known = new Set(all);
    const wanted = ids.filter((id, i) => known.has(id) && ids.indexOf(id) === i);
    const rest = all.filter((id) => !wanted.includes(id));
    [...wanted, ...rest].forEach((id, i) => this.db.update(buyingRules).set({ position: i + 1 }).where(eq(buyingRules.id, id)).run());
    return this.list();
  }

  /** Reads spreadsheet tabs (CSV) and says what each row would do; with `apply`, does it. */
  bringIn(files: { name: string; text: string }[], apply: ImportChoice | null): ImportPreview & { applied?: { rules: number; exclusions: number; preferences: number; details: number } } {
    const preview: ImportPreview = { files: [], rules: [], exclusions: [], preferences: [], details: [] };
    const rules: SheetRule[] = [];
    const excl: SheetExclusion[] = [];
    const prefs: SheetPreference[] = [];
    const facts: SheetDetails[] = [];
    for (const f of files) {
      const read = readWishlistSheet(f.text);
      if (read.kind === null) {
        preview.files.push({ name: f.name, kind: null, rows: 0, problem: read.problem });
        continue;
      }
      preview.files.push({ name: f.name, kind: read.kind, rows: read.rows.length });
      if (read.kind === 'rules') rules.push(...read.rows);
      else if (read.kind === 'exclusions') excl.push(...read.rows);
      else if (read.kind === 'preferences') prefs.push(...read.rows);
      else facts.push(...read.rows);
    }

    // Rules: new ones by their ref, else by their words.
    const have = this.list();
    const haveRefs = new Set(have.map((r) => r.ref).filter(Boolean));
    const haveTexts = new Set(have.map((r) => normalizeTitle(r.text)));
    for (const r of rules) {
      const why = !r.active ? 'Switched off in the sheet' : r.ref && haveRefs.has(r.ref) ? 'Already on your list' : haveTexts.has(normalizeTitle(r.text)) ? 'Already on your list' : undefined;
      preview.rules.push({ ref: r.ref, title: r.title, text: r.text, add: !why, ...(why ? { why } : {}) });
    }

    const ctx = this.context();
    for (const e of excl) {
      const at = ctx.resolve(e.console, e.title);
      const what = e.action === 'exclude' ? 'Not a target for you' : e.action === 'hide' ? 'Hidden from the wishlist' : e.action === 'defer' ? `Snoozed until ${e.until ?? '?'}` : `Only once it's worth ${((e.belowCents ?? 0) / 100).toFixed(2)} or less`;
      const row = base(e, at, what);
      if (row.fate === 'add') {
        if (!e.active) skip(row, 'Switched off in the sheet');
        else if (e.action === 'defer' && !e.until) skip(row, 'No date to snooze it until');
        else if (ctx.excluded(at!.platformId, row.matched ?? e.title)) skip(row, 'You already have it on your list of exclusions');
        else if (e.action === 'exclude' && ctx.userStatus(at!.platformId, row.matched ?? e.title)) skip(row, "You've said what it is yourself");
      }
      preview.exclusions.push(row);
    }
    for (const p of prefs) {
      const at = ctx.resolve(p.console, p.title);
      const parts = [p.preference && p.preference !== 'No Adjustment' ? p.preference : '', p.reviewAfter ? `snoozed until ${p.reviewAfter}` : '', p.exclude ? 'hidden from the wishlist' : ''].filter(Boolean);
      const row = base(p, at, parts.join(', ') || 'Nothing to set');
      if (row.fate === 'add') {
        if (!p.active) skip(row, 'Switched off in the sheet');
        else if (parts.length === 0) skip(row, 'Nothing to set');
        else if (ctx.preference(at!.platformId, row.matched ?? p.title)) skip(row, 'You set a preference for it since');
      }
      preview.preferences.push(row);
    }
    for (const d of facts) {
      const at = ctx.resolve(d.console, d.title);
      const proofPending = (d.details.releaseClass ?? '').toLowerCase() === 'physical proof pending';
      const existing = at ? ctx.details(at.platformId, matchedOf(at, d.title)) : undefined;
      const fields = Object.keys(d.details).filter((k) => existing?.[k as keyof GameDetails] === undefined);
      const row = { ...base(d, at, fields.map(label).join(', ')), fields, proofPending };
      if (row.fate === 'add') {
        if (!d.active) skip(row, 'Switched off in the sheet');
        else if (fields.length === 0) skip(row, Object.keys(d.details).length === 0 ? 'Nothing to set' : "You've set these since");
      }
      preview.details.push(row);
    }
    if (!apply) return preview;
    return { ...preview, applied: this.applyImport(preview, rules, excl, prefs, facts, apply, ctx) };
  }

  private applyImport(
    preview: ImportPreview,
    rules: SheetRule[],
    excl: SheetExclusion[],
    prefs: SheetPreference[],
    facts: SheetDetails[],
    choice: ImportChoice,
    ctx: ReturnType<BuyingRulesService['context']>,
  ) {
    const done = { rules: 0, exclusions: 0, preferences: 0, details: 0 };
    const now = new Date().toISOString();
    const pickRule = (r: { ref: string; title: string }) => !choice.rules || choice.rules.includes(r.ref || r.title);
    // Two rows of one sheet about the same game add one exclusion.
    const excludedNow = new Set<string>();
    const excludeOnce = (platformId: number, title: string) => {
      const k = `${platformId}|${normalizeTitle(title)}`;
      if (ctx.excluded(platformId, title) || excludedNow.has(k)) return false;
      excludedNow.add(k);
      return true;
    };
    this.db.transaction(() => {
      preview.rules.forEach((p, i) => {
        if (!p.add || !pickRule(p)) return;
        const r = rules[i]!;
        this.add({ title: r.title, text: r.text, kind: r.kind, area: r.area, ref: r.ref, notes: r.notes }, 'import');
        done.rules++;
      });
      if (choice.exclusions !== false) {
        preview.exclusions.forEach((p, i) => {
          if (p.fate !== 'add') return;
          const e = excl[i]!;
          if (!excludeOnce(ctx.platformId(p.platformKey!), p.matched ?? e.title)) return;
          this.db.insert(exclusions).values({ platformId: ctx.platformId(p.platformKey!), title: p.matched ?? e.title, action: e.action, until: e.until, belowCents: e.belowCents, reason: e.reason || null, active: true, source: 'import' }).run();
          done.exclusions++;
        });
      }
      if (choice.preferences !== false) {
        preview.preferences.forEach((p, i) => {
          if (p.fate !== 'add') return;
          const x = prefs[i]!;
          const platformId = ctx.platformId(p.platformKey!);
          const title = p.matched ?? x.title;
          if (x.preference && x.preference !== 'No Adjustment') {
            this.db.insert(ownerPreferences).values({ platformId, title, titleKey: normalizeTitle(title), preference: x.preference, note: x.note || null, updatedAt: now }).onConflictDoNothing().run();
          }
          if (x.reviewAfter && excludeOnce(platformId, title)) this.db.insert(exclusions).values({ platformId, title, action: 'defer', until: x.reviewAfter, belowCents: null, reason: x.note || null, active: true, source: 'import' }).run();
          else if (x.exclude && excludeOnce(platformId, title)) this.db.insert(exclusions).values({ platformId, title, action: 'hide', until: null, belowCents: null, reason: x.note || null, active: true, source: 'import' }).run();
          done.preferences++;
        });
      }
      if (choice.details !== false) {
        preview.details.forEach((p, i) => {
          if (p.fate !== 'add') return;
          const d = facts[i]!;
          const platformId = ctx.platformId(p.platformKey!);
          const title = p.matched ?? d.title;
          const titleKey = normalizeTitle(title);
          const add: GameDetails = {};
          for (const f of p.fields) {
            if (f === 'releaseClass' && p.proofPending && !choice.proofPending) continue;
            (add as Record<string, unknown>)[f] = d.details[f as keyof GameDetails];
          }
          if (Object.keys(add).length === 0) return;
          const old = this.db.select().from(gameDetails).where(and(eq(gameDetails.platformId, platformId), eq(gameDetails.titleKey, titleKey))).get();
          if (old) {
            // Only what's missing: what the owner (or an earlier import) set stays.
            const merged = { ...add, ...(JSON.parse(old.details) as GameDetails) };
            this.db.update(gameDetails).set({ details: JSON.stringify(merged), updatedAt: now }).where(eq(gameDetails.id, old.id)).run();
          } else {
            this.db.insert(gameDetails).values({ platformId, title, titleKey, details: JSON.stringify(add), source: 'import', updatedAt: now }).run();
          }
          done.details++;
        });
      }
    });
    this.wishlist.invalidate();
    this.log.info({ context: 'wishlist' }, `Brought in from a spreadsheet: ${done.rules} rules, ${done.exclusions} exclusions, ${done.preferences} preferences, ${done.details} games' facts`);
    return done;
  }

  /** What bringing in looks things up in, read once per call. */
  private context() {
    const consoles = this.db.select({ id: platforms.id, key: platforms.key, name: platforms.name }).from(platforms).all();
    const byConsole = new Map<string, { platformId: number; key: string; catalog: Map<string, string>; matcher: TitleMatcher<{ title: string }> | null; titles: { title: string }[] } | null>();
    const exclusionKeys = new Set(this.db.select({ p: exclusions.platformId, t: exclusions.title }).from(exclusions).all().map((e) => `${e.p}|${normalizeTitle(e.t)}`));
    const prefKeys = new Set(this.db.select({ p: ownerPreferences.platformId, k: ownerPreferences.titleKey }).from(ownerPreferences).all().map((e) => `${e.p}|${e.k}`));
    const detailRows = new Map(this.db.select().from(gameDetails).all().map((d) => [`${d.platformId}|${d.titleKey}`, JSON.parse(d.details) as GameDetails]));
    const statusKeys = new Set(
      this.db
        .select({ p: catalogEntries.platformId, t: catalogEntries.title, s: catalogEntries.userStatus })
        .from(catalogEntries)
        .all()
        .filter((e) => e.s)
        .map((e) => `${e.p}|${normalizeTitle(e.t)}`),
    );
    const consoleOf = (asked: string) => {
      if (byConsole.has(asked)) return byConsole.get(asked)!;
      // "Super Nintendo + Super Famicom": the first name that's a console.
      const names = [asked, ...asked.split(/\s*[+/&]\s*/)];
      const p = names.map((n) => findPlatforms(n, consoles)[0]).find(Boolean);
      let found = null;
      if (p) {
        const titles = this.db.select({ title: catalogEntries.title }).from(catalogEntries).where(eq(catalogEntries.platformId, p.id)).all();
        const catalog = new Map<string, string>();
        for (const t of titles) {
          catalog.set(normalizeTitle(t.title), t.title);
          if (!catalog.has(`~${matchKey(t.title)}`)) catalog.set(`~${matchKey(t.title)}`, t.title);
        }
        found = { platformId: p.id, key: p.key, catalog, matcher: null, titles };
      }
      byConsole.set(asked, found);
      return found;
    };
    return {
      resolve: (consoleName: string, title: string) => {
        const c = consoleOf(consoleName);
        if (!c) return null;
        let matched = c.catalog.get(normalizeTitle(title)) ?? c.catalog.get(`~${matchKey(title)}`) ?? null;
        if (!matched && c.titles.length > 0) {
          c.matcher ??= new TitleMatcher(c.titles, (x) => [x.title]);
          matched = c.matcher.find(title, { min: SAME_GAME_AT, limit: 1 })[0]?.item.title ?? null;
        }
        return { platformId: c.platformId, platformKey: c.key, matched };
      },
      platformId: (key: string) => consoles.find((p) => p.key === key)!.id,
      excluded: (platformId: number, title: string) => exclusionKeys.has(`${platformId}|${normalizeTitle(title)}`),
      preference: (platformId: number, title: string) => prefKeys.has(`${platformId}|${normalizeTitle(title)}`),
      details: (platformId: number, title: string) => detailRows.get(`${platformId}|${normalizeTitle(title)}`),
      userStatus: (platformId: number, title: string) => statusKeys.has(`${platformId}|${normalizeTitle(title)}`),
    };
  }
}

type Resolved = { platformId: number; platformKey: string; matched: string | null } | null;

function matchedOf(at: NonNullable<Resolved>, title: string): string {
  return at.matched ?? title;
}

function base(r: { title: string; console: string }, at: Resolved, what: string): ImportRow {
  if (!at) return { title: r.title, console: r.console, platformKey: null, matched: null, fate: 'unknown', why: 'No console of that name in your Squirrelcade', what };
  return { title: r.title, console: r.console, platformKey: at.platformKey, matched: at.matched, fate: 'add', why: at.matched ? '' : "Not in the console's catalog (kept for when it is)", what };
}

function skip(row: ImportRow, why: string): void {
  row.fate = 'skip';
  row.why = why;
}

const LABELS: Record<string, string> = {
  genre: 'genre',
  style: 'style',
  tieIn: 'tie-in',
  japaneseDeveloped: 'made in Japan',
  offbeat: 'offbeat',
  naPhysical: 'North American release',
  personalInterest: 'your interest',
  seriesCompletes: 'finishes a series',
  seriesRemaining: 'games left in its series',
  releaseClass: 'release class',
  significance: 'significance',
  marketUrgency: 'market urgency',
  franchise: 'franchise',
  physicalProof: 'physical proof',
  notes: 'notes',
};
const label = (k: string) => LABELS[k] ?? k;

export function registerBuyingRulesRoutes(app: FastifyInstance, rules: BuyingRulesService): void {
  app.get('/api/v1/wishlist/rules', async () => ({ rules: rules.list() }));
  app.post('/api/v1/wishlist/rules', async (request, reply) => {
    try {
      return reply.code(201).send({ rule: rules.add((request.body ?? {}) as RuleInput) });
    } catch (e) {
      if (e instanceof BuyingRuleError) return reply.code(400).send({ error: 'invalid', message: e.message });
      throw e;
    }
  });
  app.put('/api/v1/wishlist/rules/order', async (request, reply) => {
    const ids = (request.body as { ids?: unknown } | undefined)?.ids;
    if (!Array.isArray(ids) || !ids.every((x) => Number.isInteger(x))) return reply.code(400).send({ error: 'invalid', message: 'Give the rules in their new order.' });
    return { rules: rules.order(ids as number[]) };
  });
  app.put('/api/v1/wishlist/rules/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    try {
      const rule = rules.update(id, (request.body ?? {}) as RuleInput);
      if (!rule) return reply.code(404).send({ error: 'not-found', message: 'No such rule.' });
      return { rule };
    } catch (e) {
      if (e instanceof BuyingRuleError) return reply.code(400).send({ error: 'invalid', message: e.message });
      throw e;
    }
  });
  app.delete('/api/v1/wishlist/rules/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!rules.remove(id)) return reply.code(404).send({ error: 'not-found', message: 'No such rule.' });
    return { removed: true };
  });
  // A spreadsheet's tabs as CSV: { files: [{ name, text }], apply?: { rules?, exclusions?, preferences?, details?, proofPending? } }.
  app.post('/api/v1/wishlist/bring-in', { bodyLimit: 8 * 1024 * 1024 }, async (request, reply) => {
    const b = (request.body ?? {}) as { files?: unknown; apply?: unknown };
    const files = Array.isArray(b.files) ? b.files.filter((f): f is { name: string; text: string } => typeof f?.name === 'string' && typeof f?.text === 'string') : [];
    if (files.length === 0) return reply.code(400).send({ error: 'invalid', message: 'Give at least one CSV file (a tab of your spreadsheet saved as CSV).' });
    const apply = b.apply && typeof b.apply === 'object' ? (b.apply as ImportChoice) : null;
    return rules.bringIn(files, apply);
  });
}
