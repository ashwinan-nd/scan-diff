# CRITIQUE.md — Resolutions

Every finding from `docs/CRITIQUE.md` (2026-07-10), its fix, and the evidence.
All fixes verified live via Playwright plus the automated suite (129 tests,
tsc clean, production build clean). Evidence screenshots: `docs/screenshots/v3-*.png`.

| # | Finding (severity) | Resolution | Evidence |
|---|---|---|---|
| 1 | Report iframe collapses to 150px (BREAKING) | Definite-height flex chain (`screen-fill` → `content-fill` → `report-layout` → `report-frame-wrap`); iframe `flex:1; min-height:0` | Measured 846px at a 1000px viewport (85%, was 150px); v3-report-redesign.png shows full-height report |
| 2 | Scan pickers keyboard-inaccessible (BREAKING) | Cards are `role="radio"` in labeled radiogroups, `tabindex="0"`, Enter/Space select, `aria-checked` synced, `:focus-visible` ring | Keyboard-only flow driven end-to-end: focus → Enter → aria-checked=true → run enabled → report generated |
| 3 | Desktop layout off-center + narrow column in void (DEGRADED) | Header/main padded to compensate the 200px rail; ≥1280px two-pane grids (Review: viewer+side rail; Scan: viewer+controls); ≥1440px max-width 1400px; symmetric topbar spacers | Centering re-measured: 0px offset (was 72px); v3-review-twopane.png, v3-scan-ultrawide-final.png |
| 4 | Point cloud flat/illegible; overlay indistinguishable; no reset (DEGRADED) | Height-ramp vertex colors (viewer-math.ts, 10 tests); compare view dims context toward background and keeps change regions vivid; translucent filled region boxes + bright edges; auto-frame on load; reset-view button; orbit min/max clamped to cloud size. Root-caused a pale-wash regression to three r152+ color management (design colors now pre-converted to linear) | v3-viewer-ramped-v3.png: context recedes, changes glow |
| 5 | Report generic/unbranded; empty gray evidence boxes (DEGRADED) | Masthead + inline-SVG wordmark, stat band, kind-colored region cards with relative-size bars and confidence meters, top-down footprint maps (region solid, siblings ghosted, origin + 1m scale) replacing empty boxes; print-exact masthead | v3-report-redesign.png, v3-report-footprints.png; 16 report tests incl. new contracts |
| 6 | Flat unstructured Library; name collisions; silent orphaning (DEGRADED) | organize.ts (filter/sort/stem-grouping, 8 tests); search + sort controls; group headers with counts; delete confirmation alertdialog listing referencing report count (Cancel pre-focused, Escape/backdrop cancel); name-collision auto-suffix on save; report cards show change-count badges | v3-library-modal.png: "6 saved reports reference this scan" |
| 7 | --text-faint 3.32:1 WCAG AA failure (DEGRADED) | `#5c6577` → `#7e889b` | Re-computed in-browser: 5.45:1 on --bg, 5.16:1 on --bg-elev — both pass 4.5:1 |
| 8 | Toast covers inputs (POLISH) | Top-right stacking toast host, slide-in/out animation | Code path exercised via malformed-upload toast during the sweep |
| 9 | No name length limit (POLISH) | `maxlength="80"` on the scan-name input | DOM attribute present |
| 10 | 605kB single bundle (POLISH) | three.js split to its own chunk (function-form manualChunks for rolldown); app shell 72.7kB (25.7 gzip), three 543kB (135 gzip) parallel-loaded; Inter font assets bundled locally | `npm run build` output in commit aa5be02 |

Additional (not in CRITIQUE.md, found during this pass):
- Inter Variable (OFL-1.1, @fontsource npm package, no CDN) as the app UI font — the report keeps system stacks to stay self-contained.
- Dev-server `fs.allow` for the worktree's symlinked node_modules (font files 403'd in dev only; production was unaffected).

Privacy invariant re-verified after all changes: zero non-localhost network requests.
