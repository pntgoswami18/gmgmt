# Face Check-In — Handoff / Progress Status

**Design doc:** [`face-checkin-plan.md`](./face-checkin-plan.md) (read that first for *why*; this doc is *where things stand* and *what's next*).

**Note on naming:** `phase2-plan.md` / `phase3-plan.md` / `phase4-plan.md` in this same `docs/` directory are an **unrelated** initiative (code-quality/logging/test-coverage remediation). This feature's phases (P0–P5) are sections *inside* `face-checkin-plan.md`, not separate files. Don't confuse the two "Phase 4"s.

Last updated: 2026-07-13 (full audit pass: gmgmt#26/#27/#28 and client#12/#13/#14 all confirmed merged — the re-entry-within-dwell-window fix landed; a submodule-pointer bump to pick up client#14 is open as gmgmt#32; a new planned-but-unbuilt gap identified, §3.11 admin-UI entry point; all test suites re-run clean).

---

## 1. Where things stand

| Phase | Repo | What it is | Status |
|---|---|---|---|
| P0 | gmgmt | Environment spike — LiteRT.js perf smoke test, model checkpoint pick | ✅ Merged (#16) |
| P1 | gmgmt | Model pipeline — SFace ONNX→TFLite conversion, quantization, LFW eval harness | ✅ Merged (#17) |
| P2 | gmgmt | Backend — `checkInService` extraction, face endpoints, schema | ✅ Merged (#18) |
| P3 | client | Enrollment UI — `faceEngine.js`, `FaceEnrollment.js` tab | ✅ Merged (#10, squash) |
| P3 | gmgmt | Model deployment — `deploy-models.js` + manifest | ✅ Merged (#21) |
| P3 | gmgmt | Verification pass — fixed midnight-fragile tests, verify-skill hardening | ✅ Merged (#22) |
| P4 | client | Kiosk UI — `/checkin` route, matching/liveness/cache modules, `useFaceCheckin` hook | ✅ Merged ([client#11](https://github.com/pntgoswami18/client/pull/11), commit `b83312f`) |
| — | gmgmt | Bump `client` submodule pointer to new client `main` | ✅ Merged ([gmgmt#23](https://github.com/pntgoswami18/gmgmt/pull/23), commit `af6283d`) |
| — | gmgmt | Add missing `.gitmodules` + check-in trust-model doc note | ✅ Merged ([gmgmt#24](https://github.com/pntgoswami18/gmgmt/pull/24), commit `3803945`) |
| — | client | Staff-facing Settings UI for face config | ✅ Merged ([client#12](https://github.com/pntgoswami18/client/pull/12), commit `69c35b2`) |
| — | gmgmt | Dev fix: stop tracking `.claude/launch.json` (machine-specific paths) | ✅ Merged ([gmgmt#26](https://github.com/pntgoswami18/gmgmt/pull/26), commit `795b37e`) — shipped differently than first drafted, see §5 |
| — | gmgmt | **Security: recompute face match server-side** (closes part of §3.9's trust gap) | ✅ Merged ([gmgmt#27](https://github.com/pntgoswami18/gmgmt/pull/27), commit `445098d`) |
| — | client | Companion: kiosk sends probe embedding for server re-scoring | ✅ Merged ([client#13](https://github.com/pntgoswami18/client/pull/13), commit `0f088e4`) |
| — | gmgmt | Fix: re-entry within checkout dwell window unlocks door, doesn't double-log | ✅ Merged ([gmgmt#28](https://github.com/pntgoswami18/gmgmt/pull/28), commit `b4c24ce`) |
| — | client | Fix: inverted liveness turn direction, generic denial messages, re-entry UI, face-tracking overlay | ✅ Merged ([client#14](https://github.com/pntgoswami18/client/pull/14), commit `64be0a6`) |
| — | gmgmt | Bump `client` submodule pointer to pick up client#14 (`64be0a6`) | ✅ Merged ([gmgmt#32](https://github.com/pntgoswami18/gmgmt/pull/32), commit `c0692b5`) |
| — | gmgmt | Windows compatibility: port `deploy-models.sh`/`download-models.sh` to Node | ✅ Done this pass (see §7) |
| — | client+gmgmt | **New gap found: admin-UI entry point to the kiosk** (plan §3.6, see §3.11) | ⬜ **Planned only — zero code.** No "Launch kiosk" button, no `deviceSecretConfigured` field |
| — | ops | Run `deploy-models.js` on the actual deployment target | ⬜ Not started |
| — | ops | Set `DEVICE_SHARED_SECRET` env var + provision kiosk browser | ⬜ Not started |
| — | ops | Register/pair the ESP32 door device, set `face_door_device_id` | ⬜ Not started (hardware-dependent) |
| — | human | Real-camera walk-up test (enroll → kiosk scan → unlock) | ⬜ Not started |
| — | docs | Rollout doc: name the tailgating + device-secret-replay + liveness-temporal-binding limitations explicitly | ⬜ Not started |

**Bottom line:** the backend, pure-logic, kiosk-UI, Settings-UI, server-side match recompute, and re-entry-fix code are all written, unit-tested, and now **merged** (the only code-carrying PR still open is the submodule-pointer bump, gmgmt#32). The admin-UI entry point (§3.11) is the one place where more frontend+backend work is still genuinely unwritten. Everything else remaining is deployment/config/ops work: run the model deploy script, set the device secret, register hardware, and do a real walk-up test.

---

## 2. Repo/branch/PR map

**gmgmt** (backend + docs), `main` tip: `b4c24ce`
- `f80bd90` P1 (#17) → `3340ad3` P2 (#18) → `21e1639` P3 model-deploy (#21) → `fcd6b36` P3 verify (#22) → `af6283d` submodule bump (#23) → `3803945` `.gitmodules` + trust-model doc (#24) → `a698156` handoff doc update (#25) → `795b37e` untrack `.claude/launch.json` (#26) → `445098d` server-side match recompute (#27) → `b4c24ce` re-entry-within-dwell-window fix (#28)
- **Open:** [gmgmt#32](https://github.com/pntgoswami18/gmgmt/pull/32) `bump-client-pointer` → `main` — bumps the `client` submodule pointer to `64be0a6` (client#14). Docs/pointer only, no backend code.

**client** (frontend, git submodule `github.com/pntgoswami18/client.git`), `main` tip: `64be0a6`
- `5a421f1` P3 enrollment (#10, **squash-merged** — old commit SHAs `19b653b`/`b794545` are *not* ancestors of `main`, see §5 gotcha)
- `b83312f` P4 kiosk (#11, squash-merged) → `69c35b2` Settings UI (#12) → `0f088e4` probe-embedding companion to gmgmt#27 (#13) → `64be0a6` kiosk fixes: liveness turn direction, denial messages, re-entry UI, face-tracking overlay (#14, squash-merged)
- No open client PRs.

**gmgmt's submodule pointer** for `client` is still `b83312f` on `main` (P3+P4 only — predates client#12/#13/#14). The bump to `64be0a6` (picking up everything through client#14) is open as **gmgmt#32** and needs merging for a fresh clone to resolve the current kiosk code. `.gitmodules` (previously missing — a fresh clone couldn't resolve the submodule URL) is committed via #24.

---

## 3. Pending work, in order

### 3.1 ~~Merge client PR #11~~ — done
Merged 2026-07-13 as `b83312f`.

### 3.2 ~~Merge gmgmt#23 (submodule bump)~~ — done
Merged 2026-07-13 as `af6283d`. `.gitmodules` fix + trust-model doc note also merged separately as gmgmt#24 (`3803945`) — see §3.9.

### 3.3 ~~Staff-facing Settings UI~~ — done
[client#12](https://github.com/pntgoswami18/client/pull/12), merged as `69c35b2`. Adds a "Face Check-In" section to `Settings.js`'s General tab: enable toggle, match threshold (number input, not a slider — kept consistent with the rest of the file's existing input patterns), liveness mode select (native `<select>` via the same `TextField select SelectProps={{native:true}}` pattern already used for currency/color-mode, not MUI `Select` — avoids a new import), door device ID (plain text field — `GET /api/biometric/devices` turned out to be unreliable for a dropdown: it 503s when `ENABLE_BIOMETRIC=false` and only lists devices seen in the last 24h, so free text with a helper note was more robust), checkout dwell minutes, and a read-only pinned-model-version display. `PUT /api/settings` needed no changes — it already accepts arbitrary keys via `INSERT OR REPLACE`, no allowlist.

Live-verified end to end against a running local backend: panel loads correct defaults from `GET /api/settings`, editing fields fires the existing "unsaved changes" dirty-tracking, Save round-trips through `PUT /api/settings`, and a fresh reload confirms persistence. See §5 for two automation gotchas hit during that verification (MUI Checkbox event handling, and a screenshot/CSS-pixel coordinate mismatch) — not relevant to the shipped code, just to future browser-automation debugging.

**Known limitation carried into §3.11:** this panel only mentions `/checkin` in caption text — there's no button that takes staff there. See §3.11.

### 3.4 Deploy models to the target environment
`tools/face-model/deploy-models.js` (originally `.sh`, merged in #21; **ported to cross-platform Node** — see §7) copies the fp32 embedder + pinned `face_landmarker.task` + WASM runtimes into `public/models/` and writes `manifest.json`. **`public/models/` is gitignored** — this must be *run*, not just merged, on every environment that needs to serve the kiosk (dev, staging, prod). Confirm it's been run wherever `/checkin` will actually be tested/used; `GET /api/biometric/face/model-manifest` 404s otherwise (see `getModelManifest` in `faceBiometricController.js`). Run with `node tools/face-model/deploy-models.js` (requires `build/face_embedder_v1_fp32.tflite` from `convert.py` and `client/node_modules` from `npm install` in `client/` — same prerequisites as before, just no bash/curl/sha256sum dependency now).

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

### 3.10 Re-entry within checkout dwell window — merged (gmgmt#28 + client#14)
Found during manual testing: a member who checked in, stepped back out briefly (e.g. a phone call at the entrance), and re-scanned **before** `face_checkout_min_dwell_minutes` elapsed was denied (`dwell_time_not_met`) and the door stayed locked — a real usability bug, not just an edge case.

- **[gmgmt#28](https://github.com/pntgoswami18/gmgmt/pull/28)** (merged as `b4c24ce`): an early re-scan on an already-open attendance row is now treated as a **re-entry** — `checkInService.processCheckIn` returns `authorized: true, action: 'reentry'` (door unlocks via the normal authorized→unlock path) without checking the member out or inserting a duplicate attendance row, and returns `minutesUntilCheckout` so the kiosk can tell the member when checkout actually unlocks. Re-entry deliberately applies **only** the `member.is_active` gate — not the full session-window/plan-validity gates a fresh check-in enforces — because the member is already inside an active visit; re-validating them out of it near a session boundary would strand someone legitimately present.
- **[client#14](https://github.com/pntgoswami18/client/pull/14)** (merged as `64be0a6`): the matching frontend half, plus two independent bug fixes found in the same testing pass:
  1. **Liveness turn direction was inverted.** The kiosk shows a mirrored selfie view, but `faceAlign`'s yaw ratio is image-space (`ratio > 0` = nose toward image-right, which happens when the subject turns their own **left**). The `turn_left`/`turn_right` challenge checks had the comparison backwards, so a "turn left" prompt was only satisfied by physically turning right. This is a real bug worth flagging distinctly from the dwell-window fix — it would have made the liveness challenge confusing-to-unusable for every real user, not an edge case.
  2. **Denial messages were mostly generic.** `DENY_MESSAGES` was keyed on strings the backend never actually returns (`session_window`, `inactive_plan`); re-keyed to the real reason strings (`outside_session_windows`, `member_inactive`, `cross_session_violation`, …) so denials are now specific and actionable instead of a generic "Something went wrong" for almost everything.
  3. **New face-tracking overlay** — a reticle + directional arrows drawn on a canvas over the video feed (`faceOverlayGeometry.js` for pure cover-mapping/anchoring math, tested; `faceOverlayDraw.js` for the actual canvas strokes, validated live per its own header comment since drawing code isn't meaningfully unit-testable). Wired into `useFaceCheckin`'s existing per-frame loop — no second rAF loop.

### 3.11 Admin-UI entry point to the kiosk — planned (plan doc §3.6), zero code written
A plan-only commit (`docs/face-checkin-plan.md` §3.6, no code) identifies a real gap: **there is currently no path from the admin UI to `/checkin` at all.** Staff have to know and hand-type the URL. Confirmed via grep against the current tree — neither piece below exists in code yet:

- **A "Launch check-in kiosk" button**, decided location: inside the Settings → Face Check-In section (`Settings.js`, next to the enable toggle and Door Device ID — colocated with the feature flag and the config it depends on). Must open `/checkin` in a **new tab** (`window.open` or `<a target="_blank">`), never an in-tab drawer `Link` — the kiosk is deliberately chrome-less (no AppBar/drawer/logout) so an in-tab navigation would strand the staff member fullscreen with no visible way back. Secondary button recommended on the Biometric tab too.
- **A `deviceSecretConfigured` boolean** added to the existing `GET /api/biometric/face/config` response (`!!process.env.DEVICE_SHARED_SECRET` — never the value itself; no new endpoint needed, since staff sessions already reach this endpoint via `FACE_BOOTSTRAP_PATHS`). Lets the Settings panel pre-flight-warn *before* launch ("server device secret not set") instead of the operator discovering a 503 only after walking to the kiosk.
- Explicitly **rejected**: piping `DEVICE_SHARED_SECRET` itself through the admin session to pre-fill `StationSetup` — would put the secret into a staff-session HTTP response, browser history, and devtools, directly weakening the fail-closed posture the rest of this feature protects. The hand-typed-secret-into-`StationSetup` flow stays as-is; only a non-secret readiness signal is added.
- Also specified: `/checkin` opened from an authenticated admin tab shares the staff session cookie, so the bootstrap `/face/config` call succeeds via that session even before a device secret is entered (correctly renders `disabled`/`no_door`) — but `/face/sync` and `/face/check-in` still accept **only** the device secret, so actual scanning still requires completing `StationSetup`. This is intentional, not a bug to fix.

This is genuinely unbuilt — worth prioritizing before rollout, since without it the kiosk is only reachable by staff who already know to type `/checkin` manually.

---

## 4. Key files (orientation for a fresh session)

**Backend (gmgmt):**
- `src/services/checkInService.js` — `processCheckIn()`, the shared authorization core (asymmetric check-in/checkout rules). As of gmgmt#28 (merged), also owns the re-entry-within-dwell-window branch (`action: 'reentry'`), gated only by `member.is_active` — see §3.10 for why it's narrower than a fresh check-in's gates.
- `src/api/controllers/faceBiometricController.js` — all `/face/*` and face-enroll endpoints. `faceCheckIn` recomputes the cosine match server-side from the client's probe `embedding` (via `src/utils/faceMatch.js`); the client `matchScore` is advisory and `livenessPassed` is still a client-asserted gate (see §3.9)
- `src/utils/faceMatch.js` — pure server-side cosine match / probe validation, the authoritative re-scoring the door unlock hangs on (mirror of the kiosk's `faceMatching.js`)
- `src/config/sqlite.js:287-292` — face settings defaults
- `src/app.js:110-163` — auth routing: `FACE_STATION_PATHS` (device-secret-only, fail-closed), `FACE_BOOTSTRAP_PATHS` (device-secret OR staff session)
- `tools/face-model/` — P1 conversion/eval scripts + `deploy-models.js` (Node, cross-platform — see §7)
- `tools/simulate-esp32-door.js` — local dev-only ESP32 door simulator (heartbeat self-registration + serves the unlock-command HTTP endpoint on port 80, needs `sudo`), used to manually verify gmgmt#28's re-entry unlock live. Untracked as of this audit; being added to the repo separately.

**Frontend (client):**
- `src/utils/faceEngine.js` — LiteRT.js + MediaPipe wrapper, shared by enrollment and kiosk
- `src/components/FaceEnrollment.js` — enrollment tab (merged, P3)
- `src/utils/faceAlign.js` — pure geometry (alignment, pose, capture-slot decision)
- `src/utils/faceMatching.js` — cosine similarity, `MatchAccumulator` (K-consecutive-frame gate)
- `src/utils/faceLiveness.js` — `LivenessChallenge` (blink/head-turn state machine)
- `src/utils/faceCacheDb.js` — IndexedDB gallery cache, delta-merge core
- `src/utils/faceStation.js` — device-secret station config, fail-closed status derivation, and `submitCheckIn` (now sends the probe `embedding` — client#13)
- `src/utils/faceOverlayGeometry.js` / `faceOverlayDraw.js` — pure cover-mapping/anchoring math (tested) + canvas rendering (live-validated only) for the kiosk's face-tracking reticle/arrow overlay (client#14, merged)
- `src/hooks/useFaceCheckin.js` — orchestrates the above into the walk-up loop; also where the probe-vs-liveness temporal-binding gap (§3.9) lives
- `src/components/CheckIn.js` — fullscreen `/checkin` UI (all phase screens)
- `src/components/Settings.js` — Face Check-In settings section (client#12); no launch-kiosk affordance yet (§3.11)
- `src/App.js` — `/checkin` route branch, before the auth/drawer layout

**Test files:** every pure-logic `.js` in the list above has a co-located `.test.js` (component/hook files — `CheckIn.js`, `useFaceCheckin.js`, `FaceEnrollment.js`, `Settings.js`, `faceOverlayDraw.js` — do not, by design or because they're view-only). See §6 for current pass counts.

---

## 5. Gotchas learned this round (save yourself the debugging time)

- **PR #10 was squash-merged.** Its source commits (`19b653b`, `b794545`) are *not* ancestors of `client/main`. A branch built on top of them (like `face-checkin-kiosk` was) cannot be rebased normally — use `git rebase --onto origin/main <old-base-commit> <branch>` to replay only the branch's own commits onto the new history. A plain `git rebase origin/main` will try to replay the now-squashed commits too and produce duplicate/conflicting diffs.
- **`FaceLandmarker` needed `outputFaceBlendshapes: true`** to expose eyeBlink scores for the liveness challenge — it was `false` in the P3 enrollment code (enrollment doesn't need blinks). Already flipped in `faceEngine.js` as part of #11.
- **The admin MUI theme forces a dark `color` on `h4`/`h5` Typography** (`App.js`'s `buildTheme`), which is unreadable on the kiosk's dark background. `CheckIn.js` overrides it locally via `.MuiTypography-h2/h3/h4/h5 { color: inherit }` on its root container — don't remove that rule.
- **`FACE_STATION_PATHS` (`/face/sync`, `/face/check-in`) fail closed with 503 if `DEVICE_SHARED_SECRET` is unset** — this is intentional (see `app.js` comment), not a deployment bug. `FACE_BOOTSTRAP_PATHS` (`/face/config`, `/face/model-manifest`) is more permissive by design — it accepts either the device secret or a staff session, so the admin enrollment UI and the kiosk can both call it.
- **`data/data/gmgmt.sqlite` shows as locally modified** in the gmgmt working tree on most branches — pre-existing local runtime state (DB file grew from local testing) unrelated to the face-checkin work; don't commit it accidentally with a broad `git add -A`.
- **This repo's working directory can be shared by more than one concurrent session.** During this work, a parallel session committed unrelated `.gitmodules`/trust-model-doc work (gmgmt#24) on a new branch and, via a broad `git add`, incidentally scooped up this handoff file mid-edit — it landed in that PR as a stale snapshot, requiring a manual reconcile (`git pull` after backing up the local copy, then re-applying edits to the now-tracked file) to avoid losing either version. Run `git status` before any branch switch, and don't assume you're the only writer in this directory.
- **`better-sqlite3`'s native binding is Node-version-specific.** The plain `node` in `.claude/launch.json`'s backend config resolves to whatever the shell's default is (Node 18 in this environment), which throws a `NODE_MODULE_VERSION` ABI mismatch on startup. See the gmgmt#26 entry below for the actual fix (local-only, not committed) and why an earlier committed-path attempt was rejected; if the binary was previously built against a different Node version, `npm rebuild better-sqlite3` under the target Node first.
- **Browser-automation gotchas hit while verifying the Settings panel (client#12), for future live-verification sessions:** (1) MUI `Checkbox` sometimes needs a real coordinate-based click rather than the `form_input` tool's boolean-value path to reliably fire React's `onChange` — verify state changes via a direct DOM/JS check (`input.checked`) rather than trusting a screenshot. (2) On this environment the Browser pane's screenshot pixel coordinates and `getBoundingClientRect()`'s CSS-pixel coordinates did **not** match 1:1 (a `devicePixelRatio: 2` page) — a raw `computer` click at screenshot-derived coordinates missed its target by roughly 2x. Prefer `ref`-based clicks (resolved internally by the tool) or coordinates read from `getBoundingClientRect()` over eyeballing a screenshot.
- **This project runs many concurrent sessions in parallel git worktrees as a matter of course** (`git worktree list` typically shows half a dozen at once under `.claude/worktrees/`), not just as an occasional collision. Treat any shared working directory (i.e., not your own worktree) as actively co-owned: `git status`/`git diff` before touching tracked files that aren't yours, and if you find unstaged modifications you didn't make, leave them alone and do your own work in a fresh worktree off `origin/main` rather than branching from a dirty HEAD. This audit found exactly that: uncommitted edits to `checkInService.js` and two test files, mid-flight from another session, sitting on the same branch (`face-checkin-kiosk-fixes`) this session was also using.
- **gmgmt#26 shipped differently than first drafted.** An earlier attempt fixed the Node-18-vs-`better-sqlite3` launch failure by committing an absolute path to a specific machine's Node 22 binary in `.claude/launch.json`. That was correctly rejected in favor of **gitignoring the file entirely** — a machine-specific `runtimeExecutable` path doesn't belong in version control regardless of which machine wrote it. If `preview_start` fails on `better-sqlite3`'s `NODE_MODULE_VERSION`, the fix is local: point your own `.claude/launch.json` at your own Node ≥ 20 binary (or `npm rebuild better-sqlite3` under it), not a commit.
- **gmgmt#27's PR description overstated what the server-side match recompute actually defends against** — multi-agent review caught that `/face/sync` hands out raw embeddings to anyone holding the device secret, so the "recompute" adds no friction against a malicious secret-holder, only against an honest-but-buggy kiosk. See §3.9's full writeup. Worth remembering when reading *any* PR description in this feature area: verify security claims against the actual auth boundary (here, `X-Device-Secret`), not just against what a diff appears to fix.

---

## 6. Test commands (copy-paste for a fresh session)

Last run during this audit (2026-07-13, Node 22):

| Suite | Command | Result |
|---|---|---|
| gmgmt backend unit tests | `node --test 'src/services/__tests__/*.test.js'` | **89/89 pass** |
| gmgmt ESP32 integration tests | `JWT_SECRET=x ENABLE_BIOMETRIC=true BIOMETRIC_PORT=5005 PORT=3001 node src/app.js &` then `npm run esp32:test` | **5/5 pass** |
| client face-checkin utils | see command below | **83/83 pass** |
| client full suite | `CI=true npx react-scripts test --watchAll=false` | 88/93 pass — 2 failing suites (`App.test.js`, `SearchableMemberDropdown.test.js`) are **pre-existing and unrelated to face check-in**; confirmed via `git log` showing neither file touched since the original CRA scaffold / PR #2 |

```bash
# gmgmt backend (from repo root; needs Node >= 20)
node --test 'src/services/__tests__/*.test.js'
npm run esp32:test   # needs server running with ENABLE_BIOMETRIC=true

# client frontend (from client/)
CI=true npx react-scripts test --testPathPattern="utils/(faceStation|faceMatching|faceLiveness|faceCacheDb|faceAlign|faceOverlay)" --watchAll=false
npx react-scripts build   # full compile/lint check
```

---

## 7. Windows compatibility

Audited on request: does the runtime path (server + browser kiosk) and its supporting tooling work on a Windows deployment machine, not just macOS/Linux dev machines?

**Already solid, no changes needed:**
- `src/config/sqlite.js` has an explicit `win32` branch for the DB data path (`%ProgramData%\gmgmt` fallback, or `WIN_DATA_ROOT` override).
- `biometricListener.js`'s TCP listener binds `0.0.0.0` — no OS-specific socket code.
- All npm scripts that set env vars use `cross-env` (both repos) — the common `FOO=bar node x` Windows footgun is already avoided.
- All file paths in `multer.js`, `app.js`'s static serving, and `sqlite.js` use `path.join`/`path.extname`, never hardcoded `/` concatenation.
- The kiosk itself (`/checkin`, camera access, MediaPipe/LiteRT WASM) is pure browser code — identical on Windows Chrome/Edge, nothing OS-specific.

**Fixed this round:**
- **`tools/face-model/deploy-models.sh` and `download-models.sh` were bash-only** (`sha256sum`/`shasum`, `cp -R`, `mkdir -p`, `curl`) — none of which exist in plain `cmd.exe`/PowerShell. Since `public/models/` is gitignored and must be generated on every deployment target, a Windows machine without WSL/Git Bash could not populate it, blocking the kiosk and enrollment UI from loading a model at all. **Ported both to Node** (`deploy-models.js`, `download-models.js` + a shared `tools/face-model/lib/fetchVerify.js` for the sha256/download/verify logic) — `fs`/`crypto`/`https` only, no shell dependency. Verified live: `download-models.js` ran end-to-end against the real pinned URLs (redirect-following + SHA-256 verification all correct) and was confirmed idempotent on a second run; `deploy-models.js`'s guard clauses were exercised (clean exit on missing prerequisite files). The old `.sh` files were removed, not just superseded, to avoid two implementations drifting apart.

**Still not addressed (out of scope for this pass, worth knowing):**
- `tools/simulate-esp32-door.js` needs to bind port 80 and tells the operator to `sudo` — Unix-specific. Not a production blocker (real ESP32 hardware binds its own port 80 as embedded firmware, independent of the host OS; the gmgmt backend only makes *outbound* HTTP calls to it, which need no elevated privilege on any OS) — only affects using this specific dev-only simulator tool on Windows, where the equivalent would be running as Administrator or reserving the port via `netsh http add urlacl`.
- `ESP32_DEPLOYMENT_GUIDE.md` and `tools/WINDOWS_TESTING_GUIDE.md`, both referenced by `package.json`'s `esp32:help`/`windows:help` scripts, do not exist — pre-existing dead references (predates face check-in), not fixed here.
- The Phase 0/1 model-conversion tooling (`convert.py`, `evaluate.py`, the Python `.venv`) is developer-only, one-time tooling for building/updating the models — not something a gym's Windows deployment machine ever runs, so it wasn't in scope for this audit even though it's Python/venv-based and not verified cross-platform.
