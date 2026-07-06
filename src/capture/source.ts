/**
 * CaptureSource: the seam between sensors and the pipeline.
 * WebXRCaptureSource implements it on ARCore hardware; MockCaptureSource
 * implements it for tests and for the desktop demo. Everything downstream
 * of this interface is hardware-independent.
 */

import type { Intrinsics, Pose } from '../core/types';

export interface CaptureFrame {
  /** depth in meters, row-major, depthSize.w * depthSize.h */
  depth: Float32Array;
  depthSize: { w: number; h: number };
  /** camera-to-world at this frame */
  pose: Pose;
  /** normalized intrinsics of the DEPTH image */
  intrinsics: Intrinsics;
  /** RGB frame when available (keyframe evidence photos, anchor detection) */
  rgb?: ImageBitmap;
  /** per-pixel confidence 0..1 aligned with depth, when the sensor provides it */
  confidence?: Float32Array;
  timestamp: number;
}

export interface CaptureOptions {
  /** clamp depths outside [minDepthM, maxDepthM] */
  minDepthM?: number;
  maxDepthM?: number;
}

export interface CaptureSource {
  /** Yields frames until stop() is called or the underlying session ends. */
  start(opts?: CaptureOptions): AsyncIterable<CaptureFrame>;
  stop(): Promise<void>;
}

export const DEPTH_MIN_M = 0.2;
export const DEPTH_MAX_M = 8.0;
