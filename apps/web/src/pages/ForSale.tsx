import { Anchor, Badge, Button, Group, Loader, Stack, Table, Text } from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { PageHeader, type SortDirection } from '../components';
import { sortRows, useSort } from '../sort';
import { CopyDetailsModal, type CopyRef } from '../CopyDetails';
import { money } from '../format';
import { GameCover, GameTitle } from '../GameDrawer';
import { useCanEdit, useSetting } from '../hooks';
import { SellHelper } from '../SellHelper';
import { ShareButton } from '../ShareLinks';

/** A copy marked for sale or trade (GET /api/v1/sale). */
interface SaleItem {
  id: number;
  copyKey: string;
  productId: string;
  title: string;
  platformKey: string | null;
  platform: string | null;
  condition: string;
  quantity: number;
  valueCents: number | null;
  sale: 'sale' | 'trade';
  askingCents: number | null;
  saleNote: string | null;
  coverId: string | null;
}

interface Duplicate {
  productId: string;
  title: string;
  platform: string | null;
  copies: number;
  items: { copyKey: string; condition: string; quantity: number; valueCents: number | null; sale: 'sale' | 'trade' | null; platformKey: string | null }[];
}

/** The for-sale table's sorts and which way each goes first (D144): words A to Z, money most first; listed is the order the list comes in (by console, then title). */
const SORTS = { listed: 'asc', title: 'asc', condition: 'asc', asking: 'desc', value: 'desc' } as const satisfies Record<string, SortDirection>;

/**
 * Collection > For sale: the copies you marked for sale or trade, with asking prices, a download and a link to
 * share; and the games you own more than once, to choose from.
 */
export function ForSalePage() {
  const canEdit = useCanEdit();
  const currency = useSetting('general.currency', 'USD');
  const sale = useQuery({ queryKey: ['sale'], queryFn: () => api<{ currency: string; items: SaleItem[]; duplicates: Duplicate[] }>('/sale') });
  const [editing, setEditing] = useState<CopyRef | null>(null);
  const [selling, setSelling] = useState<{ id: number; title: string } | null>(null);
  // Until a heading is clicked, the copies keep the list's order (by console, then title), which no heading has.
  const sorting = useSort(SORTS, 'listed');
  const edit = (x: { copyKey: string; title: string; platform: string | null; condition: string }) => setEditing({ copyKey: x.copyKey, title: x.title, platform: x.platform ?? '', condition: x.condition });
  const items = sale.data?.items ?? [];
  const listed = new Map(items.map((s, i) => [s, i]));
  const rows = sortRows(items, (s) => ({ listed: listed.get(s), title: s.title, condition: s.condition, asking: s.askingCents, value: s.valueCents })[sorting.by], sorting.dir);
  const duplicates = (sale.data?.duplicates ?? []).filter((d) => d.items.some((i) => !i.sale));
  return (
    <>
      <PageHeader
        help="your-copies"
        title="For sale"
        description="Copies you marked for sale or trade (in a game's drawer, or below from the games you own more than once). Ready to sell writes a copy's listing for eBay or Mercari; Sales keeps what sold."
        actions={
          <Group gap="xs">
            {items.length > 0 && (
              <Button variant="default" component="a" href="/api/v1/sale/export" leftSection={<IconDownload size={16} />}>
                Download
              </Button>
            )}
            {canEdit && <ShareButton kind="sale" />}
          </Group>
        }
      />
      {sale.isPending ? (
        <Loader />
      ) : (
        <Stack gap="lg">
          {items.length === 0 ? (
            <Text c="dimmed">Nothing is marked for sale or trade.</Text>
          ) : (
            <Table.ScrollContainer minWidth={620}>
              <Table verticalSpacing={6} striped>
                <Table.Thead>
                  <Table.Tr>
                    {sorting.th('title', 'Game')}
                    {sorting.th('condition', 'Condition')}
                    {sorting.th('asking', 'Asking', { ta: 'right' })}
                    {sorting.th('value', 'Value', { ta: 'right' })}
                    {canEdit && <Table.Th />}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map((s) => (
                    <Table.Tr key={s.copyKey}>
                      <Table.Td>
                        <Group gap="sm" wrap="nowrap">
                          {s.platformKey && <GameCover platformKey={s.platformKey} title={s.title} id={s.coverId} placeholder={items.some((x) => x.coverId)} />}
                          <div>
                            {s.platformKey ? <GameTitle platformKey={s.platformKey} title={s.title} fw={500} /> : <Text size="sm">{s.title}</Text>}
                            <Group gap={6}>
                              <Text size="xs" c="dimmed">
                                {s.platform}
                                {s.quantity > 1 ? ` · ${s.quantity} copies` : ''}
                              </Text>
                              <Badge size="xs" variant="light" color="orange" style={{ textTransform: 'none' }}>
                                {s.sale === 'sale' ? 'For sale' : 'For trade'}
                              </Badge>
                            </Group>
                            {s.saleNote && (
                              <Text size="xs" c="dimmed">
                                {s.saleNote}
                              </Text>
                            )}
                          </div>
                        </Group>
                      </Table.Td>
                      <Table.Td>{s.condition}</Table.Td>
                      <Table.Td ta="right">{s.askingCents !== null ? money(s.askingCents, currency) : '—'}</Table.Td>
                      <Table.Td ta="right">{money(s.valueCents, currency)}</Table.Td>
                      {canEdit && (
                        <Table.Td ta="right">
                          <Group gap="sm" justify="flex-end" wrap="nowrap">
                            {s.sale === 'sale' && (
                              <Anchor size="xs" onClick={() => setSelling({ id: s.id, title: s.title })}>
                                Ready to sell
                              </Anchor>
                            )}
                            <Anchor size="xs" onClick={() => edit(s)}>
                              Change
                            </Anchor>
                          </Group>
                        </Table.Td>
                      )}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
          {duplicates.length > 0 && (
            <Stack gap={4}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                Owned more than once
              </Text>
              <Table.ScrollContainer minWidth={520}>
                <Table verticalSpacing={4}>
                  <Table.Tbody>
                    {duplicates.map((d) => (
                      <Table.Tr key={d.productId}>
                        <Table.Td>
                          {d.items[0]?.platformKey ? <GameTitle platformKey={d.items[0].platformKey} title={d.title} /> : <Text size="sm">{d.title}</Text>}
                          <Text size="xs" c="dimmed">
                            {d.platform} · {d.copies} copies
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Group gap="xs">
                            {d.items.map((i) => (
                              <Group key={i.copyKey} gap={4} wrap="nowrap">
                                <Text size="sm">
                                  {i.condition}
                                  {i.quantity > 1 ? ` ×${i.quantity}` : ''} ({money(i.valueCents, currency)})
                                </Text>
                                {i.sale ? (
                                  <Badge size="xs" variant="light" color="orange" style={{ textTransform: 'none' }}>
                                    {i.sale === 'sale' ? 'For sale' : 'For trade'}
                                  </Badge>
                                ) : (
                                  canEdit && (
                                    <Anchor size="xs" onClick={() => edit({ copyKey: i.copyKey, title: d.title, platform: d.platform, condition: i.condition })}>
                                      sell or trade
                                    </Anchor>
                                  )
                                )}
                              </Group>
                            ))}
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Stack>
          )}
        </Stack>
      )}
      <CopyDetailsModal copy={editing} onClose={() => setEditing(null)} />
      <SellHelper copy={selling} onClose={() => setSelling(null)} />
    </>
  );
}
