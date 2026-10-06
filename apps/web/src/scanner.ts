import { normalizeBarcode } from '@squirrelcade/core';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

const FORMATS = ['ean_13', 'upc_a', 'ean_8', 'upc_e'];


/**
 * A barcode detector: the browser's own when it has one (Chrome on Android),
 * otherwise ZXing compiled to WebAssembly, served by Squirrelcade itself.
 */
export async function createDetector(): Promise<Detector> {
  const native = (window as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
  if (native) {
    const supported = (await native.getSupportedFormats?.()) ?? [];
    if (FORMATS.some((f) => supported.includes(f))) return new native({ formats: FORMATS.filter((f) => supported.includes(f)) });
  }
  const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill');
  prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
  });
  return new BarcodeDetector({ formats: FORMATS as never });
}

/** Why the camera can't be used here, or null when it can. */
export function cameraProblem(): string | null {
  if (!window.isSecureContext) return 'The camera works only on an https:// address (through Tailscale, a tunnel or a reverse proxy: Help > Store Mode). You can still type the barcode.';
  if (!navigator.mediaDevices?.getUserMedia) return "This browser can't use the camera. You can still type the barcode.";
  return null;
}

/**
 * Scans from the rear camera into `video` until a barcode is read the same way twice (a misread seldom repeats),
 * or `signal` aborts. It asks for a sharp picture (small or distant barcodes read better) and, where the camera
 * can, keeps refocusing; `onTrack` gets the camera, for its light.
 */
export async function scan(video: HTMLVideoElement, signal: AbortSignal, onTrack?: (track: MediaStreamTrack) => void): Promise<string | null> {
  const detector = await createDetector();
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false,
  });
  try {
    const track = stream.getVideoTracks()[0];
    if (track) {
      await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => undefined);
      onTrack?.(track);
    }
    video.srcObject = stream;
    await video.play();
    let last: string | null = null;
    while (!signal.aborted) {
      if (video.readyState >= 2) {
        const codes = await detector.detect(video).catch(() => []);
        const read = codes.map((c) => c.rawValue).find((v) => /^\d{8,14}$/.test(v));
        // A UPC read once with a zero in front and once without is the same code.
        const code = read ? (normalizeBarcode(read) ?? read) : null;
        if (code && code === last) return code;
        if (code) last = code;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    return null;
  } finally {
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
  }
}
