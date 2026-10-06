import { FEATURE_HOME, FEATURE_SETTINGS, SETTINGS_PAGES, settingDefinitions, settingFeature, settingKeys, type SettingDefinition } from '@squirrelcade/core';
import { Select, type ComboboxItem, type OptionsFilter } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import { useSettings } from '../hooks';

const pageTitle = new Map(SETTINGS_PAGES.map((p) => [p.id, p.title]));
const text = new Map(settingKeys.map((k) => [k, `${settingDefinitions[k].label} ${settingDefinitions[k].description} ${settingDefinitions[k].section}`.toLowerCase()]));
const data = SETTINGS_PAGES.map((p) => ({
  group: p.title,
  items: settingKeys.filter((k) => settingDefinitions[k].page === p.id && settingDefinitions[k].kind !== 'shapes').map((k) => ({ value: k, label: settingDefinitions[k].label })),
}));

/** Matches every word typed against the setting's label, description and section. */
const filter: OptionsFilter = ({ options, search }) => {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (o: ComboboxItem) => words.every((w) => text.get(o.value as (typeof settingKeys)[number])?.includes(w));
  return options
    .map((o) => ('group' in o ? { ...o, items: o.items.filter((i) => matches(i as ComboboxItem)) } : o))
    .filter((o) => ('group' in o ? o.items.length > 0 : matches(o as ComboboxItem)));
};

/** Finds a setting on any settings page (or the Acorns page) and jumps to it. */
export function SettingSearch({ onAdvancedNeeded }: { onAdvancedNeeded: () => void }) {
  const navigate = useNavigate();
  const { data: values } = useSettings();
  // A setting of a part that's off hides on pages other than the part's home (its card): the part's switch there is
  // where to go. On the home itself it shows, off or on.
  const offSwitch = (key: string) => {
    const f = settingFeature(key);
    if (f === null || values?.[FEATURE_SETTINGS[f]] !== false) return null;
    if (FEATURE_HOME[f] === settingDefinitions[key as (typeof settingKeys)[number]].page) return null;
    return { page: FEATURE_HOME[f] ?? 'features', key: FEATURE_SETTINGS[f] };
  };
  // A service's field shows under its switch while it's on: the switch is where to go while it's off.
  const hiddenUnder = (key: string) => {
    const when = (settingDefinitions[key as (typeof settingKeys)[number]] as SettingDefinition).shownWhen;
    return when && values?.[when as (typeof settingKeys)[number]] !== true ? when : null;
  };
  return (
    <Select
      type="search"
      data-1p-ignore
      data-bwignore
      data-form-type="other"
      placeholder="Find a setting"
      aria-label="Find a setting"
      leftSection={<IconSearch size={14} />}
      data={data}
      filter={filter}
      searchable
      value={null}
      onChange={(key) => {
        if (!key) return;
        const def = settingDefinitions[key as (typeof settingKeys)[number]] as SettingDefinition;
        const off = offSwitch(key);
        if (off) {
          navigate(`/settings/${off.page}#setting-${off.key}`);
          return;
        }
        const under = hiddenUnder(key);
        if (under) {
          navigate(`/settings/${def.page}#setting-${under}`);
          return;
        }
        if (def.advanced) onAdvancedNeeded();
        // The wishlist's settings live on the Acorns page.
        navigate(`${def.page === 'wishlist' ? '/acorns' : `/settings/${def.page}`}#setting-${key}`);
      }}
      nothingFoundMessage="No setting matches"
      maxDropdownHeight={360}
      limit={40}
      w={260}
      size="xs"
      comboboxProps={{ width: 380, position: 'bottom-end' }}
      renderOption={({ option }) => (
        <span>
          {option.label}
          <span style={{ opacity: 0.6, fontSize: '0.85em' }}>
            {' · '}
            {offSwitch(option.value) ? 'off: turn it on in Features' : pageTitle.get(settingDefinitions[option.value as (typeof settingKeys)[number]].page)}
          </span>
        </span>
      )}
    />
  );
}
