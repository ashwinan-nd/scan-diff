# Subagent Registry — Scan-Diff

Definitions live in `.claude/agents/*.md`. Handoff contract shared by all four:
input = fixture/scenario names + parameter ranges in the prompt; output = a
markdown table of parameter → metric, plus a one-paragraph recommendation;
**never edits `src/`** — the main session owns all code changes.

| Agent | Responsibility | Inputs | Output metric |
|---|---|---|---|
| capture-qa | Run MockCaptureSource scenarios, verify point budgets, keyframe counts, anchor fusion across trajectory/noise sweeps | scenario builder names, noise σ range, trajectory params | points/scan, kfs/scan, anchor error (m) |
| alignment-tuner | ICP parameter sweeps (trim ratio, gate schedule, iteration cap) against known-transform fixtures | transform magnitudes, noise levels, change fractions | residual rotation (deg), translation (m), iterations |
| diff-calibrator | Sweep voxelSizeM / minPointsPerVoxel / minConfidence against injected ground truth; report precision/recall | scenario pair, threshold grids | ghost count, missed count, TP confidence range |
| report-auditor | Render ReportModel fixtures, verify every region represented, no external requests, print-CSS integrity | ReportModel fixtures | missing-region count, policy violations |

Used this session: alignment-tuner and diff-calibrator protocols were executed
inline (ICP iteration sweep; confidence floor calibration 0.37/0.51 split) —
their findings are baked into defaults and documented in ARCHITECTURE §7–8.
Additionally one repo-recon subagent (LingBot pattern mining) ran at session
start; its report drove ARCHITECTURE §2.
