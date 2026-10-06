import { Alert, Anchor, Badge, Button, Card, Group, SimpleGrid, Stack, Table, Text, Title, Tooltip } from '@mantine/core';
import { IconAlertTriangle, IconCircleCheck, IconLifebuoy } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api';
import { PageHeader, StatCard } from '../../components';
import { bytes, dateTime } from '../../format';
import { useSetting } from '../../hooks';
import { changesOf, ChangesModal, type Section } from '../../WhatsNew';
import { SetupChecklist } from './SetupChecklist';

interface Status {
  version: string;
  startedAt: string;
  uptimeSeconds: number;
  node: string;
  os: string;
  inDocker: boolean;
  databaseBytes: number;
  /** writable: usable for what Squirrelcade does there (written to, or only read when needsWrite is false). */
  folders: { name: string; path: string; exists: boolean; writable: boolean; needsWrite?: boolean; freeBytes: number | null }[];
  health: { level: 'warning' | 'error'; message: string }[];
}

function uptime(seconds: number) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** System status: version, folders, problems the health check found, and the setup checklist. */
export function StatusPage() {
  const dateFormat = useSetting('general.dateFormat', 'us');
  const { data } = useQuery({ queryKey: ['system', 'status'], queryFn: () => api<Status>('/system/status'), refetchInterval: 30_000 });
  const [changes, setChanges] = useState<Section[] | null>(null);
  if (!data) return <PageHeader help="troubleshooting" title="Status" />;
  return (
    <>
      <PageHeader help="troubleshooting"
        title="Status"
        actions={
          <Tooltip label="For reporting a problem: the version, health, settings (never passwords or keys), recent tasks and log lines. It's only downloaded; you decide whom to give it to." multiline w={300}>
            <Button size="xs" variant="default" leftSection={<IconLifebuoy size={14} />} component="a" href="/api/v1/system/support">
              Support file
            </Button>
          </Tooltip>
        }
      />
      <Stack>
        <Card withBorder>
          <Title order={5} mb="sm">
            Health
          </Title>
          {data.health.length === 0 ? (
            <Group gap="xs">
              <IconCircleCheck color="var(--mantine-color-green-6)" />
              <Text>Everything looks fine.</Text>
            </Group>
          ) : (
            <Stack gap="xs">
              {data.health.map((h) => (
                <Alert key={h.message} color={h.level === 'error' ? 'red' : 'yellow'} icon={<IconAlertTriangle />} py="xs">
                  {h.message}
                </Alert>
              ))}
            </Stack>
          )}
        </Card>
        {changes && <ChangesModal sections={changes} onClose={() => setChanges(null)} />}
        <SetupChecklist />
        <SimpleGrid cols={{ base: 2, md: 4 }}>
          <StatCard
            label="Version"
            value={data.version}
            hint={
              <Anchor size="xs" onClick={() => setChanges(changesOf(data.version))}>
                What's new
              </Anchor>
            }
          />
          <StatCard label="Running for" value={uptime(data.uptimeSeconds)} hint={`since ${dateTime(data.startedAt, dateFormat)}`} />
          <StatCard label="Database" value={bytes(data.databaseBytes)} />
          <StatCard label="Runtime" value={data.node} hint={`${data.os}${data.inDocker ? ', Docker' : ''}`} />
        </SimpleGrid>
        <Card withBorder>
          <Title order={5} mb="sm">
            Folders
          </Title>
          <Table.ScrollContainer minWidth={600}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Folder</Table.Th>
                  <Table.Th>Path</Table.Th>
                  <Table.Th>State</Table.Th>
                  <Table.Th ta="right">Free space</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.folders.map((f) => (
                  <Table.Tr key={f.name}>
                    <Table.Td>{f.name}</Table.Td>
                    <Table.Td>
                      <Text ff="monospace" size="sm">
                        {f.path}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {!f.exists ? (
                        <Badge color="gray" variant="light">
                          Missing
                        </Badge>
                      ) : f.writable ? (
                        <Badge color="green" variant="light">
                          OK
                        </Badge>
                      ) : (
                        <Badge color="yellow" variant="light">
                          {f.needsWrite === false ? 'Not readable' : 'Read-only'}
                        </Badge>
                      )}
                    </Table.Td>
                    <Table.Td ta="right">{bytes(f.freeBytes)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Card>
      </Stack>
    </>
  );
}
