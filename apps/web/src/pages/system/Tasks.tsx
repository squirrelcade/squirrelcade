import { Anchor, Button, Group, Stack, Table, Text, Title, Tooltip } from '@mantine/core';
import { IconPlayerPlay } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../../api';
import { PageHeader, StatusBadge } from '../../components';
import { dateTime, interval, timeAgo } from '../../format';
import { notifyError, useSetting } from '../../hooks';

/** A service's task, and its card: where the service is switched on and set up. */
const TASK_HOME: Record<string, string> = {
  'ra-sync': '/settings/sources#setting-features.retroachievements',
  'xbox-sync': '/settings/sources#setting-features.xbox',
  'psn-sync': '/settings/sources#setting-features.playstation',
  'steam-sync': '/settings/sources#setting-features.steam',
  'igdb-sync': '/settings/sources#setting-features.igdb',
  'romm-sync': '/settings/sources#setting-features.romm',
  'pc-prices': '/settings/sources#setting-features.itad',
  'mail-import': '/settings/email#setting-features.mail',
  'pc-read': '/settings/pc#setting-features.pc',
  'pc-discover': '/settings/pc#setting-features.pc',
};

interface TaskInfo {
  name: string;
  title: string;
  description: string;
  intervalMs: number | null;
  state: 'idle' | 'queued' | 'running';
  nextRunAt: string | null;
  lastRun: { status: string; startedAt: string; finishedAt: string | null; message: string | null } | null;
  /** A quiet check's last look that found nothing (such looks stay out of the history). */
  lastLook: { at: string; message: string | null } | null;
}

interface Run {
  id: number;
  task: string;
  trigger: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  message: string | null;
}

/** Background tasks: each one's schedule and last run, "run now", and the run history. */
export function TasksPage() {
  const queryClient = useQueryClient();
  const dateFormat = useSetting('general.dateFormat', 'us');
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => api<TaskInfo[]>('/tasks'), refetchInterval: 5_000 });
  const history = useQuery({ queryKey: ['tasks', 'history'], queryFn: () => api<Run[]>('/tasks/history?limit=50'), refetchInterval: 5_000 });
  const run = useMutation({
    mutationFn: (name: string) => api(`/tasks/${name}/run`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
    onError: (err) => notifyError(err),
  });
  const titles = new Map(tasks.data?.map((t) => [t.name, t.title]));

  return (
    <>
      <PageHeader help="troubleshooting" title="Tasks" description="Background jobs. Their schedules are in Settings › Tasks." />
      <Stack>
        <Table.ScrollContainer minWidth={760}>
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Task</Table.Th>
                <Table.Th>Schedule</Table.Th>
                <Table.Th>Last run</Table.Th>
                <Table.Th>Next run</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {tasks.data?.map((t) => (
                <Table.Tr key={t.name}>
                  <Table.Td>
                    <Text size="sm" fw={500}>
                      {t.title}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {t.description}
                    </Text>
                    {TASK_HOME[t.name] && (
                      <Anchor component={Link} to={TASK_HOME[t.name]!} size="xs">
                        Set it up
                      </Anchor>
                    )}
                  </Table.Td>
                  <Table.Td>{interval(t.intervalMs)}</Table.Td>
                  <Table.Td>
                    {t.state !== 'idle' ? (
                      <StatusBadge status={t.state} />
                    ) : t.lastRun ? (
                      <Tooltip label={t.lastRun.message ?? ''} disabled={!t.lastRun.message} multiline w={320}>
                        <Group gap={6}>
                          <StatusBadge status={t.lastRun.status} />
                          <Text size="sm">{timeAgo(t.lastRun.startedAt)}</Text>
                        </Group>
                      </Tooltip>
                    ) : (
                      <Text size="sm" c="dimmed">
                        Never
                      </Text>
                    )}
                    {t.state === 'idle' && t.lastLook && (
                      <Text size="xs" c="dimmed">
                        Looked {timeAgo(t.lastLook.at)}: {t.lastLook.message ?? 'nothing new'}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>{t.nextRunAt ? timeAgo(t.nextRunAt) : '—'}</Table.Td>
                  <Table.Td>
                    <Button size="xs" variant="light" leftSection={<IconPlayerPlay size={14} />} disabled={t.state !== 'idle'} onClick={() => run.mutate(t.name)}>
                      Run now
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        <Title order={4}>Recent runs</Title>
        <Table.ScrollContainer minWidth={760}>
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Started</Table.Th>
                <Table.Th>Task</Table.Th>
                <Table.Th>Trigger</Table.Th>
                <Table.Th>Result</Table.Th>
                <Table.Th>Details</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {history.data?.map((r) => (
                <Table.Tr key={r.id}>
                  <Table.Td>{dateTime(r.startedAt, dateFormat)}</Table.Td>
                  <Table.Td>{titles.get(r.task) ?? r.task}</Table.Td>
                  <Table.Td>{r.trigger === 'schedule' ? 'Scheduled' : 'Manual'}</Table.Td>
                  <Table.Td>
                    <StatusBadge status={r.status} />
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" lineClamp={2}>
                      {r.message}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        {history.data?.length === 0 && (
          <Text c="dimmed" ta="center">
            No runs yet.
          </Text>
        )}
      </Stack>
    </>
  );
}
