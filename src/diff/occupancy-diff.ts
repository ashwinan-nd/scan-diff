/**
 * Occupancy diff between two ALIGNED clouds (ARCHITECTURE.md §8).
 *
 * Purely geometric: two clouds + keyframe frusta in, per-voxel change flags
 * out. No other inputs exist, which is what makes the pipeline
 * domain-agnostic. Photos never participate in the diff signal.
 *
 * Coverage rule: "removed" (in A, absent in B) only counts where session B
 * actually observed; "added" (in B, absent in A) only where A observed.
 * Unobserved space is a coverage gap, reported separately — an incomplete
 * rescan must not masquerade as change.
 */

import type { Intrinsics, Keyframe } from '../core/types';
import { invertRigid, type Mat4 } from '../core/mat4';
import { projectPoint } from '../capture/unproject';
import { VoxelGrid, unpackVoxelKey, voxelKey, voxelKey as voxelKeyOf } from './voxel';

export interface DiffOptions {
  voxelSizeM?: number;
  minPointsPerVoxel?: number;
  /** Chebyshev tolerance ring for occupancy matching */
  toleranceRing?: number;
  /** max depth at which a keyframe is considered to have observed a voxel */
  observationRangeM?: number;
}

export const DIFF_DEFAULTS: Required<DiffOptions> = {
  voxelSizeM: 0.05,
  minPointsPerVoxel: 3,
  toleranceRing: 1,
  observationRangeM: 8,
};

export interface VoxelDiff {
  addedKeys: number[];
  removedKeys: number[];
  voxelSizeM: number;
  /** fraction of A-occupied voxels that session B observed (coverage of the rescan) */
  coverageBofA: number;
  /** fraction of B-occupied voxels that session A observed */
  coverageAofB: number;
}

interface Frustum {
  camToWorldInv: Mat4;
  intrinsics: Intrinsics;
  imageSize: { w: number; h: number };
}

function frusta(keyframes: Keyframe[]): Frustum[] {
  return keyframes.map((kf) => ({
    camToWorldInv: invertRigid(kf.pose.matrix),
    intrinsics: kf.intrinsics,
    imageSize: kf.imageSize,
  }));
}

/**
 * Was the voxel center actually SEEN by any keyframe of the observing
 * session? Frustum inclusion alone is not enough: geometry the session
 * captured can occlude the voxel (the floor under a newly added object sits
 * in-frustum but hidden — without this check it ghosts as "removed", and the
 * ghost can even pair with the true addition into a fake "shifted").
 * Visibility = in-frame, in-range, and the segment camera→voxel passes no
 * occupied voxel of the observing session's own grid (sampled at half-voxel
 * steps; the target's immediate neighborhood is exempt — it IS the surface).
 */
function observed(
  center: [number, number, number],
  fs: Frustum[],
  camPositions: Array<[number, number, number]>,
  observerGrid: VoxelGrid,
  rangeM: number,
): boolean {
  const s = observerGrid.voxelSizeM;
  for (let i = 0; i < fs.length; i++) {
    const f = fs[i]!;
    const p = projectPoint(center, f.camToWorldInv, f.intrinsics, f.imageSize);
    if (!p) continue;
    if (p.depth > rangeM) continue;
    if (p.u < 0 || p.u >= f.imageSize.w || p.v < 0 || p.v >= f.imageSize.h) continue;

    // occlusion march from the camera toward the voxel center
    const cam = camPositions[i]!;
    const dx = center[0] - cam[0], dy = center[1] - cam[1], dz = center[2] - cam[2];
    const dist = Math.hypot(dx, dy, dz);
    // stop 1.5 voxels short: the target surface must not occlude itself
    const stop = Math.max(0, dist - 1.5 * s);
    const step = s / 2;
    let blocked = false;
    for (let t = step; t < stop; t += step) {
      const k = t / dist;
      const ix = Math.floor((cam[0] + dx * k) / s);
      const iy = Math.floor((cam[1] + dy * k) / s);
      const iz = Math.floor((cam[2] + dz * k) / s);
      if (observerGrid.isOccupied(voxelKeyOf(ix, iy, iz))) { blocked = true; break; }
    }
    if (!blocked) return true;
  }
  return false;
}

export function diffOccupancy(
  cloudA: { positions: Float32Array; count: number },
  cloudB: { positions: Float32Array; count: number },
  keyframesA: Keyframe[],
  keyframesB: Keyframe[],
  options: DiffOptions = {},
): VoxelDiff {
  const opts = { ...DIFF_DEFAULTS, ...options };
  const gridOpts = { voxelSizeM: opts.voxelSizeM, minPointsPerVoxel: opts.minPointsPerVoxel };
  const gridA = VoxelGrid.fromPoints(cloudA.positions, cloudA.count, gridOpts);
  const gridB = VoxelGrid.fromPoints(cloudB.positions, cloudB.count, gridOpts);
  const fsA = frusta(keyframesA);
  const fsB = frusta(keyframesB);
  const s = opts.voxelSizeM;

  const center = (k: number): [number, number, number] => {
    const [ix, iy, iz] = unpackVoxelKey(k);
    return [(ix + 0.5) * s, (iy + 0.5) * s, (iz + 0.5) * s];
  };

  const camPos = (kfs: Keyframe[]): Array<[number, number, number]> =>
    kfs.map((kf) => [kf.pose.matrix[12]!, kf.pose.matrix[13]!, kf.pose.matrix[14]!]);
  const camsA = camPos(keyframesA);
  const camsB = camPos(keyframesB);

  const removedKeys: number[] = [];
  let aObservedByB = 0;
  let aOcc = 0;
  for (const k of gridA.occupied()) {
    aOcc++;
    const [ix, iy, iz] = unpackVoxelKey(k);
    if (gridB.occupiedNear(ix, iy, iz, opts.toleranceRing)) {
      aObservedByB++; // matched occupancy implies B saw it
      continue;
    }
    // "removed" needs B to have genuinely seen the empty space — occlusion
    // checked against B's OWN geometry
    if (observed(center(k), fsB, camsB, gridB, opts.observationRangeM)) {
      aObservedByB++;
      removedKeys.push(k);
    }
    // else: coverage gap — B never saw there; not a change
  }

  const addedKeys: number[] = [];
  let bObservedByA = 0;
  let bOcc = 0;
  for (const k of gridB.occupied()) {
    bOcc++;
    const [ix, iy, iz] = unpackVoxelKey(k);
    if (gridA.occupiedNear(ix, iy, iz, opts.toleranceRing)) {
      bObservedByA++;
      continue;
    }
    // "added" needs A to have seen that space empty — occlusion vs A's geometry
    if (observed(center(k), fsA, camsA, gridA, opts.observationRangeM)) {
      bObservedByA++;
      addedKeys.push(k);
    }
  }

  return {
    addedKeys,
    removedKeys,
    voxelSizeM: s,
    coverageBofA: aOcc > 0 ? aObservedByB / aOcc : 0,
    coverageAofB: bOcc > 0 ? bObservedByA / bOcc : 0,
  };
}

export { voxelKey };
