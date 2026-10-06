import { ActionIcon, Menu, Select, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { IconAdjustmentsHorizontal } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { notifyError, useCanEdit, useSetting } from './hooks';
import { Acorn, Acorns } from './Acorn';

/** The preference that keeps a game off the wishlist, always there whatever the points list holds. */
export const DO_NOT_RECOMMEND = 'Do Not Recommend';

/** A preference level as the pickers offer it: its name and its mark. */
export interface PreferenceLevel {
  value: string;
  mark: string;
}

/**
 * The preference levels, most wanted first, each with a mark that follows its points (the names are the owner's
 * settings, so a renamed level keeps a fitting mark): 🔥 the top one, ⭐ the next, 👍 the others above zero, ⚪ zero,
 * 👎 below zero, and 🚫 Do Not Recommend. "No Adjustment" isn't a level: it's no preference.
 */
export function preferenceLevels(points: Record<string, number>): PreferenceLevel[] {
  const levels = Object.entries(points)
    .filter(([name]) => name !== 'No Adjustment' && name !== DO_NOT_RECOMMEND)
    .sort((a, b) => b[1] - a[1]);
  const positive = levels.filter(([, p]) => p > 0);
  const markOf = (name: string, p: number) => (p > 0 ? (positive[0]?.[0] === name ? '🔥' : positive[1]?.[0] === name ? '⭐' : '👍') : p < 0 ? '👎' : '⚪');
  return [...levels.map(([name, p]) => ({ value: name, mark: markOf(name, p) })), { value: DO_NOT_RECOMMEND, mark: '🚫' }];
}

/** Everything a preference changes, refreshed after one. */
const TOUCHED = ['wishlist', 'game', 'catalogs', 'lookup', 'history', 'sets', 'series', 'gotd'];

/**
 * Your preference for a game (Must Have, Do Not Recommend...), wherever a game you don't have is listed: the wishlist,
 * a console's page, Coming soon, Past releases, the Top 100 and history, sets, series, Store Mode and its drawer. Settings > Interface > "Your preferences shown as" makes it the mark alone.
 * A viewer sees the preference but can't change it.
 */
export function PreferencePicker({
  platformKey,
  title,
  value,
  width = 180,
  disabled = false,
  compact = false,
}: {
  platformKey: string;
  title: string;
  value: string | null;
  width?: number;
  disabled?: boolean;
  /** The mark alone, whatever Settings > Interface says: for crowded lists (the timeline). */
  compact?: boolean;
}) {
  const points = useSetting('wishlist.preferencePoints', {});
  const style = useSetting('interface.preferenceStyle', 'acorns');
  const canEdit = useCanEdit();
  const queryClient = useQueryClient();
  const change = useMutation({
    mutationFn: (preference: string | null) => api('/wishlist/preferences', { method: 'PUT', json: { platformKey, title, preference, note: null } }),
    onSuccess: () => Promise.all(TOUCHED.map((k) => queryClient.invalidateQueries({ queryKey: [k] }))),
    onError: (err) => notifyError(err),
  });
  const levels = preferenceLevels(points);
  const current = levels.find((l) => l.value === value) ?? null;

  // A level's acorns, signed (+20, −5); Do Not Recommend has none: it keeps the game off the list.
  const acornsOf = (level: string) => {
    if (level === DO_NOT_RECOMMEND) return null;
    const n = points[level] ?? 0;
    return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0';
  };

  if (!canEdit) {
    return current ? (
      <Text size="sm" span>
        <span aria-hidden="true">{current.mark}</span>{' '}
        {style === 'compact' ? null : style === 'acorns' ? acornsOf(current.value) !== null && <Acorns n={acornsOf(current.value)!} size={11} /> : current.value}
      </Text>
    ) : null;
  }

  // The mark and its acorns in a small button (🔥 +20 and the acorn, 0.53.0): the levels, with theirs, in its menu.
  if (style === 'acorns' && !compact) {
    const label = `Your preference for ${title}: ${current?.value ?? 'none'}`;
    const shown = current ? acornsOf(current.value) : null;
    return (
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <Tooltip label={current ? `${current.value}${shown !== null ? `: ${shown} acorns` : ''}` : 'No preference'}>
            <UnstyledButton className="sc-pref" aria-label={label} disabled={disabled || change.isPending} data-empty={!current}>
              {current ? (
                <>
                  <span aria-hidden="true">{current.mark}</span>
                  {shown !== null && (
                    <span aria-hidden="true" className="sc-acorns">
                      {shown}
                      <Acorn size={11} />
                    </span>
                  )}
                </>
              ) : (
                <span aria-hidden="true" className="sc-acorns">
                  ±<Acorn size={11} />
                </span>
              )}
            </UnstyledButton>
          </Tooltip>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>Your preference</Menu.Label>
          {levels.map((l) => (
            <Menu.Item
              key={l.value}
              leftSection={<span aria-hidden="true">{l.mark}</span>}
              rightSection={acornsOf(l.value) !== null ? <Acorns n={acornsOf(l.value)!} size={11} /> : undefined}
              onClick={() => change.mutate(l.value)}
            >
              {l.value}
            </Menu.Item>
          ))}
          {current && <Menu.Item onClick={() => change.mutate(null)}>No preference</Menu.Item>}
        </Menu.Dropdown>
      </Menu>
    );
  }

  if (style === 'compact' || compact) {
    const label = `Your preference for ${title}: ${current?.value ?? 'none'}`;
    return (
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <Tooltip label={current?.value ?? 'No preference'}>
            <ActionIcon variant="subtle" color="gray" aria-label={label} loading={change.isPending} disabled={disabled}>
              {current ? <span aria-hidden="true">{current.mark}</span> : <IconAdjustmentsHorizontal size={16} />}
            </ActionIcon>
          </Tooltip>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>Your preference</Menu.Label>
          {levels.map((l) => (
            <Menu.Item key={l.value} leftSection={<span aria-hidden="true">{l.mark}</span>} onClick={() => change.mutate(l.value)}>
              {l.value}
            </Menu.Item>
          ))}
          {current && <Menu.Item onClick={() => change.mutate(null)}>No preference</Menu.Item>}
        </Menu.Dropdown>
      </Menu>
    );
  }

  return (
    <Select
      size="xs"
      w={width}
      placeholder="No preference"
      aria-label={`Your preference for ${title}`}
      data={levels.map((l) => ({ value: l.value, label: `${l.mark} ${l.value}` }))}
      value={current?.value ?? null}
      clearable
      disabled={disabled || change.isPending}
      onChange={(v) => change.mutate(v)}
    />
  );
}
