import { Alert, Button, Card, Group, Spoiler, Stack, Text, Textarea, Title } from '@mantine/core';
import { IconCopy, IconDownload, IconFiles, IconSparkles } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { BRIEF_TEMPLATE, briefWithGuides, fillBrief, saveText, type BriefParts } from '../aiSetup';
import { api } from '../api';
import { CopyButton } from '../Copy';
import { useCanEdit } from '../hooks';

const kb = (text: string) => `${Math.max(1, Math.round(new Blob([text]).size / 1024))} KB`;

/**
 * Help > AI-assisted setup (0.29.0, D93), above its guide: the prompt for the owner's own AI, made for this Squirrelcade
 * (what's set up, a link to each setting; never a key or password), to copy, or to save alone or with every guide.
 */
export function AiSetupPanel() {
  const owner = useCanEdit();
  const parts = useQuery({ queryKey: ['ai-setup'], queryFn: () => api<BriefParts>(`/system/ai-setup?address=${encodeURIComponent(window.location.origin)}`), enabled: owner });
  if (!owner) return null;
  const ready = parts.isSuccess;
  const text = ready ? fillBrief(BRIEF_TEMPLATE, parts.data) : BRIEF_TEMPLATE;
  const full = ready ? briefWithGuides(text) : '';
  return (
    <Card withBorder padding="md" my="md">
      <Stack gap="sm">
        <Group gap="xs">
          <IconSparkles size={20} />
          <Title order={4}>Your setup prompt</Title>
        </Group>
        <Text size="sm">
          Made for this Squirrelcade: what's set up already, and a link to each setting on it. It never includes passwords, keys or tokens. Paste it into a new chat with your AI, or attach the file.
        </Text>
        {parts.isError && (
          <Alert color="yellow" variant="light">
            Squirrelcade couldn't summarize this install just now, so the prompt below is the general one. Try again in a moment.
          </Alert>
        )}
        <Group gap="xs">
          <CopyButton value={text}>
            {({ copied, copy }) => (
              <Button leftSection={<IconCopy size={16} />} color={copied ? 'teal' : undefined} onClick={copy} disabled={!ready && !parts.isError}>
                {copied ? 'Copied' : 'Copy the prompt'}
              </Button>
            )}
          </CopyButton>
          <Button variant="default" leftSection={<IconDownload size={16} />} onClick={() => saveText('squirrelcade-setup-prompt.md', text)} disabled={!ready && !parts.isError}>
            Download it
          </Button>
          <Button variant="default" leftSection={<IconFiles size={16} />} onClick={() => saveText('squirrelcade-setup-prompt-and-guides.md', briefWithGuides(text))} disabled={!ready && !parts.isError}>
            Download it with every guide
          </Button>
        </Group>
        {ready && (
          <Text size="xs" c="dimmed">
            The prompt is {kb(text)}; with every guide, {kb(full)} (attach that one as a file: some chats cut long messages).
          </Text>
        )}
        <Spoiler maxHeight={0} showLabel="See the prompt" hideLabel="Hide the prompt">
          <Textarea value={text} readOnly autosize minRows={8} maxRows={20} aria-label="The setup prompt" styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)', fontSize: 12 } }} />
        </Spoiler>
      </Stack>
    </Card>
  );
}
