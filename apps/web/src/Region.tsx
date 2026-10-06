import { consoleRegion, REGION_LABELS, REGION_SHORT, type Region } from '@squirrelcade/core';
import { Badge, Tooltip, type MantineSize } from '@mantine/core';
import { useSetting } from './hooks';

/** Badge colors by region: Japan red, PAL blue, Asia orange, the rest gray. */
const COLORS: Partial<Record<Region, string>> = { japan: 'red', europe: 'blue', asia: 'orange' };

/**
 * An owned copy's region as a small badge ("JP", "PAL", "US"), with the region and PriceCharting's
 * console name on hover ("Japan · Super Famicom"). Settings > Interface decides which copies get
 * one: by default those from other regions than the console's (the home region, or on another
 * region's own console such as the Super Famicom, that region).
 */
export function RegionBadge({
  region,
  consoleLabel,
  platformKey,
  size = 'xs',
}: {
  region: string | null | undefined;
  consoleLabel?: string | null;
  /** The console the copy counts toward, when known. */
  platformKey?: string | null;
  size?: MantineSize;
}) {
  const mode = useSetting('interface.regionBadges', 'other');
  const home = useSetting('general.homeRegion', 'north-america');
  if (!region || mode === 'off' || (mode === 'other' && region === (platformKey ? consoleRegion(platformKey, home) : home))) return null;
  const r = region as Region;
  return (
    <Tooltip label={[REGION_LABELS[r] ?? region, consoleLabel].filter(Boolean).join(' · ')}>
      <Badge size={size} variant="light" color={COLORS[r] ?? 'gray'} miw="max-content">
        {REGION_SHORT[r] ?? region}
      </Badge>
    </Tooltip>
  );
}
