/**
 * Project a 3D change-region bounding box into a keyframe image:
 * all 8 corners through the camera, clamped 2D box out.
 * Used for evidence-photo overlays in the report.
 */

import type { ChangeRegion, Keyframe } from '../core/types';
import { invertRigid } from '../core/mat4';
import { projectPoint } from '../capture/unproject';

export interface Box2D {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Returns null when the region is entirely outside this keyframe's view. */
export function projectRegionBox(region: ChangeRegion, kf: Keyframe): Box2D | null {
  const inv = invertRigid(kf.pose.matrix);
  const [x0, y0, z0] = region.bboxMin;
  const [x1, y1, z1] = region.bboxMax;
  const corners: Array<[number, number, number]> = [
    [x0, y0, z0], [x1, y0, z0], [x0, y1, z0], [x1, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x0, y1, z1], [x1, y1, z1],
  ];
  let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
  let anyInFront = false;
  for (const c of corners) {
    const p = projectPoint(c, inv, kf.intrinsics, kf.imageSize);
    if (!p) continue;
    anyInFront = true;
    if (p.u < minU) minU = p.u;
    if (p.u > maxU) maxU = p.u;
    if (p.v < minV) minV = p.v;
    if (p.v > maxV) maxV = p.v;
  }
  if (!anyInFront) return null;
  const x = Math.max(0, minU);
  const y = Math.max(0, minV);
  const x2 = Math.min(kf.imageSize.w, maxU);
  const y2 = Math.min(kf.imageSize.h, maxV);
  if (x2 <= x || y2 <= y) return null; // clipped away entirely
  return { x, y, w: x2 - x, h: y2 - y };
}

/**
 * Pick the keyframe with the most direct, in-view look at the region
 * centroid: highest cosine between the camera forward axis and the direction
 * to the centroid, among keyframes where the centroid projects in-frame.
 */
export function bestKeyframeFor(region: ChangeRegion, keyframes: Keyframe[]): Keyframe | null {
  let best: Keyframe | null = null;
  let bestScore = -Infinity;
  for (const kf of keyframes) {
    const inv = invertRigid(kf.pose.matrix);
    const p = projectPoint(region.centroid, inv, kf.intrinsics, kf.imageSize);
    if (!p) continue;
    if (p.u < 0 || p.u >= kf.imageSize.w || p.v < 0 || p.v >= kf.imageSize.h) continue;
    // camera forward is -z in world = -(third column of camToWorld)
    const m = kf.pose.matrix;
    const fwd: [number, number, number] = [-m[8]!, -m[9]!, -m[10]!];
    const dir: [number, number, number] = [
      region.centroid[0] - m[12]!,
      region.centroid[1] - m[13]!,
      region.centroid[2] - m[14]!,
    ];
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const cos = (fwd[0] * dir[0] + fwd[1] * dir[1] + fwd[2] * dir[2]) / len;
    // prefer direct views; tie-break toward closer cameras
    const score = cos - len * 0.01;
    if (score > bestScore) { bestScore = score; best = kf; }
  }
  return best;
}
