import { describe, expect, it } from 'vitest';
import {
  bboxCenter, bboxDiagonal, computeBbox, frameDistance,
  rampColors, rampColorsWithEmphasis,
} from '../src/ui/viewer-math';

describe('computeBbox', () => {
  it('finds min/max per axis', () => {
    const pts = new Float32Array([0, 1, 2, -3, 5, 0, 2, -1, 7]);
    const b = computeBbox(pts, 3)!;
    expect(b.min).toEqual([-3, -1, 0]);
    expect(b.max).toEqual([2, 5, 7]);
    expect(bboxCenter(b)).toEqual([-0.5, 2, 3.5]);
    expect(bboxDiagonal(b)).toBeCloseTo(Math.hypot(5, 6, 7), 5);
  });

  it('returns null for empty input', () => {
    expect(computeBbox(new Float32Array(0), 0)).toBeNull();
  });
});

describe('frameDistance', () => {
  it('fits a unit-diagonal cloud inside a 60deg fov with padding', () => {
    const d = frameDistance(1, 60);
    // r=0.5, sin(30deg)=0.5 -> base 1.0, padded 1.15
    expect(d).toBeCloseTo(1.15, 5);
  });
  it('never returns zero even for degenerate clouds', () => {
    expect(frameDistance(0, 60)).toBeGreaterThan(0);
  });
});

describe('rampColors', () => {
  it('maps lowest y to low color, highest to high color, blends between', () => {
    const pts = new Float32Array([0, 0, 0, 0, 1, 0, 0, 2, 0]);
    const c = rampColors(pts, 3, [0, 0, 0], [1, 1, 1]);
    expect([c[0], c[1], c[2]]).toEqual([0, 0, 0]);
    expect(c[4]).toBeCloseTo(0.5, 5);
    expect([c[6], c[7], c[8]]).toEqual([1, 1, 1]);
  });

  it('flat clouds (zero y-span) do not divide by zero', () => {
    const pts = new Float32Array([0, 3, 0, 1, 3, 1]);
    const c = rampColors(pts, 2, [0.2, 0.2, 0.2], [0.8, 0.8, 0.8]);
    for (let i = 0; i < c.length; i++) expect(Number.isFinite(c[i]!)).toBe(true);
  });

  it('all outputs stay within the [low, high] channel bounds', () => {
    const pts = new Float32Array(300);
    for (let i = 0; i < 100; i++) pts[3 * i + 1] = Math.sin(i) * 5;
    const c = rampColors(pts, 100, [0.1, 0.3, 0.5], [0.4, 0.7, 1.0]);
    for (let i = 0; i < 100; i++) {
      expect(c[3 * i]!).toBeGreaterThanOrEqual(0.1 - 1e-6);
      expect(c[3 * i]!).toBeLessThanOrEqual(0.4 + 1e-6);
      expect(c[3 * i + 2]!).toBeGreaterThanOrEqual(0.5 - 1e-6);
      expect(c[3 * i + 2]!).toBeLessThanOrEqual(1.0 + 1e-6);
    }
  });
});

describe('rampColorsWithEmphasis', () => {
  const pts = new Float32Array([
    0, 0, 0,     // inside the box
    10, 10, 10,  // far outside
  ]);
  const box = { min: [-1, -1, -1] as [number, number, number], max: [1, 1, 1] as [number, number, number] };

  it('keeps vivid color inside emphasis boxes, dims outside', () => {
    const c = rampColorsWithEmphasis(pts, 2, [1, 0, 0], [1, 0, 0], [box]);
    // inside point keeps pure red
    expect(c[0]).toBeCloseTo(1, 5);
    // outside point pulled strongly toward the dim gray
    expect(c[3]!).toBeLessThan(0.5);
  });

  it('margin extends the emphasis region', () => {
    const nearEdge = new Float32Array([1.03, 0, 0]);
    const cTight = rampColorsWithEmphasis(nearEdge, 1, [1, 0, 0], [1, 0, 0], [box], 0.0);
    const cLoose = rampColorsWithEmphasis(nearEdge, 1, [1, 0, 0], [1, 0, 0], [box], 0.05);
    expect(cTight[0]!).toBeLessThan(cLoose[0]!);
    expect(cLoose[0]).toBeCloseTo(1, 5);
  });

  it('with no boxes, applies a uniform half-dim so context still reads', () => {
    const c = rampColorsWithEmphasis(pts, 2, [1, 0, 0], [1, 0, 0], []);
    expect(c[0]!).toBeLessThan(1);
    expect(c[0]!).toBeGreaterThan(0.3);
  });
});
