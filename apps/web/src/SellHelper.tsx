import { MARKETPLACES, type Marketplace } from '@squirrelcade/core';
import { Anchor, Badge, Button, Divider, Group, Image, Loader, Modal, NumberInput, Select, SimpleGrid, Stack, Table, Tabs, Text, Textarea, TextInput } from '@mantine/core';
import { IconCheck, IconCopy, IconDownload, IconExternalLink } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from './api';
import { CopyButton } from './Copy';
import { photoUrl } from './CopyDetails';
import { count, money } from './format';
import { notifyError, notifySuccess, useSetting } from './hooks';

/** GET /api/v1/collection/copies/<id>/listing: a copy's listing kit for a marketplace. */
interface ListingKit {
  copy: { id: number; key: string; title: string; platform: string; platformKey: string; condition: string; costCents: number | null; estimatedCents: number | null };
  listing: { title: string; description: string; specifics: { name: string; value: string }[]; condition: { name: string; id?: number } };
  price: { valueCents: number | null; askingCents: number | null; atCents: number | null; feesCents: number | null; netCents: number | null; shippingCostCents: number };
  photos: { taken: { id: number; slot: string | null; caption: string | null }[]; missing: string[] };
  links: { sold: string; sell: string; priceCharting: string };
}

/** Everything a sale changes, refreshed after one. */
const TOUCHED = ['copy', 'game', 'collection', 'sale', 'sales', 'send', 'improve', 'catalogs', 'wishlist', 'lookup'];

/** A value with a Copy button beside it. */
function Copyable({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <Stack gap={2}>
      <Group justify="space-between" align="flex-end">
        <Text size="sm" fw={500}>
          {label}
        </Text>
        <CopyButton value={value}>
          {({ copied, copy }) => (
            <Button size="compact-xs" variant={copied ? 'light' : 'default'} color={copied ? 'green' : undefined} leftSection={copied ? <IconCheck size={12} /> : <IconCopy size={12} />} onClick={copy} aria-label={`Copy the ${label.toLowerCase()}`}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          )}
        </CopyButton>
      </Group>
      {multiline ? <Textarea value={value} readOnly autosize minRows={3} maxRows={12} aria-label={label} /> : <TextInput value={value} readOnly aria-label={label} />}
    </Stack>
  );
}

/**
 * Ready to sell (0.22.0, D86): a copy's listing for eBay or Mercari (title, description, item details, condition) to
 * copy into the marketplace's form, its price (PriceCharting's value, your asking price, what's left after fees and
 * shipping) with its sold listings to compare, its photos (and the ones still to take), and, once it sells, the sale.
 * With justSold (the copy window's Sold), only the sale, and a way to take the copy out without one (onTakeOut).
 */
export function SellHelper({
  copy,
  onClose,
  onSold,
  justSold = false,
  onTakeOut,
}: {
  copy: { id: number; title: string } | null;
  onClose: () => void;
  /** After a sale is recorded (the copy has left the collection). */
  onSold?: () => void;
  justSold?: boolean;
  onTakeOut?: () => void;
}) {
  const queryClient = useQueryClient();
  const currency = useSetting('general.currency', 'USD');
  const [marketplace, setMarketplace] = useState<Marketplace>('ebay');
  const kit = useQuery({
    queryKey: ['sale', 'listing', copy?.id, marketplace],
    queryFn: () => api<ListingKit>(`/collection/copies/${copy!.id}/listing?marketplace=${marketplace}`),
    enabled: Boolean(copy),
  });
  const k = kit.data;
  const [asking, setAsking] = useState<number | string>('');
  const [soldFor, setSoldFor] = useState<number | string>('');
  const [soldVia, setSoldVia] = useState<string>('ebay');
  const [soldAt, setSoldAt] = useState('');
  const [fees, setFees] = useState<number | string>('');
  const [shipping, setShipping] = useState<number | string>('');
  useEffect(() => {
    if (!copy) return;
    setSoldFor('');
    setSoldAt('');
    setFees('');
    setShipping('');
  }, [copy]);
  useEffect(() => setSoldVia(marketplace), [marketplace]);
  useEffect(() => {
    if (k) setAsking(k.price.askingCents !== null ? k.price.askingCents / 100 : '');
  }, [k?.copy.key, k?.price.askingCents]);
  const refresh = () => Promise.all(TOUCHED.map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
  const saveAsking = useMutation({
    mutationFn: () => api('/copy', { method: 'PUT', json: { key: k!.copy.key, sale: 'sale', askingCents: asking === '' ? null : Math.round(Number(asking) * 100) } }),
    onSuccess: async () => {
      notifySuccess(`${k!.copy.title} is for sale (Acorns › For sale).`);
      await refresh();
    },
    onError: (err) => notifyError(err),
  });
  const sell = useMutation({
    mutationFn: () =>
      api<{ netCents: number }>(`/collection/copies/${k!.copy.id}/sell`, {
        method: 'POST',
        json: {
          soldCents: Math.round(Number(soldFor) * 100),
          marketplace: soldVia,
          ...(soldAt ? { soldAt } : {}),
          ...(fees !== '' ? { feesCents: Math.round(Number(fees) * 100) } : {}),
          ...(shipping !== '' ? { shippingCostCents: Math.round(Number(shipping) * 100) } : {}),
        },
      }),
    onSuccess: async (sale) => {
      notifySuccess(`Sold: ${money(sale.netCents, currency)} after fees and shipping. Acorns › Sales has it.`, k!.copy.title);
      await refresh();
      onClose();
      onSold?.();
    },
    onError: (err) => notifyError(err),
  });

  return (
    <Modal opened={Boolean(copy)} onClose={onClose} title={copy ? `${justSold ? 'It sold' : 'Ready to sell'} · ${copy.title}` : ''} size={justSold ? 'lg' : 'xl'} zIndex={360}>
      {!justSold && (
        <Tabs value={marketplace} onChange={(v) => v && setMarketplace(v as Marketplace)} mb="sm">
          <Tabs.List>
            {(Object.keys(MARKETPLACES) as Marketplace[]).map((m) => (
              <Tabs.Tab key={m} value={m}>
                {MARKETPLACES[m]}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs>
      )}
      {!k ? (
        kit.isError ? <Text c="red">This copy's listing couldn't be written.</Text> : <Loader />
      ) : (
        <Stack gap="md">
          {justSold ? (
            <Text size="sm" c="dimmed">
              {k.copy.platform} · {k.copy.condition}. What it sold for goes on Acorns › Sales, with the fees and shipping worked out unless you give them.
            </Text>
          ) : (
            <>
              <Text size="sm" c="dimmed">
                {k.copy.platform} · {k.copy.condition}. Read it over, copy each part into {MARKETPLACES[marketplace]}'s form, and add your photos. Nothing is sent from here.
              </Text>
              <Copyable label="Title" value={k.listing.title} />
              <Text size="xs" c="dimmed" mt={-8}>
                {k.listing.title.length} of 80 characters. Condition: {k.listing.condition.name}.
              </Text>
              <Copyable label="Description" value={k.listing.description} multiline />
              {marketplace === 'ebay' && (
                <Stack gap={4}>
                  <Group justify="space-between">
                    <Text size="sm" fw={500}>
                      Item specifics
                    </Text>
                    <CopyButton value={k.listing.specifics.map((s) => `${s.name}: ${s.value}`).join('\n')}>
                      {({ copied, copy: doCopy }) => (
                        <Button size="compact-xs" variant={copied ? 'light' : 'default'} color={copied ? 'green' : undefined} onClick={doCopy} aria-label="Copy the item specifics">
                          {copied ? 'Copied' : 'Copy'}
                        </Button>
                      )}
                    </CopyButton>
                  </Group>
                  <Table withRowBorders={false} verticalSpacing={2}>
                    <Table.Tbody>
                      {k.listing.specifics.map((s) => (
                        <Table.Tr key={s.name}>
                          <Table.Td w={140}>
                            <Text size="sm" c="dimmed">
                              {s.name}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size="sm">{s.value}</Text>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Stack>
              )}

              <Divider label="Price" labelPosition="left" />
              <Group gap="lg" align="flex-end" wrap="wrap">
                <Stack gap={0}>
                  <Text size="xs" c="dimmed">
                    PriceCharting's value
                  </Text>
                  <Text fw={600}>{k.price.valueCents !== null ? money(k.price.valueCents, currency) : 'Not known'}</Text>
                </Stack>
                <NumberInput label={`Your asking price (${currency})`} value={asking} onChange={setAsking} min={0} decimalScale={2} allowNegative={false} w={180} />
                <Button variant="light" loading={saveAsking.isPending} onClick={() => saveAsking.mutate()}>
                  Mark it for sale
                </Button>
              </Group>
              {k.price.netCents !== null && k.price.atCents !== null && (
                <Text size="sm">
                  At {money(k.price.atCents, currency)}, {MARKETPLACES[marketplace]} keeps about {money(k.price.feesCents ?? 0, currency)} and shipping costs you about{' '}
                  {money(k.price.shippingCostCents, currency)}: you'd get about <b>{money(k.price.netCents, currency)}</b>.
                </Text>
              )}
              <Group gap="md">
                <Anchor href={k.links.sold} target="_blank" rel="noreferrer" size="sm">
                  What it sold for on {MARKETPLACES[marketplace]} <IconExternalLink size={12} />
                </Anchor>
                <Anchor href={k.links.priceCharting} target="_blank" rel="noreferrer" size="sm">
                  PriceCharting <IconExternalLink size={12} />
                </Anchor>
              </Group>

              <Divider label="Photos" labelPosition="left" />
              {k.photos.taken.length > 0 && (
                <SimpleGrid cols={{ base: 4, xs: 6 }} spacing={6}>
                  {k.photos.taken.map((p) => (
                    <Image key={p.id} src={photoUrl(p.id)} radius="sm" h={70} fit="cover" alt={p.slot ?? p.caption ?? 'Photo'} />
                  ))}
                </SimpleGrid>
              )}
              {k.photos.missing.length > 0 ? (
                <Text size="sm">
                  Still to take:{' '}
                  {k.photos.missing.map((s) => (
                    <Badge key={s} variant="light" color="yellow" mr={4} style={{ textTransform: 'none' }}>
                      {s}
                    </Badge>
                  ))}
                  <Text span size="xs" c="dimmed">
                    (in the copy's window, Photos)
                  </Text>
                </Text>
              ) : (
                <Text size="sm" c="dimmed">
                  Every standard photo is taken.
                </Text>
              )}
              <Group>
                {k.photos.taken.length > 0 && (
                  <Button variant="default" component="a" href={`/api/v1/collection/copies/${k.copy.id}/photos.zip`} leftSection={<IconDownload size={16} />}>
                    Download the photos ({count(k.photos.taken.length)})
                  </Button>
                )}
                <Button component="a" href={k.links.sell} target="_blank" rel="noreferrer" rightSection={<IconExternalLink size={16} />}>
                  Start a listing on {MARKETPLACES[marketplace]}
                </Button>
              </Group>

              <Divider label="It sold" labelPosition="left" />
            </>
          )}
          <Group gap="xs" align="flex-end" wrap="wrap">
            <NumberInput label={`Sold for (${currency})`} value={soldFor} onChange={setSoldFor} min={0} decimalScale={2} allowNegative={false} w={140} />
            <Select
              label="Where"
              data={[
                { value: 'ebay', label: 'eBay' },
                { value: 'mercari', label: 'Mercari' },
                { value: 'local', label: 'In person' },
                { value: 'other', label: 'Elsewhere' },
              ]}
              value={soldVia}
              onChange={(v) => v && setSoldVia(v)}
              allowDeselect={false}
              w={140}
              comboboxProps={{ zIndex: 400 }}
            />
            <TextInput label="On" type="date" value={soldAt} onChange={(e) => setSoldAt(e.currentTarget.value)} w={160} />
            <NumberInput label="Fees" placeholder="Worked out" value={fees} onChange={setFees} min={0} decimalScale={2} allowNegative={false} w={120} />
            <NumberInput label="Shipping cost" placeholder={soldVia === 'local' ? '0.00' : (k.price.shippingCostCents / 100).toFixed(2)} value={shipping} onChange={setShipping} min={0} decimalScale={2} allowNegative={false} w={130} />
            <Button color="green" disabled={soldFor === ''} loading={sell.isPending} onClick={() => sell.mutate()}>
              Record the sale
            </Button>
          </Group>
          <Text size="xs" c="dimmed">
            The copy leaves your collection as sold. If PriceCharting still lists it, Stash updates › Send to PriceCharting reminds you to remove it there.
          </Text>
          {justSold && onTakeOut && (
            <Group>
              <Button variant="subtle" color="gray" size="compact-sm" onClick={onTakeOut}>
                Take it out without a sale
              </Button>
            </Group>
          )}
        </Stack>
      )}
    </Modal>
  );
}

/** Which marketplace a sale went through, in words. */
export const SOLD_VIA_NAMES: Record<string, string> = { ebay: 'eBay', mercari: 'Mercari', local: 'In person', other: 'Elsewhere' };
