/**
 * Self-contained HTML report renderer. Zero external requests (privacy +
 * offline): inline CSS, inline SVG, base64 images. `@media print` rules give
 * a clean PDF via the browser print dialog.
 *
 * Design goals (docs/CRITIQUE.md "generic report" finding):
 *  - carries its own identity (masthead + wordmark) once detached from the app
 *  - at-a-glance stat band before any prose
 *  - region cards weighted by physical size (volume bar) and confidence meter
 *  - photo-less evidence renders a top-down footprint map of the region
 *    within the overall changed area — informative, never an empty gray box
 *
 * Photos are keyed by keyframe id via the `photos` maps; sessions captured
 * without RGB (uploads, demo) get the footprint-map path automatically.
 */

import type { ReportModel, ReportRegion } from './model';
import type { Box2D } from './project';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const dateStr = (t: number): string => new Date(t).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

export interface ReportPhotos {
  /** keyframe id -> data URL (JPEG) for the baseline scan */
  scanA: Map<number, string>;
  /** keyframe id -> data URL for the rescan */
  scanB: Map<number, string>;
}

const KIND_LABEL: Record<string, string> = { added: 'Added', removed: 'Removed', shifted: 'Moved' };
const KIND_COLOR: Record<string, string> = { added: '#1a7f37', removed: '#cf222e', shifted: '#9a6700' };
const KIND_TINT: Record<string, string> = { added: '#e6f4ea', removed: '#fbebec', shifted: '#f8f1df' };

/** Scan-Diff wordmark: the two-chevron motif from the app icon, inline SVG. */
const WORDMARK = `<svg width="30" height="30" viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" rx="22" fill="#0b0e13"/><path d="M25 58 L50 30 L75 58" stroke="#4da3ff" stroke-width="9" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M25 76 L50 48 L75 76" stroke="#33d17a" stroke-width="9" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.75"/></svg>`;

/** Union of all region bboxes on the ground plane (x,z), padded — the map extent. */
function footprintExtent(regions: ReportRegion[]): { min: [number, number]; max: [number, number] } {
  const min: [number, number] = [Infinity, Infinity];
  const max: [number, number] = [-Infinity, -Infinity];
  for (const rr of regions) {
    min[0] = Math.min(min[0], rr.region.bboxMin[0]);
    min[1] = Math.min(min[1], rr.region.bboxMin[2]);
    max[0] = Math.max(max[0], rr.region.bboxMax[0]);
    max[1] = Math.max(max[1], rr.region.bboxMax[2]);
  }
  // include the scan origin so "distance from origin" reads spatially
  min[0] = Math.min(min[0], 0); min[1] = Math.min(min[1], 0);
  max[0] = Math.max(max[0], 0); max[1] = Math.max(max[1], 0);
  const padX = Math.max(0.4, (max[0] - min[0]) * 0.12);
  const padZ = Math.max(0.4, (max[1] - min[1]) * 0.12);
  return { min: [min[0] - padX, min[1] - padZ], max: [max[0] + padX, max[1] + padZ] };
}

/**
 * Top-down footprint map: all regions ghosted, this one solid, origin marked.
 * Replaces the "empty gray box" evidence tile for photo-less sessions.
 */
function footprintSvg(
  rr: ReportRegion,
  all: ReportRegion[],
  extent: { min: [number, number]; max: [number, number] },
): string {
  const W = 320, H = 240;
  const sx = (x: number): number => ((x - extent.min[0]) / (extent.max[0] - extent.min[0] || 1)) * W;
  const sz = (z: number): number => ((z - extent.min[1]) / (extent.max[1] - extent.min[1] || 1)) * H;
  const rect = (r: ReportRegion, solid: boolean): string => {
    const x = sx(r.region.bboxMin[0]);
    const y = sz(r.region.bboxMin[2]);
    const w = Math.max(3, sx(r.region.bboxMax[0]) - x);
    const h = Math.max(3, sz(r.region.bboxMax[2]) - y);
    const color = KIND_COLOR[r.region.kind]!;
    return solid
      ? `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${color}" fill-opacity="0.55" stroke="${color}" stroke-width="2" rx="2"/>`
      : `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="none" stroke="#9aa4b5" stroke-width="1" stroke-dasharray="4 3" rx="2"/>`;
  };
  const others = all.filter((o) => o !== rr).map((o) => rect(o, false)).join('');
  const ox = sx(0), oz = sz(0);
  // meter scale bar: 1m in svg units along x
  const meterPx = sx(1) - sx(0);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Top-down map of the changed area with this region highlighted">
<rect width="${W}" height="${H}" fill="#f4f6f9"/>
<g>${others}${rect(rr, true)}</g>
<circle cx="${ox.toFixed(1)}" cy="${oz.toFixed(1)}" r="4" fill="#0b0e13"/>
<text x="${(ox + 8).toFixed(1)}" y="${(oz + 4).toFixed(1)}" font-size="10" fill="#57606a" font-family="ui-monospace,monospace">scan origin</text>
${meterPx > 8 ? `<g><line x1="12" y1="${H - 14}" x2="${(12 + meterPx).toFixed(1)}" y2="${H - 14}" stroke="#57606a" stroke-width="2"/><text x="12" y="${H - 20}" font-size="10" fill="#57606a" font-family="ui-monospace,monospace">1 m</text></g>` : ''}
</svg>`;
}

function evidenceCell(
  side: 'before' | 'after',
  rr: ReportRegion,
  all: ReportRegion[],
  extent: { min: [number, number]; max: [number, number] },
  photos: Map<number, string>,
  imageSizeHint: { w: number; h: number },
): string {
  const ev = rr.evidence[side];
  const label = side === 'before' ? 'Before' : 'After';
  const photo = ev ? photos.get(ev.keyframeId) : undefined;
  if (ev && photo) {
    const box: Box2D = ev.box;
    const color = KIND_COLOR[rr.region.kind]!;
    return `<figure class="ev"><div class="ev-photo">
<img src="${photo}" alt="${label} evidence photo, region outlined" />
<svg viewBox="0 0 ${imageSizeHint.w} ${imageSizeHint.h}" preserveAspectRatio="none">
<rect x="${box.x.toFixed(1)}" y="${box.y.toFixed(1)}" width="${box.w.toFixed(1)}" height="${box.h.toFixed(1)}" fill="none" stroke="${color}" stroke-width="3"/>
</svg></div><figcaption>${label} — frame ${ev.keyframeId}</figcaption></figure>`;
  }
  // photo-less: informative footprint map instead of an empty placeholder
  return `<figure class="ev"><div class="ev-map">${footprintSvg(rr, all, extent)}</div><figcaption>${label} — location map (no photo captured)</figcaption></figure>`;
}

function volumePct(rr: ReportRegion, maxVolume: number): number {
  return Math.max(4, Math.round((rr.region.volumeM3 / (maxVolume || 1)) * 100));
}

export function renderReportHtml(model: ReportModel, photos: ReportPhotos): string {
  const maxVolume = Math.max(...model.regions.map((r) => r.region.volumeM3), 0);
  const extent = model.regions.length ? footprintExtent(model.regions) : { min: [0, 0] as [number, number], max: [1, 1] as [number, number] };
  const counts = { added: 0, removed: 0, shifted: 0 };
  for (const rr of model.regions) counts[rr.region.kind]++;

  const regionsHtml = model.regions
    .map((rr, i) => {
      const k = rr.region.kind;
      const confPct = Math.round(rr.region.confidence * 100);
      const sizeHintA = { w: 160, h: 120 };
      return `<section class="region" style="border-left-color:${KIND_COLOR[k]}" aria-labelledby="r${i}">
<header class="region-head">
  <h3 id="r${i}"><span class="badge" style="background:${KIND_COLOR[k]}">${KIND_LABEL[k]}</span> Region ${i + 1}</h3>
  <div class="region-metrics">
    <div class="metric"><span class="metric-label">relative size</span>
      <span class="meter"><span class="meter-fill" style="width:${volumePct(rr, maxVolume)}%;background:${KIND_COLOR[k]}"></span></span></div>
    <div class="metric"><span class="metric-label">confidence ${confPct}%</span>
      <span class="meter"><span class="meter-fill" style="width:${confPct}%;background:#57606a"></span></span></div>
  </div>
</header>
<p class="region-sentence">${esc(rr.sentence)}</p>
<div class="evidence">${evidenceCell('before', rr, model.regions, extent, photos.scanA, sizeHintA)}${evidenceCell('after', rr, model.regions, extent, photos.scanB, sizeHintA)}</div>
</section>`;
    })
    .join('\n');

  const summaryHtml = model.summary
    .split('\n')
    .map((l) => `<p>${esc(l)}</p>`)
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(model.title)}</title>
<style>
:root { color-scheme: light; }
* { box-sizing: border-box; margin: 0; }
body { font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: #1f2328; background: #eef1f5; padding: 28px 16px; }
.sheet { max-width: 880px; margin: 0 auto; background: #fff; border-radius: 14px; box-shadow: 0 2px 24px rgba(15, 23, 42, 0.08); overflow: hidden; }
.masthead { background: #0b0e13; color: #e8ebf1; padding: 22px 32px; display: flex; align-items: center; gap: 14px; }
.masthead .brand { display: flex; align-items: center; gap: 10px; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-weight: 700; font-size: 15px; letter-spacing: -0.02em; }
.masthead .doc-type { margin-left: auto; font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: #8b95a9; }
.title-block { padding: 26px 32px 0; }
h1 { font-size: 24px; letter-spacing: -0.02em; margin-bottom: 12px; }
.meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 4px 24px; font-size: 12.5px; color: #57606a; padding-bottom: 18px; border-bottom: 2px solid #1f2328; }
.body { padding: 0 32px 28px; }
h2 { font-size: 13px; margin: 26px 0 10px; text-transform: uppercase; letter-spacing: 0.09em; color: #57606a; }
.statband { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 10px; margin-top: 22px; }
.stat { border: 1px solid #d8dee6; border-radius: 10px; padding: 12px 14px; background: #fafbfc; }
.stat .v { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 24px; font-weight: 700; letter-spacing: -0.02em; }
.stat .k { font-size: 10.5px; color: #57606a; text-transform: uppercase; letter-spacing: 0.08em; margin-top: 2px; }
.summary { background: #f6f8fa; border: 1px solid #d8dee6; border-radius: 10px; padding: 14px 16px; }
.summary p { margin: 2px 0; }
.region { border: 1px solid #d8dee6; border-left: 4px solid #999; border-radius: 10px; padding: 16px 18px; margin: 12px 0; break-inside: avoid; }
.region-head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 18px; margin-bottom: 8px; }
h3 { font-size: 15px; display: flex; align-items: center; gap: 8px; }
.badge { color: #fff; font-size: 10.5px; font-weight: 700; padding: 3px 9px; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.05em; }
.region-metrics { display: flex; gap: 18px; margin-left: auto; flex-wrap: wrap; }
.metric { display: flex; flex-direction: column; gap: 3px; min-width: 130px; }
.metric-label { font-size: 10.5px; color: #57606a; text-transform: uppercase; letter-spacing: 0.06em; }
.meter { display: block; height: 6px; border-radius: 999px; background: #e7ebf0; overflow: hidden; }
.meter-fill { display: block; height: 100%; border-radius: 999px; }
.region-sentence { margin: 6px 0 10px; }
.evidence { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.ev { text-align: center; }
.ev-photo { position: relative; }
.ev-photo img { width: 100%; height: auto; display: block; border-radius: 8px; }
.ev-photo svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.ev-map svg { width: 100%; height: auto; border-radius: 8px; border: 1px solid #d8dee6; }
figcaption { font-size: 11.5px; color: #57606a; margin-top: 5px; }
.clean-match { border: 1px dashed #c4ccd6; border-radius: 10px; padding: 26px; text-align: center; color: #57606a; }
footer { margin-top: 26px; padding: 16px 32px 22px; border-top: 1px solid #d8dee6; font-size: 11.5px; color: #57606a; background: #fafbfc; }
@media (max-width: 560px) { .evidence { grid-template-columns: 1fr; } .masthead, .title-block, .body, footer { padding-left: 18px; padding-right: 18px; } }
@media print {
  body { background: #fff; padding: 0; }
  .sheet { box-shadow: none; border-radius: 0; max-width: none; }
  .region { page-break-inside: avoid; }
  .masthead { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
</style>
</head>
<body>
<div class="sheet">
<header class="masthead">
  <span class="brand">${WORDMARK} scan-diff</span>
  <span class="doc-type">Change report</span>
</header>
<div class="title-block">
<h1>${esc(model.title)}</h1>
<div class="meta">
<span>Baseline: ${esc(model.scanALabel)} — ${dateStr(model.scanADate)} (${esc(model.scanADevice)})</span>
<span>Rescan: ${esc(model.scanBLabel)} — ${dateStr(model.scanBDate)} (${esc(model.scanBDevice)})</span>
<span>Report generated: ${dateStr(model.createdAt)}</span>
<span>Alignment: ${esc(model.alignmentMethod)}, ${esc(model.quality.verdict)} (RMSE ${(model.quality.rmse * 1000).toFixed(1)} mm)</span>
</div>
</div>
<div class="body">
<div class="statband">
  <div class="stat"><div class="v">${model.regions.length}</div><div class="k">regions</div></div>
  <div class="stat"><div class="v" style="color:${KIND_COLOR['added']}">${counts.added}</div><div class="k">added</div></div>
  <div class="stat"><div class="v" style="color:${KIND_COLOR['removed']}">${counts.removed}</div><div class="k">removed</div></div>
  <div class="stat"><div class="v" style="color:${KIND_COLOR['shifted']}">${counts.shifted}</div><div class="k">moved</div></div>
  <div class="stat"><div class="v">${(model.quality.rmse * 1000).toFixed(1)}<span style="font-size:0.55em"> mm</span></div><div class="k">align rmse</div></div>
</div>
<h2>Summary</h2>
<div class="summary">${summaryHtml}</div>
<h2>Changed regions${model.regions.length ? ` (${model.regions.length})` : ''}</h2>
${regionsHtml || '<div class="clean-match">None. The scans match at the detection resolution.</div>'}
</div>
<footer>
Generated locally by Scan-Diff. All scan data stays on this device.
Detection resolution ${(model.voxelSizeM * 100).toFixed(0)} cm ·
re-observation coverage ${Math.round(Math.min(model.coverageBofA, model.coverageAofB) * 100)}% ·
geometric diff only — photos and maps are annotation, not the change signal.
</footer>
</div>
</body>
</html>`;
}
