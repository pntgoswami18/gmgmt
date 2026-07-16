# Implementation Plan: Browser-Based Face-Embedding Check-In (LiteRT.js)

**Companion/fallback to the ESP32 fingerprint system in gmgmt + client**

**Deployment target: front-desk desktop or laptop with a connected/built-in webcam** (not a mounted tablet kiosk — revised from initial draft, see revision notes at bottom).

**Interaction model: fully automated.** A member walks up, the camera detects and matches their face without any staff action, and — subject to authorization and membership-plan validity — the **physical door unlocks automatically**. This is a scope change from an earlier staff-initiated-scan draft: it turns this feature into real physical access control, not just an attendance-logging fallback, and raises the bar on liveness and fail-closed behavior accordingly (see Sections 3, 5, 6).

---

## 0. Architecture Summary (the recommendation, up front)

- **Two-stage on-device pipeline** in the browser: a tiny face detector/landmarker (alignment + blink liveness signal) feeding a **MobileFaceNet-class embedding model (int8-quantized `.tflite`, ~1–2 MB)** run via LiteRT.js, WebGPU when available, WASM/XNNPACK otherwise.
- **Embeddings are computed client-side in all flows** (enrollment and matching). Raw camera frames never leave the browser. The server stores only embedding vectors — the same privacy posture the fit assessment called out.
- **Matching happens locally in the browser** against an embedding cache synced from the backend — deliberately mirroring the existing ESP32 "hybrid cache" pattern (`/cache-update` + local validation) that already gets fingerprint unlock under 1 s.
- **The server remains the authority.** A local match is a *claim*; a new `POST /api/biometric/face/check-in` endpoint re-validates active status/plan/session windows server-side and then drives the *same* attendance/notification pipeline as `handleAccessGranted`, via an extracted shared service — and, on success, **commands the physical door lock** using the existing `unlockDoorRemotely()` mechanism (Section 3.4). Nothing unlocks on the strength of a client-side match alone.
- **Liveness is a v1 requirement, not a later phase.** With the design now fully automated — no staff member confirming a match before anyone walks in — a spoof that fools the matcher fools the door. The layered approach (multi-frame consistency + blink/head-turn challenge) ships in v1; the passive texture anti-spoof model is still a Phase 2 addition, but the challenge step is not optional the way it could have been when a human was in the loop.
- **Fail closed.** Any uncertainty — low-confidence match, liveness inconclusive, model/camera error, server unreachable — means the door stays locked and the member sees a "not recognized, please see the desk" state. There is no ambiguous middle ground for something that controls a physical lock.
- Model artifacts are **served by the gmgmt backend itself, not a CDN** — this product deploys on a LAN server. A CDN dependency would break the offline-LAN deployment model.

**Resolved:** the front-desk desktop/laptop is the same machine that runs the gmgmt server, accessed via `http://localhost:PORT`. Browsers exempt `localhost` from the secure-context requirement that `getUserMedia` normally enforces, so **no HTTPS/certificate work is needed at all**. This removes what would otherwise have been the biggest Phase 0 blocker (a separate kiosk device hitting the server over plain-HTTP LAN would have needed a cert + trust setup). One consequence worth designing for: because this is single-machine-per-install, the "sync to a kiosk" language in Section 3.3 is really "sync to a browser tab on the same box as the DB" — still worth keeping as an HTTP round-trip (keeps client/server cleanly separated and the pattern reusable if a second location or device is ever added), but it's no longer covering a genuinely remote/offline device.

---

## 1. Model Selection & Conversion Strategy

### 1.1 Pipeline shape: detector → aligner → embedder (not one model)

Face embedding models expect a tightly cropped, aligned face (e.g., 112×112 for ArcFace-family models). Running the embedder on raw webcam frames destroys accuracy. So the flow needs:

1. **Face detection + landmarks** — recommend MediaPipe **BlazeFace short-range / Face Landmarker** class models. Already distributed as `.tflite` (a few hundred KB to ~3 MB), run at high fps even on CPU, and the landmarks are dual-purpose: face alignment *and* the blink/head-pose signals needed for liveness (Section 5).
2. **Embedding extraction** — **MobileFaceNet-class ArcFace model** (~1M params), 112×112 input, 128- or 512-d output embedding, cosine-similarity matching. **Decided: use a permissively-licensed checkpoint, not InsightFace.** Many InsightFace pretrained weights (including the `buffalo_sc`-class MobileFaceNet checkpoints the user's prior QAinsights ONNX experiments used) ship under a non-commercial research license, which conflicts with a commercial product — avoided entirely by not starting from InsightFace weights. Concrete recommendation: **SFace** (OpenCV Zoo, Apache-2.0), a MobileFaceNet-class model purpose-built for exactly this size/edge-deployment niche, already distributed as ONNX with a documented permissive license. **EdgeFace** (MIT-licensed, 2024) is a reasonable second option if SFace's accuracy on the evaluation harness (Section 1.3) falls short of the balanced accuracy target (Section 1.2). License terms should still be re-read at the exact pinned commit/release, not assumed from the project name alone.

Rejected alternatives: InsightFace MobileFaceNet/buffalo_sc (license conflict, per above); full ResNet50-ArcFace (~160 MB); face-api.js/tfjs models (older, weaker accuracy); single-shot "detect+recognize" models (poor accuracy at this size class).

### 1.2 Size / accuracy trade-offs

| Option | fp32 size | int8 size | Notes |
|---|---|---|---|
| MobileFaceNet (128-d) | ~4–5 MB | ~1.2–1.5 MB | Recommended start. Adequate for a gym-sized gallery (hundreds, not millions, of identities) |
| MobileFaceNet-large / MBF w/ 512-d | ~8–13 MB | ~2–4 MB | Fallback if pilot FAR/FRR is unacceptable |
| Detector + landmarker | ~1–3 MB | — | Ship as-is from MediaPipe |

The gallery is tiny (one gym's active members, typically 100–2,000). Discriminating among hundreds of known identities with a top1–top2 margin check is a far easier problem than open-set 1:N at web scale, so a small model is genuinely sufficient — verify with the offline evaluation harness in Phase 1, don't assume it.

**Accuracy target (decided): balanced.** Roughly FAR ~0.1%, FRR ~2–3% — low probability of admitting the wrong person, with an occasional legitimate member needing a retry or the manual fallback (Section 6.2). The Phase 1 evaluation harness (Section 1.3) should tune `face_match_threshold`, the K-consecutive-frames count, and the top1–top2 margin together to hit this target, then that combination gets validated for real in shadow mode (Section 8.3) before it ever gates a live door unlock.

### 1.3 Conversion path

- Primary: SFace ships as ONNX already (OpenCV Zoo) → `onnx2tf` → `.tflite` → **AI Edge Quantizer**, dynamic-range int8 first, then full int8 with a calibration set if latency demands it. This is a shorter path than a PyTorch export since there's no ai-edge-torch step required.
- Alternate: if EdgeFace (PyTorch) is picked instead per the accuracy fallback in 1.1, use **LiteRT Torch (`ai-edge-torch`)** → `.tflite` → **AI Edge Quantizer**.
- **Critical validation step:** after conversion and quantization, compare embeddings between the original model and the `.tflite` on a fixed image set (cosine similarity of same-image embeddings should be >0.99). Quantization can silently wreck embedding geometry.
- Conversion scripts live in the gmgmt repo under `tools/face-model/`, artifact checked into releases, not the git tree.

### 1.4 Artifact hosting & versioning

- **Serve from the gmgmt backend**: new static mount, e.g. `app.use('/models', express.static('public/models'))` in `src/app.js`, next to the existing `/uploads` mount. Files: `face_detector_v1.tflite`, `face_embedder_v1_int8.tflite`, plus LiteRT.js WASM assets copied into `client/public/litert-wasm/` (same-origin; the runtime resolves its `.wasm` build relative to this directory). Threading is opt-in via `loadLiteRt(path, {threads: true})` and Phase 0 measured it as unnecessary — see `tools/face-model/README.md`.
- **Manifest endpoint**: `GET /api/biometric/face/model-manifest` returning `{ modelVersion, embedderUrl, detectorUrl, embeddingDim, sha256, threshold }`. Version stored as a `settings` row (`face_model_version`), managed through `settingsCache`.
- **Client caching**: Cache API keyed by `sha256`; lazy-load only on the face-enrollment/check-in routes.
- **Version discipline:** embeddings from different model versions are incompatible. Every stored embedding row carries `model_version`. A model upgrade is a migration event — treat it as such, not a config flip.

---

## 2. Enrollment Flow

### 2.1 Client-side vs server-side embedding: **client-side**

Compute embeddings in the admin's browser during enrollment; POST only the vectors. Rationale: (a) raw face images never touch the server — the headline privacy feature; (b) enrollment and matching use the identical model binary and preprocessing, eliminating train/serve skew; (c) the server has no ML runtime today and shouldn't grow one.

### 2.2 DB schema: new table, mirroring `member_biometrics`

No ORM, raw SQL in `src/config/sqlite.js`. Do **not** overload `members.biometric_id` — it's an ESP32 sensor slot number with slot-lifecycle semantics. Add:

```
member_face_embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
  embedding BLOB NOT NULL,            -- Float32Array bytes, L2-normalized
  model_version TEXT NOT NULL,
  quality_score REAL,
  pose_label TEXT,                    -- 'front' | 'left' | 'right'
  consent_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
)
```

Multiple rows per member (3–5 poses). A tombstone column or `face_sync_log` for delta-sync deletion propagation. Settings defaults in `insertDefaultSettings`: `face_checkin_enabled='false'`, `face_match_threshold` (see below), `face_liveness_mode='challenge'`, `face_model_version=''`.

> **`face_match_threshold` default:** the original `0.55` placeholder predates any measurement and would reject nearly all genuine matches (Phase 1 measured an EER-region cosine of ~0.34 on fp32). Do **not** hardcode `0.34` either — that is a 1:1 verification number, not the 1:N identification accept threshold (see `tools/face-model/README.md`). Seed the default from a gallery-derived identification sweep in shadow mode (Section 8.3); until then treat the stored value as unset/provisional rather than authoritative.

Extend `getMembersWithoutBiometric`/`getMembersWithBiometric` with a LEFT JOIN on `member_face_embeddings`, returning per-modality flags (`hasFingerprint`, `hasFace`) rather than forking new endpoints.

### 2.3 Enrollment UI

New component `client/src/components/FaceEnrollment.js`, surfaced as a new tab inside the existing `BiometricEnrollment.js` tab structure. Reuse `SearchableMemberDropdown`, `ShimmerLoader`, MUI `Stepper`.

Steps: (1) select member, (2) camera + live quality gate (no server enrollment-mode lock needed — the browser camera isn't shared state like the ESP32), (3) auto-capture 3–5 poses, embed on-device, (4) review + consent checkbox, (5) `POST /api/biometric/members/:memberId/face-enroll` with `{ modelVersion, samples: [{embedding, pose, quality}] }`, response shape mirrors `manualEnrollment`.

Re-enrollment replaces all existing rows for the member in one transaction. `DELETE /api/biometric/members/:memberId/face` sits beside `DELETE /members/:memberId/biometric`, logs a `face_removal` row in `biometric_events`.

---

## 3. Matching Flow

### 3.1 Local matching vs backend match endpoint

**Recommendation: local matching, server confirmation.** Matching a 128-d embedding against ~2,000 members × 5 samples is sub-millisecond in plain JS, no network round trip on a latency-critical path, and degrades gracefully if the server hiccups — same architecture the ESP32 path already converged on.

### 3.2 Client — automated walk-up scanning

New route `/checkin` in `client/src/App.js`, rendered fullscreen/distraction-free (no admin chrome) even though it's a normal desktop browser tab, since it's meant to run continuously and unattended between members. The loop runs **automatically and continuously** — no staff action starts a scan:

1. Camera stream stays live on the check-in screen at all times (idle state shows a simple "walk up to check in" prompt, not a raw unstyled video feed, to keep it product-grade rather than surveillance-feed-looking).
2. Detector runs every frame (or every Nth frame if perf requires); when a face is detected and stable (not just passing through frame), the embed → match → liveness pipeline engages.
3. **Accept rule:** top-1 match for K consecutive frames (K=3) AND similarity ≥ `face_match_threshold` AND top1−top2 margin ≥ delta AND liveness challenge passed (Section 5) — *all four* gate the unlock, not just the match.
4. On accept: full-screen welcome (name, check-in or checkout confirmation per Section 3.5's toggle logic, plan status), door-unlock command fires (Section 3.4) for both directions, then a cooldown before the loop resumes scanning.
5. On reject / low-confidence / liveness failure: brief "not recognized" state, no unlock, loop resumes immediately — never blocks the next person from being scanned.
6. No manual "Start Check-In" button in the primary flow. A small, deliberately low-emphasis "having trouble? tap here" affordance still exists for the manual-fallback path (Section 6.2) — for accessibility and for members who are enrolled but consistently fail to match (lighting, camera angle, model limitations), not as the primary UX.
7. **Debounce vs. checkout toggle — these need different timers, decided:** a short (~5s) cooldown after any accepted scan prevents an immediate re-trigger from the same lingering face, but the *checkout toggle* (Section 3.5) additionally requires a minimum dwell time since check-in (recommend 15 minutes, configurable) before a second scan is treated as a checkout rather than ignored as a duplicate check-in attempt. Without this, someone pausing near the camera shortly after walking in could get flipped to "checked out" by the system re-recognizing them — a real risk once checkout-via-face is enabled that didn't exist in the check-in-only design.

New modules:
- `client/src/utils/faceEngine.js` — LiteRT.js wrapper: load WASM/WebGPU backend, load models from manifest, `detect(frame)`, `embed(alignedCrop)`.
- `client/src/utils/faceMatching.js` — pure functions: cosine similarity, top-1/top-2 margin, threshold from settings. Isolated for unit testing.
- `client/src/utils/faceCacheDb.js` — IndexedDB store for the synced gallery.

**Tailgating is a known, unaddressed limitation of this design**, worth naming explicitly rather than glossing over: once the door unlocks for a recognized member, the system has no way to stop a second person from walking in behind them (no existing gym-access-control system fully solves this without a mantrap or turnstile, and that's out of scope here). Not a blocker, but should be called out in rollout docs so it's a known trade-off, not a surprise.

### 3.3 Gallery sync

`POST /api/biometric/face/sync` mirroring `updateMemberCache`'s conventions, returning `{ memberId, name, photoUrl, isActive, modelVersion, samples, updatedAt }` plus `deletedMemberIds`. Delta via `since` timestamp. Client refreshes on load + periodically + on WebSocket `face_cache_invalidated` message (reusing the existing `/ws` connection pattern from `BiometricEnrollment.js`).

### 3.4 Physical door unlock — reuse the existing ESP32 command channel, don't invent a new one

Confirmed from the actual codebase: `gmgmt/src/services/biometricIntegration.js` already has `unlockDoorRemotely(deviceId, reason)`, which sends an `unlock_door` command (fire-and-forget, 5s actuation) to a specific ESP32 device over the same TCP command channel the fingerprint listener uses (`sendESP32Command`); the acknowledgement comes back asynchronously via the ESP32 webhook. This is *already exposed* as `POST /devices/:deviceId/unlock` for admin remote-unlock. Face check-in should call the exact same internal method, not build a second door-control path.

**Flow:** client sends its match claim to `POST /face/check-in` → server re-validates authorization/plan (Section 3.5) → on success, server calls `biometricIntegration.unlockDoorRemotely(doorDeviceId, 'face_checkin')` → response to the client only confirms the *command was sent*, not that the door physically opened (the codebase's own comment on `unlockDoorRemotely` notes the real acknowledgement comes from the ESP32 webhook, to avoid false-positive success logging — face check-in should follow the same discipline: log `door_command_sent`, treat `esp32Webhook`'s callback as the actual unlock-confirmed event, same as fingerprint does).

**New hard dependency this introduces:** unlike the attendance-logging version of this feature (which could work for gyms with zero ESP32 hardware), *automatic physical unlock* only works if there's already a registered, network-reachable ESP32 door-lock actuator for that entrance — i.e. `ENABLE_BIOMETRIC=true` and a `devices` row for it. That actuator does **not** need a fingerprint sensor attached (the firmware's relay/unlock-command handling is independent of the fingerprint-scan code path), so a gym with no fingerprint reader can still get automatic door unlock from a face check-in, but it does need the ESP32 relay/lock box installed and paired — this is a **hardware prerequisite that should be surfaced to the user during setup** (e.g. the "not enabled" state from Section 6.2 should distinguish "feature is off" from "no door-lock device is configured for this entrance").

**Config needed:** each check-in station (browser instance) needs to know *which* door it unlocks — a `door_device_id` associated with the check-in client, either a per-browser setting (localStorage-configured on first run, since it's one machine per install per the confirmed localhost deployment) or a `settings` row if there's ever more than one entrance. Single-entrance is the reasonable default to build for; multi-door is a stretch case worth a settings lookup table if it comes up, not upfront complexity.

### 3.5 Feeding the same downstream pipeline — the key refactor

Attendance/session/plan logic currently exists in three near-duplicate places (`biometricIntegration.logMemberAttendance()`, `attendanceController.performCheckIn()`, `validateBiometricId()`). A fourth copy for faces would be malpractice. Also: `BiometricIntegration` is only constructed when `ENABLE_BIOMETRIC=true` — but the primary market for this feature is gyms *without* fingerprint hardware, where that flag is off. Face check-in must not depend on the fingerprint listener being up.

Plan: extract `src/services/checkInService.js` — a plain module exposing `processCheckIn(memberId, { modality, deviceId, timestamp, matchScore })`, containing session-window check, active-plan/grace-period check, attendance insert/checkout toggle, `last_visit` update, `biometric_events` logging. Refactor `logMemberAttendance` to delegate to it (behavior-preserving, covered by existing tests).

For face check-in specifically, `faceBiometricController.faceCheckIn` calls `processCheckIn` first, and **only if it returns authorized** does it go on to call `unlockDoorRemotely` (Section 3.4) — the door-unlock trigger is a consequence of authorization succeeding, never a parallel/independent check. If `processCheckIn` denies (inactive plan, session violation, etc.), the client gets the same denial-reason vocabulary `/validate` already uses, no unlock command is ever sent, and the door stays locked.

**Checkout support (decided: face check-in also toggles checkout, mirroring fingerprint) changes this authorization logic in one important way.** `processCheckIn` needs to know *which direction* a scan is (check-in vs. checkout) before deciding what to validate — determined by whether the member already has an open/un-checked-out attendance record for the current session, the same toggle signal `logMemberAttendance` already uses for fingerprint. The two directions must be authorized differently:

- **Check-in direction:** full authorization as designed — active plan, grace period, session-window rules all apply. A member with an expired plan gets denied and the door stays locked, exactly as today.
- **Checkout direction: must not be gated by plan validity.** A member's plan can legitimately lapse *while they're inside working out* — if checkout required an active plan, a billing lapse mid-session would leave someone physically unable to open the door to leave, which is a real safety problem, not just a business-logic edge case. Checkout should require only that the member is recognized and currently has an open attendance session; it always authorizes the door unlock regardless of plan/payment status. This is a meaningful behavior difference from the check-in path and should be implemented as an explicit branch in `processCheckIn`, not an oversight to catch in testing later.

This also settles part of open question #7 (checkout via face) beyond the yes/no: yes, and specifically with asymmetric authorization for the two directions.

### 3.6 Admin-UI entry point: navigating to & activating the kiosk

Everything above describes the kiosk once it's running. This section closes the last gap: **today there is no path from the admin UI to the kiosk at all.** A staff user can't discover, launch, or provision the check-in station without hand-editing the URL bar. `client/src/App.js` (~line 175) special-cases `location.pathname === '/checkin'` to render `<CheckIn/>` fullscreen, *outside* the admin chrome and the staff-login gate; the navigation drawer in the same file (Dashboard → Members → Classes → Attendance → Biometric → Financials → Settings) has no `/checkin` entry, and the Settings "Face Check-In" section (`client/src/components/Settings.js`, ~line 915) only mentions the URL in caption text. This subsection specifies how staff get there.

**"Activate" is three different actions — separate them explicitly.** Conflating them is the main source of confusion here:

- **(a) Enable the feature flag** — flip `face_checkin_enabled` on. Already fully built: the toggle in the Settings Face Check-In section, persisted via `PUT /api/settings`. No new work; the entry point below just needs to *link to* it and reflect its state.
- **(b) Launch/enter kiosk mode** — open the chrome-less `/checkin` view. This is the missing navigation affordance.
- **(c) Provision the station** — supply the device secret (must equal the backend `DEVICE_SHARED_SECRET`) + optional station label that `StationSetup` in `CheckIn.js` requires on first run, stored per-browser in `localStorage` (`gmgmt_face_station`) via `client/src/utils/faceStation.js`. This is the security-sensitive one; design effort concentrates on (b) and (c).

#### 3.6.1 Navigation — how staff reach `/checkin` (decided: launch button, new tab; not a drawer `Link`)

The kiosk deliberately renders *without* the drawer/AppBar (App.js special-case). That makes an in-tab drawer `<Link to="/checkin">` the wrong mechanism: it would unmount the admin chrome in the staff member's working tab and strand them fullscreen with no visible way back (no AppBar, no drawer, no logout) — a dead-end that reads as a crash. Options considered:

1. **Drawer `<Link to="/checkin">`** — matches the other nav items visually, but navigates in-tab into a chrome-less dead-end (above). Rejected as the primary mechanism.
2. **A "Launch check-in kiosk" button that opens `/checkin` in a new tab** (`window.open('/checkin', '_blank')`, or an `<a href="/checkin" target="_blank" rel="noopener">`). The admin session stays intact in the original tab; the kiosk gets its own tab that can be dragged to the entrance display and, optionally, put fullscreen (F11 / `requestFullscreen()` on a user gesture). **Recommended.**
3. **Both** — the button, plus a low-emphasis drawer entry that *also* opens a new tab rather than navigating in-tab. Reasonable, but a drawer item that behaves differently from every other drawer item (new tab, not in-tab route) is a papercut; keep the drawer consistent and put the affordance where the context is.

**Recommendation: the primary entry point is a "Launch check-in kiosk" button inside the Settings → Face Check-In section** (`Settings.js`, next to the enable toggle and Door Device ID, right where the existing caption already names `/checkin`). It sits with the feature flag (a) and the door config it depends on, so the three activation steps are co-located. Secondary: a matching button on the **Biometric** tab (`BiometricEnrollment.js`), since that's where staff already manage enrollment and would expect a "start the kiosk" action. **Do not add a plain drawer `Link`** — if a drawer entry is wanted later, it must open a new tab, not route in-tab, to avoid the chrome-less dead-end. This keeps the App.js special-casing an intentional, documented behavior rather than a trap.

#### 3.6.2 Station provisioning from admin (decided: keep the hand-typed secret; do **not** pipe `DEVICE_SHARED_SECRET` through the admin session)

The tempting "smooth" move is to have the admin UI pre-fill the device secret so the operator doesn't type it. **Reject this.** The whole point of `DEVICE_SHARED_SECRET` is that it's a server-side env var that the fail-closed gates in `src/app.js` (503 on `/face/sync` + `/face/check-in` until it's set; `x-device-secret` required thereafter) check against — it is deliberately *not* readable by any staff-session endpoint. Options weighed:

1. **Status quo — operator hand-types the secret into `StationSetup`.** The secret lives only in the station browser's `localStorage`, never in the admin session, never in a server response, never in an access log. Most secure; one-time-per-install friction. **Recommended baseline.**
2. **Admin endpoint that returns the secret to pre-fill `StationSetup`.** Would put `DEVICE_SHARED_SECRET` into a staff-session HTTP response (and therefore into browser history, devtools, and any request logging). Directly **weakens the fail-closed posture** the task forbids touching. **Rejected.**
3. **A new short-lived provisioning-token endpoint** (admin mints a one-time token; kiosk exchanges it for the device secret over a separate call). Keeps the raw secret out of the admin tab and out of logs if done carefully, but it is **new backend surface** (a token table/TTL, a mint endpoint, an exchange endpoint, and their own auth) for an action that happens *once per install* on a *one-machine-per-install* deployment. Over-engineered for v1. **Flagged as new surface; deferred, not built** — worth revisiting only if multi-station provisioning ever becomes real.

**What to actually improve (no secret exposure, minimal surface):** give staff a clear pre-flight *before* they launch, so a mis-provisioned server is diagnosable from the admin UI instead of surfacing as a mysterious 503 at the kiosk:

- Surface a **boolean** `deviceSecretConfigured` (true/false — **never the value**) on the existing `GET /api/biometric/face/config` bootstrap response. This is a one-field addition to an endpoint the admin session can already call (it's in `FACE_BOOTSTRAP_PATHS`, so a staff session is accepted); it is **not** a new endpoint and it exposes no secret material. The server computes it as `!!process.env.DEVICE_SHARED_SECRET`.
- The Settings Face Check-In section reads that boolean and, when it's false, shows "Server device secret not set — the kiosk can't accept scans until `DEVICE_SHARED_SECRET` is configured on the server" and disables/warns on the Launch button. This mirrors the existing caption's spirit (already distinguishing "enabled" from "needs `ENABLE_BIOMETRIC` + a Door Device ID").

So: **no new endpoint required** — one boolean field on `/face/config`. Provisioning itself stays exactly as `StationSetup` does it today.

#### 3.6.3 UX & edge cases

The kiosk already models most fail-closed states via `deriveStationStatus` in `faceStation.js` (`setup` / `error` / `disabled` / `no_door` / `ready`); the admin entry point mostly needs to route staff into them cleanly and not create new ambiguity.

- **Launched from an admin-authenticated browser.** The new `/checkin` tab shares the staff session cookie, so the bootstrap `GET /face/config` succeeds via the staff session even *before* a device secret is entered — the kiosk can correctly render `disabled` / `no_door`. But `/face/sync` and `/face/check-in` accept **only** the device secret (staff session is *not* accepted for those), so actual scanning still requires the operator to complete `StationSetup`. This is the intended boundary, not a bug: launching from admin gets you to the kiosk and shows its status; it does not silently authorize scanning on the strength of the staff login.
- **Leaving / exiting kiosk mode.** Because `/checkin` is chrome-less by design (unattended operation), don't bolt an always-visible "exit to admin" button onto it — that would invite a walk-up member to escape into the admin app. Exit is "close the tab" (the admin tab the staff launched from is still open behind it). The existing `error` screen's "Change device secret" button (which calls `resetStation`) is the only station-management affordance the kiosk needs. If an explicit exit is ever wanted, gate it behind a non-obvious gesture (long-press / secret key combo), never a visible button.
- **Feature disabled when launched.** `face_checkin_enabled=false` → `deriveStationStatus` returns `disabled` → the kiosk shows "Face check-in is disabled" and `faceCheckIn` would 403 anyway. The Launch button should still work (so staff can preview the disabled state), but the Settings section should make it obvious the toggle is off.
- **`DEVICE_SHARED_SECRET` unset when staff launches.** Bootstrap `/face/config` still resolves via the staff session, so the kiosk won't hard-error on load — but `/face/sync` and `/face/check-in` return 503 the moment scanning is attempted. Without the 3.6.2 pre-flight this is a confusing dead-end; **with** the `deviceSecretConfigured` boolean, Settings warns before launch and the failure is diagnosable. (If desired, `deriveStationStatus` could also learn to distinguish a 503-secret-unset config fetch, but the admin-side pre-flight is the higher-leverage fix.)

---

## 4. New/Changed Backend Surface

New controller `src/api/controllers/faceBiometricController.js`, routes added to `src/api/routes/biometric.js`:

| Route | Handler | Notes |
|---|---|---|
| `POST /members/:memberId/face-enroll` | `enrollFace` | Validates dims/model version, replaces prior rows transactionally |
| `DELETE /members/:memberId/face` | `removeFaceData` | Mirrors `removeBiometricData` |
| `GET /members/:memberId/face-status` | `getFaceStatus` | Mirrors `getMemberBiometricStatus` |
| `POST /face/sync` | `syncFaceCache` | Mirrors `updateMemberCache` |
| `POST /face/check-in` | `faceCheckIn` | Calls `checkInService.processCheckIn`; only on authorized result does it call `unlockDoorRemotely(doorDeviceId, 'face_checkin')` (Section 3.4). Denial never triggers an unlock command. |
| `GET /face/model-manifest` | `getModelManifest` | Section 1.4 |
| `GET /face/config` | `getFaceConfig` | Threshold/liveness-mode/enabled settings |

Modified: `src/config/sqlite.js` (table + settings defaults), `src/app.js` (static `/models` mount, COOP/COEP scoped carefully), `src/api/controllers/biometricController.js` (with/without-biometric queries gain face flags), `src/services/biometricIntegration.js` (delegate to `checkInService`).

**Auth gap:** no auth middleware exists today, only `requireSameOrigin`. `POST /face/sync` would hand out every member's name + embedding to anyone on the LAN. Minimum mitigation: a per-device token (row in `devices`, `device_type='face_checkin'`), checked on `/face/sync` and `/face/check-in`.

---

## 5. Liveness / Anti-Spoofing

1. Depth/IR cues — unavailable on plain webcams. Dismissed.
2. **Active challenge (blink/head-turn)** — computed from the landmarker already in the pipeline. No extra model. Robust against printed photos; weak against video replay. Adds ~2s to check-in.
3. **Passive texture/frequency liveness model** (MiniFASNet-class, ~1.9 MB) — zero UX cost, catches screen-replay artifacts, needs per-deployment threshold calibration.
4. Temporal identity consistency (the K-consecutive-frames rule) — free, weak signal.

**Recommendation, revised for the automated design:** ship (2)+(4) in **v1, not as a later hardening pass** — with no staff member confirming a match before the door opens, the blink/head-turn challenge is what stands between a printed photo and an unlocked door. Phase 2 adds (3) as a parallel passive score to eventually reduce challenge friction (skip the blink prompt when the passive score is confidently live). Be honest in docs either way: this deters casual/opportunistic fraud (a photo, a paused video), it is not FIDO-grade and won't stop a determined, well-resourced attacker — appropriate framing for a gym door, not for anything higher-stakes.

---

## 6. Fallback & Degradation

### 6.1 GPU availability

Desktop and laptop Chrome/Edge (Windows/Mac) have had solid WebGPU support since 2023, so the "stuck on WASM" risk here is materially lower than it would be on budget kiosk hardware — `faceEngine.js` should still probe WebGPU → WASM/XNNPACK and benchmark on load, but the WASM path is a genuine fallback for older corporate laptops rather than the expected common case. Multi-threaded WASM needs `SharedArrayBuffer`/COOP+COEP; plan on single-thread XNNPACK being sufficient given the small model size, and treat COEP as a measured escalation only if benchmarking shows it's needed (the current helmet config relaxes `crossOriginResourcePolicy` for `/uploads`, so scope any COOP/COEP change narrowly).

### 6.2 Model/camera/server failures — fail closed, always

Every failure mode below resolves to **the door stays locked and the member is directed to a fallback**, never to "unlock anyway just in case":

- Model fails to load → retry with backoff → Cache API copy → manual fallback screen (member taps the low-emphasis "having trouble?" affordance from 3.2, or staff at the desk handles it — reuses `SearchableMemberDropdown` + the existing `/api/attendance/check-in` flow; staff-initiated unlock for this path goes through the *existing* `unlockDoorRemotely`/manual-unlock endpoint that admins already have, not a new one).
- Camera denied/absent → same manual fallback, visible banner so staff notice the camera is down (not just silently failing member after member).
- Server unreachable at check-in time → **no local-only unlock decision.** Since Section 3.5 makes unlock strictly conditional on the server's `processCheckIn` authorization, an unreachable server means no unlock command can be sent — this is correct fail-closed behavior, not a bug to work around. Client shows "system offline — see front desk"; no offline queueing for a feature that controls a physical lock (this is a deliberate difference from the earlier attendance-only draft, which allowed offline queueing — that trade-off is no longer acceptable once the same event also opens a door).
- Feature disabled (`face_checkin_enabled=false`), or enabled but no `door_device_id` configured for this station → route renders "not enabled" / "no door configured"; endpoints 403. Distinguish these two states in the UI (Section 3.4) so setup mistakes are diagnosable.

---

## 7. Privacy & Security

1. Raw images never uploaded or stored; enrollment thumbnails in-memory only.
2. Embeddings are still biometric personal data (relevant under India's DPDP Act). Consent captured at enrollment.
3. At rest: SQLite is plaintext today (fingerprint templates already are). Optional AES-encryption of embedding BLOBs (`FACE_EMBEDDING_KEY` env) as defense-in-depth.
4. In transit: nothing crosses a network — Section 0 confirmed the browser and the server are the same machine, reached over `localhost`, so no HTTPS work is needed. If a deployment ever splits them, HTTPS becomes a prerequisite and this line becomes load-bearing again.
5. Deletion: mirrors existing biometric delete, tombstones for sync, `ON DELETE CASCADE` on member deletion.
6. Authorization integrity: client never decides; `faceCheckIn` re-validates everything `validateBiometricId` validates.

---

## 8. Testing & Rollout

### 8.1 Automated

- Backend: `checkInService.test.js`, `faceBiometricController.test.js` (enroll validation, replace-on-re-enroll, delete tombstones, sync, check-in denial reasons, device token).
- Client: `faceMatching.test.js` (pure math, fixture embeddings, threshold/margin truth tables), `faceCacheDb` tests, check-in-flow component tests with mocked `faceEngine`.
- Admin entry point (Section 3.6): unit-test that the Settings "Launch check-in kiosk" button targets `/checkin` in a new tab (not an in-tab route) and that it disables/warns when the new `deviceSecretConfigured` boolean from `/face/config` is false; assert the boolean is a pure `!!process.env.DEVICE_SHARED_SECRET` and **never** echoes the secret value (add to `faceBiometricController.test.js`'s `getFaceConfig` coverage).
- Model quality harness (offline, `tools/face-model/evaluate.py`): ROC/FAR-FRR, conversion-fidelity check, outputs recommended threshold.
- E2E without hardware: Chrome's `--use-fake-device-for-media-stream --use-file-for-fake-video-capture=clip.mjpeg` lets Playwright drive the real pipeline with recorded video, including spoof clips.

### 8.2 Manual QA aids

- `SimulateFaceCheckInModal.js` (cloned from `SimulateCheckInModal.js`) — exercises the server pipeline with zero camera.
- Debug overlay (backend name, ms/frame, top-3 candidates, liveness state) for threshold tuning.
- Manual smoke for the admin entry point: from a logged-in admin browser, Launch opens `/checkin` in a new tab that renders the correct `deriveStationStatus` state (`setup` when unprovisioned, `disabled`/`no_door` per settings) while the original admin tab stays authenticated; closing the kiosk tab returns cleanly to admin.

### 8.3 Staged rollout

Because the end state is a fully automated door unlock, the staged rollout is the primary safety mechanism for catching threshold/liveness problems *before* they become a security issue rather than just an attendance-log annoyance — treat these stages as gates, not a formality:

1. **Dev**: fake-camera e2e green (including spoof clips against the liveness challenge); simulate-check-in modal green. No door hardware touched yet.
2. **Shadow mode**: at a gym with existing fingerprint hardware, the automated face pipeline runs end-to-end — detects, matches, checks liveness — and logs the would-be decision (`face_shadow_match`, including what the unlock command *would* have been) **without ever calling `unlockDoorRemotely`**. Compare against real fingerprint check-ins for real-world FAR/FRR and liveness false-reject rate before any physical consequence exists.
3. **Assisted pilot**: full automated pipeline runs, but the final unlock call is gated behind a staff tap-to-confirm on a card showing the matched member — this is explicitly a temporary safety gate on the way to full automation, not the target design, and should have an exit criterion (e.g. N days with zero staff overrides needed) rather than running indefinitely.
4. **Autonomous pilot**: unlock fires automatically on match+liveness, no staff step, at one gym — this is the target design running for real. Manual fallback (3.2/6.2) stays visible throughout.
5. **GA**: `face_checkin_enabled` + `door_device_id` configured per install; docs cover the hardware prerequisite from Section 3.4 (a network-reachable door-lock actuator is required, not optional, for this feature to do anything beyond attendance logging).

---

## 9. Milestones

| Phase | Scope | Effort | Depends on |
|---|---|---|---|
| P0 — Environment spike | No HTTPS work needed (confirmed localhost deployment). LiteRT.js hello-world perf smoke test on representative front-desk hardware; pick model checkpoint | S | — |
| P1 — Model pipeline | Convert + quantize models; evaluation harness; provisional threshold | M | P0 |
| P2 — Backend foundation | Schema, extract `checkInService.js` **with asymmetric check-in/checkout authorization** (Section 3.5), controller/routes, device token, dwell-time checkout guard, unit tests | M | parallel with P1 |
| P3 — Enrollment UI | `faceEngine.js` (shared) + `FaceEnrollment.js` tab | M | P1, P2 |
| P4 — Check-in client + liveness | Automated check-in route/component, matching loop, liveness challenge (no longer a separate later phase — ships together since v1 requires it), door-unlock call wired to authorized outcome only, sync, manual fallback, debug overlay | L | P2, P3 |
| P5 — Door-lock integration & fail-closed hardening | Wire `unlockDoorRemotely` call, `door_device_id` config/setup UI, verify every failure path in 6.2 actually fails closed (dedicated test pass), spoof-clip e2e tests | M | P4 |
| P5a — Admin-UI kiosk entry point | "Launch check-in kiosk" button in Settings Face Check-In section + Biometric tab (opens `/checkin` in a new tab, no drawer `Link`); add `deviceSecretConfigured` boolean to `/face/config` and pre-flight warning in Settings (Section 3.6). No new endpoint, no app-secret exposure | S | P4 |
| P6 — Test & shadow rollout | Playwright fake-camera suite, `SimulateFaceCheckInModal`, shadow mode (Section 8.3 stage 2 — no unlock calls), threshold tuning | M | P4, P5 |
| P7 — Pilot → GA hardening | Assisted→autonomous pilot, passive liveness v2, embedding encryption, docs | M | P6 |

Critical path: P0 → P1 → P3 → P4 → P6. `checkInService` extraction (P2) is the highest-regression-risk item — schedule it early while existing tests are fresh.

---

## Open Questions — all resolved

1. ~~Localhost or LAN?~~ **Resolved — same machine, localhost. No HTTPS work needed.**
2. ~~Model source/licensing?~~ **Resolved — permissively-licensed alternative, not InsightFace.** SFace (Apache-2.0, OpenCV Zoo) recommended, EdgeFace (MIT) as fallback. See Section 1.1/1.3.
3. ~~Accuracy floor?~~ **Resolved — balanced.** Target FAR ~0.1%, FRR ~2–3%, tuned by the Phase 1 evaluation harness and validated in shadow mode before going live. See Section 1.2.
4. ~~Device auth?~~ **Resolved — per-device token is sufficient.** Real API auth (the unused `jsonwebtoken` dependency) stays a separate future project, out of scope here.
5. ~~Liveness strictness default?~~ **Resolved — challenge-always in v1, Phase 2 adds a passive-liveness bypass** to skip the blink/head-turn prompt when confidence is high. See Section 5.
6. ~~Multi-location topology?~~ **Resolved — single location only.** No per-location gallery filtering needed; matches the confirmed single-machine, localhost deployment model.
7. ~~Checkout via face?~~ **Resolved — yes, supported, mirroring fingerprint**, with one important divergence: checkout authorization is **not gated by plan validity** (a lapsed plan must never lock a member inside the building), and a dwell-time guard prevents a lingering face from accidentally triggering checkout right after check-in. See Sections 3.2 and 3.5 for the full design.
8. ~~Bootstrap from `members.photo_url`?~~ **Resolved — no, fresh consented enrollment only.**
9. ~~Door-lock hardware present at every planned site?~~ **Resolved — yes.** The plan proceeds as written with automated physical unlock everywhere it ships; no degraded attendance-only mode needed.
10. ~~Tailgating?~~ **Resolved — acceptable known limitation**, documented in rollout materials (Section 3.2), no mitigation built for v1.

### Critical Files for Implementation

- `gmgmt/src/services/biometricIntegration.js` — source of the check-in pipeline logic to extract into `checkInService.js`
- `gmgmt/src/api/controllers/biometricController.js` — conventions to mirror; with/without-biometric queries to extend
- `gmgmt/src/config/sqlite.js` — new `member_face_embeddings` table + settings defaults
- `client/src/components/BiometricEnrollment.js` — Stepper/tab/WebSocket patterns the new `FaceEnrollment.js` tab plugs into
- `gmgmt/src/app.js` — route mount, `/models` static serving, helmet/COOP-COEP scoping, WebSocket wiring

---

## Revision Notes (desktop/laptop correction)

Original draft assumed a mounted tablet kiosk. Changes made after learning the actual target is a front-desk desktop or laptop with a webcam:

- Dropped "kiosk" framing (locked-down managed-browser tablet, insecure-origin Chrome policy) — this is a normal machine running a normal browser, so provisioning is simpler.
- Section 3.2: recommended an assisted, staff-initiated scan instead of an always-on ambient scanning loop, since staff are present at the machine rather than it running unattended.
- Section 6.1: raised confidence in WebGPU availability — desktop/laptop Chrome/Edge has had solid WebGPU support since 2023, unlike budget Android tablet hardware. WASM fallback is now a "some old corporate laptop" case, not the expected baseline.
- Open question #1 resolved: confirmed the front-desk machine is the same box running the gmgmt server (localhost). HTTPS/certificate work is dropped from the plan entirely — Phase 0 is now just a perf spike and model pick, no security-context prerequisite.

**Second revision — automated scanning + physical door unlock (this update).** Reverted the staff-initiated scan back to fully automated, continuous walk-up scanning (Section 3.2), and added an explicit requirement that a successful match doesn't just log attendance — it triggers a real physical door unlock, subject to server-side authorization and plan validity. This is a bigger scope change than the desktop/laptop correction was, because it turns the feature from "attendance logging fallback" into "physical access control." Changes made:
- Section 3.2 rewritten for continuous/ambient scanning with a debounce cooldown, replacing the staff-initiated click-to-scan design.
- New Section 3.4 added: physical door unlock reuses the *existing* `biometricIntegration.unlockDoorRemotely()` / ESP32 command channel already used for admin remote-unlock and fingerprint check-ins — no new hardware-control path invented. This introduces a hardware prerequisite (a registered, network-reachable ESP32 door-lock actuator) that didn't apply to the attendance-only version of this feature.
- Liveness (Section 5) promoted from "phase 2 nice-to-have" to a v1 requirement — automation removes the human-confirmation backstop that made a softer liveness posture defensible before.
- Section 6.2 rewritten around an explicit fail-closed principle, and offline check-in queueing (previously a stretch goal) was dropped — acceptable for an attendance log, not acceptable for a feature that can open a door.
- Rollout (8.3) reframed: "assisted pilot" is now explicitly a temporary safety gate with an exit criterion, not an acceptable end state, since the user's requirement is full automation.
- Milestones (P4/P5) restructured so liveness ships alongside the check-in client rather than trailing it, and a dedicated fail-closed hardening pass was added.
- Two new open questions added: whether every planned deployment actually has door-lock hardware (#9), and whether tailgating needs a mitigation for any specific site (#10).

**Third revision — all open questions resolved (this update).** All 10 open questions now have decisions:
- **Model licensing**: dropped InsightFace/QAinsights entirely due to non-commercial licensing risk on the pretrained weights; committed to SFace (Apache-2.0) as primary, EdgeFace (MIT) as fallback (Section 1.1/1.3).
- **Accuracy target**: balanced FAR ~0.1% / FRR ~2–3%, now stated explicitly in Section 1.2 as the harness's tuning target.
- **Device auth, liveness posture, multi-location, photo bootstrap, hardware prerequisite, tailgating**: all confirmed as previously recommended — no design changes, just resolved status.
- **Checkout via face — the one real design addition**: user chose to support it (diverging from the plan's original check-in-only recommendation), which required new work, not just a flag flip: (a) a dwell-time guard in Section 3.2 so a lingering face after check-in doesn't accidentally trigger a checkout, and (b) asymmetric authorization in Section 3.5 — checkout must never be blocked by an expired plan, since that would risk physically locking a member inside the building over a billing issue. This is now a hard requirement in `checkInService`'s design, not an edge case to catch in testing. Milestone P2 updated to reflect the added scope.

**Fourth revision — admin-UI entry point for the kiosk (this update).** Added Section 3.6 to close the last gap surfaced in testing: there was no path from the admin UI to the kiosk at all — staff had to hand-type `/checkin`. Changes made:
- New Section 3.6 specifies navigation and activation, separating the three conflated meanings of "activate" (enable the feature flag / launch kiosk mode / provision the station secret).
- **Navigation decision (3.6.1)**: a "Launch check-in kiosk" button that opens `/checkin` in a *new tab*, placed in the Settings Face Check-In section (primary) and the Biometric tab (secondary). Explicitly **not** a drawer `Link` — the kiosk is chrome-less by design (App.js special-case), so an in-tab route would strand staff in a dead-end.
- **Provisioning decision (3.6.2)**: keep the operator hand-typing the device secret into `StationSetup`; do **not** pipe `DEVICE_SHARED_SECRET` through any staff-session response (that would weaken the fail-closed 503/`x-device-secret` gates in `app.js`). The only backend change is a single boolean `deviceSecretConfigured` field on the existing `/face/config` bootstrap response, powering a pre-flight warning in Settings — **no new endpoint, no secret exposure.** A one-time provisioning-token endpoint was considered and deferred as over-engineered for a one-machine-per-install deployment.
- Milestones: added **P5a** (admin-UI kiosk entry point, size S, depends on P4). Section 8.2 gained a manual-smoke aid for the launch-in-new-tab flow.
- Scope guard: this revision is a planning-doc change only — no application code was modified.
