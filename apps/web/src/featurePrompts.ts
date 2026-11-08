import { FEATURE_LIST } from '@squirrelcade/core';

/**
 * Each feature's own setup prompt (docs/ai/features/<id>.md), bundled into the app so Set it up with AI copies it with no
 * internet, and the copied text always matches the running version.
 */
const files = import.meta.glob('../../../docs/ai/features/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const PROMPTS = new Map(Object.entries(files).map(([path, text]) => [path.split('/').pop()!.replace(/\.md$/, ''), text]));

/** A feature's prompt, or null when it has none (the features list's test makes sure every entry has one). */
export function featurePrompt(id: string): string | null {
  return PROMPTS.get(id) ?? null;
}

/** The ids that have a prompt file (for the test that every feature has one, and every file belongs to a feature). */
export const PROMPT_IDS = [...PROMPTS.keys()];

/** The list's ids, for the same test. */
export const FEATURE_IDS = FEATURE_LIST.map((f) => f.id);
