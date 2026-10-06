import { channelsOn } from '@squirrelcade/core';
import { Anchor, Badge, Card, Group, Stack, Table, Text, Title } from '@mantine/core';
import { Link } from 'react-router';
import { useSettings } from '../hooks';

/**
 * Settings > Features, below the switches: what Squirrelcade needs (only a collection), and the other outside services it
 * can use, each with its own switch where it's set up.
 */
export function FeatureExtras() {
  const { data: s } = useSettings();
  if (!s) return null;
  const sources = s['sources.catalogOrder'] ?? [];
  const catalogOn = sources.filter((x) => x.on).length;
  const channels = channelsOn(s);
  const rows: { name: string; what: string; on: boolean; state: string; to: string }[] = [
    {
      name: 'Messages',
      what: 'A summary after each collection update, and alerts when something fails: by email, a phone app (Pushover, Pushbullet, ntfy, Gotify), a chat (Discord, Telegram, Slack), a webhook or Apprise. Each has its own switch.',
      on: channels.length > 0,
      state: channels.length > 0 ? channels.join(', ') : 'Off',
      to: '/settings/notifications',
    },
    {
      name: 'Naming unknown barcodes',
      what: 'Store Mode asks UPCitemdb (free, no account) or UPC Database (a free account\'s key), or both, what product a barcode it has never seen is.',
      on: s['sources.barcodeLookup'] !== 'off',
      state: { off: 'Off', upcitemdb: 'UPCitemdb', upcdatabase: 'UPC Database', both: 'Both' }[s['sources.barcodeLookup']] ?? 'UPCitemdb',
      to: '/settings/sources#setting-sources.barcodeLookup',
    },
    {
      name: 'Catalog sources',
      what: "Where each console's list of games comes from: Wikipedia's lists and others. Catalogs are what completion and the wishlist are worked out against.",
      on: catalogOn > 0,
      state: `${catalogOn} of ${sources.length} on`,
      to: '/settings/sources#setting-sources.catalogOrder',
    },
    {
      name: 'Share links',
      what: "Links anyone can open without signing in: your wishlist's top picks (for gifts), or the games you have for sale or trade. Made on the Wishlist and For sale pages; each can be removed.",
      on: true,
      state: 'When you make one',
      to: '/wishlist',
    },
    {
      name: 'Checking a game without signing in',
      what: 'The sign-in page can lead with scanning a game, for someone shopping for you.',
      on: s['security.publicCheck'] !== 'off',
      state: s['security.publicCheck'] === 'off' ? 'Off' : s['security.publicCheck'] === 'phones' ? 'On phones' : 'Everywhere',
      to: '/settings/security',
    },
  ];
  return (
    <Card withBorder>
      <Stack gap="sm">
        <Title order={5}>What Squirrelcade needs, and what else it can use</Title>
        <Text size="sm">
          Only your collection is required: a PriceCharting export (or a spreadsheet of your own), added on{' '}
          <Anchor component={Link} to="/updates" size="sm">
            Stash updates
          </Anchor>{' '}
          or dropped in the watched folder. Everything above and below is optional, and each has its own switch.
        </Text>
        <Table verticalSpacing={6}>
          <Table.Tbody>
            {rows.map((r) => (
              <Table.Tr key={r.name}>
                <Table.Td>
                  <Anchor component={Link} to={r.to} size="sm" fw={600}>
                    {r.name}
                  </Anchor>
                  <Text size="xs" c="dimmed">
                    {r.what}
                  </Text>
                </Table.Td>
                <Table.Td w={120} ta="right">
                  <Group justify="flex-end">
                    <Badge color={r.on ? 'green' : 'gray'} variant="light" style={{ textTransform: 'none' }}>
                      {r.state}
                    </Badge>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Stack>
    </Card>
  );
}
