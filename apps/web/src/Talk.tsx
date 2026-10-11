import { ActionIcon, Anchor, Button, Card, Drawer, Group, Loader, Stack, Text, Textarea, Tooltip } from '@mantine/core';
import { IconMessageCircle, IconMicrophone, IconPlayerStopFilled, IconSend } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api, errorMessage } from './api';
import { useDictation } from './dictation';
import { useCanEdit, useFeature } from './hooks';

/** A change Talk proposes (see TalkAction in apps/server/src/talk.ts), and what became of it here. */
interface TalkAction {
  kind: 'bought' | 'note' | 'exclude' | 'target' | 'open';
  platformKey: string;
  platform: string;
  title: string;
  entryId: number | null;
  text?: string;
  before?: string | null;
  major: boolean;
  /** done (with Undo), undone, asking (a big one waiting for a yes), declined, failed. */
  state?: 'done' | 'undone' | 'asking' | 'declined' | 'failed';
  /** The copy "I bought it" added, for Undo. */
  copyId?: number;
  error?: string;
}

interface Turn {
  role: 'you' | 'squirrelcade';
  text: string;
  actions?: TalkAction[];
}

interface TalkJob {
  id: string;
  state: 'reading' | 'done' | 'failed';
  reply: string;
  actions: TalkAction[];
  error: string | null;
}

const KEPT = 'squirrelcade.talk';

function keptTurns(): Turn[] {
  try {
    const kept = JSON.parse(sessionStorage.getItem(KEPT) ?? '[]') as Turn[];
    return Array.isArray(kept) ? kept.slice(-30) : [];
  } catch {
    return [];
  }
}

/** What an action says it did, or will do. */
function actionText(a: TalkAction): string {
  const game = `${a.title} (${a.platform})`;
  switch (a.kind) {
    case 'bought':
      if (a.state === 'asking') return `Add ${game} to your collection as bought today?`;
      return a.state === 'undone' ? `${game}: not bought after all` : `${game} added to your collection as bought today`;
    case 'note':
      if (a.state === 'asking') return `Your note on ${game} to be “${a.text}”?`;
      return a.state === 'undone' ? `${game}: the note is as it was` : `Your note on ${game}: “${a.text}”`;
    case 'exclude':
      return a.state === 'done' ? `${game} excluded from its checklist` : `Exclude ${game} from its checklist? It moves to the Excluded tab and stops counting, so the console can show 100%.`;
    case 'target':
      return a.state === 'done' ? `${game} is a target again` : `Make ${game} a target again? It goes back on its checklist and counts toward the console.`;
    default:
      return game;
  }
}

/**
 * Talk to Squirrelcade (D148, Settings > Features): a back-and-forth about the collection in plain words, from the
 * Talk button at the top of every page. Answers come from the AI model set up for Check a shelf, looking things up in
 * the collection; a small change it proposes (I bought it, a note) is done at once with Undo, a big one (excluding a
 * game, or bringing it back) waits for a yes. The conversation stays in this browser tab.
 */
export function TalkButton() {
  // Talk needs an AI model: with Talk or the model turned off in Settings > Features, the button goes at once.
  const talkOn = useFeature('talk');
  const modelOn = useFeature('vision');
  const on = talkOn && modelOn;
  const status = useQuery({ queryKey: ['talk', 'status', on], queryFn: () => api<{ available: boolean }>('/talk/status'), staleTime: 5 * 60_000, retry: false, enabled: on });
  const [opened, setOpened] = useState(false);
  if (!on || !status.data?.available) return null;
  return (
    <>
      <Tooltip label="Talk to Squirrelcade">
        <ActionIcon variant="subtle" color="gray" size="lg" aria-label="Talk to Squirrelcade" onClick={() => setOpened(true)}>
          <IconMessageCircle size={20} />
        </ActionIcon>
      </Tooltip>
      <Drawer opened={opened} onClose={() => setOpened(false)} position="right" title="Talk to Squirrelcade" size="md">
        <TalkPanel />
      </Drawer>
    </>
  );
}

function TalkPanel() {
  const canEdit = useCanEdit();
  const queryClient = useQueryClient();
  const [, setParams] = useSearchParams();
  const [turns, setTurns] = useState<Turn[]>(keptTurns);
  const [text, setText] = useState('');
  // The microphone (D149): the browser's own speech service writes into the box as you talk.
  const dictation = useDictation(text, setText);
  const [waiting, setWaiting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(KEPT, JSON.stringify(turns.slice(-30)));
    } catch {
      // Storage is off: the conversation lasts as long as the page.
    }
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [turns, waiting]);

  const refresh = () => Promise.all(['purchases', 'lookup', 'catalogs', 'wishlist', 'game', 'notes', 'collection', 'shelf'].map((k) => queryClient.invalidateQueries({ queryKey: [k] })));

  /** Carries out an action; returns it as it is after. */
  const run = async (a: TalkAction): Promise<TalkAction> => {
    try {
      if (a.kind === 'bought') {
        const made = await api<{ id: number }>('/purchases', { method: 'POST', json: { entryId: a.entryId } });
        return { ...a, state: 'done', copyId: made.id };
      }
      if (a.kind === 'note') {
        await api('/game/note', { method: 'PUT', json: { platformKey: a.platformKey, title: a.title, note: a.text } });
        return { ...a, state: 'done' };
      }
      if (a.kind === 'exclude' || a.kind === 'target') {
        await api(`/catalogs/entries/${a.entryId}`, { method: 'PATCH', json: { targetStatus: a.kind === 'exclude' ? 'excluded' : 'required' } });
        return { ...a, state: 'done' };
      }
      return { ...a, state: 'done' };
    } catch (err) {
      return { ...a, state: 'failed', error: errorMessage(err) };
    }
  };
  const undo = async (a: TalkAction): Promise<TalkAction> => {
    try {
      if (a.kind === 'bought' && a.copyId) await api(`/purchases/${a.copyId}`, { method: 'DELETE' });
      if (a.kind === 'note') await api('/game/note', { method: 'PUT', json: { platformKey: a.platformKey, title: a.title, note: a.before ?? null } });
      return { ...a, state: 'undone' };
    } catch (err) {
      return { ...a, error: errorMessage(err) };
    }
  };
  const change = async (turn: number, index: number, how: (a: TalkAction) => Promise<TalkAction> | TalkAction) => {
    const a = turns[turn]?.actions?.[index];
    if (!a) return;
    const next = await how(a);
    setTurns((all) => all.map((t, i) => (i === turn ? { ...t, actions: t.actions!.map((x, j) => (j === index ? next : x)) } : t)));
    await refresh();
  };

  const send = async () => {
    const said = text.trim();
    if (!said || waiting) return;
    dictation.halt();
    const asked: Turn[] = [...turns, { role: 'you', text: said }];
    setTurns(asked);
    setText('');
    setWaiting(true);
    setFailure(null);
    try {
      let job = await api<TalkJob>('/talk', { method: 'POST', json: { turns: asked.slice(-12).map((t) => ({ role: t.role, text: t.text })) } });
      const until = Date.now() + 12 * 60_000;
      while (job.state === 'reading' && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 1500));
        job = await api<TalkJob>(`/talk/${job.id}`);
      }
      if (job.state !== 'done') throw new Error(job.error ?? 'It took too long to answer.');
      // Small changes at once (with Undo); big ones wait for a yes.
      const actions = canEdit ? await Promise.all(job.actions.map((a) => (a.major ? { ...a, state: 'asking' as const } : a.kind === 'open' ? a : run(a)))) : [];
      setTurns((all) => [...all, { role: 'squirrelcade', text: job.reply, actions }]);
      setWaiting(false);
      if (actions.some((a) => a.state === 'done')) await refresh();
    } catch (err) {
      setFailure(errorMessage(err));
    } finally {
      setWaiting(false);
    }
  };

  return (
    <Stack gap="sm">
      {turns.length === 0 && (
        <Text size="sm" c="dimmed">
          Ask about your collection, or tell it what happened: “Do I have Pac-Man?”, “What's top of my wishlist for the PS3?”, “I just bought Halo 3”, “Note on Okami: the case is cracked”. Small changes happen at once with Undo; Squirrelcade asks before a big one.
        </Text>
      )}
      {turns.map((t, i) => (
        <Card key={i} padding="xs" radius="md" withBorder={t.role === 'squirrelcade'} bg={t.role === 'you' ? 'var(--mantine-color-default-hover)' : undefined} ml={t.role === 'you' ? 'xl' : 0} mr={t.role === 'you' ? 0 : 'xl'}>
          <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
            {t.text}
          </Text>
          {t.actions?.map((a, j) => (
            <Stack key={j} gap={4} mt={6}>
              <Text size="xs" c={a.state === 'failed' ? 'red' : a.state === 'undone' || a.state === 'declined' ? 'dimmed' : undefined} td={a.state === 'undone' ? 'line-through' : undefined}>
                {a.state === 'done' ? '✓ ' : ''}
                {actionText(a)}
                {a.state === 'failed' ? ` (not done: ${a.error})` : ''}
                {a.state === 'declined' ? ' (not done)' : ''}{' '}
                {a.state === 'done' && (a.kind === 'bought' || a.kind === 'note') && (
                  <Anchor component="button" type="button" size="xs" onClick={() => void change(i, j, undo)}>
                    Undo
                  </Anchor>
                )}
              </Text>
              {a.kind === 'open' && (
                <Group>
                  <Button size="compact-xs" variant="light" onClick={() => setParams((p) => { p.set('game', `${a.platformKey}|${a.title}`); return p; })}>
                    Open {a.title}
                  </Button>
                </Group>
              )}
              {a.state === 'asking' && (
                <Group gap="xs">
                  <Button size="compact-sm" color={a.kind === 'exclude' ? 'red' : 'green'} onClick={() => void change(i, j, run)}>
                    {{ exclude: 'Exclude it', target: 'Make it a target', bought: 'Yes, I bought it', note: 'Save the note', open: 'Open' }[a.kind]}
                  </Button>
                  <Button size="compact-sm" variant="default" onClick={() => void change(i, j, (x) => ({ ...x, state: 'declined' }))}>
                    Not now
                  </Button>
                </Group>
              )}
            </Stack>
          ))}
        </Card>
      ))}
      {waiting && (
        <Group gap="xs">
          <Loader size="xs" />
          <Text size="sm" c="dimmed">
            Thinking… (looking things up can take a minute)
          </Text>
        </Group>
      )}
      {failure && (
        <Text size="sm" c="red">
          {failure}
        </Text>
      )}
      <div ref={bottom} />
      <Textarea
        placeholder="Ask or tell Squirrelcade…"
        aria-label="Talk to Squirrelcade"
        autosize
        minRows={2}
        maxRows={6}
        maxLength={2000}
        value={text}
        onChange={(e) => {
          // Typing while it listens stops it, keeping every letter.
          dictation.halt();
          setText(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
      />
      {dictation.status && (
        <Text size="xs" c="dimmed" aria-live="polite">
          {dictation.status}
        </Text>
      )}
      <Group justify="space-between">
        {turns.length > 0 ? (
          <Anchor component="button" type="button" size="xs" c="dimmed" onClick={() => setTurns([])}>
            Start over
          </Anchor>
        ) : (
          <span />
        )}
        <Group gap="xs">
          <Tooltip label={dictation.listening ? 'Stop dictating' : 'Dictate'}>
            <ActionIcon
              size="lg"
              radius="xl"
              variant={dictation.listening ? 'filled' : 'light'}
              color={dictation.listening ? 'red' : undefined}
              aria-label={dictation.listening ? 'Stop dictating' : 'Dictate'}
              aria-pressed={dictation.listening}
              onClick={dictation.toggle}
            >
              {dictation.listening ? <IconPlayerStopFilled size={18} /> : <IconMicrophone size={20} />}
            </ActionIcon>
          </Tooltip>
          <Button leftSection={<IconSend size={16} />} onClick={() => void send()} loading={waiting} disabled={!text.trim()}>
            Send
          </Button>
        </Group>
      </Group>
    </Stack>
  );
}
