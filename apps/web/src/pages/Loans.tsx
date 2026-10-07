import { Anchor, Badge, Button, Group, Loader, Stack, Table, Text } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { PageHeader, type SortDirection } from '../components';
import type { Loan } from '../CopyDetails';
import { date } from '../format';
import { GameTitle } from '../GameDrawer';
import { notifyError, notifySuccess, useCanEdit, useSetting } from '../hooks';
import { sortRows, useSort } from '../sort';

/** The loans' headings sort them (D144): games and people A to Z, lent days newest first, due days soonest first (the server's order, overdue on top). */
const SORTS = { title: 'asc', who: 'asc', since: 'desc', due: 'asc' } as const satisfies Record<string, SortDirection>;

/**
 * Collection > Loans: the games you lent and haven't got back (overdue ones first), and the ones given back. You
 * lend a game from its copy in the game's drawer; a reminder goes out when one is overdue (Settings > Notifications).
 */
export function LoansPage() {
  const canEdit = useCanEdit();
  const dateFormat = useSetting('general.dateFormat', 'us');
  const queryClient = useQueryClient();
  const loans = useQuery({ queryKey: ['loans'], queryFn: () => api<{ open: Loan[]; returned: Loan[] }>('/loans') });
  const change = useMutation({
    mutationFn: (c: { path: string; method: 'POST' | 'DELETE'; json?: unknown; done: string }) => api(c.path, { method: c.method, json: c.json }),
    onSuccess: async (_r, c) => {
      notifySuccess(c.done);
      await Promise.all(['loans', 'game', 'collection', 'copy'].map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
    },
    onError: (err) => notifyError(err),
  });
  const title = (l: Loan) => (l.platformKey ? <GameTitle platformKey={l.platformKey} title={l.title} fw={500} /> : <Text size="sm">{l.title}</Text>);
  const sorting = useSort(SORTS, 'due');
  const open = sortRows(loans.data?.open ?? [], (l) => (sorting.by === 'title' ? l.title : sorting.by === 'who' ? l.lentTo : sorting.by === 'since' ? l.lentAt : l.dueAt), sorting.dir);
  return (
    <>
      <PageHeader help="your-copies" title="Loans" description="Games you lent: lend one from its copy in the game's drawer." />
      {loans.isPending ? (
        <Loader />
      ) : (
        <Stack gap="lg">
          {loans.data && loans.data.open.length === 0 && <Text c="dimmed">Every game you lent is back.</Text>}
          {loans.data && loans.data.open.length > 0 && (
            <Table.ScrollContainer minWidth={560}>
              <Table verticalSpacing={6} striped>
                <Table.Thead>
                  <Table.Tr>
                    {sorting.th('title', 'Game')}
                    {sorting.th('who', 'Lent to')}
                    {sorting.th('since', 'Since')}
                    {sorting.th('due', 'Due back')}
                    {canEdit && <Table.Th />}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {open.map((l) => (
                    <Table.Tr key={l.id}>
                      <Table.Td>
                        {title(l)}
                        <Text size="xs" c="dimmed">
                          {[l.platform, l.note].filter(Boolean).join(' · ')}
                        </Text>
                      </Table.Td>
                      <Table.Td>{l.lentTo}</Table.Td>
                      <Table.Td>{date(l.lentAt, dateFormat)}</Table.Td>
                      <Table.Td>
                        {l.dueAt ? (
                          <Group gap={6}>
                            <Text size="sm">{date(l.dueAt, dateFormat)}</Text>
                            {l.overdue && (
                              <Badge size="xs" color="red" variant="light">
                                Overdue
                              </Badge>
                            )}
                          </Group>
                        ) : (
                          <Text size="sm" c="dimmed">
                            No day set
                          </Text>
                        )}
                      </Table.Td>
                      {canEdit && (
                        <Table.Td ta="right">
                          <Button size="compact-sm" variant="light" loading={change.isPending} onClick={() => change.mutate({ path: `/loans/${l.id}/return`, method: 'POST', json: {}, done: `${l.title} is back.` })}>
                            It's back
                          </Button>
                        </Table.Td>
                      )}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
          {loans.data && loans.data.returned.length > 0 && (
            <Stack gap={4}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                Given back
              </Text>
              <Table.ScrollContainer minWidth={560}>
                <Table verticalSpacing={4}>
                  <Table.Tbody>
                    {loans.data.returned.map((l) => (
                      <Table.Tr key={l.id}>
                        <Table.Td>{title(l)}</Table.Td>
                        <Table.Td>{l.lentTo}</Table.Td>
                        <Table.Td>
                          {date(l.lentAt, dateFormat)} to {date(l.returnedAt, dateFormat)}
                        </Table.Td>
                        {canEdit && (
                          <Table.Td ta="right">
                            <Anchor size="xs" c="dimmed" onClick={() => change.mutate({ path: `/loans/${l.id}`, method: 'DELETE', done: 'Removed from the history.' })}>
                              Remove
                            </Anchor>
                          </Table.Td>
                        )}
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Stack>
          )}
        </Stack>
      )}
    </>
  );
}
