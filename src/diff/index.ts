/**
 * Diff facade: two ALIGNED clouds (+ keyframe frusta for coverage) in,
 * ChangeRegion[] + coverage stats out. This is the generic core the whole
 * product hangs off — it knows nothing about what was scanned.
 */

import type { ChangeRegion, Keyframe } from '../core/types';
import { VoxelGrid } from './voxel';
import { DIFF_DEFAULTS, diffOccupancy, type DiffOptions } from './occupancy-diff';
import { extractRegions, type RegionOptions } from './regions';

export interface DiffResult {
  regions: ChangeRegion[];
  voxelSizeM: number;
  /** fraction of A-occupied voxels the rescan (B) observed */
  coverageBofA: number;
  /** fraction of B-occupied voxels the baseline (A) observed */
  coverageAofB: number;
  addedVoxels: number;
  removedVoxels: number;
}

export function diffClouds(
  cloudA: { positions: Float32Array; count: number },
  cloudB: { positions: Float32Array; count: number },
  keyframesA: Keyframe[],
  keyframesB: Keyframe[],
  options: DiffOptions & RegionOptions = {},
): DiffResult {
  const opts = { ...DIFF_DEFAULTS, ...options };
  const vd = diffOccupancy(cloudA, cloudB, keyframesA, keyframesB, opts);

  // support counts for confidence: point counts per flagged voxel
  const gridOpts = { voxelSizeM: opts.voxelSizeM, minPointsPerVoxel: opts.minPointsPerVoxel };
  const gridA = VoxelGrid.fromPoints(cloudA.positions, cloudA.count, gridOpts);
  const gridB = VoxelGrid.fromPoints(cloudB.positions, cloudB.count, gridOpts);

  const regions = extractRegions(
    vd.addedKeys,
    vd.removedKeys,
    vd.voxelSizeM,
    gridB.counts,
    gridA.counts,
    opts.minPointsPerVoxel,
    options,
  );

  return {
    regions,
    voxelSizeM: vd.voxelSizeM,
    coverageBofA: vd.coverageBofA,
    coverageAofB: vd.coverageAofB,
    addedVoxels: vd.addedKeys.length,
    removedVoxels: vd.removedKeys.length,
  };
}

export type { DiffOptions } from './occupancy-diff';
export type { RegionOptions } from './regions';
