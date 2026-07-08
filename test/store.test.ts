import { describe, expect, it } from 'vitest';
import { decodeScan, encodeScan, type StoredScan } from '../src/store/codec';
import type { ScanSession } from '../src/core/types';
import { identity } from '../src/core/mat4';

const session = (): ScanSession => ({
  id: 's-1',
  label: 'baseline',
  createdAt: 1751700000000,
  cloud: { positions: new Float32Array([1, 2, 3, 4, 5, 6]), count: 2 },
  keyframes: [
    {
      id: 0,
      pose: { matrix: identity() },
      intrinsics: { fx: 0.8, fy: 1.0667, cx: 0.5, cy: 0.5 },
      imageSize: { w: 160, h: 120 },
      timestamp: 12,
    },
  ],
  anchor: {
    pose: { matrix: identity() },
    markerId: 'M',
    sizeMeters: 0.2,
  },
  deviceInfo: 'test',
  version: 1,
});

describe('scan codec', () => {
  it('round-trips a session exactly', () => {
    const s = session();
    const back = decodeScan(encodeScan(s));
    expect(back.id).toBe(s.id);
    expect(back.label).toBe(s.label);
    expect(Array.from(back.cloud.positions)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(back.cloud.count).toBe(2);
    expect(back.keyframes.length).toBe(1);
    expect(Array.from(back.keyframes[0]!.pose.matrix)).toEqual(Array.from(identity()));
    expect(back.anchor!.markerId).toBe('M');
    expect(back.anchor!.sizeMeters).toBe(0.2);
  });

  it('round-trips a null anchor', () => {
    const s = { ...session(), anchor: null };
    expect(decodeScan(encodeScan(s)).anchor).toBeNull();
  });

  it('copies points instead of aliasing the source buffer', () => {
    const s = session();
    const enc = encodeScan(s);
    s.cloud.positions[0] = 999;
    expect(new Float32Array(enc.positions)[0]).toBe(1);
  });

  it('rejects unknown versions and truncated data', () => {
    const enc = encodeScan(session());
    expect(() => decodeScan({ ...enc, version: 2 as unknown as 1 })).toThrow();
    expect(() => decodeScan({ ...enc, positions: new ArrayBuffer(4) } as StoredScan)).toThrow();
  });
});
