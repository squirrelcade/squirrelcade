import { Group, Tooltip } from '@mantine/core';
import { IconCircleCheckFilled } from '@tabler/icons-react';

/** A key box's name with a big check mark when a key is saved (the box stays empty: a saved key never comes back). */
export function SavedLabel({ label }: { label: string }) {
  return (
    <Group gap={6} component="span" wrap="nowrap">
      <span>{label}</span>
      <Tooltip label="Saved">
        <IconCircleCheckFilled size={20} color="var(--mantine-color-green-6)" aria-hidden style={{ flex: 'none' }} />
      </Tooltip>
    </Group>
  );
}
