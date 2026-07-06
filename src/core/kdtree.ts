/**
 * Static balanced kd-tree over a packed xyz Float32Array.
 * Built once, queried many times (ICP nearest-neighbor, overlap metrics).
 * Median-split on the widest axis; iterative nearest query with branch pruning.
 */

export class KdTree {
  /** point indices in tree order */
  private readonly idx: Uint32Array;
  /** per tree-node split axis (0/1/2); leaf = 255 */
  private readonly axis: Uint8Array;
  private readonly positions: Float32Array;
  readonly count: number;

  constructor(positions: Float32Array, count: number) {
    this.positions = positions;
    this.count = count;
    this.idx = new Uint32Array(count);
    for (let i = 0; i < count; i++) this.idx[i] = i;
    this.axis = new Uint8Array(count).fill(255);
    if (count > 0) this.build(0, count);
  }

  private coord(i: number, ax: number): number {
    return this.positions[3 * this.idx[i]! + ax]!;
  }

  /** Recursive median build on idx[lo, hi). Node = median position. */
  private build(lo: number, hi: number): void {
    if (hi - lo <= 1) return;
    // widest axis over the range
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = lo; i < hi; i++) {
      const p = 3 * this.idx[i]!;
      const x = this.positions[p]!, y = this.positions[p + 1]!, z = this.positions[p + 2]!;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const ex = maxX - minX, ey = maxY - minY, ez = maxZ - minZ;
    const ax = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
    const mid = (lo + hi) >> 1;
    this.select(lo, hi, mid, ax);
    this.axis[mid] = ax;
    this.build(lo, mid);
    this.build(mid + 1, hi);
  }

  /** Quickselect: place the k-th smallest (by axis coord) at position k within [lo, hi). */
  private select(lo: number, hi: number, k: number, ax: number): void {
    while (hi - lo > 1) {
      const pivot = this.coord(lo + ((hi - lo) >> 1), ax);
      let i = lo, j = hi - 1;
      while (i <= j) {
        while (this.coord(i, ax) < pivot) i++;
        while (this.coord(j, ax) > pivot) j--;
        if (i <= j) {
          const t = this.idx[i]!; this.idx[i] = this.idx[j]!; this.idx[j] = t;
          i++; j--;
        }
      }
      if (k <= j) hi = j + 1;
      else if (k >= i) lo = i;
      else return;
    }
  }

  /**
   * Nearest neighbor to (x,y,z). Returns { index (into original positions), distSq },
   * or index -1 when the tree is empty or nothing is within maxDist.
   */
  nearest(x: number, y: number, z: number, maxDist = Infinity): { index: number; distSq: number } {
    let bestIdx = -1;
    let bestD = maxDist * maxDist;
    if (this.count === 0) return { index: -1, distSq: bestD };

    // explicit stack of [lo, hi) ranges
    const stackLo: number[] = [0];
    const stackHi: number[] = [this.count];
    const q = [x, y, z] as const;

    while (stackLo.length > 0) {
      const lo = stackLo.pop()!;
      const hi = stackHi.pop()!;
      if (hi - lo <= 0) continue;
      if (hi - lo <= 1) {
        this.consider(lo, q, (d, i) => { if (d < bestD) { bestD = d; bestIdx = i; } });
        continue;
      }
      const mid = (lo + hi) >> 1;
      this.consider(mid, q, (d, i) => { if (d < bestD) { bestD = d; bestIdx = i; } });
      const ax = this.axis[mid]!;
      const diff = q[ax]! - this.coord(mid, ax);
      // near side first; far side only if the splitting plane is closer than best
      const nearLo = diff <= 0 ? lo : mid + 1;
      const nearHi = diff <= 0 ? mid : hi;
      const farLo = diff <= 0 ? mid + 1 : lo;
      const farHi = diff <= 0 ? hi : mid;
      if (diff * diff < bestD) { stackLo.push(farLo); stackHi.push(farHi); }
      stackLo.push(nearLo); stackHi.push(nearHi);
    }
    return { index: bestIdx, distSq: bestD };
  }

  private consider(i: number, q: readonly [number, number, number], upd: (d: number, i: number) => void): void {
    const p = 3 * this.idx[i]!;
    const dx = this.positions[p]! - q[0];
    const dy = this.positions[p + 1]! - q[1];
    const dz = this.positions[p + 2]! - q[2];
    upd(dx * dx + dy * dy + dz * dz, this.idx[i]!);
  }
}
