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
**EdgeFace (MIT)** fallback. `download-models.sh` fetches each artifact and
checks it against the digest below, failing hard on any mismatch — including
for files left over from a previous run.

| Artifact | Size | SHA-256 |
|---|---|---|
| `blaze_face_short_range.tflite` (float16 v1, MediaPipe, Apache-2.0) | 224 KB | `b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f` |
| `mobilenet_v3_small.tflite` (float32 v1, MediaPipe, Apache-2.0 — spike proxy only) | 4.1 MB | `bbbb4c51a55a53905af1daec995ca1aae355046f8839bb8c9f5ce9271394bc40` |
| `face_recognition_sface_2021dec.onnx` (OpenCV Zoo @ `f88e9b2` / tag 4.10.0, Apache-2.0) | 36.9 MB | `0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79` |

The two MediaPipe URLs carry `/1/` version segments and are immutable. SFace is
pinned to the commit tagged `4.10.0` rather than `main`, since `main` moves and
this is the checkpoint that becomes the production embedder.

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

## Running the spike

```bash
./download-models.sh          # fetch + verify pinned model artifacts (not in git)
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

- `download-models.sh` — pinned artifact fetcher + SHA-256 verifier (writes to `spike/models/`)
- `spike/` — self-contained LiteRT.js benchmark (static server + page);
  `node_modules/` and `models/` are git-ignored, `package-lock.json` is committed
  so the measured runtime version is reproducible
- (Phase 1 will add conversion scripts + the evaluation harness here)
