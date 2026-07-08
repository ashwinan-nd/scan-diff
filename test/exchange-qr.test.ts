import { describe, expect, it } from 'vitest';
import { exportScan, importScan, isExchangeFile } from '../src/store/exchange';
import { depthAtRgbPixel, detectAnchorInFrame, type QrDetector } from '../src/capture/qr';
import type { ScanSession } from '../src/core/types';
import { ScanDiffError } from '../src/core/types';
import { identity } from '../src/core/mat4';
import { MOCK_INTRINSICS } from '../src/capture/mock';

const session = (over: Partial<ScanSession> = {}): ScanSession => ({
  id: 's-1',
  label: 'baseline',
  createdAt: 1751700000000,
  cloud: { positions: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), count: 3 },
  keyframes: [
    {
      id: 0,
      pose: { matrix: identity() },
      intrinsics: { ...MOCK_INTRINSICS },
      imageSize: { w: 160, h: 120 },
      timestamp: 12,
      imageBlob: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer], { type: 'image/jpeg' }),
    },
  ],
  anchor: { pose: { matrix: identity() }, markerId: 'M', sizeMeters: 0.2 },
  deviceInfo: 'test',
  version: 1,
  ...over,
});

describe('.scandiff exchange', () => {
  it('round-trips a full session including keyframe photo and anchor', async () => {
    const text = await exportScan(session());
    const back = importScan(text);
    expect(back.id).toBe('s-1');
    expect(Array.from(back.cloud.positions)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(back.cloud.count).toBe(3);
    expect(back.anchor!.markerId).toBe('M');
    expect(back.keyframes[0]!.imageBlob).toBeInstanceOf(Blob);
    const bytes = new Uint8Array(await back.keyframes[0]!.imageBlob!.arrayBuffer());
    expect(Array.from(bytes)).toEqual([0xff, 0xd8, 0xff, 0xe0]);
  });

  it('round-trips photo-less, anchor-less sessions (upload-style)', async () => {
    const s = session({ anchor: null });
    s.keyframes = [];
    const back = importScan(await exportScan(s));
    expect(back.anchor).toBeNull();
    expect(back.keyframes).toEqual([]);
  });

  it('rejects non-JSON, wrong magic, wrong version, corrupt base64, truncated points', async () => {
    expect(() => importScan('not json')).toThrow(ScanDiffError);
    expect(() => importScan('{"magic":"other"}')).toThrow(ScanDiffError);
    const good = JSON.parse(await exportScan(session())) as Record<string, unknown>;
    expect(() => importScan(JSON.stringify({ ...good, version: 9 }))).toThrow(ScanDiffError);
    const badB64 = { ...good, scan: { ...(good['scan'] as object), positionsB64: '!!!' } };
    expect(() => importScan(JSON.stringify(badB64))).toThrow(ScanDiffError);
    const truncated = { ...good, scan: { ...(good['scan'] as object), pointCount: 999 } };
    expect(() => importScan(JSON.stringify(truncated))).toThrow(ScanDiffError);
  });

  it('extension filter', () => {
    expect(isExchangeFile('a.scandiff')).toBe(true);
    expect(isExchangeFile('a.SCANDIFF')).toBe(true);
    expect(isExchangeFile('a.ply')).toBe(false);
  });
});

describe('QR anchor detection adapter', () => {
  const rgbSize = { w: 100, h: 100 };
  const depthSize = { w: 50, h: 50 };
  /** flat depth field at 1.5 m */
  const flatDepth = new Float32Array(depthSize.w * depthSize.h).fill(1.5);
  const rgba = new Uint8ClampedArray(rgbSize.w * rgbSize.h * 4);

  /** a fake detector reporting a centered square code, 20 px edge */
  const fakeDetector: QrDetector = () => ({
    data: 'marker-42',
    corners: {
      topLeft: { x: 40, y: 40 },
      topRight: { x: 60, y: 40 },
      bottomRight: { x: 60, y: 60 },
      bottomLeft: { x: 40, y: 60 },
    },
  });

  it('depthAtRgbPixel maps RGB coords to depth-buffer coords with median filter', () => {
    const depth = new Float32Array(depthSize.w * depthSize.h).fill(2);
    // poison one neighbor: median should ignore it
    depth[25 * 50 + 25] = 100;
    const z = depthAtRgbPixel(50, 50, rgbSize, depth, depthSize);
    expect(z).toBe(2);
    // fully invalid neighborhood -> NaN
    const dead = new Float32Array(depthSize.w * depthSize.h).fill(0);
    expect(Number.isNaN(depthAtRgbPixel(50, 50, rgbSize, dead, depthSize))).toBe(true);
  });

  it('detects a marker and produces a plausible 6-DOF anchor', () => {
    const obs = detectAnchorInFrame(rgba, rgbSize, flatDepth, depthSize, MOCK_INTRINSICS, { matrix: identity() }, fakeDetector);
    expect(obs).not.toBeNull();
    expect(obs!.markerId).toBe('marker-42');
    // 20 px edge at 1.5 m with fx=0.8: size = (20/100)/0.8 * 1.5 = 0.375 m
    expect(obs!.sizeMeters).toBeGreaterThan(0.3);
    expect(obs!.sizeMeters).toBeLessThan(0.45);
    // marker sits ~1.5 m down -z from the camera
    expect(obs!.pose.matrix[14]).toBeLessThan(-1.3);
  });

  it('returns null when no code, bad depth, or undersized rgba', () => {
    const none: QrDetector = () => null;
    expect(detectAnchorInFrame(rgba, rgbSize, flatDepth, depthSize, MOCK_INTRINSICS, { matrix: identity() }, none)).toBeNull();
    const dead = new Float32Array(depthSize.w * depthSize.h).fill(0);
    expect(detectAnchorInFrame(rgba, rgbSize, dead, depthSize, MOCK_INTRINSICS, { matrix: identity() }, fakeDetector)).toBeNull();
    expect(detectAnchorInFrame(new Uint8ClampedArray(4), rgbSize, flatDepth, depthSize, MOCK_INTRINSICS, { matrix: identity() }, fakeDetector)).toBeNull();
  });
});
