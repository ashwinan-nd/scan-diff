/**
 * Closed-form rigid fit (rotation + translation, NO scale — metric sensors)
 * between paired point sets, via SVD of the cross-covariance.
 * Reflection guarded with the det correction.
 */

import { det3, matMul3, svd3, transpose3 } from '../core/svd3';
import { fromRotationTranslation, type Mat4 } from '../core/mat4';

/**
 * Find rigid T such that T·b ≈ a for paired packed arrays (xyz triples).
 * `pairs` are index pairs [ia, ib]. Throws on < 3 pairs (under-determined).
 */
export function umeyamaRigid(
  a: Float32Array,
  b: Float32Array,
  pairs: Array<[number, number]>,
): Mat4 {
  const n = pairs.length;
  if (n < 3) throw new Error(`umeyamaRigid needs >= 3 pairs, got ${n}`);

  // centroids
  let cax = 0, cay = 0, caz = 0, cbx = 0, cby = 0, cbz = 0;
  for (const [ia, ib] of pairs) {
    cax += a[3 * ia]!; cay += a[3 * ia + 1]!; caz += a[3 * ia + 2]!;
    cbx += b[3 * ib]!; cby += b[3 * ib + 1]!; cbz += b[3 * ib + 2]!;
  }
  cax /= n; cay /= n; caz /= n; cbx /= n; cby /= n; cbz /= n;

  // cross-covariance H = sum (b - cb)(a - ca)^T  (maps b-frame into a-frame)
  let h0 = 0, h1 = 0, h2 = 0, h3 = 0, h4 = 0, h5 = 0, h6 = 0, h7 = 0, h8 = 0;
  for (const [ia, ib] of pairs) {
    const ax = a[3 * ia]! - cax, ay = a[3 * ia + 1]! - cay, az = a[3 * ia + 2]! - caz;
    const bx = b[3 * ib]! - cbx, by = b[3 * ib + 1]! - cby, bz = b[3 * ib + 2]! - cbz;
    h0 += bx * ax; h1 += bx * ay; h2 += bx * az;
    h3 += by * ax; h4 += by * ay; h5 += by * az;
    h6 += bz * ax; h7 += bz * ay; h8 += bz * az;
  }
  const h = [h0, h1, h2, h3, h4, h5, h6, h7, h8];

  const { u, v } = svd3(h);
  // R = V * diag(1,1,sign) * U^T with sign = det(V U^T) — reflection guard
  let r = matMul3(v, transpose3(u));
  if (det3(r) < 0) {
    // flip the last column of V (smallest singular value) and recompute
    const vFlipped = v.slice();
    vFlipped[2] = -vFlipped[2]!; vFlipped[5] = -vFlipped[5]!; vFlipped[8] = -vFlipped[8]!;
    r = matMul3(vFlipped, transpose3(u));
  }

  // t = ca - R cb
  const t: [number, number, number] = [
    cax - (r[0]! * cbx + r[1]! * cby + r[2]! * cbz),
    cay - (r[3]! * cbx + r[4]! * cby + r[5]! * cbz),
    caz - (r[6]! * cbx + r[7]! * cby + r[8]! * cbz),
  ];
  return fromRotationTranslation(r, t);
}
