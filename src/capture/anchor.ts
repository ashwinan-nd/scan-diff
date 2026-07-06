/**
 * QR-marker anchor: turns a detected QR code (4 corner pixels + depth) into a
 * 6-DOF marker-to-world pose shared by both scan sessions.
 *
 * The math here is pure and unit-tested; jsQR-based detection on live RGB
 * frames lives in the UI layer (browser ImageData), which calls
 * anchorFromCorners with the detected corners.
 */

import type { AnchorObservation, Intrinsics, Pose } from '../core/types';
import { cross, normalize, sub, type Vec3 } from '../core/vec3';
import { fromRotationTranslation, transformPoint } from '../core/mat4';

export interface CornerSample {
  /** pixel coords in the RGB/depth image */
  u: number;
  v: number;
  /** metric depth at that pixel, meters */
  depthM: number;
}

/**
 * Unproject one corner pixel to camera space then world space.
 * Same pinhole convention as unproject.ts.
 */
function cornerToWorld(
  c: CornerSample,
  imageSize: { w: number; h: number },
  intrinsics: Intrinsics,
  pose: Pose,
): Vec3 {
  const xn = ((c.u + 0.5) / imageSize.w - intrinsics.cx) / intrinsics.fx;
  const yn = ((c.v + 0.5) / imageSize.h - intrinsics.cy) / intrinsics.fy;
  const pCam: Vec3 = [xn * c.depthM, -yn * c.depthM, -c.depthM];
  return transformPoint(pose.matrix, pCam);
}

/**
 * Build an AnchorObservation from QR corners ordered
 * [topLeft, topRight, bottomRight, bottomLeft] (jsQR location order).
 * Frame: origin = corner centroid, x = top edge, y = "up" the code,
 * z = plane normal (right-handed). Size = mean edge length, measured — no
 * assumption about the printed size.
 */
export function anchorFromCorners(
  corners: [CornerSample, CornerSample, CornerSample, CornerSample],
  imageSize: { w: number; h: number },
  intrinsics: Intrinsics,
  cameraPose: Pose,
  markerId: string,
): AnchorObservation | null {
  const [tl, tr, br, bl] = corners;
  for (const c of corners) {
    if (!Number.isFinite(c.depthM) || c.depthM <= 0) return null;
  }
  const wTL = cornerToWorld(tl, imageSize, intrinsics, cameraPose);
  const wTR = cornerToWorld(tr, imageSize, intrinsics, cameraPose);
  const wBR = cornerToWorld(br, imageSize, intrinsics, cameraPose);
  const wBL = cornerToWorld(bl, imageSize, intrinsics, cameraPose);

  const xAxisRaw = sub(wTR, wTL);
  const yAxisRaw = sub(wTL, wBL);
  const xAxis = normalize(xAxisRaw);
  let zAxis = normalize(cross(xAxis, normalize(yAxisRaw)));
  if (Math.hypot(...zAxis) < 0.5) return null; // degenerate (collinear corners)
  const yAxis = normalize(cross(zAxis, xAxis));
  zAxis = normalize(cross(xAxis, yAxis)); // re-orthogonalize

  const origin: Vec3 = [
    (wTL[0] + wTR[0] + wBR[0] + wBL[0]) / 4,
    (wTL[1] + wTR[1] + wBR[1] + wBL[1]) / 4,
    (wTL[2] + wTR[2] + wBR[2] + wBL[2]) / 4,
  ];

  const edge = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const sizeMeters =
    (edge(wTL, wTR) + edge(wTR, wBR) + edge(wBR, wBL) + edge(wBL, wTL)) / 4;
  if (sizeMeters < 0.02 || sizeMeters > 2) return null; // implausible detection

  // rotation columns = axes (marker frame -> world); row-major for the helper
  const r = [
    xAxis[0], yAxis[0], zAxis[0],
    xAxis[1], yAxis[1], zAxis[1],
    xAxis[2], yAxis[2], zAxis[2],
  ];
  return { pose: { matrix: fromRotationTranslation(r, origin) }, markerId, sizeMeters };
}

/**
 * Robust fuse of several observations of the SAME marker within one session:
 * componentwise median translation; rotation from the observation whose
 * translation is closest to that median (median-selected, avoids averaging
 * rotations). Returns null on empty input.
 */
export function fuseAnchorObservations(obs: AnchorObservation[]): AnchorObservation | null {
  if (obs.length === 0) return null;
  if (obs.length === 1) return obs[0]!;
  const med = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
  };
  const tx = med(obs.map((o) => o.pose.matrix[12]!));
  const ty = med(obs.map((o) => o.pose.matrix[13]!));
  const tz = med(obs.map((o) => o.pose.matrix[14]!));
  let best = obs[0]!;
  let bestD = Infinity;
  for (const o of obs) {
    const d =
      (o.pose.matrix[12]! - tx) ** 2 +
      (o.pose.matrix[13]! - ty) ** 2 +
      (o.pose.matrix[14]! - tz) ** 2;
    if (d < bestD) { bestD = d; best = o; }
  }
  const m = new Float32Array(best.pose.matrix);
  m[12] = tx; m[13] = ty; m[14] = tz;
  return {
    pose: { matrix: m },
    markerId: best.markerId,
    sizeMeters: med(obs.map((o) => o.sizeMeters)),
  };
}
