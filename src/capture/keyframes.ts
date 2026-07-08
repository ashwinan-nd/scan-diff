/**
 * Keyframe policy: which frames keep an evidence photo.
 * Pose-delta test (we have real tracked poses, unlike LingBot's flow test)
 * plus LingBot's forced-gap rule so long slow pans still produce coverage.
 */

import type { Pose } from '../core/types';
import { invertRigid, multiply, rotationAngle, translationOf } from '../core/mat4';

export interface KeyframePolicyOptions {
  /** accept when moved farther than this since last keyframe */
  minTranslationM?: number;
  /** accept when rotated more than this (radians) since last keyframe */
  minRotationRad?: number;
  /** always accept after this many consecutive rejections (LingBot gap=30) */
  maxGapFrames?: number;
}

export class KeyframePolicy {
  private lastKeyframePose: Pose | null = null;
  private rejectedSinceLast = 0;
  private readonly minT: number;
  private readonly minR: number;
  private readonly maxGap: number;

  constructor(opts: KeyframePolicyOptions = {}) {
    this.minT = opts.minTranslationM ?? 0.25;
    this.minR = opts.minRotationRad ?? (15 * Math.PI) / 180;
    this.maxGap = opts.maxGapFrames ?? 30;
  }

  /** Decide for the next frame; updates internal state when accepted. */
  shouldKeep(pose: Pose): boolean {
    if (this.lastKeyframePose === null) {
      this.accept(pose);
      return true;
    }
    const delta = multiply(invertRigid(this.lastKeyframePose.matrix), pose.matrix);
    const t = translationOf(delta);
    const movedFar = Math.hypot(t[0], t[1], t[2]) > this.minT;
    const turnedFar = rotationAngle(delta) > this.minR;
    if (movedFar || turnedFar || this.rejectedSinceLast >= this.maxGap) {
      this.accept(pose);
      return true;
    }
    this.rejectedSinceLast++;
    return false;
  }

  private accept(pose: Pose): void {
    this.lastKeyframePose = { matrix: new Float32Array(pose.matrix) };
    this.rejectedSinceLast = 0;
  }
}
