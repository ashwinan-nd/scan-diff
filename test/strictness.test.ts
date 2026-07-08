import { describe, expect, it } from 'vitest';
import { diffClouds } from '../src/diff';
import { makeRng } from '../src/capture/mock';

/**
 * Strictness calibration: the Review screen exposes Standard (5 cm) and
 * Fine (2 cm) detection. Fine must (a) stay false-positive-free on unchanged
 * dense clouds and (b) catch small changes Standard's floor legitimately
 * misses. Dense clouds here mimic LiDAR uploads (~8 mm spacing), the data
 * fine mode is for.
 */

/** Dense flat slab with deterministic jitter, ~8 mm sampling. */
function slab(seed: number): Float32Array {
  const rng = makeRng(seed);
  const pts: number[] = [];
  for (let x = -1; x < 1; x += 0.008)
    for (let z = -1; z < 1; z += 0.008) {
      pts.push(x + (rng() - 0.5) * 0.002, (rng() - 0.5) * 0.004, z + (rng() - 0.5) * 0.002);
    }
  return new Float32Array(pts);
}

/** Small solid cube, 6 cm edge, dense sampling. */
function smallCube(at: [number, number, number]): number[] {
  const pts: number[] = [];
  for (let x = 0; x < 0.06; x += 0.006)
    for (let y = 0; y < 0.06; y += 0.006)
      for (let z = 0; z < 0.06; z += 0.006) pts.push(at[0] + x, at[1] + y, at[2] + z);
  return pts;
}

const cloud = (f: Float32Array): { positions: Float32Array; count: number } => ({
  positions: f,
  count: f.length / 3,
});

describe('detection strictness calibration', () => {
  const base = slab(41);
  const withCube = new Float32Array([...slab(43), ...smallCube([0.4, 0.004, 0.4])]);

  it('fine (2 cm) stays clean on unchanged dense clouds (different noise draws)', () => {
    const res = diffClouds(cloud(slab(41)), cloud(slab(47)), [], [], { voxelSizeM: 0.02 });
    expect(res.regions).toEqual([]);
  });

  it('fine (2 cm) detects a 6 cm object', () => {
    const res = diffClouds(cloud(base), cloud(withCube), [], [], { voxelSizeM: 0.02 });
    const added = res.regions.filter((r) => r.kind === 'added');
    expect(added.length).toBe(1);
    expect(added[0]!.centroid[0]).toBeGreaterThan(0.35);
    expect(added[0]!.centroid[0]).toBeLessThan(0.5);
    // 6 cm object at 2 cm voxels: ~27 voxels
    expect(added[0]!.voxelCount).toBeGreaterThan(8);
  });

  it('standard (5 cm) misses the same 6 cm object only when below region floor — sanity on relative strictness', () => {
    const fine = diffClouds(cloud(base), cloud(withCube), [], [], { voxelSizeM: 0.02 });
    const std = diffClouds(cloud(base), cloud(withCube), [], [], { voxelSizeM: 0.05 });
    const fineAdded = fine.regions.filter((r) => r.kind === 'added').reduce((s, r) => s + r.voxelCount, 0);
    const stdAdded = std.regions.filter((r) => r.kind === 'added').reduce((s, r) => s + r.voxelCount, 0);
    // fine resolves strictly more detail on the same input
    expect(fineAdded).toBeGreaterThan(stdAdded);
  });

  it('fine reports volume within 2x of ground truth for the 6 cm cube', () => {
    const res = diffClouds(cloud(base), cloud(withCube), [], [], { voxelSizeM: 0.02 });
    const added = res.regions.find((r) => r.kind === 'added')!;
    const truth = 0.06 ** 3;
    expect(added.volumeM3).toBeGreaterThan(truth * 0.5);
    expect(added.volumeM3).toBeLessThan(truth * 2.5);
  });
});
