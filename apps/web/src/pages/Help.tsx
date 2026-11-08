import { Card, Group, NavLink, Stack } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { useEffect } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { HELP_TEXTS, HELP_TOPICS, helpTitle, resolveHelpLink } from '../helpTopics';
import { usePageTitle, useSetting } from '../hooks';
import { HELP_ANCHORS, Markdown } from '../Markdown';
import { AiSetupPanel } from './AiSetup';

/** Help: the guides (docs/help), with their index beside them on a wide screen (on a phone, /help is the index). */
export function HelpPage() {
  const { topic } = useParams();
  const wide = useMediaQuery('(min-width: 62em)');
  const appName = useSetting('general.instanceName', 'Squirrelcade') || 'Squirrelcade';
  const key = topic && HELP_TEXTS.has(topic) && topic !== 'README' ? topic : null;
  const text = key ? HELP_TEXTS.get(key)! : (HELP_TEXTS.get('README') ?? '# Help');
  // A link like /help/integrations#friends-live scrolls to its heading (the ids are the headings' words).
  const hash = useLocation().hash.slice(1);
  useEffect(() => {
    if (!hash) return;
    const id = decodeURIComponent(hash);
    (document.getElementById(id) ?? document.getElementById(HELP_ANCHORS[id] ?? ''))?.scrollIntoView({ block: 'start' });
  }, [hash, key]);
  usePageTitle(key ? `${helpTitle(text, key)} · Help` : 'Help', appName);
  return (
    <Group align="flex-start" wrap="nowrap" gap="lg">
      {wide && (
        <Card withBorder padding="xs">
          <Stack gap={0} w={240}>
            {HELP_TOPICS.map((t) => (
              <NavLink key={t.key} component={Link} to={`/help/${t.key}`} label={t.title} active={t.key === key} />
            ))}
          </Stack>
        </Card>
      )}
      <Card withBorder maw={900} padding="lg" style={{ flex: 1, minWidth: 0 }}>
        {key === 'ai-setup' ? (
          // AI-assisted setup: the prompt for the owner's AI, after the guide's first lines ("the buttons above").
          <>
            <Markdown text={text.split(/\n(?=## )/)[0]!} resolve={resolveHelpLink} />
            <AiSetupPanel />
            <Markdown text={text.split(/\n(?=## )/).slice(1).join('\n')} resolve={resolveHelpLink} />
          </>
        ) : (
          // On a phone the index is the help's first page (its list links to each guide).
          <Markdown text={text} resolve={resolveHelpLink} />
        )}
      </Card>
    </Group>
  );
}
