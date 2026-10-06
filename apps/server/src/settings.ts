import {
  SETTINGS_EXPORT_FORMAT,
  SETTINGS_EXPORT_VERSION,
  defaultSettings,
  isSettingKey,
  secretKeys,
  settingDefinitions,
  settingKeys,
  validateSettingChanges,
  type SettingIssue,
  type SettingKey,
  type SettingValue,
  type SettingsExport,
  type SettingsValues,
} from '@squirrelcade/core';
import { inArray } from 'drizzle-orm';
import { EventEmitter } from 'node:events';
import type { Db } from './db/index.js';
import { settings as settingsTable } from './db/schema.js';
import { APP_VERSION } from './env.js';

/** Setting values that were refused, each with the reason. */
export class SettingsError extends Error {
  constructor(public readonly issues: SettingIssue[]) {
    super(issues.map((i) => `${i.key}: ${i.message}`).join('; '));
  }
}

/**
 * Settings are cached in memory and written through to the database. Only values
 * that differ from their default are stored, so changing a default in a new
 * version reaches everyone who never changed that setting.
 */
export class SettingsService {
  private values: SettingsValues = defaultSettings();
  readonly events = new EventEmitter<{ changed: [keys: SettingKey[]] }>();

  constructor(private readonly db: Db) {
    this.load();
  }

  private load(): void {
    const values = defaultSettings() as Record<string, unknown>;
    for (const row of this.db.select().from(settingsTable).all()) {
      if (!isSettingKey(row.key)) continue; // A setting removed in a newer version.
      try {
        const parsed = settingDefinitions[row.key].schema.safeParse(JSON.parse(row.value));
        if (parsed.success) values[row.key] = parsed.data;
      } catch {
        // Unreadable value: keep the default.
      }
    }
    this.values = values as SettingsValues;
  }

  get<K extends SettingKey>(key: K): SettingValue<K> {
    return structuredClone(this.values[key]);
  }

  all(): SettingsValues {
    return structuredClone(this.values);
  }

  /** Values safe to send to a browser: secrets are blanked, with a list of which ones are set. */
  forClient(): { values: SettingsValues; secretsSet: SettingKey[] } {
    const values = this.all();
    const secretsSet: SettingKey[] = [];
    for (const key of secretKeys) {
      if ((values[key] as string) !== '') secretsSet.push(key);
      (values as Record<string, unknown>)[key] = '';
    }
    return { values, secretsSet };
  }

  /** Applies all changes or none. Throws SettingsError listing every problem. */
  update(changes: Record<string, unknown>): SettingsValues {
    const { valid, issues } = validateSettingChanges(changes);
    if (issues.length > 0) throw new SettingsError(issues);
    const keys = Object.keys(valid) as SettingKey[];
    // Only real changes are announced: an import passes every setting, and listeners (catalog rebuilds among them) shouldn't react to unchanged ones.
    const changed = keys.filter((k) => JSON.stringify(this.values[k]) !== JSON.stringify((valid as Record<string, unknown>)[k]));
    const now = new Date().toISOString();
    this.db.transaction((tx) => {
      for (const key of keys) {
        const value = (valid as Record<string, unknown>)[key];
        if (JSON.stringify(value) === JSON.stringify(settingDefinitions[key].default)) {
          tx.delete(settingsTable).where(inArray(settingsTable.key, [key])).run();
        } else {
          tx.insert(settingsTable)
            .values({ key, value: JSON.stringify(value), updatedAt: now })
            .onConflictDoUpdate({ target: settingsTable.key, set: { value: JSON.stringify(value), updatedAt: now } })
            .run();
        }
      }
    });
    Object.assign(this.values, valid);
    if (changed.length > 0) this.events.emit('changed', changed);
    return this.all();
  }

  reset(keys: string[]): SettingsValues {
    const unknown = keys.filter((k) => !isSettingKey(k));
    if (unknown.length > 0) throw new SettingsError(unknown.map((key) => ({ key, message: 'Unknown setting' })));
    const valid = keys as SettingKey[];
    if (valid.length === 0) return this.all();
    this.db.delete(settingsTable).where(inArray(settingsTable.key, valid)).run();
    const defaults = defaultSettings();
    for (const key of valid) (this.values as Record<string, unknown>)[key] = defaults[key];
    this.events.emit('changed', valid);
    return this.all();
  }

  /** Settings that differ from their defaults, in a file that can be imported again. */
  export(): SettingsExport {
    const changed: Record<string, unknown> = {};
    for (const key of settingKeys) {
      if (secretKeys.includes(key)) continue; // Passwords and keys never leave the server in an export.
      if (JSON.stringify(this.values[key]) !== JSON.stringify(settingDefinitions[key].default)) changed[key] = this.values[key];
    }
    return {
      format: SETTINGS_EXPORT_FORMAT,
      version: SETTINGS_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      appVersion: APP_VERSION,
      settings: changed as Partial<SettingsValues>,
    };
  }

  /** Replaces all settings with an export: listed values are applied, everything else returns to its default. */
  import(data: unknown): SettingsValues {
    const file = data as Partial<SettingsExport> | null;
    if (!file || file.format !== SETTINGS_EXPORT_FORMAT || typeof file.settings !== 'object' || file.settings === null) {
      throw new SettingsError([{ key: 'file', message: 'Not a Squirrelcade settings export' }]);
    }
    if (typeof file.version !== 'number' || file.version > SETTINGS_EXPORT_VERSION) {
      throw new SettingsError([{ key: 'file', message: `Settings export version ${String(file.version)} is newer than this Squirrelcade supports` }]);
    }
    const { issues } = validateSettingChanges(file.settings as Record<string, unknown>);
    if (issues.length > 0) throw new SettingsError(issues);
    const merged: Record<string, unknown> = { ...defaultSettings(), ...file.settings };
    // Exports carry no secrets, so an import keeps the ones already saved.
    for (const key of secretKeys) if (!(key in file.settings)) delete merged[key];
    return this.update(merged);
  }
}
