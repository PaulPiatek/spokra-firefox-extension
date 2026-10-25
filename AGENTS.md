# AGENTS.md

## Layout

- `src/` — Firefox MV3 extension. `background.js` is a module event page and does everything at
  runtime: menus, model lifetime, playback. `options.*` is the settings page.
- `src/vendor/phonon-tts/` — the runtime, copied from `node_modules/phonon-tts` by
  `npm run vendor`. Generated and gitignored, like the checkpoint. Never edit by hand; bump the
  dependency and re-run.
- `src/model.js` — the checkpoint in use: the bundled `phonon-31m-en` (files under `src/models/`,
  copied from `models/` before packaging) or an imported record; builds the runtime spec.
- `src/selection.js` — `readSelection` runs in the page through `scripting.executeScript` and
  returns the selection as blocks; `prepareSpeechText` turns those blocks into the text the
  model speaks. Both the toolbar and the context menu go through it.
- `src/store.js` + `src/model-files.js` + `src/voice-files.js` — imported checkpoints (a folder
  picked in the options page, validated, filtered to the files the runtime opens and copied into
  IndexedDB as blobs) plus the global voice library. The bundled model bypasses them.
- `scripts/` — `fetch-model.mjs` (Hub download into `models/`), `bench.mjs` (wasm diagnostic),
  `vendor-runtime.mjs`.

## Commands

- `npm test` — full Node test suite. Must pass after every change. `tests/options.test.mjs`
  renders the settings page against a tiny fake DOM, which is what catches a row printing a
  class name instead of its content.
- `npm run lint` — `web-ext lint`, must stay at 0 errors / 0 warnings.
- `npm run vendor` — refresh `src/vendor/phonon-tts` after changing the dependency.
- `npm run clean` — removes the generated copies in `src/` and any unsigned zips left in
  `web-ext-artifacts/`; signed `.xpi` releases are kept.
- `npm run build` — clean, re-vendor the runtime, copy the notices and checkpoint into `src/`,
  then lint and test. It leaves `src/` ready for `about:debugging`; it does not produce an XPI.
- `npm run sign` — runs `npm run build` first, then builds and signs for AMO (unlisted),
  prompting for API credentials. `web-ext sign` does the packaging itself; there is no separate
  package step.
- `npm run fetch-model -- --voice Zoey` — model/voices into `models/…`, to import in the UI.
- `npm run check-model` — hashes `models/phonon-31m-en/` against the pin in
  `THIRD_PARTY_NOTICES.md` and reports upstream checkpoint updates (network).
- `npm run bench -- --model models/phonon-31m-en --voice Zoey` — real wasm run in Node, writes
  `bench.wav`.
- Load for testing: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on →
  `src/manifest.json`.

## Things that bite

- **The background page must stay alive while it works.** Firefox kills idle MV3 event pages.
  `updateKeepAlive()` pings `runtime.getPlatformInfo()` every 15 s while `state.session` or
  `state.enginePromise` exists. Any new long-running path must go through it, or audio dies
  mid-sentence and the model reloads.
- **The AudioContext is opened inside the click**, before the model load and before the first
  `await`. Created seconds later outside the gesture it can stay suspended.
- **Extension pages are not cross-origin isolated**, so wasm threads are unavailable: the
  runtime reports 1 thread and that is expected. Do not try to "fix" it. Generation runs on the
  CPU by default; WebGPU is an explicit, experimental option.
- **Firefox's DX12 WebGPU backend loses the device within seconds, from descriptor-heap
  fragmentation — not memory.** `wgpu-hal`'s shader-visible descriptor heap is a range
  allocator; when it cannot satisfy a slice it maps the error to `DeviceError::OutOfMemory`, and
  wgpu-core escalates to losing the device. The GPU process logs
  `[wgpu_hal::dx12::descriptor] Unable to allocate descriptors: RangeAllocationError {
  fragmented_free_length: 3 }`, then `Invalidating command encoder … BindGroup "broadcast_f32"`,
  and only then does `map_async` report `BufferAsyncError`. Nothing reaches the page first: no
  error scope, no uncaptured error, no `device.lost` rejection.
- **Do not diagnose this with a synthetic loop of uniform bind groups.** The runtime creates and
  drops a bind group per dispatch, so a few seconds of speech is ~530 k of each (530,461 create /
  530,311 drop / 528,353 dispatch, measured on 158.0.1). The counts balance, so it is
  fragmentation, not a leak — and fragmentation needs varied allocation sizes. A page churning
  one fixed-size bind group survived 240 s, 15,392 iterations, 120 MiB mapped and 240 GiB
  churned at a pegged GPU, and cannot reproduce it. VRAM is not the constraint either: 16 GB
  card, ~75 MB checkpoint. The old "~170 s / 4.0–4.3 M samples" note was an older-Firefox
  measurement; the failure tracks bind-group churn, not duration, and arrives in seconds.
- **Chromium/Dawn runs the same audio clean (19:46).** Disposing the engine and loading a new one
  gives a new device and a fresh heap, which is why the workaround works. That is why
  `settings.device` defaults to `cpu` and the options page warns when WebGPU is picked; do not
  raise the default without re-measuring, and treat WebGPU as short-utterance only until the
  upstream fix lands. Observe the failure with `about:logging` and the `WebGPU` preset — the
  `CanvasRenderer` thread of the GPU process carries the log.
- **The 40m models are gated on Hugging Face.** `hf://` URLs cannot be used from the browser (no
  token); the extension reads the bundled 31m checkpoint and models imported through the options
  page.
- **An empty `settings.modelName` means the bundled checkpoint.** `describeModel` returns
  `source: "bundled"` and `buildSpec` resolves `models/phonon-31m-en/…` with
  `browser.runtime.getURL`; a non-empty name is an imported IndexedDB record. The bundled files
  are copied into `src/models/` by `scripts/package-assets.mjs` and gitignored, so loading `src/`
  in `about:debugging` without that copy leaves the model missing.
- **Imported models become blob URLs in the background page, never in the options page.** A blob
  URL dies with the document that created it, and the background page is what restarts and
  reloads the model. `disposeEngine` must revoke `state.blobUrls`, and a failed load must revoke
  the URLs it just made. Library voices are blob URLs too and go in the same list; the bundled
  model's own files are extension URLs and add none.
- **Voices are a global library, not part of a model.** They live in the `voices` store of the
  same IndexedDB (v2). A voice name the model already has (`default` on every checkpoint)
  shadows the library one: `describeModel` leaves it out of `voices`, `buildSpec` skips it, and
  the UI marks it. `settings.voice` may name either kind.
- **The engine's voice list is fixed when it loads.** If the library changes afterwards, the
  loaded spec still only knows the old names, and a newly selected voice would silently fall
  back to `default`. `voices-changed` disposes the engine after an import/delete, and `speak`
  also checks `store.getVoice` for a wanted voice the engine lacks (belt and braces). Keep both.
- **Settings auto-save.** There is no Save button; selects and the temperature slider call
  `saveForm` on `change`. `refresh`/`saveForm` share a render sequence so a slow, stale reply
  cannot overwrite the form (this bit the post-import model selection).
- **Rebuild a `<select>`'s options before setting its value.** Assigning a value that has no
  matching option silently leaves it empty; that is why an imported model used to stay
  unselected. `renderModelChoices` is called first and the value set after.
- **The options page uses the exported `store` object, not named imports,** so tests can swap
  its methods. Keep it that way; the fake-DOM tests in `tests/options.test.mjs` depend on it.
- **`renderVoices` filters on `voiceQuery`** (name, language, description) and re-renders from
  `currentModel`, so typing does not round-trip to the background. Importing a voice clears the
  filter so the new rows are visible.
- **A model's languages come from its imported `config.json` blob** (`describeModel`), so the
  page can warn before anything is loaded. The bundled 31m reports `["en"]` without reading
  anything. The language is a load option: changing it must dispose the engine (it is in
  `needsReload`) and rebuild on the next Speak.
- **Speaking rate is the model's `duration_delta` conditioner**, passed at load as
  `conditions: { duration_delta: x }` (negative faster, positive slower). It is also in
  `needsReload`. The slider's −0.5…+0.5 range is empirical: ±0.4 moved a 5.2 s sentence to
  4.4 s / 5.8 s; values past ±1 got less predictable, so do not widen it without listening.
- **Voice names come from the catalog's `voices.jsonl`, not the file names.** Catalog files are
  named by voice id (`NbpkqMVS3CJeq2j8.safetensors`), so dropping the listing loses only the
  friendly names. `voices.json` (the model manifest) is accepted as a fallback.
- **The model importer filters.** Only `config.json`, `tokenizer.json`, one weights file
  (`model.q8.gguf` or `model.safetensors`) and the voices the manifest names are stored. Do not
  go back to copying the whole repo: `hf download` pulls ~260 MB of extra quants and
  `tokenizer.model`.
- **`putVoices` writes blobs in one transaction.** Adding the 100-voice catalog is ~26 MB; keep
  it batched or IDB will crawl.
- **`unlimitedStorage`** is in the manifest because an imported checkpoint is ~75 MB of
  IndexedDB plus the voice library. Do not remove it.
- **Pauses come from punctuation, not from line breaks.** The runtime normalizes whitespace, so
  a newline between a heading and its paragraph is read straight through; a full stop is what
  makes the pause (measured on the 31m model: ~0.5 s after a period, ~0.3 s without one).
  `readSelection` in `src/selection.js` is sent to the page by `scripting.executeScript`, which
  serializes its source: it must stay self-contained, with no imports or references to other
  module bindings. `prepareSpeechText` closes every block that is followed by another one as a
  sentence; the last block keeps its own ending. The context menu reads the page too;
  `info.selectionText` is only the fallback where scripting is not allowed.
- **`cache: false`** on `PhononTTS.load`: the checkpoint is local, so Cache API copies are pure
  duplication.
- **Firefox MV3 CSP needs `'wasm-unsafe-eval'`** in `content_security_policy.extension_pages`, or
  the runtime cannot compile its wasm. `worker.js` is a module worker; `script-src 'self'` covers
  it.
- **`default-voice.safetensors` is the voice named `default`**; the runtime has no built-in
  voice. A manifest with voices but no `default` key makes the first voice the default.
- **`npm run bench` bypasses phonon-tts** and talks to the vendored wasm module directly, so it
  works in Node where `Worker`/`AudioContext` do not.
- The model speaks 24 kHz mono, 80 ms frames. `player.js` holds ~300 ms before scheduling the
  first chunk; generation is normally much faster than playback.

## Licences

- The extension is MIT: root `LICENSE` and `src/LICENSE` (the latter ships in the XPI).
- The vendored runtime is MIT OR Apache-2.0; keep `src/vendor/phonon-tts/LICENSE-MIT` and
  `LICENSE-APACHE` inside the package. `npm run vendor` copies them.
- The Rust crates linked into both wasm builds are covered by upstream's
  `THIRD_PARTY_LICENSES.md`, which `phonon-tts` has shipped since 0.4.2. `npm run vendor` copies
  it unchanged to `src/vendor/phonon-tts/`; this repository keeps no crate list or renderer of its
  own. `npm test` checks the copy against the installed package and that every crate has a version
  and a licence text.
- The bundled `phonon-31m-en` weights, tokenizer and default voice are Apache-2.0 and ship in
  the XPI. The licence text is `src/vendor/phonon-tts/LICENSE-APACHE` and the attribution is
  `THIRD_PARTY_NOTICES.md`, copied in at build time. The 40m weights are CC BY-NC 4.0
  (non-commercial) and must not be bundled; the voice catalog is Apache-2.0.
- Review the notices when the inputs change, not on a schedule:
  - `phonon-tts` bump: re-read its `LICENSE-*`, README and `THIRD_PARTY_LICENSES.md`; the crate
    notices travel with the package, so `npm run vendor` is the only step.
  - checkpoint refresh or replacement: run `npm run check-model`, confirm the licence and update
    the repository and commit pin plus the Pocket TTS/Mimi attribution.
  - a new shipped asset under `src/`: record its origin and terms.
  - before signing: `src/THIRD_PARTY_NOTICES.md` must match the root file, and the pinned commit
    must be the one `models/` came from. `npm run build` copies the notices; running
    `scripts/sign.mjs` alone signs whatever `src/` already holds.

### Rust notices

Upstream writes `THIRD_PARTY_LICENSES.md` in `make build` through `ptts-wasm/about.toml`
(`Apache-2.0` first, `--fail` on anything unlisted) and declares it in `js/package.json`'s
`files`; 0.4.2 was the first release to carry it. It lists 157 crates — the 146 linked ones plus
the proc-macro crates — which is why it replaced this repository's cargo-about inventory,
`third-party/xn-ptts-<version>.json` and `scripts/rust-licenses.mjs`. Both are in git history if a
future package drops the file; that pipeline needed Rust, crates.io and the upstream tag, so it
never ran inside `npm run build`.
