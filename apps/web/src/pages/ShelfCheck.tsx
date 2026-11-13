import { ActionIcon, Alert, Anchor, Badge, Button, Card, Checkbox, FileButton, Group, Progress, Select, Stack, Text, Title, UnstyledButton } from '@mantine/core';
import { useReducedMotion } from '@mantine/hooks';
import { shelfReadKey } from '@squirrelcade/core';
import { IconCamera, IconPhoto, IconX } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Acorns, Have } from '../Acorn';
import { api, errorMessage } from '../api';
import { ANSWERS, type Answer } from '../choices';
import { HelpLink } from '../components';
import { GameTitle } from '../GameDrawer';
import { notifyError, notifySuccess } from '../hooks';
import { queuePurchase, unreachable } from '../offline';
import { PutInPlace } from '../PutInPlace';
import { doubtText, linesFor, progressText, progressValue, unsureLists, type ShelfFound, type ShelfUnsure } from '../shelfCheck';
import { FixSpine, PhotoBoxes, remember, remembered, useShelfReader } from '../ShelfReader';

const LAST_CONSOLE = 'squirrelcade.shelfConsole';
const UPRIGHT_TOO = 'squirrelcade.shelfUpright';

/** The photo's greatest height while it shows a tapped game, held at the bottom of the screen under the lists (T-406). */
const LOCATED_HEIGHT = '40vh';

/** A game tapped in a list, to be shown on the photo: its texts read, and what to say about it there. */
interface Located {
  /** The row it came from (a game's key, or an unsure spine's read). */
  id: string;
  title: string;
  read: string;
  reads: string[];
  says: string;
}

/**
 * A row's own click (anywhere but its buttons and links) shows its game on the photo, and the row is kept in view
 * above the photo held at the bottom of the screen (its scroll margins).
 */
function rowStyle(selected: boolean): CSSProperties {
  return {
    cursor: 'pointer',
    borderRadius: 6,
    padding: '4px 6px',
    margin: '-4px -6px',
    background: selected ? 'var(--mantine-color-default-hover)' : undefined,
    boxShadow: selected ? 'inset 3px 0 0 var(--mantine-primary-color-filled)' : undefined,
    scrollMarginTop: 'calc(var(--app-shell-header-offset, 0px) + 8px)',
    scrollMarginBottom: `calc(${LOCATED_HEIGHT} + var(--app-shell-footer-offset, 0px) + 64px)`,
  };
}

function onRow(locate: (row: HTMLElement) => void) {
  return (e: MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button, a, input, label')) return;
    locate(e.currentTarget);
  };
}

/** A game's title as the button that shows it on the photo (its drawer opens from the photo's bar). */
function LocateTitle({ title, selected, onLocate }: { title: string; selected: boolean; onLocate: (row: HTMLElement) => void }) {
  return (
    <UnstyledButton
      fz="sm"
      fw={600}
      ta="left"
      title="Show it on the photo"
      aria-pressed={selected}
      onClick={(e) => onLocate((e.currentTarget.closest('[data-shelf-row]') as HTMLElement | null) ?? e.currentTarget)}
      style={{ wordBreak: 'break-word' }}
    >
      {title}
    </UnstyledButton>
  );
}

function FoundRow({ f, canEdit, bought, selected, onBuy, onFix, onLocate }: { f: ShelfFound; canEdit: boolean; bought: boolean; selected: boolean; onBuy?: () => void; onFix: () => void; onLocate: (row: HTMLElement) => void }) {
  const g = f.game;
  return (
    <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs" data-shelf-row onClick={onRow(onLocate)} style={rowStyle(selected)}>
      <Stack gap={0} style={{ minWidth: 0 }}>
        <LocateTitle title={f.title} selected={selected} onLocate={onLocate} />
        <Text size="xs" c="dimmed">
          {f.answer === 'own-elsewhere' && g.on?.length ? `You have it on ${g.on.join(', ')}` : ANSWERS[f.answer].label}
          {g.w ? (
            <>
              {' · '}
              {g.w.rank ? `#${g.w.rank} on your wishlist, ` : ''}
              <Acorns n={g.w.score} size={10} />
            </>
          ) : null}
          {g.n ? ` · Your note: ${g.n}` : ''}
        </Text>
        <Text size="xs" c="dimmed" fs="italic">
          read “{f.read}”{f.fixed ? ', as you said' : ''} ·{' '}
          <Anchor component="button" type="button" size="xs" onClick={onFix}>
            {f.fixed ? 'Change' : 'Not it?'}
          </Anchor>
        </Text>
      </Stack>
      {canEdit && onBuy && g.e !== undefined && (
        <Button size="compact-xs" variant={bought ? 'light' : 'default'} disabled={bought} onClick={onBuy}>
          {bought ? 'Bought' : 'I bought it'}
        </Button>
      )}
    </Group>
  );
}

/** What an unsure spine would be: "If it is: ..." for the guess alone, and for each game when it could be another. */
function ifItIs(u: ShelfUnsure): { text: string; need: boolean }[] {
  const need = (a: Answer | undefined) => a === 'need' || a === 'unconfirmed';
  if (!u.other) return u.answer ? [{ text: `If it is: ${ANSWERS[u.answer].label}`, need: need(u.answer) }] : [];
  return [
    ...(u.answer ? [{ text: `If it's ${u.title}: ${ANSWERS[u.answer].label}`, need: need(u.answer) }] : []),
    ...(u.otherAnswer ? [{ text: `If it's ${u.other}: ${ANSWERS[u.otherAnswer].label}`, need: need(u.otherAnswer) }] : []),
  ];
}

function UnsureRow({ u, selected, onIs, onOther, onLocate }: { u: ShelfUnsure; selected: boolean; onIs: () => void; onOther: () => void; onLocate: (row: HTMLElement) => void }) {
  return (
    <div data-shelf-row onClick={onRow(onLocate)} style={rowStyle(selected)}>
      <Text size="sm">
        <LocateTitle title={u.title} selected={selected} onLocate={onLocate} />{' '}
        <Text span size="xs" c="dimmed">
          ({doubtText(u)}; read “{u.read}”)
        </Text>
      </Text>
      <Text size="xs">
        {ifItIs(u).map((x, i) => (
          <Text key={i} span size="xs" fw={x.need ? 700 : 500} c={x.need ? undefined : 'dimmed'}>
            {i > 0 ? ' · ' : ''}
            {x.text}
          </Text>
        ))}{' '}
        <Anchor component="button" type="button" size="xs" onClick={onIs}>
          It is
        </Anchor>
        {' · '}
        <Anchor component="button" type="button" size="xs" onClick={onOther}>
          It's another
        </Anchor>
      </Text>
    </div>
  );
}

function Section({ title, count, tone, note, empty, children }: { title: ReactNode; count: number; tone: string; note?: string; empty?: string; children: ReactNode }) {
  return (
    <Card withBorder padding="sm">
      <Group gap="xs" mb={6} wrap="nowrap">
        <Text fw={700}>{title}</Text>
        <Badge color={tone} variant="light" style={{ flexShrink: 0 }}>
          {count}
        </Badge>
      </Group>
      {note && count > 0 && (
        <Text size="xs" c="dimmed" mb={6}>
          {note}
        </Text>
      )}
      {count === 0 ? (
        <Text size="sm" c="dimmed">
          {empty}
        </Text>
      ) : (
        <Stack gap="xs">{children}</Stack>
      )}
    </Card>
  );
}

/**
 * Check a shelf (Store Mode, D147): a photo of a shelf of one console's games in, a checklist out. The phone reads
 * the spines (nothing leaves it) and checks each against Store Mode's copy of your collection, so it works with no
 * signal; a game is never called missing on a doubtful read. With a vision model on (Settings > Features) and a
 * connection, pieces of the photo also go to it, and what it reads is matched the same way. A game tapped in a list
 * shows on the photo (T-406): it zooms to the game's spines, held at the bottom of the screen while the lists scroll.
 */
export function ShelfCheckPage() {
  const queryClient = useQueryClient();
  const still = useReducedMotion();
  const [consoleKey, setConsoleKey] = useState<string | null>(remembered(LAST_CONSOLE));
  // The reading itself (the copy, the reader, the vision model, the fixes) is shared with the collection audit's shelves.
  const { canEdit, copy, model, consoles, chosen, progress, busy, failure, photos, modelTitles, modelNote, list, fixes, titles, read: readPhoto, ...reader } = useShelfReader({ consoleKey });
  const photo = photos[0] ?? null;
  const [upright, setUpright] = useState(remembered(UPRIGHT_TOO) === '1');
  const [bought, setBought] = useState<Set<string>>(new Set());
  const [fixing, setFixing] = useState<string | null>(null);
  const [located, setLocated] = useState<Located | null>(null);
  const unsure = useMemo(() => unsureLists(list?.unsure ?? []), [list]);
  // A new photo starts with the whole of it.
  useEffect(() => setLocated(null), [photo?.url]);
  // Whether the tapped game has a box on the photo (a title only the vision model read has none).
  const onPhoto = useMemo(() => (photo && located ? linesFor(photo.lines, located.reads).length > 0 : false), [photo, located]);

  const fix = async (read: string, title: string | null | undefined) => {
    setFixing(null);
    await reader.fix(read, title);
  };

  const check = (file: File | null) => readPhoto(file, upright);

  /** Shows a game on the photo (or the whole photo again, tapped twice), keeping its row in view above the photo. */
  const locate = (next: Located) => (row: HTMLElement) => {
    if (located?.id === next.id) {
      setLocated(null);
      return;
    }
    setLocated(next);
    row.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' });
  };
  const foundAt = (f: ShelfFound): Located => ({
    id: `game:${f.key}`,
    title: f.title,
    read: f.read,
    reads: f.reads,
    says: f.answer === 'own-elsewhere' && f.game.on?.length ? `You have it on ${f.game.on.join(', ')}` : ANSWERS[f.answer].label,
  });
  const unsureAt = (u: ShelfUnsure): Located => ({
    id: `unsure:${u.read}`,
    title: u.title,
    read: u.read,
    reads: u.reads ?? [u.read],
    says: `Unsure: ${doubtText(u)}${u.wanted ? '; you need it if it is' : ''}`,
  });

  const buy = useMutation({
    mutationFn: async (f: ShelfFound) => {
      try {
        await api('/purchases', { method: 'POST', json: { entryId: f.game.e } });
        return 'sent' as const;
      } catch (err) {
        if (!unreachable(err)) throw err;
        await queuePurchase({ entryId: f.game.e!, title: f.title, platform: chosen?.name ?? '' });
        return 'kept' as const;
      }
    },
    networkMode: 'always',
    onSuccess: async (how, f) => {
      setBought((s) => new Set(s).add(f.key));
      notifySuccess(how === 'sent' ? `${f.title} is in your collection.` : `${f.title} counts as bought as soon as Squirrelcade can be reached (Store Mode sends it).`, 'Bought');
      await Promise.all(['purchases', 'lookup', 'catalogs', 'wishlist'].map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
    },
    onError: (err) => notifyError(err),
  });

  const section = (title: string, items: ShelfFound[], tone: string, empty?: string) =>
    (items.length > 0 || empty) && (
      <Section title={title === 'Have it' ? <Have size={16}>{title}</Have> : title} count={items.length} tone={tone} empty={empty}>
        {items.map((f) => {
          const at = foundAt(f);
          return (
            <FoundRow
              key={f.key}
              f={f}
              canEdit={canEdit}
              bought={bought.has(f.key)}
              selected={located?.id === at.id}
              onBuy={title === 'Need it' ? () => buy.mutate(f) : undefined}
              onFix={() => setFixing(f.read)}
              onLocate={locate(at)}
            />
          );
        })}
      </Section>
    );

  const unsureSection = (title: string, items: ShelfUnsure[], tone: string, note: string) =>
    items.length > 0 && (
      <Section title={title} count={items.length} tone={tone} note={note}>
        {items.map((u) => {
          const at = unsureAt(u);
          return <UnsureRow key={u.read} u={u} selected={located?.id === at.id} onIs={() => void fix(u.read, u.title)} onOther={() => setFixing(u.read)} onLocate={locate(at)} />;
        })}
      </Section>
    );

  return (
    <Stack maw={640} mx="auto" gap="sm">
      <Group justify="space-between" align="baseline">
        <Group gap={6} wrap="nowrap">
          <Title order={2}>Check a shelf</Title>
          <HelpLink topic="store-mode" />
        </Group>
        <Anchor component={Link} to="/store" size="sm">
          Store Mode
        </Anchor>
      </Group>
      <Text size="sm" c="dimmed">
        A photo of a shelf of one console's games: this phone reads the spines and checks each against your collection. The photo stays on the phone
        {model.data?.available ? ', except pieces of it for your vision model' : ''}. A spine read only partly is unsure, never “Need it”.
      </Text>
      {canEdit && (
        <Text size="xs" c="dimmed">
          Auditing your collection? Use{' '}
          <Anchor component={Link} to="/collection/audit" size="xs">
            Stash › Collection audit
          </Anchor>
          : it ticks off the copies on each shelf and keeps your progress.
        </Text>
      )}
      {copy.error && <Alert color="red">Store Mode's answers couldn't be loaded: {errorMessage(copy.error)}</Alert>}
      <Select
        label="Console"
        placeholder={copy.isLoading ? 'Loading…' : 'Pick the shelf’s console'}
        data={consoles.map((c) => ({ value: c.key, label: c.name }))}
        value={chosen?.key ?? null}
        onChange={(v) => {
          setConsoleKey(v);
          if (v) remember(LAST_CONSOLE, v);
        }}
        searchable
        allowDeselect={false}
      />
      <Group gap="xs" grow>
        <FileButton onChange={(f) => void check(f)} accept="image/*" capture="environment">
          {(props) => (
            <Button {...props} size="md" leftSection={<IconCamera size={18} />} disabled={!chosen || busy !== null}>
              Take a photo
            </Button>
          )}
        </FileButton>
        <FileButton onChange={(f) => void check(f)} accept="image/*">
          {(props) => (
            <Button {...props} size="md" variant="default" leftSection={<IconPhoto size={18} />} disabled={!chosen || busy !== null}>
              Choose a photo
            </Button>
          )}
        </FileButton>
      </Group>
      <Checkbox
        size="sm"
        label="Also read text that isn't sideways (box fronts, a glass case): takes twice as long"
        checked={upright}
        onChange={(e) => {
          setUpright(e.currentTarget.checked);
          remember(UPRIGHT_TOO, e.currentTarget.checked ? '1' : '0');
        }}
      />
      {busy && (
        <Stack gap={4}>
          <Progress value={busy === 'model' ? 100 : progressValue(progress)} animated striped />
          <Text size="sm" c="dimmed">
            {busy === 'model' ? 'Your vision model is reading the photo too (up to a minute)…' : progressText(progress)}
          </Text>
        </Stack>
      )}
      {failure && <Alert color="red">{failure}</Alert>}
      {photo && list && (
        <>
          <Text size="sm">
            Read {photo.lines.length} lines of text{modelTitles.length > 0 ? ` and ${modelTitles.length} titles from your vision model` : ''}: {list.need.length + list.own.length + list.elsewhere.length + list.other.length} games for sure, {list.unsure.length} unsure
            {unsure.wanted.length > 0 ? ` (${unsure.wanted.length} you'd need if it's that game)` : ''}. Tap a game to see it on the photo.
          </Text>
          {modelNote && (
            <Text size="xs" c="dimmed">
              {modelNote}
            </Text>
          )}
          {section('Need it', list.need, 'green', 'None of the games read is one you need.')}
          {/* Unsure spines split by what they'd be (T-406): the ones worth a closer look come right after Need it. */}
          {unsureSection(
            "Unsure, but if it's this game you need it",
            unsure.wanted,
            'green',
            'Partly read, and the best guess (or the other game it could be) is one you need: tap it to check the spine on the photo, or scan its barcode in Store Mode, before you buy.',
          )}
          {section('Have it', list.own, 'blue')}
          {section('Have it on another console, or maybe', list.elsewhere, 'yellow')}
          {section('Not on your list', list.other, 'gray')}
          {/* A photo of a bag's games: the ones you have get that bag as their place in one go (D157). */}
          {canEdit && list.own.length > 0 && <PutInPlace key={photo.url} platformKey={chosen!.key} titles={list.own.map((f) => f.title)} />}
          {unsureSection(
            "Unsure, and you have it or don't need it either way",
            unsure.rest,
            'orange',
            'Partly read, and whichever game it is, you have it or don’t collect it: check these spines yourself, or scan their barcodes in Store Mode.',
          )}
          {/* The photo: held at the bottom of the screen while it shows a game tapped in a list, so the lists scroll above it. */}
          <div
            style={
              located
                ? { position: 'sticky', bottom: 'var(--app-shell-footer-offset, 0px)', zIndex: 5, background: 'var(--mantine-color-body)', paddingTop: 6, boxShadow: '0 -6px 12px -8px rgba(0, 0, 0, 0.35)' }
                : undefined
            }
          >
            <PhotoBoxes
              url={photo.url}
              width={photo.width}
              height={photo.height}
              lines={photo.lines}
              list={list}
              fixes={fixes}
              onTap={setFixing}
              focus={located?.reads ?? null}
              maxHeight={located ? LOCATED_HEIGHT : undefined}
            />
            {located && (
              <Group gap="xs" wrap="nowrap" justify="space-between" py={6} aria-live="polite">
                <Stack gap={0} style={{ minWidth: 0 }}>
                  <GameTitle platformKey={chosen!.key} title={located.title} fw={700} withNote={false} />
                  <Text size="xs" c="dimmed">
                    {onPhoto ? located.says : `${located.says} · your vision model read it, so it has no box on the photo`} ·{' '}
                    <Anchor component="button" type="button" size="xs" onClick={() => setFixing(located.read)}>
                      Not it?
                    </Anchor>
                  </Text>
                </Stack>
                <ActionIcon variant="default" size="lg" onClick={() => setLocated(null)} aria-label="Show the whole photo" title="Show the whole photo">
                  <IconX size={18} />
                </ActionIcon>
              </Group>
            )}
          </div>
          <Text size="xs" c="dimmed">
            Tap a game in a list to zoom the photo to its spine, or a box to say which game it is, or that it's none: the fix is remembered for the next photo. Green boxes are games you need
            (dashed: unsure, but you'd need it), blue ones games you have, yellow on another console or maybe, grey not on your list, orange dashed unsure either way, and a faint box is text read
            that named no game. Spines with no box weren't read well enough (stylized logos and very small print are the hardest), and a closer photo of part of the shelf reads more.
          </Text>
          {fixing !== null && (
            <FixSpine key={fixing} read={fixing} titles={titles} current={fixes.get(shelfReadKey(fixing))} saved={canEdit} onSave={(t) => void fix(fixing, t)} onClose={() => setFixing(null)} />
          )}
        </>
      )}
    </Stack>
  );
}
