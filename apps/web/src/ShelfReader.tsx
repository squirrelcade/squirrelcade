import { Autocomplete, Button, Group, Modal, Stack, Text } from '@mantine/core';
import { useElementSize, useReducedMotion } from '@mantine/hooks';
import { shelfReadKey } from '@squirrelcade/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from './api';
import { notifyError, useCanEdit } from './hooks';
import { readCopy, refreshCopy, unreachable, type OfflineCopy } from './offline';
import {
  allReads,
  boundsOf,
  checklist,
  keepOwnFix,
  keepTitles,
  keptTitles,
  linesFor,
  ownFixes,
  photoReader,
  photoView,
  shelfConsoles,
  shelfFixes,
  shelfMatcher,
  type ReadLine,
  type ReaderProgress,
  type ShelfChecklist,
} from './shelfCheck';

/**
 * Reading a shelf on the phone (D147), shared by Check a shelf (Store Mode) and the collection audit's shelves: Store
 * Mode's copy of the answers, the reader's progress, the vision model's pass, the fixes remembered for each console,
 * and the checklist the photos make. shelfCheck.ts holds the plain part (the reader, the matcher, the checklist).
 */

/** A photo's pieces being read by the vision model (POST /api/v1/shelf/read, then GET /api/v1/shelf/read/:id). */
interface ModelJob {
  id: string;
  state: 'waiting' | 'reading' | 'done' | 'failed';
  titles: string[];
  error: string | null;
  sent: number;
  left: number | null;
}

export function remembered(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage is off: nothing remembered.
  }
}

/** Store Mode's copy of its answers: the one kept in this browser, or fetched now when none is kept. */
async function loadCopy(): Promise<OfflineCopy> {
  const saved = (await refreshCopy()) ?? (await readCopy());
  if (saved) return saved.copy;
  return api<OfflineCopy>('/lookup/offline');
}

/** The colors of the boxes drawn on the photo, by group: the unsure ones you'd need are green and dashed (T-406). */
export const BOX = { need: '#2f9e44', own: '#1c7ed6', elsewhere: '#f59f00', other: '#868e96', unsure: '#e8590c', unread: '#ffffff' } as const;

/** Each text read as a game, with its box's color: the sure games' (each of their reads), then the unsure ones'. */
function boxColors(list: ShelfChecklist): Map<string, { color: string; dashed: boolean }> {
  const color = new Map<string, { color: string; dashed: boolean }>();
  for (const group of ['need', 'own', 'elsewhere', 'other'] as const) for (const f of list[group]) for (const t of f.reads) if (!color.has(t)) color.set(t, { color: BOX[group], dashed: false });
  for (const u of list.unsure) for (const t of u.reads ?? [u.read]) if (!color.has(t)) color.set(t, { color: u.wanted ? BOX.need : BOX.unsure, dashed: true });
  return color;
}

const points = (box: [number, number][]) => box.map(([x, y]) => `${x},${y}`).join(' ');

/**
 * The photo with a box around each spine read as a game, colored by its answer (unsure ones dashed), and a faint
 * one around the other text read: tap any box to say which game it is (or that it's none). With `focus` (the texts read
 * as a game tapped in a list, T-406), it zooms to that game's spines and lights them up, the rest of the photo dimmed;
 * the boxes still answer a tap. `maxHeight` keeps the frame within that height, a taller photo shown whole inside it.
 */
export function PhotoBoxes({
  url,
  width,
  height,
  lines,
  list,
  fixes,
  onTap,
  focus,
  maxHeight,
}: {
  url: string;
  width: number;
  height: number;
  lines: ReadLine[];
  list: ShelfChecklist;
  fixes: Map<string, string | null>;
  onTap: (read: string) => void;
  focus?: readonly string[] | null;
  maxHeight?: string;
}) {
  const color = useMemo(() => boxColors(list), [list]);
  const { ref, width: frameWidth, height: frameHeight } = useElementSize();
  const still = useReducedMotion();
  const focused = useMemo(() => (focus?.length ? linesFor(lines, focus) : []), [lines, focus]);
  const view = frameWidth > 0 ? photoView({ width, height }, { width: frameWidth, height: frameHeight }, boundsOf(focused)) : null;
  // Lines keep their width on the screen however far the photo is zoomed.
  const zoom = view?.scale ?? 1;
  const stroke = Math.max(2, Math.round(Math.max(width, height) / 400));
  return (
    <div ref={ref} style={{ position: 'relative', width: '100%', aspectRatio: `${width} / ${height}`, maxHeight, overflow: 'hidden', borderRadius: 6, background: 'var(--mantine-color-dark-7)' }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: frameWidth || '100%',
          height: frameWidth ? (frameWidth * height) / width : '100%',
          transform: view ? `translate(${view.x}px, ${view.y}px) scale(${view.scale})` : undefined,
          transformOrigin: '0 0',
          transition: still ? undefined : 'transform 280ms ease-out',
        }}
      >
        <img src={url} alt="Your shelf photo, with a box around each game read" style={{ width: '100%', height: '100%', display: 'block' }} />
        <svg viewBox={`0 0 ${width} ${height}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} aria-hidden>
          {lines.map((l, i) => {
            // Only reads long enough to be a game can be fixed (the matcher's own rule).
            if (l.score < 0.5 || shelfReadKey(l.text).length < 4) return null;
            const c = color.get(l.text);
            const none = fixes.get(shelfReadKey(l.text)) === null;
            const w = (c ? stroke : Math.max(1, stroke / 2)) / zoom;
            return (
              <polygon
                key={i}
                points={points(l.box)}
                fill="transparent"
                stroke={c ? c.color : none ? BOX.other : BOX.unread}
                strokeOpacity={c ? 1 : 0.55}
                strokeWidth={w}
                strokeDasharray={c?.dashed ? `${w * 3} ${w * 2}` : !c ? `${w} ${w * 2}` : undefined}
                style={{ cursor: 'pointer', pointerEvents: 'all' }}
                onClick={() => onTap(l.text)}
              />
            );
          })}
          {focused.length > 0 && (
            // The tapped game's spines: the rest of the photo dimmed around them, and each outlined in white and its color.
            // Drawn over the boxes but letting taps through to them.
            <g style={{ pointerEvents: 'none' }}>
              <path d={`M0 0H${width}V${height}H0Z ${focused.map((l) => `M${l.box.map(([x, y]) => `${x} ${y}`).join('L')}Z`).join(' ')}`} fill="#000" fillOpacity={0.5} fillRule="evenodd" />
              {focused.map((l, i) => (
                <polygon key={`white${i}`} points={points(l.box)} fill="transparent" stroke="#fff" strokeWidth={(stroke * 4) / zoom} />
              ))}
              {focused.map((l, i) => (
                <polygon key={`color${i}`} points={points(l.box)} fill="transparent" stroke={color.get(l.text)?.color ?? BOX.unread} strokeWidth={(stroke * 2) / zoom} />
              ))}
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}

/** Which game a spine is: one of the console's games, or none; remembered for the next photo of it. */
export function FixSpine({ read, titles, current, saved, onSave, onClose }: { read: string; titles: string[]; current: string | null | undefined; saved: boolean; onSave: (title: string | null | undefined) => void; onClose: () => void }) {
  const [value, setValue] = useState(current ?? '');
  const known = useMemo(() => new Set(titles), [titles]);
  return (
    <Modal opened onClose={onClose} title="Which game is this?" centered>
      <Stack gap="sm">
        <Text size="sm">
          Read on the photo: <b>“{read}”</b>
        </Text>
        <Autocomplete label="The game" placeholder="Start typing its title" data={titles} limit={30} value={value} onChange={setValue} />
        <Group gap="xs">
          <Button color="forest" disabled={!known.has(value)} onClick={() => onSave(value)}>
            This is it
          </Button>
          <Button variant="default" onClick={() => onSave(null)}>
            Not a game
          </Button>
          {current !== undefined && (
            <Button variant="subtle" color="gray" onClick={() => onSave(undefined)}>
              Forget the fix
            </Button>
          )}
        </Group>
        <Text size="xs" c="dimmed">
          Remembered for this console: the next photo with this spine reads it this way{saved ? ', on every phone' : ', on this phone'}.
        </Text>
      </Stack>
    </Modal>
  );
}

/** A photo read on the phone: the file (to keep, for the audit), what the reader read, and what the vision model read. */
export interface ShelfPhoto {
  id: number;
  file: File;
  url: string;
  width: number;
  height: number;
  lines: ReadLine[];
  modelTitles: string[];
}

/**
 * Reads photos of a shelf of one console's games. One photo at a time by default (a new one replaces it: Check a
 * shelf); with `many`, each photo adds to the shelf's reads (the audit's shelf, photographed in parts).
 */
export function useShelfReader({ consoleKey, many = false }: { consoleKey: string | null; many?: boolean }) {
  const canEdit = useCanEdit();
  const queryClient = useQueryClient();
  const copy = useQuery({ queryKey: ['shelf', 'copy'], queryFn: loadCopy, staleTime: 60_000, networkMode: 'always' });
  const model = useQuery({ queryKey: ['shelf', 'model'], queryFn: () => api<{ available: boolean; left: number | null; pieces: number; helper: boolean | null }>('/shelf/model'), retry: false });
  const consoles = useMemo(() => (copy.data ? shelfConsoles(copy.data) : []), [copy.data]);
  const chosen = consoles.find((c) => c.key === consoleKey) ?? null;
  const [progress, setProgress] = useState<ReaderProgress | null>(null);
  const [busy, setBusy] = useState<'reading' | 'model' | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [photos, setPhotos] = useState<ShelfPhoto[]>([]);
  const [modelNote, setModelNote] = useState<string | null>(null);
  // Fixes: the copy's (saved in Squirrelcade) and this phone's own (a viewer's, or ones made with no connection).
  const [own, setOwn] = useState(ownFixes);
  const run = useRef(0);
  // The console's full list (Settings > Interface > Store Mode), kept on the phone for shelves with no signal.
  const fullList = useQuery({
    queryKey: ['shelf', 'titles', chosen?.key],
    enabled: Boolean(chosen),
    staleTime: 10 * 60_000,
    networkMode: 'always',
    retry: false,
    queryFn: async () => {
      const key = chosen!.key;
      try {
        const { titles } = await api<{ titles: string[] }>(`/shelf/titles/${encodeURIComponent(key)}`);
        keepTitles(key, titles);
        return titles;
      } catch {
        return keptTitles(key) ?? [];
      }
    },
  });

  // The photos' pictures are let go when they're replaced, cleared, or the page is left.
  const shown = useRef<ShelfPhoto[]>([]);
  shown.current = photos;
  useEffect(
    () => () => {
      for (const p of shown.current) URL.revokeObjectURL(p.url);
    },
    [],
  );

  const matched = useMemo(() => (copy.data && chosen ? shelfMatcher(copy.data, chosen.index, fullList.data ?? []) : null), [copy.data, chosen, fullList.data]);
  const fixes = useMemo(() => (copy.data && chosen ? shelfFixes(copy.data, chosen.index, own[chosen.key] ?? {}) : new Map<string, string | null>()), [copy.data, chosen, own]);
  const modelTitles = useMemo(() => photos.flatMap((p) => p.modelTitles), [photos]);
  const list = useMemo(
    () => (matched && photos.length > 0 ? checklist(matched.matcher.match(allReads(photos.flatMap((p) => p.lines), modelTitles), fixes), matched.games) : null),
    [matched, photos, modelTitles, fixes],
  );
  const titles = useMemo(() => [...new Set([...(matched?.games.values() ?? [])].map((g) => g.t))].sort((a, b) => a.localeCompare(b)), [matched]);

  /** Sends this phone's fixes to Squirrelcade, for the owner: each one sent leaves the phone's list (the copy has it). */
  const sendOwn = async (platformKey: string, readKey: string, read: string, title: string | null | undefined) => {
    if (title === undefined) await api(`/shelf/fixes?platform=${encodeURIComponent(platformKey)}&read=${encodeURIComponent(read)}`, { method: 'DELETE' });
    else await api('/shelf/fixes', { method: 'PUT', json: { platform: platformKey, read, title } });
    await queryClient.invalidateQueries({ queryKey: ['shelf', 'copy'] });
    if (title !== undefined) setOwn(keepOwnFix(platformKey, readKey, undefined));
  };

  // Fixes made with no connection go to Squirrelcade once it answers (the read's key stands for the read).
  useEffect(() => {
    if (!canEdit || !copy.data) return;
    for (const [platformKey, mine] of Object.entries(ownFixes())) for (const [readKey, title] of Object.entries(mine)) void sendOwn(platformKey, readKey, readKey, title).catch(() => undefined);
    // Once per page, when the copy is first there.
  }, [canEdit, Boolean(copy.data)]);

  /** Says which game a spine is (null: none; undefined: forget the fix), on this phone at once, then in Squirrelcade. */
  const fix = async (read: string, title: string | null | undefined) => {
    if (!chosen) return;
    const readKey = shelfReadKey(read);
    // On this phone at once, so the checklist changes now (and keeps it with no connection); then in Squirrelcade.
    setOwn(keepOwnFix(chosen.key, readKey, title));
    if (!canEdit) return;
    try {
      await sendOwn(chosen.key, readKey, read, title);
    } catch (err) {
      if (!unreachable(err)) notifyError(err);
      else if (title === undefined) notifyError(new Error('Forgetting a fix saved in Squirrelcade needs a connection.'));
    }
  };

  /** Reads a photo of the chosen console's shelf: on the phone, then (when it's on) with the vision model too. */
  const read = async (file: File | null, upright: boolean) => {
    if (!file || !chosen) return;
    const mine = ++run.current;
    setFailure(null);
    if (!many) setPhotos((ps) => ps.map((p) => ({ ...p, modelTitles: [] })));
    setModelNote(null);
    setProgress(null);
    setBusy('reading');
    try {
      const reader = await photoReader();
      const canvas = await reader.decodePhoto(file);
      const done = await reader.readCanvas(canvas, { turns: upright ? ['ccw', '0'] : ['ccw'], onProgress: (p) => mine === run.current && setProgress(p) });
      if (mine !== run.current) return;
      const photo: ShelfPhoto = { id: mine, file, url: URL.createObjectURL(file), width: done.width, height: done.height, lines: done.lines, modelTitles: [] };
      if (many) setPhotos((ps) => [...ps, photo]);
      else {
        for (const p of shown.current) URL.revokeObjectURL(p.url);
        setPhotos([photo]);
      }
      // The vision model, when it's on and Squirrelcade answers: pieces of the photo, read there, matched here.
      // (A helper that isn't asking for work just now would leave the photo waiting: then the phone's reading is all.)
      if (model.data?.available && model.data.left !== 0 && model.data.helper !== false) {
        setBusy('model');
        try {
          // A job: started at once, then asked about every two seconds until it's read (a helper may take a minute).
          const started = await api<ModelJob>('/shelf/read', { method: 'POST', json: { pieces: reader.photoPieces(canvas, model.data.pieces), console: chosen.name } });
          let answer = started;
          const until = Date.now() + 11 * 60_000;
          while ((answer.state === 'waiting' || answer.state === 'reading') && Date.now() < until && mine === run.current) {
            await new Promise((r) => setTimeout(r, 2000));
            answer = await api<ModelJob>(`/shelf/read/${started.id}`);
          }
          if (mine !== run.current) return;
          if (answer.state !== 'done') throw new Error(answer.error ?? 'it took too long');
          setPhotos((ps) => ps.map((p) => (p.id === mine ? { ...p, modelTitles: answer.titles } : p)));
          setModelNote(`Your vision model read ${answer.titles.length} ${answer.titles.length === 1 ? 'title' : 'titles'} in ${answer.sent} ${answer.sent === 1 ? 'piece' : 'pieces'} of the photo${answer.left !== null ? ` (${answer.left} pieces left today)` : ''}.`);
          void queryClient.invalidateQueries({ queryKey: ['shelf', 'model'] });
        } catch (err) {
          if (mine === run.current) setModelNote(unreachable(err) ? 'No connection to Squirrelcade, so only this phone read the photo.' : `The vision model didn't read it: ${errorMessage(err)}`);
        }
      }
    } catch (err) {
      if (mine === run.current) setFailure(errorMessage(err));
    } finally {
      if (mine === run.current) setBusy(null);
    }
  };

  /** Starts over with no photos (the next shelf). */
  const clear = () => {
    run.current++;
    for (const p of shown.current) URL.revokeObjectURL(p.url);
    setPhotos([]);
    setBusy(null);
    setFailure(null);
    setModelNote(null);
    setProgress(null);
  };

  return { canEdit, copy, model, consoles, chosen, progress, busy, failure, photos, modelTitles, modelNote, list, fixes, titles, fix, read, clear };
}
