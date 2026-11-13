import { Button, Group, Modal, NumberInput, Stack, Text, TextInput, type MantineSize } from '@mantine/core';
import { currencyDecimals, digitsOf, priceCheckLimits, priceOutOfLine, priceOutOfLineWords, typedPriceCents } from '@squirrelcade/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FocusEventHandler, type KeyboardEventHandler, type ReactNode } from 'react';
import { api } from './api';
import { money } from './format';
import { useSetting } from './hooks';

/**
 * A price box (the owner, 2026-11-12: "I'm used to the way that price charting does it, where you just take the numbers
 * and you don't have to type the decimal place"). Settings > General > How you type prices: with the decimal point as
 * usual, or digits only, PriceCharting's way (1400 is 14.00), when the box shows the amount it will save as it's typed.
 * A drop-in for NumberInput: the value is the amount in whole units (14 or 14.5), or '' when empty.
 */
export function PriceInput({
  value,
  onChange,
  warning,
  description,
  ...props
}: {
  value: number | string;
  onChange: (value: number | string) => void;
  label?: ReactNode;
  description?: ReactNode;
  placeholder?: string;
  /** What's out of line about the price typed (usePriceCheck's warn), shown under it. */
  warning?: string | null;
  'aria-label'?: string;
  'data-autofocus'?: boolean;
  autoFocus?: boolean;
  onBlur?: FocusEventHandler<HTMLInputElement>;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  disabled?: boolean;
  size?: MantineSize;
  w?: number | string;
  maw?: number | string;
  style?: React.CSSProperties;
}) {
  const typing = useSetting('general.priceTyping', 'decimal');
  const currency = useSetting('general.currency', 'USD');
  const places = currencyDecimals(currency);
  const unit = 10 ** places;
  const [digits, setDigits] = useState(() => (value === '' || value === null || value === undefined ? '' : digitsOf(Number(value) * unit)));
  // A value set from outside (a saved price, one found in an email, a box cleared) shows as its digits.
  useEffect(() => {
    if (typing !== 'digits') return;
    const want = value === '' || value === null || value === undefined || Number.isNaN(Number(value)) ? '' : digitsOf(Number(value) * unit);
    setDigits((now) => (typedPriceCents(now, 'digits', places) === (want === '' ? null : Number(want)) ? now : want));
  }, [value, typing, unit, places]);
  const note = warning ? (
    <Text component="span" size="xs" c="orange.8" fw={500}>
      <IconAlertTriangle size={12} style={{ verticalAlign: '-2px' }} aria-hidden /> {warning}: is that right?
    </Text>
  ) : null;
  if (typing !== 'digits') {
    return (
      <NumberInput
        {...props}
        value={value}
        onChange={onChange}
        description={description}
        error={note ?? undefined}
        min={0}
        decimalScale={places}
        allowNegative={false}
        inputMode="decimal"
      />
    );
  }
  const cents = typedPriceCents(digits, 'digits', places);
  return (
    <TextInput
      {...props}
      value={digits}
      inputMode="numeric"
      autoComplete="off"
      onChange={(e) => {
        const next = e.currentTarget.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 10);
        setDigits(next);
        const c = typedPriceCents(next, 'digits', places);
        onChange(c === null ? '' : c / unit);
      }}
      // The amount it will save, as it's typed (nothing more under an empty box: a page of them stays quiet).
      description={
        cents !== null || description ? (
          <>
            {description}
            {description && cents !== null ? ' · ' : ''}
            {cents !== null ? `Saves as ${money(cents, currency)}` : ''}
          </>
        ) : undefined
      }
      placeholder={props.placeholder ?? `1400 is ${money(1400, currency)}`}
      error={note ?? undefined}
    />
  );
}

/** What a price paid is for: a copy (its own product first), or a game on a console in a condition. */
export interface PriceTarget {
  copyId?: number;
  platformKey?: string | null;
  title?: string;
  completeness?: string | null;
}

const valueQuery = (t: PriceTarget) => {
  const q = new URLSearchParams();
  if (t.copyId !== undefined) q.set('copy', String(t.copyId));
  if (t.platformKey) q.set('platform', t.platformKey);
  if (t.title) q.set('title', t.title);
  if (t.completeness && t.completeness !== 'unknown') q.set('completeness', t.completeness);
  return q.toString();
};

/**
 * The check on a price paid (Settings > Collection > Checking prices paid; the owner, 2026-11-12: "if I have a game that
 * says that I paid multi-thousands of dollars... that's way out of line. I need to make sure I don't make that error"):
 * far above the game's value in that condition (from the owner's exports), or above the ceiling with no value known.
 * `warn` gives the words for a price as it's typed (for the box's warning), `confirm` asks before a save (resolving
 * true to go on, false to fix it), and `modal` is the question, to render once.
 */
export function usePriceCheck(target?: PriceTarget | null) {
  const currency = useSetting('general.currency', 'USD');
  const limits = priceCheckLimits(
    { times: useSetting('collection.priceCheckTimes', 3), over: useSetting('collection.priceCheckOver', 50), ceiling: useSetting('collection.priceCheckCeiling', 300) },
    currency,
  );
  const queryClient = useQueryClient();
  const key = target ? valueQuery(target) : '';
  const live = useQuery({
    queryKey: ['known-value', key],
    queryFn: () => api<{ valueCents: number | null }>(`/collection/known-value?${key}`),
    enabled: Boolean(target && (target.copyId !== undefined || (target.platformKey && target.title))),
    staleTime: 60_000,
  });
  const [asking, setAsking] = useState<{ words: string; resolve: (ok: boolean) => void } | null>(null);
  /** Words for what's out of line about a price paid (in cents), beside a value; null when it looks fine. */
  const words = (cents: number | null | undefined, valueCents: number | null | undefined) => {
    const found = priceOutOfLine(cents, valueCents, limits);
    return found && cents ? priceOutOfLineWords(found, cents, (c) => money(c, currency)) : null;
  };
  /** The words for a price typed in the box (whole units, as PriceInput gives it), against the target's value once it's in. */
  const warn = (value: number | string) => (value === '' || Number.isNaN(Number(value)) || !live.isSuccess ? null : words(Math.round(Number(value) * 100), live.data.valueCents));
  /** Asks before a price paid (in cents) that's out of line is saved: true to go on. */
  const confirm = async (cents: number | null | undefined, other?: PriceTarget): Promise<boolean> => {
    if (cents === null || cents === undefined || cents <= 0) return true;
    const t = other ?? target ?? null;
    let valueCents: number | null = null;
    if (t) {
      const q = valueQuery(t);
      valueCents = await queryClient
        .fetchQuery({ queryKey: ['known-value', q], queryFn: () => api<{ valueCents: number | null }>(`/collection/known-value?${q}`), staleTime: 60_000 })
        .then((r) => r.valueCents)
        .catch(() => null);
    }
    const said = words(cents, valueCents);
    if (!said) return true;
    return new Promise<boolean>((resolve) => setAsking({ words: said, resolve }));
  };
  const answer = (ok: boolean) => {
    asking?.resolve(ok);
    setAsking(null);
  };
  const modal = (
    <Modal opened={asking !== null} onClose={() => answer(false)} title="Is that price right?" zIndex={500} centered>
      <Stack gap="sm">
        <Text>{asking?.words}.</Text>
        <Text size="sm" c="dimmed">
          An extra zero or a missing point is an easy slip. Settings › Collection › Checking prices paid sets when Squirrelcade asks.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => answer(false)} data-autofocus>
            Fix it
          </Button>
          <Button color="orange" onClick={() => answer(true)}>
            Yes, that's right
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
  return { warn, words, confirm, modal };
}
