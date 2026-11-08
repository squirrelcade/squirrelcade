import { Alert, Button, Divider, Group, Modal, Stack, Switch, Text, TextInput, Textarea } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCopy, IconCheck, IconRefresh } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { CopyButton } from '../Copy';
import { count, timeAgo } from '../format';
import { notifyError, notifySuccess } from '../hooks';

/** The live part of a friend (GET /api/v1/friends, D214). */
export interface LiveState {
  share: boolean;
  file: string | null;
  writtenAt: string | null;
  link: string | null;
  theirLink: string | null;
  readAt: string | null;
  checkedAt: string | null;
  error: string | null;
}

/** What reading a friend's live link came to (POST .../live/read, and the invite's result). */
export interface ReadResult {
  friendId: number;
  name: string;
  ok: boolean;
  read: boolean;
  message: string;
  games?: number;
}

/** The friend a live part is about. */
export interface LiveFriend {
  id: number;
  name: string;
  live: LiveState;
}

/** A link in short: no https://, cut at 44 characters. */
const shorten = (link: string) => {
  const bare = link.replace(/^https?:\/\//, '');
  return bare.length > 44 ? `${bare.slice(0, 41)}…` : bare;
};

/** Tells what a read came to: green when read, blue when nothing was new, red with the reason when refused. */
function tellRead(r: ReadResult) {
  if (!r.ok) notifyError(new Error(r.message), `${r.name}'s live file was refused`);
  else if (r.read) notifySuccess(r.message, `${r.name}'s live file is in`);
  else notifications.show({ color: 'blue', title: `${r.name}'s file`, message: r.message });
}

/**
 * Live link (1.4.0, D214): the two halves of sharing live with one friend, next to the hand-sent files. You share
 * live (a file in a folder that's carried to the cloud, its link, and the invite) and they share live (their link).
 */
export function LiveLink({ friend }: { friend: LiveFriend }) {
  const queryClient = useQueryClient();
  const live = friend.live;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['friends'] });
  const [link, setLink] = useState(live.link ?? '');
  const [seen, setSeen] = useState(live.link);
  const [pasting, setPasting] = useState(false);
  // The box follows what's saved (another tab, or a link the server tidied).
  if (live.link !== seen) {
    setSeen(live.link);
    setLink(live.link ?? '');
  }

  const folder = useQuery({ queryKey: ['friends', 'live'], queryFn: () => api<{ sharing: number; folder: string; writtenAt: string | null }>('/friends/live'), enabled: live.share });
  const put = useMutation({
    mutationFn: (body: { share?: boolean; link?: string | null; theirLink?: string | null }) => api(`/friends/${friend.id}/live`, { method: 'PUT', json: body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['friends', 'live'] });
      return refresh();
    },
    onError: (err) => {
      setLink(live.link ?? '');
      notifyError(err);
    },
  });
  const write = useMutation({
    mutationFn: () => api<{ written: number; unchanged: number; folder: string; files: string[] }>(`/friends/${friend.id}/live/write`, { method: 'POST' }),
    onSuccess: async (r) => {
      await refresh();
      notifySuccess(r.written > 0 ? `Written to ${r.folder}.` : 'Nothing has changed since the last time.', `${friend.name}'s live file`);
    },
    onError: (err) => notifyError(err, "The file couldn't be written"),
  });
  const read = useMutation({
    mutationFn: () => api<ReadResult>(`/friends/${friend.id}/live/read`, { method: 'POST' }),
    onSuccess: async (r) => {
      await refresh();
      tellRead(r);
    },
    onError: (err) => notifyError(err, "The file couldn't be read"),
  });
  // The invite is ready once the file is shared and its link pasted (the server says 409 until then).
  const ready = live.share && !!live.link;
  const invite = useQuery({ queryKey: ['friends', friend.id, 'invite', live.link], queryFn: () => api<{ invite: string }>(`/friends/${friend.id}/invite`), enabled: ready, retry: false });

  const saveLink = () => {
    const next = link.trim();
    if (next !== (live.link ?? '')) put.mutate({ link: next || null });
  };

  return (
    <Stack gap="xs">
      <Divider label="Live link" labelPosition="left" />
      <Text size="xs" fw={600} tt="uppercase" c="dimmed">
        You share live
      </Text>
      <Switch
        size="sm"
        label={`Share live with ${friend.name}`}
        checked={live.share}
        onChange={(e) => put.mutate({ share: e.currentTarget.checked })}
        disabled={put.isPending && put.variables?.share !== undefined}
      />
      {live.share && (
        <>
          <Group gap="xs" justify="space-between" wrap="nowrap" align="flex-start">
            <div style={{ minWidth: 0 }}>
              <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
                {live.file ? (
                  <>
                    <b>{live.file}</b>
                    {folder.data?.folder ? ` in ${folder.data.folder}` : ''}
                  </>
                ) : (
                  'Its file is written in a moment.'
                )}
              </Text>
              <Text size="xs" c="dimmed">
                {live.writtenAt ? `Written ${timeAgo(live.writtenAt)}.` : 'Not written yet.'}
              </Text>
            </div>
            <Button size="compact-xs" variant="default" leftSection={<IconRefresh size={12} />} loading={write.isPending} onClick={() => write.mutate()} style={{ flexShrink: 0 }}>
              Write now
            </Button>
          </Group>
          <TextInput
            size="xs"
            label="The file's shared link"
            description="In your cloud folder, share this file as Anyone with the link and paste its link here."
            placeholder="https://"
            value={link}
            onChange={(e) => setLink(e.currentTarget.value)}
            onBlur={saveLink}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveLink();
            }}
          />
          <Group gap="xs">
            <CopyButton value={invite.data?.invite ?? ''}>
              {({ copied, copy }) => (
                <Button size="compact-xs" variant={ready ? 'light' : 'default'} leftSection={copied ? <IconCheck size={12} /> : <IconCopy size={12} />} onClick={copy} disabled={!invite.data} loading={invite.isFetching && ready}>
                  {copied ? 'Copied' : 'Copy the invite'}
                </Button>
              )}
            </CopyButton>
            <Text size="xs" c="dimmed" style={{ flex: 1, minWidth: 180 }}>
              {ready
                ? `Send it to ${friend.name} once (email or chat). It carries your friendship's code, so send it only to them.`
                : 'The invite is ready once the file is written and its link is pasted.'}
            </Text>
          </Group>
        </>
      )}

      <Text size="xs" fw={600} tt="uppercase" c="dimmed" mt={4}>
        They share live
      </Text>
      {live.theirLink ? (
        <>
          <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
            Their link: {shorten(live.theirLink)}
          </Text>
          <Text size="xs" c="dimmed">
            {live.readAt ? `Last read ${timeAgo(live.readAt)}.` : 'Not read yet.'}
          </Text>
          {live.error && (
            <Alert color="red" p="xs" title="Their file was refused (the last good one is kept)">
              <Text size="sm">{live.error}</Text>
            </Alert>
          )}
        </>
      ) : (
        <Text size="sm" c="dimmed">
          {friend.name} hasn't shared a live link with you. When they send an invite, paste it here.
        </Text>
      )}
      <Group gap="xs">
        {live.theirLink && (
          <Button size="compact-xs" variant="default" leftSection={<IconRefresh size={12} />} loading={read.isPending} onClick={() => read.mutate()}>
            Read now
          </Button>
        )}
        <Button size="compact-xs" variant="default" onClick={() => setPasting(true)}>
          {live.theirLink ? 'Paste a new invite' : `Paste ${friend.name}'s invite`}
        </Button>
        {live.theirLink && (
          <Button size="compact-xs" variant="subtle" color="red" loading={put.isPending && put.variables?.theirLink === null} onClick={() => put.mutate({ theirLink: null })}>
            Remove the link
          </Button>
        )}
      </Group>
      <InviteModal opened={pasting} friend={friend} onClose={() => setPasting(false)} />
    </Stack>
  );
}

/**
 * Taking an invite in (POST /api/v1/friends/invite): for a friend already on the page (their card), or from the top
 * of the page for anyone (a new friend is made when it's from someone new). Shows what it came to.
 */
export function InviteModal({ opened, friend, onClose }: { opened: boolean; friend: { id: number; name: string } | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [result, setResult] = useState<{ friend: { id: number; name: string }; result: ReadResult } | null>(null);
  const [wasOpen, setWasOpen] = useState(false);
  // Empty each time it opens.
  if (opened !== wasOpen) {
    setWasOpen(opened);
    if (opened) {
      setText('');
      setName('');
      setEmail('');
      setResult(null);
    }
  }
  const take = useMutation({
    mutationFn: () => api<{ friend: { id: number; name: string }; result: ReadResult }>('/friends/invite', { method: 'POST', json: { invite: text.trim(), friendId: friend?.id, name: name.trim() || undefined, email: email.trim() || undefined } }),
    onSuccess: async (r) => {
      setResult(r);
      await queryClient.invalidateQueries({ queryKey: ['friends'] });
    },
    onError: (err) => notifyError(err, "That invite can't be used"),
  });
  const done = result !== null;
  const r = result?.result;
  return (
    <Modal opened={opened} onClose={onClose} title={friend ? `Paste ${friend.name}'s invite` : 'Add a friend from an invite'} size="lg">
      <Stack gap="sm">
        {!done && (
          <>
            <Textarea
              label="The invite"
              description={friend ? 'One line that starts with squirrelcade-invite:' : 'One line that starts with squirrelcade-invite: that a friend sent you. It adds them as a friend, or finds the friend it belongs to.'}
              placeholder="squirrelcade-invite:…"
              value={text}
              onChange={(e) => setText(e.currentTarget.value)}
              autosize
              minRows={3}
              maxRows={8}
              styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)', fontSize: 12 } }}
              data-autofocus
            />
            {!friend && (
              <Group grow align="flex-start">
                <TextInput label="Their name" description="Optional: the invite names them." value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={60} />
                <TextInput label="Their email" description="Optional." type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
              </Group>
            )}
          </>
        )}
        {r &&
          (r.ok ? (
            <Alert color="green" title={`${result!.friend.name} is in`}>
              <Text size="sm">{r.read && r.games !== undefined ? `${count(r.games)} games read. ${r.message}` : r.message} Their file is read again on the schedule in Settings › Friends.</Text>
            </Alert>
          ) : (
            <Alert color="yellow" title={`${result!.friend.name} was added, but their file was refused`}>
              <Text size="sm">{r.message}</Text>
              <Text size="sm" mt={4}>
                The link is kept, so it is tried again on schedule (or press Read now on their card).
              </Text>
            </Alert>
          ))}
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose}>
            {done ? 'Close' : 'Cancel'}
          </Button>
          {!done && (
            <Button onClick={() => take.mutate()} loading={take.isPending} disabled={!text.trim()}>
              {friend ? 'Use the invite' : 'Add the friend'}
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}
