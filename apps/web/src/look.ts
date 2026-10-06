import { platformFamily, type PlatformFamily } from '@squirrelcade/core';
import type { CSSProperties } from 'react';

/**
 * The October 2026 look's pieces that are values rather than classes (brand.css has the classes): consoles' colors and
 * the kit's two button styles for Mantine's buttons.
 */

/** Each maker family's color variable (brand.css). */
export const FAMILY_COLOR: Record<PlatformFamily, string> = {
  playstation: 'var(--sc-ps)',
  xbox: 'var(--sc-xbox)',
  nintendo: 'var(--sc-nintendo)',
  other: 'var(--sc-other)',
};

/** The legend's names for the maker families. */
export const FAMILY_NAME: Record<PlatformFamily, string> = { playstation: 'PlayStation', xbox: 'Xbox', nintendo: 'Nintendo', other: 'Other' };

/** A console's color (D117): its maker's (blue PlayStation, green Xbox, orange Nintendo, gold the rest). */
export function platformColor(platformKey: string, name?: string): string {
  return FAMILY_COLOR[platformFamily(platformKey, name)];
}

/** A color dot's variable, for the .sc-dot and .sc-release classes. */
export const dot = (platformKey: string, name?: string) => ({ '--dot': platformColor(platformKey, name) }) as CSSProperties;

/** The kit's secondary button on a Mantine Button: deep green with a green hairline ("Another one", "Same game"). */
export const DEEP_BUTTON = {
  '--button-bg': 'var(--sc-deep)',
  '--button-hover': 'var(--sc-have-bg)',
  '--button-color': 'var(--sc-deep-ink)',
  '--button-bd': '1px solid var(--sc-deep-line)',
} as CSSProperties;

export { platformFamily };
