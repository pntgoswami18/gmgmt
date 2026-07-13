# Face Check-In — Handoff / Progress Status

**Design doc:** [`face-checkin-plan.md`](./face-checkin-plan.md) (read that first for *why*; this doc is *where things stand* and *what's next*).

**Note on naming:** `phase2-plan.md` / `phase3-plan.md` / `phase4-plan.md` in this same `docs/` directory are an **unrelated** initiative (code-quality/logging/test-coverage remediation). This feature's phases (P0–P5) are sections *inside* `face-checkin-plan.md`, not separate files. Don't confuse the two "Phase 4"s.

Last updated: 2026-07-13 (§3.9 revised — gmgmt#27 + kiosk client#13 recompute the match server-side, but multi-agent review found this only defends against a buggy honest kiosk, not a malicious device-secret holder, who can still impersonate via `/face/sync` + embedding replay).

---

## 1. Where things stand

| Phase | Repo | What it is | Status |
|---|---|---|---|
| P0 | gmgmt | Environment spike — LiteRT.js perf smoke test, model checkpoint pick | ✅ Merged (#16) |
| P1 | gmgmt | Model pipeline — SFace ONNX→TFLite conversion, quantization, LFW eval harness | ✅ Merged (#17) |
| P2 | gmgmt | Backend — `checkInService` extraction, face endpoints, schema | ✅ Merged (#18) |
| P3 | client | Enrollment UI — `faceEngine.js`, `FaceEnrollment.js` tab | ✅ Merged (#10, squash) |
| P3 | gmgmt | Model deployment — `deploy-models.sh` + manifest | ✅ Merged (#21) |
| P3 | gmgmt | Verification pass — fixed midnight-fragile tests, verify-skill hardening | ✅ Merged (#22) |
| P4 | client | Kiosk UI — `/checkin` route, matching/liveness/cache modules, `useFaceCheckin` hook | ✅ Merged ([client#11](https://github.com/pntgoswami18/client/pull/11), commit `b83312f`) |
| — | gmgmt | Bump `client` submodule pointer to new client `main` | ✅ Merged ([gmgmt#23](https://github.com/pntgoswami18/gmgmt/pull/23), commit `af6283d`) |
| — | gmgmt | Add missing `.gitmodules` + check-in trust-model doc note | ✅ Merged ([gmgmt#24](https://github.com/pntgoswami18/gmgmt/pull/24), commit `3803945`) |
| — | client | Staff-facing Settings UI for face config | 🟡 PR open — [client#12](https://github.com/pntgoswami18/client/pull/12) |
| — | gmgmt | Dev fix: `.claude/launch.json` backend Node version | 🟡 PR open — [gmgmt#26](https://github.com/pntgoswami18/gmgmt/pull/26) |
| — | ops | Run `deploy-models.sh` on the actual deployment target | ⬜ Not started |
| — | ops | Set `DEVICE_SHARED_SECRET` env var + provision kiosk browser | ⬜ Not started |
| — | ops | Register/pair the ESP32 door device, set `face_door_device_id` | ⬜ Not started (hardware-dependent) |
| — | human | Real-camera walk-up test (enroll → kiosk scan → unlock) | ⬜ Not started |
| — | docs | Rollout doc: name the tailgating limitation explicitly | ⬜ Not started |

**Bottom line:** all backend, pure-logic, kiosk-UI, and Settings-UI code for face check-in is written, unit-tested, and either merged or in open PRs pending review. **No feature code is left to write.** Everything remaining is deployment/config/ops work: run the model deploy script, set the device secret, register hardware, and do a real walk-up test.

---

## 2. Repo/branch/PR map

**gmgmt** (backend + docs), `main` tip: `3803945`
- `f80bd90` P1 (#17) → `3340ad3` P2 (#18) → `21e1639` P3 model-deploy (#21) → `fcd6b36` P3 verify (#22) → `af6283d` submodule bump (#23) → `3803945` `.gitmodules` + trust-model doc (#24)
- **Open:** [gmgmt#26](https://github.com/pntgoswami18/gmgmt/pull/26) `fix-backend-launch-node-version` → `main` — dev-only fix, `.claude/launch.json`'s backend config now points at the Node 22 binary instead of plain `node` (which resolves to Node 18 in this environment and fails `better-sqlite3`'s native binding).

**client** (frontend, git submodule `github.com/pntgoswami18/client.git`), `main` tip: `b83312f`
- `5a421f1` P3 enrollment (#10, **squash-merged** — old commit SHAs `19b653b`/`b794545` are *not* ancestors of `main`, see §5 gotcha)
- `b83312f` P4 kiosk (#11, squash-merged) — CheckIn.js, useFaceCheckin.js, faceStation.js, faceMatching.js, faceLiveness.js, faceCacheDb.js + tests
- **Open:** [client#12](https://github.com/pntgoswami18/client/pull/12) `face-checkin-settings-ui` → `main` — the §3.3 Settings UI panel, live-verified against a running backend.

**gmgmt's submodule pointer** for `client` is `b83312f` — up to date through P4. Will need bumping again once client#12 merges. `.gitmodules` (previously missing — a fresh clone couldn't resolve the submodule URL) is now committed via #24.

---

## 3. Pending work, in order

### 3.1 ~~Merge client PR #11~~ — done
Merged 2026-07-13 as `b83312f`.

### 3.2 ~~Merge gmgmt#23 (submodule bump)~~ — done
Merged 2026-07-13 as `af6283d`. `.gitmodules` fix + trust-model doc note also merged separately as gmgmt#24 (`3803945`) — see §3.9.

### 3.3 ~~Staff-facing Settings UI~~ — built, PR open
[client#12](https://github.com/pntgoswami18/client/pull/12) adds a "Face Check-In" section to `Settings.js`'s General tab: enable toggle, match threshold (number input, not a slider — kept consistent with the rest of the file's existing input patterns), liveness mode select (native `<select>` via the same `TextField select SelectProps={{native:true}}` pattern already used for currency/color-mode, not MUI `Select` — avoids a new import), door device ID (plain text field — `GET /api/biometric/devices` turned out to be unreliable for a dropdown: it 503s when `ENABLE_BIOMETRIC=false` and only lists devices seen in the last 24h, so free text with a helper note was more robust), checkout dwell minutes, and a read-only pinned-model-version display. `PUT /api/settings` needed no changes — it already accepts arbitrary keys via `INSERT OR REPLACE`, no allowlist.

Live-verified end to end against a running local backend: panel loads correct defaults from `GET /api/settings`, editing fields fires the existing "unsaved changes" dirty-tracking, Save round-trips through `PUT /api/settings`, and a fresh reload confirms persistence. See §5 for two automation gotchas hit during that verification (MUI Checkbox event handling, and a screenshot/CSS-pixel coordinate mismatch) — not relevant to the shipped code, just to future browser-automation debugging.

### 3.4 Deploy models to the target environment
`tools/face-model/deploy-models.sh` (merged in #21) copies the fp32 embedder + pinned `face_landmarker.task` + WASM runtimes into `public/models/` and writes `manifest.json`. **`public/models/` is gitignored** — this must be *run*, not just merged, on every environment that needs to serve the kiosk (dev, staging, prod). Confirm it's been run wherever `/checkin` will actually be tested/used; `GET /api/biometric/face/model-manifest` 404s otherwise (see `getModelManifest` in `faceBiometricController.js`).

### 3.5 Configure `DEVICE_SHARED_SECRET` + provision the kiosk browser
- Set `DEVICE_SHARED_SECRET` in the server's env (currently commented out in `.env.sample:29`). Until it's set, `/api/biometric/face/sync` and `/face/check-in` return 503 (see `src/app.js:133-139`) — this is deliberate fail-closed behavior, not a bug.
- On the kiosk browser itself, visit `/checkin` — it'll show the station-setup screen (built in #11) prompting for the device secret. Enter the same value as `DEVICE_SHARED_SECRET`; it's stored in that browser's `localStorage` only (`faceStation.js`).

### 3.6 Register the door device
Plan §3.4: automatic unlock needs a registered, network-reachable ESP32 device (`devices` table row) for the entrance — it does *not* need a fingerprint sensor attached, just the relay/lock hardware paired via the existing ESP32 flow. Then set `face_door_device_id` to that device's id via the new Settings panel (§3.3, client#12) — it's a plain text field, so the admin needs to know/copy the device ID from the ESP32 Devices tab rather than picking it from a dropdown.

### 3.7 Human walk-up test
Once 3.1–3.6 are done: enroll a real face via `/biometric` → Face tab, then walk up to `/checkin` and confirm the full loop (detect → match → liveness challenge → server verify → welcome screen → door unlock command). This can't be done from an agent session — needs a physical camera and a human face.

### 3.8 Rollout documentation
Plan explicitly calls out (§3.2): tailgating (a second person walking in behind an authorized scan) is a known, unaddressed limitation — "not a blocker, but should be called out in rollout docs so it's a known trade-off, not a surprise." No rollout doc exists yet; write one before enabling this at a real front desk.

### 3.9 Check-in trust model — match now recomputed server-side (narrower fix than first described)
**Flagged during review of gmgmt#23, partially fixed in gmgmt#27 + client#13:** `POST /api/biometric/face/check-in` previously did **not** independently recompute the face match — it trusted the client-submitted `matchScore` (checked only against `face_match_threshold`). That's now closed **for an honestly-behaving-but-buggy kiosk**: the kiosk submits the probe `embedding`, and the server recomputes the best cosine similarity against the member's stored gallery (pinned model version only) and authorizes on **its** score, not the client's claim. The client `matchScore` is advisory — recorded in the event log as `claimedScore` so a large divergence flags a misbehaving kiosk — and a missing/invalid probe fails closed (`400 invalid_probe_embedding`). The re-scoring lives in the pure, unit-tested `src/utils/faceMatch.js` (a mirror of the kiosk's `faceMatching.js` cosine definition).

**This does NOT close the gap against a genuinely malicious device-secret holder, and gmgmt#27's PR description overstated this** (caught by multi-agent review of gmgmt#27): `POST /api/biometric/face/sync` is gated by the exact same `X-Device-Secret` credential as `/face/check-in` (`FACE_STATION_PATHS` in `src/app.js`) and returns every enrolled member's raw embeddings by design — the kiosk needs the full gallery locally for real-time on-device matching (plan 3.2/3.3). So anyone who holds the device secret can call `/face/sync` once, pull a target member's real embedding, and replay it verbatim as the `embedding` in `/face/check-in` (with `livenessPassed: true`) to impersonate that member — no camera, no physical presence required. The server-side recompute adds zero friction here because a valid-looking embedding was never the scarce resource; the device secret always was.

Net effect: **the actual security boundary remains the device secret itself** (unchanged from the original §3.9 framing before gmgmt#27) — protecting *that* is the deployment's job, not a server-side biometric re-verification. What gmgmt#27 actually buys is defense against an honest kiosk with a scoring bug or miscalibrated local threshold, plus an audit trail (`claimedScore` vs. `serverScore` divergence) — not defense against a compromised/malicious kiosk or a leaked secret.

Caveats that remain and still belong in the rollout doc (§3.8):
- **A device-secret leak (or kiosk compromise) still allows full impersonation** via `/face/sync` + replay, as above — this is the primary caveat, not a footnote.
- **Liveness is still a client-asserted boolean.** `livenessPassed` cannot be recomputed server-side without the raw frames, so the anti-spoof guarantee still lives in the kiosk's challenge loop, gated server-side only by `face_liveness_mode`. A trusted-kiosk assumption still underpins liveness even though it no longer underpins the honest-kiosk identity-scoring path.
- **The re-scored probe is not temporally bound to the liveness-proven frame.** In `useFaceCheckin.js`, the probe embedding is captured when the K-consecutive-frame `MatchAccumulator` first accepts an identity (in `tick()`, during the `idle` phase) and stashed in `pendingRef`. The liveness challenge (blink/head-turn) then runs against *subsequent* frames, and on success `verify(pendingRef.current, true)` submits that original, pre-challenge probe — not a frame captured during or after the liveness proof. So the embedding the server re-scores and the frames that proved liveness come from two disjoint moments with nothing binding them together; an honest kiosk's liveness proof doesn't guarantee it's the same live subject the embedding was drawn from.
- **Tailgating** (a second person entering behind an authorized scan) is unaddressed — see the §3.8 note above.

---

## 4. Key files (orientation for a fresh session)

**Backend (gmgmt, all merged):**
- `src/services/checkInService.js` — `processCheckIn()`, the shared authorization core (asymmetric check-in/checkout rules)
- `src/api/controllers/faceBiometricController.js` — all `/face/*` and face-enroll endpoints. `faceCheckIn` recomputes the cosine match server-side from the client's probe `embedding` (via `src/utils/faceMatch.js`); the client `matchScore` is advisory and `livenessPassed` is still a client-asserted gate (see §3.9)
- `src/utils/faceMatch.js` — pure server-side cosine match / probe validation, the authoritative re-scoring the door unlock hangs on (mirror of the kiosk's `faceMatching.js`)
- `src/config/sqlite.js:287-292` — face settings defaults
- `src/app.js:110-163` — auth routing: `FACE_STATION_PATHS` (device-secret-only, fail-closed), `FACE_BOOTSTRAP_PATHS` (device-secret OR staff session)
- `tools/face-model/` — P1 conversion/eval scripts + `deploy-models.sh`

**Frontend (client):**
- `src/utils/faceEngine.js` — LiteRT.js + MediaPipe wrapper, shared by enrollment and kiosk
- `src/components/FaceEnrollment.js` — enrollment tab (merged, P3)
- `src/utils/faceAlign.js` — pure geometry (alignment, pose, capture-slot decision)
- `src/utils/faceMatching.js` — cosine similarity, `MatchAccumulator` (K-consecutive-frame gate)
- `src/utils/faceLiveness.js` — `LivenessChallenge` (blink/head-turn state machine)
- `src/utils/faceCacheDb.js` — IndexedDB gallery cache, delta-merge core
- `src/utils/faceStation.js` — device-secret station config + fail-closed status derivation
- `src/hooks/useFaceCheckin.js` — orchestrates the above into the walk-up loop
- `src/components/CheckIn.js` — fullscreen `/checkin` UI (all phase screens)
- `src/App.js` — `/checkin` route branch, before the auth/drawer layout

**Test files:** every `.js` in the list above except `CheckIn.js`/`useFaceCheckin.js`/`FaceEnrollment.js` has a co-located `.test.js`. 63 util tests pass as of #11.

---

## 5. Gotchas learned this round (save yourself the debugging time)

- **PR #10 was squash-merged.** Its source commits (`19b653b`, `b794545`) are *not* ancestors of `client/main`. A branch built on top of them (like `face-checkin-kiosk` was) cannot be rebased normally — use `git rebase --onto origin/main <old-base-commit> <branch>` to replay only the branch's own commits onto the new history. A plain `git rebase origin/main` will try to replay the now-squashed commits too and produce duplicate/conflicting diffs.
- **`FaceLandmarker` needed `outputFaceBlendshapes: true`** to expose eyeBlink scores for the liveness challenge — it was `false` in the P3 enrollment code (enrollment doesn't need blinks). Already flipped in `faceEngine.js` as part of #11.
- **The admin MUI theme forces a dark `color` on `h4`/`h5` Typography** (`App.js`'s `buildTheme`), which is unreadable on the kiosk's dark background. `CheckIn.js` overrides it locally via `.MuiTypography-h2/h3/h4/h5 { color: inherit }` on its root container — don't remove that rule.
- **`FACE_STATION_PATHS` (`/face/sync`, `/face/check-in`) fail closed with 503 if `DEVICE_SHARED_SECRET` is unset** — this is intentional (see `app.js` comment), not a deployment bug. `FACE_BOOTSTRAP_PATHS` (`/face/config`, `/face/model-manifest`) is more permissive by design — it accepts either the device secret or a staff session, so the admin enrollment UI and the kiosk can both call it.
- **`data/data/gmgmt.sqlite` shows as locally modified** in the gmgmt working tree on most branches — pre-existing local runtime state (DB file grew from local testing) unrelated to the face-checkin work; don't commit it accidentally with a broad `git add -A`.
- **This repo's working directory can be shared by more than one concurrent session.** During this work, a parallel session committed unrelated `.gitmodules`/trust-model-doc work (gmgmt#24) on a new branch and, via a broad `git add`, incidentally scooped up this handoff file mid-edit — it landed in that PR as a stale snapshot, requiring a manual reconcile (`git pull` after backing up the local copy, then re-applying edits to the now-tracked file) to avoid losing either version. Run `git status` before any branch switch, and don't assume you're the only writer in this directory.
- **`better-sqlite3`'s native binding is Node-version-specific.** The plain `node` in `.claude/launch.json`'s backend config resolves to whatever the shell's default is (Node 18 in this environment), which throws a `NODE_MODULE_VERSION` ABI mismatch on startup. Fixed in gmgmt#26 by pinning to the Node 22 binary directly; if the binary was previously built against a different Node version, `npm rebuild better-sqlite3` under the target Node first.
- **Browser-automation gotchas hit while verifying the Settings panel (client#12), for future live-verification sessions:** (1) MUI `Checkbox` sometimes needs a real coordinate-based click rather than the `form_input` tool's boolean-value path to reliably fire React's `onChange` — verify state changes via a direct DOM/JS check (`input.checked`) rather than trusting a screenshot. (2) On this environment the Browser pane's screenshot pixel coordinates and `getBoundingClientRect()`'s CSS-pixel coordinates did **not** match 1:1 (a `devicePixelRatio: 2` page) — a raw `computer` click at screenshot-derived coordinates missed its target by roughly 2x. Prefer `ref`-based clicks (resolved internally by the tool) or coordinates read from `getBoundingClientRect()` over eyeballing a screenshot.

---

## 6. Test commands (copy-paste for a fresh session)

```bash
# gmgmt backend (from repo root; needs Node >= 20)
node --test 'src/services/__tests__/*.test.js'
npm run esp32:test   # needs server running with ENABLE_BIOMETRIC=true

# client frontend (from client/)
CI=true npx react-scripts test --testPathPattern="utils/(faceStation|faceMatching|faceLiveness|faceCacheDb|faceAlign)" --watchAll=false
npx react-scripts build   # full compile/lint check
```
