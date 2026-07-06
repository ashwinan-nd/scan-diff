/**
 * Coarse alignment: session-B world → session-A world.
 *
 * Primary path: shared marker. T = anchorA · anchorB⁻¹ — exact regardless of
 * where either scan started (the marker is the shared pinned reference,
 * LingBot "scale frame" analog).
 *
 * Fallback (no shared marker): 4-DOF search. Gravity is shared (WebXR y is
 * gravity-aligned), so the unknown is yaw + translation. We search yaw
 * coarse-to-fine; for each yaw, translation comes from aligning occupancy
 * centroids; score = voxel-overlap at 0.2 m. Documented v1 limitation:
 * needs ≥ ~40% scene overlap (ARCHITECTURE.md §7, §10).
 */

import type { AnchorObservation, PointCloud } from '../core/types';
import { fromYawTranslation, invertRigid, multiply, transformPacked, type Mat4 } from '../core/mat4';

export interface CoarseResult {
  transform: Mat4;
  method: 'marker' | 'yaw-search';
  /** overlap score 0..1 for yaw-search; 1 for marker (exact by construction) */
  score: number;
}

export function coarseFromAnchors(
  anchorA: AnchorObservation,
  anchorB: AnchorObservation,
): CoarseResult | null {
  if (anchorA.markerId !== anchorB.markerId) return null;
  return {
    transform: multiply(anchorA.pose.matrix, invertRigid(anchorB.pose.matrix)),
    method: 'marker',
    score: 1,
  };
}

const VOX = 0.2;

function voxelSet(positions: Float32Array, count: number): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i < count; i++) {
    const k = `${Math.floor(positions[3 * i]! / VOX)},${Math.floor(positions[3 * i + 1]! / VOX)},${Math.floor(positions[3 * i + 2]! / VOX)}`;
    s.add(k);
  }
  return s;
}

function centroid(positions: Float32Array, count: number): [number, number, number] {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < count; i++) {
    x += positions[3 * i]!; y += positions[3 * i + 1]!; z += positions[3 * i + 2]!;
  }
  return [x / count, y / count, z / count];
}

function scoreCandidate(setA: Set<string>, bPts: Float32Array, count: number): number {
  let hits = 0;
  for (let i = 0; i < count; i++) {
    const k = `${Math.floor(bPts[3 * i]! / VOX)},${Math.floor(bPts[3 * i + 1]! / VOX)},${Math.floor(bPts[3 * i + 2]! / VOX)}`;
    if (setA.has(k)) hits++;
  }
  return hits / count;
}

/** Subsample a cloud to at most n points (uniform stride). */
function subsample(cloud: PointCloud, n: number): { positions: Float32Array; count: number } {
  if (cloud.count <= n) return { positions: cloud.positions, count: cloud.count };
  const stride = Math.ceil(cloud.count / n);
  const count = Math.floor((cloud.count + stride - 1) / stride);
  const out = new Float32Array(count * 3);
  let o = 0;
  for (let i = 0; i < cloud.count; i += stride) {
    out[3 * o] = cloud.positions[3 * i]!;
    out[3 * o + 1] = cloud.positions[3 * i + 1]!;
    out[3 * o + 2] = cloud.positions[3 * i + 2]!;
    o++;
  }
  return { positions: out, count: o };
}

export function coarseYawSearch(cloudA: PointCloud, cloudB: PointCloud): CoarseResult {
  const a = subsample(cloudA, 20000);
  const b = subsample(cloudB, 8000);
  const setA = voxelSet(a.positions, a.count);
  const cA = centroid(a.positions, a.count);

  const evalYaw = (yaw: number): { score: number; m: Mat4 } => {
    // rotate B about origin, then translate so centroids coincide
    const rot = fromYawTranslation(yaw, [0, 0, 0]);
    const rotated = transformPacked(rot, b.positions, b.count);
    const cB = centroid(rotated, b.count);
    const m = fromYawTranslation(yaw, [cA[0] - cB[0], cA[1] - cB[1], cA[2] - cB[2]]);
    const placed = transformPacked(m, b.positions, b.count);
    return { score: scoreCandidate(setA, placed, b.count), m };
  };

  let best = { score: -1, m: fromYawTranslation(0, [0, 0, 0]) };
  let bestYaw = 0;
  for (let deg = 0; deg < 360; deg += 10) {
    const yaw = (deg * Math.PI) / 180;
    const r = evalYaw(yaw);
    if (r.score > best.score) { best = r; bestYaw = yaw; }
  }
  for (let d = -8; d <= 8; d += 2) {
    const yaw = bestYaw + (d * Math.PI) / 180;
    const r = evalYaw(yaw);
    if (r.score > best.score) best = r;
  }
  return { transform: best.m, method: 'yaw-search', score: Math.max(0, best.score) };
}

/** Full coarse policy: marker when both sessions share one, else yaw search. */
export function coarseAlign(
  cloudA: PointCloud,
  cloudB: PointCloud,
  anchorA: AnchorObservation | null,
  anchorB: AnchorObservation | null,
): CoarseResult {
  if (anchorA && anchorB) {
    const viaMarker = coarseFromAnchors(anchorA, anchorB);
    if (viaMarker) return viaMarker;
  }
  return coarseYawSearch(cloudA, cloudB);
}
