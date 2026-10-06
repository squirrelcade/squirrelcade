import { Badge, Group, Select, Switch, Table, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api';
import { PageHeader } from '../../components';
import { dateTime } from '../../format';
import { useSetting } from '../../hooks';

interface LogEntry {
  time: string;
  level: string;
  message: string;
  context?: string;
}

const LEVEL_COLORS: Record<string, string> = { debug: 'gray', info: 'blue', warn: 'yellow', error: 'red', fatal: 'red' };

/** The recent log lines, filtered by level. */
export function LogsPage() {
  const dateFormat = useSetting('general.dateFormat', 'us');
  const [level, setLevel] = useState('info');
  const [live, setLive] = useState(true);
  const { data } = useQuery({
    queryKey: ['logs', level],
    queryFn: () => api<LogEntry[]>(`/system/logs?level=${level}&limit=500`),
    refetchInterval: live ? 5_000 : false,
  });
  return (
    <>
      <PageHeader help="troubleshooting"
        title="Logs"
        description="The most recent messages. The full log file is in the config folder under logs."
        actions={
          <>
            <Select
              aria-label="Which log lines"
              data={[
                { value: 'debug', label: 'Everything' },
                { value: 'info', label: 'Info and up' },
                { value: 'warn', label: 'Warnings and errors' },
                { value: 'error', label: 'Errors only' },
              ]}
              value={level}
              onChange={(v) => setLevel(v ?? 'info')}
              allowDeselect={false}
              w={200}
            />
            <Switch label="Live" checked={live} onChange={(e) => setLive(e.currentTarget.checked)} />
          </>
        }
      />
      <Table.ScrollContainer minWidth={700}>
        <Table striped verticalSpacing={4}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={180}>Time</Table.Th>
              <Table.Th w={80}>Level</Table.Th>
              <Table.Th w={140}>Area</Table.Th>
              <Table.Th>Message</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {data?.map((e, i) => (
              <Table.Tr key={`${e.time}-${i}`}>
                <Table.Td>
                  <Text size="xs">{dateTime(e.time, dateFormat)}</Text>
                </Table.Td>
                <Table.Td>
                  <Badge size="xs" color={LEVEL_COLORS[e.level] ?? 'gray'} variant="light">
                    {e.level}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed">
                    {e.context ?? ''}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" style={{ wordBreak: 'break-word' }}>
                    {e.message}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {data?.length === 0 && (
        <Group justify="center" mt="md">
          <Text c="dimmed">No messages at this level.</Text>
        </Group>
      )}
    </>
  );
}
