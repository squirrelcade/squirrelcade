import { channelsOn } from '@squirrelcade/core';
import { Anchor, Card, Group, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconCheck, IconCircleDashed } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../../api';
import { count, date } from '../../format';
import { useFeature, useSetting, useSettings } from '../../hooks';

interface Step {
  done: boolean;
  label: string;
  detail: string;
  to: string;
  optional?: boolean;
}

/**
 * What's set up and what's left, each with a link to where to do it. `unfinishedOnly` shows it only while an
 * essential step is left (on Today, for a new install).
 */
export function SetupChecklist({ unfinishedOnly = false }: { unfinishedOnly?: boolean }) {
  const dateFormat = useSetting('general.dateFormat', 'us');
  const { data: settings } = useSettings();
  // IGDB's and the PC library's pages answer only while those parts are on (Settings > Features): asked only then,
  // so a new install (the PC library off) still gets its checklist.
  const igdbOn = useFeature('igdb');
  const pcOn = useFeature('pc');
  const summary = useQuery({ queryKey: ['collection', 'summary'], queryFn: () => api<{ totals: { games: number }; currentImport: unknown | null }>('/collection/summary') });
  const catalogs = useQuery({ queryKey: ['catalogs'], queryFn: () => api<{ targets: number }[]>('/catalogs') });
  const backups = useQuery({ queryKey: ['backups'], queryFn: () => api<{ backups: { createdAt: string }[] }>('/backups') });
  const igdb = useQuery({ queryKey: ['igdb'], queryFn: () => api<{ configured: boolean; platforms: { syncedAt: string | null; error: string | null }[] }>('/sources/igdb'), enabled: igdbOn });
  const pc = useQuery({ queryKey: ['pc', 'status'], queryFn: () => api<{ families: number; byStorefront: unknown[]; lastRead: { status: string } | null }>('/pc'), enabled: pcOn });
  if (!settings || !summary.data || !catalogs.data || !backups.data || (igdbOn && igdb.isPending) || (pcOn && pc.isPending)) return null;

  const games = summary.data.totals.games;
  const catalogGames = catalogs.data.reduce((sum, p) => sum + p.targets, 0);
  const lastBackup = backups.data.backups[0];
  const channels = channelsOn(settings);
  const notifications = channels.length > 0;
  const synced = igdb.data?.platforms.filter((p) => p.syncedAt && !p.error).length ?? 0;
  const families = pc.data?.families ?? 0;
  const storefronts = pc.data?.byStorefront.length ?? 0;
  const steps: Step[] = [
    { done: games > 0, label: 'Collection', detail: games > 0 ? `${count(games)} game${games === 1 ? '' : 's'}` : 'Add your games, or upload an export (PriceCharting, a spreadsheet...)', to: games > 0 ? '/updates' : '/welcome' },
    {
      done: catalogGames > 0,
      label: 'Catalogs',
      detail:
        catalogGames > 0
          ? `${count(catalogGames)} catalog games on ${catalogs.data.length} consoles`
          : 'Built from Wikipedia for each console you collect, a few minutes after it has enough games (Settings › Platforms)',
      to: '/platforms',
    },
    { done: Boolean(lastBackup), label: 'Backups', detail: lastBackup ? `Newest ${date(lastBackup.createdAt, dateFormat)}` : 'The first backup runs soon after start', to: '/system/backups' },
    {
      done: notifications,
      label: 'Notifications',
      detail: notifications ? channels.join(', ') : 'Email, a phone app (Pushover, ntfy...) or a chat (Discord, Telegram...) for update summaries and problems',
      to: '/settings/notifications',
      optional: true,
    },
    {
      done: igdbOn && Boolean(igdb.data?.configured) && synced > 0,
      label: 'Covers and game details (IGDB)',
      detail: !igdbOn
        ? 'Off in Settings > Features'
        : !igdb.data?.configured
          ? 'Add free Twitch developer keys'
          : synced > 0
            ? `Downloaded for ${synced} consoles`
            : 'Keys set; run "Update now"',
      to: igdbOn ? '/settings/sources' : '/settings/features',
      optional: true,
    },
    {
      done: pcOn && families > 0,
      label: 'PC library',
      detail: !pcOn
        ? "Your PC games, from Playnite's library backups (Settings > Features)"
        : families > 0
          ? `${count(families)} PC games from ${storefronts} storefront${storefronts === 1 ? '' : 's'}`
          : "Your PC games, from Playnite's library backups",
      to: pcOn ? '/pc' : '/settings/features',
      optional: true,
    },
    {
      done: Boolean(settings['general.publicUrl']),
      label: 'Public address',
      detail: settings['general.publicUrl'] || 'For links in notifications and Store Mode on a phone',
      to: '/settings/general',
      optional: true,
    },
  ];
  const left = steps.filter((s) => !s.done && !s.optional).length;
  if (unfinishedOnly && left === 0) return null;

  return (
    <Card withBorder>
      <Title order={5} mb="xs">
        Setup
      </Title>
      <Text size="sm" c="dimmed" mb="sm">
        {left === 0 ? 'The essentials are done. The optional steps add more.' : `${left} essential step${left === 1 ? '' : 's'} left.`}{' '}
        <Anchor component={Link} to="/welcome" size="sm">
          Open the welcome guide
        </Anchor>
        {' · '}
        {/* Help > AI-assisted setup: a prompt for the owner's own AI, made for this install (0.29.0). */}
        <Anchor component={Link} to="/help/ai-setup" size="sm">
          Set it up with your AI's help
        </Anchor>
      </Text>
      <Stack gap={6}>
        {steps.map((s) => (
          <Group key={s.label} gap="sm" wrap="nowrap" align="flex-start">
            <ThemeIcon size={20} radius="xl" variant={s.done ? 'filled' : 'light'} color={s.done ? 'green' : s.optional ? 'gray' : 'yellow'}>
              {s.done ? <IconCheck size={12} /> : <IconCircleDashed size={12} />}
            </ThemeIcon>
            <div>
              <Anchor component={Link} to={s.to} size="sm" fw={500}>
                {s.label}
              </Anchor>
              {s.optional && !s.done && (
                <Text span size="xs" c="dimmed">
                  {' '}
                  (optional)
                </Text>
              )}
              <Text size="xs" c="dimmed">
                {s.detail}
              </Text>
            </div>
          </Group>
        ))}
      </Stack>
    </Card>
  );
}
