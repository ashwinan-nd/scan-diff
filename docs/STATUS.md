# Closing Status Report — updated 2026-07-08

**Session continuation (2026-07-08):** PWA UI built and browser-verified.
Everything below is verified against command output and screenshots, not
asserted.

## UI layer (new since 2026-07-06)

Built: `src/ui/` (main.ts router + library/scan/compare/report screens,
viewer.ts three.js decimated point renderer, demo.ts synthetic capture through
the real CaptureSource seam, style.css), `src/store/db.ts` (IndexedDB),
index.html, vite.config.ts, public/manifest.webmanifest, public/sw.js.

Verified in a real browser (Playwright, zero console errors), evidence in
docs/screenshots/:
- library-mobile.png / library-desktop.png — library at 390 px and 1280 px
- scan-live-mobile.png — live scan with 166 k points accumulating, HUD frame/keyframe counters
- compare-mobile.png — scan pickers, pipeline run in-tab: "4 changed regions found… Alignment good (RMSE 8.3 mm, marker)"
- report-mobile.png — stored report rendered in-app: "4 changed regions detected: 1 addition, 1 removal, 1 moved object (2 linked regions)" — exactly the injected demo changes

Full user workflow executed end-to-end by clicking through the UI:
scan → save → rescan → save → compare → open report. IndexedDB persistence
confirmed across navigations. WebXR capture path wired for ARCore devices
(feature-detected; demo mode everywhere else exercises the identical
pipeline).

## Built and proven (76/76 tests passing, `tsc` clean)

| Layer | Files | Evidence |
|---|---|---|
| Core math | src/core: types, vec3, mat4, svd3 (Jacobi), kdtree | 17 unit tests incl. brute-force NN cross-check |
| Capture | src/capture: source seam, unproject (percentile confidence cull), keyframes (0.25 m/15°/30-gap), QR anchor math + median fusion, mock ray-marcher, session builder | 13 tests incl. end-to-end mock session |
| Alignment | src/align: umeyama, coarse (marker exact + 4-DOF yaw fallback), trimmed ICP, quality gate | 11 tests: known-transform recovery <5 mm/0.5°, 15% scene-change robustness, poor-verdict refusal |
| Diff | src/diff: packed-key voxel grid, occlusion-aware coverage, 26-conn regions, shift pairing, confidence floor | 14 tests: detection, no-false-positive control, coverage rule, symmetry |
| Report | src/report: bbox→2D projection, best-keyframe evidence, geometry-only summary, self-contained HTML + print CSS | 14 tests incl. XSS escaping, self-containment |
| Pipeline | src/pipeline.ts comparePipeline | genericness harness below |
| Genericness proof | test/pipeline.test.ts | Two structurally different scenarios (interior pan enclosure; exterior orbit subject) through the IDENTICAL pipeline; zero-change control; vocabulary sweep (no vertical nouns in src/) |
| Store codec | src/store/codec.ts (versioned, corruption-guarded) | encode/decode written; tests NOT yet written — see Stubbed |

## Real bugs found and root-caused (never threshold-fudged)

1. ICP 50-iteration cap left trimmed fits unconverged → 100 (sweep evidence).
2. Voxel key packing 21 bits/axis broke Float64 exact-integer precision → 17.
3. Synthetic level-pan trajectories never saw floor objects (25° half-FOV) → pitched sweeps like real scanning.
4. **Occlusion shadows**: frustum-only coverage flagged floor hidden under new objects as "removed", pairing into fake "shifted" → occlusion ray-march added (ARCHITECTURE §8.3).
5. Grazing-angle sampling ghosts (conf ≤0.37 vs genuine ≥0.51) → region confidence floor 0.45.
6. Rectangular-room 180° yaw ambiguity confirmed for markerless fallback → validates marker-primary design (documented limitation).

## Remaining (in dependency order for resumption)

1. WebXR real-device smoke test (needs ARCore hardware + HTTPS; `webxr.ts` written to spec, typed, feature-detected — but never run on hardware).
2. Live QR anchor detection during AR capture (jsQR wired as a dependency; anchor math tested; the RGB-frame detection loop in the AR path is not yet written — demo mode simulates the anchor).
3. `.scandiff` export/import envelope (codec done; file wrapper not).
4. Report photo pipeline on real captures (mock sessions have no RGB; geometry evidence cards already render in reports).
5. `vite build` production-bundle check + PWA install audit (dev-server verified; production build not exercised).

## Deliverable checklist vs definition of done

- (1) Architecture doc: docs/ARCHITECTURE.md — complete, consistent with code as of this commit. ✅
- (2) Code in dependency order, tested: capture→align→diff→report all finished before UI started. ✅ (UI unstarted — limit)
- (3) Genericness proven by harness, not asserted. ✅
- (4) Skill registry: docs/SKILLS.md (none built — justified there). ✅
- (5) Subagents: docs/AGENTS.md + .claude/agents/*.md (4 defs, handoff contracts). ✅
- (6) This report + current RESUME.md. ✅

## Resume instructions

Read docs/ARCHITECTURE.md fully → docs/RESUME.md tail → continue at Stubbed #1.
Repo: github.com/ashwinan-nd/scan-diff, branch `build` (main has scaffold only;
open a PR build→main on GitHub when ready — no gh CLI on this machine).
