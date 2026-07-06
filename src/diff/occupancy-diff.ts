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
import { VoxelGrid, unpackVoxelKey, voxelKey } from './voxel';

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

/** Was the voxel center inside any keyframe's view frustum within range? */
function observed(
  center: [number, number, number],
  fs: Frustum[],
  rangeM: number,
): boolean {
  for (const f of fs) {
    const p = projectPoint(center, f.camToWorldInv, f.intrinsics, f.imageSize);
    if (!p) continue;
    if (p.depth > rangeM) continue;
    if (p.u >= 0 && p.u < f.imageSize.w && p.v >= 0 && p.v < f.imageSize.h) return true;
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
    if (observed(center(k), fsB, opts.observationRangeM)) {
      aObservedByB++;
      removedKeys.push(k);
    }
    // else: coverage gap — B never looked there; not a change
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
    if (observed(center(k), fsA, opts.observationRangeM)) {
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
