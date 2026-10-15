import { Alert, Button, Checkbox, Group, Loader, MultiSelect, SegmentedControl, Stack, Text, Textarea } from '@mantine/core';
import { IconPrinter } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import writerWasm from 'zxing-wasm/writer/zxing_writer.wasm?url';
import { api, errorMessage } from '../api';
import { PageHeader } from '../components';
import { usePageTitle, useSetting } from '../hooks';
import { labelAddress, type Place } from '../places';

/** Printing leaves out Squirrelcade's header, menu, phone bar and the page's controls; a label is never cut in two. */
const PRINT_CSS = `
@media print {
  .mantine-AppShell-header, .mantine-AppShell-navbar, .mantine-AppShell-footer, .no-print { display: none !important; }
  .mantine-AppShell-main { padding: 0 !important; margin: 0 !important; }
  .sc-place-label { break-inside: avoid; }
}`;

const SIZES = { small: '4.5cm', medium: '6.5cm', large: '9cm' } as const;
type Size = keyof typeof SIZES;
const SIZE = 'squirrelcade.labelSize';

let prepared = false;
/** A QR code as SVG, made on the page by ZXing's writer (WebAssembly served by Squirrelcade, loaded only here). */
async function qrSvg(text: string): Promise<string> {
  const { prepareZXingModule, writeBarcode } = await import('zxing-wasm/writer');
  if (!prepared) {
    prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? writerWasm : prefix + path) } });
    prepared = true;
  }
  const made = await writeBarcode(text, { format: 'QRCode', options: 'ecLevel=M' });
  if (made.error) throw new Error(made.error);
  return made.svg;
}

function Label({ name, note, address, width }: { name: string; note: string | null; address: string; width: string }) {
  const qr = useQuery({ queryKey: ['label', address], queryFn: () => qrSvg(address), staleTime: Infinity });
  return (
    <div className="sc-place-label" style={{ width, border: '1px dashed #999', borderRadius: 6, padding: '0.3cm', background: '#fff', color: '#000', textAlign: 'center' }}>
      {qr.data ? (
        <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.data)}`} alt={`QR code for ${name}`} style={{ width: '100%', aspectRatio: '1', imageRendering: 'pixelated', display: 'block' }} />
      ) : qr.error ? (
        <Text size="xs" c="red">
          {errorMessage(qr.error)}
        </Text>
      ) : (
        <Loader size="sm" />
      )}
      <div style={{ fontWeight: 700, fontSize: `calc(${width} / 9)`, lineHeight: 1.15, marginTop: '0.15cm', overflowWrap: 'anywhere' }}>{name}</div>
      {note && <div style={{ fontSize: `calc(${width} / 16)`, lineHeight: 1.2, overflowWrap: 'anywhere' }}>{note}</div>}
    </div>
  );
}

/**
 * Place labels (D157): a sheet to print, one label a place with its name and a QR code. Stuck on a bag or a case,
 * the label chooses that place when it's scanned on Pack a place, and a phone's own camera opens Pack a place on it.
 * The code holds the address of Pack a place with the place's name, so it works without a table of labels.
 */
export function PlaceLabelsPage() {
  const appName = useSetting('general.instanceName', 'Squirrelcade') || 'Squirrelcade';
  usePageTitle('Place labels', appName);
  const publicUrl = useSetting('general.publicUrl', '');
  const base = publicUrl.trim() || window.location.origin;
  const [params] = useSearchParams();
  const places = useQuery({ queryKey: ['places'], queryFn: () => api<{ places: Place[]; unplaced: number }>('/places') });
  // Every place at first, or the one a place's "Its label" asked for (typed below when it has no games yet).
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [more, setMore] = useState('');
  useEffect(() => {
    if (!places.data || chosen !== null) return;
    const one = params.get('place')?.trim();
    if (!one) return setChosen(places.data.places.map((p) => p.name));
    const known = places.data.places.filter((p) => p.name.toLowerCase() === one.toLowerCase()).map((p) => p.name);
    setChosen(known);
    if (known.length === 0) setMore(one);
  }, [places.data, chosen, params]);
  const [withNotes, setWithNotes] = useState(true);
  const [size, setSizeState] = useState<Size>(() => {
    try {
      const kept = localStorage.getItem(SIZE);
      return kept && kept in SIZES ? (kept as Size) : 'medium';
    } catch {
      return 'medium';
    }
  });
  const setSize = (value: string) => {
    setSizeState(value as Size);
    try {
      localStorage.setItem(SIZE, value);
    } catch {
      // No storage: this visit only.
    }
  };

  const byName = new Map((places.data?.places ?? []).map((p) => [p.name.toLowerCase(), p]));
  const extra = more
    .split(/\r?\n|,/)
    .map((s) => s.trim().replace(/\s+/g, ' ').slice(0, 80))
    .filter(Boolean);
  const labels = [...new Map([...(chosen ?? []), ...extra].map((name) => [name.toLowerCase(), byName.get(name.toLowerCase())?.name ?? name])).values()].map((name) => ({
    name,
    note: withNotes ? (byName.get(name.toLowerCase())?.note ?? null) : null,
  }));

  return (
    <Stack gap="sm">
      <style>{PRINT_CSS}</style>
      <div className="no-print">
        <PageHeader
          title="Place labels"
          help="your-copies"
          description="A label for each place, with its name and a QR code, to stick on the bag or case. Scanning it on Pack a place chooses that place; a phone's own camera opens Pack a place on it."
          actions={
            <Button leftSection={<IconPrinter size={16} />} onClick={() => window.print()} disabled={labels.length === 0}>
              Print
            </Button>
          }
        />
        <Stack gap="xs">
          {places.isPending && <Loader size="sm" />}
          {places.error && <Alert color="red">{errorMessage(places.error)}</Alert>}
          {places.data && places.data.places.length > 0 && (
            <MultiSelect label="Places" data={places.data.places.map((p) => p.name)} value={chosen ?? []} onChange={setChosen} searchable clearable maxDropdownHeight={300} />
          )}
          <Textarea
            label="More places, one a line"
            description="Places with no games yet: number the bags, print their labels, then pack them."
            placeholder={'Bag 8\nBag 9'}
            autosize
            minRows={2}
            value={more}
            onChange={(e) => setMore(e.currentTarget.value)}
          />
          <Group gap="lg" align="center">
            <SegmentedControl
              value={size}
              onChange={setSize}
              data={[
                { value: 'small', label: 'Small' },
                { value: 'medium', label: 'Medium' },
                { value: 'large', label: 'Large' },
              ]}
              aria-label="Label size"
            />
            <Checkbox label="With where each place is (its note)" checked={withNotes} onChange={(e) => setWithNotes(e.currentTarget.checked)} />
          </Group>
          <Text size="xs" c="dimmed">
            The codes lead to {base}
            {publicUrl.trim() ? '' : ' (Settings > General > Address of this Squirrelcade gives another)'}. Renamed a place? Its old label still says the old name: print a new one.
          </Text>
        </Stack>
      </div>
      {labels.length === 0 && places.data && (
        <Text size="sm" c="dimmed" className="no-print">
          Choose places above, or type the names of new ones.
        </Text>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4cm' }}>
        {labels.map((l) => (
          <Label key={l.name.toLowerCase()} name={l.name} note={l.note} address={labelAddress(l.name, base)} width={SIZES[size]} />
        ))}
      </div>
    </Stack>
  );
}
