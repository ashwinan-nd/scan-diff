/**
 * 3x3 SVD via one-sided Jacobi: A = U S V^T.
 * Only consumer is Umeyama rigid fit, which needs U, V, and sign(det) handling.
 * Matrices are row-major number[9].
 */

export interface Svd3 {
  u: number[];
  s: [number, number, number];
  v: number[];
}

const T = (m: number[]): number[] => [m[0]!, m[3]!, m[6]!, m[1]!, m[4]!, m[7]!, m[2]!, m[5]!, m[8]!];

export function matMul3(a: number[], b: number[]): number[] {
  const o = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += a[3 * r + k]! * b[3 * k + c]!;
      o[3 * r + c] = s;
    }
  return o;
}

export function det3(m: number[]): number {
  return (
    m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) -
    m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) +
    m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!)
  );
}

/**
 * One-sided Jacobi: orthogonalize columns of A by right-multiplying rotations.
 * After convergence A -> U*S (columns scaled left-singular vectors), accumulated rotations -> V.
 */
export function svd3(a: number[]): Svd3 {
  // work on columns: w = A (copy), v = I
  const w = a.slice();
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  const col = (m: number[], j: number): [number, number, number] => [m[j]!, m[3 + j]!, m[6 + j]!];
  const setCol = (m: number[], j: number, c: [number, number, number]) => {
    m[j] = c[0]; m[3 + j] = c[1]; m[6 + j] = c[2];
  };

  for (let sweep = 0; sweep < 30; sweep++) {
    let off = 0;
    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        const cp = col(w, p), cq = col(w, q);
        const apq = cp[0] * cq[0] + cp[1] * cq[1] + cp[2] * cq[2];
        const app = cp[0] * cp[0] + cp[1] * cp[1] + cp[2] * cp[2];
        const aqq = cq[0] * cq[0] + cq[1] * cq[1] + cq[2] * cq[2];
        off += apq * apq;
        if (Math.abs(apq) < 1e-15) continue;
        const tau = (aqq - app) / (2 * apq);
        const t = Math.sign(tau) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = c * t;
        // rotate columns p,q of w and v
        for (const m of [w, v]) {
          const mp = col(m, p), mq = col(m, q);
          setCol(m, p, [c * mp[0] - s * mq[0], c * mp[1] - s * mq[1], c * mp[2] - s * mq[2]]);
          setCol(m, q, [s * mp[0] + c * mq[0], s * mp[1] + c * mq[1], s * mp[2] + c * mq[2]]);
        }
      }
    }
    if (off < 1e-30) break;
  }

  // singular values = column norms of w; U = normalized columns.
  // Pass 1: normalize non-degenerate columns. Pass 2: complete degenerate ones
  // to an orthonormal basis (needs the others filled first).
  const s: [number, number, number] = [0, 0, 0];
  const u = new Array<number>(9).fill(0);
  const degenerate: number[] = [];
  for (let j = 0; j < 3; j++) {
    const cj = col(w, j);
    const n = Math.hypot(cj[0], cj[1], cj[2]);
    s[j] = n;
    if (n > 1e-12) {
      u[j] = cj[0] / n; u[3 + j] = cj[1] / n; u[6 + j] = cj[2] / n;
    } else {
      s[j] = 0;
      degenerate.push(j);
    }
  }
  for (const j of degenerate) {
    const j1 = (j + 1) % 3, j2 = (j + 2) % 3;
    const a1: [number, number, number] = [u[j1]!, u[3 + j1]!, u[6 + j1]!];
    const a2: [number, number, number] = [u[j2]!, u[3 + j2]!, u[6 + j2]!];
    let cx: [number, number, number] = [
      a1[1] * a2[2] - a1[2] * a2[1],
      a1[2] * a2[0] - a1[0] * a2[2],
      a1[0] * a2[1] - a1[1] * a2[0],
    ];
    let cn = Math.hypot(cx[0], cx[1], cx[2]);
    if (cn < 1e-12) {
      // fewer than two valid columns: pick any unit vector orthogonal to a1 (or x-axis)
      const base: [number, number, number] =
        Math.hypot(...a1) > 0.5 ? a1 : [1, 0, 0];
      const helper: [number, number, number] =
        Math.abs(base[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      cx = [
        base[1] * helper[2] - base[2] * helper[1],
        base[2] * helper[0] - base[0] * helper[2],
        base[0] * helper[1] - base[1] * helper[0],
      ];
      cn = Math.hypot(cx[0], cx[1], cx[2]) || 1;
    }
    u[j] = cx[0] / cn; u[3 + j] = cx[1] / cn; u[6 + j] = cx[2] / cn;
  }

  // sort singular values descending, permuting U and V columns together
  const order = [0, 1, 2].sort((i, j) => s[j]! - s[i]!);
  const us = new Array<number>(9), vs = new Array<number>(9);
  const ss: [number, number, number] = [0, 0, 0];
  order.forEach((from, to) => {
    ss[to] = s[from]!;
    for (let r = 0; r < 3; r++) {
      us[3 * r + to] = u[3 * r + from]!;
      vs[3 * r + to] = v[3 * r + from]!;
    }
  });

  return { u: us, s: ss, v: vs };
}

export const transpose3 = T;
