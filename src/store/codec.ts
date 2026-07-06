/**
 * ScanSession <-> serializable record. Versioned so future schema changes
 * can migrate instead of breaking saved scans.
 * Binary point data stays an ArrayBuffer (IndexedDB stores it natively);
 * keyframe photos stay Blobs. Export/import packs everything into one JSON
 * envelope with base64 blobs (.scandiff file).
 */

import type { AnchorObservation, Keyframe, ScanSession } from '../core/types';
import { ScanDiffError } from '../core/types';

export interface StoredKeyframe {
  id: number;
  poseMatrix: number[];
  intrinsics: { fx: number; fy: number; cx: number; cy: number };
  imageSize: { w: number; h: number };
  timestamp: number;
  imageBlob?: Blob;
}

export interface StoredScan {
  id: string;
  label: string;
  createdAt: number;
  positions: ArrayBuffer;
  pointCount: number;
  keyframes: StoredKeyframe[];
  anchor: { poseMatrix: number[]; markerId: string; sizeMeters: number } | null;
  deviceInfo: string;
  version: 1;
}

export function encodeScan(s: ScanSession): StoredScan {
  return {
    id: s.id,
    label: s.label,
    createdAt: s.createdAt,
    positions: s.cloud.positions.buffer.slice(
      s.cloud.positions.byteOffset,
      s.cloud.positions.byteOffset + s.cloud.count * 3 * 4,
    ),
    pointCount: s.cloud.count,
    keyframes: s.keyframes.map((kf) => ({
      id: kf.id,
      poseMatrix: Array.from(kf.pose.matrix),
      intrinsics: { ...kf.intrinsics },
      imageSize: { ...kf.imageSize },
      timestamp: kf.timestamp,
      ...(kf.imageBlob ? { imageBlob: kf.imageBlob } : {}),
    })),
    anchor: s.anchor
      ? {
          poseMatrix: Array.from(s.anchor.pose.matrix),
          markerId: s.anchor.markerId,
          sizeMeters: s.anchor.sizeMeters,
        }
      : null,
    deviceInfo: s.deviceInfo,
    version: 1,
  };
}

export function decodeScan(r: StoredScan): ScanSession {
  if (r.version !== 1) {
    throw new ScanDiffError('store-failure', `Unknown scan format version ${String(r.version)}.`);
  }
  if (!r.positions || r.pointCount * 3 * 4 > r.positions.byteLength) {
    throw new ScanDiffError('store-failure', 'Stored scan is corrupt (point data truncated).');
  }
  const keyframes: Keyframe[] = r.keyframes.map((kf) => ({
    id: kf.id,
    pose: { matrix: new Float32Array(kf.poseMatrix) },
    intrinsics: { ...kf.intrinsics },
    imageSize: { ...kf.imageSize },
    timestamp: kf.timestamp,
    ...(kf.imageBlob ? { imageBlob: kf.imageBlob } : {}),
  }));
  const anchor: AnchorObservation | null = r.anchor
    ? {
        pose: { matrix: new Float32Array(r.anchor.poseMatrix) },
        markerId: r.anchor.markerId,
        sizeMeters: r.anchor.sizeMeters,
      }
    : null;
  return {
    id: r.id,
    label: r.label,
    createdAt: r.createdAt,
    cloud: { positions: new Float32Array(r.positions), count: r.pointCount },
    keyframes,
    anchor,
    deviceInfo: r.deviceInfo,
    version: 1,
  };
}
