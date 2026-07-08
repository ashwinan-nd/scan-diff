/**
 * comparePipeline: THE core API. Two ScanSessions in, report out.
 * capture → align (coarse + ICP + quality gate) → diff → report model.
 * Domain-agnostic by construction: nothing here inspects labels or content.
 */

import type { AlignmentQuality, Keyframe, ScanSession } from './core/types';
import { ScanDiffError } from './core/types';
import { multiply, transformPacked } from './core/mat4';
import { coarseAlign } from './align/coarse';
import { icpRefine, type IcpOptions } from './align/icp';
import { assessAlignment } from './align/quality';
import { diffClouds, type DiffOptions, type DiffResult, type RegionOptions } from './diff';
import { buildReportModel, type ReportModel } from './report/model';

export interface CompareOptions {
  icp?: IcpOptions;
  diff?: DiffOptions & RegionOptions;
  /** proceed even when alignment verdict is 'poor' (diagnostics only) */
  allowPoorAlignment?: boolean;
}

export interface CompareResult {
  report: ReportModel;
  diff: DiffResult;
  quality: AlignmentQuality;
  alignmentMethod: 'marker' | 'yaw-search';
  /** B→A transform actually used */
  transform: Float32Array;
  /** B keyframes re-expressed in A's frame (evidence selection used these) */
  keyframesBAligned: Keyframe[];
}

export function comparePipeline(
  scanA: ScanSession,
  scanB: ScanSession,
  options: CompareOptions = {},
): CompareResult {
  if (scanA.cloud.count < 100 || scanB.cloud.count < 100) {
    throw new ScanDiffError('bad-input', 'Both scans need at least 100 points to compare.');
  }

  // 1. coarse alignment (marker preferred, yaw-search fallback)
  const coarse = coarseAlign(scanA.cloud, scanB.cloud, scanA.anchor, scanB.anchor);

  // 2. ICP refinement
  const icp = icpRefine(
    scanA.cloud.positions, scanA.cloud.count,
    scanB.cloud.positions, scanB.cloud.count,
    coarse.transform,
    options.icp ?? {},
  );
  const quality = assessAlignment(icp);
  if (quality.verdict === 'poor' && !options.allowPoorAlignment) {
    throw new ScanDiffError(
      'alignment-poor',
      `The scans could not be aligned reliably (RMSE ${(quality.rmse * 1000).toFixed(0)} mm, ` +
      `${Math.round(quality.overlapRatio * 100)}% overlap). ` +
      (coarse.method === 'yaw-search'
        ? 'No shared marker was found — rescan with the same printed code visible in both scans, or capture more overlap.'
        : 'Rescan covering more of the same area.'),
    );
  }

  // 3. express B in A's frame
  const alignedPositions = transformPacked(icp.transform, scanB.cloud.positions, scanB.cloud.count);
  const cloudBAligned = { positions: alignedPositions, count: scanB.cloud.count };
  const keyframesBAligned: Keyframe[] = scanB.keyframes.map((kf) => ({
    ...kf,
    pose: { matrix: multiply(icp.transform, kf.pose.matrix) },
  }));

  // 4. geometric diff (coverage-aware)
  const diff = diffClouds(
    scanA.cloud, cloudBAligned, scanA.keyframes, keyframesBAligned, options.diff ?? {},
  );

  // 5. report model
  const report = buildReportModel(scanA, scanB, diff, quality, coarse.method, keyframesBAligned);

  return {
    report,
    diff,
    quality,
    alignmentMethod: coarse.method,
    transform: icp.transform,
    keyframesBAligned,
  };
}
