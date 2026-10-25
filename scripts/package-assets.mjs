// Copies the files that must travel in the XPI into src/ before web-ext packs it: web-ext only
// packages src/, and there is no bundler to do this for us.
//
// The copies are gitignored. The root THIRD_PARTY_NOTICES.md and models/ are the sources of
// truth; the runtime comes from `npm run vendor` and the checkpoint from `npm run fetch-model`.
//
//   npm run package-assets
//
// `npm run build` cleans first and runs vendor, this and the checks in order. `npm run sign`
// runs the build before signing, so src/ is always complete when it is packed.

import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { BUNDLED_MODEL } from "../src/model.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const MODEL_NAME = BUNDLED_MODEL.name;
export const MODEL_TARGET = join(root, "src", BUNDLED_MODEL.dir);
const MODELS_TARGET = join(root, "src", "models");
const NOTICES_TARGET = join(root, "src", "THIRD_PARTY_NOTICES.md");
const VENDOR_TARGET = join(root, "src", "vendor", "phonon-tts");
const ARTIFACTS = join(root, "web-ext-artifacts");

// Only what the runtime opens; BUNDLED_MODEL is the one place that says which files those are.
export const MODEL_FILES = [
  BUNDLED_MODEL.config,
  BUNDLED_MODEL.tokenizer,
  BUNDLED_MODEL.weights,
  BUNDLED_MODEL.voice
];

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove everything the packaging generates: the copies under src/ (including the vendored
 * runtime) and any unsigned zips in web-ext-artifacts/. Signed `.xpi` files are releases rather
 * than build output, so they stay.
 */
export async function cleanPackage() {
  const removed = [];
  for (const path of [MODELS_TARGET, NOTICES_TARGET, VENDOR_TARGET]) {
    if (!(await exists(path))) continue;
    await rm(path, { recursive: true, force: true });
    removed.push(path);
  }
  for (const name of await readdir(ARTIFACTS).catch(() => [])) {
    if (!name.toLowerCase().endsWith(".zip")) continue;
    const path = join(ARTIFACTS, name);
    await rm(path, { force: true });
    removed.push(path);
  }
  return removed;
}

/** Copy the notices into src/, so the licences and attribution ship. */
export async function copyNotices() {
  await cp(join(root, "THIRD_PARTY_NOTICES.md"), NOTICES_TARGET);
  return [NOTICES_TARGET];
}

/** Copy the bundled checkpoint from models/ into src/models/, so it ships. */
export async function copyModel() {
  const source = join(root, "models", MODEL_NAME);
  const missing = [];
  for (const file of MODEL_FILES) {
    try {
      await stat(join(source, file));
    } catch {
      missing.push(file);
    }
  }
  if (missing.length) {
    throw new Error(
      `the bundled model is missing ${missing.join(", ")} in models/${MODEL_NAME}.\n` +
        `Run: npm run fetch-model -- --repo gradium/${MODEL_NAME} --out models/${MODEL_NAME}`
    );
  }

  // Replace the folder rather than merge, so a dropped file cannot linger in the package.
  await rm(MODEL_TARGET, { recursive: true, force: true });
  await mkdir(MODEL_TARGET, { recursive: true });
  for (const file of MODEL_FILES) await cp(join(source, file), join(MODEL_TARGET, file));
  return MODEL_TARGET;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const path of await copyNotices()) console.log(`copied ${relative(root, path)} -> ${path}`);
  console.log(`copied ${MODEL_NAME} -> ${await copyModel()}`);
}
