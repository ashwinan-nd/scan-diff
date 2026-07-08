import { describe, expect, it } from 'vitest';
import { umeyamaRigid } from '../src/align/umeyama';
import { coarseAlign, coarseFromAnchors, coarseYawSearch } from '../src/align/coarse';
import { icpRefine, voxelDownsample } from '../src/align/icp';
import { assessAlignment } from '../src/align/quality';
import {
  fromYawTranslation, identity, invertRigid, multiply, rotationAngle,
  transformPacked, transformPoint, translationOf,
} from '../src/core/mat4';
import { makeRng } from '../src/capture/mock';
import type { AnchorObservation, PointCloud } from '../src/core/types';

/** Deterministic cloud shaped like an L of two slabs — plenty of structure for registration. */
function structuredCloud(n = 3000, seed = 3): PointCloud {
  const rng = makeRng(seed);
  const pts = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    if (i % 2 === 0) {
      // horizontal slab 2 x 0.1 x 1
      pts[3 * i] = rng() * 2 - 1;
      pts[3 * i + 1] = rng() * 0.1;
      pts[3 * i + 2] = rng() * 1 - 0.5;
    } else {
      // vertical slab 0.1 x 1.5 x 1 at the -x end
      pts[3 * i] = -1 + rng() * 0.1;
      pts[3 * i + 1] = rng() * 1.5;
      pts[3 * i + 2] = rng() * 1 - 0.5;
    }
  }
  return { positions: pts, count: n };
}

/** Max elementwise deviation between two transforms applied to probe points. */
function transformError(got: Float32Array, want: Float32Array): number {
  const probes: Array<[number, number, number]> = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1], [-2, 0.5, 3],
  ];
  let worst = 0;
  for (const p of probes) {
    const g = transformPoint(got, p);
    const w = transformPoint(want, p);
    worst = Math.max(worst, Math.hypot(g[0] - w[0], g[1] - w[1], g[2] - w[2]));
  }
  return worst;
}

describe('umeyamaRigid', () => {
  it('recovers a known rigid transform exactly from clean pairs', () => {
    const cloud = structuredCloud(300);
    const truth = fromYawTranslation(0.9, [0.4, -0.2, 1.1]);
    const moved = transformPacked(truth, cloud.positions, cloud.count);
    // solve T·moved ≈ original... i.e. recover inverse; then invert to compare
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < cloud.count; i++) pairs.push([i, i]);
    const t = umeyamaRigid(moved, cloud.positions, pairs); // maps cloud → moved
    expect(transformError(t, truth)).toBeLessThan(1e-4);
  });

  it('throws on fewer than 3 pairs', () => {
    expect(() => umeyamaRigid(new Float32Array(9), new Float32Array(9), [[0, 0], [1, 1]])).toThrow();
  });
});

describe('voxelDownsample', () => {
  it('collapses co-voxel points to centroids', () => {
    const pts = new Float32Array([0.01, 0.01, 0.01, 0.03, 0.03, 0.03, 1, 1, 1]);
    const ds = voxelDownsample(pts, 3, 0.1);
    expect(ds.count).toBe(2);
  });
});

describe('coarse alignment', () => {
  const anchorAt = (m: Float32Array, id = 'M'): AnchorObservation => ({
    pose: { matrix: m }, markerId: id, sizeMeters: 0.2,
  });

  it('marker path recovers the exact inter-session transform', () => {
    // truth: B world → A world
    const truth = fromYawTranslation(1.2, [2, 0, -1]);
    // one physical marker; its pose in A-world chosen arbitrarily
    const markerInA = fromYawTranslation(0.5, [1, 1, 0]);
    // in B-world the same marker appears at truth⁻¹ · markerInA
    const markerInB = multiply(invertRigid(truth), markerInA);
    const res = coarseFromAnchors(anchorAt(markerInA), anchorAt(markerInB))!;
    expect(res.method).toBe('marker');
    expect(transformError(res.transform, truth)).toBeLessThan(1e-4);
  });

  it('marker ids must match', () => {
    expect(coarseFromAnchors(anchorAt(identity(), 'x'), anchorAt(identity(), 'y'))).toBeNull();
  });

  it('yaw-search fallback lands near a yaw+translation ground truth', () => {
    const a = structuredCloud(4000, 5);
    const truth = fromYawTranslation((40 * Math.PI) / 180, [0.8, 0, -0.5]);
    // B = A observed in a different session frame: b = truth⁻¹ · a
    const b: PointCloud = {
      positions: transformPacked(invertRigid(truth), a.positions, a.count),
      count: a.count,
    };
    const res = coarseYawSearch(a, b);
    expect(res.method).toBe('yaw-search');
    expect(res.score).toBeGreaterThan(0.3);
    // coarse only needs to be within ICP's capture basin (~0.3 m / ~10°)
    const composed = multiply(invertRigid(truth), res.transform);
    expect(rotationAngle(composed)).toBeLessThan((10 * Math.PI) / 180);
    const t = translationOf(composed);
    expect(Math.hypot(t[0], t[1], t[2])).toBeLessThan(0.3);
  });

  it('coarseAlign prefers marker, falls back to search', () => {
    const a = structuredCloud(500, 9);
    const res = coarseAlign(a, a, null, null);
    expect(res.method).toBe('yaw-search');
  });
});

describe('icpRefine', () => {
  it('refines a perturbed initial guess to < 5 mm / 0.5° on noisy clouds', () => {
    const a = structuredCloud(6000, 11);
    const truth = fromYawTranslation(0.35, [0.5, 0.1, -0.7]);
    const rng = makeRng(13);
    // b = truth⁻¹ · a + noise (σ = 5 mm)
    const bPts = transformPacked(invertRigid(truth), a.positions, a.count);
    for (let i = 0; i < bPts.length; i++) {
      const g = Math.sqrt(-2 * Math.log(Math.max(1e-12, rng()))) * Math.cos(2 * Math.PI * rng());
      bPts[i] = bPts[i]! + g * 0.005;
    }
    // initial guess: truth perturbed by 5° yaw and 10 cm
    const perturb = fromYawTranslation((5 * Math.PI) / 180, [0.1, 0, -0.05]);
    const initial = multiply(truth, perturb);
    const res = icpRefine(a.positions, a.count, bPts, a.count, initial);
    expect(res.converged).toBe(true);
    const err = multiply(invertRigid(truth), res.transform);
    expect(rotationAngle(err)).toBeLessThan((0.5 * Math.PI) / 180);
    const t = translationOf(err);
    expect(Math.hypot(t[0], t[1], t[2])).toBeLessThan(0.005 + 0.01); // noise floor + margin
    expect(res.overlapRatio).toBeGreaterThan(0.9);
  });

  it('tolerates partial overlap + genuine scene change (trimming)', () => {
    const a = structuredCloud(6000, 17);
    const truth = fromYawTranslation(-0.2, [0.3, 0, 0.4]);
    const bPts0 = transformPacked(invertRigid(truth), a.positions, a.count);
    // inject a change: 15% of B points replaced by a new blob (an added object)
    const rng = makeRng(19);
    const bPts = new Float32Array(bPts0);
    const changed = Math.floor(a.count * 0.15);
    for (let i = 0; i < changed; i++) {
      bPts[3 * i] = 0.5 + rng() * 0.3;
      bPts[3 * i + 1] = 0.5 + rng() * 0.3;
      bPts[3 * i + 2] = 2.5 + rng() * 0.3; // far from the L-structure
    }
    const initial = multiply(truth, fromYawTranslation((4 * Math.PI) / 180, [0.08, 0, 0]));
    const res = icpRefine(a.positions, a.count, bPts, a.count, initial);
    const err = multiply(invertRigid(truth), res.transform);
    expect(rotationAngle(err)).toBeLessThan((1 * Math.PI) / 180);
    const t = translationOf(err);
    expect(Math.hypot(t[0], t[1], t[2])).toBeLessThan(0.02);
  });

  it('reports non-convergence hopeless inputs instead of pretending', () => {
    // two clouds with no overlap at all within the gate
    const a = structuredCloud(500, 23);
    const bPts = new Float32Array(a.positions.length);
    for (let i = 0; i < bPts.length; i += 3) {
      bPts[i] = a.positions[i]! + 100;
      bPts[i + 1] = a.positions[i + 1]!;
      bPts[i + 2] = a.positions[i + 2]!;
    }
    const res = icpRefine(a.positions, a.count, bPts, a.count, identity());
    expect(res.converged).toBe(false);
    expect(res.overlapRatio).toBeLessThan(0.05);
    expect(assessAlignment(res).verdict).toBe('poor');
  });
});

describe('assessAlignment', () => {
  const base = { transform: identity(), iterations: 5, converged: true };
  it('grades good / usable / poor', () => {
    expect(assessAlignment({ ...base, rmse: 0.01, overlapRatio: 0.8 }).verdict).toBe('good');
    expect(assessAlignment({ ...base, rmse: 0.05, overlapRatio: 0.8 }).verdict).toBe('usable');
    expect(assessAlignment({ ...base, rmse: 0.2, overlapRatio: 0.8 }).verdict).toBe('poor');
    expect(assessAlignment({ ...base, rmse: 0.01, overlapRatio: 0.1 }).verdict).toBe('poor');
  });
});
