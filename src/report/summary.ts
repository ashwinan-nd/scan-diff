/**
 * Written summary — generated from geometry ALONE. The vocabulary here is
 * deliberately domain-free ("material", "region", "scan") and enforced by
 * test: no vertical nouns anywhere in src/ core logic. "Does this change
 * matter" is the reader's call; we report what, where, how big.
 */

import type { AlignmentQuality, ChangeRegion } from '../core/types';

const fmt = (n: number, digits = 2): string => n.toFixed(digits);

/** "0.40 × 0.30 × 0.25 m" with extents sorted descending. */
export function extentString(r: ChangeRegion): string {
  const e = [
    r.bboxMax[0] - r.bboxMin[0],
    r.bboxMax[1] - r.bboxMin[1],
    r.bboxMax[2] - r.bboxMin[2],
  ].sort((a, b) => b - a);
  return `${fmt(e[0]!)} × ${fmt(e[1]!)} × ${fmt(e[2]!)} m`;
}

export function volumeString(r: ChangeRegion): string {
  return r.volumeM3 >= 0.001 ? `≈${fmt(r.volumeM3, 3)} m³` : `<0.001 m³`;
}

export function distanceFromOriginString(r: ChangeRegion): string {
  const d = Math.hypot(r.centroid[0], r.centroid[1], r.centroid[2]);
  return `${fmt(d, 1)} m from scan origin`;
}

export function regionSentence(r: ChangeRegion, index: number): string {
  const what =
    r.kind === 'added'
      ? 'New material present in the second scan'
      : r.kind === 'removed'
        ? 'Material present in the first scan is gone in the second'
        : `Material moved (paired with region ${(r.shiftPartner ?? 0) + 1})`;
  return `Region ${index + 1}: ${what} — ${extentString(r)}, ${volumeString(r)}, ${distanceFromOriginString(r)}.`;
}

export interface SummaryInput {
  regions: ChangeRegion[];
  quality: AlignmentQuality;
  coverageBofA: number;
  coverageAofB: number;
  voxelSizeM: number;
}

export function writtenSummary(input: SummaryInput): string {
  const { regions, quality, coverageBofA, coverageAofB, voxelSizeM } = input;
  const counts = { added: 0, removed: 0, shifted: 0 };
  for (const r of regions) counts[r.kind]++;
  const shiftedPairs = counts.shifted / 2;

  const lines: string[] = [];
  if (regions.length === 0) {
    lines.push('No geometric changes detected between the two scans.');
  } else {
    const parts: string[] = [];
    if (counts.added) parts.push(`${counts.added} addition${counts.added > 1 ? 's' : ''}`);
    if (counts.removed) parts.push(`${counts.removed} removal${counts.removed > 1 ? 's' : ''}`);
    if (shiftedPairs) parts.push(`${shiftedPairs} moved object${shiftedPairs > 1 ? 's' : ''} (${counts.shifted} linked regions)`);
    lines.push(`${regions.length} changed region${regions.length > 1 ? 's' : ''} detected: ${parts.join(', ')}.`);
  }
  regions.forEach((r, i) => lines.push(regionSentence(r, i)));

  lines.push(
    `Alignment: ${quality.verdict} (RMSE ${fmt(quality.rmse * 1000, 1)} mm, ` +
    `${Math.round(quality.overlapRatio * 100)}% overlap, ` +
    `${quality.converged ? 'converged' : 'did not converge'} in ${quality.iterations} iterations).`,
  );
  const covMin = Math.min(coverageBofA, coverageAofB);
  if (covMin < 0.9) {
    lines.push(
      `Coverage note: ${Math.round(covMin * 100)}% of previously scanned space was re-observed — ` +
      `areas not seen in both scans are excluded from the diff, so changes there would not be reported.`,
    );
  }
  lines.push(`Detection resolution: ${fmt(voxelSizeM * 100, 0)} cm voxels; smaller changes fall below the reporting floor.`);
  return lines.join('\n');
}
