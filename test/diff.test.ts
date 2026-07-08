import { describe, expect, it } from 'vitest';
import { VoxelGrid, unpackVoxelKey, voxelKey } from '../src/diff/voxel';
import { diffOccupancy } from '../src/diff/occupancy-diff';
import { diffClouds } from '../src/diff';
import type { Keyframe } from '../src/core/types';
import { fromYawTranslation, identity } from '../src/core/mat4';
import { MOCK_INTRINSICS, makeRng } from '../src/capture/mock';

/** Dense sample of an axis-aligned box, `perAxis` samples per 5cm cell face. */
function boxPoints(
  min: [number, number, number],
  max: [number, number, number],
  spacing = 0.02,
): number[] {
  const pts: number[] = [];
  for (let x = min[0] + spacing / 2; x < max[0]; x += spacing)
    for (let y = min[1] + spacing / 2; y < max[1]; y += spacing)
      for (let z = min[2] + spacing / 2; z < max[2]; z += spacing) pts.push(x, y, z);
  return pts;
}

function cloudOf(...groups: number[][]): { positions: Float32Array; count: number } {
  const all = groups.flat();
  return { positions: new Float32Array(all), count: all.length / 3 };
}

/** A keyframe whose frustum sees everything within 8 m of the origin, looking down -z...
 * plus one rotated 180° so both half-spaces are observed. */
function omniKeyframes(at: [number, number, number] = [0, 0, 3]): Keyframe[] {
  return [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((yaw, i) => ({
    id: i,
    pose: { matrix: fromYawTranslation(yaw, at) },
    intrinsics: MOCK_INTRINSICS,
    imageSize: { w: 160, h: 120 },
    timestamp: i,
  }));
}

describe('voxelKey', () => {
  it('round-trips coordinates incl. negatives', () => {
    for (const c of [[0, 0, 0], [5, -3, 12], [-100, 200, -300], [1000, -1000, 999]] as const) {
      expect(unpackVoxelKey(voxelKey(c[0], c[1], c[2]))).toEqual([c[0], c[1], c[2]]);
    }
  });
  it('distinct coords give distinct keys', () => {
    const seen = new Set<number>();
    for (let x = -5; x <= 5; x++)
      for (let y = -5; y <= 5; y++)
        for (let z = -5; z <= 5; z++) {
          const k = voxelKey(x, y, z);
          expect(seen.has(k)).toBe(false);
          seen.add(k);
        }
  });
});

describe('VoxelGrid', () => {
  it('applies the min-points floor', () => {
    const pts = new Float32Array([0.01, 0.01, 0.01, 0.02, 0.02, 0.02, 1.01, 1.01, 1.01]);
    const g = VoxelGrid.fromPoints(pts, 3, { voxelSizeM: 0.05, minPointsPerVoxel: 2 });
    expect(g.isOccupied(voxelKey(0, 0, 0))).toBe(true);   // two points
    expect(g.isOccupied(voxelKey(20, 20, 20))).toBe(false); // one point
    expect(g.occupiedCount()).toBe(1);
  });

  it('occupiedNear scans the tolerance ring', () => {
    const pts = new Float32Array([0.01, 0.01, 0.01, 0.02, 0.02, 0.02, 0.03, 0.01, 0.02]);
    const g = VoxelGrid.fromPoints(pts, 3, { voxelSizeM: 0.05, minPointsPerVoxel: 3 });
    expect(g.occupiedNear(1, 1, 1, 1)).toBe(true);
    expect(g.occupiedNear(3, 3, 3, 1)).toBe(false);
  });
});

describe('diffOccupancy / diffClouds', () => {
  const kfs = omniKeyframes();
  // a stable background structure: floor slab 2x0.1x2 centered at origin
  const background = boxPoints([-1, -0.1, -1], [1, 0, 1]);

  it('identical clouds -> zero regions, high coverage', () => {
    const a = cloudOf(background);
    const res = diffClouds(a, a, kfs, kfs);
    expect(res.regions).toEqual([]);
    expect(res.addedVoxels).toBe(0);
    expect(res.removedVoxels).toBe(0);
    expect(res.coverageBofA).toBeGreaterThan(0.95);
  });

  it('small alignment jitter (< half voxel) produces no false positives', () => {
    const a = cloudOf(background);
    const rng = makeRng(31);
    const jittered = new Float32Array(a.positions);
    for (let i = 0; i < jittered.length; i++) jittered[i] = jittered[i]! + (rng() - 0.5) * 0.02;
    const res = diffClouds(a, { positions: jittered, count: a.count }, kfs, kfs);
    expect(res.regions).toEqual([]);
  });

  it('detects an added object with correct kind, position, volume order', () => {
    const a = cloudOf(background);
    const b = cloudOf(background, boxPoints([0.3, 0, 0.3], [0.6, 0.3, 0.6]));
    const res = diffClouds(a, b, kfs, kfs);
    expect(res.regions.length).toBe(1);
    const r = res.regions[0]!;
    expect(r.kind).toBe('added');
    expect(r.centroid[0]).toBeGreaterThan(0.3);
    expect(r.centroid[0]).toBeLessThan(0.6);
    expect(r.volumeM3).toBeGreaterThan(0.01);
    expect(r.volumeM3).toBeLessThan(0.08);
    expect(r.confidence).toBeGreaterThan(0.3);
  });

  it('detects a removed object symmetrically', () => {
    const obj = boxPoints([-0.6, 0, -0.6], [-0.3, 0.25, -0.3]);
    const a = cloudOf(background, obj);
    const b = cloudOf(background);
    const res = diffClouds(a, b, kfs, kfs);
    expect(res.regions.length).toBe(1);
    expect(res.regions[0]!.kind).toBe('removed');
  });

  it('classifies a moved object as shifted with linked partners', () => {
    const objA = boxPoints([-0.6, 0, -0.6], [-0.35, 0.25, -0.35]);
    const objB = boxPoints([0.35, 0, 0.35], [0.6, 0.25, 0.6]);
    const a = cloudOf(background, objA);
    const b = cloudOf(background, objB);
    const res = diffClouds(a, b, kfs, kfs);
    expect(res.regions.length).toBe(2);
    for (const r of res.regions) expect(r.kind).toBe('shifted');
    const [r0, r1] = res.regions;
    expect(r0!.shiftPartner).toBe(1);
    expect(r1!.shiftPartner).toBe(0);
  });

  it('does NOT flag removal in space the rescan never observed (coverage rule)', () => {
    const obj = boxPoints([-0.6, 0, -0.6], [-0.3, 0.25, -0.3]);
    const a = cloudOf(background, obj);
    const b = cloudOf(background);
    // B's only keyframe looks away from everything (up at the sky from below...
    // actually: place it far away pointing outward so nothing projects in range)
    const blindKf: Keyframe[] = [{
      id: 0,
      pose: { matrix: fromYawTranslation(0, [500, 0, 500]) },
      intrinsics: MOCK_INTRINSICS,
      imageSize: { w: 160, h: 120 },
      timestamp: 0,
    }];
    const res = diffClouds(a, b, kfs, blindKf);
    expect(res.regions.filter((r) => r.kind === 'removed')).toEqual([]);
    // occupancy-matched voxels (the shared background) count as observed by
    // construction; only the vanished object is unobservable — so coverage is
    // high but strictly below 1, and the object contributes no region.
    expect(res.coverageBofA).toBeLessThan(0.95);
    expect(res.coverageBofA).toBeGreaterThan(0.5);
  });

  it('sub-threshold specks are dropped by minRegionVoxels', () => {
    const a = cloudOf(background);
    // a single tiny 5cm blob (1 voxel worth of points)
    const speck = boxPoints([0.4, 0.0, 0.4], [0.44, 0.04, 0.44], 0.01);
    const b = cloudOf(background, speck);
    const res = diffClouds(a, b, kfs, kfs);
    expect(res.regions).toEqual([]);
  });

  it('two separate additions produce two regions ordered by volume', () => {
    const a = cloudOf(background);
    const big = boxPoints([0.2, 0, 0.2], [0.7, 0.4, 0.7]);
    const small = boxPoints([-0.7, 0, -0.7], [-0.5, 0.15, -0.5]);
    const b = cloudOf(background, big, small);
    const res = diffClouds(a, b, kfs, kfs);
    expect(res.regions.length).toBe(2);
    expect(res.regions[0]!.volumeM3).toBeGreaterThan(res.regions[1]!.volumeM3);
  });

  it('diffOccupancy exposes raw voxel keys and coverage', () => {
    const a = cloudOf(background);
    const b = cloudOf(background, boxPoints([0.3, 0, 0.3], [0.5, 0.2, 0.5]));
    const vd = diffOccupancy(a, b, kfs, kfs);
    expect(vd.addedKeys.length).toBeGreaterThan(0);
    expect(vd.removedKeys.length).toBe(0);
    expect(vd.voxelSizeM).toBe(0.05);
  });

  it('is symmetric: swapping inputs swaps added and removed', () => {
    const a = cloudOf(background);
    const b = cloudOf(background, boxPoints([0.3, 0, 0.3], [0.6, 0.3, 0.6]));
    const ab = diffClouds(a, b, kfs, kfs);
    const ba = diffClouds(b, a, kfs, kfs);
    expect(ab.regions[0]!.kind).toBe('added');
    expect(ba.regions[0]!.kind).toBe('removed');
    expect(ab.regions[0]!.voxelCount).toBe(ba.regions[0]!.voxelCount);
  });
});
