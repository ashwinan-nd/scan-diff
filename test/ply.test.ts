import { describe, expect, it } from 'vitest';
import { parsePly } from '../src/capture/ply';
import { ScanDiffError } from '../src/core/types';

const enc = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer as ArrayBuffer;

function asciiPly(points: Array<[number, number, number]>, extra = ''): string {
  return (
    `ply\nformat ascii 1.0\n${extra}element vertex ${points.length}\n` +
    `property float x\nproperty float y\nproperty float z\nend_header\n` +
    points.map((p) => p.join(' ')).join('\n') + '\n'
  );
}

function manyPoints(n: number): Array<[number, number, number]> {
  const pts: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i++) pts.push([i * 0.01, (i % 7) * 0.02, (i % 5) * 0.03]);
  return pts;
}

describe('parsePly: ASCII', () => {
  it('parses a minimal valid ASCII point cloud', () => {
    const pts = manyPoints(150);
    const { positions, count } = parsePly(enc(asciiPly(pts)));
    expect(count).toBe(150);
    expect(positions[0]).toBeCloseTo(0, 6);
    expect(positions[3]).toBeCloseTo(0.01, 6);
    expect(positions[4]).toBeCloseTo(0.02, 6);
  });

  it('skips a face element that follows vertices', () => {
    const pts = manyPoints(120);
    const header =
      `ply\nformat ascii 1.0\nelement vertex ${pts.length}\n` +
      `property float x\nproperty float y\nproperty float z\n` +
      `element face 2\nproperty list uchar int vertex_indices\nend_header\n`;
    const body = pts.map((p) => p.join(' ')).join('\n') + '\n3 0 1 2\n3 1 2 3\n';
    const { count } = parsePly(enc(header + body));
    expect(count).toBe(120);
  });

  it('ignores comment and obj_info lines', () => {
    const pts = manyPoints(110);
    const { count } = parsePly(enc(asciiPly(pts, 'comment made by test\nobj_info scanner v1\n')));
    expect(count).toBe(110);
  });

  it('handles extra vertex properties (normals, color) positioned around xyz', () => {
    const n = 130;
    const header =
      `ply\nformat ascii 1.0\nelement vertex ${n}\n` +
      `property float nx\nproperty float x\nproperty float y\nproperty float z\n` +
      `property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n`;
    const rows: string[] = [];
    for (let i = 0; i < n; i++) rows.push(`0.1 ${i * 0.001} ${i * 0.002} ${i * 0.003} 255 0 0`);
    const { positions, count } = parsePly(enc(header + rows.join('\n') + '\n'));
    expect(count).toBe(n);
    expect(positions[0]).toBeCloseTo(0, 6);
    expect(positions[1]).toBeCloseTo(0, 6);
  });

  it('rejects fewer than 100 points', () => {
    expect(() => parsePly(enc(asciiPly(manyPoints(50))))).toThrow(ScanDiffError);
  });

  it('rejects malformed rows and truncated data', () => {
    // corrupt one known row: point 50 of manyPoints is "0.5 0.02 0"
    const lines = asciiPly(manyPoints(101)).split('\n');
    const bodyStart = lines.indexOf('end_header') + 1;
    lines[bodyStart + 50] = 'garbage row here';
    expect(() => parsePly(enc(lines.join('\n')))).toThrow(ScanDiffError);

    const truncated = asciiPly(manyPoints(150)).split('\n').slice(0, -50).join('\n');
    expect(() => parsePly(enc(truncated))).toThrow(ScanDiffError);
  });

  it('rejects missing end_header, missing format, missing vertex element', () => {
    expect(() => parsePly(enc('ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\n'))).toThrow(ScanDiffError);
    expect(() => parsePly(enc('ply\nelement vertex 1\nproperty float x\nend_header\n0 0 0\n'))).toThrow(ScanDiffError);
    expect(() => parsePly(enc('ply\nformat ascii 1.0\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n3 0 1 2\n'))).toThrow(ScanDiffError);
  });

  it('rejects a vertex element missing x/y/z', () => {
    const bad = 'ply\nformat ascii 1.0\nelement vertex 100\nproperty float x\nproperty float y\nend_header\n' + '0 0\n'.repeat(100);
    expect(() => parsePly(enc(bad))).toThrow(ScanDiffError);
  });

  it('sanitizes NaN/Infinity rows rather than crashing', () => {
    // NaN comes from a non-numeric token in an otherwise well-formed row count;
    // parser treats "nan"/"inf" as literal tokens Number() can produce here,
    // so drop rows that fail finiteness rather than reject the whole file.
    const n = 120;
    const rows: string[] = [];
    for (let i = 0; i < n; i++) rows.push(i === 5 ? 'NaN 0 0' : `${i * 0.01} 0 0`);
    const header = `ply\nformat ascii 1.0\nelement vertex ${n}\nproperty float x\nproperty float y\nproperty float z\nend_header\n`;
    const { count } = parsePly(enc(header + rows.join('\n') + '\n'));
    expect(count).toBe(n - 1);
  });
});

describe('parsePly: binary', () => {
  function binaryPly(points: Array<[number, number, number]>, littleEndian: boolean): ArrayBuffer {
    const format = littleEndian ? 'binary_little_endian' : 'binary_big_endian';
    const header = `ply\nformat ${format} 1.0\nelement vertex ${points.length}\nproperty float x\nproperty float y\nproperty float z\nend_header\n`;
    const headerBytes = new TextEncoder().encode(header);
    const body = new ArrayBuffer(points.length * 12);
    const view = new DataView(body);
    points.forEach((p, i) => {
      view.setFloat32(i * 12, p[0], littleEndian);
      view.setFloat32(i * 12 + 4, p[1], littleEndian);
      view.setFloat32(i * 12 + 8, p[2], littleEndian);
    });
    const out = new Uint8Array(headerBytes.length + body.byteLength);
    out.set(headerBytes, 0);
    out.set(new Uint8Array(body), headerBytes.length);
    return out.buffer;
  }

  it('parses binary_little_endian', () => {
    const pts = manyPoints(200);
    const { positions, count } = parsePly(binaryPly(pts, true));
    expect(count).toBe(200);
    expect(positions[3]).toBeCloseTo(0.01, 5);
  });

  it('parses binary_big_endian', () => {
    const pts = manyPoints(180);
    const { positions, count } = parsePly(binaryPly(pts, false));
    expect(count).toBe(180);
    expect(positions[6]).toBeCloseTo(0.02, 5);
  });

  it('rejects truncated binary payloads', () => {
    const full = binaryPly(manyPoints(150), true);
    const truncated = full.slice(0, full.byteLength - 100);
    expect(() => parsePly(truncated)).toThrow(ScanDiffError);
  });

  it('rejects a list property preceding the vertex element in binary', () => {
    const header = `ply\nformat binary_little_endian 1.0\nelement face 1\nproperty list uchar int vertex_indices\nelement vertex 100\nproperty float x\nproperty float y\nproperty float z\nend_header\n`;
    const headerBytes = new TextEncoder().encode(header);
    const out = new Uint8Array(headerBytes.length + 4 + 100 * 12);
    out.set(headerBytes, 0);
    expect(() => parsePly(out.buffer)).toThrow(ScanDiffError);
  });
});
