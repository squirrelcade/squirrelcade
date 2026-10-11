// Check a shelf's page side (D147), beside the reader (reader.js): turns a photo file into upright pixels, reads them
// in a worker that stays loaded for the next photo, and cuts the photo into pieces for a vision model. Plain
// JavaScript under a fixed name, like the reader, so another page (a start page passing it through) can import it
// as it is: const { readPhoto } = await import('<where it is>/photo.js').

/** Photos larger than this on their long side are scaled down first (a phone's 12 MP photo is 4032). */
const MAX_SIDE = 4096;

let worker = null;
let next = 1;
const waiting = new Map();

function readerWorker() {
  if (!worker) {
    worker = new Worker(new URL('./reader.js', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => {
      const { id, progress, error, ready, lines } = event.data ?? {};
      const job = waiting.get(id);
      if (!job) return;
      if (progress) return job.onProgress?.(progress);
      waiting.delete(id);
      if (error) job.reject(new Error(error));
      else job.resolve(ready ? { ready: true } : { lines, width: event.data.width, height: event.data.height });
    };
    worker.onerror = (event) => {
      const err = new Error(event.message || "The photo reader couldn't start.");
      for (const job of waiting.values()) job.reject(err);
      waiting.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

function ask(message, transfer, onProgress) {
  const id = next++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject, onProgress });
    readerWorker().postMessage({ ...message, id }, transfer);
  });
}

/** Downloads and loads the reader's models now (about 30 MB the first time), so the first photo reads sooner. */
export function warmReader(onProgress) {
  return ask({ warm: true }, [], onProgress);
}

/**
 * The photo, upright as taken, on a canvas at most MAX_SIDE on its long side. An image element turns it by the
 * photo's own orientation (EXIF) in every browser, which createImageBitmap doesn't always do.
 */
export async function decodePhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } catch {
    throw new Error("That file couldn't be opened as a photo (a JPEG, PNG, WebP or HEIC from a phone works).");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Reads the text on a photo (a canvas from decodePhoto): turns is the passes, 'ccw' for spines (a quarter turn,
 * either way up) and '0' for text as it is (box fronts). onProgress gets {stage: 'download' | 'find' | 'read', ...}.
 * Resolves to {lines: [{text, score, turn, box}], width, height}.
 */
export function readCanvas(canvas, { turns = ['ccw'], onProgress } = {}) {
  const image = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
  return ask({ pixels: { width: image.width, height: image.height, data: image.data }, turns }, [image.data.buffer], onProgress);
}

/** decodePhoto and readCanvas together; also gives the canvas, for pieces. */
export async function readPhoto(file, options = {}) {
  const canvas = await decodePhoto(file);
  return { canvas, ...(await readCanvas(canvas, options)) };
}

/**
 * The photo in count overlapping pieces (a grid shaped like the photo), each a JPEG data URL at most maxSide on its
 * long side: vision models shrink what they're sent, so pieces keep small spines readable.
 */
export function photoPieces(canvas, count = 4, maxSide = 1568) {
  const W = canvas.width;
  const H = canvas.height;
  // The grid of count pieces whose pieces are closest to square.
  let cols = 1;
  for (let c = 1; c <= count; c++) {
    if (count % c !== 0) continue;
    const squareness = (k) => Math.abs(Math.log(W / k / (H / (count / k))));
    if (squareness(c) < squareness(cols)) cols = c;
  }
  const rows = count / cols;
  const overlap = 0.08;
  const pw = W / cols;
  const ph = H / rows;
  const out = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x0 = Math.max(0, Math.floor(c * pw - pw * overlap));
      const y0 = Math.max(0, Math.floor(r * ph - ph * overlap));
      const x1 = Math.min(W, Math.ceil((c + 1) * pw + pw * overlap));
      const y1 = Math.min(H, Math.ceil((r + 1) * ph + ph * overlap));
      const scale = Math.min(1, maxSide / Math.max(x1 - x0, y1 - y0));
      const piece = document.createElement('canvas');
      piece.width = Math.round((x1 - x0) * scale);
      piece.height = Math.round((y1 - y0) * scale);
      const ctx = piece.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(canvas, x0, y0, x1 - x0, y1 - y0, 0, 0, piece.width, piece.height);
      out.push(piece.toDataURL('image/jpeg', 0.85));
    }
  return out;
}
