import { Alert, Anchor, Button, Card, Group, Stack, Text } from '@mantine/core';
import { IconExternalLink, IconMailSearch } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../api';
import { dateTime, timeAgo } from '../format';
import { notifyError, notifySuccess, useSetting } from '../hooks';

/** What GET /api/v1/mail answers: collection updates from email, set up or not, and the last look at the mailbox. */
export interface MailStatus {
  on: boolean;
  account: { user: string; host: string; port: number } | null;
  problem: string | null;
  lastCheck: { at: string; ok: boolean; message: string } | null;
  recent: { id: string; date: string; subject: string; status: string; detail: string; importId: number | null; checkedAt: string }[];
  exportUrl: string;
}

/**
 * On Collection updates: where exports can come from by email. On, the mailbox's last look and "Check now", with the
 * link to ask for an export; off, how to turn it on.
 */
export function MailCard() {
  const on = useSetting('features.mail', false);
  const dateFormat = useSetting('general.dateFormat', 'us');
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ['mail'], queryFn: () => api<MailStatus>('/mail'), enabled: on === true, refetchInterval: 15_000 });
  const check = useMutation({
    mutationFn: () => api<{ queued: boolean }>('/mail/check', { method: 'POST' }),
    onSuccess: () => {
      notifySuccess('Squirrelcade is looking in your mailbox; the result shows here in a moment.', 'Checking');
      setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ['mail'] });
        void queryClient.invalidateQueries({ queryKey: ['imports'] });
      }, 4000);
    },
    onError: (err) => notifyError(err),
  });
  if (!on) {
    return (
      <Text size="xs" c="dimmed" mb="lg">
        PriceCharting can email your export: with{' '}
        <Anchor component={Link} to="/settings/email#setting-features.mail" size="xs">
          collection updates from your email
        </Anchor>{' '}
        on, Squirrelcade picks it up from your mailbox, so an update is one tap on PriceCharting.
      </Text>
    );
  }
  const s = status.data;
  const last = s?.recent[0];
  return (
    <Card withBorder padding="sm" mb="lg">
      <Stack gap={6}>
        <Group justify="space-between" wrap="wrap" gap="xs">
          <Text fw={600} size="sm">
            From your email
          </Text>
          <Group gap="xs">
            <Button component="a" href={s?.exportUrl ?? 'https://www.pricecharting.com/my-collection'} target="_blank" rel="noreferrer" size="compact-sm" variant="light" rightSection={<IconExternalLink size={12} />}>
              Export on PriceCharting
            </Button>
            <Button size="compact-sm" variant="default" leftSection={<IconMailSearch size={14} />} loading={check.isPending} onClick={() => check.mutate()} disabled={!s?.account}>
              Check now
            </Button>
          </Group>
        </Group>
        {s?.problem ? (
          <Alert color="yellow" p="xs">
            {s.problem}{' '}
            <Anchor component={Link} to="/settings/email#setting-features.mail" size="sm" c="inherit" fw={600} underline="always">
              Set it up
            </Anchor>
          </Alert>
        ) : (
          <Text size="xs" c="dimmed">
            Ask PriceCharting for an export (My Collection › Download (CSV)): its email comes to {s?.account?.user ?? 'your mailbox'}, and Squirrelcade updates your collection from it{s?.lastCheck ? `. Last looked ${timeAgo(s.lastCheck.at)}` : ''}.
          </Text>
        )}
        {s?.lastCheck && !s.lastCheck.ok && !s.problem && (
          <Alert color="red" p="xs">
            {s.lastCheck.message}
          </Alert>
        )}
        {last && (
          <Text size="xs">
            Last export email ({dateTime(last.date, dateFormat)}): {last.detail}
          </Text>
        )}
      </Stack>
    </Card>
  );
}
