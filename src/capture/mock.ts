/**
 * MockCaptureSource: renders synthetic depth frames of a triangle-free
 * "occupancy scene" (axis-aligned boxes) by ray-marching, so the entire
 * capture->report pipeline can run and be tested without hardware.
 * Also powers the desktop demo mode.
 */

import type { Intrinsics, Pose } from '../core/types';
import type { CaptureFrame, CaptureOptions, CaptureSource } from './source';
import { invertRigid, transformPoint } from '../core/mat4';

export interface SceneBox {
  min: [number, number, number];
  max: [number, number, number];
}

/** A synthetic scene is just boxes; enough to model walls, floors, objects. */
export interface SyntheticScene {
  boxes: SceneBox[];
}

export interface MockCaptureConfig {
  scene: SyntheticScene;
  /** camera poses to visit, one frame each (camera-to-world) */
  trajectory: Pose[];
  depthSize?: { w: number; h: number };
  intrinsics?: Intrinsics;
  /** gaussian-ish depth noise sigma in meters (0 = perfect sensor) */
  noiseSigmaM?: number;
  /** deterministic seed for noise */
  seed?: number;
}

export const MOCK_INTRINSICS: Intrinsics = { fx: 0.8, fy: 1.0667, cx: 0.5, cy: 0.5 };

/** Ray/AABB slab intersection; returns nearest positive t or Infinity. */
function rayBox(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  b: SceneBox,
): number {
  let tmin = 0.0001;
  let tmax = Infinity;
  const o = [ox, oy, oz] as const;
  const d = [dx, dy, dz] as const;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]!) < 1e-12) {
      if (o[a]! < b.min[a]! || o[a]! > b.max[a]!) return Infinity;
      continue;
    }
    const inv = 1 / d[a]!;
    let t0 = (b.min[a]! - o[a]!) * inv;
    let t1 = (b.max[a]! - o[a]!) * inv;
    if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
    if (t0 > tmin) tmin = t0;
    if (t1 < tmax) tmax = t1;
    if (tmin > tmax) return Infinity;
  }
  return tmin > 0.0001 ? tmin : Infinity;
}

/** Deterministic LCG in [0,1). */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Render one depth frame of the scene from a camera pose. */
export function renderDepthFrame(
  scene: SyntheticScene,
  pose: Pose,
  size: { w: number; h: number },
  intrinsics: Intrinsics,
  noiseSigmaM = 0,
  rng: () => number = Math.random,
): Float32Array {
  const depth = new Float32Array(size.w * size.h);
  const camToWorld = pose.matrix;
  const ox = camToWorld[12]!, oy = camToWorld[13]!, oz = camToWorld[14]!;
  const { fx, fy, cx, cy } = intrinsics;
  for (let v = 0; v < size.h; v++) {
    for (let u = 0; u < size.w; u++) {
      // camera-space ray through pixel center (looking down -z)
      const xn = ((u + 0.5) / size.w - cx) / fx;
      const yn = -(((v + 0.5) / size.h - cy) / fy);
      // direction in world space
      const dW = [
        camToWorld[0]! * xn + camToWorld[4]! * yn + camToWorld[8]! * -1,
        camToWorld[1]! * xn + camToWorld[5]! * yn + camToWorld[9]! * -1,
        camToWorld[2]! * xn + camToWorld[6]! * yn + camToWorld[10]! * -1,
      ] as const;
      let tHit = Infinity;
      for (const b of scene.boxes) {
        const t = rayBox(ox, oy, oz, dW[0], dW[1], dW[2], b);
        if (t < tHit) tHit = t;
      }
      if (!Number.isFinite(tHit)) { depth[v * size.w + u] = 0; continue; }
      // depth is the -z camera coordinate of the hit, not the ray length
      const hit: [number, number, number] = [ox + dW[0] * tHit, oy + dW[1] * tHit, oz + dW[2] * tHit];
      const pc = transformPoint(invertRigid(camToWorld), hit);
      let z = -pc[2];
      if (noiseSigmaM > 0) {
        // Box-Muller from two uniforms
        const g = Math.sqrt(-2 * Math.log(Math.max(1e-12, rng()))) * Math.cos(2 * Math.PI * rng());
        z += g * noiseSigmaM;
      }
      depth[v * size.w + u] = z > 0 ? z : 0;
    }
  }
  return depth;
}

export class MockCaptureSource implements CaptureSource {
  private stopped = false;
  constructor(private readonly cfg: MockCaptureConfig) {}

  async *start(_opts?: CaptureOptions): AsyncIterable<CaptureFrame> {
    const size = this.cfg.depthSize ?? { w: 80, h: 60 };
    const intr = this.cfg.intrinsics ?? MOCK_INTRINSICS;
    const rng = makeRng(this.cfg.seed ?? 1);
    let t = 0;
    for (const pose of this.cfg.trajectory) {
      if (this.stopped) return;
      const depth = renderDepthFrame(
        this.cfg.scene, pose, size, intr, this.cfg.noiseSigmaM ?? 0, rng,
      );
      yield {
        depth,
        depthSize: size,
        pose: { matrix: new Float32Array(pose.matrix) },
        intrinsics: intr,
        timestamp: t++,
      };
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }
}
