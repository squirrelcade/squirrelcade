import { ActionIcon, Badge, Combobox, Group, Kbd, Loader, Text, TextInput, useCombobox } from '@mantine/core';
import { useDebouncedValue, useHotkeys } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { StashMark } from './Acorn';
import { ANSWERS, type Answer } from './choices';
import { ConsoleChips, isConsoleChip } from './ConsoleChips';
import { ConsoleMark } from './ConsoleMark';
import { isOwned, oneLinePerGame } from './oneLine';
import { api } from './api';
import { recentGames, useOpenGame, type RecentGame } from './GameDrawer';
import { useFeature, useSetting } from './hooks';

/** A search result (GET /api/v1/lookup): a game on one console and Store Mode's answer for it. */
interface Found {
  platformKey: string;
  platform: string;
  title: string;
  answer: Answer;
  /** The PC storefronts you have it on for good. */
  ownedOnPc?: string[];
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

/** How many matches the console chips count from: as many as the server gives. */
const SPREAD = 30;

/** The console chips at the top of the search's list, when its matches span consoles. */
function ConsoleChipsHeader({ spread, value, onChange }: { spread: Found[]; value: string | null; onChange: (key: string | null) => void }) {
  const chips = <ConsoleChips results={spread} value={value} onChange={onChange} keepFocus />;
  if (new Set(spread.map((r) => r.platformKey)).size < 2 && value === null) return null;
  return <Combobox.Header>{chips}</Combobox.Header>;
}

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
  // The top matches (as many as the server gives, 30) for the console chips; the list shows the first `limit` of them.
  const found = useQuery({
    queryKey: ['lookup', 'title', query, SPREAD],
    queryFn: () => api<Found[]>(`/lookup?q=${encodeURIComponent(query)}&limit=${SPREAD}`),
    enabled: query.length >= 2,
  });
  // A console chosen: that console's best matches, asked of the server (beyond the top 30 if need be).
  const [consoleKey, setConsoleKey] = useState<string | null>(null);
  useEffect(() => setConsoleKey(null), [query]);
  const onConsole = useQuery({
    queryKey: ['lookup', 'title', query, limit, consoleKey],
    queryFn: () => api<Found[]>(`/lookup?q=${encodeURIComponent(query)}&platform=${encodeURIComponent(consoleKey!)}&limit=${limit}`),
    enabled: query.length >= 2 && consoleKey !== null,
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
  const spread = query.length >= 2 ? (found.data ?? []) : [];
  // On a console chosen, its own matches (the top 30's on it while the server answers); else one line per game (D175),
  // its consoles' marks beside it, the first `limit` games.
  const perConsole: (Omit<Found, 'answer'> & { answer: Answer | null })[] =
    query.length < 2 ? recent.map((r) => ({ ...r, answer: null })) : consoleKey ? (onConsole.data ?? spread.filter((r) => r.platformKey === consoleKey)) : spread;
  const lines = query.length >= 2 && !consoleKey ? oneLinePerGame(perConsole).slice(0, limit) : perConsole.map((r) => ({ key: `${r.platformKey}|${r.title}`, title: r.title, consoles: [r], owned: isOwned(r.answer), onPc: (r.ownedOnPc?.length ?? 0) > 0 }));
  // The console a line opens: the one you have it on (the newest), else its best match's.
  const openOn = (l: (typeof lines)[number]) => [...l.consoles].reverse().find((c) => isOwned(c.answer)) ?? l.consoles[0]!;
  const results = lines;
  // PC games aren't on a console: they leave the list while one is chosen.
  const pcResults = query.length >= 2 && !consoleKey ? (pcFound.data?.items ?? []) : [];
  const fetching = found.isFetching || pcFound.isFetching || onConsole.isFetching;
  // Enter opens the best match without an arrow key first.
  useEffect(() => {
    if (found.data?.length || pcFound.data?.items.length || onConsole.data?.length) combobox.selectFirstOption();
  }, [found.data, pcFound.data, onConsole.data]);

  const pick = (value: string) => {
    if (value.startsWith('pc:')) {
      const g = pcResults[Number(value.slice(3))];
      if (!g) return;
      navigate(`/pc?q=${encodeURIComponent(g.title)}`);
    } else {
      const l = results[Number(value)];
      if (!l) return;
      const r = openOn(l);
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
            // A console chip tapped keeps the list open (the focus comes back to the box when it's chosen).
            onBlur={(e) => !isConsoleChip(e.relatedTarget) && combobox.closeDropdown()}
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
          {/* The matches' consoles, to see one console's only (tapped without closing the list). */}
          {query.length >= 2 && (spread.length > 0 || consoleKey) && (
            <ConsoleChipsHeader
              spread={spread}
              value={consoleKey}
              onChange={(key) => {
                setConsoleKey(key);
                input.current?.focus();
              }}
            />
          )}
          <Combobox.Options>
            {results.length === 0 && pcResults.length === 0 ? (
              <Combobox.Empty>{fetching ? 'Looking…' : pcOn ? 'No game by that name' : 'No game by that name on your consoles'}</Combobox.Empty>
            ) : (
              results.map((l, i) => {
                const r = openOn(l);
                return (
                <Combobox.Option value={String(i)} key={l.key}>
                  <Group justify="space-between" wrap="nowrap" gap="xs">
                    <div style={{ minWidth: 0 }}>
                      <Text size="sm" truncate>
                        {l.title}
                      </Text>
                      {/* Its consoles' marks (D175): filled where you have it, dotted where you don't, PC last; a mark opens it there. */}
                      <Group gap={4} wrap="wrap" mt={2}>
                        {l.consoles.map((c) => (
                          <ConsoleMark
                            key={c.platformKey}
                            platformKey={c.platformKey}
                            name={c.platform}
                            owned={isOwned(c.answer)}
                            size={14}
                            onClick={(ev) => {
                              ev.preventDefault();
                              ev.stopPropagation();
                              open(c.platformKey, c.title);
                              setText('');
                              combobox.closeDropdown();
                              input.current?.blur();
                            }}
                          />
                        ))}
                        {l.onPc && <ConsoleMark platformKey="pc" name="PC" size={14} />}
                        {/* One console (a console chosen, or a game on one only): its name too. */}
                        {l.consoles.length === 1 && (
                          <Text size="xs" c="dimmed">
                            {l.consoles[0]!.platform}
                          </Text>
                        )}
                      </Group>
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
                );
              })
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
