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
