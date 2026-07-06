/**
 * Cross-scenario genericness harness (ARCHITECTURE.md §12).
 * The SAME comparePipeline call, zero code/config difference besides inputs,
 * against two structurally different scenario families:
 *   1. enclosure: interior scanned from inside (concave, pan trajectory)
 *   2. subject:   free-standing body orbited from outside (convex, orbit)
 * Every injected change must be found with correct kind and location; the
 * unchanged control run must report zero regions. Plus: a vocabulary sweep
 * proving no vertical-specific nouns exist anywhere in src/.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { comparePipeline } from '../src/pipeline';
import { renderReportHtml } from '../src/report/html';
import { MockCaptureSource } from '../src/capture/mock';
import { ScanSessionBuilder } from '../src/capture/session';
import { anchorFromCorners, type CornerSample } from '../src/capture/anchor';
import type { Pose, ScanSession } from '../src/core/types';
import { ScanDiffError } from '../src/core/types';
import { identity } from '../src/core/mat4';
import {
  box, enclosureScene, orbitTrajectory, panTrajectory, subjectScene,
} from './fixtures/synthetic';
import type { SyntheticScene } from '../src/capture/mock';

/** Capture a synthetic scene into a real ScanSession through the actual capture stack. */
async function capture(
  scene: SyntheticScene,
  trajectory: Pose[],
  id: string,
  opts: { noise?: number; seed?: number; anchor?: boolean } = {},
): Promise<ScanSession> {
  // density matters: real ARCore delivers ~10^5-10^6 points per scan; the
  // occupancy floor (3 pts/voxel) assumes that. 96x72 at stride 1 over 24
  // frames ≈ 165k points — realistic, and sparse captures ghost-flag (found
  // the hard way; see RESUME.md entry 5).
  const source = new MockCaptureSource({
    scene,
    trajectory,
    depthSize: { w: 96, h: 72 },
    noiseSigmaM: opts.noise ?? 0.005,
    seed: opts.seed ?? 42,
  });
  const builder = new ScanSessionBuilder({ unproject: { stride: 1 } });
  for await (const frame of source.start()) builder.addFrame(frame);
  if (opts.anchor !== false) {
    // both sessions observe the same physical marker; identical world pose in
    // this fixture because the mock trajectories share a world frame
    const size = { w: 64, h: 48 };
    const mk = (u: number, v: number): CornerSample => ({ u, v, depthM: 1.5 });
    const obs = anchorFromCorners(
      [mk(28, 20), mk(36, 20), mk(36, 28), mk(28, 28)],
      size,
      { fx: 0.8, fy: 1.0667, cx: 0.5, cy: 0.5 },
      { matrix: identity() },
      'shared-marker',
    );
    if (obs) builder.addAnchorObservation(obs);
  }
  return builder.build(id, id, 'mock-device');
}

describe('genericness: enclosure scenario (interior, pan)', () => {
  it('finds injected addition + removal, zero false positives, report complete', async () => {
    const removable = box([-1.5, 0, -1.2], [-1.1, 0.5, -0.8]); // present only in scan A
    const added = box([0.8, 0, 0.6], [1.2, 0.4, 1.0]);          // present only in scan B

    const sceneA = enclosureScene([removable]);
    const sceneB = enclosureScene([added]);
    const scanA = await capture(sceneA, panTrajectory([0, 1.4, 0], 24), 'baseline', { seed: 1 });
    const scanB = await capture(sceneB, panTrajectory([0.1, 1.35, 0.1], 24), 'rescan', { seed: 2 });

    const res = comparePipeline(scanA, scanB);
    expect(res.quality.verdict).not.toBe('poor');

    const kinds = res.diff.regions.map((r) => r.kind).sort();
    expect(kinds).toEqual(['added', 'removed']);

    const addedRegion = res.diff.regions.find((r) => r.kind === 'added')!;
    expect(addedRegion.centroid[0]).toBeGreaterThan(0.6);
    expect(addedRegion.centroid[2]).toBeGreaterThan(0.4);
    const removedRegion = res.diff.regions.find((r) => r.kind === 'removed')!;
    expect(removedRegion.centroid[0]).toBeLessThan(-0.9);
    expect(removedRegion.centroid[2]).toBeLessThan(-0.6);

    const html = renderReportHtml(res.report, { scanA: new Map(), scanB: new Map() });
    expect(html).toContain('Region 1');
    expect(html).toContain('Region 2');
  }, 30000);

  it('control: unchanged scene reports zero regions', async () => {
    const scene = enclosureScene([box([0.5, 0, 0.5], [0.9, 0.6, 0.9])]);
    const scanA = await capture(scene, panTrajectory([0, 1.4, 0], 24), 'a', { seed: 3 });
    const scanB = await capture(scene, panTrajectory([-0.1, 1.45, 0.05], 24), 'b', { seed: 4 });
    const res = comparePipeline(scanA, scanB);
    expect(res.diff.regions).toEqual([]);
  }, 30000);
});

describe('genericness: subject scenario (exterior, orbit)', () => {
  it('finds an attached addition and a detached removal on a free-standing body', async () => {
    const attachment = box([0.9, 0.3, -0.2], [1.05, 0.6, 0.2]);  // added onto the body's +x face
    const nearby = box([-1.6, 0, -1.6], [-1.2, 0.35, -1.2]);     // removed free-standing block

    const sceneA = subjectScene([nearby]);
    const sceneB = subjectScene([attachment]);
    const scanA = await capture(sceneA, orbitTrajectory([0, 0.6, 0], 3, 1.0, 24), 'intake', { seed: 5 });
    const scanB = await capture(sceneB, orbitTrajectory([0, 0.6, 0], 3.1, 1.05, 24), 'pickup', { seed: 6 });

    const res = comparePipeline(scanA, scanB);
    expect(res.quality.verdict).not.toBe('poor');
    const kinds = res.diff.regions.map((r) => r.kind).sort();
    expect(kinds).toEqual(['added', 'removed']);

    const addedRegion = res.diff.regions.find((r) => r.kind === 'added')!;
    expect(addedRegion.centroid[0]).toBeGreaterThan(0.7); // on the +x face
    const removedRegion = res.diff.regions.find((r) => r.kind === 'removed')!;
    expect(removedRegion.centroid[0]).toBeLessThan(-1.0);
  }, 30000);

  it('shifted object on the ground is classified as moved with linked partners', async () => {
    const blockA = box([1.6, 0, 1.6], [2.0, 0.4, 2.0]);
    const blockB = box([-2.0, 0, 1.6], [-1.6, 0.4, 2.0]); // same block, other side
    const scanA = await capture(subjectScene([blockA]), orbitTrajectory([0, 0.6, 0], 3.2, 1.0, 24), 'a', { seed: 7 });
    const scanB = await capture(subjectScene([blockB]), orbitTrajectory([0, 0.6, 0], 3.2, 1.0, 24), 'b', { seed: 8 });
    // the block moved 3.6 m — beyond the default 2 m pairing radius, so the
    // caller opts into a wider search (documented tunable, not a code change)
    const res = comparePipeline(scanA, scanB, { diff: { shiftMaxDistanceM: 5 } });
    const shifted = res.diff.regions.filter((r) => r.kind === 'shifted');
    expect(shifted.length).toBe(2);
    expect(shifted[0]!.shiftPartner).toBeDefined();
  }, 30000);
});

describe('pipeline failure modes', () => {
  it('refuses to diff unalignable scans with an actionable error', async () => {
    // two disjoint scenes with no marker: nothing to align
    const scanA = await capture(enclosureScene(), panTrajectory([0, 1.4, 0], 12), 'a', { seed: 9, anchor: false });
    const far = subjectScene();
    const scanB = await capture(far, orbitTrajectory([0, 0.6, 0], 3, 1, 12), 'b', { seed: 10, anchor: false });
    let threw: unknown = null;
    try {
      comparePipeline(scanA, scanB);
    } catch (e) {
      threw = e;
    }
    // either alignment is poor (usual) or, if by luck it aligns, regions exist;
    // the guarantee under test: NO silent empty "all clear" report
    if (threw) {
      expect(threw).toBeInstanceOf(ScanDiffError);
      expect((threw as ScanDiffError).reason).toBe('alignment-poor');
      expect((threw as ScanDiffError).message).toContain('marker');
    } else {
      throw new Error('expected alignment-poor rejection for disjoint scans');
    }
  }, 30000);

  it('rejects sub-100-point scans', () => {
    const tiny: ScanSession = {
      id: 't', label: 't', createdAt: 0,
      cloud: { positions: new Float32Array(30), count: 10 },
      keyframes: [], anchor: null, deviceInfo: 'x', version: 1,
    };
    expect(() => comparePipeline(tiny, tiny)).toThrow(ScanDiffError);
  });
});

describe('genericness: vocabulary sweep', () => {
  it('src/ contains no vertical-specific nouns', () => {
    // vertical-specific nouns; phrased to avoid common-English collisions
    // ("by construction", "accident" vs the insurance sense, etc.)
    const banned = [
      'room', 'apartment', 'rental', 'tenant', 'landlord',
      'vehicle', ' car ', 'dent', 'scratch',
      'furniture', 'couch', 'construction site', 'construction progress',
      'insurance', 'damage', 'claim', 'inspection',
    ];
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts') && !p.endsWith('.d.ts')) files.push(p);
      }
    };
    walk(join(__dirname, '..', 'src'));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const text = readFileSync(f, 'utf8').toLowerCase();
      for (const word of banned) {
        // word-boundary match: "identity" must not trip "dent"
        const re = new RegExp(`\\b${word.trim()}\\b`);
        expect(re.test(text), `${f} contains banned vertical noun "${word.trim()}"`).toBe(false);
      }
    }
  });
});
