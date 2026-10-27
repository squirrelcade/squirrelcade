import { Anchor, Autocomplete, Badge, Box, Button, Card, Group, Image, Loader, Modal, Popover, Stack, Text, Title } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { ConsoleMark, consoleName } from '../ConsoleMark';
import { useOpenGame } from '../GameDrawer';
import { notifyError, notifySuccess, useCanEdit } from '../hooks';
import { PageHeader } from '../components';

/** A game on a magazine's page (GET /api/v1/magazines/issues/:id/pages/:n/games, /game/magazines; D191, D192). */
export interface Mention {
  id: number;
  issueId: number;
  issue: string;
  magazine: string;
  page: number;
  version: number;
  platformKey: string | null;
  title: string;
  printed: string | null;
  kind: string | null;
  score: string | null;
  source: 'citation' | 'ocr' | 'owner';
  state: 'linked' | 'suggested';
  confidence: number | null;
  box: [number, number, number, number] | null;
  /** As Store Mode answers it (have it, on another console, on the wishlist...), with RomM's link when you have it. */
  answer?: string | null;
  ownedOn?: string[];
  wishlist?: { score: number; priority: string; rank: number | null } | null;
  romm?: { url: string; playUrl?: string | null } | null;
}

/** A page made small on the server (D182). */
const thumb = (issueId: number, page: number, version: number) => `/api/v1/magazines/issues/${issueId}/pages/${page}?v=${version}&w=${Math.ceil(90 * (window.devicePixelRatio || 1))}`;

/** What a game's outline says: green you have it, blue on another console, gold on the wishlist, grey none (D192). */
function colorOf(m: Mention): string {
  if (m.answer === 'own' || m.answer === 'own-not-in-catalog') return 'var(--mantine-color-green-6)';
  if (m.answer === 'own-elsewhere') return 'var(--mantine-color-blue-5)';
  if (m.wishlist) return 'var(--mantine-color-yellow-5)';
  return 'var(--mantine-color-gray-5)';
}

function answerText(m: Mention): string {
  if (m.answer === 'own' || m.answer === 'own-not-in-catalog') return 'You have it';
  if (m.answer === 'own-elsewhere') return `You have it on ${(m.ownedOn ?? []).join(', ') || 'another console'}`;
  if (m.wishlist) return `On your wishlist${m.wishlist.rank ? ` (#${m.wishlist.rank})` : ''}, ${m.wishlist.priority} priority`;
  return "You don't have it";
}

/** A game's card on the page (D192): have it and on what, RomM's Play, this page's score, its other mentions; a maybe's answers. */
function GameCard({ m, onDone }: { m: Mention; onDone: () => void }) {
  const open = useOpenGame();
  const canEdit = useCanEdit();
  const queryClient = useQueryClient();
  const others = useQuery({ queryKey: ['magazines', 'mentions', m.title], queryFn: () => api<{ mentions: Mention[] }>(`/game/magazines?title=${encodeURIComponent(m.title)}`) });
  const answer = useMutation({
    mutationFn: (a: { answer: 'yes' | 'no' | 'not-a-game' }) => api(`/magazines/mentions/${m.id}/answer`, { method: 'POST', json: a }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['magazines'] });
      onDone();
    },
    onError: (err) => notifyError(err),
  });
  const forget = useMutation({
    mutationFn: () => api(`/magazines/mentions/${m.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['magazines'] });
      onDone();
    },
    onError: (err) => notifyError(err),
  });
  const elsewhere = (others.data?.mentions ?? []).filter((x) => x.id !== m.id).slice(0, 5);
  return (
    <Stack gap={6} maw={300}>
      <Group gap={6} wrap="nowrap">
        {m.platformKey && <ConsoleMark platformKey={m.platformKey} name={consoleName(m.platformKey)} owned={m.answer === 'own' || m.answer === 'own-not-in-catalog'} size={16} />}
        <Text fw={700} size="sm">
          {m.title}
        </Text>
      </Group>
      <Text size="xs">{answerText(m)}</Text>
      {m.score && (
        <Text size="xs">
          This page's score: <b>{m.score}</b>
        </Text>
      )}
      {m.state === 'suggested' && (
        <Text size="xs" c="dimmed">
          A maybe: "{m.printed}" ({Math.round((m.confidence ?? 0) * 100)}% sure).
        </Text>
      )}
      <Group gap="xs" wrap="wrap">
        {m.platformKey && (
          <Button size="compact-xs" variant="light" onClick={() => open(m.platformKey!, m.title)}>
            The game
          </Button>
        )}
        {m.romm?.playUrl && (
          <Button size="compact-xs" variant="light" component="a" href={m.romm.playUrl} target="_blank" rel="noreferrer">
            Play on RomM
          </Button>
        )}
      </Group>
      {elsewhere.length > 0 && (
        <Text size="xs" c="dimmed">
          Also in: {elsewhere.map((x, k) => (
            <span key={x.id}>
              {k > 0 ? '; ' : ''}
              <Anchor component={Link} to={`/leaves/issue/${x.issueId}?page=${x.page}`} size="xs">
                {x.issue}, p. {x.page}
              </Anchor>
            </span>
          ))}
        </Text>
      )}
      {canEdit && m.state === 'suggested' && (
        <Group gap={4} wrap="wrap">
          <Button size="compact-xs" onClick={() => answer.mutate({ answer: 'yes' })} loading={answer.isPending}>
            This is it
          </Button>
          <Button size="compact-xs" variant="default" onClick={() => answer.mutate({ answer: 'no' })}>
            Not this game
          </Button>
          <Button size="compact-xs" variant="default" onClick={() => answer.mutate({ answer: 'not-a-game' })}>
            Not a game
          </Button>
        </Group>
      )}
      {canEdit && m.state === 'linked' && m.source !== 'citation' && (
        <Anchor component="button" type="button" size="xs" c="dimmed" onClick={() => forget.mutate()}>
          Not on this page
        </Anchor>
      )}
    </Stack>
  );
}

/**
 * The games on a page (D192): each one's outline from the text's word boxes (or the owner's box), colored by whether
 * you have it, dotted when it's a maybe; a tap opens its card. In marking mode, a box drawn on the page and a game
 * picked mark one the text can't read (a logo, box art).
 */
export function PageGames({ issueId, page, marking, shown }: { issueId: number; page: number; marking: boolean; shown: boolean }) {
  const queryClient = useQueryClient();
  const data = useQuery({ queryKey: ['magazines', 'page-games', issueId, page], queryFn: () => api<{ width: number | null; height: number | null; games: Mention[] }>(`/magazines/issues/${issueId}/pages/${page}/games`) });
  const [openId, setOpenId] = useState<number | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [drawn, setDrawn] = useState<[number, number, number, number] | null>(null);
  const W = data.data?.width;
  const H = data.data?.height;
  if (!W || !H) return null;
  const at = (e: React.PointerEvent) => {
    const r = area.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  return (
    <>
      <Box
        ref={area}
        pos="absolute"
        inset={0}
        style={{ cursor: marking ? 'crosshair' : undefined, pointerEvents: marking ? 'auto' : 'none', touchAction: marking ? 'none' : undefined }}
        onPointerDown={(e) => {
          if (!marking) return;
          const p = at(e);
          setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
        }}
        onPointerMove={(e) => drag && setDrag({ ...drag, ...((p) => ({ x1: p.x, y1: p.y }))(at(e)) })}
        onPointerUp={() => {
          if (drag && Math.abs(drag.x1 - drag.x0) > 10 && Math.abs(drag.y1 - drag.y0) > 10) setDrawn([Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1), Math.max(drag.x0, drag.x1), Math.max(drag.y0, drag.y1)]);
          setDrag(null);
        }}
      >
        {drag && (
          <Box
            pos="absolute"
            style={{
              left: `${(Math.min(drag.x0, drag.x1) / W) * 100}%`,
              top: `${(Math.min(drag.y0, drag.y1) / H) * 100}%`,
              width: `${(Math.abs(drag.x1 - drag.x0) / W) * 100}%`,
              height: `${(Math.abs(drag.y1 - drag.y0) / H) * 100}%`,
              border: '2px dashed var(--mantine-color-blue-5)',
            }}
          />
        )}
        {shown &&
          (data.data?.games ?? [])
            .filter((m) => m.box)
            .map((m) => (
              <Popover key={m.id} opened={openId === m.id} onChange={(o) => setOpenId(o ? m.id : null)} withinPortal position="bottom" shadow="md" zIndex={400}>
                <Popover.Target>
                  <Box
                    component="button"
                    type="button"
                    aria-label={`${m.title}: ${answerText(m)}`}
                    onClick={() => setOpenId(openId === m.id ? null : m.id)}
                    style={{
                      position: 'absolute',
                      left: `${(m.box![0] / W) * 100}%`,
                      top: `${(m.box![1] / H) * 100}%`,
                      width: `${((m.box![2] - m.box![0]) / W) * 100}%`,
                      height: `${((m.box![3] - m.box![1]) / H) * 100}%`,
                      border: `2px ${m.state === 'suggested' ? 'dotted' : 'solid'} ${colorOf(m)}`,
                      borderRadius: 3,
                      background: 'transparent',
                      cursor: 'pointer',
                      pointerEvents: 'auto',
                      padding: 0,
                    }}
                  />
                </Popover.Target>
                <Popover.Dropdown>
                  <GameCard m={m} onDone={() => setOpenId(null)} />
                </Popover.Dropdown>
              </Popover>
            ))}
      </Box>
      <MarkGame
        box={drawn}
        onClose={() => setDrawn(null)}
        onSave={async (g) => {
          try {
            await api(`/magazines/issues/${issueId}/pages/${page}/mentions`, { method: 'POST', json: { ...g, box: drawn } });
            notifySuccess(`${g.title} is marked on this page.`);
            setDrawn(null);
            await queryClient.invalidateQueries({ queryKey: ['magazines'] });
          } catch (err) {
            notifyError(err);
          }
        }}
      />
    </>
  );
}

/** The game a box drawn on a page is: a search of the games Squirrelcade knows (D192). */
function MarkGame({ box, onClose, onSave }: { box: [number, number, number, number] | null; onClose: () => void; onSave: (g: { platformKey: string; title: string }) => void }) {
  const [q, setQ] = useState('');
  const [dq] = useDebouncedValue(q, 250);
  const found = useQuery({ queryKey: ['lookup', 'mark', dq], queryFn: () => api<{ platformKey: string; platform: string; title: string }[]>(`/lookup?q=${encodeURIComponent(dq)}&limit=15`), enabled: dq.trim().length >= 2 });
  const options = (found.data ?? []).map((r) => ({ value: `${r.platformKey}|${r.title}`, label: `${r.title} · ${r.platform}` }));
  return (
    <Modal opened={box !== null} onClose={onClose} title="Which game is this?" zIndex={400}>
      <Autocomplete
        label="The game"
        placeholder="Its title"
        data={options}
        value={q}
        onChange={setQ}
        onOptionSubmit={(v) => {
          const [platformKey, ...t] = v.split('|');
          onSave({ platformKey: platformKey!, title: t.join('|') });
          setQ('');
        }}
        comboboxProps={{ zIndex: 450 }}
        data-autofocus
      />
    </Modal>
  );
}

/** An issue's games, page by page (D191, D192): each with whether you have it, opening at its page. */
export function IssueGames({ issueId }: { issueId: number }) {
  const data = useQuery({ queryKey: ['magazines', 'issue-games', issueId], queryFn: () => api<{ games: Mention[] }>(`/magazines/issues/${issueId}/games`) });
  const games = data.data?.games ?? [];
  if (games.length === 0) return null;
  return (
    <Card withBorder padding="sm">
      <Title order={3} size="h5" mb={6}>
        In this issue ({games.length})
      </Title>
      <Group gap="xs" wrap="wrap">
        {games.map((m) => (
          <Anchor key={m.id} component={Link} to={`?page=${m.page}`} underline="never">
            <Badge variant="light" color={m.answer === 'own' || m.answer === 'own-not-in-catalog' ? 'green' : m.answer === 'own-elsewhere' ? 'blue' : m.wishlist ? 'yellow' : 'gray'} style={{ textTransform: 'none', cursor: 'pointer' }}>
              p. {m.page} · {m.title}
              {m.score ? ` · ${m.score}` : ''}
              {m.state === 'suggested' ? ' ?' : ''}
            </Badge>
          </Anchor>
        ))}
      </Group>
    </Card>
  );
}

/** In the magazines (D191): a game's reviews and mentions in your scans, each opening at its page. */
export function InTheMagazines({ title }: { title: string }) {
  const data = useQuery({ queryKey: ['magazines', 'mentions', title], queryFn: () => api<{ mentions: Mention[] }>(`/game/magazines?title=${encodeURIComponent(title)}`), retry: false });
  const list = (data.data?.mentions ?? []).filter((m) => m.state === 'linked');
  const maybe = (data.data?.mentions ?? []).filter((m) => m.state === 'suggested');
  if (list.length + maybe.length === 0) return null;
  return (
    <Stack gap={6}>
      <Text size="xs" tt="uppercase" fw={700} c="dimmed">
        In your magazines
      </Text>
      {list.map((m) => (
        <Anchor key={m.id} component={Link} to={`/leaves/issue/${m.issueId}?page=${m.page}`} underline="never" c="inherit">
          <Group gap="sm" wrap="nowrap">
            <Image src={thumb(m.issueId, m.page, m.version)} w={45} h={60} radius="sm" fit="cover" alt="" loading="lazy" />
            <Stack gap={0} style={{ minWidth: 0 }}>
              <Text size="sm" fw={600} lineClamp={1}>
                {m.issue}
              </Text>
              <Text size="xs" c="dimmed">
                p. {m.page}
                {m.kind ? ` · ${m.kind}` : ''}
                {m.score ? ` · ${m.score}` : ''}
              </Text>
            </Stack>
          </Group>
        </Anchor>
      ))}
      {maybe.length > 0 && (
        <Text size="xs" c="dimmed">
          Maybe also: {maybe.map((m) => `${m.issue}, p. ${m.page}`).join('; ')}
        </Text>
      )}
    </Stack>
  );
}

/** Review > Magazines (D192): the games found that are maybes, each with its page and the words, to answer. */
export function MagazineReviewPage() {
  const data = useQuery({ queryKey: ['magazines', 'review'], queryFn: () => api<{ mentions: Mention[] }>('/magazines/review') });
  return (
    <>
      <PageHeader help="magazines" title="Review › Magazines" description="Games the magazines' text may name: say which they are, and the answer is kept for those words in every issue." />
      {!data.data ? (
        <Loader />
      ) : data.data.mentions.length === 0 ? (
        <Text c="dimmed">Nothing to answer.</Text>
      ) : (
        <Stack gap="sm">
          {data.data.mentions.map((m) => (
            <Card key={m.id} withBorder padding="sm">
              <Group gap="md" wrap="nowrap" align="flex-start">
                <Anchor component={Link} to={`/leaves/issue/${m.issueId}?page=${m.page}`}>
                  <Image src={thumb(m.issueId, m.page, m.version)} w={60} h={80} radius="sm" fit="cover" alt="" />
                </Anchor>
                <Stack gap={4} style={{ flex: 1 }}>
                  <Text size="xs" c="dimmed">
                    {m.issue}, p. {m.page}: "{m.printed}"
                  </Text>
                  <GameCard m={m} onDone={() => undefined} />
                </Stack>
              </Group>
            </Card>
          ))}
        </Stack>
      )}
    </>
  );
}
