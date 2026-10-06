import { ActionIcon, Anchor, Divider, Group, Loader, Popover, Stack, Text, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconActivity } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { api } from './api';
import { StatusBadge } from './components';
import { timeAgo } from './format';

interface TaskInfo {
  name: string;
  title: string;
  state: 'idle' | 'queued' | 'running';
  intervalMs: number | null;
  runningSince: string | null;
  progress: string | null;
  lastRun: { status: string; startedAt: string; finishedAt: string | null; message: string | null } | null;
}

/** A frequent check (such as the watched folder's, every 15 minutes) whose last run went fine: not worth a notice. */
const routine = (t: TaskInfo) => t.intervalMs !== null && t.intervalMs < 3_600_000 && t.lastRun?.status === 'success';

/** "3 min 20 s" since a moment. */
function elapsed(since: string | null, now: number): string {
  if (!since) return '';
  const s = Math.max(0, Math.round((now - Date.parse(since)) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

/**
 * The header's background-activity indicator: it spins while a task runs, and opens a list of what's
 * running (with its progress), what's waiting, and what finished lately. A task seen running gets a
 * notice when it ends, and the pages refresh with what it changed.
 */
export function ActivityIndicator() {
  const queryClient = useQueryClient();
  const [opened, setOpened] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const tasks = useQuery({
    queryKey: ['tasks'],
    queryFn: () => api<TaskInfo[]>('/tasks'),
    refetchInterval: (q) => ((q.state.data ?? []).some((t) => t.state !== 'idle') ? 3000 : 30_000),
  });
  const list = tasks.data ?? [];
  const busy = list.filter((t) => t.state !== 'idle').sort((a, b) => (a.state === b.state ? 0 : a.state === 'running' ? -1 : 1));
  // Lately: the last day's runs, without the routine checks that went fine.
  const recent = list
    .filter((t) => t.state === 'idle' && !routine(t) && t.lastRun?.finishedAt && now - Date.parse(t.lastRun.finishedAt) < 86_400_000)
    .sort((a, b) => Date.parse(b.lastRun!.finishedAt!) - Date.parse(a.lastRun!.finishedAt!))
    .slice(0, 4);

  // Tasks this page saw running: say when they end, and refresh the pages with what they changed.
  const seen = useRef(new Set<string>());
  useEffect(() => {
    for (const t of tasks.data ?? []) {
      if (t.state !== 'idle') {
        seen.current.add(t.name);
      } else if (seen.current.delete(t.name)) {
        const failed = t.lastRun?.status === 'failed';
        if (!routine(t)) notifications.show({ color: failed ? 'red' : 'green', title: `${t.title}: ${failed ? 'failed' : 'done'}`, message: (t.lastRun?.message ?? '').slice(0, 160) });
        void queryClient.invalidateQueries();
      }
    }
  }, [tasks.data, queryClient]);

  // The running time ticks while the list is open.
  useEffect(() => {
    if (!opened || busy.length === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [opened, busy.length]);

  const label = busy.length === 0 ? 'Background tasks: nothing running' : busy.map((t) => `${t.title}${t.state === 'queued' ? ' (waiting)' : t.progress ? `: ${t.progress}` : ''}`).join(', ');

  return (
    <Popover position="bottom-end" width={340} shadow="md" withinPortal opened={opened} onChange={setOpened}>
      <Popover.Target>
        <Tooltip label={label} disabled={opened} multiline maw={320}>
          <ActionIcon
            variant="subtle"
            color={busy.length > 0 ? 'forest' : 'gray'}
            size="lg"
            aria-label="Background tasks"
            onClick={() => {
              setNow(Date.now());
              setOpened((o) => !o);
            }}
          >
            {busy.length > 0 ? <Loader size={18} color="forest" /> : <IconActivity size={18} />}
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown>
        <Text fw={600} size="sm" mb={6}>
          Background tasks
        </Text>
        {busy.length === 0 ? (
          <Text size="sm" c="dimmed">
            Nothing running right now.
          </Text>
        ) : (
          <Stack gap={8}>
            {busy.map((t) => (
              <div key={t.name}>
                <Group justify="space-between" gap="xs" wrap="nowrap">
                  <Group gap={6} wrap="nowrap">
                    {t.state === 'running' && <Loader size={12} />}
                    <Text size="sm" fw={500}>
                      {t.title}
                    </Text>
                  </Group>
                  <Text size="xs" c="dimmed">
                    {t.state === 'running' ? elapsed(t.runningSince, now) : 'waiting'}
                  </Text>
                </Group>
                {t.progress && (
                  <Text size="xs" c="dimmed">
                    {t.progress}
                  </Text>
                )}
              </div>
            ))}
          </Stack>
        )}
        {recent.length > 0 && (
          <>
            <Divider my={8} label="Lately" labelPosition="left" />
            <Stack gap={4}>
              {recent.map((t) => (
                <Group key={t.name} justify="space-between" gap="xs" wrap="nowrap">
                  <Tooltip label={t.lastRun!.message ?? ''} disabled={!t.lastRun!.message} multiline maw={320}>
                    <Text size="xs" truncate>
                      {t.title}
                    </Text>
                  </Tooltip>
                  <Group gap={6} wrap="nowrap">
                    <Text size="xs" c="dimmed">
                      {timeAgo(t.lastRun!.finishedAt)}
                    </Text>
                    <StatusBadge status={t.lastRun!.status} />
                  </Group>
                </Group>
              ))}
            </Stack>
          </>
        )}
        <Anchor component={Link} to="/system/tasks" size="xs" mt={10} display="block" onClick={() => setOpened(false)}>
          All tasks and their history
        </Anchor>
      </Popover.Dropdown>
    </Popover>
  );
}
