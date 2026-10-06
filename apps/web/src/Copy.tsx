import { useEffect, useRef, useState, type ReactNode } from 'react';
import { notifyError } from './hooks';

/**
 * Copies text, true when it worked. The browser's clipboard answers only on a secure page (HTTPS, or the server
 * itself), so a Squirrelcade opened at home over plain http:// uses the older way: a hidden text box, selected and copied
 * (put inside an open window, whose focus trap would otherwise take the focus back).
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Refused (no permission, the page not in front): the older way below.
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  Object.assign(area.style, { position: 'fixed', top: '0', left: '0', width: '1px', height: '1px', opacity: '0' });
  const host = document.activeElement?.closest('[role="dialog"]') ?? document.body;
  const before = document.activeElement as HTMLElement | null;
  host.appendChild(area);
  area.focus();
  area.select();
  // iPhones select only this way.
  area.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  before?.focus?.();
  return ok;
}

/**
 * Mantine's CopyButton, for every Copy button in the app, but one that also copies on plain http:// (see copyText),
 * and says so when the browser wouldn't let it.
 */
export function CopyButton({ value, timeout = 1500, children }: { value: string; timeout?: number; children: (state: { copied: boolean; copy: () => void }) => ReactNode }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const copy = () => {
    void copyText(value).then((ok) => {
      if (!ok) {
        notifyError(new Error("This browser didn't let Squirrelcade copy: select the text and copy it yourself."), "Couldn't copy");
        return;
      }
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), timeout);
    });
  };
  return <>{children({ copied, copy })}</>;
}
