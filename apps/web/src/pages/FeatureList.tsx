import { everythingNowTotals, FEATURE_LIST, featureLight, featurePromptUrl, featureTime, longTime, QUICK_START, type FeatureEntry } from '@squirrelcade/core';
import { Anchor, Badge, Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import { IconBrandGithub, IconCopy, IconSparkles } from '@tabler/icons-react';
import { Link } from 'react-router';
import { CopyButton } from '../Copy';
import { featurePrompt } from '../featurePrompts';
import { useCanEdit } from '../hooks';
import { useIntegrations } from './system/Integrations';

const LIGHTS = {
  green: { color: 'green', label: 'Set up and working' },
  yellow: { color: 'yellow', label: 'Set up: needs a look' },
  red: { color: 'red', label: 'Set up: failing' },
  grey: { color: 'gray', label: 'Not set up' },
} as const;

/** One feature: what it adds, what it needs, how long it takes, whether it works now, and its own setup prompt. */
function FeatureRow({ f, light }: { f: FeatureEntry; light: keyof typeof LIGHTS }) {
  const prompt = featurePrompt(f.id);
  const [path, hash] = f.settings.split('#');
  const shown = LIGHTS[light];
  return (
    <Card withBorder padding="sm">
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="xs">
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <Group gap="xs">
            <Anchor component={Link} to={{ pathname: path, hash: hash ? `#${hash}` : '' }} size="sm" fw={600}>
              {f.name}
            </Anchor>
            <Badge color={shown.color} variant="light" style={{ textTransform: 'none' }}>
              {shown.label}
            </Badge>
          </Group>
          <Text size="sm">{f.adds}</Text>
          <Text size="xs" c="dimmed">
            Needs: {f.needs}.
          </Text>
          <Text size="xs" c="dimmed">
            Time: {featureTime(f)}.
          </Text>
        </div>
        <Group gap="xs" wrap="wrap">
          <Button component={Link} to={{ pathname: path, hash: hash ? `#${hash}` : '' }} size="xs" variant="default">
            {light === 'grey' ? 'Set it up' : 'Settings'}
          </Button>
          {prompt && (
            <CopyButton value={prompt}>
              {({ copied, copy }) => (
                <Button size="xs" variant="light" color={copied ? 'teal' : undefined} leftSection={<IconCopy size={14} />} onClick={copy}>
                  {copied ? 'Copied: paste it into an AI chat' : 'Set it up with AI'}
                </Button>
              )}
            </CopyButton>
          )}
          <Anchor href={featurePromptUrl(f.id)} target="_blank" rel="noreferrer" size="xs" c="dimmed" title="This prompt on GitHub">
            <IconBrandGithub size={14} style={{ verticalAlign: 'middle' }} aria-hidden /> On GitHub
          </Anchor>
        </Group>
      </Group>
    </Card>
  );
}

/**
 * Settings > Features, first (1.4.0, D219): everything optional, in one list. Squirrelcade works on its own; each of these
 * can be added any day, with its own setup prompt for an AI, a padded time and a light that says whether it works.
 */
export function FeatureList() {
  const owner = useCanEdit();
  const status = useIntegrations(owner);
  const lines = status.data?.lines ?? [];
  const all = everythingNowTotals();
  const features = { minutes: all.minutes - QUICK_START.minutes, padded: all.padded - QUICK_START.padded };
  const set = FEATURE_LIST.filter((f) => ['green', 'yellow', 'red'].includes(featureLight(f, lines) ?? 'grey')).length;
  return (
    <Card withBorder>
      <Stack gap="sm">
        <Group gap="xs">
          <IconSparkles size={20} />
          <Title order={4}>Add these any time</Title>
        </Group>
        <Text size="sm">
          Squirrelcade works on its own: only your collection is needed. Everything below is optional, and each can be added on any day, one at a time. There are a lot of them, and most need an account on another site: all {FEATURE_LIST.length} together take {featureTimeWords(features)}, which is why nothing here is asked on
          the first visit.
          {lines.length > 0 && ` ${set} of ${FEATURE_LIST.length} are set up now.`} <b>Set it up with AI</b> copies that feature's own prompt: paste it into a chat with the AI you use, and it takes you through that one thing (it never asks for a password or a key; you type those into Squirrelcade yourself). The{' '}
          <Anchor component={Link} to="/help/ai-setup" size="sm">
            whole-install prompt
          </Anchor>{' '}
          does the same for all of it, as a quick start or everything.
        </Text>
        <Stack gap="xs">
          {FEATURE_LIST.map((f) => (
            <FeatureRow key={f.id} f={f} light={featureLight(f, lines) ?? 'grey'} />
          ))}
        </Stack>
      </Stack>
    </Card>
  );
}

/** "about 3 hours if all goes smoothly; give it 8" for the whole list. */
function featureTimeWords(t: { minutes: number; padded: number }): string {
  return `about ${longTime(t.minutes)} if everything goes smoothly (give it ${longTime(t.padded)})`;
}
