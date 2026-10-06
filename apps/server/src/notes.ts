import { normalizeTitle } from '@squirrelcade/core';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Db } from './db/index.js';
import { gameNotes, platforms } from './db/schema.js';

/** The longest note kept, in characters. */
export const NOTE_MAX = 2000;

/** One of your notes, with its game. */
export interface GameNote {
  platformKey: string;
  platform: string;
  title: string;
  note: string;
  updatedAt: string;
}

/**
 * Your own notes on games ("the one with the poster", "ask at the flea market"): one per game on a console,
 * under the catalog's title when the catalog has the game. A backup keeps them with the rest of the database.
 */
export class NotesService {
  constructor(
    private readonly db: Db,
    private readonly log: Logger,
  ) {}

  /** Every note, the newest first. */
  list(): GameNote[] {
    return this.db
      .select({ platformKey: platforms.key, platform: platforms.name, title: gameNotes.title, note: gameNotes.note, updatedAt: gameNotes.updatedAt })
      .from(gameNotes)
      .innerJoin(platforms, eq(platforms.id, gameNotes.platformId))
      .orderBy(desc(gameNotes.updatedAt))
      .all();
  }

  /** The note on a game, found by any of its titles (the catalog's first, then the one asked about). */
  of(platformKey: string, titles: string[]): { text: string; updatedAt: string } | null {
    const keys = [...new Set(titles.map(normalizeTitle).filter(Boolean))];
    if (keys.length === 0) return null;
    const rows = this.db
      .select({ titleKey: gameNotes.titleKey, note: gameNotes.note, updatedAt: gameNotes.updatedAt })
      .from(gameNotes)
      .innerJoin(platforms, eq(platforms.id, gameNotes.platformId))
      .where(and(eq(platforms.key, platformKey), inArray(gameNotes.titleKey, keys)))
      .all();
    const row = keys.map((k) => rows.find((r) => r.titleKey === k)).find(Boolean);
    return row ? { text: row.note, updatedAt: row.updatedAt } : null;
  }

  /** Every note by "platform key|normalized title", for answers that carry a game's note (Store Mode's). */
  index(): Map<string, string> {
    return new Map(
      this.db
        .select({ platformKey: platforms.key, titleKey: gameNotes.titleKey, note: gameNotes.note })
        .from(gameNotes)
        .innerJoin(platforms, eq(platforms.id, gameNotes.platformId))
        .all()
        .map((r) => [`${r.platformKey}|${r.titleKey}`, r.note]),
    );
  }

  /**
   * Saves the note on a game under its first title, replacing a note kept under any of its other titles; an
   * empty note removes it. False for an unknown console.
   */
  set(platformKey: string, titles: string[], note: string | null): boolean {
    const platform = this.db.select().from(platforms).where(eq(platforms.key, platformKey)).get();
    const title = titles[0]?.trim();
    if (!platform || !title) return false;
    const keys = [...new Set(titles.map(normalizeTitle).filter(Boolean))];
    const text = note?.trim() ?? '';
    const now = new Date().toISOString();
    this.db.transaction((tx) => {
      tx.delete(gameNotes)
        .where(and(eq(gameNotes.platformId, platform.id), inArray(gameNotes.titleKey, keys)))
        .run();
      if (text) tx.insert(gameNotes).values({ platformId: platform.id, title, titleKey: normalizeTitle(title), note: text, updatedAt: now }).run();
    });
    this.log.info({ context: 'notes' }, text ? `Note saved for "${title}" on ${platform.name}` : `Note removed from "${title}" on ${platform.name}`);
    return true;
  }
}
