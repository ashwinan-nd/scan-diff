import { describe, expect, it } from 'vitest';
import { sessionFromPlyBuffer, isSupportedUpload } from '../src/capture/upload';
import { comparePipeline } from '../src/pipeline';
import { diffClouds } from '../src/diff';
import { ScanDiffError } from '../src/core/types';
import { makeRng } from '../src/capture/mock';

/** Serialize a synthetic cloud as ASCII PLY. */
function plyOf(points: Array<[number, number, number]>): ArrayBuffer {
  const text =
    `ply\nformat ascii 1.0\nelement vertex ${points.length}\n` +
    `property float x\nproperty float y\nproperty float z\nend_header\n` +
    points.map((p) => p.map((v) => v.toFixed(4)).join(' ')).join('\n') + '\n';
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

/** Dense L-shaped structure (same shape family the alignment tests use). */
function structure(seed: number, extra: Array<[number, number, number]> = []): Array<[number, number, number]> {
  const rng = makeRng(seed);
  const pts: Array<[number, number, number]> = [];
  for (let i = 0; i < 6000; i++) {
    if (i % 2 === 0) pts.push([rng() * 2 - 1, rng() * 0.1, rng() * 1 - 0.5]);
    else pts.push([-1 + rng() * 0.1, rng() * 1.5, rng() * 1 - 0.5]);
  }
  return pts.concat(extra);
}

/** Solid box sample. */
function blob(min: [number, number, number], size: number, spacing = 0.02): Array<[number, number, number]> {
  const pts: Array<[number, number, number]> = [];
  for (let x = min[0]; x < min[0] + size; x += spacing)
    for (let y = min[1]; y < min[1] + size; y += spacing)
      for (let z = min[2]; z < min[2] + size; z += spacing) pts.push([x, y, z]);
  return pts;
}

describe('sessionFromPlyBuffer', () => {
  it('builds a valid keyframe-less session from a PLY buffer', () => {
    const s = sessionFromPlyBuffer(plyOf(structure(1)), 'kitchen-monday.ply');
    expect(s.label).toBe('kitchen-monday');
    expect(s.cloud.count).toBe(6000);
    expect(s.keyframes).toEqual([]);
    expect(s.anchor).toBeNull();
    expect(s.deviceInfo).toContain('file upload');
  });

  it('rejects oversized buffers with an actionable error', () => {
    // fake a byteLength beyond the cap without allocating 256MB
    const fake = { byteLength: 300 * 1024 * 1024 } as ArrayBuffer;
    expect(() => sessionFromPlyBuffer(fake, 'big.ply')).toThrow(ScanDiffError);
  });

  it('filters by extension', () => {
    expect(isSupportedUpload('scan.ply')).toBe(true);
    expect(isSupportedUpload('scan.PLY')).toBe(true);
    expect(isSupportedUpload('scan.obj')).toBe(false);
  });
});

describe('keyframe-less sessions through the diff layer', () => {
  it('zero keyframes disables frustum gating instead of suppressing all changes', () => {
    const base = structure(3);
    const withBlob = structure(3, blob([0.5, 0.5, 0.5], 0.3));
    const a = sessionFromPlyBuffer(plyOf(base), 'a.ply');
    const b = sessionFromPlyBuffer(plyOf(withBlob), 'b.ply');
    const res = diffClouds(a.cloud, b.cloud, [], []);
    expect(res.regions.length).toBe(1);
    expect(res.regions[0]!.kind).toBe('added');
    expect(res.coverageBofA).toBeGreaterThan(0.95);
  });

  it('full pipeline: two uploads, injected change, yaw-search alignment', () => {
    // second upload expressed in a rotated+translated frame, plus one added blob
    const base = structure(5);
    const added = blob([0.4, 0.6, 0.2], 0.3);
    const yaw = (25 * Math.PI) / 180;
    const rot = (p: [number, number, number]): [number, number, number] => [
      Math.cos(yaw) * p[0] + Math.sin(yaw) * p[2] + 0.4,
      p[1] + 0.05,
      -Math.sin(yaw) * p[0] + Math.cos(yaw) * p[2] - 0.3,
    ];
    const scanA = sessionFromPlyBuffer(plyOf(base), 'before.ply');
    const scanB = sessionFromPlyBuffer(plyOf(base.concat(added).map(rot)), 'after.ply');
    const res = comparePipeline(scanA, scanB);
    expect(res.alignmentMethod).toBe('yaw-search');
    expect(res.quality.verdict).not.toBe('poor');
    const kinds = res.diff.regions.map((r) => r.kind);
    expect(kinds).toContain('added');
    // report renders without photos (geometry evidence path)
    expect(res.report.regions.length).toBe(res.diff.regions.length);
  }, 30000);
});
