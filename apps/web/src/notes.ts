import { normalizeTitle } from '@squirrelcade/core';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

/** One of your notes on a game (GET /api/v1/game/notes). */
export interface GameNote {
  platformKey: string;
  platform: string;
  title: string;
  note: string;
  updatedAt: string;
}

/** The longest note the server keeps, in characters. */
export const NOTE_MAX = 2000;

/** Each list of notes' lookup by "platform key|normalized title", made once however many titles ask. */
const indexes = new WeakMap<GameNote[], Map<string, string>>();

/** Your notes, newest first, and a game's note by its console and title (the catalog's title, as notes are kept). */
export function useGameNotes(): { notes: GameNote[]; loading: boolean; noteOf: (platformKey: string, title: string) => string | null } {
  const query = useQuery({ queryKey: ['notes'], queryFn: () => api<GameNote[]>('/game/notes'), staleTime: 5 * 60_000 });
  const list = query.data;
  let index = list ? indexes.get(list) : undefined;
  if (list && !index) {
    index = new Map(list.map((n) => [`${n.platformKey}|${normalizeTitle(n.title)}`, n.note]));
    indexes.set(list, index);
  }
  return {
    notes: list ?? [],
    loading: query.isLoading,
    noteOf: (platformKey, title) => (index && index.size > 0 ? (index.get(`${platformKey}|${normalizeTitle(title)}`) ?? null) : null),
  };
}
