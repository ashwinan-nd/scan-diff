import { describe, expect, it } from 'vitest';
import { cross, dot, normalize, norm } from '../src/core/vec3';
import {
  fromRotationTranslation, fromYawTranslation, identity, invertRigid, multiply,
  rotationAngle, transformPacked, transformPoint, translationOf,
} from '../src/core/mat4';
import { det3, matMul3, svd3, transpose3 } from '../src/core/svd3';
import { KdTree } from '../src/core/kdtree';

describe('vec3', () => {
  it('cross of x,y is z', () => {
    expect(cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
  });
  it('normalize gives unit norm; zero vector stays zero', () => {
    expect(norm(normalize([3, 4, 12]))).toBeCloseTo(1, 12);
    expect(normalize([0, 0, 0])).toEqual([0, 0, 0]);
  });
  it('dot of orthogonal vectors is 0', () => {
    expect(dot([1, 2, 3], cross([1, 2, 3], [4, 5, 6]))).toBeCloseTo(0, 10);
  });
});

describe('mat4', () => {
  it('identity transforms points to themselves', () => {
    expect(transformPoint(identity(), [1.5, -2, 3])).toEqual([1.5, -2, 3]);
  });

  it('rigid inverse round-trips a point', () => {
    const m = fromYawTranslation(0.7, [1, 2, 3]);
    const inv = invertRigid(m);
    const p: [number, number, number] = [0.3, -1.2, 4.5];
    const back = transformPoint(inv, transformPoint(m, p));
    for (let i = 0; i < 3; i++) expect(back[i]).toBeCloseTo(p[i]!, 5);
  });

  it('multiply composes: (A·B)p == A(Bp)', () => {
    const a = fromYawTranslation(0.4, [0.1, 0, -0.2]);
    const b = fromYawTranslation(-1.1, [2, 0.5, 0]);
    const p: [number, number, number] = [1, 2, 3];
    const lhs = transformPoint(multiply(a, b), p);
    const rhs = transformPoint(a, transformPoint(b, p));
    for (let i = 0; i < 3; i++) expect(lhs[i]).toBeCloseTo(rhs[i]!, 5);
  });

  it('rotationAngle recovers yaw magnitude; translationOf recovers t', () => {
    const m = fromYawTranslation(0.6, [7, 8, 9]);
    expect(rotationAngle(m)).toBeCloseTo(0.6, 5);
    expect(translationOf(m)).toEqual([7, 8, 9]);
  });

  it('transformPacked matches per-point transform', () => {
    const m = fromYawTranslation(1.3, [0.5, -0.5, 2]);
    const pts = new Float32Array([1, 0, 0, 0, 1, 0, 3, -2, 1]);
    const out = transformPacked(m, pts, 3);
    for (let i = 0; i < 3; i++) {
      const p = transformPoint(m, [pts[3 * i]!, pts[3 * i + 1]!, pts[3 * i + 2]!]);
      for (let j = 0; j < 3; j++) expect(out[3 * i + j]).toBeCloseTo(p[j]!, 4);
    }
  });

  it('fromRotationTranslation stores row-major rotation correctly', () => {
    // rotation mapping x->y (90° about z), row-major
    const r = [0, -1, 0, 1, 0, 0, 0, 0, 1];
    const m = fromRotationTranslation(r, [0, 0, 0]);
    const p = transformPoint(m, [1, 0, 0]);
    expect(p[0]).toBeCloseTo(0, 6);
    expect(p[1]).toBeCloseTo(1, 6);
  });
});

describe('svd3', () => {
  const cases: Array<{ name: string; m: number[] }> = [
    { name: 'identity', m: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
    { name: 'diagonal', m: [3, 0, 0, 0, 2, 0, 0, 0, 1] },
    { name: 'rotation', m: [0, -1, 0, 1, 0, 0, 0, 0, 1] },
    { name: 'general', m: [2, -1, 0.5, 0.3, 1.7, -2.2, 4, 0.1, 0.9] },
    { name: 'rank-deficient', m: [1, 2, 3, 2, 4, 6, 0, 0, 1] },
  ];

  for (const { name, m } of cases) {
    it(`reconstructs A = U S V^T (${name})`, () => {
      const { u, s, v } = svd3(m);
      const us = matMul3(u, [s[0], 0, 0, 0, s[1], 0, 0, 0, s[2]]);
      const rec = matMul3(us, transpose3(v));
      for (let i = 0; i < 9; i++) expect(rec[i]).toBeCloseTo(m[i]!, 5);
      // singular values sorted descending, non-negative
      expect(s[0]).toBeGreaterThanOrEqual(s[1]);
      expect(s[1]).toBeGreaterThanOrEqual(s[2]);
      expect(s[2]).toBeGreaterThanOrEqual(-1e-9);
      // U, V orthonormal
      const utu = matMul3(transpose3(u), u);
      const vtv = matMul3(transpose3(v), v);
      const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
      for (let i = 0; i < 9; i++) {
        expect(utu[i]).toBeCloseTo(I[i]!, 5);
        expect(vtv[i]).toBeCloseTo(I[i]!, 5);
      }
    });
  }

  it('det3 works', () => {
    expect(det3([1, 0, 0, 0, 1, 0, 0, 0, 1])).toBe(1);
    expect(det3([2, 0, 0, 0, 3, 0, 0, 0, 4])).toBe(24);
  });
});

describe('KdTree', () => {
  it('finds exact nearest neighbors vs brute force', () => {
    // deterministic pseudo-random points
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const n = 500;
    const pts = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) pts[i] = rand() * 10 - 5;
    const tree = new KdTree(pts, n);

    for (let q = 0; q < 50; q++) {
      const qx = rand() * 10 - 5, qy = rand() * 10 - 5, qz = rand() * 10 - 5;
      let bestD = Infinity, bestI = -1;
      for (let i = 0; i < n; i++) {
        const dx = pts[3 * i]! - qx, dy = pts[3 * i + 1]! - qy, dz = pts[3 * i + 2]! - qz;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) { bestD = d; bestI = i; }
      }
      const got = tree.nearest(qx, qy, qz);
      expect(got.index).toBe(bestI);
      expect(got.distSq).toBeCloseTo(bestD, 6);
    }
  });

  it('respects maxDist and empty tree', () => {
    const pts = new Float32Array([0, 0, 0]);
    const tree = new KdTree(pts, 1);
    expect(tree.nearest(10, 0, 0, 1).index).toBe(-1);
    expect(new KdTree(new Float32Array(0), 0).nearest(0, 0, 0).index).toBe(-1);
  });
});
