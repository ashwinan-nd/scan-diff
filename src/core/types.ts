/**
 * Canonical data shapes for the whole pipeline.
 * Conventions (see docs/ARCHITECTURE.md §2, §5):
 *  - meters, right-handed, y-up, camera looks down -z (WebXR convention)
 *  - matrices are 4x4 column-major Float32Array(16) (WebGL / XRRigidTransform layout)
 *  - poses are camera-to-world
 *  - intrinsics are NORMALIZED by image width/height (multi-device safe)
 */

export interface Intrinsics {
  /** focal length / image width */
  fx: number;
  /** focal length / image height */
  fy: number;
  /** principal point x / image width */
  cx: number;
  /** principal point y / image height */
  cy: number;
}

export interface Pose {
  /** camera-to-world, column-major 4x4 */
  matrix: Float32Array;
}

export interface PointCloud {
  /** packed xyz triples, world frame of the owning session */
  positions: Float32Array;
  count: number;
}

export interface ImageSize {
  w: number;
  h: number;
}

export interface Keyframe {
  id: number;
  pose: Pose;
  intrinsics: Intrinsics;
  /** JPEG of the camera frame; evidence photo. Absent in synthetic/mock sessions. */
  imageBlob?: Blob;
  imageSize: ImageSize;
  timestamp: number;
}

export interface AnchorObservation {
  /** marker-to-world */
  pose: Pose;
  /** QR payload string; both sessions must share it for marker alignment */
  markerId: string;
  /** measured physical edge length of the marker, meters */
  sizeMeters: number;
}

export interface ScanSession {
  id: string;
  label: string;
  createdAt: number;
  cloud: PointCloud;
  keyframes: Keyframe[];
  anchor: AnchorObservation | null;
  /** provenance only — never used in logic */
  deviceInfo: string;
  version: 1;
}

export type ChangeKind = 'added' | 'removed' | 'shifted';

export interface ChangeRegion {
  kind: ChangeKind;
  voxelCount: number;
  volumeM3: number;
  bboxMin: [number, number, number];
  bboxMax: [number, number, number];
  centroid: [number, number, number];
  /** index of the paired region when kind === 'shifted' */
  shiftPartner?: number;
  /** 0..1, from voxel point-support density */
  confidence: number;
}

export interface AlignmentQuality {
  /** inlier root-mean-square error, meters */
  rmse: number;
  /** fraction of moving-cloud points with a fixed-cloud neighbor within 0.1 m */
  overlapRatio: number;
  iterations: number;
  converged: boolean;
  verdict: 'good' | 'usable' | 'poor';
}

/** Actionable capture/pipeline failure. Message is user-facing. */
export class ScanDiffError extends Error {
  constructor(
    readonly reason:
      | 'no-webxr'
      | 'no-depth'
      | 'permission-denied'
      | 'tracking-lost'
      | 'alignment-poor'
      | 'empty-scan'
      | 'store-failure'
      | 'bad-input',
    message: string,
  ) {
    super(message);
    this.name = 'ScanDiffError';
  }
}
