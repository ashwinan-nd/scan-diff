/**
 * QR anchor detection: RGB frame + depth lookup -> AnchorObservation.
 * Bridges jsQR (pixel-space corner detection) to anchor.ts (metric 6-DOF
 * marker pose). The detector is injected so unit tests exercise the full
 * geometry path without synthesizing decodable QR imagery, and so a
 * different fiducial detector can swap in without touching capture logic.
 */

import jsQR from 'jsqr';
import type { AnchorObservation, Intrinsics, Pose } from '../core/types';
import { anchorFromCorners, type CornerSample } from './anchor';

export interface DetectedCode {
  /** decoded payload — becomes the markerId both sessions must share */
  data: string;
  /** pixel corners in jsQR location order */
  corners: {
    topLeft: { x: number; y: number };
    topRight: { x: number; y: number };
    bottomRight: { x: number; y: number };
    bottomLeft: { x: number; y: number };
  };
}

export type QrDetector = (
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
) => DetectedCode | null;

/** Production detector backed by jsQR. */
export const jsQrDetector: QrDetector = (rgba, width, height) => {
  const hit = jsQR(rgba, width, height, { inversionAttempts: 'dontInvert' });
  if (!hit || hit.data.length === 0) return null;
  return {
    data: hit.data,
    corners: {
      topLeft: hit.location.topLeftCorner,
      topRight: hit.location.topRightCorner,
      bottomRight: hit.location.bottomRightCorner,
      bottomLeft: hit.location.bottomLeftCorner,
    },
  };
};

/**
 * Look up metric depth for an RGB pixel via the depth buffer (which may be a
 * different resolution). Samples a 3x3 neighborhood median for robustness at
 * marker edges, where depth pixels straddle the marker/background boundary.
 */
export function depthAtRgbPixel(
  u: number,
  v: number,
  rgbSize: { w: number; h: number },
  depth: Float32Array,
  depthSize: { w: number; h: number },
): number {
  const du = Math.round((u / rgbSize.w) * depthSize.w);
  const dv = Math.round((v / rgbSize.h) * depthSize.h);
  const samples: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = du + dx, y = dv + dy;
      if (x < 0 || y < 0 || x >= depthSize.w || y >= depthSize.h) continue;
      const z = depth[y * depthSize.w + x]!;
      if (Number.isFinite(z) && z > 0) samples.push(z);
    }
  }
  if (samples.length === 0) return NaN;
  samples.sort((a, b) => a - b);
  return samples[samples.length >> 1]!;
}

/**
 * One detection attempt on one frame. Returns null when no code is visible,
 * when depth is unusable at any corner, or when the geometry is degenerate —
 * callers just try again on a later frame (detection runs opportunistically
 * during the scan; multiple hits get median-fused in the session builder).
 */
export function detectAnchorInFrame(
  rgba: Uint8ClampedArray,
  rgbSize: { w: number; h: number },
  depth: Float32Array,
  depthSize: { w: number; h: number },
  intrinsics: Intrinsics,
  cameraPose: Pose,
  detector: QrDetector = jsQrDetector,
): AnchorObservation | null {
  if (rgba.length < rgbSize.w * rgbSize.h * 4) return null;
  const code = detector(rgba, rgbSize.w, rgbSize.h);
  if (!code) return null;

  const corner = (p: { x: number; y: number }): CornerSample => ({
    u: p.x,
    v: p.y,
    depthM: depthAtRgbPixel(p.x, p.y, rgbSize, depth, depthSize),
  });
  const corners: [CornerSample, CornerSample, CornerSample, CornerSample] = [
    corner(code.corners.topLeft),
    corner(code.corners.topRight),
    corner(code.corners.bottomRight),
    corner(code.corners.bottomLeft),
  ];
  return anchorFromCorners(corners, rgbSize, intrinsics, cameraPose, code.data);
}
