import { Anchor, Group, Tooltip } from '@mantine/core';
import { IconExternalLink, IconPlayerPlay } from '@tabler/icons-react';

/** A link to a game in the user's RomM, as the API sends it (see apps/server/src/romm.ts). */
export interface RommLink {
  romId: number;
  name: string;
  url: string;
  playUrl: string | null;
  /** Matched by title only: IGDB doesn't confirm it's the same game. */
  possible: boolean;
}

/** "RomM" and, when RomM can run the game in the browser, "Play": the owned game in the user's RomM, in a new tab. */
export function RommLinks({ link }: { link: RommLink | null | undefined }) {
  if (!link) return null;
  const tip = link.possible ? `Possibly this game: RomM's "${link.name}" has the same title, but IGDB doesn't confirm it.` : `In RomM as ${link.name}`;
  return (
    <Group gap={10} wrap="nowrap" mt={2}>
      <Tooltip label={tip} multiline maw={300}>
        <Anchor href={link.url} target="_blank" rel="noopener noreferrer" size="xs" c={link.possible ? 'dimmed' : undefined}>
          <Group gap={3} wrap="nowrap" component="span">
            <IconExternalLink size={12} />
            {link.possible ? 'RomM?' : 'RomM'}
          </Group>
        </Anchor>
      </Tooltip>
      {link.playUrl && (
        <Tooltip label="Play it in the browser, in RomM">
          <Anchor href={link.playUrl} target="_blank" rel="noopener noreferrer" size="xs">
            <Group gap={3} wrap="nowrap" component="span">
              <IconPlayerPlay size={12} />
              Play
            </Group>
          </Anchor>
        </Tooltip>
      )}
    </Group>
  );
}
