import { Anchor, Badge, Card, Group, Stack, Table, Text, Title } from '@mantine/core';
import { COMPLETENESS_LABELS, HARDWARE_LABELS, type Completeness, type HardwareKind } from '@squirrelcade/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StashMark } from './Acorn';
import { api } from './api';
import { ConsoleMark } from './ConsoleMark';
import { wholeMoney } from './format';
import { notifyError, notifySuccess, useCanEdit, useSetting } from './hooks';

/** A piece of hardware you have (GET /api/v1/hardware, T-217). */
interface HardwareItem {
  productId: string;
  title: string;
  kind: HardwareKind;
  platformKey: string;
  platform: string;
  completeness: string;
  quantity: number;
  valueCents: number | null;
  yours: boolean;
}

/** Your hardware, on one console or all: read once and kept with the collection. */
export function useHardware(platformKey?: string) {
  return useQuery({
    queryKey: ['collection', 'hardware', platformKey ?? 'all'],
    queryFn: () => api<{ items: HardwareItem[]; valueCents: number }>(`/hardware${platformKey ? `?platform=${encodeURIComponent(platformKey)}` : ''}`),
    staleTime: 60_000,
  });
}

/** This is hardware / This is a game, for the owner to correct Squirrelcade's reading of a product's name (T-217). */
function useSetHardware() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, is }: { productId: string; is: 'hardware' | 'game' | null }) => api(`/hardware/${encodeURIComponent(productId)}`, { method: 'PUT', json: { is } }),
    onSuccess: (_d, v) => {
      notifySuccess(v.is === 'game' ? "It's a game: it counts with its console's games again." : v.is === 'hardware' ? "It's hardware: out of the game counts, under Your hardware." : 'Back to what its name says.');
      void Promise.all(['collection', 'catalogs', 'platforms', 'game', 'review'].map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
    },
    onError: (err) => notifyError(err),
  });
}

/** The button under a copy (the game drawer): This is hardware, or This is a game for a copy read as hardware. */
export function HardwareToggle({ productId, platformKey }: { productId: string; platformKey: string }) {
  const canEdit = useCanEdit();
  const list = useHardware(platformKey);
  const set = useSetHardware();
  if (!canEdit || !list.data) return null;
  const item = list.data.items.find((i) => i.productId === productId);
  return (
    <Anchor component="button" type="button" size="xs" disabled={set.isPending} onClick={() => set.mutate({ productId, is: item ? 'game' : 'hardware' })}>
      {item ? `${HARDWARE_LABELS[item.kind]}: this is a game` : 'this is hardware'}
    </Anchor>
  );
}

/**
 * Your hardware (T-217, D205): the consoles, controllers and accessories in your collection, read from PriceCharting's
 * names, each with its condition and worth; on a console's page only its own. Hidden when there's none.
 */
export function YourHardware({ platformKey }: { platformKey?: string }) {
  const currency = useSetting('general.currency', 'USD');
  const canEdit = useCanEdit();
  const list = useHardware(platformKey);
  const set = useSetHardware();
  const items = list.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <Card withBorder>
      <Group justify="space-between" mb="xs" wrap="wrap">
        <Title order={5}>
          <Group gap={8} component="span">
            <StashMark size={14} />
            Your hardware
          </Group>
        </Title>
        <Text size="sm" c="dimmed">
          {items.length} {items.length === 1 ? 'piece' : 'pieces'} · {wholeMoney(list.data!.valueCents, currency)}
        </Text>
      </Group>
      <Table.ScrollContainer minWidth={0}>
        <Table verticalSpacing={4}>
          <Table.Tbody>
            {items.map((i) => (
              <Table.Tr key={`${i.productId}|${i.platformKey}`}>
                <Table.Td>
                  <Group gap={6} wrap="nowrap">
                    {!platformKey && <ConsoleMark platformKey={i.platformKey} name={i.platform} size={14} />}
                    <Stack gap={0}>
                      <Text size="sm" fw={500}>
                        {i.title}
                        {i.quantity > 1 ? ` ×${i.quantity}` : ''}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {HARDWARE_LABELS[i.kind]} · {COMPLETENESS_LABELS[i.completeness as Completeness] ?? i.completeness}
                      </Text>
                    </Stack>
                    {i.yours && (
                      <Badge size="xs" variant="light" color="gray" tt="none">
                        you said
                      </Badge>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td ta="right">{i.valueCents !== null ? wholeMoney(i.valueCents * i.quantity, currency) : '—'}</Table.Td>
                {canEdit && (
                  <Table.Td ta="right">
                    <Anchor component="button" type="button" size="xs" disabled={set.isPending} onClick={() => set.mutate({ productId: i.productId, is: 'game' })}>
                      This is a game
                    </Anchor>
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Card>
  );
}
