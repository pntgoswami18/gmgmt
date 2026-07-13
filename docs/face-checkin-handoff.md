# Face Check-In — Handoff / Progress Status

**Design doc:** [`face-checkin-plan.md`](./face-checkin-plan.md) (read that first for *why*; this doc is *where things stand* and *what's next*).

**Note on naming:** `phase2-plan.md` / `phase3-plan.md` / `phase4-plan.md` in this same `docs/` directory are an **unrelated** initiative (code-quality/logging/test-coverage remediation). This feature's phases (P0–P5) are sections *inside* `face-checkin-plan.md`, not separate files. Don't confuse the two "Phase 4"s.

Last updated: 2026-07-13 (client#11 merged; gmgmt submodule bump PR open).

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
| — | gmgmt | Bump `client` submodule pointer to new client `main` | 🟡 PR open — [gmgmt#23](https://github.com/pntgoswami18/gmgmt/pull/23) |
| — | ops | Run `deploy-models.sh` on the actual deployment target | ⬜ Not started |
| — | ops | Set `DEVICE_SHARED_SECRET` env var + provision kiosk browser | ⬜ Not started |
| — | gmgmt+client | Staff-facing Settings UI for face config | ⬜ **Not started — no code exists yet** (see §3.3) |
| — | ops | Register/pair the ESP32 door device, set `face_door_device_id` | ⬜ Not started (hardware-dependent) |
| — | human | Real-camera walk-up test (enroll → kiosk scan → unlock) | ⬜ Not started |
| — | docs | Rollout doc: name the tailgating limitation explicitly | ⬜ Not started |

**Bottom line:** all backend, pure-logic, and kiosk-UI code for face check-in is written, unit-tested, and merged into both repos' `main`. The only code-side loose end is [gmgmt#23](https://github.com/pntgoswami18/gmgmt/pull/23) (submodule pointer bump, needs a review click) and §3.3 (no settings UI exists to turn the feature on without hand-editing the DB). Everything else left is deployment/config/ops work, not code.

---

## 2. Repo/branch/PR map

**gmgmt** (backend + docs), `main` tip as of this doc: `fcd6b36`
- `f80bd90` P1 (#17) → `3340ad3` P2 (#18) → `21e1639` P3 model-deploy (#21) → `fcd6b36` P3 verify (#22)
- All merged. No open face-checkin work on the gmgmt side right now.

**client** (frontend, git submodule `github.com/pntgoswami18/client.git`), `main` tip: `b83312f`
- `5a421f1` P3 enrollment (#10, **squash-merged** — old commit SHAs `19b653b`/`b794545` are *not* ancestors of `main`, see §5 gotcha)
- `b83312f` P4 kiosk (#11, squash-merged) — CheckIn.js, useFaceCheckin.js, faceStation.js, faceMatching.js, faceLiveness.js, faceCacheDb.js + tests
- No open PRs on client right now.

**gmgmt's submodule pointer** for `client`: bump is in [gmgmt#23](https://github.com/pntgoswami18/gmgmt/pull/23) (branch `bump-client-checkin-kiosk`, commit `a848f61`), `0516404` → `b83312f`. Needs a review/merge click — same "no branch protection but review required" pattern as client#11 was.

---

## 3. Pending work, in order

### 3.1 ~~Merge client PR #11~~ — done
Merged 2026-07-13 as `b83312f`.

### 3.2 Merge gmgmt#23 (submodule bump)
[gmgmt#23](https://github.com/pntgoswami18/gmgmt/pull/23) — branch `bump-client-checkin-kiosk`, bumps the pointer `0516404` → `b83312f`. Needs a review/approve click, same as #11 did. No code changes needed.

### 3.3 Staff-facing Settings UI — real gap, not yet built
Confirmed via grep: **no code anywhere in `client/src/components/Settings.js` references** `face_checkin_enabled`, `face_match_threshold`, `face_liveness_mode`, `face_door_device_id`, or `face_checkout_min_dwell_minutes`. The backend already has these as real settings rows (`src/config/sqlite.js:287-292`) and `GET/PUT /api/settings` presumably supports arbitrary keys (verify), but **there is no admin-facing form to change them** — today a gym admin can only turn the feature on by hand-editing the `settings` table or scripting a PUT to `/api/settings`.

This blocks any real rollout: without a UI, nobody can flip `face_checkin_enabled` to `true` or set `face_door_device_id` without DB access. Recommend a new "Face Check-In" section in `Settings.js` (or a tab, following the existing pattern) with:
- Enable/disable toggle (`face_checkin_enabled`)
- Match threshold slider (`face_match_threshold`, default 0.55)
- Liveness mode select (`face_liveness_mode`: `challenge` | `none`)
- Door device dropdown, sourced from `GET /api/biometric/devices` (`face_door_device_id`)
- Checkout dwell minutes (`face_checkout_min_dwell_minutes`, default 15)
- Read-only display of the pinned `face_model_version` (set automatically on first enrollment — plan §2.3)

This was never in the original phase breakdown as a numbered phase — it surfaced as a gap while writing this handoff. Worth confirming with the user whether it's in scope for "Phase 4" or deserves its own phase before starting.

### 3.4 Deploy models to the target environment
`tools/face-model/deploy-models.sh` (merged in #21) copies the fp32 embedder + pinned `face_landmarker.task` + WASM runtimes into `public/models/` and writes `manifest.json`. **`public/models/` is gitignored** — this must be *run*, not just merged, on every environment that needs to serve the kiosk (dev, staging, prod). Confirm it's been run wherever `/checkin` will actually be tested/used; `GET /api/biometric/face/model-manifest` 404s otherwise (see `getModelManifest` in `faceBiometricController.js`).

### 3.5 Configure `DEVICE_SHARED_SECRET` + provision the kiosk browser
- Set `DEVICE_SHARED_SECRET` in the server's env (currently commented out in `.env.sample:29`). Until it's set, `/api/biometric/face/sync` and `/face/check-in` return 503 (see `src/app.js:133-139`) — this is deliberate fail-closed behavior, not a bug.
- On the kiosk browser itself, visit `/checkin` — it'll show the station-setup screen (built in #11) prompting for the device secret. Enter the same value as `DEVICE_SHARED_SECRET`; it's stored in that browser's `localStorage` only (`faceStation.js`).

### 3.6 Register the door device
Plan §3.4: automatic unlock needs a registered, network-reachable ESP32 device (`devices` table row) for the entrance — it does *not* need a fingerprint sensor attached, just the relay/lock hardware paired via the existing ESP32 flow. Then set `face_door_device_id` to that device's id (currently only doable via direct settings write until §3.3 ships).

### 3.7 Human walk-up test
Once 3.1–3.6 are done: enroll a real face via `/biometric` → Face tab, then walk up to `/checkin` and confirm the full loop (detect → match → liveness challenge → server verify → welcome screen → door unlock command). This can't be done from an agent session — needs a physical camera and a human face.

### 3.8 Rollout documentation
Plan explicitly calls out (§3.2): tailgating (a second person walking in behind an authorized scan) is a known, unaddressed limitation — "not a blocker, but should be called out in rollout docs so it's a known trade-off, not a surprise." No rollout doc exists yet; write one before enabling this at a real front desk.

### 3.9 Check-in trust model — clarify in rollout docs
Flagged during review of gmgmt#23: `POST /api/biometric/face/check-in` does **not** independently recompute the face match. It trusts the client-submitted `matchScore` (checked only against `face_match_threshold`) and the client-submitted `livenessPassed` boolean as-is (`faceBiometricController.js`, the `checkIn` handler). The real security boundary is the `X-Device-Secret` header plus server-side business rules (member is enrolled, plan active, inside the allowed session window) — not a server-side biometric re-verification. That's a reasonable tradeoff for a single trusted-kiosk deployment where the device secret is the thing being protected, but the `faceStation.js` comment ("the server decides authorization") reads stronger than what's actually happening, and should be documented explicitly in the eventual rollout doc (§3.8) alongside the tailgating caveat so it's a known trade-off, not a surprise.

---

## 4. Key files (orientation for a fresh session)

**Backend (gmgmt, all merged):**
- `src/services/checkInService.js` — `processCheckIn()`, the shared authorization core (asymmetric check-in/checkout rules)
- `src/api/controllers/faceBiometricController.js` — all `/face/*` and face-enroll endpoints
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
- **`data/data/gmgmt.sqlite` and the `client` submodule pointer show as locally modified on the `p3-verify` branch** in the gmgmt working tree — this is pre-existing local runtime state (DB file grew from local testing) unrelated to the face-checkin work; don't commit it accidentally with a broad `git add -A`.

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
