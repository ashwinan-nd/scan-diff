import { describe, expect, it } from 'vitest';
import { unprojectDepth, projectPoint } from '../src/capture/unproject';
import { KeyframePolicy } from '../src/capture/keyframes';
import { anchorFromCorners, fuseAnchorObservations, type CornerSample } from '../src/capture/anchor';
import { MockCaptureSource, MOCK_INTRINSICS, renderDepthFrame } from '../src/capture/mock';
import { ScanSessionBuilder } from '../src/capture/session';
import { fromYawTranslation, identity, invertRigid, transformPoint } from '../src/core/mat4';
import { enclosureScene, panTrajectory } from './fixtures/synthetic';
import type { Pose } from '../src/core/types';
import { ScanDiffError } from '../src/core/types';

const IDENTITY_POSE: Pose = { matrix: identity() };

describe('unprojectDepth', () => {
  it('flat wall at z=-2 unprojects to points at world z=-2', () => {
    const size = { w: 16, h: 12 };
    const depth = new Float32Array(size.w * size.h).fill(2);
    const pts = unprojectDepth(depth, size, IDENTITY_POSE, MOCK_INTRINSICS, { stride: 1 });
    expect(pts.length).toBeGreaterThan(0);
    for (let i = 0; i < pts.length; i += 3) {
      expect(pts[i + 2]).toBeCloseTo(-2, 5);
    }
  });

  it('rejects out-of-range and non-finite depths', () => {
    const size = { w: 4, h: 4 };
    const depth = new Float32Array([0, 0.05, 100, NaN, Infinity, -1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]);
    const pts = unprojectDepth(depth, size, IDENTITY_POSE, MOCK_INTRINSICS, { stride: 1 });
    expect(pts.length / 3).toBe(10); // only the ten valid 2m samples survive
  });

  it('confidence percentile culls the lowest-confidence points', () => {
    const size = { w: 10, h: 10 };
    const depth = new Float32Array(100).fill(2);
    const conf = new Float32Array(100);
    for (let i = 0; i < 100; i++) conf[i] = i < 30 ? 0.1 : 0.9; // 30 low, 70 high
    const pts = unprojectDepth(depth, size, IDENTITY_POSE, MOCK_INTRINSICS, { stride: 1, confidencePercentile: 30 }, conf);
    expect(pts.length / 3).toBe(70);
  });

  it('project/unproject round-trip through a rotated pose', () => {
    const pose: Pose = { matrix: fromYawTranslation(0.8, [1, 0.5, -2]) };
    const size = { w: 32, h: 24 };
    const depth = new Float32Array(size.w * size.h).fill(1.5);
    const pts = unprojectDepth(depth, size, pose, MOCK_INTRINSICS, { stride: 8 });
    const inv = invertRigid(pose.matrix);
    for (let i = 0; i < pts.length; i += 3) {
      const proj = projectPoint([pts[i]!, pts[i + 1]!, pts[i + 2]!], inv, MOCK_INTRINSICS, size);
      expect(proj).not.toBeNull();
      expect(proj!.depth).toBeCloseTo(1.5, 4);
      expect(proj!.u).toBeGreaterThanOrEqual(0);
      expect(proj!.u).toBeLessThanOrEqual(size.w);
    }
  });

  it('projectPoint returns null behind the camera', () => {
    expect(projectPoint([0, 0, 5], identity(), MOCK_INTRINSICS, { w: 10, h: 10 })).toBeNull();
  });
});

describe('KeyframePolicy', () => {
  it('keeps first frame, then only on sufficient motion, with forced gap', () => {
    const p = new KeyframePolicy({ minTranslationM: 0.25, maxGapFrames: 5 });
    expect(p.shouldKeep({ matrix: fromYawTranslation(0, [0, 0, 0]) })).toBe(true);
    // five tiny motions: all rejected (below both thresholds, gap not reached)
    for (let i = 1; i <= 5; i++) {
      expect(p.shouldKeep({ matrix: fromYawTranslation(0, [0.001 * i, 0, 0]) })).toBe(false);
    }
    // sixth tiny motion: forced-gap rule fires (rejectedSinceLast reached maxGapFrames)
    expect(p.shouldKeep({ matrix: fromYawTranslation(0, [0.006, 0, 0]) })).toBe(true);
    // large translation always keeps
    expect(p.shouldKeep({ matrix: fromYawTranslation(0, [1, 0, 0]) })).toBe(true);
    // large rotation always keeps
    expect(p.shouldKeep({ matrix: fromYawTranslation(1.0, [1, 0, 0]) })).toBe(true);
  });
});

describe('anchorFromCorners', () => {
  // marker of edge ~0.2m centered in view, on a wall 1m in front of the camera
  const size = { w: 100, h: 100 };
  const half = 0.1; // meters at depth 1 with fx=0.8 → 0.08 of width → 8px
  const px = (x: number) => 50 + (x / 1) * 0.8 * size.w; // world x → pixel u at z=1
  const py = (y: number) => 50 - (y / 1) * 1.0667 * size.h; // world y → pixel v
  const corners: [CornerSample, CornerSample, CornerSample, CornerSample] = [
    { u: px(-half) - 0.5, v: py(half) - 0.5, depthM: 1 },   // TL
    { u: px(half) - 0.5, v: py(half) - 0.5, depthM: 1 },    // TR
    { u: px(half) - 0.5, v: py(-half) - 0.5, depthM: 1 },   // BR
    { u: px(-half) - 0.5, v: py(-half) - 0.5, depthM: 1 },  // BL
  ];

  it('recovers marker pose, size, and plane normal facing the camera', () => {
    const obs = anchorFromCorners(corners, size, MOCK_INTRINSICS, IDENTITY_POSE, 'm1');
    expect(obs).not.toBeNull();
    expect(obs!.markerId).toBe('m1');
    expect(obs!.sizeMeters).toBeCloseTo(0.2, 2);
    // origin ≈ (0,0,-1) in world (camera at origin looking down -z)
    expect(obs!.pose.matrix[12]).toBeCloseTo(0, 2);
    expect(obs!.pose.matrix[13]).toBeCloseTo(0, 2);
    expect(obs!.pose.matrix[14]).toBeCloseTo(-1, 2);
    // marker x-axis ≈ world +x
    expect(obs!.pose.matrix[0]).toBeCloseTo(1, 2);
  });

  it('rejects invalid depth and implausible sizes', () => {
    const bad = [...corners] as typeof corners;
    bad[0] = { ...bad[0]!, depthM: NaN };
    expect(anchorFromCorners(bad, size, MOCK_INTRINSICS, IDENTITY_POSE, 'm1')).toBeNull();
  });

  it('fuses observations via median translation', () => {
    const mk = (tx: number) => {
      const o = anchorFromCorners(corners, size, MOCK_INTRINSICS, IDENTITY_POSE, 'm1')!;
      const m = new Float32Array(o.pose.matrix);
      m[12] = tx;
      return { ...o, pose: { matrix: m } };
    };
    const fused = fuseAnchorObservations([mk(0.1), mk(0.11), mk(5 /* outlier */)]);
    expect(fused!.pose.matrix[12]).toBeCloseTo(0.11, 5);
    expect(fuseAnchorObservations([])).toBeNull();
  });
});

describe('MockCaptureSource + ScanSessionBuilder end-to-end', () => {
  it('produces a dense multi-keyframe session from a 360° pan', async () => {
    const scene = enclosureScene();
    const source = new MockCaptureSource({
      scene,
      trajectory: panTrajectory([0, 1.4, 0], 12),
      depthSize: { w: 40, h: 30 },
    });
    const builder = new ScanSessionBuilder({ unproject: { stride: 2 } });
    for await (const frame of source.start()) builder.addFrame(frame);
    const session = builder.build('s1', 'test', 'mock');
    expect(session.cloud.count).toBeGreaterThan(1000);
    expect(session.keyframes.length).toBeGreaterThan(3); // rotation-driven keyframes
    // all points inside the enclosure bounds (+slack for shell thickness)
    for (let i = 0; i < session.cloud.count * 3; i += 3) {
      expect(Math.abs(session.cloud.positions[i]!)).toBeLessThan(2.2);
      expect(session.cloud.positions[i + 1]!).toBeGreaterThan(-0.2);
      expect(session.cloud.positions[i + 1]!).toBeLessThan(2.7);
      expect(Math.abs(session.cloud.positions[i + 2]!)).toBeLessThan(1.7);
    }
  });

  it('renderDepthFrame: wall straight ahead reports its perpendicular distance', () => {
    const scene = enclosureScene();
    const size = { w: 21, h: 15 };
    const depth = renderDepthFrame(scene, { matrix: identity() }, size, MOCK_INTRINSICS);
    // center pixel looks down -z from origin at wall z=-1.5
    const center = depth[7 * size.w + 10]!;
    expect(center).toBeCloseTo(1.5, 1);
  });

  it('empty capture throws an actionable error', () => {
    const builder = new ScanSessionBuilder();
    expect(() => builder.build('x', 'x', 'mock')).toThrow(ScanDiffError);
  });

  it('noise is deterministic under a fixed seed', async () => {
    const mk = async () => {
      const src = new MockCaptureSource({
        scene: enclosureScene(),
        trajectory: panTrajectory([0, 1.4, 0], 2),
        depthSize: { w: 16, h: 12 },
        noiseSigmaM: 0.01,
        seed: 7,
      });
      const frames = [];
      for await (const f of src.start()) frames.push(f);
      return frames;
    };
    const [a, b] = [await mk(), await mk()];
    expect(Array.from(a[0]!.depth)).toEqual(Array.from(b[0]!.depth));
  });
});
