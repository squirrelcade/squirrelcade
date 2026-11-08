import { ActionIcon, Anchor, Badge, Button, Card, Group, Popover, ScrollArea, Stack, Text, Title, Tooltip } from '@mantine/core';
import { IconHelp } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../../api';
import { dateTime } from '../../format';
import { HELP_TEXTS, resolveHelpLink } from '../../helpTopics';
import { notifyError, notifySuccess, useSetting } from '../../hooks';
import { HELP_ANCHORS, Markdown, slug } from '../../Markdown';

/** One outside part's light (GET /api/v1/system/integrations, T-202). */
export interface IntegrationLine {
  key: string;
  name: string;
  light: 'green' | 'yellow' | 'red' | 'grey';
  says: string;
  lastOk: string | null;
  lastRun: string | null;
  settings: string;
  help: string;
  check: string | null;
  /** Grey because nothing needs it: its link says Settings, not Set it up. */
  notNeeded?: boolean;
}

const LIGHT: Record<IntegrationLine['light'], { color: string; label: string }> = {
  red: { color: 'var(--mantine-color-red-6)', label: 'Failing' },
  yellow: { color: 'var(--mantine-color-yellow-5)', label: 'Needs a look soon' },
  green: { color: 'var(--mantine-color-green-6)', label: 'Working' },
  grey: { color: 'var(--mantine-color-gray-4)', label: 'Off' },
};

/** The integrations' lights, read once and kept a little: the page and the menu's count share them. */
export function useIntegrations(enabled = true) {
  return useQuery({ queryKey: ['system', 'integrations'], queryFn: () => api<{ lines: IntegrationLine[] }>('/system/integrations'), enabled, refetchInterval: 60_000, staleTime: 30_000 });
}

/** A part's section of Help > Integrations (docs/help/integrations.md), for its help card: one source for the words. */
function helpOf(name: string, anchor?: string): string | null {
  const text = HELP_TEXTS.get('integrations') ?? '';
  let heading = name;
  let start = text.indexOf(`\n## ${heading}\n`);
  if (start < 0 && anchor?.includes('#')) {
    // A line named for a person ("Ana's live link") finds its card by the anchor of its help link ("integrations#friends-live").
    const want = anchor.split('#')[1]!;
    const wanted = HELP_ANCHORS[want] ?? want;
    const found = [...text.matchAll(/\n## (.+)\n/g)].find((m) => slug(m[1]!) === wanted);
    if (found) {
      heading = found[1]!;
      start = found.index!;
    }
  }
  if (start < 0) return null;
  const rest = text.slice(start + heading.length + 5);
  const end = rest.indexOf('\n## ');
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

/** The ? beside a part: what it is, what it adds, what it needs, what leaves your server, how to fix the usual problems. */
function HelpCard({ line }: { line: IntegrationLine }) {
  const words = helpOf(line.name, line.help);
  return (
    <Popover width={360} position="bottom-start" shadow="md" withinPortal>
      <Popover.Target>
        <ActionIcon variant="subtle" color="gray" size="sm" aria-label={`About ${line.name}`}>
          <IconHelp size={16} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown>
        <ScrollArea.Autosize mah={360}>
          <Stack gap={6}>
            <Text fw={700} size="sm">
              {line.name}
            </Text>
            {words ? <Markdown text={words} resolve={resolveHelpLink} /> : <Text size="sm">Help &gt; Integrations has more about it.</Text>}
            <Anchor component={Link} to={`/help/${line.help}`} size="sm">
              Its full Help page
            </Anchor>
          </Stack>
        </ScrollArea.Autosize>
      </Popover.Dropdown>
    </Popover>
  );
}

/**
 * System > Status's Integrations card (T-202, D204): a light for every outside part, red first, then yellow, green and
 * grey; each with what it says, when it last worked, a link to its setting, Check now and a help card. It shows only
 * what the server already recorded, so it opens at once; the checks run on their schedule or on Check now.
 */
export function IntegrationsCard() {
  const dateFormat = useSetting('general.dateFormat', 'us');
  const queryClient = useQueryClient();
  const { data } = useIntegrations();
  const check = useMutation({
    mutationFn: (task: string) => api(`/tasks/${task}/run`, { method: 'POST' }),
    onSuccess: () => {
      notifySuccess('Checking now: its light changes when the check is done (System > Tasks shows it running).');
      window.setTimeout(() => void queryClient.invalidateQueries({ queryKey: ['system'] }), 5000);
    },
    onError: (err) => notifyError(err),
  });
  if (!data) return null;
  const counts = { red: 0, yellow: 0, green: 0, grey: 0 };
  for (const l of data.lines) counts[l.light]++;
  return (
    <Card withBorder>
      <Group justify="space-between" mb="sm" wrap="wrap">
        <Title order={5}>Integrations</Title>
        <Group gap={6}>
          {(['red', 'yellow', 'green', 'grey'] as const)
            .filter((k) => counts[k] > 0)
            .map((k) => (
              <Badge key={k} variant="light" color={k === 'grey' ? 'gray' : k} size="sm">
                {counts[k]} {LIGHT[k].label.toLowerCase()}
              </Badge>
            ))}
        </Group>
      </Group>
      <Stack gap={0}>
        {data.lines.map((l, i) => (
          <Group key={l.key} gap="sm" wrap="nowrap" align="flex-start" py={8} style={i > 0 ? { borderTop: '1px solid var(--sc-line)' } : undefined}>
            <Tooltip label={LIGHT[l.light].label}>
              <span role="img" aria-label={LIGHT[l.light].label} style={{ flex: 'none', width: 12, height: 12, marginTop: 4, borderRadius: 99, background: LIGHT[l.light].color, boxShadow: l.light === 'grey' ? undefined : `0 0 0 3px color-mix(in srgb, ${LIGHT[l.light].color} 25%, transparent)` }} />
            </Tooltip>
            <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
              <Group gap={4} wrap="nowrap">
                <Text size="sm" fw={600} c={l.light === 'grey' ? 'dimmed' : undefined}>
                  {l.name}
                </Text>
                <HelpCard line={l} />
              </Group>
              <Text size="xs" c={l.light === 'red' ? 'red' : 'dimmed'} style={{ overflowWrap: 'anywhere' }}>
                {l.says}
              </Text>
              {(l.lastOk || l.lastRun) && (
                <Text size="xs" c="dimmed">
                  {l.lastOk ? `Last worked ${dateTime(l.lastOk, dateFormat)}` : 'Hasn\'t worked yet'}
                  {l.lastRun && l.lastRun !== l.lastOk ? ` · last ran ${dateTime(l.lastRun, dateFormat)}` : ''}
                </Text>
              )}
            </Stack>
            <Group gap={6} wrap="nowrap" style={{ flex: 'none' }}>
              {l.check && (
                <Button size="compact-xs" variant="default" loading={check.isPending && check.variables === l.check} onClick={() => check.mutate(l.check!)}>
                  Check now
                </Button>
              )}
              <Anchor component={Link} to={l.settings} size="xs">
                {l.light === 'grey' && !l.notNeeded ? 'Set it up' : 'Settings'}
              </Anchor>
            </Group>
          </Group>
        ))}
      </Stack>
    </Card>
  );
}
