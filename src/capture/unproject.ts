/**
 * Depth image -> world-space points (pinhole unprojection).
 * Convention (ARCHITECTURE.md §6): image y grows down, camera y grows up,
 * camera looks down -z; pose is camera-to-world.
 *
 * Confidence handling follows the LingBot percentile pattern: when a
 * confidence buffer exists we drop the lowest `confidencePercentile` percent
 * of samples rather than applying an absolute cutoff (sensor scales vary).
 */

import type { Intrinsics, Pose } from '../core/types';
import { transformPoint } from '../core/mat4';
import { DEPTH_MAX_M, DEPTH_MIN_M } from './source';

export interface UnprojectOptions {
  /** sample every Nth pixel in both axes (depth buffers are dense; 4 ≈ plenty) */
  stride?: number;
  minDepthM?: number;
  maxDepthM?: number;
  /** drop the lowest N percent by confidence when confidence data exists (0..100) */
  confidencePercentile?: number;
}

export function unprojectDepth(
  depth: Float32Array,
  size: { w: number; h: number },
  pose: Pose,
  intrinsics: Intrinsics,
  opts: UnprojectOptions = {},
  confidence?: Float32Array,
): Float32Array {
  const stride = opts.stride ?? 4;
  const minD = opts.minDepthM ?? DEPTH_MIN_M;
  const maxD = opts.maxDepthM ?? DEPTH_MAX_M;
  const pct = opts.confidencePercentile ?? 20;

  // percentile threshold over the sampled confidence values (LingBot pattern)
  let confFloor = -Infinity;
  if (confidence && pct > 0) {
    const sampled: number[] = [];
    for (let v = 0; v < size.h; v += stride)
      for (let u = 0; u < size.w; u += stride) {
        const c = confidence[v * size.w + u];
        if (c !== undefined && c > 0) sampled.push(c);
      }
    if (sampled.length > 0) {
      sampled.sort((a, b) => a - b);
      confFloor = sampled[Math.min(sampled.length - 1, Math.floor((pct / 100) * sampled.length))]!;
    }
  }

  const { fx, fy, cx, cy } = intrinsics;
  const out: number[] = [];
  for (let v = 0; v < size.h; v += stride) {
    for (let u = 0; u < size.w; u += stride) {
      const i = v * size.w + u;
      const z = depth[i]!;
      if (!Number.isFinite(z) || z < minD || z > maxD) continue;
      if (confidence && confidence[i]! < confFloor) continue;
      // pixel center, normalized coords
      const xn = ((u + 0.5) / size.w - cx) / fx;
      const yn = ((v + 0.5) / size.h - cy) / fy;
      const pCam: [number, number, number] = [xn * z, -yn * z, -z];
      const pW = transformPoint(pose.matrix, pCam);
      out.push(pW[0], pW[1], pW[2]);
    }
  }
  return new Float32Array(out);
}

/**
 * Project a world point into pixel coords of a camera. Returns null when the
 * point is behind the camera. Used by keyframe evidence selection and report
 * bounding-box overlay.
 */
export function projectPoint(
  pW: [number, number, number],
  camToWorldInv: Float32Array,
  intrinsics: Intrinsics,
  imageSize: { w: number; h: number },
): { u: number; v: number; depth: number } | null {
  const pc = transformPoint(camToWorldInv, pW);
  const z = -pc[2];
  if (z <= 0) return null;
  const { fx, fy, cx, cy } = intrinsics;
  const u = (fx * (pc[0] / z) + cx) * imageSize.w;
  const v = (fy * (-pc[1] / z) + cy) * imageSize.h;
  return { u, v, depth: z };
}
