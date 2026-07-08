/**
 * File upload -> ScanSession. Parses a .ply export from any scanning app
 * (Polycam, Scaniverse, 3D Scanner App, etc.) into the same ScanSession shape
 * the live capture path produces, so the pipeline is source-blind.
 *
 * Uploaded sessions carry no keyframes and no anchor:
 *  - zero keyframes => diff layer treats the cloud as a complete observation
 *    (see occupancy-diff.ts), and reports fall back to geometry evidence cards;
 *  - no anchor => alignment uses the yaw-search fallback, which requires the
 *    two scans to share gravity alignment (all ARKit/ARCore exports are y-up)
 *    and >= ~40% overlap. Surfaced in UI copy, not hidden.
 */

import type { ScanSession } from '../core/types';
import { ScanDiffError } from '../core/types';
import { parsePly } from './ply';

const MAX_UPLOAD_BYTES = 256 * 1024 * 1024;

export function sessionFromPlyBuffer(
  buffer: ArrayBuffer,
  fileName: string,
): ScanSession {
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new ScanDiffError('bad-input', `File is ${(buffer.byteLength / 1e6).toFixed(0)} MB — the limit is ${MAX_UPLOAD_BYTES / 1e6} MB.`);
  }
  const { positions, count } = parsePly(buffer);
  const label = fileName.replace(/\.ply$/i, '') || 'uploaded scan';
  return {
    id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label,
    createdAt: Date.now(),
    cloud: { positions, count },
    keyframes: [],
    anchor: null,
    deviceInfo: `file upload (${fileName})`,
    version: 1,
  };
}

/** Accepted upload extensions, for the file input + drop-zone filter. */
export const UPLOAD_ACCEPT = '.ply';

export function isSupportedUpload(fileName: string): boolean {
  return /\.ply$/i.test(fileName);
}
