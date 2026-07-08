/**
 * .scandiff exchange format: one portable JSON file per scan, so scans move
 * between devices without a backend (email, AirDrop, cloud drive).
 *
 * Envelope = { magic, version, scan: StoredScan with binary fields base64 }.
 * Version-gated for forward migration; import re-validates through the same
 * codec guards as IndexedDB reads (corrupt files fail loudly, never load as
 * garbage geometry).
 */

import type { ScanSession } from '../core/types';
import { ScanDiffError } from '../core/types';
import { decodeScan, encodeScan, type StoredScan } from './codec';

const MAGIC = 'scan-diff/scan';

interface ExchangeKeyframe {
  id: number;
  poseMatrix: number[];
  intrinsics: { fx: number; fy: number; cx: number; cy: number };
  imageSize: { w: number; h: number };
  timestamp: number;
  /** base64 JPEG when the keyframe carried an evidence photo */
  imageB64?: string;
}

interface ExchangeEnvelope {
  magic: typeof MAGIC;
  version: 1;
  exportedAt: number;
  scan: {
    id: string;
    label: string;
    createdAt: number;
    positionsB64: string;
    pointCount: number;
    keyframes: ExchangeKeyframe[];
    anchor: { poseMatrix: number[]; markerId: string; sizeMeters: number } | null;
    deviceInfo: string;
  };
}

function bytesToB64(bytes: Uint8Array): string {
  // chunked to stay under argument limits on large clouds
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function b64ToBytes(b64: string): Uint8Array {
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    throw new ScanDiffError('bad-input', '.scandiff file is corrupt (invalid base64 payload).');
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function exportScan(session: ScanSession): Promise<string> {
  const stored = encodeScan(session);
  const keyframes: ExchangeKeyframe[] = [];
  for (const kf of stored.keyframes) {
    const { imageBlob, ...rest } = kf;
    const entry: ExchangeKeyframe = { ...rest };
    if (imageBlob) {
      entry.imageB64 = bytesToB64(new Uint8Array(await imageBlob.arrayBuffer()));
    }
    keyframes.push(entry);
  }
  const envelope: ExchangeEnvelope = {
    magic: MAGIC,
    version: 1,
    exportedAt: Date.now(),
    scan: {
      id: stored.id,
      label: stored.label,
      createdAt: stored.createdAt,
      positionsB64: bytesToB64(new Uint8Array(stored.positions)),
      pointCount: stored.pointCount,
      keyframes,
      anchor: stored.anchor,
      deviceInfo: stored.deviceInfo,
    },
  };
  return JSON.stringify(envelope);
}

export function importScan(text: string): ScanSession {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ScanDiffError('bad-input', 'Not a .scandiff file (invalid JSON).');
  }
  const env = parsed as Partial<ExchangeEnvelope>;
  if (env.magic !== MAGIC) {
    throw new ScanDiffError('bad-input', 'Not a .scandiff file (missing magic header).');
  }
  if (env.version !== 1) {
    throw new ScanDiffError('bad-input', `Unsupported .scandiff version ${String(env.version)} — update the app.`);
  }
  const s = env.scan;
  if (!s || typeof s.id !== 'string' || typeof s.pointCount !== 'number' || typeof s.positionsB64 !== 'string') {
    throw new ScanDiffError('bad-input', '.scandiff file is malformed (missing scan fields).');
  }
  const positions = b64ToBytes(s.positionsB64);
  const stored: StoredScan = {
    id: s.id,
    label: typeof s.label === 'string' ? s.label : 'imported scan',
    createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
    positions: positions.buffer.slice(positions.byteOffset, positions.byteOffset + positions.byteLength) as ArrayBuffer,
    pointCount: s.pointCount,
    keyframes: (Array.isArray(s.keyframes) ? s.keyframes : []).map((kf) => {
      const { imageB64, ...rest } = kf;
      return {
        ...rest,
        ...(imageB64 !== undefined
          ? { imageBlob: new Blob([b64ToBytes(imageB64).buffer as ArrayBuffer], { type: 'image/jpeg' }) }
          : {}),
      };
    }),
    anchor: s.anchor ?? null,
    deviceInfo: typeof s.deviceInfo === 'string' ? s.deviceInfo : 'imported',
    version: 1,
  };
  // decodeScan re-runs the truncation/version guards
  return decodeScan(stored);
}

export const EXCHANGE_EXTENSION = '.scandiff';
export const isExchangeFile = (name: string): boolean => /\.scandiff$/i.test(name);
