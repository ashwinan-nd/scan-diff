/**
 * Scan-Diff PWA shell: hash router + four screens.
 *   #/          library (saved scans + reports, entry point)
 *   #/scan      capture (WebXR on ARCore devices, demo mode everywhere)
 *   #/compare   pick two scans, run the pipeline, view regions in 3D
 *   #/report/:id  stored report viewer (iframe of the self-contained HTML)
 *
 * All pipeline work happens in this tab (no server). Long operations paint
 * progress before they start (pipeline runs are typically < 2 s at demo scale).
 */

import './style.css';
import { comparePipeline } from '../pipeline';
import { renderReportHtml } from '../report/html';
import { ScanDiffError, type ScanSession } from '../core/types';
import {
  deleteReport, deleteScan, getReport, getScan, listReports, listScans,
  saveReport, saveScan, type ScanListEntry, type StoredReport,
} from '../store/db';
import { WebXRCaptureSource } from '../capture/webxr';
import { runDemoCapture } from './demo';
import { PointCloudViewer } from './viewer';

const app = document.getElementById('app')!;
let activeViewer: PointCloudViewer | null = null;

/* ---------------- helpers ---------------- */

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fmtDate = (t: number): string =>
  new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const fmtPoints = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} M` : n >= 1000 ? `${Math.round(n / 1000)} k` : String(n);

function teardown(): void {
  if (activeViewer) {
    activeViewer.dispose();
    activeViewer = null;
  }
}

function shell(title: string, body: string, opts: { back?: boolean; tab?: 'library' | 'scan' | 'compare' } = {}): void {
  teardown();
  app.innerHTML = `
<header class="topbar">
  ${opts.back ? '<button class="back" id="nav-back" aria-label="Back">&larr; Back</button>' : '<span></span>'}
  <h1>${esc(title)}</h1>
  <span style="width:56px"></span>
</header>
<main class="screen" id="screen">${body}</main>
<nav class="tabbar" aria-label="Main">
  <button id="tab-library" class="${opts.tab === 'library' ? 'active' : ''}"><span class="glyph">&#9639;</span>Library</button>
  <button id="tab-scan" class="${opts.tab === 'scan' ? 'active' : ''}"><span class="glyph">&#8853;</span>Scan</button>
  <button id="tab-compare" class="${opts.tab === 'compare' ? 'active' : ''}"><span class="glyph">&#8646;</span>Compare</button>
</nav>`;
  document.getElementById('nav-back')?.addEventListener('click', () => history.back());
  document.getElementById('tab-library')!.addEventListener('click', () => (location.hash = '#/'));
  document.getElementById('tab-scan')!.addEventListener('click', () => (location.hash = '#/scan'));
  document.getElementById('tab-compare')!.addEventListener('click', () => (location.hash = '#/compare'));
}

function toastError(err: unknown): void {
  const msg = err instanceof ScanDiffError ? err.message : err instanceof Error ? err.message : String(err);
  const el = document.createElement('div');
  el.className = 'notice bad';
  el.style.cssText = 'position:fixed;left:16px;right:16px;bottom:76px;z-index:50;max-width:688px;margin:0 auto;';
  el.setAttribute('role', 'alert');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

/* ---------------- library ---------------- */

async function libraryScreen(): Promise<void> {
  let scans: ScanListEntry[] = [];
  let reports: Array<Omit<StoredReport, 'html'>> = [];
  try {
    [scans, reports] = await Promise.all([listScans(), listReports()]);
  } catch (e) {
    toastError(e);
  }

  const scansHtml = scans.length
    ? scans
        .map(
          (s) => `
<div class="card row between" data-scan="${esc(s.id)}">
  <div>
    <p class="title">${esc(s.label)}</p>
    <p class="meta">${fmtDate(s.createdAt)} · ${fmtPoints(s.pointCount)} points${s.hasAnchor ? ' · marker' : ''}</p>
  </div>
  <button class="btn danger" data-del-scan="${esc(s.id)}" aria-label="Delete scan ${esc(s.label)}">Delete</button>
</div>`,
        )
        .join('')
    : `<div class="empty-state"><div class="icon">&#9639;</div>No scans yet.<br>Scan something, then scan it again later to see what changed.</div>`;

  const reportsHtml = reports.length
    ? reports
        .map(
          (r) => `
<div class="card tappable row between" data-report="${esc(r.id)}">
  <div>
    <p class="title">${esc(r.title)}</p>
    <p class="meta">${fmtDate(r.createdAt)}</p>
  </div>
  <button class="btn danger" data-del-report="${esc(r.id)}" aria-label="Delete report">Delete</button>
</div>`,
        )
        .join('')
    : `<p class="meta" style="color:var(--text-dim)">No reports yet — compare two scans to generate one.</p>`;

  shell('Scan-Diff', `
<div class="stack">
  <div class="notice info">All scans stay on this device. Nothing is uploaded.</div>
  <h2 style="font-size:14px;color:var(--text-dim);margin:8px 0 0;text-transform:uppercase;letter-spacing:0.5px">Scans</h2>
  ${scansHtml}
  <h2 style="font-size:14px;color:var(--text-dim);margin:14px 0 0;text-transform:uppercase;letter-spacing:0.5px">Reports</h2>
  ${reportsHtml}
</div>`, { tab: 'library' });

  const screen = document.getElementById('screen')!;
  screen.querySelectorAll<HTMLElement>('[data-del-scan]').forEach((b) =>
    b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      await deleteScan(b.dataset['delScan']!).catch(toastError);
      void libraryScreen();
    }),
  );
  screen.querySelectorAll<HTMLElement>('[data-del-report]').forEach((b) =>
    b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      await deleteReport(b.dataset['delReport']!).catch(toastError);
      void libraryScreen();
    }),
  );
  screen.querySelectorAll<HTMLElement>('[data-report]').forEach((c) =>
    c.addEventListener('click', () => (location.hash = `#/report/${c.dataset['report']!}`)),
  );
}

/* ---------------- scan ---------------- */

async function scanScreen(): Promise<void> {
  const xrOk = await WebXRCaptureSource.isSupported().catch(() => false);

  shell('New scan', `
<div class="stack">
  <div class="viewer-wrap" id="viewer">
    <div class="hud">
      <span class="pill" id="hud-points">0 points</span>
      <span class="pill" id="hud-frames">idle</span>
      <span class="pill good" id="hud-kf" style="display:none">0 keyframes</span>
    </div>
  </div>
  ${xrOk
    ? '<div class="notice info">AR depth capture available. Place a printed QR code in the scene — the same code links this scan to future rescans.</div>'
    : '<div class="notice warn">This browser has no WebXR depth sensing (Chrome on an ARCore-capable Android device required). Demo mode below exercises the identical pipeline with synthetic depth.</div>'}
  <label for="scan-label" style="font-size:13px;color:var(--text-dim)">Scan name</label>
  <input type="text" id="scan-label" placeholder="e.g. baseline" value="" />
  <div class="row">
    ${xrOk ? '<button class="btn primary block" id="start-xr">Start AR scan</button>' : ''}
    <button class="btn ${xrOk ? '' : 'primary'} block" id="start-demo-a">Demo: baseline</button>
    <button class="btn block" id="start-demo-b">Demo: rescan</button>
  </div>
  <button class="btn block" id="save-scan" disabled>Save scan</button>
</div>`, { back: true, tab: 'scan' });

  const viewerEl = document.getElementById('viewer')!;
  activeViewer = new PointCloudViewer(viewerEl);
  const hudPoints = document.getElementById('hud-points')!;
  const hudFrames = document.getElementById('hud-frames')!;
  const hudKf = document.getElementById('hud-kf')!;
  const saveBtn = document.getElementById('save-scan') as HTMLButtonElement;
  const labelInput = document.getElementById('scan-label') as HTMLInputElement;
  let pending: ScanSession | null = null;

  async function runDemo(which: 'baseline' | 'rescan'): Promise<void> {
    saveBtn.disabled = true;
    hudKf.style.display = '';
    try {
      pending = await runDemoCapture(which, (p, positions, count) => {
        hudPoints.textContent = `${fmtPoints(p.points)} points`;
        hudFrames.textContent = `frame ${p.frame}/${p.totalFrames}`;
        hudKf.textContent = `${p.keyframes} keyframes`;
        activeViewer?.setCloud(positions, count);
      });
      hudFrames.textContent = 'done';
      if (!labelInput.value) labelInput.value = pending.label;
      saveBtn.disabled = false;
    } catch (e) {
      toastError(e);
    }
  }

  document.getElementById('start-demo-a')!.addEventListener('click', () => void runDemo('baseline'));
  document.getElementById('start-demo-b')!.addEventListener('click', () => void runDemo('rescan'));

  document.getElementById('start-xr')?.addEventListener('click', async () => {
    // real AR capture: identical builder path, frames from the sensor
    saveBtn.disabled = true;
    hudKf.style.display = '';
    const { ScanSessionBuilder } = await import('../capture/session');
    const source = new WebXRCaptureSource();
    const builder = new ScanSessionBuilder({ unproject: { stride: 4 } });
    const stopBtn = document.createElement('button');
    stopBtn.className = 'btn danger block';
    stopBtn.textContent = 'Stop scanning';
    document.getElementById('screen')!.appendChild(stopBtn);
    stopBtn.addEventListener('click', () => void source.stop());
    try {
      let frame = 0;
      for await (const f of source.start()) {
        const r = builder.addFrame(f);
        frame++;
        hudPoints.textContent = `${fmtPoints(r.totalPoints)} points`;
        hudFrames.textContent = `frame ${frame}`;
        hudKf.textContent = `${builder.stats.keyframes} keyframes`;
      }
      pending = builder.build(`scan-${Date.now()}`, labelInput.value || 'untitled', navigator.userAgent);
      saveBtn.disabled = false;
    } catch (e) {
      toastError(e);
    } finally {
      stopBtn.remove();
    }
  });

  saveBtn.addEventListener('click', async () => {
    if (!pending) return;
    pending.label = labelInput.value.trim() || pending.label;
    try {
      await saveScan(pending);
      location.hash = '#/';
    } catch (e) {
      toastError(e);
    }
  });
}

/* ---------------- compare ---------------- */

async function compareScreen(): Promise<void> {
  let scans: ScanListEntry[] = [];
  try {
    scans = await listScans();
  } catch (e) {
    toastError(e);
  }

  if (scans.length < 2) {
    shell('Compare', `
<div class="empty-state">
  <div class="icon">&#8646;</div>
  Need at least two saved scans to compare.<br>
  ${scans.length === 0 ? 'Capture a baseline first.' : 'Capture a rescan of the same thing.'}
</div>
<button class="btn primary block" id="go-scan">Go scan</button>`, { back: true, tab: 'compare' });
    document.getElementById('go-scan')!.addEventListener('click', () => (location.hash = '#/scan'));
    return;
  }

  const pick = (slot: string): string =>
    scans
      .map(
        (s) => `
<div class="card tappable" data-pick="${slot}:${esc(s.id)}">
  <p class="title">${esc(s.label)}</p>
  <p class="meta">${fmtDate(s.createdAt)} · ${fmtPoints(s.pointCount)} points${s.hasAnchor ? ' · marker' : ''}</p>
</div>`,
      )
      .join('');

  shell('Compare', `
<div class="stack">
  <h2 style="font-size:14px;color:var(--text-dim);margin:0;text-transform:uppercase;letter-spacing:0.5px">1 · Before (baseline)</h2>
  <div id="pick-a">${pick('a')}</div>
  <h2 style="font-size:14px;color:var(--text-dim);margin:10px 0 0;text-transform:uppercase;letter-spacing:0.5px">2 · After (rescan)</h2>
  <div id="pick-b">${pick('b')}</div>
  <button class="btn primary block" id="run-compare" disabled>Compare scans</button>
  <div id="compare-result"></div>
</div>`, { back: true, tab: 'compare' });

  const sel: { a: string | null; b: string | null } = { a: null, b: null };
  const runBtn = document.getElementById('run-compare') as HTMLButtonElement;
  document.querySelectorAll<HTMLElement>('[data-pick]').forEach((card) =>
    card.addEventListener('click', () => {
      const [slot, id] = card.dataset['pick']!.split(':') as ['a' | 'b', string];
      sel[slot] = id;
      card.parentElement!.querySelectorAll('.card').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
      runBtn.disabled = !(sel.a && sel.b && sel.a !== sel.b);
    }),
  );

  runBtn.addEventListener('click', async () => {
    runBtn.disabled = true;
    runBtn.textContent = 'Aligning + diffing…';
    try {
      const [scanA, scanB] = await Promise.all([getScan(sel.a!), getScan(sel.b!)]);
      if (!scanA || !scanB) throw new ScanDiffError('bad-input', 'A selected scan no longer exists.');
      // pipeline is synchronous CPU work; yield a frame so the button label paints
      await new Promise((r) => requestAnimationFrame(r));
      const res = comparePipeline(scanA, scanB);
      const html = renderReportHtml(res.report, { scanA: new Map(), scanB: new Map() });
      const reportId = `report-${Date.now()}`;
      await saveReport({
        id: reportId,
        title: res.report.title,
        createdAt: Date.now(),
        scanAId: scanA.id,
        scanBId: scanB.id,
        html,
      });

      const resultEl = document.getElementById('compare-result')!;
      resultEl.innerHTML = `
<div class="stack" style="margin-top:12px">
  <div class="notice ${res.diff.regions.length ? 'warn' : 'info'}">
    ${res.diff.regions.length
      ? `${res.diff.regions.length} changed region${res.diff.regions.length > 1 ? 's' : ''} found — boxes shown below.`
      : 'No geometric changes at detection resolution.'}
    Alignment ${esc(res.quality.verdict)} (RMSE ${(res.quality.rmse * 1000).toFixed(1)} mm, ${esc(res.alignmentMethod)}).
  </div>
  <div class="viewer-wrap" id="cmp-viewer"></div>
  <div class="row" style="font-size:12px;color:var(--text-dim);gap:14px">
    <span><span style="color:var(--accent)">&#9679;</span> before</span>
    <span><span style="color:#33d17a">&#9679;</span> after (aligned)</span>
    <span><span class="badge added">added</span></span>
    <span><span class="badge removed">removed</span></span>
    <span><span class="badge shifted">moved</span></span>
  </div>
  <button class="btn primary block" id="open-report">Open report</button>
</div>`;
      const { transformPacked } = await import('../core/mat4');
      activeViewer = new PointCloudViewer(document.getElementById('cmp-viewer')!);
      const alignedB = transformPacked(res.transform, scanB.cloud.positions, scanB.cloud.count);
      activeViewer.setCompareClouds(scanA.cloud, { positions: alignedB, count: scanB.cloud.count });
      activeViewer.addRegionBoxes(res.diff.regions);
      document.getElementById('open-report')!.addEventListener('click', () => (location.hash = `#/report/${reportId}`));
    } catch (e) {
      toastError(e);
    } finally {
      runBtn.textContent = 'Compare scans';
      runBtn.disabled = false;
    }
  });
}

/* ---------------- report viewer ---------------- */

async function reportScreen(id: string): Promise<void> {
  let report: StoredReport | null = null;
  try {
    report = await getReport(id);
  } catch (e) {
    toastError(e);
  }
  if (!report) {
    shell('Report', '<div class="empty-state">Report not found.</div>', { back: true, tab: 'library' });
    return;
  }
  shell(report.title, `
<div class="stack" style="height:100%">
  <div class="row">
    <button class="btn" id="dl-report">Download HTML</button>
    <button class="btn" id="print-report">Print / PDF</button>
  </div>
  <div style="flex:1;min-height:60dvh"><iframe class="report-frame" id="report-frame" title="Change report"></iframe></div>
</div>`, { back: true, tab: 'library' });

  const frame = document.getElementById('report-frame') as HTMLIFrameElement;
  frame.srcdoc = report.html;
  document.getElementById('dl-report')!.addEventListener('click', () => {
    const blob = new Blob([report.html], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${report.title.replace(/[^a-z0-9- ]/gi, '')}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  document.getElementById('print-report')!.addEventListener('click', () => {
    frame.contentWindow?.print();
  });
}

/* ---------------- router ---------------- */

function route(): void {
  const hash = location.hash || '#/';
  if (hash.startsWith('#/report/')) void reportScreen(hash.slice('#/report/'.length));
  else if (hash === '#/scan') void scanScreen();
  else if (hash === '#/compare') void compareScreen();
  else void libraryScreen();
}

window.addEventListener('hashchange', route);
route();

// PWA: offline shell
if ('serviceWorker' in navigator && !import.meta.env.DEV) {
  void navigator.serviceWorker.register('./sw.js');
}
