# RESUME — Scan-Diff build state log

Append-only. Format per entry: `## <n> — <what>` / evidence / NEXT. A resuming session: read ARCHITECTURE.md fully, then the tail of this file, then continue from the last NEXT.

## 1 — Research + architecture (2026-07-05)

- Read spec PDFs (Desktop: scan-diff-context-and-*.pdf). Instructions PDF overrides goal text on LingBot copying: patterns only, no code/model vendoring (ARCHITECTURE.md §2).
- LingBot repos mined via subagent (lingbot-map/depth/world, Apache-2.0 confirmed). Key patterns adopted: percentile confidence culling, pose-delta keyframing w/ forced gap, pinned-anchor anti-drift, voxel-downsample→Umeyama→ICP→NN-threshold diff protocol, normalized intrinsics. Coordinate hazard documented (OpenCV vs WebXR).
- WebXR Depth API verified: Chrome/Android ARCore only; no iOS WebXR. CaptureSource abstraction + documented gap.
- `/ultraplan`, `/deep-research`, `/agents`, `graphify` are not literal features in this environment — intent executed manually. Documented ARCHITECTURE.md §3, §13.
- Stack locked: TS strict + Vite 8 + Vitest 4 + three (UI only) + jsQR; ICP hand-rolled; report = self-contained HTML + print CSS; IndexedDB local-first.
- Repo scaffolded at ~/scan-diff, work on `build` branch (worktree .claude/worktrees/build). No git remote available on this machine (gh absent) — local commits only.

Evidence: docs/ARCHITECTURE.md exists; task list #1–#10; LingBot recon report (session log).

NEXT: implement src/core (types, vec3, mat4, svd3, kdtree) + tests.

## 2 — Core + capture modules (2026-07-05)

- src/core complete: types.ts (all pipeline shapes + ScanDiffError), vec3, mat4 (rigid ops, packed transform), svd3 (one-sided Jacobi; degenerate-column completion fixed after a failing rank-deficient test), kdtree (median-split, quickselect, iterative NN with pruning; verified against brute force).
- src/capture complete: source.ts (CaptureSource seam), unproject.ts (pinhole, percentile confidence cull, projectPoint for report overlays), keyframes.ts (0.25 m / 15° / 30-frame forced gap), anchor.ts (QR corners+depth → 6-DOF marker pose, median fusion), mock.ts (ray-marched synthetic depth camera w/ deterministic noise), session.ts (ScanSessionBuilder), webxr.ts (untested-on-hardware ARCore path, actionable ScanDiffErrors), xr-ambient.d.ts (NB: must NOT be named webxr.d.ts — basename collision with webxr.ts makes tsc ignore it).
- test/fixtures/synthetic.ts: enclosure (interior pan) + subject (exterior orbit) scenario builders — the two structurally different families for the genericness proof.

Evidence: `npx vitest run` → 2 files, 30/30 passed; `npx tsc -p tsconfig.json` → exit 0. Commits 63da5ed, + capture commit.

NEXT: src/align (umeyama.ts, coarse.ts, icp.ts, quality.ts) + tests (known-transform recovery, noise, partial overlap).

## 3 — Alignment module (2026-07-05)

- umeyama.ts (SVD rigid fit, reflection guard), coarse.ts (marker path exact; 4-DOF yaw search fallback), icp.ts (trimmed p2p ICP + voxelDownsample), quality.ts (good/usable/poor verdict).
- Root-caused ICP test failure: fixed 50-iteration cap left trimmed fits unconverged (sweeps: converges ~60–70 iters under 20% trim + scene changes). Default now 100. Never touched test thresholds.
- Evidence: 41/41 tests, tsc clean. Commit 970b73f.

## 4 — Diff module (2026-07-05)

- voxel.ts (packed-key sparse grid), occupancy-diff.ts (tolerance-ring compare + coverage), regions.ts (26-conn components, shift pairing, volume-ordered), diff/index.ts facade.
- Root-caused 4 test failures to ONE bug: 21-bit/axis voxel key packing exceeded Float64 exact-int precision → key collisions + garbage unpack. Now 17 bits/axis. Coverage semantics clarified in test (occupancy-matched voxels count as observed by construction).
- Evidence: 55/55 tests, tsc clean. Commit 500271f.

## 5 — Report + pipeline + genericness harness (2026-07-05)

- report/: project.ts (bbox→2D, best-keyframe selection), summary.ts (geometry-only vocabulary), model.ts, html.ts (self-contained, print CSS, XSS-escaped). pipeline.ts = comparePipeline facade with alignment-quality gate (refuses to diff on 'poor').
- Genericness harness (test/pipeline.test.ts): enclosure (interior pan) + subject (exterior orbit) scenarios through the IDENTICAL pipeline; control run zero-region; alignment-failure path; vocabulary sweep (word-boundary regex — plain substring matched "dent" inside "identity").
- Three real bugs root-caused during harness bring-up, all fixture- or architecture-level, no threshold fudging:
  1. Level pan at 1.4 m never puts floor objects in the 25° half-FOV frustum — synthetic trajectories now sweep level + 35° down (like a real person scanning). fromYawPitchTranslation added to mat4.
  2. OCCLUSION SHADOWS (architectural): frustum-only coverage flagged the floor hidden under an added object as "removed", pairing it with the true addition into a fake "shifted". observed() now ray-marches camera→voxel against the observing session's own grid. ARCHITECTURE §8.3 updated.
  3. Grazing-angle sampling flicker ghosts (4–6 voxels, conf ≤ 0.37 vs genuine ≥ 0.51) → region minConfidence 0.45 default, calibrated on both scenario families. ARCHITECTURE §8.4 updated.
- Also: rectangular-room 180° ambiguity confirmed for yaw-search fallback (diag run without marker locked onto flipped fit with good RMSE) — validates marker-primary design; noted as known v1 limitation.
- Evidence: 76/76 tests across 6 files, tsc clean. Commit 5a6199c + this one.

NEXT: src/store (IndexedDB + codec), src/ui PWA (scan/library/compare/report screens), vite config, manifest, SW. Then registries + closing report.
