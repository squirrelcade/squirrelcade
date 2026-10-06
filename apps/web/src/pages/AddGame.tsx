import { KNOWN_PLATFORMS, normalizeTitle } from '@squirrelcade/core';
import { Alert, Anchor, Autocomplete, Badge, Button, Card, Group, NumberInput, Select, Stack, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconArrowLeft, IconCheck, IconPlus } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { StashMark } from '../Acorn';
import { api } from '../api';
import { PageHeader } from '../components';
import { CONDITIONS, TOUCHED, useFromPriceCharting } from '../CopyDetails';
import { overGoalNote } from '../Goal';
import { notifyError, notifySuccess, useSetting } from '../hooks';

/** A title for what's typed (GET /api/v1/collection/add/suggest): where it's known from, and copies you have of it. */
interface Suggestion {
  title: string;
  sources: ('collection' | 'catalog' | 'igdb')[];
  owned: number;
  released: string | null;
}

/** The console last added to, so a run of games for one console doesn't ask each time. */
const LAST_CONSOLE = 'squirrelcade:add-console';
const remembered = () => {
  try {
    return localStorage.getItem(LAST_CONSOLE) ?? '';
  } catch {
    return '';
  }
};

/**
 * Add a game (0.60.0): a copy typed in by hand, for anyone without an export to bring in, or for a game just bought. The
 * console, then the title (matched to the console's catalog, IGDB's data when it's set up, and what you have), then the
 * copy: its condition, what you paid, when, and notes. Its value stays empty until an export or PriceCharting gives one.
 */
export function AddGamePage() {
  const queryClient = useQueryClient();
  const currency = useSetting('general.currency', 'USD');
  const usual = useSetting('collection.boughtCondition', 'complete');
  const minUnique = useSetting('platforms.minUniqueGames', 6);
  const fromPriceCharting = useFromPriceCharting();
  // Opened from the welcome guide ("Add games one at a time"): a way back to its next step once the games are in.
  const fromWelcome = useSearchParams()[0].get('from') === 'welcome';
  const yours = useQuery({ queryKey: ['platforms'], queryFn: () => api<{ key: string; name: string; copies: number; eligible: boolean }[]>('/platforms') });
  const [platformKey, setPlatformKey] = useState<string>(remembered);
  const [title, setTitle] = useState('');
  const [completeness, setCompleteness] = useState<string | null>(null);
  const [paid, setPaid] = useState<number | string>('');
  const [bought, setBought] = useState('');
  const [notes, setNotes] = useState('');
  const [added, setAdded] = useState<{ platformKey: string; platform: string; title: string }[]>([]);
  const [typed] = useDebouncedValue(title, 200);

  const mine = (yours.data ?? []).filter((p) => p.copies > 0).sort((a, b) => b.copies - a.copies);
  const mineKeys = new Set(mine.map((p) => p.key));
  const consoles = [
    ...(mine.length > 0 ? [{ group: 'Your consoles', items: mine.map((p) => ({ value: p.key, label: p.name })) }] : []),
    { group: mine.length > 0 ? 'Every other console' : 'Consoles', items: [...KNOWN_PLATFORMS].filter((p) => !mineKeys.has(p.key)).sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ value: p.key, label: p.name })) },
  ];
  const platformName = KNOWN_PLATFORMS.find((p) => p.key === platformKey)?.name ?? mine.find((p) => p.key === platformKey)?.name ?? platformKey;
  // A console with too few games for a catalog (Settings > Platforms) suggests only the games added to it: say why.
  const noCatalog = platformKey !== '' && yours.isSuccess && !yours.data.find((p) => p.key === platformKey)?.eligible;

  const suggest = useQuery({
    queryKey: ['add-suggest', platformKey, typed.trim()],
    queryFn: () => api<{ suggestions: Suggestion[] }>(`/collection/add/suggest?platform=${encodeURIComponent(platformKey)}&q=${encodeURIComponent(typed.trim())}`),
    enabled: platformKey !== '' && typed.trim().length >= 2,
  });
  const suggestions = suggest.data?.suggestions ?? [];
  const exact = suggestions.find((s) => normalizeTitle(s.title) === normalizeTitle(title));

  const add = useMutation({
    mutationFn: () =>
      api('/collection/copies', {
        method: 'POST',
        json: { platformKey, title: title.trim(), completeness: completeness ?? usual, costCents: paid === '' ? null : Math.round(Number(paid) * 100), datePurchased: bought || null, notes: notes.trim() },
      }),
    onSuccess: async (answer) => {
      const name = title.trim();
      notifySuccess(`${name} is in your collection.${fromPriceCharting ? ' Stash updates › Send to PriceCharting has it for PriceCharting.' : ''}${overGoalNote(answer)}`, 'Added');
      setAdded((a) => [{ platformKey, platform: platformName, title: name }, ...a].slice(0, 10));
      try {
        localStorage.setItem(LAST_CONSOLE, platformKey);
      } catch {
        // Storage can be off (private windows): the console is just asked again.
      }
      // Ready for the next game on the same console.
      setTitle('');
      setPaid('');
      setBought('');
      setNotes('');
      await Promise.all(TOUCHED.map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
      await queryClient.invalidateQueries({ queryKey: ['platforms'] });
    },
    onError: (err) => notifyError(err),
  });

  return (
    <>
      <PageHeader
        help="collection"
        title="Add a game"
        description="A game you have, typed in by hand: pick its console, type its title, and say what you paid. Its value stays empty until an export from PriceCharting gives one."
        actions={
          fromWelcome && (
            <Button component={Link} to="/welcome" variant="light" leftSection={<IconArrowLeft size={16} />}>
              Back to the welcome guide
            </Button>
          )
        }
      />
      <Card withBorder maw={640}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (platformKey && title.trim()) add.mutate();
          }}
        >
          <Stack gap="sm">
            <Select label="Console" placeholder="Pick the console" data={consoles} value={platformKey || null} onChange={(v) => setPlatformKey(v ?? '')} searchable limit={400} nothingFoundMessage="No console by that name" required />
            <Autocomplete
              label="Title"
              description={
                noCatalog
                  ? `${platformName} has no catalog yet, so only the games you add to it are suggested: type the title as the box has it. It gets one when you have ${minUnique} different games on it (Settings › Platforms).`
                  : undefined
              }
              placeholder={platformKey ? 'Start typing: the catalog and your games suggest titles' : 'Pick the console first'}
              value={title}
              onChange={setTitle}
              data={[...new Set(suggestions.map((s) => s.title))]}
              filter={({ options }) => options}
              disabled={!platformKey}
              maxLength={200}
              required
              renderOption={({ option }) => {
                const s = suggestions.find((x) => x.title === option.value);
                return (
                  <Group gap={6} wrap="nowrap">
                    <Text size="sm">{option.value}</Text>
                    {s && s.owned > 0 && (
                      <Badge size="xs" variant="light" color="green" style={{ textTransform: 'none' }} leftSection={<StashMark size={10} />}>
                        You have {s.owned}
                      </Badge>
                    )}
                    {s?.sources.includes('catalog') && (
                      <Badge size="xs" variant="light" color="gray" style={{ textTransform: 'none' }}>
                        In the catalog
                      </Badge>
                    )}
                    {s?.sources.includes('igdb') && (
                      <Badge size="xs" variant="light" color="gray" style={{ textTransform: 'none' }}>
                        IGDB{s.released ? ` · ${s.released.slice(0, 4)}` : ''}
                      </Badge>
                    )}
                  </Group>
                );
              }}
            />
            {title.trim().length >= 2 && platformKey && !suggest.isFetching && (
              <Text size="xs" c="dimmed">
                {exact
                  ? exact.owned > 0
                    ? `You have ${exact.owned === 1 ? 'a copy' : `${exact.owned} copies`} already: this adds another.`
                    : `Matches ${exact.sources.includes('catalog') ? "the console's catalog" : 'IGDB'}.`
                  : suggestions.length > 0
                    ? 'Pick a suggestion to match the game the catalog knows, or keep typing your own title.'
                    : "Not in this console's catalog yet: it's added as you typed it, and matched once the catalog has it."}
              </Text>
            )}
            <Select label="Condition" data={CONDITIONS} value={completeness ?? usual} onChange={(v) => v && setCompleteness(v)} allowDeselect={false} />
            <Group grow align="flex-start">
              <NumberInput label={`Price paid (${currency})`} value={paid} onChange={setPaid} min={0} decimalScale={2} allowNegative={false} placeholder="Optional" />
              <TextInput label="Bought on" type="date" value={bought} onChange={(e) => setBought(e.currentTarget.value)} />
            </Group>
            <TextInput label="Notes" value={notes} onChange={(e) => setNotes(e.currentTarget.value)} maxLength={500} placeholder="Optional: where it came from, what's special about it" />
            <Group>
              <Button type="submit" leftSection={<IconPlus size={16} />} loading={add.isPending} disabled={!platformKey || !title.trim()}>
                Add it
              </Button>
            </Group>
          </Stack>
        </form>
      </Card>
      {added.length > 0 && (
        <Alert color="green" variant="light" icon={<IconCheck size={18} />} title="Added just now" mt="md" maw={640}>
          <Stack gap={2}>
            {added.map((a, i) => (
              <Anchor key={`${a.platformKey}|${a.title}|${i}`} component={Link} to={`/platforms/${a.platformKey}?game=${encodeURIComponent(`${a.platformKey}|${a.title}`)}`} size="sm">
                {a.title} · {a.platform}
              </Anchor>
            ))}
          </Stack>
          <Text size="xs" mt={6}>
            Click one to open it: where it's kept, photos, tests and more are in its details.
          </Text>
        </Alert>
      )}
    </>
  );
}
