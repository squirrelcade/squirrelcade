import { ActionIcon, Badge, Combobox, Group, Kbd, Loader, Text, TextInput, useCombobox } from '@mantine/core';
import { useDebouncedValue, useHotkeys } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { StashMark } from './Acorn';
import { ANSWERS, type Answer } from './choices';
import { api } from './api';
import { recentGames, useOpenGame, type RecentGame } from './GameDrawer';
import { useFeature, useSetting } from './hooks';

/** A search result (GET /api/v1/lookup): a game on one console and Store Mode's answer for it. */
interface Found {
  platformKey: string;
  platform: string;
  title: string;
  answer: Answer;
}

/** A PC library game the search found (GET /api/v1/pc/games): its title and its storefronts. */
interface PcFound {
  key: string;
  title: string;
  owned: boolean;
  records: { storefront: string; ownership: string }[];
}

/** How many PC library games the search lists, under the consoles' games. */
const PC_RESULTS = 4;

/**
 * The header's search: type a title (or press "/" anywhere) and pick a game to open it in the game drawer,
 * with Store Mode's answer beside each one. With the PC library on, its games are listed under them (D146): a game
 * you have only on PC (a remaster that came out as a download) is found too, and opens in the PC library. On a phone
 * it's a button to Store Mode, the search made for phones.
 */
export function HeaderSearch() {
  const [text, setText] = useState('');
  const [query] = useDebouncedValue(text.trim(), 250);
  // How many games it lists: Settings > Interface.
  const limit = useSetting('interface.searchResults', 8);
  const input = useRef<HTMLInputElement>(null);
  const open = useOpenGame();
  const navigate = useNavigate();
  const pcOn = useFeature('pc');
  const combobox = useCombobox({ onDropdownClose: () => combobox.resetSelectedOption() });
  useHotkeys([
    ['/', () => input.current?.focus()],
    ['mod+K', () => input.current?.focus()],
  ]);
  const found = useQuery({
    queryKey: ['lookup', 'title', query, limit],
    queryFn: () => api<Found[]>(`/lookup?q=${encodeURIComponent(query)}&limit=${limit}`),
    enabled: query.length >= 2,
  });
  // The PC library's games by the same name (a viewer who isn't shown the PC library gets none).
  const pcFound = useQuery({
    queryKey: ['pc', 'search', query],
    queryFn: () => api<{ items: PcFound[] }>(`/pc/games?q=${encodeURIComponent(query)}&pageSize=${PC_RESULTS}`),
    enabled: pcOn && query.length >= 2,
    retry: false,
  });
  // Without a search typed, the games opened lately.
  const [recent, setRecent] = useState<RecentGame[]>([]);
  const results = query.length >= 2 ? (found.data ?? []) : recent.map((r) => ({ ...r, answer: null }));
  const pcResults = query.length >= 2 ? (pcFound.data?.items ?? []) : [];
  const fetching = found.isFetching || pcFound.isFetching;
  // Enter opens the best match without an arrow key first.
  useEffect(() => {
    if (found.data?.length || pcFound.data?.items.length) combobox.selectFirstOption();
  }, [found.data, pcFound.data]);

  const pick = (value: string) => {
    if (value.startsWith('pc:')) {
      const g = pcResults[Number(value.slice(3))];
      if (!g) return;
      navigate(`/pc?q=${encodeURIComponent(g.title)}`);
    } else {
      const r = results[Number(value)];
      if (!r) return;
      open(r.platformKey, r.title);
    }
    setText('');
    combobox.closeDropdown();
    input.current?.blur();
  };

  return (
    <>
      <ActionIcon component={Link} to="/store" variant="subtle" color="gray" size="lg" hiddenFrom="sm" aria-label="Find a game (Store Mode)">
        <IconSearch size={18} />
      </ActionIcon>
      <Combobox store={combobox} onOptionSubmit={pick} withinPortal position="bottom-start" width={420}>
        <Combobox.Target>
          <TextInput
            ref={input}
            visibleFrom="sm"
            w={260}
            size="sm"
            type="search"
            data-1p-ignore
            data-bwignore
            data-form-type="other"
            placeholder="Find a game"
            aria-label="Find a game"
            leftSection={<IconSearch size={16} />}
            rightSection={fetching ? <Loader size={14} /> : text ? null : <Kbd size="xs">/</Kbd>}
            value={text}
            onChange={(e) => {
              setText(e.currentTarget.value);
              combobox.openDropdown();
              combobox.updateSelectedOptionIndex();
            }}
            onFocus={() => {
              setRecent(recentGames());
              combobox.openDropdown();
            }}
            onBlur={() => combobox.closeDropdown()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setText('');
                input.current?.blur();
              }
            }}
          />
        </Combobox.Target>
        <Combobox.Dropdown hidden={query.length < 2 && results.length === 0}>
          {query.length < 2 && results.length > 0 && (
            <Combobox.Header>
              <Text size="xs" c="dimmed">
                Opened lately
              </Text>
            </Combobox.Header>
          )}
          <Combobox.Options>
            {results.length === 0 && pcResults.length === 0 ? (
              <Combobox.Empty>{fetching ? 'Looking…' : pcOn ? 'No game by that name' : 'No game by that name on your consoles'}</Combobox.Empty>
            ) : (
              results.map((r, i) => (
                <Combobox.Option value={String(i)} key={`${r.platformKey}|${r.title}`}>
                  <Group justify="space-between" wrap="nowrap" gap="xs">
                    <div style={{ minWidth: 0 }}>
                      <Text size="sm" truncate>
                        {r.title}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {r.platform}
                      </Text>
                    </div>
                    {r.answer && (
                      <Badge
                        size="sm"
                        variant="light"
                        color={ANSWERS[r.answer]?.color ?? 'gray'}
                        style={{ textTransform: 'none', flexShrink: 0 }}
                        leftSection={r.answer === 'own' || r.answer === 'own-not-in-catalog' ? <StashMark size={11} /> : undefined}
                      >
                        {ANSWERS[r.answer]?.label ?? r.answer}
                      </Badge>
                    )}
                  </Group>
                </Combobox.Option>
              ))
            )}
            {pcResults.length > 0 && (
              <Combobox.Group label="PC library">
                {pcResults.map((g, i) => (
                  <Combobox.Option value={`pc:${i}`} key={`pc|${g.key}`}>
                    <Group justify="space-between" wrap="nowrap" gap="xs">
                      <div style={{ minWidth: 0 }}>
                        <Text size="sm" truncate>
                          {g.title}
                        </Text>
                        <Text size="xs" c="dimmed">
                          PC · {[...new Set(g.records.map((r) => r.storefront))].join(', ')}
                        </Text>
                      </div>
                      <Badge
                        size="sm"
                        variant="light"
                        color={g.owned ? ANSWERS.own.color : 'gray'}
                        style={{ textTransform: 'none', flexShrink: 0 }}
                        leftSection={g.owned ? <StashMark size={11} /> : undefined}
                      >
                        {g.owned ? 'You own it' : g.records.some((r) => r.ownership === 'subscription') ? 'Subscription' : 'Not verified'}
                      </Badge>
                    </Group>
                  </Combobox.Option>
                ))}
              </Combobox.Group>
            )}
          </Combobox.Options>
        </Combobox.Dropdown>
      </Combobox>
    </>
  );
}
