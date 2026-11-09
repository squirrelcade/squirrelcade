import { Alert, Anchor, Badge, Button, Card, Checkbox, FileButton, Group, Progress, Select, Stack, Text, Title } from '@mantine/core';
import { shelfReadKey } from '@squirrelcade/core';
import { IconCamera, IconPhoto } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { Acorns, Have } from '../Acorn';
import { api, errorMessage } from '../api';
import { ANSWERS } from '../choices';
import { HelpLink } from '../components';
import { GameTitle } from '../GameDrawer';
import { notifyError, notifySuccess } from '../hooks';
import { queuePurchase, unreachable } from '../offline';
import { PutInPlace } from '../PutInPlace';
import { doubtText, progressText, progressValue, type ShelfFound } from '../shelfCheck';
import { FixSpine, PhotoBoxes, remember, remembered, useShelfReader } from '../ShelfReader';

const LAST_CONSOLE = 'squirrelcade.shelfConsole';
const UPRIGHT_TOO = 'squirrelcade.shelfUpright';

function FoundRow({ f, platformKey, canEdit, bought, onBuy, onFix }: { f: ShelfFound; platformKey: string; canEdit: boolean; bought: boolean; onBuy?: () => void; onFix: () => void }) {
  const g = f.game;
  return (
    <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
      <Stack gap={0} style={{ minWidth: 0 }}>
        <GameTitle platformKey={platformKey} title={f.title} fw={600} withNote={false} />
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

/**
 * Check a shelf (Store Mode, D147): a photo of a shelf of one console's games in, a checklist out. The phone reads
 * the spines (nothing leaves it) and checks each against Store Mode's copy of your collection, so it works with no
 * signal; a game is never called missing on a doubtful read. With a vision model on (Settings > Features) and a
 * connection, pieces of the photo also go to it, and what it reads is matched the same way.
 */
export function ShelfCheckPage() {
  const queryClient = useQueryClient();
  const [consoleKey, setConsoleKey] = useState<string | null>(remembered(LAST_CONSOLE));
  // The reading itself (the copy, the reader, the vision model, the fixes) is shared with the collection audit's shelves.
  const { canEdit, copy, model, consoles, chosen, progress, busy, failure, photos, modelTitles, modelNote, list, fixes, titles, read: readPhoto, ...reader } = useShelfReader({ consoleKey });
  const photo = photos[0] ?? null;
  const [upright, setUpright] = useState(remembered(UPRIGHT_TOO) === '1');
  const [bought, setBought] = useState<Set<string>>(new Set());
  const [fixing, setFixing] = useState<string | null>(null);

  const fix = async (read: string, title: string | null | undefined) => {
    setFixing(null);
    await reader.fix(read, title);
  };

  const check = (file: File | null) => readPhoto(file, upright);

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
      <Card withBorder padding="sm">
        <Group gap="xs" mb={6}>
          <Text fw={700}>{title === 'Have it' ? <Have size={16}>{title}</Have> : title}</Text>
          <Badge color={tone} variant="light">
            {items.length}
          </Badge>
        </Group>
        {items.length === 0 ? (
          <Text size="sm" c="dimmed">
            {empty}
          </Text>
        ) : (
          <Stack gap="xs">
            {items.map((f) => (
              <FoundRow key={f.key} f={f} platformKey={chosen!.key} canEdit={canEdit} bought={bought.has(f.key)} onBuy={title === 'Need it' ? () => buy.mutate(f) : undefined} onFix={() => setFixing(f.read)} />
            ))}
          </Stack>
        )}
      </Card>
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
            Read {photo.lines.length} lines of text{modelTitles.length > 0 ? ` and ${modelTitles.length} titles from your vision model` : ''}: {list.need.length + list.own.length + list.elsewhere.length + list.other.length} games for sure, {list.unsure.length} unsure.
          </Text>
          {modelNote && (
            <Text size="xs" c="dimmed">
              {modelNote}
            </Text>
          )}
          {section('Need it', list.need, 'green', 'None of the games read is one you need.')}
          {section('Have it', list.own, 'blue')}
          {section('Have it on another console, or maybe', list.elsewhere, 'yellow')}
          {section('Not on your list', list.other, 'gray')}
          {/* A photo of a bag's games: the ones you have get that bag as their place in one go (D157). */}
          {canEdit && list.own.length > 0 && <PutInPlace key={photo.url} platformKey={chosen!.key} titles={list.own.map((f) => f.title)} />}
          {list.unsure.length > 0 && (
            <Card withBorder padding="sm">
              <Group gap="xs" mb={6}>
                <Text fw={700}>Unsure</Text>
                <Badge color="orange" variant="light">
                  {list.unsure.length}
                </Badge>
              </Group>
              <Text size="xs" c="dimmed" mb={6}>
                Best guesses from partial reads: check these spines yourself, or scan their barcodes in Store Mode.
              </Text>
              <Stack gap={4}>
                {list.unsure.map((u) => (
                  <Text key={u.title} size="sm">
                    <GameTitle platformKey={chosen!.key} title={u.title} withNote={false} />{' '}
                    <Text span size="xs" c="dimmed">
                      ({doubtText(u)}; read “{u.read}”)
                    </Text>
                    {u.answer && (
                      <Text span size="xs" fw={600}>
                        {' '}
                        If it is: {ANSWERS[u.answer].label}
                      </Text>
                    )}{' '}
                    <Anchor component="button" type="button" size="xs" onClick={() => void fix(u.read, u.title)}>
                      It is
                    </Anchor>
                    {' · '}
                    <Anchor component="button" type="button" size="xs" onClick={() => setFixing(u.read)}>
                      It's another
                    </Anchor>
                  </Text>
                ))}
              </Stack>
            </Card>
          )}
          <PhotoBoxes url={photo.url} width={photo.width} height={photo.height} lines={photo.lines} list={list} fixes={fixes} onTap={setFixing} />
          <Text size="xs" c="dimmed">
            Tap a box to say which game it is, or that it's none: the fix is remembered for the next photo. A faint box is text read that named no game; spines with no box weren't read well enough
            (stylized logos and very small print are the hardest), and a closer photo of part of the shelf reads more.
          </Text>
          {fixing !== null && (
            <FixSpine key={fixing} read={fixing} titles={titles} current={fixes.get(shelfReadKey(fixing))} saved={canEdit} onSave={(t) => void fix(fixing, t)} onClose={() => setFixing(null)} />
          )}
        </>
      )}
    </Stack>
  );
}
