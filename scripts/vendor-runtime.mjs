// Copies the phonon-tts runtime from node_modules into src/vendor, where the extension can
// load it: extension pages cannot import from node_modules, and bundling is pointless here
// because the package is plain ES modules plus .wasm files that must sit beside them.
//
// The output is gitignored: package.json and package-lock.json pin the version, and this script
// is the single way it reaches src/. `npm run build` runs it after cleaning.
//
//   npm run vendor

import { cp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "phonon-tts");
const target = join(root, "src", "vendor", "phonon-tts");

const files = [
  "index.js",
  "worker.js",
  "fetch.js",
  "hub.js",
  "wav.js",
  "threads.js",
  "device.js",
  "simd.js",
  "index.d.ts",
  "LICENSE-MIT",
  "LICENSE-APACHE",
  "THIRD_PARTY_LICENSES.md"
];
const directories = ["wasm", "wasm-threads"];

const version = JSON.parse(await readFile(join(source, "package.json"), "utf8")).version;

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const file of files) await cp(join(source, file), join(target, file));
for (const directory of directories) await cp(join(source, directory), join(target, directory), { recursive: true });
await writeFile(
  join(target, "VERSION"),
  `phonon-tts ${version}\nCopied from node_modules by scripts/vendor-runtime.mjs. Do not edit.\n`
);

console.log(`vendored phonon-tts ${version} -> ${target}`);
