/**
 * Pure math for the point-cloud viewer — kept DOM/three-free so vitest can
 * cover it. viewer.ts consumes these; nothing else should.
 */

export interface Bbox {
  min: [number, number, number];
  max: [number, number, number];
}

export function computeBbox(positions: Float32Array, count: number): Bbox | null {
  if (count === 0) return null;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    for (let a = 0; a < 3; a++) {
      const v = positions[3 * i + a]!;
      if (v < min[a]!) min[a] = v;
      if (v > max[a]!) max[a] = v;
    }
  }
  return { min, max };
}

export function bboxCenter(b: Bbox): [number, number, number] {
  return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
}

export function bboxDiagonal(b: Bbox): number {
  return Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
}

/**
 * Camera distance that fits a sphere of radius diagonal/2 in a camera with
 * the given vertical FOV: d = r / sin(fov/2), padded slightly so the cloud
 * doesn't touch the frame edges.
 */
export function frameDistance(diagonal: number, fovDeg: number, padding = 1.15): number {
  const r = Math.max(1e-6, diagonal / 2);
  return (r / Math.sin(((fovDeg / 2) * Math.PI) / 180)) * padding;
}

/**
 * Height-ramp vertex colors: linearly blend low->high color across the
 * cloud's own y range. Gives flat unlit points a readable depth/shape cue
 * (the single-flat-color rendering was the top visual finding in
 * docs/CRITIQUE.md). Colors are 0..1 rgb triples; output is packed rgb.
 */
export function rampColors(
  positions: Float32Array,
  count: number,
  low: [number, number, number],
  high: [number, number, number],
): Float32Array {
  const out = new Float32Array(count * 3);
  if (count === 0) return out;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (let i = 0; i < count; i++) {
    const y = positions[3 * i + 1]!;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  const span = yMax - yMin || 1;
  for (let i = 0; i < count; i++) {
    const t = (positions[3 * i + 1]! - yMin) / span;
    out[3 * i] = low[0] + (high[0] - low[0]) * t;
    out[3 * i + 1] = low[1] + (high[1] - low[1]) * t;
    out[3 * i + 2] = low[2] + (high[2] - low[2]) * t;
  }
  return out;
}

/**
 * Same ramp, but points inside any of the given boxes (with margin) keep the
 * vivid ramp while points outside are pulled toward a dim gray — the compare
 * view's "changes pop, context recedes" treatment.
 */
export function rampColorsWithEmphasis(
  positions: Float32Array,
  count: number,
  low: [number, number, number],
  high: [number, number, number],
  emphasisBoxes: Bbox[],
  marginM = 0.05,
  // context recedes into darkness (not a pale wash): near-background gray,
  // strong blend — the vivid emphasis regions carry the eye
  dimTo: [number, number, number] = [0.09, 0.11, 0.15],
  dimBlend = 0.82,
): Float32Array {
  const colors = rampColors(positions, count, low, high);
  if (emphasisBoxes.length === 0) {
    // nothing emphasized: dim everything equally (still shaped by the ramp)
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = colors[i]! + (dimTo[0] - colors[i]!) * dimBlend * 0.5;
      colors[i + 1] = colors[i + 1]! + (dimTo[1] - colors[i + 1]!) * dimBlend * 0.5;
      colors[i + 2] = colors[i + 2]! + (dimTo[2] - colors[i + 2]!) * dimBlend * 0.5;
    }
    return colors;
  }
  for (let i = 0; i < count; i++) {
    const x = positions[3 * i]!, y = positions[3 * i + 1]!, z = positions[3 * i + 2]!;
    let inside = false;
    for (const b of emphasisBoxes) {
      if (
        x >= b.min[0] - marginM && x <= b.max[0] + marginM &&
        y >= b.min[1] - marginM && y <= b.max[1] + marginM &&
        z >= b.min[2] - marginM && z <= b.max[2] + marginM
      ) {
        inside = true;
        break;
      }
    }
    if (!inside) {
      colors[3 * i] = colors[3 * i]! + (dimTo[0] - colors[3 * i]!) * dimBlend;
      colors[3 * i + 1] = colors[3 * i + 1]! + (dimTo[1] - colors[3 * i + 1]!) * dimBlend;
      colors[3 * i + 2] = colors[3 * i + 2]! + (dimTo[2] - colors[3 * i + 2]!) * dimBlend;
    }
  }
  return colors;
}
