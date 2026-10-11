import { Button, Group, Text } from '@mantine/core';
import type { SettingKey } from '@squirrelcade/core';
import { IconPlugConnected } from '@tabler/icons-react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../api';
import { notifyError, notifySuccess } from '../hooks';

/**
 * The usual vision models (Check a shelf, D147), each filling in the kind of API, its address and a model that reads
 * images. None is preferred: they're in no order but the alphabet's, with the models at home last.
 */
export const VISION_PRESETS: { name: string; api: 'openai' | 'anthropic'; url: string; model: string }[] = [
  { name: 'Anthropic (Claude)', api: 'anthropic', url: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5-5' },
  { name: 'Google Gemini', api: 'openai', url: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash' },
  { name: 'OpenAI', api: 'openai', url: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  { name: 'OpenRouter', api: 'openai', url: 'https://openrouter.ai/api/v1', model: 'google/gemini-2.5-flash' },
  { name: 'Ollama (at home)', api: 'openai', url: 'http://host.docker.internal:11434/v1', model: 'qwen2.5vl:7b' },
  { name: 'LM Studio (at home)', api: 'openai', url: 'http://host.docker.internal:1234/v1', model: 'qwen2.5-vl-7b-instruct' },
];

/** Buttons that fill in a service's kind of API, address and model. */
export function VisionPresets({ onPick }: { onPick: (values: Partial<Record<SettingKey, string>>) => void }) {
  return (
    <div>
      <Text size="xs" c="dimmed" mb={4}>
        Fill in for:
      </Text>
      <Group gap={6}>
        {VISION_PRESETS.map((p) => (
          <Button key={p.name} size="compact-xs" variant="default" onClick={() => onPick({ 'sources.visionApi': p.api, 'sources.visionUrl': p.url, 'sources.visionModel': p.model })}>
            {p.name}
          </Button>
        ))}
      </Group>
    </div>
  );
}

/** The vision model's test, right under its key: saves unsaved changes first, then sends a small blank image. */
export function VisionTest({ unsaved, save }: { unsaved: boolean; save: () => Promise<boolean> }) {
  const test = useMutation({
    mutationFn: async () => {
      if (unsaved && !(await save())) return null;
      return api<{ ok: boolean; message: string }>('/shelf/test', { method: 'POST' });
    },
    onSuccess: (r) => {
      if (!r) return;
      if (r.ok) notifySuccess(r.message, 'Vision model');
      else notifyError(new Error(r.message), 'Vision model');
    },
    onError: (err) => notifyError(err, 'Vision model'),
  });
  return (
    <Button variant="default" leftSection={<IconPlugConnected size={14} />} loading={test.isPending} onClick={() => test.mutate()}>
      {unsaved ? 'Save and test' : 'Test the model'}
    </Button>
  );
}
