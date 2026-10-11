import { useEffect, useRef, useState } from 'react';

/**
 * Dictation into a text box (D149; the owner, 2026-10-11: a microphone in Talk, as Snackintosh's Tell box has): tap
 * the microphone, talk, and the words go into the box as they're heard; tap it again to stop, check the words, then
 * send. It uses the browser's own speech service (Apple's in Safari, Google's in Chrome, Microsoft's in Edge), as a
 * phone keyboard's microphone does; Squirrelcade keeps only the text. A pause doesn't end it: when the browser stops
 * listening, it starts again until the button is tapped (Safari and Android listen a phrase at a time). Typing while it
 * listens stops it and keeps every letter. Where a browser has no speech service (Firefox, some others), the button
 * says how to use the keyboard's own dictation instead.
 */

interface Alternative {
  transcript: string;
}
interface Result {
  isFinal: boolean;
  0: Alternative;
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onaudiostart: (() => void) | null;
  onresult: ((event: { results: ArrayLike<Result> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort?(): void;
}
type RecognitionClass = new () => Recognition;

function speechService(): RecognitionClass | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
const IOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1);
const SAFARI = IOS || (/Safari/.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR/.test(ua));
/** Safari and Android don't return words when told to listen on and on: a phrase at a time, started again after each. */
const ONE_PHRASE = SAFARI || /Android/.test(ua);

/** How to dictate with the keyboard instead, on this device. */
export function keyboardHint(agent = ua): string {
  if (/iPhone|iPad|iPod|Android/.test(agent)) return 'Tap the microphone on your keyboard to dictate.';
  if (/Windows/.test(agent)) return 'Press the Windows key + H to dictate.';
  if (/Macintosh/.test(agent)) return 'Press the microphone key (or Fn twice) to dictate.';
  return "Use your keyboard's dictation instead.";
}

/** Words added to what's in the box, with one space between. */
export function joinWords(before: string, words: string): string {
  const w = words.trim();
  if (!w) return before;
  if (!before || /\s$/.test(before)) return before + w;
  return `${before} ${w}`;
}

/**
 * Dictation for one text box: its value and how to set it. Gives whether the browser can listen, whether it's
 * listening, a line to show (what's happening, or why it stopped), and toggle (the button) and halt (typing, or
 * sending: it stops at once and keeps the box as it is).
 */
export function useDictation(value: string, setValue: (v: string) => void) {
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState('');
  const latest = useRef({ value, setValue });
  latest.current = { value, setValue };
  const st = useRef({ rec: null as Recognition | null, on: false, base: '', heard: '', pending: '', restarts: 0, empty: 0, broken: 0, got: 0, again: false, opened: false, began: 0 });
  const Service = speechService();

  // Leaving the page stops listening.
  useEffect(
    () => () => {
      st.current.on = false;
      const rec = st.current.rec;
      if (rec) {
        rec.onresult = rec.onend = rec.onerror = null;
        rec.abort?.();
      }
    },
    [],
  );

  const write = () => {
    const s = st.current;
    latest.current.setValue(joinWords(s.base, `${s.heard} ${s.pending}`));
  };
  const finish = (message: string) => {
    st.current.on = false;
    setListening(false);
    setStatus(message);
  };

  const session = () => {
    const s = st.current;
    const rec = new Service!();
    s.rec = rec;
    rec.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
    rec.interimResults = true;
    rec.continuous = !ONE_PHRASE;
    s.opened = false;
    s.began = Date.now();
    rec.onaudiostart = () => {
      s.opened = true;
      if (s.on) setStatus('Listening… talk, then tap the microphone to stop.');
    };
    rec.onresult = (event) => {
      if (s.rec !== rec) return;
      let done = '';
      let partial = '';
      for (let j = 0; j < event.results.length; j++) {
        const r = event.results[j]!;
        if (r.isFinal) done = joinWords(done, r[0].transcript);
        else partial = joinWords(partial, r[0].transcript);
      }
      s.got += 1;
      s.heard = done;
      s.pending = partial;
      s.restarts = 0;
      s.empty = 0;
      s.broken = 0;
      s.again = false;
      write();
    };
    rec.onerror = (event) => {
      if (s.rec !== rec) return;
      const why = event?.error ?? 'unknown';
      if (why === 'no-speech' || why === 'aborted') return; // a quiet moment, or stopped on purpose
      if ((why === 'not-allowed' || why === 'service-not-allowed') && s.again) finish('Dictation stopped after a pause. Tap the microphone to go on.');
      else if (why === 'not-allowed' || why === 'service-not-allowed') finish(`The microphone isn't allowed here. Allow it for this site in the browser's settings, or: ${keyboardHint()}`);
      else if (why === 'audio-capture') finish(`No microphone was found. ${keyboardHint()}`);
      else if (why === 'network') finish(`This browser's speech service didn't answer. ${keyboardHint()}`);
      else finish(`Dictation stopped (${why}). ${keyboardHint()}`);
    };
    rec.onend = () => {
      if (s.rec !== rec) return;
      const quick = Date.now() - s.began < 1500;
      // Keep every word heard, even the last unfinished ones.
      s.base = joinWords(s.base, `${s.heard} ${s.pending}`);
      latest.current.setValue(s.base);
      if (s.heard || s.pending) s.empty = 0;
      else s.empty += 1;
      if (!s.opened && quick && !(s.heard || s.pending)) s.broken += 1;
      s.heard = '';
      s.pending = '';
      if (!s.on) return;
      if (s.broken >= 2) finish(`This browser's speech service isn't answering here. ${keyboardHint()}`);
      else if (s.empty >= 3 && !s.got) finish(`I didn't catch anything. If you were talking, this browser's speech service isn't working here. ${keyboardHint()}`);
      else if (s.empty >= 3) finish('Stopped listening after a quiet while. Check the words, then tap Send.');
      else if (s.restarts < 40) {
        // A pause ended it: listen again until the button is tapped.
        s.restarts += 1;
        s.again = true;
        begin();
      } else finish('Dictation stopped. Tap the microphone to go on.');
    };
    rec.start();
  };
  const begin = () => {
    const s = st.current;
    s.base = s.base || latest.current.value;
    s.heard = '';
    s.pending = '';
    try {
      session();
    } catch {
      finish('Dictation stopped. Tap the microphone to go on.');
    }
  };

  const start = () => {
    const s = st.current;
    if (!Service) {
      setStatus(keyboardHint());
      return;
    }
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      setStatus(`The microphone works only on Squirrelcade's https address. Here: ${keyboardHint()}`);
      return;
    }
    Object.assign(s, { on: true, base: latest.current.value, restarts: 0, empty: 0, broken: 0, got: 0, again: false });
    setListening(true);
    setStatus('Starting the microphone… (allow it if the browser asks)');
    begin();
  };
  /** Stops, keeping the box as it is now (typing, or sending). */
  const halt = () => {
    const s = st.current;
    if (!s.on) return;
    s.on = false;
    setListening(false);
    setStatus('');
    const rec = s.rec;
    if (rec) {
      rec.onresult = rec.onend = rec.onerror = null;
      if (rec.abort) rec.abort();
      else rec.stop();
    }
  };
  const toggle = () => {
    const s = st.current;
    if (!s.on) {
      start();
      return;
    }
    // Stopped by the button: the last words heard still arrive (onend keeps them).
    s.on = false;
    setListening(false);
    setStatus(latest.current.value ? 'Check the words, then tap Send.' : `Nothing came through. ${keyboardHint()}`);
    s.rec?.stop();
  };

  return { supported: Service !== null, listening, status, toggle, halt };
}
