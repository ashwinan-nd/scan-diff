/**
 * 4x4 column-major matrix ops (WebGL/XRRigidTransform layout):
 * m[0..3] = column 0, m[12..14] = translation.
 * Only what the pipeline needs — rigid transforms.
 */

import type { Vec3 } from './vec3';

export type Mat4 = Float32Array;

export function identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[r + 4 * k]! * b[k + 4 * c]!;
      out[r + 4 * c] = s;
    }
  }
  return out;
}

/** Apply to a point (w=1). */
export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  return [
    m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!,
    m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!,
    m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!,
  ];
}

/** Apply to a direction (w=0). */
export function transformDir(m: Mat4, d: Vec3): Vec3 {
  return [
    m[0]! * d[0] + m[4]! * d[1] + m[8]! * d[2],
    m[1]! * d[0] + m[5]! * d[1] + m[9]! * d[2],
    m[2]! * d[0] + m[6]! * d[1] + m[10]! * d[2],
  ];
}

/** Invert a rigid transform (rotation + translation only): R^T, -R^T t. */
export function invertRigid(m: Mat4): Mat4 {
  const out = new Float32Array(16);
  // transpose rotation block
  out[0] = m[0]!; out[1] = m[4]!; out[2] = m[8]!;
  out[4] = m[1]!; out[5] = m[5]!; out[6] = m[9]!;
  out[8] = m[2]!; out[9] = m[6]!; out[10] = m[10]!;
  const tx = m[12]!, ty = m[13]!, tz = m[14]!;
  out[12] = -(out[0]! * tx + out[4]! * ty + out[8]! * tz);
  out[13] = -(out[1]! * tx + out[5]! * ty + out[9]! * tz);
  out[14] = -(out[2]! * tx + out[6]! * ty + out[10]! * tz);
  out[15] = 1;
  return out;
}

/** Build from a 3x3 rotation (row-major number[9]) and translation. */
export function fromRotationTranslation(r: number[], t: Vec3): Mat4 {
  const m = identity();
  // r is row-major: r[3*row+col]; column-major storage m[row + 4*col]
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 3; col++) m[row + 4 * col] = r[3 * row + col]!;
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2];
  return m;
}

/** Rotation about +y (yaw), radians, plus translation. */
export function fromYawTranslation(yaw: number, t: Vec3): Mat4 {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return fromRotationTranslation([c, 0, s, 0, 1, 0, -s, 0, c], t);
}

/** Angle of the rotation part, radians (from trace). */
export function rotationAngle(m: Mat4): number {
  const tr = m[0]! + m[5]! + m[10]!;
  return Math.acos(Math.min(1, Math.max(-1, (tr - 1) / 2)));
}

export function translationOf(m: Mat4): Vec3 {
  return [m[12]!, m[13]!, m[14]!];
}

/** Transform every point of a packed xyz array by m, into a new array. */
export function transformPacked(m: Mat4, positions: Float32Array, count: number): Float32Array {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const x = positions[3 * i]!, y = positions[3 * i + 1]!, z = positions[3 * i + 2]!;
    out[3 * i] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
    out[3 * i + 1] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
    out[3 * i + 2] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
  }
  return out;
}
