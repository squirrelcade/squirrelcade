import { igdbCoverUrl } from '@squirrelcade/core';
import { Alert, Anchor, Badge, Box, Card, Center, Container, Group, Image, Loader, Stack, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '../api';
import { Squirrel } from '../Brand';
import { money } from '../format';
import { usePageTitle } from '../hooks';

/** What a share link shows (GET /api/v1/share/<token>). */
interface SharedPage {
  kind: 'wishlist' | 'sale';
  name: string | null;
  instanceName: string;
  currency: string;
  generatedAt: string;
  wishes?: { rank: number; title: string; platform: string; coverId: string | null; priority: string; links: { name: string; url: string }[] }[];
  sales?: { title: string; platform: string; condition: string; quantity: number; kind: string; askingCents: number | null; note: string | null; coverId: string | null }[];
}

const PRIORITY_COLORS: Record<string, string> = { High: 'red', Medium: 'orange', Low: 'gray' };

function Art({ id }: { id: string | null }) {
  if (!id) return <Box w={48} h={64} bg="var(--mantine-color-default-hover)" style={{ borderRadius: 3, flex: 'none' }} />;
  return <Image src={igdbCoverUrl(id, 'cover_small')} w={48} h={64} radius={3} fit="cover" alt="" loading="lazy" style={{ flex: 'none' }} />;
}

/**
 * The page a share link opens (/share/<token>), for anyone, signed in or not: the owner's wishlist top picks with
 * where to buy them (for gifts), or the games they have for sale or trade. Nothing else of the collection.
 */
export function SharePage({ token }: { token: string }) {
  const page = useQuery({ queryKey: ['share', token], queryFn: () => api<SharedPage>(`/share/${encodeURIComponent(token)}`), retry: false, staleTime: 5 * 60_000 });
  const p = page.data;
  usePageTitle(p ? (p.kind === 'wishlist' ? 'Wishlist' : 'For sale or trade') : 'Squirrelcade', p?.instanceName ?? 'Squirrelcade');
  if (page.isPending) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }
  if (!p) {
    return (
      <Center mih="100vh" p="md">
        <Stack maw={420}>
          <Title order={3}>This link doesn't work</Title>
          <Alert color="yellow">{errorMessage(page.error)}</Alert>
        </Stack>
      </Center>
    );
  }
  const heading = p.kind === 'wishlist' ? 'Wishlist' : 'For sale or trade';
  return (
    <Container size="sm" py="xl">
      <Stack gap="md">
        <Group gap="sm" wrap="nowrap">
          <Squirrel size={48} />
          <div>
            <Title order={2}>{heading}</Title>
            <Text size="sm" c="dimmed">
              From {p.instanceName}. {p.kind === 'wishlist' ? 'Best first, each with links to where it sells.' : 'Ask about any of them.'}
              {p.name ? ` Shared with ${p.name}.` : ''}
            </Text>
          </div>
        </Group>
        {p.kind === 'wishlist' &&
          (p.wishes ?? []).map((w) => (
            <Card key={`${w.platform}|${w.title}`} withBorder padding="sm">
              <Group gap="sm" wrap="nowrap" align="flex-start">
                <Art id={w.coverId} />
                <Stack gap={2} style={{ minWidth: 0 }}>
                  <Group gap={6}>
                    <Text fw={600}>
                      {w.rank}. {w.title}
                    </Text>
                    <Badge size="xs" variant="light" color={PRIORITY_COLORS[w.priority] ?? 'gray'}>
                      {w.priority}
                    </Badge>
                  </Group>
                  <Text size="sm" c="dimmed">
                    {w.platform}
                  </Text>
                  <Group gap="sm">
                    {w.links.map((l) => (
                      <Anchor key={l.name} href={l.url} target="_blank" rel="noreferrer" size="sm">
                        {l.name}
                      </Anchor>
                    ))}
                  </Group>
                </Stack>
              </Group>
            </Card>
          ))}
        {p.kind === 'wishlist' && (p.wishes ?? []).length === 0 && <Text c="dimmed">The wishlist is empty right now.</Text>}
        {p.kind === 'sale' &&
          (p.sales ?? []).map((s, i) => (
            <Card key={`${s.platform}|${s.title}|${i}`} withBorder padding="sm">
              <Group gap="sm" wrap="nowrap" align="flex-start">
                <Art id={s.coverId} />
                <Stack gap={2}>
                  <Group gap={6}>
                    <Text fw={600}>{s.title}</Text>
                    <Badge size="xs" variant="light" color="orange" style={{ textTransform: 'none' }}>
                      {s.kind === 'trade' ? 'For trade' : 'For sale'}
                    </Badge>
                  </Group>
                  <Text size="sm" c="dimmed">
                    {s.platform} · {s.condition}
                    {s.quantity > 1 ? ` · ${s.quantity} copies` : ''}
                    {s.askingCents !== null ? ` · ${money(s.askingCents, p.currency)}` : ''}
                  </Text>
                  {s.note && <Text size="sm">{s.note}</Text>}
                </Stack>
              </Group>
            </Card>
          ))}
        {p.kind === 'sale' && (p.sales ?? []).length === 0 && <Text c="dimmed">Nothing is for sale or trade right now.</Text>}
        <Text size="xs" c="dimmed" ta="center">
          Made with Squirrelcade.
        </Text>
      </Stack>
    </Container>
  );
}
