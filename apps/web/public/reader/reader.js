// Check a shelf's photo reader (D147): finds and reads the text on a photo of game spines, in the browser, with
// PaddleOCR's open models (PP-OCRv4, through ONNX Runtime Web). Nothing leaves the device and nothing needs an
// account; after the first use the files are kept on the phone (public/sw.js), so it reads with no signal too.
// A module worker, kept as plain JavaScript under a fixed name so other pages can use it as it is (a start page
// that passes it through, say); photo.js, beside it, is the page's side. Post {id, pixels: {width, height, data}}
// (the photo's RGBA pixels, upright), receive {id, progress} messages and then {id, lines} or {id, error}. Each line
// is {text, score, turn, box}: box is four corners in the photo's own pixels. Plain arithmetic throughout (no
// OffscreenCanvas, which older iPhones lack in workers).
//
// How it reads: each pass turns the photo (a quarter turn first, since spines read sideways, then as it is), finds
// text on a copy about 2560 pixels long (the detection model's map of where text is, split into connected areas),
// fits a turned rectangle to each area (spines lean), cuts it straight out of the full-size photo, flips it if the
// angle model says it's upside down, and reads it (the recognition model, CTC). The same steps as PaddleOCR's own,
// written plainly.

const BASE = new URL('./', import.meta.url);
/** Where the runtime and models are (lib/paths.json names their folders, relative to it). */
const LIB = new URL('lib/', BASE);
const DET_LONG = 2560;
const DET_SHORT_LONG = 2048;
const REC_HEIGHT = 48;
const REC_MAX_WIDTH = 48 * 40;
const CLS_WIDTH = 192;

let loading = null;

function post(message) {
  self.postMessage(message);
}

/** Fetches a file, reporting how much has come. */
async function download(url, onBytes) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't download ${url.pathname.split('/').pop()} (${res.status})`);
  if (!res.body || !onBytes) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onBytes(value.length);
  }
  const all = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.length;
  }
  return all;
}

/** Loads the runtime and the three models once (about 30 MB the first time). */
function load(onProgress) {
  if (!loading) {
    loading = (async () => {
      const paths = await (await fetch(new URL('paths.json', LIB), { cache: 'no-cache' })).json();
      const ortBase = new URL(paths.ort, LIB);
      const ort = await import(new URL('ort.wasm.min.mjs', ortBase).href);
      ort.env.wasm.wasmPaths = ortBase.href;
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
      const models = new URL(paths.models, LIB);
      // Sizes for the progress bar (PP-OCRv4 det, rec, the angle model, the dictionary, the runtime).
      const total = 4745517 + 10822323 + 578966 + 26249 + 14239897;
      let got = 0;
      const tick = (n) => {
        got += n;
        onProgress?.({ stage: 'download', done: Math.min(got, total), total });
      };
      const session = async (name) => ort.InferenceSession.create(await download(new URL(name, models), tick), { executionProviders: ['wasm'] });
      const keysText = new TextDecoder().decode(await download(new URL('ppocr_keys_v1.txt', models), tick));
      const keys = keysText.replace(/\r/g, '').split('\n');
      if (keys[keys.length - 1] === '') keys.pop();
      keys.push(' ');
      // The runtime's own download isn't counted by fetch here; count it as done once the first session exists.
      const det = await session('ch_PP-OCRv4_det_infer.onnx');
      tick(14239897);
      const cls = await session('ch_ppocr_mobile_v2.0_cls_infer.onnx');
      const rec = await session('ch_PP-OCRv4_rec_infer.onnx');
      return { ort, det, cls, rec, keys };
    })();
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

/** From a turned photo's point back to the photo's own: 'ccw' is a quarter turn to the left, 'cw' to the right. */
function unturn(turn, W, H, x, y) {
  if (turn === 'ccw') return [W - y, x];
  if (turn === 'cw') return [y, H - x];
  return [x, y];
}

/** The detection model's map of where text is, on a turned copy of the photo. */
async function detect(m, image, turn) {
  const { data, width: W, height: H } = image;
  const rw = turn === '0' ? W : H;
  const rh = turn === '0' ? H : W;
  const long = Math.max(rw, rh) < DET_SHORT_LONG ? DET_SHORT_LONG : Math.min(Math.max(rw, rh), DET_LONG);
  const scale = long / Math.max(rw, rh);
  const dw = Math.max(32, Math.round((rw * scale) / 32) * 32);
  const dh = Math.max(32, Math.round((rh * scale) / 32) * 32);
  // The turned photo at the map's size, each pixel taken from the photo between its four nearest (bilinear, as
  // OpenCV resizes), as blue, green and red planes (the models were trained on OpenCV's order) with ImageNet's mean
  // and spread.
  const n = dw * dh;
  const input = new Float32Array(3 * n);
  const fx = rw / dw;
  const fy = rh / dh;
  const MEAN = [0.485, 0.456, 0.406];
  const SPREAD = [0.229, 0.224, 0.225];
  for (let y = 0; y < dh; y++)
    for (let x = 0; x < dw; x++) {
      const [ox, oy] = unturn(turn, W, H, (x + 0.5) * fx, (y + 0.5) * fy);
      const sx = Math.min(W - 1, Math.max(0, ox - 0.5));
      const sy = Math.min(H - 1, Math.max(0, oy - 0.5));
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(W - 1, x0 + 1);
      const y1 = Math.min(H - 1, y0 + 1);
      const ax = sx - x0;
      const ay = sy - y0;
      const i = y * dw + x;
      for (let c = 0; c < 3; c++) {
        const ch = 2 - c; // blue, green, red
        const v = (data[(y0 * W + x0) * 4 + ch] * (1 - ax) + data[(y0 * W + x1) * 4 + ch] * ax) * (1 - ay) + (data[(y1 * W + x0) * 4 + ch] * (1 - ax) + data[(y1 * W + x1) * 4 + ch] * ax) * ay;
        input[c * n + i] = (v / 255 - MEAN[c]) / SPREAD[c];
      }
    }
  const out = await m.det.run({ [m.det.inputNames[0]]: new m.ort.Tensor('float32', input, [1, 3, dh, dw]) });
  const prob = out[m.det.outputNames[0]].data;
  return { prob, dw, dh, sx: rw / dw, sy: rh / dh };
}

/** Text areas on the map, each as a turned rectangle in the photo's pixels: [top-left, top-right, bottom-left]. */
function boxes(map, turn, W, H) {
  const { prob, dw, dh, sx, sy } = map;
  const n = dw * dh;
  // Above 0.3 is text; then grown by a pixel up and left (OpenCV's 2x2 dilation), as PaddleOCR does.
  const on = new Uint8Array(n);
  for (let y = 0; y < dh; y++)
    for (let x = 0; x < dw; x++) {
      const i = y * dw + x;
      on[i] = prob[i] > 0.3 || (x > 0 && prob[i - 1] > 0.3) || (y > 0 && prob[i - dw] > 0.3) || (x > 0 && y > 0 && prob[i - dw - 1] > 0.3) ? 1 : 0;
    }
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const found = [];
  for (let start = 0; start < n; start++) {
    if (!on[start] || seen[start]) continue;
    // One connected area (4 neighbours).
    let top = 0;
    let count = 0;
    stack[top++] = start;
    seen[start] = 1;
    const members = [];
    let sum = 0;
    while (top > 0) {
      const i = stack[--top];
      members.push(i);
      sum += prob[i];
      count++;
      const x = i % dw;
      if (x > 0 && on[i - 1] && !seen[i - 1]) (seen[i - 1] = 1), (stack[top++] = i - 1);
      if (x < dw - 1 && on[i + 1] && !seen[i + 1]) (seen[i + 1] = 1), (stack[top++] = i + 1);
      if (i >= dw && on[i - dw] && !seen[i - dw]) (seen[i - dw] = 1), (stack[top++] = i - dw);
      if (i < n - dw && on[i + dw] && !seen[i + dw]) (seen[i + dw] = 1), (stack[top++] = i + dw);
    }
    if (count < 10 || sum / count < 0.5) continue;
    // Its main direction (principal axis) and extent, in the turned photo's full-size pixels.
    let mx = 0;
    let my = 0;
    for (const i of members) {
      mx += ((i % dw) + 0.5) * sx;
      my += (Math.floor(i / dw) + 0.5) * sy;
    }
    mx /= count;
    my /= count;
    let cxx = 0;
    let cyy = 0;
    let cxy = 0;
    for (const i of members) {
      const px = ((i % dw) + 0.5) * sx - mx;
      const py = (Math.floor(i / dw) + 0.5) * sy - my;
      cxx += px * px;
      cyy += py * py;
      cxy += px * py;
    }
    const angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    let a0 = Infinity;
    let a1 = -Infinity;
    let b0 = Infinity;
    let b1 = -Infinity;
    for (const i of members) {
      const px = ((i % dw) + 0.5) * sx - mx;
      const py = (Math.floor(i / dw) + 0.5) * sy - my;
      const a = px * ux + py * uy;
      const b = -px * uy + py * ux;
      if (a < a0) a0 = a;
      if (a > a1) a1 = a;
      if (b < b0) b0 = b;
      if (b > b1) b1 = b;
    }
    a0 -= 0.5 * sx;
    a1 += 0.5 * sx;
    b0 -= 0.5 * sy;
    b1 += 0.5 * sy;
    const L = a1 - a0;
    const Hh = b1 - b0;
    if (Math.min(L, Hh) < 3 * Math.min(sx, sy)) continue;
    // Grown as PaddleOCR grows its boxes (area × 1.6 / perimeter on each side): the map marks letters' middles.
    const d = (L * Hh * 1.6) / (2 * (L + Hh));
    a0 -= d;
    a1 += d;
    b0 -= d;
    b1 += d;
    const corner = (a, b) => unturn(turn, W, H, mx + a * ux - b * uy, my + a * uy + b * ux);
    found.push({ tl: corner(a0, b0), tr: corner(a1, b0), bl: corner(a0, b1), length: a1 - a0, height: b1 - b0, score: sum / count });
  }
  return found;
}

/**
 * A strip of the photo cut straight along origin → xEnd (its width) and origin → yEnd (its height), REC_HEIGHT tall,
 * as the models take it: blue, green, red planes scaled to -1..1, padded with zeros to padTo.
 */
function cut(image, origin, xEnd, yEnd, width, padTo = width) {
  const { data, width: W, height: H } = image;
  const out = new Float32Array(3 * REC_HEIGHT * padTo);
  const plane = REC_HEIGHT * padTo;
  const ux = (xEnd[0] - origin[0]) / width;
  const uy = (xEnd[1] - origin[1]) / width;
  const vx = (yEnd[0] - origin[0]) / REC_HEIGHT;
  const vy = (yEnd[1] - origin[1]) / REC_HEIGHT;
  for (let v = 0; v < REC_HEIGHT; v++)
    for (let u = 0; u < width; u++) {
      // Bilinear: the point's four neighbouring pixel centres.
      const x = origin[0] + (u + 0.5) * ux + (v + 0.5) * vx - 0.5;
      const y = origin[1] + (u + 0.5) * uy + (v + 0.5) * vy - 0.5;
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const fx = x - x0;
      const fy = y - y0;
      const xa = Math.min(W - 1, Math.max(0, x0));
      const xb = Math.min(W - 1, Math.max(0, x0 + 1));
      const ya = Math.min(H - 1, Math.max(0, y0));
      const yb = Math.min(H - 1, Math.max(0, y0 + 1));
      const at = v * padTo + u;
      for (let c = 0; c < 3; c++) {
        const ch = 2 - c; // blue, green, red
        const p = (data[(ya * W + xa) * 4 + ch] * (1 - fx) + data[(ya * W + xb) * 4 + ch] * fx) * (1 - fy) + (data[(yb * W + xa) * 4 + ch] * (1 - fx) + data[(yb * W + xb) * 4 + ch] * fx) * fy;
        out[c * plane + at] = (p / 255 - 0.5) / 0.5;
      }
    }
  return out;
}

/** Reads one text area: turned upright if tall, flipped if upside down, then the recognition model and CTC. */
async function readBox(m, image, box) {
  let { tl, tr, bl } = box;
  let long = box.length;
  let short = box.height;
  const br = [tr[0] + bl[0] - tl[0], tr[1] + bl[1] - tl[1]];
  if (short / long >= 1.5) {
    // A quarter turn to the left, as PaddleOCR turns tall boxes.
    [tl, tr, bl] = [tr, br, tl];
    [long, short] = [short, long];
  }
  const ratio = long / short;
  const clsWidth = Math.min(CLS_WIDTH, Math.max(1, Math.ceil(REC_HEIGHT * ratio)));
  const clsOut = await m.cls.run({
    [m.cls.inputNames[0]]: new m.ort.Tensor('float32', cut(image, tl, tr, bl, clsWidth, CLS_WIDTH), [1, 3, REC_HEIGHT, CLS_WIDTH]),
  });
  const angle = clsOut[m.cls.outputNames[0]].data;
  if (angle[1] > angle[0] && angle[1] > 0.9) {
    // Upside down: read from the far corner.
    const far = [tr[0] + bl[0] - tl[0], tr[1] + bl[1] - tl[1]];
    [tl, tr, bl] = [far, bl, tr];
  }
  const width = Math.min(REC_MAX_WIDTH, Math.max(1, Math.ceil(REC_HEIGHT * ratio)));
  const out = await m.rec.run({ [m.rec.inputNames[0]]: new m.ort.Tensor('float32', cut(image, tl, tr, bl, width), [1, 3, REC_HEIGHT, width]) });
  const t = out[m.rec.outputNames[0]];
  const [, steps, classes] = t.dims;
  const p = t.data;
  let text = '';
  let total = 0;
  let chars = 0;
  let last = 0;
  for (let s = 0; s < steps; s++) {
    let best = 0;
    let bestP = -1;
    for (let k = 0; k < classes; k++) {
      const v = p[s * classes + k];
      if (v > bestP) (bestP = v), (best = k);
    }
    if (best !== 0 && best !== last) {
      text += m.keys[best - 1] ?? ' ';
      total += bestP;
      chars++;
    }
    last = best;
  }
  return { text, score: chars ? total / chars : 0 };
}

async function read(id, image, turns) {
  const progress = (p) => post({ id, progress: p });
  const m = await load(progress);
  const lines = [];
  for (let t = 0; t < turns.length; t++) {
    const turn = turns[t];
    progress({ stage: 'find', pass: t + 1, passes: turns.length });
    const found = boxes(await detect(m, image, turn), turn, image.width, image.height);
    for (let i = 0; i < found.length; i++) {
      if (i % 5 === 0) progress({ stage: 'read', pass: t + 1, passes: turns.length, done: i, total: found.length });
      const box = found[i];
      const { text, score } = await readBox(m, image, box);
      if (!text.trim()) continue;
      const br = [box.tr[0] + box.bl[0] - box.tl[0], box.tr[1] + box.bl[1] - box.tl[1]];
      lines.push({ text, score: Math.round(score * 1000) / 1000, turn, box: [box.tl, box.tr, br, box.bl].map(([x, y]) => [Math.round(x), Math.round(y)]) });
    }
  }
  post({ id, lines, width: image.width, height: image.height });
}

self.onmessage = (event) => {
  const { id, pixels, turns, warm } = event.data ?? {};
  if (warm) {
    // Download and load the models ahead of the first photo (Store Mode, when the owner asks to keep them).
    load((p) => post({ id, progress: p })).then(
      () => post({ id, ready: true }),
      (err) => post({ id, error: String(err?.message ?? err) }),
    );
    return;
  }
  if (!pixels || !(pixels.data instanceof Uint8ClampedArray) || pixels.data.length !== pixels.width * pixels.height * 4) {
    post({ id, error: 'No photo to read.' });
    return;
  }
  read(id, pixels, Array.isArray(turns) && turns.length ? turns : ['ccw']).catch((err) => post({ id, error: String(err?.message ?? err) }));
};
