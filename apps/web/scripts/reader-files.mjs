// Copies what Check a shelf reads photos with into public/reader/lib (not kept in git): ONNX Runtime Web's
// WebAssembly build and PaddleOCR's PP-OCRv4 models as @gutenye/ocr-models packages them. Each goes in a folder
// named for its version, so a phone keeps a downloaded copy until a new version comes (public/sw.js), and
// lib/paths.json tells the reader (public/reader/reader.js) where they are. Runs before the build and the dev server.
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('..', import.meta.url));
const lib = join(here, 'public', 'reader', 'lib');
/** A package's folder: in this workspace's node_modules or a parent's (npm workspaces hoist them). */
function packageDir(name) {
  for (let dir = here; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dirname(dir) === dir) throw new Error(`${name} isn't installed (npm install)`);
  }
}
const ortDir = join(packageDir('onnxruntime-web'), 'dist');
const modelsDir = join(packageDir('@gutenye/ocr-models'), 'assets');
const version = (pkg) => JSON.parse(readFileSync(join(packageDir(pkg), 'package.json'), 'utf8')).version;

const ort = `ort-${version('onnxruntime-web')}/`;
const models = `models-${version('@gutenye/ocr-models')}/`;
rmSync(lib, { recursive: true, force: true });
mkdirSync(join(lib, ort), { recursive: true });
mkdirSync(join(lib, models), { recursive: true });
// The plain WebAssembly build (no WebGPU): it runs on every phone, and one size of model needs nothing more.
for (const f of ['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) copyFileSync(join(ortDir, f), join(lib, ort, f));
for (const f of ['ch_PP-OCRv4_det_infer.onnx', 'ch_PP-OCRv4_rec_infer.onnx', 'ch_ppocr_mobile_v2.0_cls_infer.onnx', 'ppocr_keys_v1.txt'])
  copyFileSync(join(modelsDir, f), join(lib, models, f));
writeFileSync(join(lib, 'paths.json'), JSON.stringify({ ort, models }));
console.log(`Reader files: ${ort} ${models}`);
