# Scan-Diff — System Architecture

**Status:** living document. Every decision here is final unless RESUME.md says otherwise.
**Audience:** a fresh session with zero prior context must be able to resume mid-build from this file + `docs/RESUME.md` without re-deriving any decision.

## 1. What Scan-Diff is

Scan a physical space or object with a phone. Save it. Scan the same thing again later. Scan-Diff aligns both 3D scans and reports **what changed** — added, removed, shifted material — as a human-readable report with before/after photos, bounding boxes, size estimates, and a written summary.

**Product = the diff + the report. Not the point cloud.** Point clouds are infrastructure.

**Domain-agnostic by construction:** the core pipeline (capture → align → diff → report) contains zero vertical-specific vocabulary, branches, labels, or assumptions. The same code path serves rental move-out disputes, insurance pre-loss documentation, construction progress, vehicle intake/pickup, and any other "did this thing change" use case. Any code path that only makes sense for one vertical is a design failure. Report text is generated from geometry only ("added material, ~0.4 × 0.3 × 0.5 m, ≈0.06 m³, 2.1 m from scan origin"). "Does this change matter" is the human reader's judgment, never the pipeline's.

## 2. Relationship to LingBot (Robbyant org)

Mined 2026-07-05 from shallow clones of `lingbot-map`, `lingbot-depth`, `lingbot-world`. All **Apache-2.0** (verified LICENSE files; no separate model-weight license; lingbot-world wraps upstream Wan — irrelevant, we take no weights).

**Decision: mine patterns, do not vendor code or models.** LingBot is Python/PyTorch feed-forward transformer inference (GPU, learned depth). Scan-Diff runs in the browser on real sensor depth from the WebXR Depth API — a learned depth model is the wrong tool when the phone hands you hardware depth. (The goal text's "copy wholesale" and the instructions PDF's "do not copy wholesale" conflict; instructions PDF wins because copying PyTorch model code into a browser TS app is architecturally meaningless. Apache-2.0 would have permitted it either way.)

Patterns adopted from LingBot, with sources:

| Pattern | LingBot source | Scan-Diff use |
|---|---|---|
| Keyframe selection by reprojected-flow magnitude, force-keyframe every N | `lingbot-map/lingbot_map/gct_stream_window_v2.py:515-665` (flow > threshold px OR 30-frame gap) | `capture/keyframes.ts`: keep frame if translation > 0.25 m or rotation > 15° since last keyframe (pose-based analog of their flow test — we have real poses, they don't), force every 30 accepted frames |
| Percentile-based confidence culling, never absolute thresholds | `lingbot-map/lingbot_map/vis/glb_export.py:137-140` | `capture/unproject.ts`: when depth confidence buffer exists, drop lowest-percentile points (default 20th pct) + hard validity floor |
| Pinned "scale frames" as global anti-drift anchor | `lingbot-map/lingbot_map/aggregator/stream.py:44-49` | Anchor frame (QR marker observation) is the pinned global reference both sessions share |
| Align-then-diff protocol: voxel downsample → Umeyama coarse → ICP fine → NN-distance threshold | `lingbot-map/benchmark/benchmark/geometry/registration.py:65,266,361`, `evaluation/points.py:10-207` | Exactly our `align/` + `diff/` pipeline ordering; ICP max-correspondence 0.1 m matches theirs |
| Resolution-normalized intrinsics (fx/W, fy/H, cx/W, cy/H) | `lingbot-depth/mdm/utils/geo.py:24` | `core/types.ts` `Intrinsics` is stored normalized — multi-device safe (two different phones across sessions) |
| Live viz decimation (render every Nth point, stride frames) | `lingbot-map/lingbot_map/vis/point_cloud_viewer.py:41-209` | `ui/` live scan view renders decimated accumulation |

**Coordinate-convention hazard (biggest silent-bug risk, documented deliberately):** LingBot uses OpenCV camera convention (x-right, **y-down**, z-forward; extrinsics = world→camera). WebXR uses x-right, **y-up**, **z-backward**; poses are camera→world (rigid `XRRigidTransform`). **Scan-Diff standardizes on the WebXR convention everywhere**: right-handed, y-up, −z forward, meters, poses are camera-to-world 4×4 column-major (`Float32Array(16)`, WebGL layout — same as `XRRigidTransform.matrix` and three.js). Anything imported from an OpenCV-convention source must be converted at the boundary, never internally.

## 3. Stack (chosen, with justification)

| Choice | Why |
|---|---|
| TypeScript strict, ES2022 modules | Typed where stack supports it (spec bar); browser-first |
| Vite 8 + PWA (hand-rolled manifest + SW, no plugin) | Standard, fast; PWA = installable on phone, offline-capable, local-first |
| Vitest 4 | Core pipeline is pure TS with zero DOM deps → unit/integration tests run in Node |
| three.js 0.185 | UI rendering of live point accumulation + scan viewer ONLY. Core pipeline never imports three |
| jsQR 1.4 (MIT) | QR marker detection for anchor frames. Only battle-tested zero-dep JS fiducial detector; ArUco JS ports are unmaintained |
| **No ICP library — hand-rolled** | No maintained JS/WASM ICP lib exists (checked 2026-07). Point-to-point ICP = kd-tree NN + Umeyama SVD, ~250 lines, fully unit-testable. Owning it lets diff layer share the kd-tree |
| **No PDF library** | Report = single self-contained HTML file (inline CSS, base64 images) with `@media print` styles → browser print-to-PDF. Zero deps, pixel-controllable, embeds images/boxes/text cleanly |
| IndexedDB (raw, thin wrapper) | Local-first scan persistence. No wrapper lib — our access pattern is 2 object stores |

Environment findings (spec asked): `/ultraplan`, `/deep-research`, `/agents` are **not** literal commands in this Claude Code environment — intent executed manually (this doc = the plan pass; LingBot mining + WebXR research = the research pass; subagent registry §11 = the agents pass). WebXR Depth API support (verified 2026-07): **Chrome on Android (ARCore) only**; W3C Working Draft Dec 2025, single-engine. **No WebXR on iOS Safari at all.** Consequence: capture is abstracted behind `CaptureSource`; iOS is a documented v1 gap (§10), not a silent one.

## 4. Repo layout

```
scan-diff/
├── docs/
│   ├── ARCHITECTURE.md        ← this file
│   ├── RESUME.md              ← state log, updated after every unit of work
│   ├── SKILLS.md              ← skill registry (built/used/pruned + justification)
│   └── AGENTS.md              ← subagent registry (responsibilities + handoff contracts)
├── src/
│   ├── core/                  # pure math + types. No DOM, no three.js
│   │   ├── types.ts           # PointCloud, Pose, Intrinsics, ScanSession, ChangeRegion…
│   │   ├── vec3.ts, mat4.ts   # minimal linear algebra (column-major, y-up)
│   │   ├── svd3.ts            # 3×3 SVD (one-sided Jacobi) for Umeyama
│   │   └── kdtree.ts          # static balanced kd-tree over packed Float32Array
│   ├── capture/               # sensor → ScanSession. Browser APIs isolated here
│   │   ├── source.ts          # CaptureSource interface + CaptureFrame
│   │   ├── webxr.ts           # WebXRCaptureSource (immersive-ar + depth-sensing)
│   │   ├── mock.ts            # MockCaptureSource (synthetic scenes; used by all tests)
│   │   ├── unproject.ts       # depth image + pose + intrinsics → world-space points
│   │   ├── keyframes.ts       # keyframe policy (pose delta / forced interval)
│   │   └── anchor.ts          # QR marker → 6-DOF anchor pose (jsQR corners + depth)
│   ├── align/
│   │   ├── coarse.ts          # anchor-to-anchor rigid transform; 4-DOF yaw fallback
│   │   ├── umeyama.ts         # closed-form rigid fit (rotation+translation, no scale)
│   │   ├── icp.ts             # trimmed point-to-point ICP
│   │   └── quality.ts         # AlignmentQuality: inlier RMSE, overlap ratio, verdict
│   ├── diff/
│   │   ├── voxel.ts           # VoxelGrid: hash-based occupancy over packed points
│   │   ├── occupancy-diff.ts  # A/B occupancy compare with 1-ring tolerance
│   │   └── regions.ts         # 26-connected components → ChangeRegion[], shift pairing
│   ├── report/
│   │   ├── model.ts           # ReportModel assembly (regions + keyframe evidence)
│   │   ├── project.ts         # 3D bbox → 2D box on best keyframe photo
│   │   ├── summary.ts         # written summary from geometry (domain-free vocabulary)
│   │   └── html.ts            # self-contained HTML render + print CSS
│   ├── store/
│   │   ├── db.ts              # IndexedDB: scans + reports object stores
│   │   └── codec.ts           # ScanSession ↔ binary blob (versioned)
│   ├── pipeline.ts            # comparePipeline(scanA, scanB, opts) → Report. THE core API
│   └── ui/                    # PWA screens (scan / library / compare / report)
├── test/
│   ├── fixtures/synthetic.ts  # scene builders: room-scale + object-scale generators
│   ├── *.test.ts              # unit per module
│   └── pipeline.test.ts       # cross-scenario genericness harness
├── index.html, vite.config.ts, manifest.webmanifest, sw.js
└── .claude/agents/*.md        # subagent definitions (§11)
```

**Dependency rule:** `core ← capture ← align ← diff ← report ← pipeline ← ui`. Arrows only point left. `ui` and `webxr.ts`/`db.ts` are the only files allowed to touch browser APIs. Everything else runs in Node.

## 5. Data model (implementation-precise)

```ts
// core/types.ts — canonical shapes. All lengths meters, all matrices column-major Float32Array(16), y-up.
interface Intrinsics { fx: number; fy: number; cx: number; cy: number } // NORMALIZED by width/height (LingBot pattern)
interface Pose { matrix: Float32Array }                                  // camera→world (WebXR convention)
interface PointCloud { positions: Float32Array /* xyz packed */; count: number }
interface Keyframe {
  id: number; pose: Pose; intrinsics: Intrinsics;
  imageBlob?: Blob;          // JPEG of camera frame (evidence photo)
  imageSize: { w: number; h: number };
  timestamp: number;
}
interface AnchorObservation { pose: Pose /* marker→world */; markerId: string; sizeMeters: number }
interface ScanSession {
  id: string; label: string; createdAt: number;
  cloud: PointCloud;         // accumulated, world frame of ITS OWN session
  keyframes: Keyframe[];
  anchor: AnchorObservation | null;   // null ⇒ coarse alignment falls back (§7)
  deviceInfo: string;        // provenance only, never logic
  version: 1;
}
type ChangeKind = 'added' | 'removed' | 'shifted';
interface ChangeRegion {
  kind: ChangeKind;
  voxelCount: number; volumeM3: number;
  bboxMin: [number,number,number]; bboxMax: [number,number,number]; centroid: [number,number,number];
  shiftPartner?: number;      // index of paired region when kind === 'shifted'
  confidence: number;         // 0..1, from voxel support density
}
interface AlignmentQuality { rmse: number; overlapRatio: number; iterations: number; converged: boolean; verdict: 'good'|'usable'|'poor' }
```

Persistence: `codec.ts` serializes ScanSession → `{ meta JSON, positions ArrayBuffer, keyframe JPEGs }` in IndexedDB. Export/import as a single `.scandiff` file (JSON envelope, base64 blobs, `version` field for migration). **Privacy: all data device-local. Nothing leaves the device. Delete scan = delete IndexedDB rows. No telemetry, no server. Stated in UI.**

## 6. Capture module

`CaptureSource` contract: `start(opts) → AsyncIterable<CaptureFrame>`, `stop()`. `CaptureFrame = { depth: Float32Array, depthSize {w,h}, pose, intrinsics, rgb?: ImageBitmap, confidence?: Float32Array, timestamp }`.

**WebXRCaptureSource** (`webxr.ts`): `navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['depth-sensing'], depthSensing: { usagePreference: ['cpu-optimized'], dataFormatPreference: ['float32', 'luminance-alpha'] } })`. Per `XRFrame`: `getDepthInformation(view)` → depth buffer (handle both float32 and luminance-alpha uint16/8 formats, `rawValueToMeters` scale), `getViewerPose(refSpace)` → pose, `view.projectionMatrix` → intrinsics (fx = pm[0]\*w/2 normalized form; derive via FoV). Depth clamped to [0.2, 8] m; zero/NaN dropped. Requires HTTPS + user gesture. Feature-detect and fail with actionable error (`CaptureError` with `reason: 'no-webxr' | 'no-depth' | 'permission-denied' | 'tracking-lost'`).

**Unprojection** (`unproject.ts`, pure): pinhole — for pixel (u,v), depth z: `xc = (u/w − cx)/fx · z`, `yc = −((v/h − cy)/fy) · z` (image y down → camera y up), `zc = −z` (WebXR looks down −z); then `p_world = pose.matrix · [xc,yc,zc,1]`. Subsample stride default 4 (depth buffers are 160×90–320×240; full-res unprojection of every frame is wasteful). Percentile confidence cull when confidence buffer present.

**Keyframes** (`keyframes.ts`, pure): accept frame as keyframe if ‖Δt‖ > 0.25 m or rotation angle > 15° vs last keyframe, or 30 accepted frames elapsed (LingBot force-gap). Keyframes keep RGB JPEG; non-keyframes contribute points only.

**Anchor** (`anchor.ts`): user prints/places any QR code (content = marker id, any string) in the scene; app scans it during capture. jsQR on the RGB frame → 4 corner pixels → unproject each corner with depth → marker plane basis (origin = corner centroid; x = top edge direction; z = plane normal via cross; y = z×x; orthonormalized via Gram-Schmidt) → `AnchorObservation.pose`. Physical size measured from unprojected corners (no assumed print size). Multiple observations during one scan → median-averaged (quaternion nlerp for rotation, componentwise median translation) for noise robustness.

## 7. Alignment module (algorithms to implementation precision)

Goal: transform T mapping session-B world frame → session-A world frame.

**Coarse:** if both sessions have the same `markerId` anchor: `T_coarse = poseA_marker · poseB_marker⁻¹`. Viewpoint drift between sessions is irrelevant — the marker is the shared frame (LingBot "pinned scale frame" analog). If either anchor is missing: **4-DOF fallback** — gravity is shared (WebXR y-up is gravity-aligned): search yaw ∈ [0°, 360°) at 10° steps × translation from centroid match; score each candidate by voxel-occupancy overlap at 0.2 m resolution; take best, refine yaw ±10° at 2° steps. Documented v1 limitation: fallback assumes scans overlap ≥ ~40%; marker path is the reliable one.

**ICP refine** (`icp.ts`, trimmed point-to-point):
1. Voxel-downsample both clouds to 2 cm (dedupe by voxel, centroid per voxel) — LingBot benchmark pattern.
2. Build kd-tree over cloud A once.
3. Iterate ≤ 100 (was 50; parameter sweep showed trimmed sets converge at ~60–70 iterations when scene changes are present): for each B point (transformed by current T), NN in A; keep pairs with dist < d_max (start 0.5 m, × 0.9 per iteration, floor 0.05 m); of those keep best 80% by distance (trim — handles partial overlap + genuine scene changes, which are outliers to alignment); solve rigid Umeyama (no scale — metric sensors) on trimmed set; update T; converge when |ΔRMSE| < 1e-4 m or rotation update < 0.01°.
4. `umeyama.ts`: centroids, covariance H = Σ(a−ā)(b−b̄)ᵀ, SVD(H) via `svd3.ts` one-sided Jacobi, R = V·diag(1,1,det(VUᵀ))·Uᵀ, t = ā − R·b̄.

**Quality** (`quality.ts`): final inlier RMSE (< 0.03 good, < 0.08 usable, else poor), overlap ratio = fraction of B points with NN < 0.1 m. `verdict: 'poor'` ⇒ pipeline **refuses to diff** and surfaces actionable error ("scans could not be aligned — rescan with the marker visible") — never a silent bad report.

## 8. Diff module

Input: two aligned `PointCloud`s + `DiffOptions { voxelSizeM = 0.05, minPointsPerVoxel = 3, minRegionVoxels = 4, toleranceRing = 1 }`. Output: `ChangeRegion[]`. **Generic function of geometry; no other inputs exist.**

1. **Voxelize** both clouds: key = `(⌊x/s⌋, ⌊y/s⌋, ⌊z/s⌋)` packed into a JS Map key (int coords, string or bigint pack); voxel occupied iff ≥ `minPointsPerVoxel` points (sensor-noise floor).
2. **Compare with tolerance:** voxel occupied in B but no occupied A voxel within Chebyshev distance ≤ `toleranceRing` ⇒ **added**; occupied in A with no B neighbor ⇒ **removed**. The 1-ring tolerance absorbs residual alignment error ≤ 1 voxel — without it every surface would ghost-flag (this is why diff keys on geometry, not photos: lighting changes can't create geometry).
3. **Coverage mask:** a removed-candidate voxel only counts if session-B actually observed that space (voxel within any B keyframe's frustum + depth range); otherwise it's *unobserved*, not removed — reported separately as coverage gap %, never as a change. Prevents false "removed" from incomplete rescans.
4. **Regions:** 26-connected components over flagged voxels, drop components < `minRegionVoxels`. Per region: bbox, centroid, `volumeM3 = voxelCount·s³`, confidence = mean point-support saturation.
5. **Shift pairing:** greedy match added↔removed regions with |volume ratio − 1| < 0.35 and centroid distance < 2 m and bbox-diagonal ratio within 0.5–2×; matched pairs become two `shifted` regions pointing at each other. Unmatched stay added/removed.

## 9. Report module

`ReportModel`: per region, choose evidence keyframes — from each session, the keyframe whose frustum contains the region centroid with the most direct view (max cosine between view dir and centroid dir, tie-break nearest). `project.ts` projects the 8 bbox corners through that keyframe's (pose, intrinsics) → 2D box (clamped to frame). `summary.ts` builds the written summary from geometry alone: counts by kind, per-region dimension string (sorted extents), volume, distance from scan origin, coverage-gap disclosure, alignment quality line. Vocabulary whitelist enforced by test: no domain nouns anywhere in `src/` core (`room`, `car`, `wall`, `furniture`, `damage`… — test greps for them).

`html.ts`: one self-contained HTML string — inline CSS, base64 JPEG evidence pairs with SVG bbox overlays, before/after side-by-side per region, summary header ("N changes detected"), metadata footer (scan dates, device provenance, alignment RMSE, voxel size, coverage), `@media print` page-break rules → clean PDF via browser print. No external requests (privacy + offline).

## 10. Known v1 limitations (stated, not hidden)

1. **Capture hardware:** WebXR Depth API = Chrome/Android ARCore devices only. iOS has no WebXR. Mitigation path (future): photogrammetry fallback or native wrapper. UI shows capability check up front.
2. **Marker dependency:** reliable coarse alignment needs the same QR marker placed in both scans. 4-DOF fallback exists but needs ≥ ~40% overlap and distinctive geometry. Stated in UI at scan time.
3. **Real-hardware capture untested in this build session** (no ARCore device available to the build environment) — `webxr.ts` is written to spec and type-checked, `MockCaptureSource` proves everything downstream; hardware smoke test is the first manual step (RESUME.md).
4. Moved-object pairing is heuristic (volume/extent matching) — ambiguous swaps of similar-sized objects may pair wrong; report shows both regions regardless, so no information is lost.
5. Single anchor per scan v1; multi-marker graphs are future work.

## 11. Skills & subagents

Registries live in `docs/SKILLS.md` and `docs/AGENTS.md` (kept current; that's the source of truth, this section just points there). Subagent definitions in `.claude/agents/*.md`: `synthetic-scene-qa` (capture harness testing), `alignment-tuner` (ICP parameter sweeps), `diff-calibrator` (threshold sweeps vs injected ground truth), `report-auditor` (report completeness vs regions). Handoff contract: each takes fixture paths + parameter ranges in the prompt, returns a table of metric vs parameter, never edits `src/`.

## 12. Test strategy

- Unit: math (vec3/mat4/svd3/kdtree round-trips), umeyama (known R,t recovered exactly), icp (synthetic transform + noise + partial overlap → error < 5 mm / 0.5°), voxel/occupancy-diff (hand-built grids), regions (injected blobs detected, none-changed → zero regions), unproject (round-trip project/unproject), keyframes, anchor math, summary/html (all regions represented, whitelist).
- Integration (`pipeline.test.ts`): **two structurally different synthetic scenarios** through the identical `comparePipeline` — (a) room-scale: 4×3×2.5 m walls/floor + box added on floor + box removed from corner + chair-sized blob moved; (b) object-scale: 1.8×0.6×1.4 m vehicle-ish shell + dent (surface depression) + attached blob removed. Assert: every injected change detected with correct kind ± position, zero false regions on unchanged geometry, report HTML contains every region, run twice with zero code/config difference besides inputs.
- Manual (logged in RESUME.md): report visual QA via screenshots, UI pixel pass desktop+mobile widths, real-device capture when hardware available.

## 13. Resume protocol

`docs/RESUME.md` = append-only state log. After every meaningful unit of work: what was done, evidence (test command + result), next action. A resuming session reads ARCHITECTURE.md → RESUME.md tail → continues from "NEXT:". Never trust a claim in RESUME.md that lacks an evidence line. ("graphify" was named in the goal as a possible resume-log tool — no such tool exists in this environment; verified 2026-07-05. Plain markdown log it is.)
