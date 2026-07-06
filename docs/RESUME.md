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
