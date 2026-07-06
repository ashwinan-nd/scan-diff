/**
 * ReportModel: everything the renderer needs, assembled from pipeline
 * outputs. Pure data — html.ts turns it into the artifact.
 */

import type { AlignmentQuality, ChangeRegion, Keyframe, ScanSession } from '../core/types';
import type { DiffResult } from '../diff';
import { bestKeyframeFor, projectRegionBox, type Box2D } from './project';
import { regionSentence, writtenSummary } from './summary';

export interface RegionEvidence {
  /** keyframe id + projected box in the BASELINE scan, when visible */
  before: { keyframeId: number; box: Box2D } | null;
  /** same for the RESCAN */
  after: { keyframeId: number; box: Box2D } | null;
}

export interface ReportRegion {
  region: ChangeRegion;
  sentence: string;
  evidence: RegionEvidence;
}

export interface ReportModel {
  title: string;
  createdAt: number;
  scanALabel: string;
  scanADate: number;
  scanADevice: string;
  scanBLabel: string;
  scanBDate: number;
  scanBDevice: string;
  summary: string;
  regions: ReportRegion[];
  quality: AlignmentQuality;
  coverageBofA: number;
  coverageAofB: number;
  voxelSizeM: number;
  alignmentMethod: string;
}

function evidenceIn(region: ChangeRegion, keyframes: Keyframe[]): { keyframeId: number; box: Box2D } | null {
  const kf = bestKeyframeFor(region, keyframes);
  if (!kf) return null;
  const box = projectRegionBox(region, kf);
  if (!box) return null;
  return { keyframeId: kf.id, box };
}

export function buildReportModel(
  scanA: ScanSession,
  scanB: ScanSession,
  diff: DiffResult,
  quality: AlignmentQuality,
  alignmentMethod: string,
  /** keyframes of B expressed in A's frame (poses pre-multiplied by the alignment) */
  keyframesBAligned: Keyframe[],
): ReportModel {
  const regions: ReportRegion[] = diff.regions.map((region, i) => ({
    region,
    sentence: regionSentence(region, i),
    evidence: {
      before: evidenceIn(region, scanA.keyframes),
      after: evidenceIn(region, keyframesBAligned),
    },
  }));

  return {
    title: `Scan comparison: ${scanA.label} → ${scanB.label}`,
    createdAt: Date.now(),
    scanALabel: scanA.label,
    scanADate: scanA.createdAt,
    scanADevice: scanA.deviceInfo,
    scanBLabel: scanB.label,
    scanBDate: scanB.createdAt,
    scanBDevice: scanB.deviceInfo,
    summary: writtenSummary({
      regions: diff.regions,
      quality,
      coverageBofA: diff.coverageBofA,
      coverageAofB: diff.coverageAofB,
      voxelSizeM: diff.voxelSizeM,
    }),
    regions,
    quality,
    coverageBofA: diff.coverageBofA,
    coverageAofB: diff.coverageAofB,
    voxelSizeM: diff.voxelSizeM,
    alignmentMethod,
  };
}
