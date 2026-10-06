import { SETTINGS_PAGES, settingDefinitions, type SettingDefinition } from '@squirrelcade/core';

/** Whether two setting values are the same (as JSON). */
export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A change a settings file makes: where the setting is, and its value before and after, in words. */
export interface FileChange {
  key: string;
  where: string;
  before: string;
  after: string;
}

/** A setting's value in words: On or Off, a choice's label, a list's items, "(empty)". */
export function shownValue(def: SettingDefinition | undefined, value: unknown): string {
  if (def?.kind === 'secret') return value ? '(set)' : '(empty)';
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (def?.options) return def.options.find((o) => o.value === value)?.label ?? String(value);
  if (Array.isArray(value)) return value.length > 0 ? value.map(String).join(', ') : '(empty)';
  if (value === '' || value === null || value === undefined) return '(empty)';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/**
 * What a settings file would change, before it's applied: each setting in it whose value differs from the saved one
 * (a secret only as replaced: its value is never shown), and the names in it that aren't settings.
 */
export function fileChanges(inFile: Record<string, unknown>, saved: Partial<Record<string, unknown>>): { changes: FileChange[]; unknown: string[] } {
  const changes: FileChange[] = [];
  const unknown: string[] = [];
  for (const [key, after] of Object.entries(inFile)) {
    const def = (settingDefinitions as Record<string, SettingDefinition | undefined>)[key];
    if (!def) {
      unknown.push(key);
      continue;
    }
    const secret = def.kind === 'secret';
    if (!secret && same(saved[key], after)) continue;
    if (secret && !after) continue;
    const where = `${SETTINGS_PAGES.find((pg) => pg.id === def.page)?.title ?? def.page} › ${def.label}`;
    changes.push({ key, where, before: secret ? '(kept as you have it)' : shownValue(def, saved[key]), after: secret ? '(replaced by the file)' : shownValue(def, after) });
  }
  return { changes, unknown };
}
