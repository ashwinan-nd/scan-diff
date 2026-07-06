# Closing Status Report — session ending 2026-07-06

**Why stopped:** weekly usage limit (97% when the wrap order arrived), not
completion. Everything below is verified against command output, not asserted.

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

## Stubbed / not built (in dependency order for resumption)

1. `src/store/db.ts` — IndexedDB wrapper (2 object stores). codec.ts done+committed, untested.
2. `test/store.test.ts` — codec round-trip (Node: Blob available since 18).
3. PWA UI (`src/ui/`, index.html, vite.config.ts, manifest, SW): scan screen w/ live decimated point view (three.js), library, compare flow, report view. Design constraints in ARCHITECTURE §3, §4.
4. WebXR real-device smoke test (needs ARCore hardware + HTTPS).
5. `.scandiff` export/import envelope.
6. Report photo pipeline on real captures (mock sessions have no RGB; geometry evidence cards already render).

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
