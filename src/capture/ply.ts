/**
 * PLY point-cloud parser (ASCII + binary_little_endian + binary_big_endian).
 * This is the upload path: consumer LiDAR-scanning apps (3D Scanner App,
 * Polycam, Scaniverse — all ARKit-based on iOS, hence y-up like WebXR,
 * ARCHITECTURE.md §2 convention) export PLY point clouds. Uploading one lets
 * any device — including iOS, which has no WebXR — produce a real
 * ScanSession today, without waiting on hardware this environment doesn't have.
 *
 * Only the vertex element's x/y/z is extracted. Faces and any other element
 * are skipped, not parsed into geometry (point clouds have no faces; scans
 * that include a mesh are still diffed on their vertex positions only).
 */

import { ScanDiffError } from '../core/types';

type PlyFormat = 'ascii' | 'binary_little_endian' | 'binary_big_endian';

const TYPE_SIZES: Record<string, number> = {
  char: 1, int8: 1, uchar: 1, uint8: 1,
  short: 2, int16: 2, ushort: 2, uint16: 2,
  int: 4, int32: 4, uint: 4, uint32: 4,
  float: 4, float32: 4,
  double: 8, float64: 8,
};

interface PlyProperty {
  name: string;
  type: string;
  isList: boolean;
  countType?: string;
  itemType?: string;
}

interface PlyElement {
  name: string;
  count: number;
  properties: PlyProperty[];
}

function rowByteSize(props: PlyProperty[]): number {
  let n = 0;
  for (const p of props) {
    if (p.isList) throw new ScanDiffError('bad-input', 'PLY: list properties before the vertex element are not supported in binary files.');
    const size = TYPE_SIZES[p.type];
    if (size === undefined) throw new ScanDiffError('bad-input', `PLY: unknown property type "${p.type}".`);
    n += size;
  }
  return n;
}

function parseHeader(bytes: Uint8Array): { elements: PlyElement[]; format: PlyFormat; headerByteLength: number } {
  // header is always plain ASCII, terminated by a line "end_header\n"
  const decoder = new TextDecoder('ascii');
  const marker = 'end_header';
  let headerText = '';
  let end = -1;
  // decode incrementally to avoid pulling a huge binary payload through TextDecoder
  const probeLen = Math.min(bytes.length, 65536);
  headerText = decoder.decode(bytes.subarray(0, probeLen));
  const markerIdx = headerText.indexOf(marker);
  if (markerIdx === -1) {
    throw new ScanDiffError('bad-input', 'PLY: missing "end_header" — not a valid PLY file or header exceeds 64 KB.');
  }
  const newlineAfter = headerText.indexOf('\n', markerIdx);
  end = newlineAfter === -1 ? markerIdx + marker.length : newlineAfter + 1;
  headerText = headerText.slice(0, end);

  const lines = headerText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines[0] !== 'ply') {
    throw new ScanDiffError('bad-input', 'PLY: file does not start with "ply" magic line.');
  }
  let format: PlyFormat | null = null;
  const elements: PlyElement[] = [];
  let current: PlyElement | null = null;

  for (const line of lines.slice(1)) {
    const parts = line.split(/\s+/);
    if (parts[0] === 'comment' || parts[0] === 'obj_info') continue;
    if (parts[0] === 'format') {
      const f = parts[1];
      if (f !== 'ascii' && f !== 'binary_little_endian' && f !== 'binary_big_endian') {
        throw new ScanDiffError('bad-input', `PLY: unsupported format "${f ?? ''}".`);
      }
      format = f;
      continue;
    }
    if (parts[0] === 'element') {
      const name = parts[1];
      const count = Number(parts[2]);
      if (!name || !Number.isFinite(count) || count < 0) {
        throw new ScanDiffError('bad-input', `PLY: malformed element declaration "${line}".`);
      }
      current = { name, count, properties: [] };
      elements.push(current);
      continue;
    }
    if (parts[0] === 'property') {
      if (!current) throw new ScanDiffError('bad-input', 'PLY: property declared before any element.');
      if (parts[1] === 'list') {
        current.properties.push({
          name: parts[4] ?? '', type: 'list', isList: true, countType: parts[2], itemType: parts[3],
        });
      } else {
        current.properties.push({ name: parts[2] ?? '', type: parts[1] ?? '', isList: false });
      }
      continue;
    }
    if (parts[0] === 'end_header') break;
  }

  if (!format) throw new ScanDiffError('bad-input', 'PLY: missing "format" line.');
  return { elements, format, headerByteLength: end };
}

function findVertexElement(elements: PlyElement[]): { element: PlyElement; index: number } {
  const idx = elements.findIndex((e) => e.name === 'vertex');
  if (idx === -1) throw new ScanDiffError('bad-input', 'PLY: no "vertex" element found.');
  const el = elements[idx]!;
  const hasXyz = ['x', 'y', 'z'].every((n) => el.properties.some((p) => p.name === n));
  if (!hasXyz) throw new ScanDiffError('bad-input', 'PLY: vertex element is missing x/y/z properties.');
  return { element: el, index: idx };
}

const NUMERIC_TOKEN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const NON_FINITE_TOKEN = /^[+-]?(?:nan|inf|infinity)$/i;

/**
 * Classify one whitespace-split token. Recognized non-finite spellings
 * ("nan", "inf") parse to NaN and are dropped later by parsePly's sanitize
 * pass (real scanner exports occasionally emit these for invalid depth) —
 * distinct from a genuinely unparseable token, which is real corruption and
 * must fail the whole row instead of silently producing garbage geometry.
 */
function parseCoordToken(tok: string | undefined, row: number, raw: string): number {
  if (tok !== undefined && NUMERIC_TOKEN.test(tok)) return Number(tok);
  if (tok !== undefined && NON_FINITE_TOKEN.test(tok)) return NaN;
  throw new ScanDiffError('bad-input', `PLY: malformed vertex row ${row} ("${raw}").`);
}

function parseAsciiBody(text: string, elements: PlyElement[], vertexIndex: number, vertexEl: PlyElement): Float32Array {
  const lines = text.split(/\r?\n/);
  let li = 0;
  // walk elements in order; only vertex needs actual parsing
  const positions = new Float32Array(vertexEl.count * 3);
  const xi = vertexEl.properties.findIndex((p) => p.name === 'x');
  const yi = vertexEl.properties.findIndex((p) => p.name === 'y');
  const zi = vertexEl.properties.findIndex((p) => p.name === 'z');

  for (let e = 0; e < elements.length; e++) {
    const el = elements[e]!;
    if (e !== vertexIndex) {
      // skip: one non-empty line per instance regardless of list properties
      let skipped = 0;
      while (skipped < el.count && li < lines.length) {
        if (lines[li]!.trim().length > 0) skipped++;
        li++;
      }
      continue;
    }
    let read = 0;
    while (read < el.count && li < lines.length) {
      const raw = lines[li]!;
      li++;
      if (raw.trim().length === 0) continue;
      const toks = raw.trim().split(/\s+/);
      positions[3 * read] = parseCoordToken(toks[xi], read, raw);
      positions[3 * read + 1] = parseCoordToken(toks[yi], read, raw);
      positions[3 * read + 2] = parseCoordToken(toks[zi], read, raw);
      read++;
    }
    if (read < el.count) {
      throw new ScanDiffError('bad-input', `PLY: expected ${el.count} vertices, found ${read}.`);
    }
  }
  return positions;
}

function parseBinaryBody(
  data: DataView,
  offset: number,
  elements: PlyElement[],
  vertexIndex: number,
  vertexEl: PlyElement,
  littleEndian: boolean,
): Float32Array {
  let cursor = offset;
  // skip any elements preceding vertex (throws if they contain list properties)
  for (let e = 0; e < vertexIndex; e++) {
    cursor += rowByteSize(elements[e]!.properties) * elements[e]!.count;
  }

  const xi = vertexEl.properties.findIndex((p) => p.name === 'x');
  const yi = vertexEl.properties.findIndex((p) => p.name === 'y');
  const zi = vertexEl.properties.findIndex((p) => p.name === 'z');
  if (vertexEl.properties.some((p) => p.isList)) {
    throw new ScanDiffError('bad-input', 'PLY: list properties on the vertex element are not supported.');
  }
  const offsets: number[] = [];
  {
    let acc = 0;
    for (const p of vertexEl.properties) {
      offsets.push(acc);
      acc += TYPE_SIZES[p.type] ?? 0;
    }
  }
  const rowSize = rowByteSize(vertexEl.properties);
  const readers: Record<string, (o: number) => number> = {
    char: (o) => data.getInt8(o), int8: (o) => data.getInt8(o),
    uchar: (o) => data.getUint8(o), uint8: (o) => data.getUint8(o),
    short: (o) => data.getInt16(o, littleEndian), int16: (o) => data.getInt16(o, littleEndian),
    ushort: (o) => data.getUint16(o, littleEndian), uint16: (o) => data.getUint16(o, littleEndian),
    int: (o) => data.getInt32(o, littleEndian), int32: (o) => data.getInt32(o, littleEndian),
    uint: (o) => data.getUint32(o, littleEndian), uint32: (o) => data.getUint32(o, littleEndian),
    float: (o) => data.getFloat32(o, littleEndian), float32: (o) => data.getFloat32(o, littleEndian),
    double: (o) => data.getFloat64(o, littleEndian), float64: (o) => data.getFloat64(o, littleEndian),
  };
  const xType = vertexEl.properties[xi]!.type, yType = vertexEl.properties[yi]!.type, zType = vertexEl.properties[zi]!.type;
  const needed = cursor + rowSize * vertexEl.count;
  if (needed > data.byteLength) {
    throw new ScanDiffError('bad-input', `PLY: file truncated — need ${needed} bytes, have ${data.byteLength}.`);
  }

  const positions = new Float32Array(vertexEl.count * 3);
  for (let i = 0; i < vertexEl.count; i++) {
    const rowStart = cursor + i * rowSize;
    positions[3 * i] = readers[xType]!(rowStart + offsets[xi]!);
    positions[3 * i + 1] = readers[yType]!(rowStart + offsets[yi]!);
    positions[3 * i + 2] = readers[zType]!(rowStart + offsets[zi]!);
  }
  return positions;
}

export interface ParsedPointCloud {
  positions: Float32Array;
  count: number;
}

/** Parse a .ply file (ArrayBuffer) into a packed xyz point cloud. */
export function parsePly(buffer: ArrayBuffer): ParsedPointCloud {
  const bytes = new Uint8Array(buffer);
  const { elements, format, headerByteLength } = parseHeader(bytes);
  const { element: vertexEl, index: vertexIndex } = findVertexElement(elements);
  if (vertexEl.count === 0) {
    throw new ScanDiffError('bad-input', 'PLY: vertex element has zero points.');
  }

  let positions: Float32Array;
  if (format === 'ascii') {
    const text = new TextDecoder('utf-8').decode(bytes.subarray(headerByteLength));
    positions = parseAsciiBody(text, elements, vertexIndex, vertexEl);
  } else {
    const dataView = new DataView(buffer, headerByteLength);
    positions = parseBinaryBody(dataView, 0, elements, vertexIndex, vertexEl, format === 'binary_little_endian');
  }

  // sanitize: drop NaN/Infinity rows defensively (malformed exports happen)
  let clean = positions;
  let cleanCount = vertexEl.count;
  let hasBad = false;
  for (let i = 0; i < positions.length; i++) {
    if (!Number.isFinite(positions[i]!)) { hasBad = true; break; }
  }
  if (hasBad) {
    const kept: number[] = [];
    for (let i = 0; i < vertexEl.count; i++) {
      const x = positions[3 * i]!, y = positions[3 * i + 1]!, z = positions[3 * i + 2]!;
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) kept.push(x, y, z);
    }
    clean = new Float32Array(kept);
    cleanCount = kept.length / 3;
  }

  if (cleanCount < 100) {
    throw new ScanDiffError('bad-input', `PLY: only ${cleanCount} usable points (need >= 100).`);
  }
  return { positions: clean, count: cleanCount };
}
