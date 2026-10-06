import { igdbCoverUrl } from '@squirrelcade/core';
import { ActionIcon, Badge, Box, Card, Group, Image, Loader, Stack, Table, Text, Title, Tooltip, UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconChevronUp, IconHelp, IconSelector } from '@tabler/icons-react';
import { Link } from 'react-router';
import { useEffect, useState, type ReactNode } from 'react';
import { useSetting } from './hooks';

/** Which way a sortable table is sorted. */
export type SortDirection = 'asc' | 'desc';

/**
 * A table heading that sorts by its column: click to sort by it, click again to reverse. The arrow
 * shows the column the table is sorted by and which way; the others show a faint double arrow.
 */
export function SortableTh({ label, active, direction, onSort, ta }: { label: ReactNode; active: boolean; direction: SortDirection; onSort: () => void; ta?: 'left' | 'right' }) {
  const Icon = active ? (direction === 'asc' ? IconChevronUp : IconChevronDown) : IconSelector;
  return (
    <Table.Th ta={ta} p={0} aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <UnstyledButton onClick={onSort} px="sm" py={8} w="100%" style={{ display: 'flex', justifyContent: ta === 'right' ? 'flex-end' : 'flex-start' }}>
        <Group gap={4} wrap="nowrap">
          <Text fw={700} size="sm">
            {label}
          </Text>
          <Icon size={14} stroke={1.5} style={{ opacity: active ? 1 : 0.4 }} />
        </Group>
      </UnstyledButton>
    </Table.Th>
  );
}

/** A page's title, description and buttons. */
export function PageHeader({ title, description, actions, help }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; help?: string }) {
  return (
    <Group justify="space-between" align="flex-start" mb="md" wrap="wrap">
      <Stack gap={2}>
        <Group gap={6} wrap="nowrap">
          <Title order={2}>{title}</Title>
          {help && <HelpLink topic={help} />}
        </Group>
        {description && (
          <Text c="dimmed" size="sm">
            {description}
          </Text>
        )}
      </Stack>
      {actions && <Group gap="xs">{actions}</Group>}
    </Group>
  );
}

/** A number with a label, and optionally a hint under it. */
export function StatCard({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Card withBorder padding="sm">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text size="xl" fw={700}>
        {value}
      </Text>
      {hint && (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      )}
    </Card>
  );
}

const STATUS_COLORS: Record<string, string> = {
  success: 'green',
  applied: 'green',
  running: 'blue',
  queued: 'blue',
  pending: 'yellow',
  interrupted: 'orange',
  failed: 'red',
  refused: 'red',
  discarded: 'gray',
  idle: 'gray',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Waiting for you',
  applied: 'Applied',
  refused: 'Refused',
  discarded: 'Discarded',
  success: 'Succeeded',
  failed: 'Failed',
  running: 'Running',
  queued: 'Queued',
  interrupted: 'Interrupted',
};

/** A colored badge for a status such as applied, failed or running. */
export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge color={STATUS_COLORS[status] ?? 'gray'} variant="light" miw="max-content">
      {STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

/**
 * Box art from IGDB, when it's downloaded and "Show cover art" is on. In a list
 * where some games have covers, pass `placeholder` so the others keep the space.
 */
export function Cover({ id, width = 30, placeholder = false }: { id?: string | null; width?: number; placeholder?: boolean }) {
  const show = useSetting('interface.showCoverArt', true);
  if (!show || (!id && !placeholder)) return null;
  const height = Math.round((width * 4) / 3);
  if (!id) return <Box w={width} h={height} bg="var(--mantine-color-default-hover)" style={{ borderRadius: 3, flex: 'none' }} />;
  return <Image src={igdbCoverUrl(id, width > 90 ? 'cover_big' : 'cover_small')} w={width} h={height} radius={3} fit="cover" loading="lazy" alt="" style={{ flex: 'none' }} />;
}

/** The "?" beside a page's title: its guide in Help (docs/help). */
export function HelpLink({ topic }: { topic: string }) {
  return (
    <Tooltip label="Help for this page">
      <ActionIcon component={Link} to={`/help/${topic}`} variant="subtle" color="gray" size="md" aria-label="Help for this page">
        <IconHelp size={18} />
      </ActionIcon>
    </Tooltip>
  );
}

/**
 * "Asking again in 12 s": the countdown to a retry the page makes by itself (a barcode waiting its turn with the
 * barcode service). `since` is when the answer came.
 */
export function RetryCountdown({ seconds, since }: { seconds: number; since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, []);
  const left = Math.max(0, Math.ceil(seconds - (now - since) / 1000));
  return (
    <Group gap={6}>
      <Loader size="xs" />
      <Text size="sm">{left > 0 ? `Asking again in ${left} s` : 'Asking again…'}</Text>
    </Group>
  );
}

/** The barcode service's lookups left today, as it counts them: a quiet line, in bold once few are left. */
export function BarcodeLookupsLeft({ lookups }: { lookups: { left: number | null; resetAt: string | null } | null | undefined }) {
  if (!lookups || lookups.left === null) return null;
  const at = lookups.resetAt ? new Date(lookups.resetAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : null;
  const few = lookups.left <= 10;
  return (
    <Text size="xs" c={few ? undefined : 'dimmed'} fw={few ? 600 : undefined}>
      {lookups.left === 0
        ? `No barcode lookups left today${at ? `; more at ${at}` : ''}.`
        : `${lookups.left} barcode ${lookups.left === 1 ? 'lookup' : 'lookups'} left today${few && at ? ` (more at ${at})` : ''}.`}
    </Text>
  );
}
