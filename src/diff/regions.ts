/**
 * Change regions: 26-connected components over flagged voxels, then
 * added/removed pairing into "shifted" when volumes, extents and proximity
 * agree (ARCHITECTURE.md §8.5). Output vocabulary is geometry only.
 */

import type { ChangeRegion } from '../core/types';
import { unpackVoxelKey, voxelKey } from './voxel';

export interface RegionOptions {
  /** components smaller than this are noise and dropped */
  minRegionVoxels?: number;
  /** shifted pairing: |volume ratio - 1| must be below this */
  shiftVolumeTolerance?: number;
  /** shifted pairing: centroid distance cap, meters */
  shiftMaxDistanceM?: number;
}

export const REGION_DEFAULTS: Required<RegionOptions> = {
  minRegionVoxels: 4,
  shiftVolumeTolerance: 0.35,
  shiftMaxDistanceM: 2,
};

const NEIGHBORS: Array<[number, number, number]> = [];
for (let dx = -1; dx <= 1; dx++)
  for (let dy = -1; dy <= 1; dy++)
    for (let dz = -1; dz <= 1; dz++) {
      if (dx || dy || dz) NEIGHBORS.push([dx, dy, dz]);
    }

interface RawRegion {
  keys: number[];
  bboxMin: [number, number, number];
  bboxMax: [number, number, number];
  centroid: [number, number, number];
}

function connectedComponents(keys: number[], minVoxels: number): RawRegion[] {
  const keySet = new Set(keys);
  const seen = new Set<number>();
  const regions: RawRegion[] = [];
  for (const start of keys) {
    if (seen.has(start)) continue;
    const stack = [start];
    seen.add(start);
    const members: number[] = [];
    while (stack.length > 0) {
      const k = stack.pop()!;
      members.push(k);
      const [ix, iy, iz] = unpackVoxelKey(k);
      for (const [dx, dy, dz] of NEIGHBORS) {
        const nk = voxelKey(ix + dx, iy + dy, iz + dz);
        if (keySet.has(nk) && !seen.has(nk)) {
          seen.add(nk);
          stack.push(nk);
        }
      }
    }
    if (members.length < minVoxels) continue;
    const mn: [number, number, number] = [Infinity, Infinity, Infinity];
    const mx: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    const c: [number, number, number] = [0, 0, 0];
    for (const k of members) {
      const v = unpackVoxelKey(k);
      for (let a = 0; a < 3; a++) {
        if (v[a]! < mn[a]!) mn[a] = v[a]!;
        if (v[a]! > mx[a]!) mx[a] = v[a]!;
        c[a] = c[a]! + v[a]!;
      }
    }
    for (let a = 0; a < 3; a++) c[a] = c[a]! / members.length;
    regions.push({ keys: members, bboxMin: mn, bboxMax: mx, centroid: c });
  }
  return regions;
}

function toChangeRegion(
  raw: RawRegion,
  kind: ChangeRegion['kind'],
  voxelSizeM: number,
  supportCounts: Map<number, number>,
  minPointsPerVoxel: number,
): ChangeRegion {
  const s = voxelSizeM;
  // saturation: how far above the occupancy floor the average voxel sits (cap 3x)
  let support = 0;
  for (const k of raw.keys) support += Math.min(3, (supportCounts.get(k) ?? minPointsPerVoxel) / (minPointsPerVoxel * 3));
  return {
    kind,
    voxelCount: raw.keys.length,
    volumeM3: raw.keys.length * s * s * s,
    bboxMin: [raw.bboxMin[0] * s, raw.bboxMin[1] * s, raw.bboxMin[2] * s],
    bboxMax: [(raw.bboxMax[0] + 1) * s, (raw.bboxMax[1] + 1) * s, (raw.bboxMax[2] + 1) * s],
    centroid: [(raw.centroid[0] + 0.5) * s, (raw.centroid[1] + 0.5) * s, (raw.centroid[2] + 0.5) * s],
    confidence: Math.min(1, support / raw.keys.length),
  };
}

export function extractRegions(
  addedKeys: number[],
  removedKeys: number[],
  voxelSizeM: number,
  supportAdded: Map<number, number>,
  supportRemoved: Map<number, number>,
  minPointsPerVoxel: number,
  options: RegionOptions = {},
): ChangeRegion[] {
  const opts = { ...REGION_DEFAULTS, ...options };
  const added = connectedComponents(addedKeys, opts.minRegionVoxels)
    .map((r) => toChangeRegion(r, 'added', voxelSizeM, supportAdded, minPointsPerVoxel));
  const removed = connectedComponents(removedKeys, opts.minRegionVoxels)
    .map((r) => toChangeRegion(r, 'removed', voxelSizeM, supportRemoved, minPointsPerVoxel));

  const regions: ChangeRegion[] = [...added, ...removed];

  // shifted pairing: greedy best-match between added and removed
  const addedIdx = regions.map((r, i) => (r.kind === 'added' ? i : -1)).filter((i) => i >= 0);
  const removedIdx = regions.map((r, i) => (r.kind === 'removed' ? i : -1)).filter((i) => i >= 0);
  const usedRemoved = new Set<number>();

  const diag = (r: ChangeRegion) =>
    Math.hypot(r.bboxMax[0] - r.bboxMin[0], r.bboxMax[1] - r.bboxMin[1], r.bboxMax[2] - r.bboxMin[2]);

  for (const ia of addedIdx) {
    const ra = regions[ia]!;
    let best = -1;
    let bestDist = Infinity;
    for (const ir of removedIdx) {
      if (usedRemoved.has(ir)) continue;
      const rr = regions[ir]!;
      const volRatio = ra.volumeM3 / rr.volumeM3;
      if (Math.abs(volRatio - 1) > opts.shiftVolumeTolerance) continue;
      const dgRatio = diag(ra) / diag(rr);
      if (dgRatio < 0.5 || dgRatio > 2) continue;
      const d = Math.hypot(
        ra.centroid[0] - rr.centroid[0],
        ra.centroid[1] - rr.centroid[1],
        ra.centroid[2] - rr.centroid[2],
      );
      if (d > opts.shiftMaxDistanceM) continue;
      if (d < bestDist) { bestDist = d; best = ir; }
    }
    if (best >= 0) {
      usedRemoved.add(best);
      regions[ia] = { ...ra, kind: 'shifted', shiftPartner: best };
      regions[best] = { ...regions[best]!, kind: 'shifted', shiftPartner: ia };
    }
  }

  // stable, deterministic ordering: biggest changes first
  const order = regions
    .map((r, i) => ({ r, i }))
    .sort((p, q) => q.r.volumeM3 - p.r.volumeM3 || p.i - q.i);
  const remap = new Map<number, number>();
  order.forEach(({ i }, newIdx) => remap.set(i, newIdx));
  return order.map(({ r }) =>
    r.shiftPartner !== undefined ? { ...r, shiftPartner: remap.get(r.shiftPartner)! } : r,
  );
}
