import { FEATURE_DEFAULTS, FEATURE_SETTINGS, type FeatureKey, type SettingKey, type SettingsValues } from '@squirrelcade/core';
import { notifications } from '@mantine/notifications';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api, errorMessage } from './api';
import { unreachable } from './offline';

/** Who is using the interface: whether setup is needed, whether signed in, and how. */
export interface Session {
  setupRequired: boolean;
  /** First-run setup opened from outside the home network asks for the code in Squirrelcade's log (0.60.0). */
  setupCodeNeeded?: boolean;
  authenticated: boolean;
  username: string | null;
  via: 'session' | 'apikey' | 'local' | null;
  /** The collection's owner (who can change anything) or a viewer (who looks); null signed out. */
  role: 'owner' | 'viewer' | null;
  /** Whether the sign-in page leads with checking a game (Settings > Security). */
  publicCheck: 'off' | 'phones' | 'everywhere';
}

/** The current session, from the API. */
export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: () => api<Session>('/auth/session'),
    // Asked even while the browser says it's offline (React Query would wait): with no connection Squirrelcade can
    // still open from this browser's copy (App.tsx), which needs this answer to fail rather than wait.
    networkMode: 'always',
    // A server that can't be reached is tried once more, not three times: an offline start shouldn't wait on it.
    retry: (count, err) => count < (unreachable(err) ? 1 : 3),
    // Asked by the app when it starts and when told to (sign-in, sign-out, a 401); not again by every part of the
    // page that reads it (with no connection, each would start a new try and blank the page while it runs).
    refetchOnMount: false,
  });
}

/** What the settings API returns: every value (secrets blanked) and which secrets are saved. */
export interface SettingsState {
  values: SettingsValues;
  secretsSet: SettingKey[];
}

const fetchSettings = () => api<SettingsState>('/settings');

/** All settings with the list of saved secrets, for the settings pages. */
export function useSettingsState() {
  return useQuery({ queryKey: ['settings'], queryFn: fetchSettings });
}

/** All setting values. */
export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: fetchSettings, select: (r: SettingsState) => r.values });
}

/** A setting's current value, or its default while settings load (or when it isn't among a viewer's settings). */
export function useSetting<K extends keyof SettingsValues>(key: K, fallback: SettingsValues[K]): SettingsValues[K] {
  const { data } = useSettings();
  return data && key in data ? data[key] : fallback;
}

/** Whether an optional part of Squirrelcade is on (Settings > Features); its default while settings load. */
export function useFeature(feature: FeatureKey): boolean {
  return Boolean(useSetting(FEATURE_SETTINGS[feature], FEATURE_DEFAULTS[feature]));
}

/** Whether the person using the interface may change the collection: the owner, yes; a viewer, no. */
export function useCanEdit(): boolean {
  const { data } = useSession();
  return data?.role !== 'viewer';
}

/** Sets the browser tab title to "<page> · <app name>" ('' for just the name); null leaves it to the page. */
export function usePageTitle(page: string | null, appName = 'Squirrelcade') {
  useEffect(() => {
    if (page !== null) document.title = page ? `${page} · ${appName}` : appName;
  }, [page, appName]);
}

/** Shows an error as a red notice. */
export function notifyError(err: unknown, title = 'Something went wrong') {
  notifications.show({ color: 'red', title, message: errorMessage(err) });
}

/** Shows a green notice. */
export function notifySuccess(message: string, title?: string) {
  notifications.show({ color: 'green', title, message });
}
