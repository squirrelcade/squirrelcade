import { Anchor, List, Stack, Table, Text, Title } from '@mantine/core';
import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router';

/** Where a link to another of Squirrelcade's documents ("store-mode.md", "../MATCHING.md") goes in the app, or null for none. */
export type LinkResolver = (href: string) => string | null;

/**
 * A line's text: **bold** kept, `code` as code, and [links](...) as links: web addresses open in a new tab, a link
 * to another document opens its page in the app when resolve knows it, and anything else keeps just its words.
 */
export function inline(text: string, resolve?: LinkResolver): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link && /^https?:\/\//.test(link[2]!)) {
      return (
        <Anchor key={i} href={link[2]} target="_blank" rel="noreferrer" inherit>
          {link[1]}
        </Anchor>
      );
    }
    const to = link && resolve ? resolve(link[2]!) : null;
    if (link && to) {
      return (
        <Anchor key={i} component={Link} to={to} inherit>
          {link[1]}
        </Anchor>
      );
    }
    return <Fragment key={i}>{link ? link[1] : part}</Fragment>;
  });
}

/** The cells of a table row: "| a | b |" -> ["a", "b"]. */
const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

/**
 * One of Squirrelcade's own Markdown documents, drawn with Mantine: headings, paragraphs, bullet and numbered lists and
 * tables, with bold, code and links inside. Not a general Markdown renderer: it reads what these documents use.
 */
export function Markdown({ text, resolve }: { text: string; resolve?: LinkResolver }) {
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let items: string[] = [];
  /** A numbered list's items, and the number it starts from. */
  let numbered: { start: number; items: string[] } | null = null;
  let rows: string[][] = [];
  const inline_ = (t: string) => inline(t, resolve);
  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push(
        <Text key={blocks.length} size="sm">
          {inline_(paragraph.join(' '))}
        </Text>,
      );
      paragraph = [];
    }
    if (items.length > 0) {
      blocks.push(
        <List key={blocks.length} size="sm" spacing={4}>
          {items.map((item, i) => (
            <List.Item key={i}>{inline_(item)}</List.Item>
          ))}
        </List>,
      );
      items = [];
    }
    if (numbered) {
      blocks.push(
        <List key={blocks.length} type="ordered" start={numbered.start} size="sm" spacing={4}>
          {numbered.items.map((item, i) => (
            <List.Item key={i}>{inline_(item)}</List.Item>
          ))}
        </List>,
      );
      numbered = null;
    }
    if (rows.length > 0) {
      const [head, ...body] = rows;
      blocks.push(
        <Table.ScrollContainer key={blocks.length} minWidth={560}>
          <Table withTableBorder verticalSpacing={6}>
            <Table.Thead>
              <Table.Tr>
                {head!.map((c, i) => (
                  <Table.Th key={i}>{inline_(c)}</Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {body.map((r, i) => (
                <Table.Tr key={i}>
                  {r.map((c, j) => (
                    <Table.Td key={j}>
                      <Text size="sm">{inline_(c)}</Text>
                    </Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>,
      );
      rows = [];
    }
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const heading = /^(#{1,3}) (.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push(
        <Title key={blocks.length} order={(heading[1]!.length + 1) as 2 | 3 | 4} mt={heading[1]!.length === 1 ? 0 : 'sm'}>
          {inline_(heading[2]!)}
        </Title>,
      );
    } else if (line.startsWith('|')) {
      if (paragraph.length > 0 || items.length > 0 || numbered) flush();
      // The line under a table's header ("| --- | --- |") only marks it.
      if (!/^\|[\s:|-]+\|$/.test(line)) rows.push(cells(line));
    } else if (line.startsWith('- ')) {
      if (paragraph.length > 0 || rows.length > 0 || numbered) flush();
      items.push(line.slice(2));
    } else if (/^\d+\. /.test(line)) {
      if (paragraph.length > 0 || rows.length > 0 || items.length > 0) flush();
      const at = line.indexOf('. ');
      numbered ??= { start: Number(line.slice(0, at)), items: [] };
      numbered.items.push(line.slice(at + 2));
    } else {
      if (items.length > 0 || rows.length > 0 || numbered) flush();
      paragraph.push(line);
    }
  }
  flush();
  return <Stack gap="sm">{blocks}</Stack>;
}
