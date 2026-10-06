import { Anchor, Button, Group, Text } from '@mantine/core';
import { IconDownload, IconPlus } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Have } from '../Acorn';
import { api } from '../api';
import { HelpLink } from '../components';
import { count, date, wholeMoney } from '../format';
import { useFeature, useSetting } from '../hooks';
import { generationName, launchDay, type ConsoleHistoryView } from './History';

/** What the head reads of a console's catalog (GET /api/v1/catalogs/:key). */
export interface ConsoleCounts {
  platform: { key: string; name: string };
  counts: { targets: number; owned: number; missing: number; review: number; excluded: number; unconfirmed: number; upcoming: number; extra?: number };
  percent: number;
  regions: { region: string; consoleLabel: string; games: number; copies: number }[];
  notInCatalog: unknown[];
}

/** One update's totals with each platform's (GET /api/v1/collection/history). */
interface Point {
  date: string;
  platforms: { key: string; valueCents: number }[] | null;
}

/** The region codes of the console launches (the history's) that are the home region's. */
const HOME_CODES: Record<string, string[]> = {
  'north-america': ['NA', 'US'],
  europe: ['EU', 'PAL', 'UK'],
  japan: ['JP'],
  asia: ['KR', 'CN', 'AS', 'TW', 'HK'],
};

/** How long ago the value change is measured from: the update about a month before the newest. */
const CHANGE_DAYS = 28;

/**
 * A console's head (0.49.0, the redesign's console page): who made it, its generation and its launch in your region;
 * its name; how complete its catalog is, as one bar in three parts (owned, missing, to review); its counts as tiles
 * that open their tab; and how many games and copies you have, with their worth and its change over the last month.
 */
export function ConsoleHead({ d, tab, tiles, canEdit, onAdd }: { d: ConsoleCounts; tab: string; tiles: boolean; canEdit: boolean; onAdd: () => void }) {
  const key = d.platform.key;
  const historyOn = useFeature('history');
  const dateFormat = useSetting('general.dateFormat', 'us');
  const currency = useSetting('general.currency', 'USD');
  const home = useSetting('general.homeRegion', 'north-america');
  const history = useQuery({ queryKey: ['history', 'consoles', key], queryFn: () => api<ConsoleHistoryView>(`/history/consoles/${key}`), enabled: historyOn, retry: false });
  const updates = useQuery({ queryKey: ['collection', 'history'], queryFn: () => api<Point[]>('/collection/history'), retry: false });

  const profile = history.data?.history?.profile ?? null;
  const codes = HOME_CODES[home] ?? [];
  const launch = profile ? (profile.launches.find((l) => codes.includes(l.region.toUpperCase())) ?? [...profile.launches].sort((a, b) => a.date.localeCompare(b.date))[0]) : undefined;
  const line = profile ? [profile.manufacturer, profile.generation ? generationName(profile.generation) : null, launch ? `${launch.region} launch ${launchDay(launch.date, dateFormat)}` : null].filter(Boolean).join(' · ') : '';

  // This console in the newest update, and in the one about a month before it.
  const points = (updates.data ?? []).filter((p) => p.platforms?.some((x) => x.key === key));
  const last = points[points.length - 1];
  const now = last?.platforms?.find((x) => x.key === key);
  const cutoff = last ? Date.parse(last.date) - CHANGE_DAYS * 86_400_000 : 0;
  const before = [...points].reverse().find((p) => p !== last && Date.parse(p.date) <= cutoff) ?? (points.length > 1 ? points[0] : undefined);
  const then = before?.platforms?.find((x) => x.key === key);
  const change = now && then && then.valueCents > 0 ? now.valueCents - then.valueCents : null;
  // The games and copies of each region's release together, as the breadcrumb counts them.
  const games = d.regions.reduce((sum, r) => sum + r.games, 0);
  const copies = d.regions.reduce((sum, r) => sum + r.copies, 0);

  const counting = d.counts.owned + d.counts.missing + d.counts.review;
  const tile = (value: string, label: ReactNode, n: number, tone?: 'gold', hint?: string): ReactNode => (
    <Link key={value} to={`?tab=${value}`} replace className="sc-tile" data-tone={tone} aria-current={tab === value ? 'page' : undefined} title={hint}>
      <span className="sc-tile-label">{label}</span>
      <span className="sc-tile-number">{count(n)}</span>
    </Link>
  );
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <nav aria-label="Breadcrumb" className="sc-muted" style={{ fontSize: 14, minWidth: 0 }}>
          <Anchor component={Link} to="/platforms" size="sm">
            Platforms
          </Anchor>{' '}
          ›{' '}
          <Anchor component={Link} to={`/collection?platform=${key}`} size="sm">
            Your {d.platform.name} games
          </Anchor>
          {d.regions.length > 1 && (
            <>
              {' '}
              (
              {d.regions.map((r, i) => (
                <Fragment key={`${r.region}|${r.consoleLabel}`}>
                  {i > 0 && ', '}
                  <Anchor component={Link} to={`/collection?platform=${key}&region=${r.region}`} size="sm">
                    {count(r.games)} {r.consoleLabel}
                  </Anchor>
                </Fragment>
              ))}
              )
            </>
          )}
        </nav>
        <Group gap={8}>
          <Button size="sm" radius={8} variant="default" leftSection={<IconDownload size={16} />} component="a" href={`/api/v1/catalogs/${key}/export`} download>
            Download
          </Button>
          {canEdit && (
            <Button size="sm" radius={8} variant="default" leftSection={<IconPlus size={16} />} onClick={onAdd}>
              Add game
            </Button>
          )}
        </Group>
      </div>
      <section className="sc-card sc-console" aria-labelledby="console-h">
        {line && (
          <div className="sc-pixel sc-muted" style={{ fontSize: 13 }}>
            {line}
          </div>
        )}
        <Group gap={8} wrap="nowrap" align="center">
          <h1 id="console-h" className="sc-console-title">
            {d.platform.name}
          </h1>
          <HelpLink topic="catalogs" />
        </Group>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: '4px 12px' }}>
            <span style={{ fontWeight: 700, fontSize: 18 }}>{d.percent}% complete</span>
            <span className="sc-muted">
              {count(d.counts.owned)} of {count(counting)} catalog games owned
            </span>
          </div>
          <div className="sc-split" role="img" aria-label={`Owned ${count(d.counts.owned)}, missing ${count(d.counts.missing)}, to review ${count(d.counts.review)}`}>
            {d.counts.owned > 0 && <span title={`Owned: ${count(d.counts.owned)}`} style={{ flex: d.counts.owned, background: 'var(--sc-cade)' }} />}
            {d.counts.missing > 0 && <span title={`Missing: ${count(d.counts.missing)}`} style={{ flex: d.counts.missing, background: 'var(--sc-gold-fill)' }} />}
            {d.counts.review > 0 && <span title={`To review: ${count(d.counts.review)}`} style={{ flex: d.counts.review, background: 'var(--sc-line-strong)' }} />}
            {counting === 0 && <span style={{ flex: 1, background: 'var(--sc-line)' }} />}
          </div>
        </div>
        {tiles && (
          <div className="sc-tiles">
            {tile('owned', <Have>Owned</Have>, d.counts.owned)}
            {tile('missing', 'Missing', d.counts.missing, 'gold')}
            {tile('review', 'Needs review', d.counts.review)}
            {tile('excluded', 'Excluded', d.counts.excluded)}
            {d.counts.unconfirmed > 0 && tile('unconfirmed', 'Not confirmed physical', d.counts.unconfirmed, undefined, 'Listed, not counted until confirmed')}
            {d.counts.upcoming > 0 && tile('upcoming', 'Upcoming', d.counts.upcoming, undefined, 'Not out yet; counted once released (Settings > Catalogs and matching)')}
            {tile('unmatched', 'Not in catalog', d.notInCatalog.length, undefined, 'Owned games matching no catalog entry')}
          </div>
        )}
        {(games > 0 || copies > 0) && (
          <Text size="sm" className="sc-soft" component="div" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 22px' }}>
            <span>
              {count(games)} {games === 1 ? 'game' : 'games'} · {count(copies)} {copies === 1 ? 'copy' : 'copies'}
            </span>
            {now && now.valueCents > 0 && (
              <span>
                Worth {wholeMoney(now.valueCents, currency)}
                {change !== null && change !== 0 && then && before && (
                  <span style={{ color: change > 0 ? 'var(--sc-have)' : 'var(--sc-over)' }}>
                    {' '}
                    ({change > 0 ? '+' : '−'}
                    {wholeMoney(Math.abs(change), currency)}, {change > 0 ? '+' : '−'}
                    {Math.abs(Math.round((change / then.valueCents) * 1000) / 10)}% since {date(before.date, dateFormat)})
                  </span>
                )}
              </span>
            )}
          </Text>
        )}
      </section>
    </>
  );
}
