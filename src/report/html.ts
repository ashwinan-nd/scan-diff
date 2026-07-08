/**
 * Self-contained HTML report renderer. Zero external requests (privacy +
 * offline): inline CSS, base64 images, SVG box overlays. `@media print`
 * rules give a clean PDF via the browser print dialog.
 *
 * Photos are keyed by keyframe id via the `photos` maps; sessions captured
 * without RGB (mock/synthetic) render evidence as labeled geometry cards
 * instead — the report never breaks on missing imagery.
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

const KIND_LABEL: Record<string, string> = {
  added: 'Added',
  removed: 'Removed',
  shifted: 'Moved',
};

const KIND_COLOR: Record<string, string> = {
  added: '#1a7f37',
  removed: '#cf222e',
  shifted: '#9a6700',
};

function evidenceCell(
  side: 'before' | 'after',
  rr: ReportRegion,
  photos: Map<number, string>,
  imageSizeHint: { w: number; h: number },
): string {
  const ev = rr.evidence[side];
  const label = side === 'before' ? 'Before' : 'After';
  if (!ev) {
    return `<figure class="ev"><div class="ev-missing">Not visible in any ${label.toLowerCase()} photo</div><figcaption>${label}</figcaption></figure>`;
  }
  const photo = photos.get(ev.keyframeId);
  const box: Box2D = ev.box;
  const color = KIND_COLOR[rr.region.kind]!;
  if (!photo) {
    // geometry-only evidence card (no RGB captured)
    return `<figure class="ev"><div class="ev-geom" role="img" aria-label="region location diagram">
<svg viewBox="0 0 ${imageSizeHint.w} ${imageSizeHint.h}" preserveAspectRatio="xMidYMid meet">
<rect x="0" y="0" width="${imageSizeHint.w}" height="${imageSizeHint.h}" fill="#f0f2f5"/>
<rect x="${box.x.toFixed(1)}" y="${box.y.toFixed(1)}" width="${box.w.toFixed(1)}" height="${box.h.toFixed(1)}" fill="none" stroke="${color}" stroke-width="3"/>
</svg></div><figcaption>${label} — frame ${ev.keyframeId} (no photo captured)</figcaption></figure>`;
  }
  return `<figure class="ev"><div class="ev-photo">
<img src="${photo}" alt="${label} evidence photo, region outlined" />
<svg viewBox="0 0 ${imageSizeHint.w} ${imageSizeHint.h}" preserveAspectRatio="none">
<rect x="${box.x.toFixed(1)}" y="${box.y.toFixed(1)}" width="${box.w.toFixed(1)}" height="${box.h.toFixed(1)}" fill="none" stroke="${color}" stroke-width="3"/>
</svg></div><figcaption>${label} — frame ${ev.keyframeId}</figcaption></figure>`;
}

export function renderReportHtml(model: ReportModel, photos: ReportPhotos): string {
  const regionsHtml = model.regions
    .map((rr, i) => {
      const k = rr.region.kind;
      const sizeHintA = { w: 160, h: 120 };
      return `<section class="region" aria-labelledby="r${i}">
<h3 id="r${i}"><span class="badge" style="background:${KIND_COLOR[k]}">${KIND_LABEL[k]}</span> Region ${i + 1}</h3>
<p>${esc(rr.sentence)}</p>
<div class="evidence">${evidenceCell('before', rr, photos.scanA, sizeHintA)}${evidenceCell('after', rr, photos.scanB, sizeHintA)}</div>
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
body { font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f2328; background: #fff; max-width: 860px; margin: 0 auto; padding: 24px; }
header { border-bottom: 2px solid #1f2328; padding-bottom: 16px; margin-bottom: 20px; }
h1 { font-size: 22px; margin-bottom: 6px; }
h2 { font-size: 17px; margin: 24px 0 8px; }
h3 { font-size: 15px; margin-bottom: 6px; display: flex; align-items: center; gap: 8px; }
.meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 4px 24px; font-size: 13px; color: #57606a; }
.badge { color: #fff; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 10px; text-transform: uppercase; letter-spacing: 0.4px; }
.summary { background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 8px; padding: 14px 16px; }
.summary p { margin: 2px 0; }
.region { border: 1px solid #d0d7de; border-radius: 8px; padding: 14px 16px; margin: 12px 0; break-inside: avoid; }
.evidence { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 10px; }
.ev { text-align: center; }
.ev-photo { position: relative; }
.ev-photo img { width: 100%; height: auto; display: block; border-radius: 6px; }
.ev-photo svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.ev-geom svg { width: 100%; height: auto; border-radius: 6px; }
.ev-missing { background: #f0f2f5; border-radius: 6px; padding: 28px 8px; color: #57606a; font-size: 13px; }
figcaption { font-size: 12px; color: #57606a; margin-top: 4px; }
footer { margin-top: 28px; padding-top: 12px; border-top: 1px solid #d0d7de; font-size: 12px; color: #57606a; }
@media (max-width: 560px) { .evidence { grid-template-columns: 1fr; } body { padding: 16px; } }
@media print {
  body { padding: 0; max-width: none; }
  .region { page-break-inside: avoid; }
  header { page-break-after: avoid; }
}
</style>
</head>
<body>
<header>
<h1>${esc(model.title)}</h1>
<div class="meta">
<span>Baseline: ${esc(model.scanALabel)} — ${dateStr(model.scanADate)} (${esc(model.scanADevice)})</span>
<span>Rescan: ${esc(model.scanBLabel)} — ${dateStr(model.scanBDate)} (${esc(model.scanBDevice)})</span>
<span>Report generated: ${dateStr(model.createdAt)}</span>
<span>Alignment: ${esc(model.alignmentMethod)}, ${esc(model.quality.verdict)} (RMSE ${(model.quality.rmse * 1000).toFixed(1)} mm)</span>
</div>
</header>
<h2>Summary</h2>
<div class="summary">${summaryHtml}</div>
<h2>Changed regions${model.regions.length ? ` (${model.regions.length})` : ''}</h2>
${regionsHtml || '<p>None. The scans match at the detection resolution.</p>'}
<footer>
Generated locally by Scan-Diff. All scan data stays on this device.
Detection resolution ${(model.voxelSizeM * 100).toFixed(0)} cm ·
re-observation coverage ${Math.round(Math.min(model.coverageBofA, model.coverageAofB) * 100)}% ·
geometric diff only — photos are annotation, not the change signal.
</footer>
</body>
</html>`;
}
