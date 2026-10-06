import { Alert, Anchor, Badge, Button, Card, Checkbox, Group, Loader, SegmentedControl, Select, Stack, Text } from '@mantine/core';
import { IconExternalLink } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { PageHeader } from '../components';
import { money, timeAgo } from '../format';
import { useCanEdit, useSetting } from '../hooks';
import { GameCover, GameTitle } from '../GameDrawer';
import { Acorns, Reviews, type ReviewsOf } from '../Acorn';
import { consoleOf, dealConsoles, dealOrder, isNewListing, type DealOrder } from '../dealTools';

/** A deal from PriceCharting's emails, matched to the catalogs (GET /api/v1/deals). */
interface Deal {
  id: string;
  date: string;
  title: string;
  console: string;
  priceCents: number | null;
  saveCents: number | null;
  listingTitle: string | null;
  listingUrl: string | null;
  priceChartingUrl: string | null;
  platformKey: string | null;
  platform: string | null;
  gameTitle: string | null;
  status: string | null;
  wishlist: { score: number; priority: string; rank: number | null } | null;
  coverId: string | null;
  /** IGDB's rating, beside its acorns (0.53.0). */
  reviews?: ReviewsOf;
}

const STATUS: Record<string, { label: string; color: string }> = {
  owned: { label: 'You have it', color: 'teal' },
  missing: { label: 'Need it', color: 'orange' },
  review: { label: 'Check it', color: 'yellow' },
  unconfirmed: { label: 'Need it if physical', color: 'cyan' },
  excluded: { label: 'Not a target', color: 'gray' },
};

/**
 * Wishlist > Deals: games of your PriceCharting wishlist listed on eBay below the market value, from PriceCharting's
 * emails (collection updates from your email, with deal emails on), with where each stands on Squirrelcade's wishlist.
 */
export function DealsPage() {
  const currency = useSetting('general.currency', 'USD');
  const canEdit = useCanEdit();
  const [showOwned, setShowOwned] = useState(false);
  // Best deals first (the biggest saving against the market value) unless the wishlist's first are asked for (0.52.0).
  const [order, setOrder] = useState<DealOrder>('best');
  const [console, setConsole] = useState<string | null>(null);
  const [onlyNew, setOnlyNew] = useState(false);
  const data = useQuery({ queryKey: ['deals'], queryFn: () => api<{ on: boolean; days: number; deals: Deal[]; partsLeftOut?: number }>('/deals') });
  const d = data.data;
  const all = (d?.deals ?? []).filter((x) => showOwned || x.status !== 'owned');
  const deals = all.filter((x) => (!console || consoleOf(x) === console) && (!onlyNew || isNewListing(x))).sort(dealOrder(order));
  const hiddenOwned = (d?.deals ?? []).filter((x) => x.status === 'owned').length;
  return (
    <>
      <PageHeader
        help="wishlist"
        title="Deals"
        description={`Games on your PriceCharting wishlist that someone listed on eBay below the market value, from PriceCharting's emails of the last ${d?.days ?? 7} days, with where each stands on your wishlist here.`}
      />
      {data.isPending && <Loader />}
      {d && !d.on && (
        <Alert color="gray" mb="md">
          Deals come from PriceCharting's emails: on Settings › Email, turn on collection updates from your email, with "Read PriceCharting's deal emails too".{' '}
          {canEdit && (
            <Anchor component={Link} to="/settings/email#setting-features.mail" c="inherit" fw={600} underline="always">
              Settings › Email
            </Anchor>
          )}
        </Alert>
      )}
      {d?.on && d.deals.length === 0 && (
        <Text c="dimmed" size="sm">
          No deals in the last {d.days} days. PriceCharting emails one when a game of your wishlist there is listed below the market value; add games to your wishlist on PriceCharting to get them.
        </Text>
      )}
      {all.length > 0 && (
        <Group mb="sm" gap="sm" wrap="wrap">
          <Select size="sm" w={220} placeholder="All consoles" aria-label="Console" data={dealConsoles(all)} value={console} onChange={setConsole} clearable />
          <SegmentedControl
            size="sm"
            aria-label="Order"
            value={order}
            onChange={(v) => setOrder(v as DealOrder)}
            data={[
              { value: 'best', label: 'Best deals' },
              { value: 'wishlist', label: 'Wishlist first' },
            ]}
          />
          <Checkbox label="New or sealed only" checked={onlyNew} onChange={(e) => setOnlyNew(e.currentTarget.checked)} />
          {hiddenOwned > 0 && <Checkbox label={`Show the ${hiddenOwned} for games you have`} checked={showOwned} onChange={(e) => setShowOwned(e.currentTarget.checked)} />}
        </Group>
      )}
      {all.length > 0 && deals.length === 0 && (
        <Text c="dimmed" size="sm" mb="sm">
          No deals match these choices.
        </Text>
      )}
      {(d?.partsLeftOut ?? 0) > 0 && (
        <Text c="dimmed" size="sm" mb="sm">
          {d!.partsLeftOut === 1 ? 'A listing' : `${d!.partsLeftOut} listings`} of a manual, a case or a box alone {d!.partsLeftOut === 1 ? 'is' : 'are'} left out: PriceCharting compares {d!.partsLeftOut === 1 ? 'it' : 'them'} with a whole game's value.{' '}
          {canEdit && (
            <Anchor component={Link} to="/settings/email#setting-mail.dealsLeaveOutParts" size="sm">
              Settings › Email
            </Anchor>
          )}
        </Text>
      )}
      <Stack gap="sm">
        {deals.map((x) => {
          const status = x.status ? STATUS[x.status] : null;
          const market = x.priceCents !== null && x.saveCents !== null ? x.priceCents + x.saveCents : null;
          const off = market && x.saveCents ? Math.round((x.saveCents / market) * 100) : null;
          return (
            <Card key={x.id} withBorder padding="sm">
              <Group gap="md" align="flex-start" wrap="nowrap">
                {x.platformKey && x.gameTitle ? <GameCover platformKey={x.platformKey} title={x.gameTitle} id={x.coverId} width={56} placeholder /> : null}
                <Stack gap={4} style={{ minWidth: 0, flex: 1 }}>
                  {x.platformKey && x.gameTitle ? <GameTitle platformKey={x.platformKey} title={x.gameTitle} fw={600} /> : <Text fw={600}>{x.title}</Text>}
                  <Group gap={6}>
                    <Text size="sm" c="dimmed">
                      {x.platform ?? x.console}
                    </Text>
                    {status && (
                      <Badge size="sm" color={status.color} variant="light">
                        {status.label}
                      </Badge>
                    )}
                    {x.wishlist && (
                      <Badge size="sm" variant="outline">
                        {x.wishlist.rank ? `#${x.wishlist.rank} · ` : ''}
                        {x.wishlist.priority}, <Acorns n={x.wishlist.score} size={11} />
                        {x.reviews && (
                          <>
                            {' · '}
                            <Reviews r={x.reviews} size={11} />
                          </>
                        )}
                      </Badge>
                    )}
                  </Group>
                  <Text size="sm">
                    {x.priceCents !== null ? <b>{money(x.priceCents, currency)}</b> : 'A listing'} on eBay
                    {x.saveCents ? `, ${money(x.saveCents, currency)} below the market value${off ? ` (${off}% off)` : ''}` : ''} · {timeAgo(x.date)}
                  </Text>
                  {x.listingTitle && (
                    <Text size="xs" c="dimmed" lineClamp={1}>
                      “{x.listingTitle}”
                    </Text>
                  )}
                  <Group gap="xs" mt={2}>
                    {x.listingUrl && (
                      <Button component="a" href={x.listingUrl} target="_blank" rel="noreferrer" size="compact-sm" variant="light" rightSection={<IconExternalLink size={12} />}>
                        See the listing
                      </Button>
                    )}
                    {x.priceChartingUrl && (
                      <Button component="a" href={x.priceChartingUrl} target="_blank" rel="noreferrer" size="compact-sm" variant="subtle">
                        PriceCharting
                      </Button>
                    )}
                  </Group>
                </Stack>
              </Group>
            </Card>
          );
        })}
      </Stack>
      {(d?.deals.length ?? 0) > 0 && (
        <Text size="xs" c="dimmed" mt="md">
          Deals and market values from{' '}
          <Anchor href="https://www.pricecharting.com" target="_blank" rel="noreferrer" size="xs">
            PriceCharting
          </Anchor>
          's emails to you; a listing may have sold since.
        </Text>
      )}
    </>
  );
}
