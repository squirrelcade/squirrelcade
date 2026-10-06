import { Anchor, Button, Loader, SimpleGrid, Stack, Table, Tabs, Text, Title } from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { PageHeader, StatCard } from '../components';
import { count, date, money } from '../format';
import { GameTitle } from '../GameDrawer';
import { notifyError, useSetting } from '../hooks';
import { SellHelper, SOLD_VIA_NAMES } from '../SellHelper';

interface Sale {
  id: number;
  title: string;
  platform: string | null;
  platformKey: string | null;
  completeness: string;
  marketplace: string;
  soldAt: string;
  soldCents: number;
  shippingChargedCents: number;
  feesCents: number;
  shippingCostCents: number;
  netCents: number;
  gainCents: number | null;
}

interface SalesTotal {
  sales: number;
  soldCents: number;
  feesCents: number;
  shippingCostCents: number;
  netCents: number;
  paidCents: number;
  gainCents: number;
  meals: number;
}

interface Suggested {
  id: number;
  title: string;
  platform: string;
  platformKey: string;
  condition: string;
  valueCents: number | null;
  why: string;
  riseCents?: number;
  risePercent?: number;
  since?: string;
}

/**
 * Collection > Sales (0.22.0, D86): what you've sold and what it brought, in money and in meals (the owner's plan: play a
 * game, then sell it for a lunch), the games worth selling next, and each sale, with a download.
 */
export function SalesPage() {
  const queryClient = useQueryClient();
  const currency = useSetting('general.currency', 'USD');
  const dateFormat = useSetting('general.dateFormat', 'us');
  const sales = useQuery({ queryKey: ['sales'], queryFn: () => api<{ sales: Sale[]; month: SalesTotal; year: SalesTotal; all: SalesTotal; mealCents: number }>('/sales') });
  const next = useQuery({ queryKey: ['sales', 'suggestions'], queryFn: () => api<{ finished: Suggested[]; twice: Suggested[]; rising: Suggested[] }>('/sales/suggestions') });
  const [selling, setSelling] = useState<{ id: number; title: string } | null>(null);
  const undo = useMutation({
    mutationFn: (id: number) => api(`/sales/${id}`, { method: 'DELETE' }),
    onSuccess: () => Promise.all(['sales', 'collection', 'game', 'send'].map((k) => queryClient.invalidateQueries({ queryKey: [k] }))),
    onError: (err) => notifyError(err),
  });
  const s = sales.data;
  const meals = (t: SalesTotal) => (t.meals === 1 ? '1 meal' : `${count(t.meals)} meals`);
  const suggestions = (list: Suggested[], empty: string) =>
    list.length === 0 ? (
      <Text c="dimmed" size="sm" mt="xs">
        {empty}
      </Text>
    ) : (
      <Table.ScrollContainer minWidth={320}>
        <Table verticalSpacing={4} striped>
          <Table.Tbody>
            {list.map((c) => (
              <Table.Tr key={c.id}>
                <Table.Td>
                  <GameTitle platformKey={c.platformKey} title={c.title} fw={500} />
                  <Text size="xs" c="dimmed">
                    {c.platform} · {c.condition} · {c.riseCents !== undefined ? `up ${money(c.riseCents, currency)} (+${c.risePercent}%) since ${date(c.since ?? '', dateFormat)}` : c.why}
                  </Text>
                </Table.Td>
                <Table.Td ta="right">{c.valueCents !== null ? money(c.valueCents, currency) : '—'}</Table.Td>
                <Table.Td w={1}>
                  <Button size="compact-sm" variant="light" color="green" onClick={() => setSelling({ id: c.id, title: c.title })}>
                    Ready to sell
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    );

  return (
    <>
      <PageHeader
        help="selling"
        title="Sales"
        description="What you've sold and what it brought, in money and in meals, and the games worth selling next. Ready to sell writes a game's listing for eBay or Mercari."
        actions={
          (s?.sales.length ?? 0) > 0 ? (
            <Button variant="default" component="a" href="/api/v1/sales/export" leftSection={<IconDownload size={16} />}>
              Download
            </Button>
          ) : undefined
        }
      />
      {!s ? (
        <Loader />
      ) : (
        <Stack gap="lg">
          {/* Side by side on a phone too: three short totals, not a screenful of cards. */}
          <SimpleGrid cols={3} spacing={{ base: 'xs', sm: 'md' }}>
            <StatCard label="This month" value={money(s.month.netCents, currency)} hint={`${count(s.month.sales)} sold · ${meals(s.month)}`} />
            <StatCard label="This year" value={money(s.year.netCents, currency)} hint={`${count(s.year.sales)} sold · ${meals(s.year)}`} />
            <StatCard
              label="Every sale"
              value={money(s.all.netCents, currency)}
              hint={`${count(s.all.sales)} sold · ${meals(s.all)}${s.all.paidCents > 0 ? ` · ${s.all.gainCents >= 0 ? 'made' : 'lost'} ${money(Math.abs(s.all.gainCents), currency)} over what they cost` : ''}`}
            />
          </SimpleGrid>
          <Text size="xs" c="dimmed" mt={-8}>
            After fees and shipping. A meal is {money(s.mealCents, currency)} (Settings › Collection › Selling).
          </Text>

          <Stack gap={4}>
            <Title order={4}>Ready to sell?</Title>
            <Tabs defaultValue="finished">
              <Tabs.List>
                <Tabs.Tab value="finished">Games you've finished ({count(next.data?.finished.length ?? 0)})</Tabs.Tab>
                <Tabs.Tab value="twice">Owned more than once ({count(next.data?.twice.length ?? 0)})</Tabs.Tab>
                <Tabs.Tab value="rising">Worth more lately ({count(next.data?.rising.length ?? 0)})</Tabs.Tab>
              </Tabs.List>
              <Tabs.Panel value="finished" pt="xs">
                {suggestions(next.data?.finished ?? [], 'Games you mark beaten, completed or dropped (What you played) show here, the most valuable first; tag one "Keeper" to keep it off.')}
              </Tabs.Panel>
              <Tabs.Panel value="twice" pt="xs">
                {suggestions(next.data?.twice ?? [], 'No game you own twice or more, apart from keepers and copies already for sale.')}
              </Tabs.Panel>
              <Tabs.Panel value="rising" pt="xs">
                {suggestions(next.data?.rising ?? [], "No copy's value has risen since the first prices Squirrelcade kept (each collection update adds a price), apart from keepers and copies already for sale.")}
              </Tabs.Panel>
            </Tabs>
          </Stack>

          <Stack gap={4}>
            <Title order={4}>Sold</Title>
            {s.sales.length === 0 ? (
              <Text c="dimmed" size="sm">
                Nothing sold yet. When a game sells, Ready to sell's "It sold" records it here.
              </Text>
            ) : (
              <Table.ScrollContainer minWidth={640}>
                <Table verticalSpacing={4} striped>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Sold</Table.Th>
                      <Table.Th>Game</Table.Th>
                      <Table.Th>Where</Table.Th>
                      <Table.Th ta="right">For</Table.Th>
                      <Table.Th ta="right">Fees and shipping</Table.Th>
                      <Table.Th ta="right">Net</Table.Th>
                      <Table.Th ta="right">Over its cost</Table.Th>
                      <Table.Th />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {s.sales.map((x) => (
                      <Table.Tr key={x.id}>
                        <Table.Td>{date(x.soldAt, dateFormat)}</Table.Td>
                        <Table.Td>
                          {x.platformKey ? <GameTitle platformKey={x.platformKey} title={x.title} /> : x.title}
                          <Text size="xs" c="dimmed">
                            {x.platform}
                          </Text>
                        </Table.Td>
                        <Table.Td>{SOLD_VIA_NAMES[x.marketplace] ?? x.marketplace}</Table.Td>
                        <Table.Td ta="right">{money(x.soldCents + x.shippingChargedCents, currency)}</Table.Td>
                        <Table.Td ta="right">{money(x.feesCents + x.shippingCostCents, currency)}</Table.Td>
                        <Table.Td ta="right" fw={600}>
                          {money(x.netCents, currency)}
                        </Table.Td>
                        <Table.Td ta="right">{x.gainCents !== null ? money(x.gainCents, currency) : '—'}</Table.Td>
                        <Table.Td w={1} style={{ whiteSpace: 'nowrap' }}>
                          <Anchor
                            component="button"
                            type="button"
                            size="xs"
                            onClick={() => window.confirm(`Take back the sale of ${x.title}? It comes back into your collection.`) && undo.mutate(x.id)}
                          >
                            take back
                          </Anchor>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
          </Stack>
        </Stack>
      )}
      <SellHelper copy={selling} onClose={() => setSelling(null)} />
    </>
  );
}
