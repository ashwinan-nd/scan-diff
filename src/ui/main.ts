/**
 * Scan-Diff PWA shell: hash router + four screens.
 *   #/scan        capture (default landing): WebXR AR, file upload, demo mode
 *   #/review      pick two scans, run the pipeline, inspect regions in 3D
 *   #/library     saved scans + reports
 *   #/report/:id  stored report viewer (iframe of the self-contained HTML)
 *
 * Nav order mirrors the user journey: Scan first, Review second, Library last.
 * All pipeline work happens in this tab (no server; local-first).
 */

import './style.css';
import { comparePipeline } from '../pipeline';
import { renderReportHtml } from '../report/html';
import { ScanDiffError, type ScanSession } from '../core/types';
import {
  deleteReport, deleteScan, getReport, getScan, listReports, listScans,
  reportsReferencingScan, saveReport, saveScan, type ScanListEntry, type StoredReport,
} from '../store/db';
import { filterScans, groupScans, labelCollides, sortScans, type ScanSort } from './organize';
import { WebXRCaptureSource } from '../capture/webxr';
import { ScanSessionBuilder } from '../capture/session';
import { transformPacked } from '../core/mat4';
import { isSupportedUpload, sessionFromPlyBuffer } from '../capture/upload';
import { EXCHANGE_EXTENSION, exportScan, importScan, isExchangeFile } from '../store/exchange';
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
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);

function teardown(): void {
  if (activeViewer) {
    activeViewer.dispose();
    activeViewer = null;
  }
}

type Tab = 'scan' | 'review' | 'library';

function shell(title: string, body: string, opts: { back?: boolean; tab?: Tab } = {}): void {
  teardown();
  app.innerHTML = `
<header class="topbar">
  ${opts.back ? '<button class="back" id="nav-back" aria-label="Back">&larr; Back</button>' : '<span style="width:72px"></span>'}
  <h1>${esc(title)}</h1>
  <span style="width:72px"></span>
</header>
<main class="screen"><div class="content" id="screen">${body}</div></main>
<nav class="tabbar" aria-label="Main">
  <button id="tab-scan" class="${opts.tab === 'scan' ? 'active' : ''}"><span class="glyph">&#8853;</span>Scan</button>
  <button id="tab-review" class="${opts.tab === 'review' ? 'active' : ''}"><span class="glyph">&#8646;</span>Review</button>
  <button id="tab-library" class="${opts.tab === 'library' ? 'active' : ''}"><span class="glyph">&#9639;</span>Library</button>
</nav>`;
  document.getElementById('nav-back')?.addEventListener('click', () => history.back());
  document.getElementById('tab-scan')!.addEventListener('click', () => (location.hash = '#/scan'));
  document.getElementById('tab-review')!.addEventListener('click', () => (location.hash = '#/review'));
  document.getElementById('tab-library')!.addEventListener('click', () => (location.hash = '#/library'));
}

/**
 * In-app confirmation dialog (native confirm() is blocked in some embedded
 * contexts and can't be styled). Resolves true on confirm. Focus lands on
 * Cancel so Enter-mashing can't destroy data; Escape cancels.
 */
function confirmModal(title: string, detail: string): Promise<boolean> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('role', 'alertdialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'modal-title');

    const h = document.createElement('p');
    h.id = 'modal-title';
    h.className = 'modal-title';
    h.textContent = title;
    const d = document.createElement('p');
    d.className = 'modal-detail';
    d.textContent = detail;
    const row = document.createElement('div');
    row.className = 'row';
    row.style.justifyContent = 'flex-end';
    const cancel = document.createElement('button');
    cancel.className = 'btn';
    cancel.textContent = 'Cancel';
    const confirm = document.createElement('button');
    confirm.className = 'btn danger';
    confirm.textContent = 'Delete';
    row.append(cancel, confirm);
    modal.append(h, d, row);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    const done = (v: boolean): void => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') done(false);
    };
    document.addEventListener('keydown', onKey);
    cancel.addEventListener('click', () => done(false));
    confirm.addEventListener('click', () => done(true));
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) done(false);
    });
    cancel.focus();
  });
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

/* ---------------- scan (default landing) ---------------- */

async function scanScreen(): Promise<void> {
  const xrOk = await WebXRCaptureSource.isSupported().catch(() => false);

  shell('New scan', `
<div class="scan-grid">
  <div class="viewer-wrap" id="viewer">
    <div class="hud">
      <span class="pill" id="hud-points">0 points</span>
      <span class="pill" id="hud-frames">idle</span>
      <span class="pill good" id="hud-kf" style="display:none">0 keyframes</span>
    </div>
  </div>
  <div class="stack">
    ${xrOk
      ? '<div class="notice info">AR depth capture available. Place a printed QR code in the scene — the same code links this scan to future rescans.</div>'
      : ''}
    <div class="dropzone" id="dropzone" role="button" tabindex="0" aria-label="Upload a scan file">
      Drop a scan file here, or tap to choose
      <div class="hint">.ply from Polycam, Scaniverse, 3D Scanner App — or a .scandiff exported from another device</div>
    </div>
    <input type="file" id="file-input" accept=".ply,${EXCHANGE_EXTENSION}" style="display:none" />
    <label for="scan-label">Scan name</label>
    <input type="text" id="scan-label" maxlength="80" placeholder="e.g. baseline" value="" />
    <div class="row" style="flex-wrap:wrap">
      ${xrOk ? '<button class="btn primary" id="start-xr" style="flex:1">Start AR scan</button>' : ''}
      <button class="btn ${xrOk ? '' : 'primary'}" id="start-demo-a" style="flex:1">Demo: baseline</button>
      <button class="btn" id="start-demo-b" style="flex:1">Demo: rescan</button>
    </div>
    <button class="btn block" id="save-scan" disabled>Save scan</button>
    ${xrOk ? '' : '<p class="legend">No AR depth on this browser (needs Chrome on ARCore Android). Upload a scan file above, or run the demo — both use the identical pipeline.</p>'}
  </div>
</div>`, { tab: 'scan' });

  const viewerEl = document.getElementById('viewer')!;
  activeViewer = new PointCloudViewer(viewerEl);
  const hudPoints = document.getElementById('hud-points')!;
  const hudFrames = document.getElementById('hud-frames')!;
  const hudKf = document.getElementById('hud-kf')!;
  const saveBtn = document.getElementById('save-scan') as HTMLButtonElement;
  const labelInput = document.getElementById('scan-label') as HTMLInputElement;
  let pending: ScanSession | null = null;

  function showPending(session: ScanSession): void {
    pending = session;
    hudPoints.textContent = `${fmtPoints(session.cloud.count)} points`;
    hudFrames.textContent = 'ready';
    activeViewer?.setCloud(session.cloud.positions, session.cloud.count);
    if (!labelInput.value) labelInput.value = session.label;
    saveBtn.disabled = false;
  }

  /* upload path */
  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  const dropzone = document.getElementById('dropzone')!;
  async function handleFile(file: File): Promise<void> {
    try {
      hudFrames.textContent = 'parsing…';
      let session: ScanSession;
      if (isExchangeFile(file.name)) {
        session = importScan(await file.text());
      } else if (isSupportedUpload(file.name)) {
        session = sessionFromPlyBuffer(await file.arrayBuffer(), file.name);
      } else {
        throw new ScanDiffError('bad-input', `"${file.name}" is not a supported scan file (.ply or ${EXCHANGE_EXTENSION}).`);
      }
      showPending(session);
    } catch (e) {
      hudFrames.textContent = 'idle';
      toastError(e);
    }
  }
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') fileInput.click();
  });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) void handleFile(f);
    fileInput.value = '';
  });
  for (const ev of ['dragover', 'dragenter'] as const) {
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
  }
  for (const ev of ['dragleave', 'drop'] as const) {
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    });
  }
  dropzone.addEventListener('drop', (e) => {
    const f = (e as DragEvent).dataTransfer?.files?.[0];
    if (f) void handleFile(f);
  });

  /* demo path */
  async function runDemo(which: 'baseline' | 'rescan'): Promise<void> {
    saveBtn.disabled = true;
    hudKf.style.display = '';
    hudPoints.classList.add('live');
    try {
      const session = await runDemoCapture(which, (p, positions, count) => {
        hudPoints.textContent = `${fmtPoints(p.points)} points`;
        hudFrames.textContent = `frame ${p.frame}/${p.totalFrames}`;
        hudKf.textContent = `${p.keyframes} keyframes`;
        activeViewer?.setCloud(positions, count);
      });
      hudFrames.textContent = 'done';
      labelInput.value = session.label;
      showPending(session);
    } catch (e) {
      toastError(e);
    } finally {
      hudPoints.classList.remove('live');
    }
  }
  document.getElementById('start-demo-a')!.addEventListener('click', () => void runDemo('baseline'));
  document.getElementById('start-demo-b')!.addEventListener('click', () => void runDemo('rescan'));

  /* AR path */
  document.getElementById('start-xr')?.addEventListener('click', async () => {
    saveBtn.disabled = true;
    hudKf.style.display = '';
    hudPoints.classList.add('live');
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
      showPending(builder.build(`scan-${Date.now()}`, labelInput.value || 'untitled', navigator.userAgent));
    } catch (e) {
      toastError(e);
    } finally {
      stopBtn.remove();
      hudPoints.classList.remove('live');
    }
  });

  saveBtn.addEventListener('click', async () => {
    if (!pending) return;
    pending.label = labelInput.value.trim() || pending.label;
    try {
      // non-blocking collision hint: duplicate names made scans ambiguous
      // in Review (CRITIQUE.md) — nudge toward distinct names, don't forbid
      const existing = await listScans();
      if (labelCollides(pending.label, existing)) {
        pending.label = `${pending.label} (${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })})`;
      }
      await saveScan(pending);
      location.hash = '#/library';
    } catch (e) {
      toastError(e);
    }
  });
}

/* ---------------- review (compare) ---------------- */

type Strictness = 'standard' | 'fine';
const STRICTNESS_OPTS: Record<Strictness, { voxelSizeM: number; label: string; blurb: string }> = {
  standard: { voxelSizeM: 0.05, label: 'Standard · 5 cm', blurb: 'Everyday changes; tolerant of scan noise.' },
  fine: { voxelSizeM: 0.02, label: 'Fine · 2 cm', blurb: 'Strictest detection; needs dense, careful scans.' },
};

async function reviewScreen(): Promise<void> {
  let scans: ScanListEntry[] = [];
  try {
    scans = await listScans();
  } catch (e) {
    toastError(e);
  }

  if (scans.length < 2) {
    shell('Review changes', `
<div class="empty-state">
  <div class="icon">&#8646;</div>
  Two saved scans are needed to review changes.<br>
  ${scans.length === 0 ? 'Capture or upload a baseline first.' : 'Capture or upload a rescan of the same thing.'}
</div>
<button class="btn primary block" id="go-scan">Go scan</button>`, { back: false, tab: 'review' });
    document.getElementById('go-scan')!.addEventListener('click', () => (location.hash = '#/scan'));
    return;
  }

  // pickable cards are real radio controls: keyboard-only users must be able
  // to complete the core compare flow (CRITIQUE.md breaking finding #2)
  const pick = (slot: string): string =>
    scans
      .map(
        (s) => `
<div class="card tappable" role="radio" aria-checked="false" tabindex="0" data-pick="${slot}:${esc(s.id)}">
  <p class="title">${esc(s.label)}</p>
  <p class="meta">${fmtDate(s.createdAt)} · ${fmtPoints(s.pointCount)} pts${s.hasAnchor ? ' · marker' : ''}</p>
</div>`,
      )
      .join('');

  shell('Review changes', `
<div class="stack">
  <div class="grid-2">
    <div class="stack">
      <h2 class="section-label" id="label-pick-a">1 · Before (baseline)</h2>
      <div id="pick-a" class="stack" role="radiogroup" aria-labelledby="label-pick-a">${pick('a')}</div>
    </div>
    <div class="stack">
      <h2 class="section-label" id="label-pick-b">2 · After (rescan)</h2>
      <div id="pick-b" class="stack" role="radiogroup" aria-labelledby="label-pick-b">${pick('b')}</div>
    </div>
  </div>
  <h2 class="section-label">Detection strictness</h2>
  <div class="segmented" id="strictness" role="radiogroup" aria-label="Detection strictness">
    <button data-strict="standard" class="active" role="radio" aria-checked="true">${STRICTNESS_OPTS.standard.label}</button>
    <button data-strict="fine" role="radio" aria-checked="false">${STRICTNESS_OPTS.fine.label}</button>
  </div>
  <p class="legend" id="strictness-blurb">${STRICTNESS_OPTS.standard.blurb}</p>
  <button class="btn primary block" id="run-compare" disabled>Review changes</button>
  <div id="compare-result"></div>
</div>`, { tab: 'review' });

  const sel: { a: string | null; b: string | null } = { a: null, b: null };
  let strict: Strictness = 'standard';
  const runBtn = document.getElementById('run-compare') as HTMLButtonElement;

  document.querySelectorAll<HTMLElement>('#strictness button').forEach((b) =>
    b.addEventListener('click', () => {
      strict = b.dataset['strict'] as Strictness;
      document.querySelectorAll('#strictness button').forEach((x) => {
        x.classList.toggle('active', x === b);
        x.setAttribute('aria-checked', x === b ? 'true' : 'false');
      });
      document.getElementById('strictness-blurb')!.textContent = STRICTNESS_OPTS[strict].blurb;
    }),
  );

  document.querySelectorAll<HTMLElement>('[data-pick]').forEach((card) => {
    const select = (): void => {
      const [slot, id] = card.dataset['pick']!.split(':') as ['a' | 'b', string];
      sel[slot] = id;
      card.parentElement!.querySelectorAll('.card').forEach((c) => {
        c.classList.remove('selected');
        c.setAttribute('aria-checked', 'false');
      });
      card.classList.add('selected');
      card.setAttribute('aria-checked', 'true');
      runBtn.disabled = !(sel.a && sel.b && sel.a !== sel.b);
    };
    card.addEventListener('click', select);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        select();
      }
    });
  });

  runBtn.addEventListener('click', async () => {
    runBtn.disabled = true;
    runBtn.textContent = 'Aligning + diffing…';
    try {
      const [scanA, scanB] = await Promise.all([getScan(sel.a!), getScan(sel.b!)]);
      if (!scanA || !scanB) throw new ScanDiffError('bad-input', 'A selected scan no longer exists.');
      await new Promise((r) => requestAnimationFrame(r));
      const res = comparePipeline(scanA, scanB, {
        diff: { voxelSizeM: STRICTNESS_OPTS[strict].voxelSizeM },
      });
      const html = renderReportHtml(res.report, { scanA: new Map(), scanB: new Map() });
      const reportId = `report-${Date.now()}`;
      await saveReport({
        id: reportId,
        title: res.report.title,
        createdAt: Date.now(),
        scanAId: scanA.id,
        scanBId: scanB.id,
        html,
        regionCount: res.diff.regions.length,
      });

      const counts = { added: 0, removed: 0, shifted: 0 };
      for (const r of res.diff.regions) counts[r.kind]++;
      const resultEl = document.getElementById('compare-result')!;
      resultEl.innerHTML = `
<div class="result-grid" style="margin-top:14px">
  <div class="stack">
    <div class="viewer-wrap" id="cmp-viewer"></div>
    <div class="legend">
      <span><span style="color:var(--accent)">&#9679;</span> before</span>
      <span><span style="color:#33d17a">&#9679;</span> after (aligned)</span>
      <span class="badge added">added</span>
      <span class="badge removed">removed</span>
      <span class="badge shifted">moved</span>
    </div>
  </div>
  <div class="stack">
    <div class="stats">
      <div class="stat"><div class="v">${res.diff.regions.length}</div><div class="k">regions</div></div>
      <div class="stat"><div class="v" style="color:var(--good)">${counts.added}</div><div class="k">added</div></div>
      <div class="stat"><div class="v" style="color:var(--bad)">${counts.removed}</div><div class="k">removed</div></div>
      <div class="stat"><div class="v" style="color:var(--warn)">${counts.shifted}</div><div class="k">moved</div></div>
      <div class="stat"><div class="v">${(res.quality.rmse * 1000).toFixed(1)}<span style="font-size:0.5em"> mm</span></div><div class="k">align RMSE</div></div>
    </div>
    <div class="notice ${res.diff.regions.length ? 'warn' : 'info'}">
      ${res.diff.regions.length
        ? `Changes detected at ${esc(STRICTNESS_OPTS[strict].label)} — inspect the view, then open the report.`
        : 'No geometric changes at this detection resolution.'}
      Alignment ${esc(res.quality.verdict)} via ${esc(res.alignmentMethod)}.
    </div>
    <button class="btn primary block" id="open-report">Open report</button>
  </div>
</div>`;
      activeViewer = new PointCloudViewer(document.getElementById('cmp-viewer')!);
      const alignedB = transformPacked(res.transform, scanB.cloud.positions, scanB.cloud.count);
      const emphasis = res.diff.regions.map((r) => ({ min: r.bboxMin, max: r.bboxMax }));
      activeViewer.setCompareClouds(scanA.cloud, { positions: alignedB, count: scanB.cloud.count }, emphasis);
      activeViewer.addRegionBoxes(res.diff.regions);
      document.getElementById('open-report')!.addEventListener('click', () => (location.hash = `#/report/${reportId}`));
    } catch (e) {
      toastError(e);
    } finally {
      runBtn.textContent = 'Review changes';
      runBtn.disabled = false;
    }
  });
}

/* ---------------- library ---------------- */

let libraryQuery = '';
let librarySort: ScanSort = 'newest';

async function libraryScreen(): Promise<void> {
  let scans: ScanListEntry[] = [];
  let reports: Array<Omit<StoredReport, 'html'>> = [];
  try {
    [scans, reports] = await Promise.all([listScans(), listReports()]);
  } catch (e) {
    toastError(e);
  }

  const visible = sortScans(filterScans(scans, libraryQuery), librarySort);
  const groups = groupScans(visible);

  const scanCard = (s: ScanListEntry): string => `
<div class="card row between" data-scan="${esc(s.id)}">
  <div>
    <p class="title">${esc(s.label)}</p>
    <p class="meta">${fmtDate(s.createdAt)} · ${fmtPoints(s.pointCount)} pts${s.hasAnchor ? ' · marker' : ''}</p>
  </div>
  <div class="row">
    <button class="btn quiet" data-export-scan="${esc(s.id)}" aria-label="Export scan ${esc(s.label)}">Export</button>
    <button class="btn danger" data-del-scan="${esc(s.id)}" aria-label="Delete scan ${esc(s.label)}">Delete</button>
  </div>
</div>`;

  const scansHtml = scans.length === 0
    ? `<div class="empty-state"><div class="icon">&#9639;</div>No scans yet.<br>Scan or upload something, then do it again later to see what changed.</div>`
    : visible.length === 0
      ? `<p class="legend">No scans match "${esc(libraryQuery)}".</p>`
      : groups
          .map((g) =>
            g.name
              ? `<div class="scan-group"><h3 class="group-label">${esc(g.name)} <span class="group-count">${g.scans.length}</span></h3><div class="cards-2col">${g.scans.map(scanCard).join('')}</div></div>`
              : `<div class="cards-2col">${g.scans.map(scanCard).join('')}</div>`,
          )
          .join('');

  const reportsHtml = reports.length
    ? `<div class="cards-2col">${reports
        .map(
          (r) => `
<div class="card tappable row between" data-report="${esc(r.id)}">
  <div>
    <p class="title">${esc(r.title)}</p>
    <p class="meta">${fmtDate(r.createdAt)}${typeof r.regionCount === 'number' ? ` · <span class="change-badge${r.regionCount ? '' : ' zero'}">${r.regionCount} change${r.regionCount === 1 ? '' : 's'}</span>` : ''}</p>
  </div>
  <button class="btn danger" data-del-report="${esc(r.id)}" aria-label="Delete report">Delete</button>
</div>`,
        )
        .join('')}</div>`
    : `<p class="legend">No reports yet — review two scans to generate one.</p>`;

  shell('Library', `
<div class="stack">
  <div class="notice info">All scans stay on this device. Nothing is uploaded to any server.</div>
  <div class="row library-controls">
    <input type="text" id="lib-search" placeholder="Search scans…" value="${esc(libraryQuery)}" aria-label="Search scans" />
    <select id="lib-sort" aria-label="Sort scans">
      <option value="newest"${librarySort === 'newest' ? ' selected' : ''}>Newest</option>
      <option value="oldest"${librarySort === 'oldest' ? ' selected' : ''}>Oldest</option>
      <option value="name"${librarySort === 'name' ? ' selected' : ''}>Name</option>
      <option value="points"${librarySort === 'points' ? ' selected' : ''}>Largest</option>
    </select>
  </div>
  <h2 class="section-label">Scans</h2>
  ${scansHtml}
  <h2 class="section-label">Reports</h2>
  ${reportsHtml}
</div>`, { tab: 'library' });

  const screen = document.getElementById('screen')!;
  const searchEl = document.getElementById('lib-search') as HTMLInputElement;
  let searchDebounce = 0;
  searchEl.addEventListener('input', () => {
    libraryQuery = searchEl.value;
    window.clearTimeout(searchDebounce);
    searchDebounce = window.setTimeout(() => {
      const pos = searchEl.selectionStart ?? searchEl.value.length;
      void libraryScreen().then(() => {
        const el = document.getElementById('lib-search') as HTMLInputElement;
        el.focus();
        el.setSelectionRange(pos, pos);
      });
    }, 180);
  });
  (document.getElementById('lib-sort') as HTMLSelectElement).addEventListener('change', (e) => {
    librarySort = (e.target as HTMLSelectElement).value as ScanSort;
    void libraryScreen();
  });
  screen.querySelectorAll<HTMLElement>('[data-export-scan]').forEach((b) =>
    b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      try {
        const scan = await getScan(b.dataset['exportScan']!);
        if (!scan) throw new ScanDiffError('bad-input', 'Scan no longer exists.');
        const blob = new Blob([await exportScan(scan)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${scan.label.replace(/[^a-z0-9- ]/gi, '') || 'scan'}${EXCHANGE_EXTENSION}`;
        a.click();
        URL.revokeObjectURL(a.href);
      } catch (e) {
        toastError(e);
      }
    }),
  );
  screen.querySelectorAll<HTMLElement>('[data-del-scan]').forEach((b) =>
    b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const id = b.dataset['delScan']!;
      const scanLabel = scans.find((s) => s.id === id)?.label ?? 'this scan';
      try {
        const refs = await reportsReferencingScan(id);
        const ok = await confirmModal(
          `Delete "${scanLabel}"?`,
          refs.length
            ? `${refs.length} saved report${refs.length > 1 ? 's' : ''} reference${refs.length > 1 ? '' : 's'} this scan. Reports stay readable (they are self-contained), but the scan itself cannot be recovered.`
            : 'This cannot be undone.',
        );
        if (!ok) return;
        await deleteScan(id);
        void libraryScreen();
      } catch (e) {
        toastError(e);
      }
    }),
  );
  screen.querySelectorAll<HTMLElement>('[data-del-report]').forEach((b) =>
    b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const title = reports.find((r) => r.id === b.dataset['delReport'])?.title ?? 'this report';
      const ok = await confirmModal(`Delete "${title}"?`, 'This cannot be undone.');
      if (!ok) return;
      await deleteReport(b.dataset['delReport']!).catch(toastError);
      void libraryScreen();
    }),
  );
  screen.querySelectorAll<HTMLElement>('[data-report]').forEach((c) =>
    c.addEventListener('click', () => (location.hash = `#/report/${c.dataset['report']!}`)),
  );
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
<div class="report-layout">
  <div class="row">
    <button class="btn" id="dl-report">Download HTML</button>
    <button class="btn" id="print-report">Print / PDF</button>
  </div>
  <div class="report-frame-wrap"><iframe class="report-frame" id="report-frame" title="Change report"></iframe></div>
</div>`, { back: true, tab: 'library' });
  // the report screen is the one screen that should own the full viewport
  // height (the iframe IS the content); flag the containers so CSS can give
  // the whole chain a definite height — percentage heights on a replaced
  // element never resolve through an auto-height ancestor (CRITIQUE.md #1)
  document.querySelector('main.screen')!.classList.add('screen-fill');
  document.getElementById('screen')!.classList.add('content-fill');

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
  const hash = location.hash || '#/scan';
  if (hash.startsWith('#/report/')) void reportScreen(hash.slice('#/report/'.length));
  else if (hash === '#/review' || hash === '#/compare') void reviewScreen();
  else if (hash === '#/library' || hash === '#/') void libraryScreen();
  else void scanScreen();
}

window.addEventListener('hashchange', route);
route();

// PWA: offline shell
if ('serviceWorker' in navigator && !import.meta.env.DEV) {
  void navigator.serviceWorker.register('./sw.js');
}
