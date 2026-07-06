/**
 * VoxelGrid: sparse occupancy over a packed point cloud.
 * Keys are integer voxel coords packed into a single number: 17 bits per
 * axis (51 bits total) stays inside Float64's exact-integer range (2^53).
 * 21 bits/axis overflowed it and collided keys — caught by the round-trip
 * test. ±2^16 voxels = ±3.2 km at 5 cm resolution; far beyond any scan.
 */

export const VOXEL_KEY_BIAS = 1 << 16;
const AXIS_SPAN = 1 << 17;

export function voxelKey(ix: number, iy: number, iz: number): number {
  return ((ix + VOXEL_KEY_BIAS) * AXIS_SPAN + (iy + VOXEL_KEY_BIAS)) * AXIS_SPAN + (iz + VOXEL_KEY_BIAS);
}

export function unpackVoxelKey(key: number): [number, number, number] {
  const iz = (key % AXIS_SPAN) - VOXEL_KEY_BIAS;
  const rest = Math.floor(key / AXIS_SPAN);
  const iy = (rest % AXIS_SPAN) - VOXEL_KEY_BIAS;
  const ix = Math.floor(rest / AXIS_SPAN) - VOXEL_KEY_BIAS;
  return [ix, iy, iz];
}

export interface VoxelGridOptions {
  voxelSizeM: number;
  /** points required before a voxel counts as occupied (sensor-noise floor) */
  minPointsPerVoxel: number;
}

export class VoxelGrid {
  /** voxel key -> point count (only voxels meeting the floor are "occupied") */
  readonly counts = new Map<number, number>();
  readonly voxelSizeM: number;
  readonly minPointsPerVoxel: number;

  constructor(opts: VoxelGridOptions) {
    this.voxelSizeM = opts.voxelSizeM;
    this.minPointsPerVoxel = opts.minPointsPerVoxel;
  }

  static fromPoints(positions: Float32Array, count: number, opts: VoxelGridOptions): VoxelGrid {
    const g = new VoxelGrid(opts);
    const s = opts.voxelSizeM;
    for (let i = 0; i < count; i++) {
      const k = voxelKey(
        Math.floor(positions[3 * i]! / s),
        Math.floor(positions[3 * i + 1]! / s),
        Math.floor(positions[3 * i + 2]! / s),
      );
      g.counts.set(k, (g.counts.get(k) ?? 0) + 1);
    }
    return g;
  }

  isOccupied(key: number): boolean {
    return (this.counts.get(key) ?? 0) >= this.minPointsPerVoxel;
  }

  /** Iterate occupied voxel keys. */
  *occupied(): IterableIterator<number> {
    for (const [k, c] of this.counts) {
      if (c >= this.minPointsPerVoxel) yield k;
    }
  }

  occupiedCount(): number {
    let n = 0;
    for (const c of this.counts.values()) if (c >= this.minPointsPerVoxel) n++;
    return n;
  }

  /**
   * Is any occupied voxel within Chebyshev distance `ring` of (ix,iy,iz)?
   * ring=1 scans the 3x3x3 neighborhood — absorbs residual alignment error
   * up to one voxel (the reason photos are annotation, not diff signal).
   */
  occupiedNear(ix: number, iy: number, iz: number, ring: number): boolean {
    for (let dx = -ring; dx <= ring; dx++)
      for (let dy = -ring; dy <= ring; dy++)
        for (let dz = -ring; dz <= ring; dz++) {
          if (this.isOccupied(voxelKey(ix + dx, iy + dy, iz + dz))) return true;
        }
    return false;
  }
}
