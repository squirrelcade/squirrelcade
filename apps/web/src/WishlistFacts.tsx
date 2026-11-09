import { ActionIcon, Button, Checkbox, Group, Modal, NumberInput, Select, Stack, Text, Tooltip } from '@mantine/core';
import { IconListDetails } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from './api';
import { notifyError, useCanEdit, useSetting } from './hooks';

interface Facts {
  personalInterest?: string;
  significance?: string;
  marketUrgency?: string;
  releaseClass?: string;
  tieIn?: boolean;
  japaneseDeveloped?: boolean;
  offbeat?: boolean;
  naPhysical?: boolean;
  seriesRemaining?: number;
}

/** Release classes beyond the points list: these two keep a game off the wishlist. */
const OFF_LIST = ['Physical proof pending', 'Exclude'];
const TOUCHED = ['wishlist', 'game', 'lookup', 'history', 'gotd'];

/**
 * A game's facts for its acorns (1.5.0, T-278): your interest, how much it matters to its console, market urgency,
 * a tie-in, an offbeat Japanese game, its release class and the games left in its series. What you set here wins over
 * IGDB's and over a spreadsheet brought in; the points each gives are Acorns ranking's.
 */
export function WishlistFacts({ platformKey, title }: { platformKey: string; title: string }) {
  const canEdit = useCanEdit();
  const [open, setOpen] = useState(false);
  if (!canEdit) return null;
  return (
    <>
      <Tooltip label="Its facts for the wishlist (your interest, release class...)">
        <ActionIcon variant="subtle" color="gray" aria-label="Its facts for the wishlist" onClick={() => setOpen(true)}>
          <IconListDetails size={18} />
        </ActionIcon>
      </Tooltip>
      <Modal opened={open} onClose={() => setOpen(false)} title="Its facts for the wishlist" size="md">
        {open && <FactsForm platformKey={platformKey} title={title} onDone={() => setOpen(false)} />}
      </Modal>
    </>
  );
}

function FactsForm({ platformKey, title, onDone }: { platformKey: string; title: string; onDone: () => void }) {
  const qc = useQueryClient();
  const interest = useSetting('wishlist.personalInterestPoints', {});
  const significance = useSetting('wishlist.significancePoints', {});
  const urgency = useSetting('wishlist.marketUrgencyPoints', {});
  const classes = useSetting('wishlist.releaseClassPoints', {});
  const loaded = useQuery({
    queryKey: ['wishlist-facts', platformKey, title],
    queryFn: () => api<{ details: Facts }>(`/wishlist/details?platform=${encodeURIComponent(platformKey)}&title=${encodeURIComponent(title)}`),
  });
  const [draft, setDraft] = useState<Facts | null>(null);
  const facts = draft ?? loaded.data?.details ?? {};
  const set = (patch: Facts) => setDraft({ ...facts, ...patch });
  const save = useMutation({
    mutationFn: () => {
      const all = draft ?? {};
      const change: Record<string, unknown> = {};
      for (const k of ['personalInterest', 'significance', 'marketUrgency', 'releaseClass', 'tieIn', 'seriesRemaining'] as const) change[k] = all[k] ?? null;
      // Offbeat Japanese counts with all three (made in Japan, offbeat, released here physically).
      const offbeat = Boolean(all.japaneseDeveloped && all.offbeat && all.naPhysical);
      change.japaneseDeveloped = offbeat ? true : null;
      change.offbeat = offbeat ? true : null;
      change.naPhysical = all.naPhysical ?? null;
      return api('/wishlist/details', { method: 'PUT', json: { platformKey, title, details: change } });
    },
    onSuccess: () => {
      void Promise.all(TOUCHED.map((k) => qc.invalidateQueries({ queryKey: [k] })));
      void qc.invalidateQueries({ queryKey: ['wishlist-facts', platformKey, title] });
      onDone();
    },
    onError: (err) => notifyError(err),
  });
  const options = (points: Record<string, number>, extra: string[] = []) => [...Object.entries(points).map(([name, p]) => ({ value: name, label: `${name} (${p >= 0 ? '+' : ''}${p})` })), ...extra.map((e) => ({ value: e, label: `${e} (off the wishlist)` }))];
  const offbeat = Boolean(facts.japaneseDeveloped && facts.offbeat && facts.naPhysical);

  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        {title}. What you set here wins over IGDB's and over a spreadsheet you brought in; the acorns each gives are in Acorns ranking.
      </Text>
      <Select label="Your interest" clearable data={options(interest)} value={facts.personalInterest ?? null} onChange={(v) => set({ personalInterest: v ?? undefined })} />
      <Select label="How much it matters to its console" clearable data={options(significance)} value={facts.significance ?? null} onChange={(v) => set({ significance: v ?? undefined })} />
      <Select label="Market urgency (getting scarce or dearer)" clearable data={options(urgency)} value={facts.marketUrgency ?? null} onChange={(v) => set({ marketUrgency: v ?? undefined })} />
      <Select label="Release class" clearable data={options(classes, OFF_LIST)} value={facts.releaseClass ?? null} onChange={(v) => set({ releaseClass: v ?? undefined })} />
      <NumberInput label="Games left in its series" description="With you having the rest." min={0} max={50} value={facts.seriesRemaining ?? ''} onChange={(v) => set({ seriesRemaining: typeof v === 'number' ? v : undefined })} />
      <Checkbox label="A movie or TV tie-in" checked={facts.tieIn === true} onChange={(e) => set({ tieIn: e.currentTarget.checked || undefined })} />
      <Checkbox
        label="An offbeat Japanese game released here"
        checked={offbeat}
        onChange={(e) => {
          const on = e.currentTarget.checked;
          set({ japaneseDeveloped: on || undefined, offbeat: on || undefined, naPhysical: on || undefined });
        }}
      />
      <Group justify="flex-end">
        <Button variant="default" onClick={onDone}>
          Cancel
        </Button>
        <Button loading={save.isPending} disabled={draft === null} onClick={() => save.mutate()}>
          Save
        </Button>
      </Group>
    </Stack>
  );
}
