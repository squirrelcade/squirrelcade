import { Tooltip } from '@mantine/core';
import { IconExternalLink, IconPlayerPlayFilled } from '@tabler/icons-react';

/** A link to a game in the user's RomM, as the API sends it (see apps/server/src/romm.ts). */
export interface RommLink {
  romId: number;
  name: string;
  url: string;
  playUrl: string | null;
  /** Matched by title only: IGDB doesn't confirm it's the same game. */
  possible: boolean;
}

/**
 * RomM's purple button, the same everywhere (the owner, 2026-10-23: "a button on top that says Play on RomM"; then
 * "I would much rather have the purple button... across the entire project"): Play on RomM when RomM can run the
 * game in the browser, Open in RomM when it can't, "RomM?" when only the title matched. Small in lists.
 */
export function RommChip({ link, small = false }: { link: RommLink | null | undefined; small?: boolean }) {
  if (!link) return null;
  const play = Boolean(link.playUrl) && !link.possible;
  const tip = link.possible ? `Possibly this game: RomM's "${link.name}" has the same title, but IGDB doesn't confirm it.` : play ? 'Play it in the browser, in RomM' : `In RomM as ${link.name}`;
  const icon = small ? 11 : 13;
  return (
    <Tooltip label={tip} multiline maw={280}>
      <a className="sc-chip" data-tone="romm" data-size={small ? 'sm' : undefined} href={play ? link.playUrl! : link.url} target="_blank" rel="noopener noreferrer">
        {play ? <IconPlayerPlayFilled size={icon} aria-hidden /> : <IconExternalLink size={icon} aria-hidden />}
        {play ? 'Play on RomM' : link.possible ? 'RomM?' : 'Open in RomM'}
      </a>
    </Tooltip>
  );
}

/** A game's RomM button in a list (a console's games, its Top 100, the Stash): the purple button, small, under its title. */
export function RommLinks({ link }: { link: RommLink | null | undefined }) {
  if (!link) return null;
  return (
    <div style={{ marginTop: 4 }}>
      <RommChip link={link} small />
    </div>
  );
}
