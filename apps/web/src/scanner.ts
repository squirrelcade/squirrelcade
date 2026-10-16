import { normalizeBarcode } from '@squirrelcade/core';
import { cameraKeeper } from './camera';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

const FORMATS = ['ean_13', 'upc_a', 'ean_8', 'upc_e'];
/** A place's label (Pack a place): read only where a page asks for it. */
const QR = 'qr_code';

/**
 * A barcode detector: the browser's own when it has one (Chrome on Android) that reads what's asked, otherwise ZXing
 * compiled to WebAssembly, served by Squirrelcade itself. With qr, it reads QR codes too (both read them).
 */
export async function createDetector(qr = false): Promise<Detector> {
  const native = (window as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
  if (native) {
    const supported = (await native.getSupportedFormats?.()) ?? [];
    if (FORMATS.some((f) => supported.includes(f)) && (!qr || supported.includes(QR))) return new native({ formats: [...FORMATS, ...(qr ? [QR] : [])].filter((f) => supported.includes(f)) });
  }
  const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill');
  prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
  });
  return new BarcodeDetector({ formats: [...FORMATS, ...(qr ? [QR] : [])] as never });
}

/** Why the camera can't be used here, or null when it can. */
export function cameraProblem(): string | null {
  if (!window.isSecureContext) return 'The camera works only on an https:// address (through Tailscale, a tunnel or a reverse proxy: Help > Store Mode). You can still type the barcode.';
  if (!navigator.mediaDevices?.getUserMedia) return "This browser can't use the camera. You can still type the barcode.";
  return null;
}

export interface ScanOptions {
  /** Gets the camera, for its light. */
  onTrack?: (track: MediaStreamTrack) => void;
  /** Also reads QR codes whose text this accepts (a place's label). */
  qr?: (text: string) => boolean;
  /** How long the camera stays ready after the scan (D162), for the next one; 0 turns it off at once. */
  keepMs?: number;
  /** Reads nothing while this says so (the phone held sideways: scanning is upright only, D162). */
  paused?: () => boolean;
}

/** The camera, kept ready between scans (D162): the rear one, asked for a sharp picture. */
const camera = cameraKeeper(() =>
  navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false,
  }),
);
// Leaving the page (another app, the phone locked) turns the camera off at once.
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && camera.stop());

const BARCODE = /^\d{8,14}$/;
/** A code still in sight isn't given again; gone this long and back, it is. */
const AGAIN_AFTER_MS = 2000;

/**
 * Reads codes from the rear camera into `video`: each one read the same way twice in a row (a misread seldom repeats)
 * goes to `onCode`, once while it stays in sight, until `onCode` says to stop or `signal` aborts. It asks for a sharp
 * picture (small or distant barcodes read better) and, where the camera can, keeps refocusing.
 */
async function readCodes(video: HTMLVideoElement, signal: AbortSignal, options: ScanOptions, onCode: (code: string) => boolean): Promise<void> {
  const detector = await createDetector(Boolean(options.qr));
  const stream = await camera.open();
  try {
    const track = stream.getVideoTracks()[0];
    if (track) {
      await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => undefined);
      options.onTrack?.(track);
    }
    video.srcObject = stream;
    await video.play();
    let last: string | null = null;
    const seen = new Map<string, number>();
    while (!signal.aborted) {
      if (video.readyState >= 2 && !options.paused?.()) {
        const codes = await detector.detect(video).catch(() => []);
        const read = codes.map((c) => c.rawValue).find((v) => BARCODE.test(v) || Boolean(options.qr?.(v)));
        // A UPC read once with a zero in front and once without is the same code.
        const code = read === undefined ? null : BARCODE.test(read) ? (normalizeBarcode(read) ?? read) : read;
        if (code && code === last) {
          const at = seen.get(code);
          seen.set(code, Date.now());
          if ((at === undefined || Date.now() - at > AGAIN_AFTER_MS) && onCode(code)) return;
        } else if (code) last = code;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  } finally {
    video.srcObject = null;
    camera.release(stream, options.keepMs ?? 0);
  }
}

/** Scans until a barcode is read (or a QR code options.qr accepts), or `signal` aborts (null). */
export async function scan(video: HTMLVideoElement, signal: AbortSignal, onTrack?: (track: MediaStreamTrack) => void, options: Omit<ScanOptions, 'onTrack'> = {}): Promise<string | null> {
  let found: string | null = null;
  await readCodes(video, signal, { ...options, onTrack }, (code) => {
    found = code;
    return true;
  });
  return found;
}

/** Scans one code after another (Pack a place), each given once while it stays in sight, until `signal` aborts. */
export function scanEach(video: HTMLVideoElement, signal: AbortSignal, onCode: (code: string) => void, options: ScanOptions = {}): Promise<void> {
  return readCodes(video, signal, options, (code) => {
    onCode(code);
    return false;
  });
}
