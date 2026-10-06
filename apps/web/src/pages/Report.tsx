import { Button, Group, Loader, Stack, Table, Text, Title } from '@mantine/core';
import { IconPrinter } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { count, date, money, wholeMoney } from '../format';
import { useSetting } from '../hooks';

/** GET /api/v1/collection/report. */
interface CollectionReport {
  instanceName: string;
  generatedAt: string;
  pricesAsOf: string | null;
  currency: string;
  totals: { games: number; copies: number; valueCents: number; costCents: number | null };
  consoles: {
    platform: string;
    games: number;
    copies: number;
    valueCents: number;
    costCents: number | null;
    items: { title: string; condition: string; region: string; quantity: number; valueCents: number | null; costCents: number | null; location: string | null; photos: number }[];
  }[];
}

/** Printing leaves out Squirrelcade's header, menu and buttons, and keeps each table's header on every page. */
const PRINT_CSS = `
@media print {
  .mantine-AppShell-header, .mantine-AppShell-navbar, .no-print { display: none !important; }
  .mantine-AppShell-main { padding: 0 !important; margin: 0 !important; }
  .report-scroll { overflow: visible !important; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  .report-console { break-before: auto; }
}`;

/**
 * Collection > Report: every copy by platform with its condition, value (and what you paid and where it's kept,
 * when that's shown), and the totals, laid out to print or save as a PDF, for insurance or a record of the collection.
 */
export function ReportPage() {
  const dateFormat = useSetting('general.dateFormat', 'us');
  const report = useQuery({ queryKey: ['collection', 'report'], queryFn: () => api<CollectionReport>('/collection/report') });
  const r = report.data;
  if (!r) return report.isError ? <Text c="red">The report couldn't be made.</Text> : <Loader />;
  const paid = r.totals.costCents !== null;
  const where = r.consoles.some((c) => c.items.some((i) => i.location));
  return (
    <Stack gap="lg">
      <style>{PRINT_CSS}</style>
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={2}>{r.instanceName}: collection report</Title>
          <Text size="sm" c="dimmed">
            {date(r.generatedAt, dateFormat)} · {count(r.totals.games)} games, {count(r.totals.copies)} copies · worth {wholeMoney(r.totals.valueCents, r.currency)}
            {paid ? ` · paid ${wholeMoney(r.totals.costCents!, r.currency)}` : ''}
            {r.pricesAsOf ? ` · PriceCharting's prices of ${date(r.pricesAsOf, dateFormat)}` : ''}
          </Text>
        </div>
        <Button className="no-print" leftSection={<IconPrinter size={16} />} onClick={() => window.print()}>
          Print or save as PDF
        </Button>
      </Group>
      <Table.ScrollContainer minWidth={420} type="native" className="report-scroll">
        <Table verticalSpacing={2} withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Platform</Table.Th>
              <Table.Th ta="right">Games</Table.Th>
              <Table.Th ta="right">Copies</Table.Th>
              <Table.Th ta="right">Value</Table.Th>
              {paid && <Table.Th ta="right">Paid</Table.Th>}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {r.consoles.map((c) => (
              <Table.Tr key={c.platform}>
                <Table.Td>{c.platform}</Table.Td>
                <Table.Td ta="right">{count(c.games)}</Table.Td>
                <Table.Td ta="right">{count(c.copies)}</Table.Td>
                <Table.Td ta="right">{wholeMoney(c.valueCents, r.currency)}</Table.Td>
                {paid && <Table.Td ta="right">{wholeMoney(c.costCents ?? 0, r.currency)}</Table.Td>}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {r.consoles.map((c) => (
        <Stack key={c.platform} gap={4} className="report-console">
          <Title order={4}>
            {c.platform}{' '}
            <Text span size="sm" c="dimmed">
              {count(c.copies)} copies · {wholeMoney(c.valueCents, r.currency)}
            </Text>
          </Title>
          <Table.ScrollContainer minWidth={560} type="native" className="report-scroll">
            <Table verticalSpacing={1} fz="xs" striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Title</Table.Th>
                  <Table.Th>Condition</Table.Th>
                  <Table.Th>Region</Table.Th>
                  <Table.Th ta="right">Qty</Table.Th>
                  <Table.Th ta="right">Value each</Table.Th>
                  {paid && <Table.Th ta="right">Paid each</Table.Th>}
                  {where && <Table.Th>Where it is</Table.Th>}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {c.items.map((i, n) => (
                  <Table.Tr key={`${i.title}|${n}`}>
                    <Table.Td>
                      {i.title}
                      {i.photos > 0 ? ` (${i.photos} photo${i.photos === 1 ? '' : 's'})` : ''}
                    </Table.Td>
                    <Table.Td>{i.condition}</Table.Td>
                    <Table.Td>{i.region}</Table.Td>
                    <Table.Td ta="right">{i.quantity}</Table.Td>
                    <Table.Td ta="right">{money(i.valueCents, r.currency)}</Table.Td>
                    {paid && <Table.Td ta="right">{i.costCents ? money(i.costCents, r.currency) : ''}</Table.Td>}
                    {where && <Table.Td>{i.location ?? ''}</Table.Td>}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Stack>
      ))}
    </Stack>
  );
}
