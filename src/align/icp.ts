/**
 * Trimmed point-to-point ICP refinement (ARCHITECTURE.md §7).
 *
 * Fixed cloud A gets one kd-tree; moving cloud B is re-transformed each
 * iteration. Correspondences beyond a shrinking max distance are dropped, and
 * of the survivors only the best `trimRatio` by distance are kept — genuine
 * scene changes (the very thing we are trying to detect later) are outliers
 * to alignment and must not drag the fit.
 */

import { KdTree } from '../core/kdtree';
import {
  identity, multiply, rotationAngle, transformPacked, translationOf, type Mat4,
} from '../core/mat4';
import { umeyamaRigid } from './umeyama';

export interface IcpOptions {
  maxIterations?: number;
  /** starting max correspondence distance, meters */
  maxCorrespondenceStartM?: number;
  /** per-iteration shrink factor of the correspondence gate */
  correspondenceShrink?: number;
  /** floor of the correspondence gate */
  maxCorrespondenceFloorM?: number;
  /** fraction of gated correspondences kept (best by distance) */
  trimRatio?: number;
  /** convergence: |ΔRMSE| below this */
  rmseEpsilonM?: number;
  /** convergence: rotation update angle below this (radians) */
  rotationEpsilonRad?: number;
  /** voxel size for pre-decimation of both clouds */
  downsampleVoxelM?: number;
  /** cap on moving-cloud points used per iteration */
  maxMovingPoints?: number;
}

export interface IcpResult {
  /** refined B→A transform (includes the initial guess) */
  transform: Mat4;
  rmse: number;
  iterations: number;
  converged: boolean;
  /** fraction of moving points with a fixed neighbor within 0.1 m at the end */
  overlapRatio: number;
}

/** Voxel-grid downsample: one centroid per occupied voxel. */
export function voxelDownsample(
  positions: Float32Array,
  count: number,
  voxelM: number,
): { positions: Float32Array; count: number } {
  const acc = new Map<string, [number, number, number, number]>();
  for (let i = 0; i < count; i++) {
    const x = positions[3 * i]!, y = positions[3 * i + 1]!, z = positions[3 * i + 2]!;
    const k = `${Math.floor(x / voxelM)},${Math.floor(y / voxelM)},${Math.floor(z / voxelM)}`;
    const a = acc.get(k);
    if (a) { a[0] += x; a[1] += y; a[2] += z; a[3]++; }
    else acc.set(k, [x, y, z, 1]);
  }
  const out = new Float32Array(acc.size * 3);
  let o = 0;
  for (const [, [sx, sy, sz, n]] of acc) {
    out[3 * o] = sx / n; out[3 * o + 1] = sy / n; out[3 * o + 2] = sz / n;
    o++;
  }
  return { positions: out, count: o };
}

export function icpRefine(
  fixedPositions: Float32Array,
  fixedCount: number,
  movingPositions: Float32Array,
  movingCount: number,
  initial: Mat4,
  opts: IcpOptions = {},
): IcpResult {
  // 100, not 50: trimming shrinks the per-iteration step, and sweeps showed
  // convergence at ~60-70 iterations under 20% trim with scene changes present.
  const maxIter = opts.maxIterations ?? 100;
  const shrink = opts.correspondenceShrink ?? 0.9;
  const gateFloor = opts.maxCorrespondenceFloorM ?? 0.05;
  const trimRatio = opts.trimRatio ?? 0.8;
  const rmseEps = opts.rmseEpsilonM ?? 1e-4;
  const rotEps = opts.rotationEpsilonRad ?? (0.01 * Math.PI) / 180;
  const voxel = opts.downsampleVoxelM ?? 0.02;
  const maxMoving = opts.maxMovingPoints ?? 20000;

  const fixed = voxelDownsample(fixedPositions, fixedCount, voxel);
  let moving = voxelDownsample(movingPositions, movingCount, voxel);
  if (moving.count > maxMoving) {
    const stride = Math.ceil(moving.count / maxMoving);
    const kept = new Float32Array(Math.ceil(moving.count / stride) * 3);
    let o = 0;
    for (let i = 0; i < moving.count; i += stride) {
      kept[3 * o] = moving.positions[3 * i]!;
      kept[3 * o + 1] = moving.positions[3 * i + 1]!;
      kept[3 * o + 2] = moving.positions[3 * i + 2]!;
      o++;
    }
    moving = { positions: kept, count: o };
  }

  const tree = new KdTree(fixed.positions, fixed.count);
  let transform = new Float32Array(initial) as Mat4;
  let gate = opts.maxCorrespondenceStartM ?? 0.5;
  let prevRmse = Infinity;
  let rmse = Infinity;
  let converged = false;
  let iter = 0;

  for (; iter < maxIter; iter++) {
    const placed = transformPacked(transform, moving.positions, moving.count);
    // gated correspondences
    const cands: Array<{ ib: number; ia: number; d: number }> = [];
    for (let i = 0; i < moving.count; i++) {
      const nn = tree.nearest(placed[3 * i]!, placed[3 * i + 1]!, placed[3 * i + 2]!, gate);
      if (nn.index >= 0) cands.push({ ib: i, ia: nn.index, d: nn.distSq });
    }
    if (cands.length < 10) break; // insufficient overlap at this gate — give up refining
    cands.sort((p, q) => p.d - q.d);
    const kept = cands.slice(0, Math.max(10, Math.floor(cands.length * trimRatio)));

    let sum = 0;
    const pairs: Array<[number, number]> = [];
    for (const c of kept) {
      sum += c.d;
      pairs.push([c.ia, c.ib]);
    }
    rmse = Math.sqrt(sum / kept.length);

    // incremental fit maps CURRENT placed points onto fixed
    const delta = umeyamaRigid(fixed.positions, placed, pairs);
    transform = multiply(delta, transform);

    const dT = translationOf(delta);
    const rotStep = rotationAngle(delta);
    const transStep = Math.hypot(dT[0], dT[1], dT[2]);
    if (Math.abs(prevRmse - rmse) < rmseEps && rotStep < rotEps && transStep < rmseEps * 10) {
      converged = true;
      iter++;
      break;
    }
    prevRmse = rmse;
    gate = Math.max(gateFloor, gate * shrink);
  }

  // final overlap ratio at a fixed 0.1 m radius
  const placed = transformPacked(transform, moving.positions, moving.count);
  let hits = 0;
  for (let i = 0; i < moving.count; i++) {
    if (tree.nearest(placed[3 * i]!, placed[3 * i + 1]!, placed[3 * i + 2]!, 0.1).index >= 0) hits++;
  }

  return {
    transform,
    rmse: Number.isFinite(rmse) ? rmse : Infinity,
    iterations: iter,
    converged,
    overlapRatio: moving.count > 0 ? hits / moving.count : 0,
  };
}

export { identity as identityTransform };
