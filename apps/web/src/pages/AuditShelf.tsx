import { Alert, Anchor, Badge, Button, Card, Checkbox, FileButton, Group, Progress, Select, Stack, Text, TextInput } from '@mantine/core';
import { shelfReadKey } from '@squirrelcade/core';
import { IconBarcode, IconCamera, IconPhoto } from '@tabler/icons-react';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { Have } from '../Acorn';
import { api } from '../api';
import { auditGroups, seenByTitle, shelfBody, unsent, type AuditSummary, type SeenCopy } from '../audit';
import { PageHeader } from '../components';
import { notifyError, useSetting } from '../hooks';
import { doubtText, progressText, progressValue, type ShelfFound } from '../shelfCheck';
import { FixSpine, PhotoBoxes, remember, remembered, useShelfReader } from '../ShelfReader';
import { AUDIT_CONSOLE, AuditBarcode, BackToAudit, useAuditAdd, useAuditRefresh } from './AuditLists';

const UPRIGHT_TOO = 'squirrelcade.shelfUpright';

/** A shelf logged in the audit: its id, console, and the place its copies get (when it has a name and that's asked). */
interface Saved {
  shelfId: number;
  platformKey: string;
  platform: string;
  name: string;
  place: boolean;
}

function Section({ label, n, color, children, note }: { label: ReactNode; n: number; color: string; children: ReactNode; note?: ReactNode }) {
  return (
    <Card withBorder padding="sm">
      <Group gap="xs" mb={6}>
        <Text fw={700}>{label}</Text>
        <Badge color={color} variant="light">
          {n}
        </Badge>
      </Group>
      {note && (
        <Text size="xs" c="dimmed" mb={6}>
          {note}
        </Text>
      )}
      <Stack gap={6}>{children}</Stack>
    </Card>
  );
}

/** A game read on the shelf: its title, what was read, and Not it? to say which game it is. */
function ReadRow({ f, sub, onFix, action }: { f: ShelfFound; sub?: ReactNode; onFix: () => void; action?: ReactNode }) {
  return (
    <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
      <Stack gap={0} style={{ minWidth: 0 }}>
        <Text size="sm" fw={600}>
          {f.title}
        </Text>
        {sub && (
          <Text size="xs" c="dimmed">
            {sub}
          </Text>
        )}
        <Text size="xs" c="dimmed" fs="italic">
          read “{f.read}”{f.fixed ? ', as you said' : ''} ·{' '}
          <Anchor component="button" type="button" size="xs" onClick={onFix}>
            {f.fixed ? 'Change' : 'Not it?'}
          </Anchor>
        </Text>
      </Stack>
      {action}
    </Group>
  );
}

/**
 * One shelf of the audit (phone first): its console (the last one remembered), a name if you like (which can become
 * its copies' place), one photo or several, read on the phone as Check a shelf reads them. Logged: the copies found are
 * ticked as seen. Not logged: each can be added as Store Mode adds it. Unsure: you say which game. Games you have on
 * another console are shown apart, never ticked.
 */
export function AuditShelf({ audit }: { audit: AuditSummary }) {
  const navigate = useNavigate();
  const refresh = useAuditRefresh();
  const placeSetting = useSetting('audit.placeFromShelf', true);
  const keepPhotos = useSetting('audit.keepPhotos', true);
  const inAudit = useMemo(() => new Set(audit.consoles.map((c) => c.key)), [audit.consoles]);
  const [consoleKey, setConsoleKey] = useState<string | null>(() => remembered(AUDIT_CONSOLE));
  const { copy, model, consoles, chosen, progress, busy, failure, photos, modelTitles, modelNote, list, fixes, titles, fix, read, clear } = useShelfReader({ consoleKey: consoleKey && inAudit.has(consoleKey) ? consoleKey : null, many: true });
  const options = consoles.filter((c) => inAudit.has(c.key));
  const [name, setName] = useState('');
  const [place, setPlace] = useState<boolean | null>(null);
  const usePlace = place ?? placeSetting;
  const [upright, setUpright] = useState(remembered(UPRIGHT_TOO) === '1');
  const [fixing, setFixing] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [logged, setLogged] = useState<SeenCopy[]>([]);
  const [added, setAdded] = useState<Set<string>>(new Set());
  // The titles sent to be ticked, the photos sent to be kept, and the shelf being logged (once, whoever asks first).
  const sent = useRef(new Set<string>());
  const uploaded = useRef(new Set<number>());
  const saving = useRef<Promise<Saved> | null>(null);
  const { add, modal } = useAuditAdd(audit);
  const groups = useMemo(() => (list ? auditGroups(list) : null), [list]);

  /** Logs the shelf: its copies read are ticked, and its games not logged are kept with it. */
  const logShelf = (): Promise<Saved> => {
    if (!saving.current) {
      if (!groups || !chosen || !list) return Promise.reject(new Error('Take a photo of the shelf first.'));
      const body = shelfBody(groups);
      const shelfName = name.trim();
      const on = chosen;
      const reads = list.reads;
      const doing = (async () => {
        const res = await api<{ shelf: { id: number }; seen: SeenCopy[]; unmatched: string[] }>(`/audit/${audit.id}/shelves`, {
          method: 'POST',
          json: { platformKey: on.key, name: shelfName, reads, seen: body.seen, notLogged: body.notLogged, ...(shelfName ? { place: usePlace } : {}) },
        });
        for (const t of body.seen) sent.current.add(t);
        const s: Saved = { shelfId: res.shelf.id, platformKey: on.key, platform: on.name, name: shelfName, place: Boolean(shelfName) && usePlace };
        setSaved(s);
        setLogged(res.seen);
        void refresh();
        return s;
      })();
      saving.current = doing.catch((err: unknown) => {
        saving.current = null;
        throw err;
      });
    }
    return saving.current;
  };
  const log = useMutation({ mutationFn: logShelf, onError: (err) => notifyError(err) });

  // Once logged, what's read as yours later (another photo, an unsure spine said to be yours) is ticked on this shelf too.
  useEffect(() => {
    if (!saved || !groups) return;
    const titles = unsent(groups, sent.current);
    if (titles.length === 0) return;
    for (const t of titles) sent.current.add(t);
    void (async () => {
      try {
        const res = await api<{ seen: SeenCopy[] }>(`/audit/${audit.id}/seen`, { method: 'POST', json: { platformKey: saved.platformKey, titles, how: 'photo', shelfId: saved.shelfId } });
        setLogged((l) => [...l, ...res.seen]);
        if (saved.place && res.seen.length > 0) await api('/places/put', { method: 'POST', json: { place: saved.name, keys: res.seen.map((s) => s.copyKey) } });
        void refresh();
      } catch (err) {
        for (const t of titles) sent.current.delete(t);
        notifyError(err);
      }
    })();
  }, [saved, groups]);

  // Once logged, each photo is kept with the shelf (made smaller there), when Settings > Collection says to keep them.
  useEffect(() => {
    if (!saved || !keepPhotos) return;
    for (const p of photos) {
      if (uploaded.current.has(p.id)) continue;
      uploaded.current.add(p.id);
      const form = new FormData();
      form.append('file', p.file, p.file.name || 'shelf.jpg');
      api(`/audit/shelves/${saved.shelfId}/photos`, { method: 'POST', body: form }).then(
        () => void refresh(),
        (err: unknown) => notifyError(err, "The shelf's photo wasn't kept"),
      );
    }
  }, [saved, photos, keepPhotos]);

  const addFound = async (f: ShelfFound) => {
    try {
      const s = await logShelf();
      // Added here: not ticked again when Store Mode's copy next says you have it.
      sent.current.add(f.title);
      add.mutate(
        { game: { platformKey: s.platformKey, platform: s.platform, title: f.title }, shelfId: s.shelfId },
        {
          onSuccess: (made) => {
            setAdded((a) => new Set(a).add(f.title));
            if (s.place) void api('/places/put', { method: 'POST', json: { place: s.name, keys: [made.key] } }).catch((err: unknown) => notifyError(err));
          },
        },
      );
    } catch (err) {
      notifyError(err);
    }
  };

  const untick = async (keys: string[]) => {
    try {
      for (const key of keys) await api(`/audit/${audit.id}/seen?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
      setLogged((l) => l.filter((s) => !keys.includes(s.copyKey)));
      void refresh();
    } catch (err) {
      notifyError(err);
    }
  };

  const nextShelf = () => {
    clear();
    setName('');
    setPlace(null);
    setSaved(null);
    setLogged([]);
    setAdded(new Set());
    sent.current = new Set();
    uploaded.current = new Set();
    saving.current = null;
    window.scrollTo({ top: 0 });
  };

  const fixSpine = (r: string, title: string | null | undefined) => {
    setFixing(null);
    void fix(r, title);
  };

  const addButton = (f: ShelfFound) =>
    added.has(f.title) ? (
      <Badge color="forest" variant="light" style={{ textTransform: 'none', flex: 'none' }}>
        Added
      </Badge>
    ) : (
      <Button size="compact-xs" variant="light" color="orange" style={{ flex: 'none' }} onClick={() => void addFound(f)} loading={add.isPending && add.variables?.game.title === f.title}>
        Add it
      </Button>
    );

  const ticks = seenByTitle(logged);
  const shelfLabel = saved ? `${saved.name || 'A shelf'} · ${saved.platform}` : 'Photograph a shelf';
  const reading = busy !== null;

  return (
    <Stack maw={640} mx="auto" gap="sm">
      <PageHeader help="collection" title={shelfLabel} description="One console's games per photo: the phone reads the spines and ticks off the copies you've logged." />
      <BackToAudit />
      {copy.error && <Alert color="red">Store Mode's answers couldn't be loaded, and the shelf is read against them.</Alert>}
      <Select
        label="Console"
        placeholder={copy.isLoading ? 'Loading…' : 'Pick the shelf’s console'}
        data={options.map((c) => ({ value: c.key, label: c.name }))}
        value={chosen?.key ?? null}
        onChange={(v) => {
          setConsoleKey(v);
          if (v) remember(AUDIT_CONSOLE, v);
        }}
        searchable
        allowDeselect={false}
        disabled={saved !== null}
      />
      {saved ? (
        saved.name && (
          <Text size="sm">
            {saved.place ? 'Place' : 'Shelf'}: <b>{saved.name}</b>
          </Text>
        )
      ) : (
        <>
          <TextInput label="Shelf name" description="Optional, for example “Office, case 3”." value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={120} />
          {name.trim() && <Checkbox size="sm" label="Make it the place of the copies found on it (Stash › Places)" checked={usePlace} onChange={(e) => setPlace(e.currentTarget.checked)} />}
        </>
      )}
      <Group gap="xs" grow>
        <FileButton onChange={(f) => void read(f, upright)} accept="image/*" capture="environment">
          {(props) => (
            <Button {...props} size="md" px="xs" leftSection={<IconCamera size={18} />} disabled={!chosen || reading}>
              {photos.length > 0 ? 'Another photo' : 'Take a photo'}
            </Button>
          )}
        </FileButton>
        <FileButton onChange={(f) => void read(f, upright)} accept="image/*">
          {(props) => (
            <Button {...props} size="md" px="xs" variant="default" leftSection={<IconPhoto size={18} />} disabled={!chosen || reading}>
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
      {reading && (
        <Stack gap={4}>
          <Progress value={busy === 'model' ? 100 : progressValue(progress)} animated striped />
          <Text size="sm" c="dimmed">
            {busy === 'model' ? 'Your vision model is reading the photo too (up to a minute)…' : progressText(progress)}
          </Text>
        </Stack>
      )}
      {failure && <Alert color="red">{failure}</Alert>}
      {list && groups && chosen && (
        <>
          <Text size="sm">
            {photos.length} {photos.length === 1 ? 'photo' : 'photos'} · {list.reads} spines read{modelTitles.length > 0 ? `, ${modelTitles.length} titles from your vision model` : ''}: {groups.logged.length} logged, {groups.notLogged.length} not logged, {groups.unsure.length} unsure.
          </Text>
          {modelNote && (
            <Text size="xs" c="dimmed">
              {modelNote}
            </Text>
          )}
          {!saved && (
            <Button size="md" color="forest" onClick={() => log.mutate()} loading={log.isPending} disabled={reading}>
              {groups.logged.length > 0 ? `Tick ${groups.logged.length} ${groups.logged.length === 1 ? 'game' : 'games'} and log the shelf` : 'Log the shelf'}
            </Button>
          )}
          {groups.notLogged.length > 0 && (
            <Section label="Not logged" n={groups.notLogged.length} color="orange" note="On the shelf, but not in Squirrelcade: Add it adds it as Store Mode does.">
              {groups.notLogged.map((f) => (
                <ReadRow key={f.key} f={f} onFix={() => setFixing(f.read)} action={addButton(f)} />
              ))}
            </Section>
          )}
          {groups.unsure.length > 0 && (
            <Section label="Unsure" n={groups.unsure.length} color="yellow" note="Spines read only partly: say which game each is, or that it's none.">
              {groups.unsure.map((u) => (
                <Stack key={u.read} gap={2}>
                  <Text size="sm">
                    “{u.read}” ·{' '}
                    <Text span size="sm" fw={600}>
                      {u.title}
                    </Text>{' '}
                    <Text span size="xs" c="dimmed">
                      ({doubtText(u)})
                    </Text>
                  </Text>
                  <Group gap={6} wrap="wrap">
                    <Button size="compact-xs" variant="default" onClick={() => fixSpine(u.read, u.title)}>
                      It's {u.title}
                    </Button>
                    {u.other && u.other !== u.title && (
                      <Button size="compact-xs" variant="default" onClick={() => fixSpine(u.read, u.other)}>
                        It's {u.other}
                      </Button>
                    )}
                    <Button size="compact-xs" variant="default" onClick={() => setFixing(u.read)}>
                      Pick
                    </Button>
                    <Button size="compact-xs" variant="subtle" color="gray" onClick={() => fixSpine(u.read, null)}>
                      None
                    </Button>
                  </Group>
                </Stack>
              ))}
            </Section>
          )}
          {saved ? (
            <Section label={<Have size={16}>Logged</Have>} n={logged.length} color="forest" note={logged.length === 1 ? '1 copy ticked as seen.' : `${logged.length} copies ticked as seen.`}>
              {ticks.length === 0 && (
                <Text size="sm" c="dimmed">
                  None of the games read is one you've logged on this console.
                </Text>
              )}
              {ticks.map((t) => (
                <Group key={t.title} justify="space-between" wrap="nowrap" gap="xs">
                  <Text size="sm">
                    {t.title}
                    {t.keys.length > 1 && (
                      <Text span size="xs" c="dimmed">
                        {' '}
                        · {t.keys.length} copies
                      </Text>
                    )}
                  </Text>
                  <Group gap={6} wrap="nowrap">
                    <Badge color="forest" variant="light" style={{ textTransform: 'none' }}>
                      ✓ seen
                    </Badge>
                    <Anchor component="button" type="button" size="xs" onClick={() => void untick(t.keys)} aria-label={`Undo the tick on ${t.title}`}>
                      Undo
                    </Anchor>
                  </Group>
                </Group>
              ))}
            </Section>
          ) : (
            groups.logged.length > 0 && (
              <Section label={<Have size={16}>Logged</Have>} n={groups.logged.length} color="forest" note="Games you've logged on this console: their copies are ticked when you log the shelf.">
                {groups.logged.map((f) => (
                  <ReadRow key={f.key} f={f} onFix={() => setFixing(f.read)} />
                ))}
              </Section>
            )
          )}
          {groups.elsewhere.length > 0 && (
            <Section label="You have it on another console" n={groups.elsewhere.length} color="gray" note="Not ticked. If the copy on this shelf is this console's, add it.">
              {groups.elsewhere.map((f) => (
                <ReadRow
                  key={f.key}
                  f={f}
                  sub={f.answer === 'own-elsewhere' && f.game.on?.length ? `You have it on ${f.game.on.join(', ')}` : f.game.m?.length ? `Maybe you have it as ${f.game.m.join(', ')} (waiting for Review)` : 'Maybe you have it'}
                  onFix={() => setFixing(f.read)}
                  action={addButton(f)}
                />
              ))}
            </Section>
          )}
          <Text size="sm">
            Spines it couldn't read:{' '}
            <Anchor component={Link} to={`/collection/audit/tick?console=${encodeURIComponent(chosen.key)}`} size="sm">
              tick them by hand
            </Anchor>{' '}
            or{' '}
            <Anchor component="button" type="button" size="sm" onClick={() => setScanning(true)}>
              scan their barcodes
            </Anchor>
            . A closer photo of part of the shelf reads more.
          </Text>
          {photos.map((p) => (
            <PhotoBoxes key={p.id} url={p.url} width={p.width} height={p.height} lines={p.lines} list={list} fixes={fixes} onTap={setFixing} />
          ))}
          <Text size="xs" c="dimmed">
            Tap a box to say which game it is, or that it's none: the fix is remembered for the next photo.
          </Text>
          {saved && (
            <Group grow>
              <Button size="md" leftSection={<IconCamera size={18} />} onClick={nextShelf}>
                Next shelf
              </Button>
              <Button size="md" variant="default" onClick={() => navigate('/collection/audit')}>
                Done
              </Button>
            </Group>
          )}
        </>
      )}
      {!list && !reading && chosen && (
        <Button variant="subtle" leftSection={<IconBarcode size={16} />} onClick={() => setScanning(true)}>
          Scan a barcode instead
        </Button>
      )}
      {model.data?.available === false && photos.length === 0 && (
        <Text size="xs" c="dimmed">
          The photo is read on this phone. With a vision model (Settings › Features), it also reads the spines the phone couldn't.
        </Text>
      )}
      {fixing !== null && <FixSpine key={fixing} read={fixing} titles={titles} current={fixes.get(shelfReadKey(fixing))} saved onSave={(t) => fixSpine(fixing, t)} onClose={() => setFixing(null)} />}
      <AuditBarcode audit={audit} opened={scanning} onClose={() => setScanning(false)} />
      {modal}
    </Stack>
  );
}
