# Skill Registry — Scan-Diff build

Per goal requirement: registry of skills used/built, purpose, prune verdicts.

## Used this session (installed, no gaps found)

| Skill | Purpose here | Verdict |
|---|---|---|
| boil-the-ocean | Completeness standard for the whole session (invoked by goal) | Earned keep |
| superpowers:systematic-debugging (protocol followed) | Root-cause discipline: ICP iteration cap, voxel-key overflow, occlusion shadows — all root-caused via layer isolation, zero threshold fudging | Earned keep |
| research (protocol followed inline) | WebXR Depth API support matrix, ICP/report library decisions | Earned keep |
| caveman | Token economy on $20 plan | Earned keep |

## Built this session

None. **Justification:** no capability gap survived long enough to justify a custom skill. The four automatable subtasks the goal named (capture QA, alignment tuning, diff calibration, report audit) are subagent-shaped, not skill-shaped — they need fresh context + parameter sweeps, not reusable procedure docs. Building skills for them would be under-5-use fluff by the goal's own standard. See docs/AGENTS.md for the subagent layer instead.

## Pruned

None removed: all installed skills either used this session or outside this project's scope (UI skills pending the UI build). Re-audit at UI time.

## Audit 2 (2026-07-08, UI/upload pass)

- Used this pass: boil-the-ocean (goal-invoked), pixel-perfection protocol (multi-viewport Playwright screenshots before any "done" claim), design research via live browsing (awwwards patterns → implemented from scratch), karpathy-guidelines discipline (surgical diffs, no speculative abstraction — sync contract is the one deliberate seam and it was explicitly requested).
- Built: still none. Candidate considered — "ply-fixture-generator" for synthetic upload files; rejected: two uses this session (node one-liner + test helpers), under the 5-use bar by its own rule. The inline node script and test/fixtures/synthetic.ts cover it.
- Pruned: nothing new; no installed skill has fallen to fluff status.
