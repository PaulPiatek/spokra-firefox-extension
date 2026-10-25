# Spokra

A Firefox extension that reads selected text aloud, entirely inside the browser: no server, no
API key, no network at runtime.

## What it does

- **Toolbar button** — speaks the current selection; click again (or right-click → **🔇 Stop
  Spokra**) to stop.
- **Context menu** — **🔊 Spokra** on any selection.
- **Streams** — the first audio starts as soon as the first 80 ms frame is generated; the rest
  keeps generating while it plays.
- **Runs on the CPU** by default; on a typical laptop the CPU build is around 5× faster than
  real time, single-threaded. **WebGPU** is opt-in and marked experimental: Firefox runs out
  of graphics memory after about three minutes of audio, so it is only useful for short texts.
- **Options page** — import the model folder, import voices, language, device, temperature,
  speaking rate, and a Speak button for trying a sentence.

The model uses about 100 MB of memory while loaded. Firefox terminates idle extension
background pages, so after a long pause the next click reloads the checkpoint (well under a
second from the extension package) and then speaks.

The extension ships the English **Phonon 31M** checkpoint, so it speaks out of the box. Other
checkpoints, such as the multilingual 40m, are imported once as described below.

## Setup

### 1. Get the model files

You only need this for a checkpoint other than the bundled English 31M. The multilingual 40m
repo is gated, so accept its terms on
[huggingface.co/gradium/phonon-40m-multilingual](https://huggingface.co/gradium/phonon-40m-multilingual)
first. The extension reads only these four files:

| File | Size |
| --- | --- |
| `config.json` | 2.9 KB |
| `tokenizer.json` | 278 KB |
| `model.q8.gguf` | 74.6 MB |
| `default-voice.safetensors` | 256 KB |

**With the Hugging Face CLI.** Install it with `pip install -U huggingface_hub`, or run it without
installing via [`uvx`](https://docs.astral.sh/uv/guides/tools/). Log in once with `hf auth login`
(or set `HF_TOKEN`), since the model is gated.

Download the whole repository (~260 MB — it also contains `model.q4k.gguf`, `model.safetensors`
and `tokenizer.model`, which the extension ignores):

```powershell
hf download gradium/phonon-40m-multilingual --local-dir models/phonon-40m-multilingual
```

Or download only the four files the extension reads (~75 MB):

```powershell
hf download gradium/phonon-40m-multilingual `
  config.json tokenizer.json model.q8.gguf default-voice.safetensors `
  --local-dir models/phonon-40m-multilingual
```

`uvx` works the same way: `uvx hf download gradium/phonon-40m-multilingual ...` (the `hf` PyPI
package is the CLI; `uvx --from huggingface_hub hf ...` is equivalent). It caches the tool, so
later runs are instant.

**Without the CLI**, the bundled script downloads the same four files and writes `voices.json`:

```powershell
$env:HF_TOKEN = "hf_..."        # read token from https://huggingface.co/settings/tokens
npm install
npm run fetch-model             # -> models/phonon-40m-multilingual
```

The script skips files that are already there, so it is safe to re-run. `npm run fetch-model --
--help` lists the options.

**Another checkpoint**: the whole Phonon family works the same way. The public English
`phonon-31m-en` is useful for a quick smoke test:

```powershell
hf download gradium/phonon-31m-en --local-dir models/phonon-31m-en
# or: npm run fetch-model -- --repo gradium/phonon-31m-en --out models/phonon-31m-en
```

### 2. Import it in the extension

Open the extension's **Settings** → **Model** → **Import a model folder…** and pick the folder
holding the four files (and `voices.json` / `voices/` if you have them). Firefox copies the files
into the extension's own storage once; after that they work offline. **Delete** removes the copy,
and importing again replaces it, so re-import after replacing the files.

The model name is the folder name, so two checkpoints from differently named folders can be
switched between in the dropdown.

Browsers never give an extension a durable path to a folder on disk: a picker hands over the
*contents*. Copying them into the extension's storage is what makes "pick once, use forever"
possible. Nothing is uploaded anywhere.

### 3. Add voices (optional)

Every checkpoint brings one `default` voice. More voices are small `.safetensors` files (about
256 KB each) from the public
[gradium/phonon-voices](https://huggingface.co/gradium/phonon-voices) catalog (~100 voices) or
Gradium Studio.

Download the whole catalog (~34 MB; it also contains `samples/`, which the extension ignores):

```powershell
hf download gradium/phonon-voices --local-dir models/phonon-voices
```

Or only the voices and their names (~25 MB):

```powershell
hf download gradium/phonon-voices `
  --include "voices/*.safetensors" --include "voices.jsonl" `
  --local-dir models/phonon-voices
```

Then **Settings → Voices → Folder…** and pick `models/phonon-voices` (the folder with
`voices.jsonl`). Or use **Import voice files…** for a handful of `.safetensors`. Names,
languages and descriptions come from `voices.jsonl`; a file without it falls back to its file
name (catalog files are named by voice id, so the listing is worth including).

Voices are stored in the browser and **shared by every imported model** — the file format is the
same across the Phonon family. `Use` selects one, `Preview` speaks the text in the Try-it box
with it without changing the saved voice, and `×` deletes it. With many voices, the **Search**
box filters the list by name, language or description. A model's own voice wins over a library
voice with the same name (every checkpoint has `default`). Importing a voice while a model is
loaded rebuilds that model on the next Speak, so the new voice is used immediately.

The browser build speaks ready-made voices only; voice cloning is not available.

If you would rather keep a voice inside a checkpoint, `npm run fetch-model -- --voice Zoey`
downloads it into the model folder, and importing that folder brings it along.

### 4. Load the extension

`about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → pick
`src/manifest.json`. Run `npm run build` once first: it copies the runtime, the notices and the
bundled checkpoint into `src/` (all generated, none tracked). For a signed install, `npm run sign`
runs that build and then signs the XPI into `web-ext-artifacts/` (about 60 MB); imported models
still live in browser storage.

### 5. Check it

In **Settings**, pick the language of the text you read, then press **Speak** in the "Try it"
card. The status line reports load progress and the device the model is running on. The Model
card names the checkpoint in use and lists its languages.

Every setting saves as soon as it changes — there is no Save button.

## Usage

Select text on any page, then:

- click the toolbar button, or
- right-click → **🔊 Spokra**.

Click the button again, or right-click → **🔇 Stop Spokra**, to stop.

The selection is read from the page's HTML rather than its flattened text: a heading, list
item, table cell or `<br>` ends a sentence even when it has no full stop of its own. The model
pauses at sentence ends, so that is what puts a pause after a headline. Pages the extension may
not script fall back to the plain selection text.

Right-click the toolbar button → **Spokra Settings…** opens the options page.

The **Language** setting is the language of the *text*, not of the UI: it decides how numbers,
dates and symbols are read. Phonon 40m multilingual speaks English, French, German, Spanish and
Portuguese. Use **None** to pass text through as written. Changing it reloads the model on the
next Speak (the language is fixed when the model loads). The Model card lists the languages the
checkpoint was trained for and warns when the selected one is not among them.

**Speaking rate** maps to the model's `duration_delta` conditioner: negative is faster, positive
slower (the slider covers −0.5 to +0.5, with 0.0 as the checkpoint's default). Like the language,
it is fixed when the model loads, so changing it reloads the model on the next Speak. Around
±0.4 changes a five-second sentence by roughly a second; it adjusts duration and pacing, not
pitch.

## Diagnostics

- `npm test` — the Node test suite (settings, model spec, playback scheduling, and the
  background flow with a fake engine).
- `npm run bench -- --model models/phonon-31m-en --voice Zoey --duration -0.3` — loads a model
  through the wasm build and writes `bench.wav`, printing load time and speed relative to real
  time. Useful to check a download, a voice and the speaking rate without the browser.
- **Self-test page** — in `about:debugging`, find the extension and open
  `selftest.html` from its "Inspect" page, or visit
  `moz-extension://<uuid>/selftest.html`. It speaks one sentence through the real background
  pipeline and prints device, threads, sample rate and features.
- `npm run lint` - `web-ext lint` (must stay at 0 errors/warnings).
- `npm run check-model` — hashes `models/phonon-31m-en/` against the commit pinned in
  `THIRD_PARTY_NOTICES.md` and reports whether upstream has a newer checkpoint. Needs the
  network; exits non-zero when the local files do not match the pin.
- `npm run build` - clean, re-vendor the runtime, copy the notices and checkpoint, then lint and
  test. It leaves `src/` ready to load and produces no XPI; `npm run sign` does the signing.
- `npm run clean` - removes the generated copies in `src/` (runtime, notices, checkpoint) and
  any unsigned zips left in `web-ext-artifacts/`; signed XPIs are kept. `npm run build` cleans
  first.

## Publishing

`npm run sign` builds the extension and signs it with `web-ext sign` for the **unlisted** channel
(configured in `.web-ext-config.mjs`), writing an XPI to `web-ext-artifacts/`. It prompts for an
AMO API key and secret, or reads `WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET` from the environment.
Create a key pair at [addons.mozilla.org/developers/addon/api/key](https://addons.mozilla.org/developers/addon/api/key/).

For a public AMO listing, change `sign.channel` to `"listed"` in `.web-ext-config.mjs` (or pass
`--channel=listed`); Mozilla then reviews the submission. The XPI contains the bundled 31M
checkpoint (~54 MB compressed), whose Apache-2.0 licence permits redistribution; imported models
and voices are not packaged.

## How it fits together

| Path | What it is |
| --- | --- |
| `src/background.js` | MV3 event page: menus, toolbar, model lifetime, playback, keep-alive. |
| `src/engine.js` | The only place that imports the vendored runtime; tests replace it with a fake. |
| `src/model.js` | Describes the checkpoint in use (bundled or imported) and builds the runtime's `ModelSpec`. |
| `src/model-files.js` | Validates the files from the folder picker, reads `voices.json`, keeps only what the runtime opens. |
| `src/voice-files.js` | Validates picked voice files and names them from `voices.jsonl`. |
| `src/store.js` | Imported checkpoints and voices in IndexedDB, listed and deleted from the options page. |
| `src/player.js` | Schedules streamed `Float32Array` chunks on one 24 kHz `AudioContext`. |
| `src/selection.js` | Reads the page selection block by block and closes each block as a sentence for the model. |
| `src/settings.js` | Language, voice, device, temperature, imported model name. |
| `src/options.*` | Settings UI, model import/delete, live status. |
| `src/vendor/phonon-tts/` | [`phonon-tts`](https://www.npmjs.com/package/phonon-tts) 0.4.2, copied from `node_modules` by `npm run vendor` (generated, not tracked). Plain ES modules plus the wasm builds and the notices for the Rust crates linked into them. |
| `scripts/fetch-model.mjs` | Downloads a checkpoint (and voices) from Hugging Face into `models/`. |
| `scripts/package-assets.mjs` | Copies the notices and the bundled checkpoint into `src/` before `web-ext` packs it. |

An imported model lives in IndexedDB as `Blob`s, and so does the voice library. The background
page reads them when the model loads and makes `blob:` URLs for the runtime, which only accepts
URLs; the URLs are revoked when the model is replaced. That is why the import happens in the
options page but the URLs are made in the background: a blob URL dies with the page that
created it. Model voices are used first; a library voice with a name the model already has is
skipped. The bundled checkpoint needs no storage: its files are resolved straight from the
extension package with `browser.runtime.getURL`.

The runtime needs WebAssembly SIMD (all current Firefox, Chrome, Safari). Threads are not
available in extension pages, because those are not cross-origin isolated; the model runs on one
CPU thread by default, or on WebGPU when that is selected explicitly.

## Licence

The extension is **MIT licensed** — see [LICENSE](LICENSE). The bundled runtime (`phonon-tts`, in
`src/vendor/phonon-tts/`) is MIT OR Apache-2.0; its licence texts ship with it, together with
upstream's `THIRD_PARTY_LICENSES.md`, which covers the Rust crates statically linked into the two
WebAssembly builds.
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) lists the third-party terms.

The bundled English `phonon-31m-en` checkpoint (weights, tokenizer and default voice) is
**Apache-2.0**, so it ships in the package. The multilingual 40m weights are **CC BY-NC 4.0**
(non-commercial) and are not packaged; the `gradium/phonon-voices` catalog is Apache-2.0.

Phonon builds on Kyutai's Pocket TTS and Mimi codec, whose weights are CC BY 4.0;
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) records that provenance alongside the terms of
the bundled checkpoint.

### When to review the notices

The notices are checked whenever what ships changes, not on a calendar:

- **A new `phonon-tts` version** (`npm run vendor`): read the package's `LICENSE-*` files and its
  README again. Since 0.4.2 the package ships upstream's `THIRD_PARTY_LICENSES.md`;
  `npm run vendor` copies it unmodified into `src/vendor/phonon-tts/`, and `npm test` checks that
  the copy matches the installed package and that no crate is left without a licence.
- **A different or refreshed checkpoint** (`npm run fetch-model`, or replacing `models/` by
  hand): run `npm run check-model`, confirm the licence and update the repository and commit pin
  in `THIRD_PARTY_NOTICES.md`, including the Pocket TTS and Mimi attribution.
- **A new asset under `src/`** (icons, fonts, sounds, binaries): record where it came from and
  under which terms.
- **Before `npm run sign`**: `src/THIRD_PARTY_NOTICES.md` must match the root file, and the
  pinned commit must be the one the bundled files came from. `npm run build` copies the notices;
  invoking `scripts/sign.mjs` on its own signs whatever `src/` already holds.
