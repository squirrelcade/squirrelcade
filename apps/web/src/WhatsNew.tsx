import { Button, Group, List, Modal, Stack, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import changelog from '../../../CHANGELOG.md?raw';
import { inline } from './Markdown';

/** localStorage: the last version this browser showed, so each update is announced once. */
const SEEN = 'squirrelcade:seen-version';

/** One version's part of CHANGELOG.md. */
export interface Section {
  version: string;
  heading: string;
  lines: string[];
}

/** A version's number without its build ("0.2.0-01eeef1" -> "0.2.0"); null for a development build. */
function release(version: string): string | null {
  return /^(\d+\.\d+\.\d+)(?:-[0-9a-f]{7,})?$/.exec(version)?.[1] ?? null;
}

/** Whether version a comes after version b (both "1.2.3"). */
function after(a: string, b: string): boolean {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

/** CHANGELOG.md's sections, newest first: "## 0.2.0 (date): name" and the lines under it. */
function sections(text: string): Section[] {
  const out: Section[] = [];
  let current: Section | null = null;
  for (const line of text.split('\n')) {
    const m = /^## (\d+\.\d+\.\d+)\b/.exec(line);
    if (m) {
      current = { version: m[1]!, heading: line.slice(3).trim(), lines: [] };
      out.push(current);
    } else if (current && line.trim()) current.lines.push(line.trim());
  }
  return out;
}

/** The longest line of the short view; a longer one is cut at a comma, else between words. */
const GIST_MAX = 100;

/**
 * What a changelog line is about, for the short view. A bold lead-in that labels the line ("**Today** (at the top
 * of the menu): ...", "**Locked out?** ..."): the label. Otherwise the line's first sentence (a bold lead-in that's
 * its subject included, "**Today** lists ..."), without its asides in brackets, up to its first colon or full stop.
 */
export function gist(line: string): string {
  // A link reads as its words.
  const text = line.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  const bold = /^\*\*(.+?)\*\*(\s*\([^)]*\))?\s*(.?)/.exec(text);
  if (bold && (/[:.?!]$/.test(bold[1]!) || /^[:.]?$/.test(bold[3]!))) return bold[1]!.replace(/[:.]$/, '');
  let plain = text.replace(/\*\*|`/g, '');
  // Asides in brackets, the innermost first.
  while (/\([^()]*\)/.test(plain)) plain = plain.replace(/\s*\([^()]*\)/g, '');
  const end = plain.search(/[:.](\s|$)/);
  const sentence = (end > 0 ? plain.slice(0, end) : plain).trim();
  if (sentence.length <= GIST_MAX) return sentence;
  const comma = sentence.lastIndexOf(', ', GIST_MAX);
  if (comma >= 30) return sentence.slice(0, comma);
  const space = sentence.lastIndexOf(' ', GIST_MAX);
  return `${sentence.slice(0, space > 0 ? space : GIST_MAX)}…`;
}

/** A version in a few words: the gist of each change, for when several versions are waiting. */
function SectionBrief({ section }: { section: Section }) {
  const items = section.lines.filter((l) => l.startsWith('- ')).map((l) => gist(l.slice(2)));
  if (items.length === 0) return null;
  return (
    <List size="sm" spacing={2}>
      {items.map((item, i) => (
        <List.Item key={i}>{item}</List.Item>
      ))}
    </List>
  );
}

/** A changelog section: its ### headings, bullet lists and paragraphs. */
function SectionBody({ section }: { section: Section }) {
  const blocks: ReactNode[] = [];
  let items: string[] = [];
  const flush = () => {
    if (items.length === 0) return;
    blocks.push(
      <List key={blocks.length} size="sm" spacing={4}>
        {items.map((item, i) => (
          <List.Item key={i}>{inline(item)}</List.Item>
        ))}
      </List>,
    );
    items = [];
  };
  for (const line of section.lines) {
    if (line.startsWith('- ')) {
      items.push(line.slice(2));
      continue;
    }
    flush();
    if (line.startsWith('### ')) {
      blocks.push(
        <Title key={blocks.length} order={5} mt="xs">
          {line.slice(4)}
        </Title>,
      );
    } else {
      blocks.push(
        <Text key={blocks.length} size="sm">
          {inline(line)}
        </Text>,
      );
    }
  }
  flush();
  return <Stack gap={6}>{blocks}</Stack>;
}

/**
 * "What's new": after Squirrelcade is updated, the first visit shows what the new version (and any skipped
 * one) brought, from CHANGELOG.md, once per browser. A new install, or storage that's off, shows nothing.
 */
export function WhatsNew() {
  const health = useQuery({ queryKey: ['health'], queryFn: () => fetch('/api/v1/health').then((r) => r.json() as Promise<{ version: string }>), staleTime: Infinity });
  const [news, setNews] = useState<Section[] | null>(null);
  useEffect(() => {
    const version = health.data ? release(health.data.version) : null;
    if (!version) return;
    let seen: string | null;
    try {
      seen = localStorage.getItem(SEEN);
      localStorage.setItem(SEEN, version);
    } catch {
      return;
    }
    if (!seen || !after(version, seen)) return;
    const shown = sections(changelog).filter((s) => after(s.version, seen!) && !after(s.version, version));
    if (shown.length > 0) setNews(shown);
  }, [health.data]);

  if (!news) return null;
  return <ChangesModal sections={news} onClose={() => setNews(null)} />;
}

/** A version's changes, or the newest ones for a development build (System > Status > "What's new"). */
export function changesOf(version: string): Section[] {
  const all = sections(changelog);
  const v = release(version);
  const found = v ? all.filter((s) => s.version === v) : [];
  return found.length > 0 ? found : all.slice(0, 1);
}

/** The changes of one or more versions, as the What's new window shows them. */
export function ChangesModal({ sections: news, onClose }: { sections: Section[]; onClose: () => void }) {
  // Several versions at once (a browser that skipped a few updates): each in a few words first, all of it on request.
  const [full, setFull] = useState(news.length <= 2);
  if (news.length === 0) return null;
  return (
    <Modal opened onClose={onClose} title={<Text fw={700}>What's new in Squirrelcade {news[0]!.version}</Text>} size="lg">
      <Stack>
        {news.map((s) => (
          <Stack key={s.version} gap={6}>
            {news.length > 1 && <Title order={4}>{s.heading}</Title>}
            {full ? <SectionBody section={s} /> : <SectionBrief section={s} />}
          </Stack>
        ))}
        <Group justify="flex-end">
          {!full && (
            <Button variant="default" onClick={() => setFull(true)}>
              Show all the details
            </Button>
          )}
          <Button onClick={onClose}>Got it</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
