import { ActionIcon, Badge, Combobox, Group, Kbd, Loader, Text, TextInput, useCombobox } from '@mantine/core';
import { useDebouncedValue, useHotkeys } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ANSWERS, type Answer } from './choices';
import { api } from './api';
import { recentGames, useOpenGame, type RecentGame } from './GameDrawer';
import { useSetting } from './hooks';

/** A search result (GET /api/v1/lookup): a game on one console and Store Mode's answer for it. */
interface Found {
  platformKey: string;
  platform: string;
  title: string;
  answer: Answer;
}

/**
 * The header's search: type a title (or press "/" anywhere) and pick a game to open it in the game drawer,
 * with Store Mode's answer beside each one. On a phone it's a button to Store Mode, the search made for phones.
 */
export function HeaderSearch() {
  const [text, setText] = useState('');
  const [query] = useDebouncedValue(text.trim(), 250);
  // How many games it lists: Settings > Interface.
  const limit = useSetting('interface.searchResults', 8);
  const input = useRef<HTMLInputElement>(null);
  const open = useOpenGame();
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
  // Without a search typed, the games opened lately.
  const [recent, setRecent] = useState<RecentGame[]>([]);
  const results = query.length >= 2 ? (found.data ?? []) : recent.map((r) => ({ ...r, answer: null }));
  // Enter opens the best match without an arrow key first.
  useEffect(() => {
    if (found.data?.length) combobox.selectFirstOption();
  }, [found.data]);

  const pick = (value: string) => {
    const r = results[Number(value)];
    if (!r) return;
    open(r.platformKey, r.title);
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
            rightSection={found.isFetching ? <Loader size={14} /> : text ? null : <Kbd size="xs">/</Kbd>}
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
            {results.length === 0 ? (
              <Combobox.Empty>{found.isFetching ? 'Looking…' : 'No game by that name on your consoles'}</Combobox.Empty>
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
                      <Badge size="sm" variant="light" color={ANSWERS[r.answer]?.color ?? 'gray'} style={{ textTransform: 'none', flexShrink: 0 }}>
                        {ANSWERS[r.answer]?.label ?? r.answer}
                      </Badge>
                    )}
                  </Group>
                </Combobox.Option>
              ))
            )}
          </Combobox.Options>
        </Combobox.Dropdown>
      </Combobox>
    </>
  );
}
