import { Anchor, Loader, Stack, Table, Text, TextInput } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { PageHeader } from '../components';
import { date } from '../format';
import { GameTitle } from '../GameDrawer';
import { useSetting } from '../hooks';
import { useGameNotes } from '../notes';

/** Your notes: every note you've written on a game, newest first, with a search of titles, consoles and notes. */
export function NotesPage() {
  const { notes, loading } = useGameNotes();
  const dateFormat = useSetting('general.dateFormat', 'us');
  const [search, setSearch] = useState('');
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = notes.filter((n) => {
    const text = `${n.title} ${n.platform} ${n.note}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });

  return (
    <>
      <PageHeader help="collection"
        title="Your notes"
        description="Your own notes on games (the edition you're after, what to check at a store), newest first. Write or change one in a game's drawer: click its title on any page. Store Mode shows a game's note with its answer."
      />
      {loading ? (
        <Loader />
      ) : notes.length === 0 ? (
        <Stack align="center" mt="xl" gap="sm">
          <Text size="lg">No notes yet.</Text>
          <Text c="dimmed" size="sm" ta="center" maw={460}>
            Open any game (click its title, or find it with the search at the top) and write a note under "Your note". Your{' '}
            <Anchor component={Link} to="/wishlist" size="sm">
              wishlist
            </Anchor>{' '}
            is a good place to start.
          </Text>
        </Stack>
      ) : (
        <>
          <TextInput
            placeholder="Search your notes"
            aria-label="Search your notes"
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            w={260}
            mb="sm"
          />
          <Table.ScrollContainer minWidth={560}>
            <Table striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Game</Table.Th>
                  <Table.Th>Note</Table.Th>
                  <Table.Th>Changed</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {shown.map((n) => (
                  <Table.Tr key={`${n.platformKey}|${n.title}`}>
                    <Table.Td>
                      <GameTitle platformKey={n.platformKey} title={n.title} fw={600} withNote={false} />
                      <Text size="xs" c="dimmed">
                        {n.platform}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                        {n.note}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">
                        {date(n.updatedAt, dateFormat)}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {shown.length === 0 && (
            <Text size="sm" c="dimmed">
              No note matches “{search}”.
            </Text>
          )}
        </>
      )}
    </>
  );
}
