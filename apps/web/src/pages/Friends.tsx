import { COMPLETENESS_SHORT, type Completeness } from '@squirrelcade/core';
import { ActionIcon, Alert, Anchor, Badge, Button, Card, Chip, FileButton, Group, List, Loader, Menu, Modal, Select, SimpleGrid, Stack, Table, Tabs, Text, TextInput, Textarea, Title } from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { IconArrowsExchange, IconClipboardText, IconDots, IconDownload, IconPencil, IconPlus, IconScale, IconTrash, IconUpload } from '@tabler/icons-react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { Acorns } from '../Acorn';
import { api, ApiError } from '../api';
import { CopyButton } from '../Copy';
import { PageHeader } from '../components';
import { count, date, money, timeAgo } from '../format';
import { notifyError, notifySuccess, usePageTitle, useSetting } from '../hooks';

/** A friend's file, in short (GET /api/v1/friends). */
interface FileSummary {
  from: string;
  madeAt: string;
  receivedAt: string;
  games: number;
  copies: number;
  wishes: number;
  forTrade: number;
  currency: string;
}

/** A friend (GET /api/v1/friends). */
interface Friend {
  id: number;
  name: string;
  email: string | null;
  createdAt: string;
  lastSentAt: string | null;
  file: FileSummary | null;
}

/** What a dropped or pasted file is, before it's brought in (POST /api/v1/friends/preview). */
interface Preview {
  from: string;
  madeAt: string;
  currency: string;
  games: number;
  wishes: number;
  forTrade: number;
  /** The friend whose files carry its code, if any. */
  friend: { id: number; name: string } | null;
}

/** A file on its way in: dropped or chosen, or pasted. */
type Incoming = { file: File; text?: undefined; preview: Preview } | { file?: undefined; text: string; preview: Preview };

/** A game's place on a wishlist. */
interface Want {
  rank: number | null;
  acorns: number;
}

/** One side's copies of a game in the comparison. */
interface Side {
  copies: number;
  conditions: Completeness[];
  valueCents: number | null;
}

/** A game one of you (or both) has on the console (GET /api/v1/friends/:id/compare). */
interface CompareRow {
  key: string;
  title: string;
  theirTitle: string | null;
  mine: Side | null;
  theirs: Side | null;
  theirsForTrade: boolean;
  youWant: Want | null;
  theyWant: Want | null;
}

interface Comparison {
  friend: string;
  madeAt: string;
  currency: string;
  consoles: { key: string; name: string; both: number; onlyYou: number; onlyThem: number }[];
  platformKey: string | null;
  rows: CompareRow[];
}

/** Something one side would trade, and whether the other side wants it. */
interface TradeItem {
  key: string;
  side: 'mine' | 'theirs';
  platform: string;
  title: string;
  condition: Completeness;
  valueCents: number | null;
  kind: 'sale' | 'trade' | 'spare' | 'owned';
  askingCents: number | null;
  wanted: boolean;
  want: Want | null;
  missing: boolean;
}

/** What you'd give for something: the items, their total, and how far that is from its value. */
interface Offer {
  items: TradeItem[];
  totalCents: number;
  diffPct: number;
}

interface Trades {
  friend: string;
  madeAt: string;
  currency: string;
  sameCurrency: boolean;
  margin: number;
  theyHaveYouWant: TradeItem[];
  youHaveTheyWant: TradeItem[];
  theirForTrade: number;
  yourForTrade: number;
  ideas: { get: TradeItem; give: Offer }[];
}

interface TradeFor {
  target: TradeItem;
  margin: number;
  currency: string;
  offers: Offer[];
}

/** A copy in a friend's collection, to pick for a trade (GET /api/v1/friends/:id/games). */
interface Pickable {
  key: string;
  platform: string;
  title: string;
  condition: Completeness;
  valueCents: number | null;
}

interface BroughtIn {
  friend: { id: number; name: string };
  games: number;
  wishes: number;
  forTrade: number;
}

const SHARE_FILES = { 'application/json': ['.json'], 'application/zip': ['.zip'], 'application/x-zip-compressed': ['.zip'], 'text/plain': ['.json', '.txt'] };
const KIND: Record<TradeItem['kind'], string> = { sale: 'For sale', trade: 'For trade', spare: 'Spare copy', owned: 'In their collection' };
type Tab = 'compare' | 'trades';

/** The friends (GET /api/v1/friends), shared by the menu, All friends and each friend's page. */
const useFriends = () => useQuery({ queryKey: ['friends'], queryFn: () => api<{ friends: Friend[] }>('/friends') });

/** Friends (0.56.0, D131; a menu section of its own in 0.58.0): all friends, adding one, and bringing their files in. */
export function FriendsPage() {
  const [params, setParams] = useSearchParams();
  const friends = useFriends();
  const list = friends.data?.friends ?? [];
  // The addresses before 0.58.0 (Compare and Trades were tabs here) lead to the friend's page.
  const oldTab = params.get('tab');
  if ((oldTab === 'compare' || oldTab === 'trades') && friends.data) {
    const to = list.find((f) => f.id === Number(params.get('friend'))) ?? list.find((f) => f.file);
    if (to) return <Navigate to={`/friends/${to.id}?tab=${oldTab}`} replace />;
  }
  // The add dialog is the address's (?add=1): the menu's "Add a friend" opens it.
  const adding = params.get('add') === '1';
  const setAdding = (on: boolean) =>
    setParams(
      (p) => {
        if (on) p.set('add', '1');
        else p.delete('add');
        return p;
      },
      { replace: true },
    );
  return (
    <>
      <PageHeader help="friends" title="Friends" description="Your collection next to your friends': each friend's page compares what you both have on every console, and finds trades that come out even." />
      {friends.isLoading ? <Loader /> : <FriendsTab list={list} adding={adding} setAdding={setAdding} />}
    </>
  );
}

/** One friend's page (0.58.0): their file and yours for them, and Compare and Trades as tabs. */
export function FriendPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const dateFormat = useSetting('general.dateFormat', 'us');
  const appName = useSetting('general.instanceName', 'Squirrelcade') || 'Squirrelcade';
  const friends = useFriends();
  const list = friends.data?.friends ?? [];
  const friend = list.find((f) => String(f.id) === id) ?? null;
  usePageTitle(friend?.name ?? 'Friends', appName);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const { bring, conflictModal } = useBringIn(list);
  const tab: Tab = params.get('tab') === 'trades' ? 'trades' : 'compare';
  const set = (changes: Record<string, string | null>) =>
    setParams(
      (p) => {
        for (const [k, v] of Object.entries(changes)) {
          if (v) p.set(k, v);
          else p.delete(k);
        }
        return p;
      },
      { replace: true },
    );

  if (friends.isLoading) return <Loader />;
  if (!friend)
    return (
      <Alert color="blue" title="That friend isn't here">
        <Stack gap="xs" align="flex-start">
          <Text size="sm">They may have been removed.</Text>
          <Button size="xs" variant="light" component={Link} to="/friends">
            All friends
          </Button>
        </Stack>
      </Alert>
    );

  return (
    <>
      <PageHeader
        help="friends"
        title={friend.name}
        description={
          <>
            {friend.email && <>{friend.email} · </>}
            {friend.file ? (
              <>
                Their file: {count(friend.file.games)} games, {count(friend.file.forTrade)} for trade, {count(friend.file.wishes)} on their wishlist (made {date(friend.file.madeAt, dateFormat)}).
              </>
            ) : (
              'No file from them yet.'
            )}{' '}
            {friend.lastSentAt ? `You last saved yours for them ${timeAgo(friend.lastSentAt)}.` : "You haven't saved your file for them yet."}
          </>
        }
        actions={
          <>
            <Button
              size="xs"
              variant={friend.lastSentAt ? 'default' : 'light'}
              component="a"
              href={`/api/v1/friends/${friend.id}/file`}
              download
              leftSection={<IconDownload size={14} />}
              onClick={() => window.setTimeout(() => void queryClient.invalidateQueries({ queryKey: ['friends'] }), 1500)}
            >
              Your file for {friend.name}
            </Button>
            <FileButton onChange={(file) => file && bring.mutate({ what: file, friendId: friend.id })} accept=".json,.zip,application/json,application/zip">
              {(props) => (
                <Button {...props} size="xs" variant={friend.file ? 'default' : 'light'} leftSection={<IconUpload size={14} />} loading={bring.isPending}>
                  Bring in theirs
                </Button>
              )}
            </FileButton>
            <Menu position="bottom-end">
              <Menu.Target>
                <ActionIcon variant="subtle" color="gray" aria-label={`More for ${friend.name}`}>
                  <IconDots size={18} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item leftSection={<IconPencil size={16} />} onClick={() => setEditing(true)}>
                  Edit
                </Menu.Item>
                <Menu.Item color="red" leftSection={<IconTrash size={16} />} onClick={() => setRemoving(true)}>
                  Remove
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </>
        }
      />
      {friend.file ? (
        <>
          <Tabs value={tab} onChange={(v) => set({ tab: v === 'trades' ? 'trades' : null, platform: null })} mb="md">
            <Tabs.List>
              <Tabs.Tab value="compare" leftSection={<IconScale size={16} />}>
                Compare
              </Tabs.Tab>
              <Tabs.Tab value="trades" leftSection={<IconArrowsExchange size={16} />}>
                Trades
              </Tabs.Tab>
            </Tabs.List>
          </Tabs>
          {tab === 'compare' ? (
            <CompareTab key={friend.id} friend={friend} platform={params.get('platform')} onPlatform={(p) => set({ platform: p })} />
          ) : (
            <TradesTab key={friend.id} friend={friend} />
          )}
        </>
      ) : (
        <Alert color="blue" title={`No file from ${friend.name} yet`}>
          <Text size="sm">
            Save your file for them (above) and send it any way you like; they drop it on their Friends page and send theirs back. Bring theirs in here, and their games are compared with yours on every
            console.
          </Text>
        </Alert>
      )}
      <FriendModal opened={editing} friend={friend} onClose={() => setEditing(false)} />
      <RemoveModal friend={removing ? friend : null} onClose={() => setRemoving(false)} onRemoved={() => navigate('/friends')} />
      {conflictModal}
    </>
  );
}

/**
 * Bringing a friend's file in: to a friend (forced when you said it's theirs), or making a new friend from it. A file
 * for a friend that carries another code than your files with them is asked about first (the modal returned).
 */
function useBringIn(list: Friend[], onDone?: () => void) {
  const queryClient = useQueryClient();
  const [conflict, setConflict] = useState<{ friend: Friend; file: File } | null>(null);
  const bring = useMutation({
    mutationFn: ({ what, friendId, force, name, email }: { what: File | string; friendId: number | null; force?: boolean; name?: string; email?: string }) => {
      const path = friendId === null ? '/friends/from-file' : `/friends/${friendId}/file${force ? '?force=1' : ''}`;
      const fields = { name: name ?? '', email: email ?? '' };
      if (typeof what === 'string') return api<BroughtIn>(path, { method: 'POST', json: { text: what, ...fields } });
      const form = new FormData();
      for (const [k, v] of Object.entries(fields)) form.append(k, v);
      form.append('file', what);
      return api<BroughtIn>(path, { method: 'POST', body: form });
    },
    onSuccess: async (r) => {
      onDone?.();
      setConflict(null);
      await queryClient.invalidateQueries({ queryKey: ['friends'] });
      notifySuccess(`${count(r.games)} games, ${count(r.forTrade)} for trade, ${count(r.wishes)} on their wishlist.`, `${r.friend.name}'s file is in`);
    },
    onError: (err, v) => {
      const friend = list.find((f) => f.id === v.friendId);
      if (err instanceof ApiError && err.status === 409 && friend && v.what instanceof File && !v.force) setConflict({ friend, file: v.what });
      else notifyError(err, "That file can't be brought in");
    },
  });
  const conflictModal = (
    <Modal opened={conflict !== null} onClose={() => setConflict(null)} title={conflict ? `Is it ${conflict.friend.name}'s?` : ''}>
      {conflict && (
        <Stack gap="sm">
          <Text size="sm">
            This file carries another code than your files with {conflict.friend.name}: it may be someone else's. If you each added the other by hand, that's expected, and bringing it in makes your codes agree.
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setConflict(null)}>
              Cancel
            </Button>
            <Button onClick={() => bring.mutate({ what: conflict.file, friendId: conflict.friend.id, force: true })} loading={bring.isPending}>
              It's {conflict.friend.name}'s: bring it in
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
  return { bring, conflictModal };
}

// ---- Friends ----

/** All friends: adding one, your file for each, and bringing theirs in (dropped, chosen or pasted). */
function FriendsTab({ list, adding, setAdding }: { list: Friend[]; adding: boolean; setAdding: (on: boolean) => void }) {
  const queryClient = useQueryClient();
  const dateFormat = useSetting('general.dateFormat', 'us');
  const [editing, setEditing] = useState<Friend | null>(null);
  const [removing, setRemoving] = useState<Friend | null>(null);
  const [pasting, setPasting] = useState(false);
  const [naming, setNaming] = useState(false);
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const { bring, conflictModal } = useBringIn(list, () => setIncoming(null));
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['friends'] });
  // How your files name you: Settings › Friends' name, else this Squirrelcade's (as the server makes them).
  const chosenName = useSetting('friends.myName', '');
  const instanceName = useSetting('general.instanceName', '');
  const myName = chosenName.trim() || instanceName.trim() || 'A Squirrelcade';

  const preview = useMutation({
    mutationFn: (what: File | string) => {
      if (typeof what === 'string') return api<Preview>('/friends/preview', { method: 'POST', json: { text: what } });
      const form = new FormData();
      form.append('file', what);
      return api<Preview>('/friends/preview', { method: 'POST', body: form });
    },
    onSuccess: (p, what) => {
      setPasting(false);
      setIncoming(typeof what === 'string' ? { text: what, preview: p } : { file: what, preview: p });
    },
    onError: (err) => notifyError(err, "That file can't be brought in"),
  });

  return (
    <Stack gap="md">
      {list.length === 0 && (
        <Card withBorder padding="lg">
          <Title order={4} mb="xs">
            How it works
          </Title>
          <List type="ordered" spacing={6} size="sm">
            <List.Item>Add a friend who has Squirrelcade too, and save your file for them.</List.Item>
            <List.Item>Send it to them any way you like: by email, in a message, on a USB stick. They drop it on their Friends page, which adds you as their friend, and send theirs back.</List.Item>
            <List.Item>Drop theirs here. Compare shows what each of you has on every console, and Trades finds swaps that come out even.</List.Item>
          </List>
          <Text size="sm" c="dimmed" mt="sm">
            What your file shares is up to you (Settings › Friends). It never has what you paid, your notes, where your copies are kept, loans or what you played.
          </Text>
        </Card>
      )}
      <Dropzone onDrop={(files) => files[0] && preview.mutate(files[0])} loading={preview.isPending} accept={SHARE_FILES} maxFiles={1}>
        <Group justify="center" gap="lg" mih={84} style={{ pointerEvents: 'none' }}>
          <IconUpload size={32} stroke={1.5} />
          <div>
            <Text>Drop a friend's file here (the .json, or a zip with it), or click to choose it</Text>
            <Text size="sm" c="dimmed">
              A file from someone new adds them as a friend. You'll see whose it is before anything changes.
            </Text>
          </div>
        </Group>
      </Dropzone>
      <Group gap="xs">
        <Button leftSection={<IconPlus size={16} />} onClick={() => setAdding(true)}>
          Add a friend
        </Button>
        <Button variant="default" leftSection={<IconClipboardText size={16} />} onClick={() => setPasting(true)}>
          Paste a friend's file
        </Button>
      </Group>
      <Text size="sm" c="dimmed">
        Your files name you <b>{myName}</b>
        {chosenName.trim() ? '.' : ", this Squirrelcade's name."}{' '}
        <Anchor component="button" size="sm" onClick={() => setNaming(true)}>
          Change your name
        </Anchor>{' '}
        ·{' '}
        <Anchor component={Link} to="/settings/friends" size="sm">
          What your files share
        </Anchor>
      </Text>

      {list.length > 0 && (
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          {list.map((f) => (
            <Card key={f.id} withBorder padding="md">
              <Group justify="space-between" align="flex-start" wrap="nowrap">
                <div style={{ minWidth: 0 }}>
                  <Title order={4}>
                    <Anchor component={Link} to={`/friends/${f.id}`} inherit underline="hover" c="inherit">
                      {f.name}
                    </Anchor>
                  </Title>
                  {f.email && (
                    <Text size="sm" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
                      {f.email}
                    </Text>
                  )}
                </div>
                <Menu position="bottom-end">
                  <Menu.Target>
                    <ActionIcon variant="subtle" color="gray" aria-label={`More for ${f.name}`}>
                      <IconDots size={18} />
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item leftSection={<IconPencil size={16} />} onClick={() => setEditing(f)}>
                      Edit
                    </Menu.Item>
                    <Menu.Item color="red" leftSection={<IconTrash size={16} />} onClick={() => setRemoving(f)}>
                      Remove
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              </Group>
              <Stack gap={2} mt="xs">
                <Text size="sm">
                  {f.file ? (
                    <>
                      Their file: {count(f.file.games)} games, {count(f.file.forTrade)} for trade, {count(f.file.wishes)} on their wishlist (made {date(f.file.madeAt, dateFormat)})
                    </>
                  ) : (
                    'No file from them yet.'
                  )}
                </Text>
                <Text size="sm" c="dimmed">
                  {f.lastSentAt ? `You last saved yours for them ${timeAgo(f.lastSentAt)}.` : "You haven't saved your file for them yet."}
                </Text>
              </Stack>
              <Group gap="xs" mt="sm">
                <Button
                  size="xs"
                  variant={f.lastSentAt ? 'default' : 'light'}
                  component="a"
                  href={`/api/v1/friends/${f.id}/file`}
                  download
                  leftSection={<IconDownload size={14} />}
                  onClick={() => window.setTimeout(() => void refresh(), 1500)}
                >
                  Your file for {f.name}
                </Button>
                <FileButton onChange={(file) => file && bring.mutate({ what: file, friendId: f.id })} accept=".json,.zip,application/json,application/zip">
                  {(props) => (
                    <Button {...props} size="xs" variant={f.file ? 'default' : 'light'} leftSection={<IconUpload size={14} />} loading={bring.isPending && bring.variables?.friendId === f.id}>
                      Bring in theirs
                    </Button>
                  )}
                </FileButton>
                {f.file && (
                  <>
                    <Button size="xs" variant="light" component={Link} to={`/friends/${f.id}`}>
                      Compare
                    </Button>
                    <Button size="xs" variant="light" component={Link} to={`/friends/${f.id}?tab=trades`}>
                      Trades
                    </Button>
                  </>
                )}
              </Group>
            </Card>
          ))}
        </SimpleGrid>
      )}

      <FriendModal opened={adding || editing !== null} friend={editing} onClose={() => {
          setAdding(false);
          setEditing(null);
        }} />
      <RemoveModal friend={removing} onClose={() => setRemoving(null)} />
      <NameModal opened={naming} name={chosenName} onClose={() => setNaming(false)} />
      <PasteModal opened={pasting} onClose={() => setPasting(false)} onRead={(text) => preview.mutate(text)} reading={preview.isPending} />
      {incoming && <IncomingModal incoming={incoming} list={list} onClose={() => setIncoming(null)} onBring={(to) => bring.mutate({ what: incoming.file ?? incoming.text, ...to })} bringing={bring.isPending} />}
      {conflictModal}
    </Stack>
  );
}

/** Adding a friend, or changing one's name or email. */
function FriendModal({ opened, friend, onClose }: { opened: boolean; friend: Friend | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [shownFor, setShownFor] = useState<number | null | undefined>(undefined);
  // Filled in each time it opens, from the friend being changed (or empty for a new one).
  const key = opened ? (friend?.id ?? null) : undefined;
  if (key !== shownFor) {
    setShownFor(key);
    setName(friend?.name ?? '');
    setEmail(friend?.email ?? '');
  }
  const save = useMutation({
    mutationFn: () => (friend ? api(`/friends/${friend.id}`, { method: 'PUT', json: { name, email } }) : api<{ name: string }>('/friends', { method: 'POST', json: { name, email } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['friends'] });
      if (!friend) notifySuccess(`Next, save your file for ${name.trim()} and send it to them.`, `${name.trim()} added`);
      onClose();
    },
    onError: (err) => notifyError(err),
  });
  return (
    <Modal opened={opened} onClose={onClose} title={friend ? `Change ${friend.name}` : 'Add a friend'}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Stack gap="sm">
          <TextInput label="Name" value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={60} required data-autofocus />
          <TextInput label="Email" description="Optional, for sending them your file by email later on." type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending} disabled={!name.trim()}>
              {friend ? 'Save' : 'Add'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function RemoveModal({ friend, onClose, onRemoved }: { friend: Friend | null; onClose: () => void; onRemoved?: () => void }) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: number) => api(`/friends/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      onRemoved?.();
      await queryClient.invalidateQueries({ queryKey: ['friends'] });
      onClose();
    },
    onError: (err) => notifyError(err),
  });
  return (
    <Modal opened={friend !== null} onClose={onClose} title={friend ? `Remove ${friend.name}?` : ''}>
      {friend && (
        <Stack gap="sm">
          <Text size="sm">Their file goes too, and Squirrelcade stops comparing your collection with theirs. They keep the files you sent them until they remove you.</Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button color="red" onClick={() => remove.mutate(friend.id)} loading={remove.isPending}>
              Remove {friend.name}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

/** The name your files give you (Settings › Friends › Your name in what you share), changed from the page. */
function NameModal({ opened, name, onClose }: { opened: boolean; name: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(name);
  const [wasOpen, setWasOpen] = useState(false);
  // Filled in with the saved name each time it opens.
  if (opened !== wasOpen) {
    setWasOpen(opened);
    if (opened) setValue(name);
  }
  const save = useMutation({
    mutationFn: () => api('/settings', { method: 'PUT', json: { changes: { 'friends.myName': value.trim() } } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
      onClose();
    },
    onError: (err) => notifyError(err),
  });
  return (
    <Modal opened={opened} onClose={onClose} title="Your name in your files">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Stack gap="sm">
          <TextInput
            label="Your name"
            description="How your friends' Squirrelcades name you. Empty: this Squirrelcade's name (Settings › General)."
            value={value}
            onChange={(e) => setValue(e.currentTarget.value)}
            maxLength={60}
            data-autofocus
          />
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              Save
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

/** Pasting a file's text, for one that arrived in an email or a message as text. */
function PasteModal({ opened, onClose, onRead, reading }: { opened: boolean; onClose: () => void; onRead: (text: string) => void; reading: boolean }) {
  const [text, setText] = useState('');
  return (
    <Modal opened={opened} onClose={onClose} title="Paste a friend's file" size="lg">
      <Stack gap="sm">
        <Textarea
          label="The file's text"
          description='Everything from the first { to the last }. It starts with {"format":"squirrelcade-friend".'
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          autosize
          minRows={6}
          maxRows={14}
          styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)', fontSize: 12 } }}
          data-autofocus
        />
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onRead(text)} loading={reading} disabled={!text.trim()}>
            Read it
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** A dropped, chosen or pasted file before it's brought in: whose it is, and what's in it. */
function IncomingModal({
  incoming,
  list,
  onClose,
  onBring,
  bringing,
}: {
  incoming: Incoming;
  list: Friend[];
  onClose: () => void;
  onBring: (to: { friendId: number | null; force?: boolean; name?: string; email?: string }) => void;
  bringing: boolean;
}) {
  const dateFormat = useSetting('general.dateFormat', 'us');
  const p = incoming.preview;
  // A file from someone new, unless a friend has the name it's from (each of you added the other by hand).
  const sameName = list.find((f) => f.name.toLowerCase() === p.from.toLowerCase());
  const [whose, setWhose] = useState<string>(sameName ? String(sameName.id) : 'new');
  const [name, setName] = useState(p.from);
  const [email, setEmail] = useState('');
  const existing = list.find((f) => String(f.id) === whose);
  const known = p.friend;
  const what = (
    <Text size="sm">
      Made {date(p.madeAt, dateFormat)}: {count(p.games)} games, {count(p.forTrade)} for trade, {count(p.wishes)} on their wishlist.
    </Text>
  );
  return (
    <Modal opened onClose={onClose} title={known ? `${known.name}'s file` : `A file from ${p.from}`}>
      {known ? (
        <Stack gap="sm">
          {what}
          <Text size="sm" c="dimmed">
            It replaces the file you have from them.
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => onBring({ friendId: known.id })} loading={bringing}>
              Bring it in
            </Button>
          </Group>
        </Stack>
      ) : (
        <Stack gap="sm">
          {what}
          {list.length > 0 && (
            <Select
              label="Whose is it?"
              data={[{ value: 'new', label: 'Someone new: add them as a friend' }, ...list.map((f) => ({ value: String(f.id), label: f.name }))]}
              value={whose}
              onChange={(v) => setWhose(v ?? 'new')}
              allowDeselect={false}
            />
          )}
          {existing ? (
            <Text size="sm" c="dimmed">
              Its code differs from your files with {existing.name}, as when you each added the other by hand. Bringing it in makes your codes agree.
            </Text>
          ) : (
            <>
              <TextInput label="Their name" value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={60} required />
              <TextInput label="Their email" description="Optional." type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
            </>
          )}
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            {existing ? (
              <Button onClick={() => onBring({ friendId: existing.id, force: true })} loading={bringing}>
                Bring it in as {existing.name}'s
              </Button>
            ) : (
              <Button onClick={() => onBring({ friendId: null, name, email })} loading={bringing} disabled={!name.trim()}>
                Add {name.trim() || 'them'} and bring it in
              </Button>
            )}
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

// ---- Compare ----

type Show = 'all' | 'both' | 'you' | 'them';
const PAGE = 150;

/** Your games and a friend's on one console at a time: both of you, only you, only them. */
function CompareTab({ friend, platform, onPlatform }: { friend: Friend; platform: string | null; onPlatform: (key: string) => void }) {
  const mine = useSetting('general.currency', 'USD');
  const [show, setShow] = useState<Show>('all');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const cmp = useQuery({
    queryKey: ['friends', friend.id, 'compare', platform],
    queryFn: () => api<Comparison>(`/friends/${friend.id}/compare${platform ? `?platform=${encodeURIComponent(platform)}` : ''}`),
    placeholderData: keepPreviousData,
  });
  if (cmp.isError) return <Alert color="red">{cmp.error.message}</Alert>;
  if (!cmp.data) return <Loader />;
  const d = cmp.data;
  const here = d.consoles.find((c) => c.key === d.platformKey);
  const words = search.trim().toLowerCase();
  const rows = d.rows.filter(
    (r) =>
      (show === 'all' || (show === 'both' ? r.mine && r.theirs : show === 'you' ? r.mine && !r.theirs : !r.mine && r.theirs)) &&
      (!words || r.title.toLowerCase().includes(words) || (r.theirTitle ?? '').toLowerCase().includes(words)),
  );

  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        Games count as the same by their PriceCharting entry, or by title on the same console.
      </Text>
      <Group gap="sm" align="flex-end" wrap="wrap">
        <Select
          label="Console"
          searchable
          data={d.consoles.map((c) => ({ value: c.key, label: `${c.name} (${count(c.both + c.onlyYou + c.onlyThem)})` }))}
          value={d.platformKey}
          onChange={(v) => {
            if (!v) return;
            setLimit(PAGE);
            onPlatform(v);
          }}
          allowDeselect={false}
          w={280}
          maw="100%"
        />
        <TextInput label="Find a game" value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={220} maw="100%" />
      </Group>
      {/* Light chips: a filled one's white text is too faint on the theme's green (Chip has no autoContrast). */}
      {here && (
        <Chip.Group multiple={false} value={show} onChange={(v) => setShow(v as Show)}>
          <Group gap="xs">
            <Chip variant="light" value="all">All {count(here.both + here.onlyYou + here.onlyThem)}</Chip>
            <Chip variant="light" value="both">Both {count(here.both)}</Chip>
            <Chip variant="light" value="you">Only you {count(here.onlyYou)}</Chip>
            <Chip variant="light" value="them">
              Only {friend.name} {count(here.onlyThem)}
            </Chip>
          </Group>
        </Chip.Group>
      )}
      {rows.length === 0 ? (
        <Text size="sm" c="dimmed">
          No games here.
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={640}>
          <Table striped highlightOnHover verticalSpacing={6}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Game</Table.Th>
                <Table.Th>You</Table.Th>
                <Table.Th>{friend.name}</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.slice(0, limit).map((r) => (
                <Table.Tr key={r.key}>
                  <Table.Td>
                    <Text size="sm">{r.title}</Text>
                    {r.theirTitle && r.theirTitle !== r.title && (
                      <Text size="xs" c="dimmed">
                        Theirs: {r.theirTitle}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <SideCell side={r.mine} currency={mine} />
                  </Table.Td>
                  <Table.Td>
                    <SideCell side={r.theirs} currency={d.currency} />
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4}>
                      {r.theirsForTrade && (
                        <Badge color="teal" variant="light" style={{ textTransform: 'none' }}>
                          They'd trade it
                        </Badge>
                      )}
                      {r.youWant && <WantBadge want={r.youWant} whose="your" />}
                      {r.theyWant && <WantBadge want={r.theyWant} whose="their" />}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      {rows.length > limit && (
        <Button variant="default" onClick={() => setLimit(limit + PAGE)} style={{ alignSelf: 'flex-start' }}>
          Show {count(Math.min(PAGE, rows.length - limit))} more of {count(rows.length - limit)}
        </Button>
      )}
    </Stack>
  );
}

/** One side's copies of a game: how many, their conditions, and the best one's value. */
function SideCell({ side, currency }: { side: Side | null; currency: string }) {
  if (!side) return <Text c="dimmed">—</Text>;
  const conditions = [...new Set(side.conditions)].map((c) => COMPLETENESS_SHORT[c] ?? c).join(', ');
  return (
    <>
      <Text size="sm">
        {side.copies > 1 ? `${side.copies} copies: ` : ''}
        {conditions}
      </Text>
      {side.valueCents !== null && (
        <Text size="xs" c="dimmed">
          {money(side.valueCents, currency)}
        </Text>
      )}
    </>
  );
}

function WantBadge({ want, whose }: { want: Want; whose: 'your' | 'their' }) {
  return (
    <Badge color={whose === 'your' ? 'yellow' : 'grape'} variant="light" style={{ textTransform: 'none' }}>
      On {whose} wishlist{want.rank ? ` #${want.rank}` : ''} · <Acorns n={want.acorns} size={10} />
    </Badge>
  );
}

// ---- Trades ----

/** Trades that come out even, what each side would trade that the other wants, and offers for any game picked. */
function TradesTab({ friend }: { friend: Friend }) {
  const mine = useSetting('general.currency', 'USD');
  const [pick, setPick] = useState<string | null>(null);
  const trades = useQuery({ queryKey: ['friends', friend.id, 'trades'], queryFn: () => api<Trades>(`/friends/${friend.id}/trades`) });
  const games = useQuery({ queryKey: ['friends', friend.id, 'games'], queryFn: () => api<{ games: Pickable[] }>(`/friends/${friend.id}/games`) });
  const forIt = useQuery({
    queryKey: ['friends', friend.id, 'trade-for', pick],
    queryFn: () => api<TradeFor>(`/friends/${friend.id}/trade-for?item=${encodeURIComponent(pick ?? '')}`),
    enabled: pick !== null,
  });
  if (trades.isError) return <Alert color="red">{trades.error.message}</Alert>;
  if (!trades.data) return <Loader />;
  const t = trades.data;
  const theirs = t.currency;
  // Their file has no values at all (they don't share them): nothing can be balanced.
  const theirGames = games.data?.games ?? [];
  const noValues = theirGames.length > 0 && theirGames.every((g) => g.valueCents === null);
  const choose = (key: string) => {
    setPick(key);
    document.getElementById('pick-a-game')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <Stack gap="lg">
      {!t.sameCurrency && (
        <Alert color="yellow" title="Different currencies">
          {friend.name}'s values are in {theirs} and yours in {mine}, so trades are balanced as if they were the same.
        </Alert>
      )}
      {noValues && (
        <Alert color="yellow" title="No values in their file">
          {friend.name} doesn't share what their games are worth, so trades can't be balanced. They can share values in Settings › Friends.
        </Alert>
      )}

      <section>
        <Title order={4}>Even trades</Title>
        <Text size="sm" c="dimmed" mb="sm">
          Something of theirs you want for something of yours worth about the same (within {t.margin}%, Settings › Friends), what they want first.
        </Text>
        {t.ideas.length === 0 ? (
          <Text size="sm" c="dimmed">
            None yet. Trades come from what each of you would trade: copies marked for sale or trade (Acorns › For sale), and spare copies. You can still pick any game of theirs below.
          </Text>
        ) : (
          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="sm">
            {t.ideas.map((idea) => (
              <Card key={`${idea.get.key}-${idea.give.items.map((i) => i.key).join('+')}`} withBorder padding="sm">
                <TradeCard friend={friend.name} get={idea.get} give={idea.give} theirs={theirs} mine={mine} />
              </Card>
            ))}
          </SimpleGrid>
        )}
      </section>

      <section id="pick-a-game" style={{ scrollMarginTop: 80 }}>
        <Title order={4}>Pick one of their games</Title>
        <Text size="sm" c="dimmed" mb="sm">
          Any game in {friend.name}'s collection, even one they didn't mark for trade: what of yours evens it out, one game or a few.
        </Text>
        <Select
          placeholder={games.isLoading ? 'Loading their games…' : 'Find a game of theirs'}
          searchable
          clearable
          limit={60}
          nothingFoundMessage="No game of theirs by that name"
          data={theirGames.map((g) => ({ value: g.key, label: `${g.title} · ${g.platform} · ${COMPLETENESS_SHORT[g.condition] ?? g.condition}${g.valueCents !== null ? ` · ${money(g.valueCents, theirs)}` : ''}` }))}
          value={pick && pick.startsWith('c:') ? pick : null}
          onChange={setPick}
          maw={560}
          mb="sm"
        />
        {pick && forIt.isLoading && <Loader size="sm" />}
        {forIt.isError && <Alert color="red">{forIt.error.message}</Alert>}
        {pick && forIt.data && (
          <Stack gap="xs">
            <ItemLine item={forIt.data.target} currency={theirs} />
            {forIt.data.target.valueCents === null ? (
              <Text size="sm" c="dimmed">
                Their file has no value for it, so there's nothing to balance against.
              </Text>
            ) : forIt.data.offers.length === 0 ? (
              <Text size="sm" c="dimmed">
                Nothing you'd trade adds up to it (within {forIt.data.margin}%). Mark more copies for trade, or widen the margin in Settings › Friends.
              </Text>
            ) : (
              <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="sm">
                {forIt.data.offers.map((o) => (
                  <Card key={o.items.map((i) => i.key).join('+')} withBorder padding="sm">
                    <Text size="xs" tt="uppercase" fw={600} c="dimmed" mb={4}>
                      You give
                    </Text>
                    <Stack gap={6}>
                      {o.items.map((i) => (
                        <ItemLine key={i.key} item={i} currency={mine} />
                      ))}
                    </Stack>
                    <TradeFooter friend={friend.name} get={forIt.data.target} give={o} theirs={theirs} mine={mine} />
                  </Card>
                ))}
              </SimpleGrid>
            )}
          </Stack>
        )}
      </section>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        <section>
          <Title order={4}>They'd trade, you want</Title>
          <Text size="sm" c="dimmed" mb="sm">
            {count(t.theirForTrade)} of theirs are for trade. These are on your wishlist or missing from your collection.
          </Text>
          <ItemList items={t.theyHaveYouWant} currency={theirs} empty="Nothing they'd trade is on your wishlist or missing from your collection." onPick={choose} />
        </section>
        <section>
          <Title order={4}>You'd trade, they want</Title>
          <Text size="sm" c="dimmed" mb="sm">
            {count(t.yourForTrade)} of yours are for trade. These are on their wishlist or missing from their collection.
          </Text>
          <ItemList items={t.youHaveTheyWant} currency={mine} empty="Nothing you'd trade is on their wishlist or missing from their collection." />
        </section>
      </SimpleGrid>
    </Stack>
  );
}

/** A trade: what you get, what you give, and how close their values are. */
function TradeCard({ friend, get, give, theirs, mine }: { friend: string; get: TradeItem; give: Offer; theirs: string; mine: string }) {
  return (
    <>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
        <div style={{ minWidth: 0 }}>
          <Text size="xs" tt="uppercase" fw={600} c="dimmed" mb={4}>
            You get
          </Text>
          <ItemLine item={get} currency={theirs} />
        </div>
        <div style={{ minWidth: 0 }}>
          <Text size="xs" tt="uppercase" fw={600} c="dimmed" mb={4}>
            You give
          </Text>
          <Stack gap={6}>
            {give.items.map((i) => (
              <ItemLine key={i.key} item={i} currency={mine} />
            ))}
          </Stack>
        </div>
      </SimpleGrid>
      <TradeFooter friend={friend} get={get} give={give} theirs={theirs} mine={mine} />
    </>
  );
}

/** How close a trade's two sides are, and the trade as a message to send the friend. */
function TradeFooter({ friend, get, give, theirs, mine }: { friend: string; get: TradeItem; give: Offer; theirs: string; mine: string }) {
  return (
    <Group justify="space-between" gap="xs" mt={6} wrap="wrap">
      <Text size="xs" c="dimmed">
        {balance(get.valueCents ?? 0, give, theirs, mine)}
      </Text>
      <CopyButton value={tradeMessage(friend, get, give, theirs, mine)}>
        {({ copied, copy }) => (
          <Button size="compact-xs" variant="subtle" onClick={copy}>
            {copied ? 'Copied' : 'Copy as a message'}
          </Button>
        )}
      </CopyButton>
    </Group>
  );
}

/** "Hi Sam! Would you trade your Fable II (Xbox 360, CIB) for my Halo 3 (Xbox 360, Loose)? ..." */
function tradeMessage(friend: string, get: TradeItem, give: Offer, theirs: string, mine: string): string {
  const named = (i: TradeItem) => `${i.title} (${i.platform}, ${COMPLETENESS_SHORT[i.condition] ?? i.condition})`;
  const mineNamed = give.items.map(named);
  const list = mineNamed.length > 1 ? `${mineNamed.slice(0, -1).join(', ')} and ${mineNamed[mineNamed.length - 1]}` : (mineNamed[0] ?? '');
  const values = get.valueCents !== null ? ` On PriceCharting, that's ${money(get.valueCents, theirs)} for ${money(give.totalCents, mine)}.` : '';
  return `Hi ${friend}! Would you trade your ${named(get)} for my ${list}?${values}`;
}

/** "$13.00 for $12.00: you give 7.7% less." */
function balance(targetCents: number, offer: Offer, theirs: string, mine: string): string {
  const pct = Math.abs(offer.diffPct);
  const how = offer.diffPct === 0 ? 'exactly even' : offer.diffPct > 0 ? `you give ${pct}% more` : `you give ${pct}% less`;
  return `${money(targetCents, theirs)} for ${money(offer.totalCents, mine)}: ${how}.`;
}

/** A game to trade: its title, console, condition and value, and why the other side would want it. */
function ItemLine({ item, currency }: { item: TradeItem; currency: string }) {
  const you = item.side === 'theirs';
  const badges: ReactNode[] = [];
  if (item.want) badges.push(<WantBadge key="want" want={item.want} whose={you ? 'your' : 'their'} />);
  if (item.missing)
    badges.push(
      <Badge key="missing" color="blue" variant="light" style={{ textTransform: 'none' }}>
        {you ? "You don't have it" : "They don't have it"}
      </Badge>,
    );
  if (item.kind !== 'owned')
    badges.push(
      <Badge key="kind" color="gray" variant="light" style={{ textTransform: 'none' }}>
        {KIND[item.kind]}
      </Badge>,
    );
  return (
    <div style={{ minWidth: 0 }}>
      <Text size="sm" fw={500}>
        {item.title}
      </Text>
      <Text size="xs" c="dimmed">
        {[item.platform, COMPLETENESS_SHORT[item.condition] ?? item.condition, item.valueCents !== null ? money(item.valueCents, currency) : null, item.askingCents !== null ? `asking ${money(item.askingCents, currency)}` : null]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      {badges.length > 0 && (
        <Group gap={4} mt={2}>
          {badges}
        </Group>
      )}
    </div>
  );
}

function ItemList({ items, currency, empty, onPick }: { items: TradeItem[]; currency: string; empty: string; onPick?: (key: string) => void }) {
  if (items.length === 0)
    return (
      <Text size="sm" c="dimmed">
        {empty}
      </Text>
    );
  return (
    <Stack gap="xs">
      {items.map((i) => (
        <Group key={i.key} justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
          <ItemLine item={i} currency={currency} />
          {onPick && i.valueCents !== null && (
            <Button size="compact-xs" variant="subtle" onClick={() => onPick(i.key)} style={{ flexShrink: 0 }}>
              Even it out
            </Button>
          )}
        </Group>
      ))}
    </Stack>
  );
}
