import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

// phonon-tts ships the notices for the Rust crates linked into its wasm builds. This repository
// keeps no inventory of its own: the package is the source, `npm run vendor` copies the file into
// the extension, and these tests check the three stay in step.

const root = new URL("..", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const normalizeEol = (text) => text.replace(/\r\n/g, "\n");
const upstream = new URL("node_modules/phonon-tts/THIRD_PARTY_LICENSES.md", root);
const vendored = new URL("src/vendor/phonon-tts/THIRD_PARTY_LICENSES.md", root);

async function crateNames(text) {
  return [...text.matchAll(/^- \[([a-zA-Z0-9_.-]+) ([^\]]+)\]\(/gm)].map((m) => `${m[1]} ${m[2]}`);
}

describe("third-party Rust notices", () => {
  test("the installed phonon-tts ships the notices for its wasm crates", async () => {
    const text = normalizeEol(await readFile(upstream, "utf8"));
    assert.match(text, /^# Third-party licences/m);
    assert.doesNotMatch(text, /UNKNOWN|XXXXXXX|YYYYYYY|\[Link zum Issue\]/);
    for (const licence of ["Apache License 2.0", "MIT License"]) {
      assert.ok(text.includes(`## ${licence}`), `${licence} text missing`);
    }
  });

  test("every crate comes with a version, and the xn-ptts crates are among them", async () => {
    const crates = await crateNames(normalizeEol(await readFile(upstream, "utf8")));
    assert.ok(crates.length > 100, `only ${crates.length} crates listed`);

    const names = crates.map((entry) => entry.split(" ")[0]);
    for (const crate of ["ptts", "ptts-wasm", "wasm-bindgen"]) {
      assert.ok(names.includes(crate), `${crate} missing`);
    }
    const pinned = JSON.parse(await read("package.json")).devDependencies["phonon-tts"];
    assert.ok(crates.includes(`ptts ${pinned}`), `ptts ${pinned} missing`);
  });

  test("the main notices point at the bundled Rust notices", async () => {
    const notices = await read("THIRD_PARTY_NOTICES.md");
    assert.match(notices, /src\/vendor\/phonon-tts\/THIRD_PARTY_LICENSES\.md/);
    assert.doesNotMatch(notices, /THIRD_PARTY_RUST\.md/);
  });

  test("vendor-runtime copies the notices into the extension", async () => {
    const vendor = await read("scripts/vendor-runtime.mjs");
    assert.match(vendor, /"THIRD_PARTY_LICENSES\.md"/);
  });

  test("the vendored copy matches the package", async (t) => {
    try {
      await stat(vendored);
    } catch {
      return t.skip("src/vendor is not populated; run npm run vendor");
    }
    assert.equal(
      normalizeEol(await readFile(vendored, "utf8")),
      normalizeEol(await readFile(upstream, "utf8"))
    );
  });
});
