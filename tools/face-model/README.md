# Face model tooling — browser face check-in

Phase 0 (environment spike) artifacts for the browser-based face-embedding
check-in feature. See [docs/face-checkin-plan.md](../../docs/face-checkin-plan.md)
for the full plan.

## Phase 0 results (2026-07-10)

### Perf smoke test — PASS

LiteRT.js (`@litertjs/core@2.5.2`) hello-world benchmark, run on a MacBook
(8 hardware threads, WebGPU available), Chromium 148. 5 warmup + 50 timed
runs per cell; timing includes output readback to CPU (without readback,
WebGPU numbers only measure command submission and read ~5x faster than
reality).

| Model | Backend | Fully accelerated | Load+compile (ms) | Mean (ms) | p50 (ms) | p95 (ms) |
|---|---|---|---|---|---|---|
| blaze_face_short_range (detector, 224 KB) | wasm | true | 10.2 | 11.2 | 9.2 | 22.7 |
| blaze_face_short_range (detector, 224 KB) | webgpu | true | 88.7 | 2.2 | 2.1 | 3.5 |
| mobilenet_v3_small (embedder-size proxy, 4.1 MB) | wasm | true | 41.0 | 19.5 | 19.3 | 25.2 |
| mobilenet_v3_small (embedder-size proxy, 4.1 MB) | webgpu | true | 143.9 | 4.7 | 4.7 | 6.2 |

> **⚠️ These numbers predate a `bench.js` correction and are a lower bound.**
> The run above read only the *first* output tensor back to CPU inside the timed
> region. BlazeFace emits two, so its detector row undercounts readback cost.
> `bench.js` now reads every output back. Re-run and replace this table (paste
> `window.__benchResults` verbatim) before treating these as the Phase 0 record.
> The verdict below has enough headroom that the conclusion is not in question,
> but the exact figures are.

**Verdict:** detector + embedder-class inference is ~24 ms/frame on plain
single-threaded WASM and ~7 ms/frame on WebGPU — comfortably within the
continuous-scanning budget on both backends. No COOP/COEP/threaded-WASM
escalation needed (plan Section 6.1): single-thread XNNPACK is sufficient.

Notes:
- **The WASM rows really are single-threaded.** LiteRT.js only loads its
  `litert_wasm_threaded_internal.js` build when `loadLiteRt` is passed
  `{threads: true}`; `bench.js` passes no options, so it always gets the
  single-threaded `litert_wasm_internal.js` regardless of whether
  `SharedArrayBuffer` happens to be available. The spike server therefore sends
  no COOP/COEP headers — cross-origin isolation would not change what is
  measured, and omitting it keeps the spike a faithful mirror of the production
  backend, which also won't set them.
- The embedder measured here is a **size-class proxy** (MediaPipe MobileNetV3-small
  image embedder), not the production embedder — the real SFace → `.tflite`
  conversion is Phase 1. MobileNet-class conv workload at similar parameter
  count is a fair latency stand-in.
- LiteRT.js integration gotcha for Phase 3/4: the `@litertjs/core` ESM bundle
  imports the bare specifier `@litertjs/wasm-utils`. Outside a bundler (CRA
  will handle it in `client/`), it needs an import map. The runtime's `wasm/`
  directory must be served same-origin (`loadLiteRt('/litert-wasm/')`).
- `Tensor.moveTo(...)` **consumes its source** — it copies, then deletes the
  original. Do not `delete()` a tensor you have already moved.

### Model checkpoint pick

Per plan Section 1.1: **SFace (OpenCV Zoo, Apache-2.0)** primary,
**EdgeFace (MIT)** fallback. Pinned artifacts (fetched by
`download-models.js`, SHA-256 verified):

| Artifact | Size | SHA-256 |
|---|---|---|
| `blaze_face_short_range.tflite` (float16 v1, MediaPipe, Apache-2.0) | 224 KB | `b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f` |
| `mobilenet_v3_small.tflite` (float32 v1, MediaPipe, Apache-2.0 — spike proxy only) | 4.1 MB | `bbbb4c51a55a53905af1daec995ca1aae355046f8839bb8c9f5ce9271394bc40` |
| `face_recognition_sface_2021dec.onnx` (OpenCV Zoo, Apache-2.0) | 36.9 MB | `0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79` |
| `face_detection_yunet_2023mar.onnx` (OpenCV Zoo, MIT — eval harness only) | 227 KB | `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4` |

The two OpenCV Zoo ONNX files are pinned to opencv_zoo commit `47534e2`, not
the moving `main` branch, and `download-models.js` re-verifies every artifact's
SHA-256 on each run (a mismatched local copy is re-fetched, then hard-fails if
it still doesn't match).

**SFace checkpoint drift (root cause + fix):** `onnx2tf` rewrites its `-i`
input file **in place** — several internal stages (op-name auto-generation via
sng4onnx, graph re-export, and onnxsim when its CLI is reachable) each
re-serialize the model back to the input path. The result is weight-identical
to the input but has a different SHA-256 (e.g. `827d2b58…`, 38,692,565 B vs the
pinned `0ba9fbfa…`, 38,696,353 B; the exact re-serialized bytes are even
environment-dependent). Running `convert.py` therefore used to silently drift
the pinned SFace checkpoint off its recorded hash on every run. Verified
equivalent in onnxruntime (cosine 1.0, max|Δ| 2e-6 over 5 seeds), so no
downstream artifact was wrong — but the on-disk checkpoint no longer matched
its pin. `convert.py` now converts a **disposable copy** and never touches the
pinned file; `download-models.js`'s verify-and-refetch is the backstop that
catches any residual drift.

**Build determinism (onnxsim):** onnx2tf shells out to the `onnxsim` CLI, and
whether it runs changes the output `.tflite` bytes. Its presence on PATH is
environment-dependent — the venv is used by full path, not activated, so
`.venv/bin/onnxsim` isn't found and onnx2tf logged "Failed to optimize" while
proceeding without it. `convert.py` now passes `-n` (`--not_use_onnxsim`) to
pin the build to the validated onnxsim-off artifacts (fp32 `f2fde3b5…`, int8
`c74fc6be…`) regardless of PATH, rather than depending on whether a console
script happens to be reachable. onnxsim's simplification is marginal for SFace
(already a clean graph) and fp32 fidelity vs the ONNX is 1.0.

**⚠️ Phase 0 finding for Phase 1:** the SFace ONNX checkpoint is **36.9 MB
fp32** — not the ~4–5 MB the plan's Section 1.2 table assumed for a
MobileFaceNet-class model. Even with full int8 quantization (~4x) it lands
around ~9 MB, well above the 1–2 MB target. This is not a Phase 0 blocker
(the model is served once over localhost and cached), but Phase 1 must
either (a) confirm the converted/quantized SFace size and latency are
acceptable, or (b) move to the EdgeFace-XS/-S fallback, which is genuinely
in the 1–2 MB int8 class. Latency-wise the spike suggests even a ~10x-proxy
model would still fit the budget on WebGPU, so accuracy — not speed — should
drive the Phase 1 decision.

## Phase 1 results (2026-07-10)

### Conversion pipeline — WORKING

`convert.py`: SFace ONNX → onnx2tf (v2) → NHWC fp32 `.tflite` → AI Edge
Quantizer → dynamic-range int8 `.tflite`, with a fidelity gate comparing
embeddings against onnxruntime on identical inputs.

| Artifact | Size | Fidelity vs ONNX (noise inputs) |
|---|---|---|
| `face_embedder_v1_fp32.tflite` | 38.5 MB | cosine 1.0 — exact |
| `face_embedder_v1_int8.tflite` (dynamic-range) | 9.9 MB | cosine min 0.983 (WARN — but see EER parity below) |

Pipeline gotchas discovered (all handled in `convert.py` / `requirements.txt`):
- onnx2tf needs `tf_keras`, `protobuf<5`... — the venv pins in
  `requirements.txt` are load-bearing, not suggestions.
- onnx2tf v2 emits `.tflite` directly (no SavedModel intermediate). Its own
  `-odrqt` dynamic-range output (default `flatbuffer_direct` backend) produced
  **garbage embeddings (cosine ~0.08)** — the fidelity gate caught it. AI Edge
  Quantizer on the verified fp32 `.tflite` is the correct quantization path.
- SFace expects **raw 0–255 BGR input** — normalization is baked into the
  graph. Feeding `(x-127.5)/128` (usual ArcFace convention) wrecks it
  (EER 45% vs 5%). Phase 3/4 client code must not normalize.

### Browser benchmark of the converted models (LiteRT.js, 50 runs)

| Variant | WASM mean | WebGPU mean |
|---|---|---|
| fp32 (38.5 MB) | 27.2 ms, fully accelerated | 9.6 ms, fully accelerated |
| int8 DR (9.9 MB) | **322 ms, NOT accelerated** | 11.5 ms, fully accelerated |

- **`loadLiteRt` must pass `{ jspi: true }`** (when `'Suspending' in
  WebAssembly`): without it both converted models throw
  `ReferenceError: Asyncify is not defined` on the WebGPU backend.
- Dynamic-range int8 did not delegate to XNNPACK on the WASM backend in this
  run — 8–12x slower than fp32 on CPU. **v1 recommendation: ship fp32**
  (works on both backends, one artifact, 38.5 MB served once over localhost
  and cached).
  - **Caveat (confound):** `{ jspi: true }` selects a different WASM runtime
    build (`litert_wasm_jspi_internal.js`) globally, for *both* backends — so
    this int8-on-WASM number was measured on the JSPI build, not the plain
    build the Phase 0 table used. Before treating "int8 is slow on WASM" as
    settled, re-benchmark int8 on WASM with `{ jspi: false }` to rule out
    that the JSPI build simply lacks the XNNPACK dynamic-range kernels. If
    int8 delegates fine without JSPI, prefer per-backend runtime selection
    (plain WASM + JSPI WebGPU) over abandoning quantization. The fp32
    recommendation stands regardless (fp32 is within budget on both), but the
    *reason* to drop int8 is not yet confirmed.

### Evaluation harness + provisional threshold

`evaluate.py`: LFW pairs (HF mirror `logasja/lfw` — the figshare/UMass hosts
sklearn uses are dead) → YuNet detect → SFace alignCrop → tflite embed →
FAR/FRR sweep. 2200 pairs, zero detection failures.

| Embedder | EER | @ FAR 0.09% | Recommended threshold |
|---|---|---|---|
| fp32 | 5.18% | FRR 6.5% | 0.343 |
| int8 DR | 5.09% | FRR 6.7% | 0.359 |
| OpenCV reference (control) | 5.24% | FRR 5.7% | — |

- **Quantization costs nothing on real faces** — int8 EER matches fp32.
- The control run proves our tflite path **exactly matches OpenCV's reference
  implementation** (5.24% vs 5.18% EER — noise). The gap vs SFace's published
  LFW figure (~99.4%) is this mirror's harder/different pair protocol, not a
  conversion bug.
- **Provisional *verification* threshold: 0.34** (fp32). This is a 1:1
  verification number from the LFW pairs protocol — **not** the 1:N
  identification `face_match_threshold`. Check-in takes the top-1 match across
  the whole gallery, so an impostor gets one shot per enrolled member and the
  per-encounter FAR compounds with gallery size (at the measured ~0.09%
  per-comparison FAR: ~9% at 100 members, ~36% at 500). Re-derive against the
  gym's own gallery with a joint threshold + top1–top2 margin sweep before
  adopting it (plan Sections 1.2 / 8.3).
- **FAR resolution:** the "FAR ≈0.1%" above is a *single* false-accepting pair
  out of 1100 — its exact 95% CI reaches ~0.5%. 1100 negatives cannot resolve
  a 0.1% target; `evaluate.py` now reports the raw false-accept count, the
  denominator, and a Wilson CI, and refuses to present a sub-resolution target
  as "met."
- **FRR caveat:** measured single-image FRR ~6.5% is above the plan's 2–3%
  target. The production accept rule does **not** straightforwardly lower it:
  requiring K consecutive frames to *all* match and adding a top1–top2 margin
  both *raise* per-attempt FRR; only the retry loop (repeated attempts while
  standing at the camera) lowers effective FRR — and it does so by granting an
  impostor repeated independent attempts, which *raises* effective FAR in the
  same motion. Both directions must be measured in shadow mode, not assumed.

## Running the pipeline

```bash
node download-models.js                  # pinned artifacts (not in git)
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt
.venv/bin/python convert.py               # ONNX -> fp32 + int8 tflite + fidelity gate
.venv/bin/python evaluate.py              # LFW FAR/FRR -> recommended threshold
.venv/bin/python evaluate.py --norm opencv  # reference-implementation control
```

## Running the spike

```bash
node download-models.js       # fetch + verify pinned model artifacts (not in git)
cd spike && npm ci
npm start                     # http://localhost:4173 — benchmark auto-runs
```

The server binds loopback only — it serves `node_modules/`, so it must not be
reachable on the LAN.

Results render as a table and are exposed as
`window.__benchResults = { done, fatal, rows }` for automation (same shape on
success and failure; poll `done`). Run it on the actual front-desk machine to
validate representative hardware, not just dev hardware, and paste the resulting
`rows` JSON into the results table above so the decision record has provenance
rather than transcribed numbers.

## Layout

- `download-models.js` — pinned artifact fetcher + SHA-256 verifier (writes to `spike/models/`)
- `spike/` — self-contained LiteRT.js benchmark (static server + page);
  `node_modules/` and `models/` are git-ignored, `package-lock.json` is committed
  so the measured runtime version is reproducible
- `convert.py` — Phase 1 SFace ONNX → `.tflite` conversion + fidelity gate
- `evaluate.py` — Phase 1 LFW FAR/FRR evaluation harness
- `requirements.txt` — pinned Python env for the Phase 1 pipeline
