import { describe, expect, it } from 'vitest';
import { projectRegionBox, bestKeyframeFor } from '../src/report/project';
import { extentString, regionSentence, volumeString, writtenSummary } from '../src/report/summary';
import { buildReportModel } from '../src/report/model';
import { renderReportHtml } from '../src/report/html';
import type { AlignmentQuality, ChangeRegion, Keyframe, ScanSession } from '../src/core/types';
import { fromYawTranslation, identity } from '../src/core/mat4';
import { MOCK_INTRINSICS } from '../src/capture/mock';
import type { DiffResult } from '../src/diff';

const kfAt = (id: number, yaw: number, at: [number, number, number]): Keyframe => ({
  id,
  pose: { matrix: fromYawTranslation(yaw, at) },
  intrinsics: MOCK_INTRINSICS,
  imageSize: { w: 160, h: 120 },
  timestamp: id,
});

const region = (over: Partial<ChangeRegion> = {}): ChangeRegion => ({
  kind: 'added',
  voxelCount: 40,
  volumeM3: 0.005,
  bboxMin: [-0.2, 0, -1.2],
  bboxMax: [0.2, 0.3, -0.8],
  centroid: [0, 0.15, -1],
  confidence: 0.8,
  ...over,
});

const QUALITY: AlignmentQuality = {
  rmse: 0.012, overlapRatio: 0.85, iterations: 20, converged: true, verdict: 'good',
};

describe('projectRegionBox / bestKeyframeFor', () => {
  it('projects a front-facing region into a sane in-frame box', () => {
    const kf = kfAt(0, 0, [0, 0.15, 0]); // looking down -z at the region
    const box = projectRegionBox(region(), kf);
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.w).toBeLessThanOrEqual(160);
    expect(box!.y + box!.h).toBeLessThanOrEqual(120);
    expect(box!.w).toBeGreaterThan(10);
  });

  it('returns null for a region behind the camera', () => {
    const kf = kfAt(0, 0, [0, 0.15, -5]); // region is BEHIND (camera looks -z, region at z=-1 > -5... actually in front)
    // put the camera past the region so it is behind
    const kf2 = kfAt(1, 0, [0, 0.15, -3]);
    expect(projectRegionBox(region(), kf2)).toBeNull();
    void kf;
  });

  it('bestKeyframeFor prefers the direct view', () => {
    const facing = kfAt(0, 0, [0, 0.15, 0]);       // direct
    const sideways = kfAt(1, Math.PI / 2, [0, 0.15, 0]); // 90° off — region out of view
    const best = bestKeyframeFor(region(), [sideways, facing]);
    expect(best!.id).toBe(0);
  });

  it('returns null when nothing sees the region', () => {
    // camera past the region looking away from it (down -z from z=-3; region at z=-1 is behind)
    expect(bestKeyframeFor(region(), [kfAt(0, 0, [0, 0, -3])])).toBeNull();
  });
});

describe('summary text', () => {
  it('extent string sorts extents descending', () => {
    expect(extentString(region())).toBe('0.40 × 0.40 × 0.30 m');
  });

  it('volume string floors below a milliliter of a cubic meter', () => {
    expect(volumeString(region({ volumeM3: 0.0004 }))).toBe('<0.001 m³');
    expect(volumeString(region())).toBe('≈0.005 m³');
  });

  it('region sentences name kind and cross-link shifted partners', () => {
    expect(regionSentence(region(), 0)).toContain('New material');
    expect(regionSentence(region({ kind: 'removed' }), 1)).toContain('gone in the second');
    expect(regionSentence(region({ kind: 'shifted', shiftPartner: 0 }), 1)).toContain('region 1');
  });

  it('summary counts kinds, discloses coverage gaps and resolution', () => {
    const s = writtenSummary({
      regions: [region(), region({ kind: 'removed' })],
      quality: QUALITY,
      coverageBofA: 0.6,
      coverageAofB: 0.95,
      voxelSizeM: 0.05,
    });
    expect(s).toContain('2 changed regions detected: 1 addition, 1 removal.');
    expect(s).toContain('60% of previously scanned space was re-observed');
    expect(s).toContain('5 cm voxels');
    expect(s).toContain('Alignment: good');
  });

  it('empty diff reads as a clean match', () => {
    const s = writtenSummary({
      regions: [], quality: QUALITY, coverageBofA: 0.99, coverageAofB: 0.99, voxelSizeM: 0.05,
    });
    expect(s).toContain('No geometric changes detected');
  });
});

describe('report model + html', () => {
  const session = (label: string): ScanSession => ({
    id: label,
    label,
    createdAt: 1751700000000,
    cloud: { positions: new Float32Array(300), count: 100 },
    keyframes: [kfAt(0, 0, [0, 0.15, 0])],
    anchor: null,
    deviceInfo: 'test-device',
    version: 1,
  });

  const diff: DiffResult = {
    regions: [region(), region({ kind: 'removed', centroid: [0.1, 0.1, -1.1] })],
    voxelSizeM: 0.05,
    coverageBofA: 0.93,
    coverageAofB: 0.97,
    addedVoxels: 40,
    removedVoxels: 38,
  };

  it('model carries every region with a sentence and evidence attempts', () => {
    const model = buildReportModel(session('first'), session('second'), diff, QUALITY, 'marker', session('second').keyframes);
    expect(model.regions.length).toBe(2);
    expect(model.regions[0]!.sentence).toContain('Region 1');
    expect(model.regions[0]!.evidence.before).not.toBeNull();
    expect(model.title).toContain('first');
  });

  it('html contains every region, summary, metadata, and no external requests', () => {
    const model = buildReportModel(session('first'), session('second'), diff, QUALITY, 'marker', session('second').keyframes);
    const html = renderReportHtml(model, { scanA: new Map(), scanB: new Map() });
    expect(html).toContain('Region 1');
    expect(html).toContain('Region 2');
    expect(html).toContain('Summary');
    expect(html).toContain('test-device');
    expect(html).toContain('@media print');
    // self-contained: no http(s) fetches anywhere
    expect(html).not.toMatch(/src="http/);
    expect(html).not.toMatch(/href="http/);
    expect(html).not.toMatch(/@import/);
  });

  it('escapes hostile labels', () => {
    const evil = session('<script>alert(1)</script>');
    const model = buildReportModel(evil, session('b'), diff, QUALITY, 'marker', []);
    const html = renderReportHtml(model, { scanA: new Map(), scanB: new Map() });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders photo evidence with overlay when a photo exists', () => {
    const model = buildReportModel(session('a'), session('b'), diff, QUALITY, 'marker', session('b').keyframes);
    const photos = {
      scanA: new Map([[0, 'data:image/jpeg;base64,AAAA']]),
      scanB: new Map([[0, 'data:image/jpeg;base64,BBBB']]),
    };
    const html = renderReportHtml(model, photos);
    expect(html).toContain('data:image/jpeg;base64,AAAA');
    expect(html).toContain('<rect');
  });

  it('carries its own identity and hierarchy: masthead, wordmark, stat band, meters', () => {
    const model = buildReportModel(session('a'), session('b'), diff, QUALITY, 'marker', session('b').keyframes);
    const html = renderReportHtml(model, { scanA: new Map(), scanB: new Map() });
    expect(html).toContain('class="masthead"');
    expect(html).toContain('scan-diff');
    expect(html).toContain('Change report');
    expect(html).toContain('class="statband"');
    expect(html).toContain('class="meter-fill"');
    // largest region gets the full-width volume bar
    expect(html).toContain('width:100%');
  });

  it('photo-less evidence renders an informative footprint map, not an empty box', () => {
    const model = buildReportModel(session('a'), session('b'), diff, QUALITY, 'marker', session('b').keyframes);
    const html = renderReportHtml(model, { scanA: new Map(), scanB: new Map() });
    expect(html).toContain('class="ev-map"');
    expect(html).toContain('location map (no photo captured)');
    expect(html).toContain('scan origin');
    // one solid + ghosted rects per region pair; at minimum the solid fill exists
    expect(html).toContain('fill-opacity="0.55"');
  });

  it('zero-region report renders the clean-match message', () => {
    const empty: DiffResult = { ...diff, regions: [], addedVoxels: 0, removedVoxels: 0 };
    const model = buildReportModel(session('a'), session('b'), empty, QUALITY, 'yaw-search', []);
    const html = renderReportHtml(model, { scanA: new Map(), scanB: new Map() });
    expect(html).toContain('The scans match');
  });
});
