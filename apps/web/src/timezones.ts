/** Time zone choices for a select, with "server default" first. */
export function timeZoneOptions(): { value: string; label: string }[] {
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return [{ value: '', label: 'Server default (TZ variable)' }, ...zones.map((z) => ({ value: z, label: z.replace(/_/g, ' ') }))];
}
