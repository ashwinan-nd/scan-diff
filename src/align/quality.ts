/**
 * Alignment quality verdict (ARCHITECTURE.md §7). 'poor' means the pipeline
 * refuses to diff and tells the user to rescan — never a silent bad report.
 */

import type { AlignmentQuality } from '../core/types';
import type { IcpResult } from './icp';

export const RMSE_GOOD_M = 0.03;
export const RMSE_USABLE_M = 0.08;
export const MIN_OVERLAP = 0.25;

export function assessAlignment(icp: IcpResult): AlignmentQuality {
  let verdict: AlignmentQuality['verdict'];
  if (icp.rmse < RMSE_GOOD_M && icp.overlapRatio >= MIN_OVERLAP) verdict = 'good';
  else if (icp.rmse < RMSE_USABLE_M && icp.overlapRatio >= MIN_OVERLAP) verdict = 'usable';
  else verdict = 'poor';
  return {
    rmse: icp.rmse,
    overlapRatio: icp.overlapRatio,
    iterations: icp.iterations,
    converged: icp.converged,
    verdict,
  };
}
