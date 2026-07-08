/**
 * Demo capture: synthetic scenes streamed through the REAL capture stack
 * (MockCaptureSource -> ScanSessionBuilder), so every device can exercise the
 * full scan -> save -> rescan -> compare -> report flow without ARCore
 * hardware. The pipeline cannot tell demo scans from sensor scans — that is
 * the point (same CaptureSource seam).
 */

import type { Pose, ScanSession } from '../core/types';
import { fromYawPitchTranslation, identity } from '../core/mat4';
import {
  MOCK_INTRINSICS, MockCaptureSource, type SceneBox, type SyntheticScene,
} from '../capture/mock';
import { ScanSessionBuilder } from '../capture/session';
import { unprojectDepth } from '../capture/unproject';
import { anchorFromCorners, type CornerSample } from '../capture/anchor';

const box = (min: [number, number, number], max: [number, number, number]): SceneBox => ({ min, max });

/** Interior demo space: 4x3 m footprint shell + a fixed half-meter-scale block. */
function interiorScene(extras: SceneBox[]): SyntheticScene {
  const t = 0.05;
  return {
    boxes: [
      box([-2, -0.05 - t, -1.5], [2, -0.05, 1.5]),
      box([-2 - t, -0.05, -1.5], [-2, 2.5, 1.5]),
      box([2, -0.05, -1.5], [2 + t, 2.5, 1.5]),
      box([-2, -0.05, -1.5 - t], [2, 2.5, -1.5]),
      box([-2, -0.05, 1.5], [2, 2.5, 1.5 + t]),
      box([-1.9, 0, 0.9], [-1.3, 0.75, 1.4]),   // fixed block, present in both
      ...extras,
    ],
  };
}

function panTrajectory(at: [number, number, number], steps: number): Pose[] {
  const poses: Pose[] = [];
  const half = Math.ceil(steps / 2);
  for (const pitch of [0, (-35 * Math.PI) / 180]) {
    for (let i = 0; i < half; i++) {
      poses.push({ matrix: fromYawPitchTranslation((i / half) * Math.PI * 2, pitch, at) });
    }
  }
  return poses;
}

export interface DemoScenario {
  /** neutral naming — the scenario is geometry, not a vertical */
  id: 'baseline' | 'rescan';
  label: string;
}

/** What differs between the demo baseline and rescan (geometry only). */
const BASELINE_EXTRAS: SceneBox[] = [
  box([1.2, 0, -1.3], [1.7, 0.45, -0.9]),   // will be REMOVED in rescan
  box([0.2, 0, 0.6], [0.55, 0.35, 0.95]),   // will be MOVED in rescan
];
const RESCAN_EXTRAS: SceneBox[] = [
  box([-0.6, 0, -1.2], [-0.2, 0.5, -0.85]), // ADDED in rescan
  box([-1.1, 0, 0.55], [-0.75, 0.35, 0.9]), // the moved block's new spot
];

export interface DemoProgress {
  frame: number;
  totalFrames: number;
  points: number;
  keyframes: number;
}

/**
 * Run a demo capture. Streams frames with a small delay so the live viewer
 * visibly accumulates points, exactly like a real scan would.
 */
export async function runDemoCapture(
  which: DemoScenario['id'],
  onFrame: (progress: DemoProgress, positions: Float32Array, count: number) => void,
  frameDelayMs = 60,
): Promise<ScanSession> {
  const extras = which === 'baseline' ? BASELINE_EXTRAS : RESCAN_EXTRAS;
  const at: [number, number, number] = which === 'baseline' ? [0, 1.4, 0] : [0.12, 1.35, 0.08];
  const trajectory = panTrajectory(at, 24);
  const source = new MockCaptureSource({
    scene: interiorScene(extras),
    trajectory,
    depthSize: { w: 96, h: 72 },
    noiseSigmaM: 0.004,
    seed: which === 'baseline' ? 11 : 22,
  });
  const builder = new ScanSessionBuilder({ unproject: { stride: 1 } });

  // both demo sessions saw the same simulated marker on the fixed block
  const mk = (u: number, v: number): CornerSample => ({ u, v, depthM: 1.5 });
  const obs = anchorFromCorners(
    [mk(40, 30), mk(52, 30), mk(52, 42), mk(40, 42)],
    { w: 96, h: 72 },
    MOCK_INTRINSICS,
    { matrix: identity() },
    'demo-marker',
  );
  if (obs) builder.addAnchorObservation(obs);

  // live accumulation buffer for the viewer: this frame re-unprojected at a
  // coarse stride (render preview only — the builder keeps the full data)
  const chunks: Float32Array[] = [];
  let total = 0;
  let frame = 0;
  for await (const f of source.start()) {
    builder.addFrame(f);
    frame++;
    const stats = builder.stats;
    const framePts = unprojectDepth(f.depth, f.depthSize, f.pose, f.intrinsics, { stride: 4 });
    chunks.push(framePts);
    total += framePts.length / 3;
    const merged = new Float32Array(total * 3);
    let o = 0;
    for (const c of chunks) { merged.set(c, o); o += c.length; }
    onFrame(
      { frame, totalFrames: trajectory.length, points: stats.points, keyframes: stats.keyframes },
      merged,
      total,
    );
    if (frameDelayMs > 0) await new Promise((r) => setTimeout(r, frameDelayMs));
  }

  const label = which === 'baseline' ? 'Demo baseline' : 'Demo rescan';
  return builder.build(
    `demo-${which}-${Date.now()}`,
    label,
    'demo (synthetic depth)',
  );
}
