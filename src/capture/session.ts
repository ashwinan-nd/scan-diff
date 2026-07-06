/**
 * ScanSessionBuilder: consumes CaptureFrames from any CaptureSource and
 * accumulates a ScanSession — the persistent artifact of one scan.
 * Pure logic; safe in Node tests and workers.
 */

import type { AnchorObservation, Keyframe, PointCloud, ScanSession } from '../core/types';
import { ScanDiffError } from '../core/types';
import type { CaptureFrame } from './source';
import { KeyframePolicy, type KeyframePolicyOptions } from './keyframes';
import { unprojectDepth, type UnprojectOptions } from './unproject';
import { fuseAnchorObservations } from './anchor';

export interface SessionBuilderOptions {
  keyframe?: KeyframePolicyOptions;
  unproject?: UnprojectOptions;
  /** hard cap so runaway captures can't exhaust memory (~48 MB of floats) */
  maxPoints?: number;
}

export class ScanSessionBuilder {
  private readonly chunks: Float32Array[] = [];
  private pointCount = 0;
  private readonly keyframes: Keyframe[] = [];
  private readonly anchorObs: AnchorObservation[] = [];
  private readonly policy: KeyframePolicy;
  private nextKeyframeId = 0;
  private frameCount = 0;

  constructor(private readonly opts: SessionBuilderOptions = {}) {
    this.policy = new KeyframePolicy(opts.keyframe);
  }

  /** Feed one frame. Returns whether it became a keyframe (UI feedback). */
  addFrame(frame: CaptureFrame): { keyframe: boolean; totalPoints: number } {
    this.frameCount++;
    const maxPoints = this.opts.maxPoints ?? 4_000_000;
    if (this.pointCount < maxPoints) {
      const pts = unprojectDepth(
        frame.depth, frame.depthSize, frame.pose, frame.intrinsics,
        this.opts.unproject ?? {}, frame.confidence,
      );
      if (pts.length > 0) {
        this.chunks.push(pts);
        this.pointCount += pts.length / 3;
      }
    }
    const isKf = this.policy.shouldKeep(frame.pose);
    if (isKf) {
      this.keyframes.push({
        id: this.nextKeyframeId++,
        pose: { matrix: new Float32Array(frame.pose.matrix) },
        intrinsics: { ...frame.intrinsics },
        imageSize: frame.rgb
          ? { w: frame.rgb.width, h: frame.rgb.height }
          : { w: frame.depthSize.w, h: frame.depthSize.h },
        timestamp: frame.timestamp,
      });
    }
    return { keyframe: isKf, totalPoints: this.pointCount };
  }

  /** Record a marker sighting (UI detects, this fuses). */
  addAnchorObservation(obs: AnchorObservation): void {
    this.anchorObs.push(obs);
  }

  get stats(): { frames: number; points: number; keyframes: number; anchorSightings: number } {
    return {
      frames: this.frameCount,
      points: this.pointCount,
      keyframes: this.keyframes.length,
      anchorSightings: this.anchorObs.length,
    };
  }

  /** Finalize. Throws when the capture produced nothing usable. */
  build(id: string, label: string, deviceInfo: string): ScanSession {
    if (this.pointCount < 100) {
      throw new ScanDiffError(
        'empty-scan',
        `Capture produced only ${this.pointCount} points — scan longer and keep surfaces in view.`,
      );
    }
    const positions = new Float32Array(this.pointCount * 3);
    let off = 0;
    for (const c of this.chunks) {
      positions.set(c, off);
      off += c.length;
    }
    const cloud: PointCloud = { positions, count: this.pointCount };
    return {
      id,
      label,
      createdAt: Date.now(),
      cloud,
      keyframes: this.keyframes,
      anchor: fuseAnchorObservations(this.anchorObs),
      deviceInfo,
      version: 1,
    };
  }
}
