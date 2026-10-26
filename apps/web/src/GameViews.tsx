import { AspectRatio, Box, Center, Image, SegmentedControl, Stack, Text } from '@mantine/core';
import { igdbCoverUrl, JUMP_LETTERS, jumpFirsts, jumpLetterOf } from '@squirrelcade/core';
import { IconLayoutGrid, IconList } from '@tabler/icons-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { GameTitle, useOpenGame } from './GameDrawer';
import { useSetting } from './hooks';
import { CoverMarks } from './ConsoleMark';

/**
 * Game lists two ways and the A–Z bar beside them (the owner, 2026-10-24: "on the right-hand side a letter system so I
 * could just quickly jump... swap from this view to also have a table sort of view... anywhere we're showing a lot
 * of data"). The pieces every game list shares: the view switch, the A–Z bar, and a game's box art tile.
 */

export type ListView = 'covers' | 'table';

function remembered(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * A list's view: the address's ?as= (covers or table; ?view= means other things on some pages), else what this browser
 * used last on the page, else Settings > Interface > "Game lists open as" (or the page's own first view).
 */
export function useListView(page: string, own: ListView): [ListView, (view: ListView) => void] {
  const [params, setParams] = useSearchParams();
  const setting = useSetting('interface.gameListView', 'page');
  const key = `squirrelcade-view-${page}`;
  const asked = params.get('as');
  const kept = remembered(key);
  const view: ListView =
    asked === 'covers' || asked === 'table' ? asked : kept === 'covers' || kept === 'table' ? kept : setting === 'covers' || setting === 'table' ? setting : own;
  const set = (next: ListView) => {
    try {
      localStorage.setItem(key, next);
    } catch {
      // Storage is off: the address keeps it for this visit.
    }
    const p = new URLSearchParams(params);
    p.set('as', next);
    setParams(p, { replace: true });
  };
  return [view, set];
}

/** Box art or a table: the switch at the top of a game list. */
export function ViewSwitch({ value, onChange }: { value: ListView; onChange: (view: ListView) => void }) {
  return (
    <SegmentedControl
      size="xs"
      value={value}
      onChange={(v) => onChange(v as ListView)}
      aria-label="Show as box art or a table"
      data={[
        {
          value: 'covers',
          label: (
            <Box component="span" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <IconLayoutGrid size={14} /> Box art
            </Box>
          ),
        },
        {
          value: 'table',
          label: (
            <Box component="span" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <IconList size={14} /> Table
            </Box>
          ),
        },
      ]}
    />
  );
}

/** Scrolls to the list's item at this place once it's on the page (a new page of a list takes a moment to come). */
function scrollWhenThere(index: number, tries = 80) {
  const el = document.querySelector(`[data-jump="${index}"]`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (tries > 0) window.setTimeout(() => scrollWhenThere(index, tries - 1), 50);
}

/** Marks an item of a list for the A–Z bar: its place in the whole list (every page). */
export const jumpMark = (index: number) => ({ 'data-jump': index });

/**
 * The A–Z bar at a list's right side (Settings > Interface > "A–Z bar from"): a letter jumps to the first game
 * starting with it, or the next letter that has one; a list in another order is put in A to Z order first. For a list
 * in pages, the page with the letter is turned to. Each item carries jumpMark(its place).
 */
export function LetterBar({
  titles,
  firsts: given,
  total,
  inTitleOrder,
  sortByTitle,
  pageSize,
  setPage,
}: {
  /** The list's titles in its order (all of them), when the page has them; else `firsts` and `total`. */
  titles?: readonly string[];
  /** Where each letter starts, for a list kept on the server (null while it isn't in title order). */
  firsts?: Record<string, number> | null;
  total?: number;
  inTitleOrder: boolean;
  /** Puts the list in A to Z order. */
  sortByTitle?: () => void;
  pageSize?: number;
  setPage?: (page: number) => void;
}) {
  const from = useSetting('interface.letterBarFrom', 40);
  const [pending, setPending] = useState<string | null>(null);
  const firsts = useMemo(() => (given !== undefined ? given : titles && inTitleOrder ? jumpFirsts(titles) : null), [given, titles, inTitleOrder]);
  const present = useMemo(() => (titles ? new Set(titles.map(jumpLetterOf)) : firsts ? new Set(Object.keys(firsts)) : null), [titles, firsts]);
  const count = titles?.length ?? total ?? 0;

  const jump = (letter: string, at: Record<string, number>) => {
    // The letter, or the next one that has a game.
    const from = JUMP_LETTERS.indexOf(letter);
    const found = JUMP_LETTERS.slice(from).find((l) => l in at) ?? [...JUMP_LETTERS].reverse().find((l) => l in at);
    if (found === undefined) return;
    const index = at[found]!;
    if (pageSize && setPage) setPage(Math.floor(index / pageSize) + 1);
    scrollWhenThere(index);
  };

  // A letter tapped while the list was in another order: once it's in A to Z order.
  useEffect(() => {
    if (pending && inTitleOrder && firsts) {
      jump(pending, firsts);
      setPending(null);
    }
  }, [pending, inTitleOrder, firsts]);

  if (from === 0 || count < from) return null;
  return (
    <nav className="sc-letters" aria-label="Jump to a letter">
      {JUMP_LETTERS.map((l) => {
        const has = present ? present.has(l) : true;
        return (
          <button
            key={l}
            type="button"
            className="sc-letter"
            data-empty={has ? undefined : 'true'}
            aria-label={l === '#' ? 'Jump to games starting with a number' : `Jump to games starting with ${l}`}
            onClick={() => {
              if (inTitleOrder && firsts) jump(l, firsts);
              else if (sortByTitle) {
                sortByTitle();
                setPending(l);
              }
            }}
          >
            {l}
          </button>
        );
      })}
    </nav>
  );
}

/** A game as box art: its cover (grey when it isn't yours, its title on a plain tile without one), its title, a line under it. */
export function CoverTile({
  platformKey,
  title,
  coverId,
  imageUrl,
  dim = false,
  sub,
  jump,
  children,
}: {
  platformKey: string | null;
  title: string;
  coverId: string | null;
  /** Box art from elsewhere when IGDB has none for it (Steam's, for a PC game). */
  imageUrl?: string | null;
  dim?: boolean;
  sub?: ReactNode;
  /** Its place in the whole list, for the A–Z bar. */
  jump?: number;
  children?: ReactNode;
}) {
  const open = useOpenGame();
  const covers = useSetting('interface.showCoverArt', true);
  // A picture that doesn't load (Steam has no portrait art for some games) gives way to the title.
  const [failed, setFailed] = useState(false);
  const src = covers && !failed ? (coverId ? igdbCoverUrl(coverId, 'cover_big') : (imageUrl ?? null)) : null;
  return (
    <Stack gap={4} {...(jump !== undefined ? jumpMark(jump) : {})}>
      <Box aria-hidden="true" pos="relative" style={{ cursor: platformKey ? 'pointer' : undefined }} onClick={() => platformKey && open(platformKey, title)}>
        <AspectRatio ratio={3 / 4}>
          {src ? (
            <Image src={src} radius="sm" alt="" loading="lazy" fit="cover" onError={() => setFailed(true)} style={dim ? { filter: 'grayscale(1)', opacity: 0.5 } : undefined} />
          ) : (
            <Center p={6} style={{ borderRadius: 'var(--mantine-radius-sm)', border: '1px solid var(--mantine-color-default-border)', opacity: dim ? 0.6 : 1 }}>
              <Text size="xs" ta="center" lineClamp={5}>
                {title}
              </Text>
            </Center>
          )}
        </AspectRatio>
        {/* The consoles you have it on, in the corner (D175). */}
        {platformKey && <CoverMarks title={title} coverWidth={110} />}
      </Box>
      <Text size="xs" lineClamp={2} component="div">
        {platformKey ? <GameTitle platformKey={platformKey} title={title} size="xs" /> : title}
      </Text>
      {sub && (
        <Text size="xs" c="dimmed" lineClamp={2} component="div">
          {sub}
        </Text>
      )}
      {children}
    </Stack>
  );
}

/** The columns a list's box art takes at each width (the Stash's). */
export const COVER_COLS = { base: 3, xs: 4, sm: 5, md: 6, lg: 8 } as const;
