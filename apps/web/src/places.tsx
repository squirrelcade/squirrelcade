import { Text } from '@mantine/core';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { api } from './api';

/** A copy as the places' pages show it (GET /api/v1/places, /places/find). */
export interface PlaceCopy {
  copyKey: string;
  id: number;
  title: string;
  platformKey: string | null;
  platform: string | null;
  completeness: string;
  /** Its storage location now (null: none yet). */
  place: string | null;
}

/** A place with the note on where the place itself is, and its copies. */
export interface Place {
  name: string;
  note: string | null;
  copies: PlaceCopy[];
}

/** One of your games, found by a barcode or a title, with its copies (the ones without a place first). */
export interface PlaceGame {
  platformKey: string;
  platform: string;
  title: string;
  copies: PlaceCopy[];
}

/** A copy given a place, and where it was before. */
export interface Placed extends PlaceCopy {
  before: string | null;
}

/** The places in use with their counts and notes (GET /api/v1/tags, the copy window's suggestions too). */
export interface Vocabulary {
  tags: { name: string; copies: number }[];
  locations: { name: string; copies: number; note: string | null }[];
}

/** The example under every storage location box. */
export const PLACE_EXAMPLE = 'Bag 7, Black case #7, the office shelf...';

/** The notes on places, by the place's name in lower case: shown beside a place wherever it appears. */
export function usePlaceNotes(enabled = true): (place: string | null | undefined) => string | null {
  const vocabulary = useQuery({ queryKey: ['tags'], queryFn: () => api<Vocabulary>('/tags'), enabled, staleTime: 60_000 });
  const notes = new Map((vocabulary.data?.locations ?? []).filter((l) => l.note).map((l) => [l.name.toLowerCase(), l.note!]));
  return (place) => (place ? (notes.get(place.toLowerCase()) ?? null) : null);
}

/** A place's note beside its name: "Bag 7 · under the master bed". */
export function PlaceNote({ note, size = 'xs' }: { note: string | null; size?: 'xs' | 'sm' }) {
  if (!note) return null;
  return (
    <Text span size={size} c="dimmed">
      {' · '}
      {note}
    </Text>
  );
}

/** After places changed: every list that shows them. */
export async function placesChanged(queryClient: QueryClient): Promise<void> {
  await Promise.all(['places', 'tags', 'collection', 'game', 'improve'].map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
}

/** Where a place's label leads: Pack a place with that place chosen (a phone's own camera app opens it too). */
export function labelAddress(place: string, base: string): string {
  return `${base.replace(/\/+$/, '')}/store/pack?place=${encodeURIComponent(place)}`;
}

/** The place a label's QR code names, or null for any other code (a label from another Squirrelcade counts too). */
export function placeOfLabel(text: string): string | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (!/\/store\/pack\/?$/.test(url.pathname)) return null;
  const place = url.searchParams.get('place')?.trim().replace(/\s+/g, ' ');
  return place ? place.slice(0, 80) : null;
}
