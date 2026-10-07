import { Badge, Group, Select, Switch, Table, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api';
import { PageHeader, type SortDirection } from '../../components';
import { dateTime } from '../../format';
import { useSetting } from '../../hooks';
import { sortRows, useSort } from '../../sort';

interface LogEntry {
  time: string;
  level: string;
  message: string;
  context?: string;
}

const LEVEL_COLORS: Record<string, string> = { debug: 'gray', info: 'blue', warn: 'yellow', error: 'red', fatal: 'red' };

/** The log's headings sort it (D144): times newest first, levels the most serious first, words A to Z. */
const SORTS = { time: 'desc', level: 'desc', area: 'asc', message: 'asc' } as const satisfies Record<string, SortDirection>;
const SEVERITY: Record<string, number> = { debug: 1, info: 2, warn: 3, error: 4, fatal: 5 };

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
  const sorting = useSort(SORTS, 'time');
  const rows = sortRows(data ?? [], (e) => (sorting.by === 'level' ? (SEVERITY[e.level] ?? 0) : sorting.by === 'area' ? e.context : sorting.by === 'message' ? e.message : e.time), sorting.dir);
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
              {sorting.th('time', 'Time', { w: 180 })}
              {sorting.th('level', 'Level', { w: 80 })}
              {sorting.th('area', 'Area', { w: 140 })}
              {sorting.th('message', 'Message')}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((e, i) => (
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
