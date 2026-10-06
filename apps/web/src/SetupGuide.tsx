import { searchUrl, type SetupGuide as Guide } from '@squirrelcade/core';
import { Alert, Anchor, Collapse, List, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconExternalLink, IconSearch } from '@tabler/icons-react';
import { useState } from 'react';
import { useSetting } from './hooks';

/**
 * A service's setup steps (settings pages): each step's page, and a web search that finds it when the page has moved
 * (Settings > Interface > Web searches picks the search engine).
 */
export function SetupGuide({ guide, title, folded = false }: { guide: Guide; title?: string; folded?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!folded) return <GuideSteps guide={guide} title={title} />;
  const Chevron = open ? IconChevronDown : IconChevronRight;
  return (
    <Stack gap={0}>
      <UnstyledButton onClick={() => setOpen((o) => !o)} aria-expanded={open} style={{ alignSelf: 'flex-start' }}>
        <Text size="sm" fw={600} c="forest">
          <Chevron size={14} style={{ verticalAlign: 'middle' }} aria-hidden /> {title ?? 'Set it up'}, step by step
        </Text>
      </UnstyledButton>
      <Collapse expanded={open}>
        <GuideSteps guide={guide} />
      </Collapse>
    </Stack>
  );
}

/** The steps themselves, numbered, each with its page and a web search. */
function GuideSteps({ guide, title }: { guide: Guide; title?: string }) {
  const engine = useSetting('interface.webSearch', 'google');
  return (
    <Stack gap={6} mt={4}>
      {guide.warning && (
        <Alert color="orange" variant="light" p="xs">
          <Text size="sm">{guide.warning}</Text>
        </Alert>
      )}
      {title && (
        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
          {title}
        </Text>
      )}
      <List type="ordered" size="sm" spacing={6}>
        {guide.steps.map((step, i) => (
          <List.Item key={i}>
            <Text size="sm" span>
              {step.text}
            </Text>
            {(step.link || step.search) && (
              <Text size="xs" mt={2}>
                {step.link && (
                  <Anchor href={step.link.url} target="_blank" rel="noreferrer" size="xs">
                    {step.link.label} <IconExternalLink size={11} style={{ verticalAlign: 'middle' }} aria-hidden="true" />
                  </Anchor>
                )}
                {step.link && step.search && (
                  <Text span size="xs" c="dimmed">
                    {' · '}
                  </Text>
                )}
                {step.search && (
                  <Anchor href={searchUrl(engine, step.search)} target="_blank" rel="noreferrer" size="xs" c="dimmed">
                    <IconSearch size={11} style={{ verticalAlign: 'middle' }} aria-hidden="true" /> {step.link ? "Page moved? Search the web" : 'Search the web'}
                  </Anchor>
                )}
              </Text>
            )}
          </List.Item>
        ))}
      </List>
      {guide.note && (
        <Text size="xs" c="dimmed">
          {guide.note}
        </Text>
      )}
    </Stack>
  );
}
