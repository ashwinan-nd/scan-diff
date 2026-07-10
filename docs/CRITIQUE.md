# Scan-Diff — Harsh Independent Critique

**Date:** 2026-07-10. **Author:** review pass by the build agent, deliberately adversarial, zero code changes made during this review. **Purpose:** hand a complete, evidence-backed defect/gap list to whichever model works this next — every item below is something to *fix*, not something to re-discover.

**Scope of this document:** visuals, layout/responsiveness, functional correctness, accessibility, privacy/network, and the report artifact. Evidence screenshots live in `docs/critique-evidence/*.png`, referenced by filename below. Every finding was reproduced live against the dev server (`npm run dev`, port 5179) via Playwright MCP — drag-orbit, scroll-zoom, file upload, delete flows, rapid clicks, viewport resizing 300–2560px logical CSS pixels, DOM/computed-style inspection, and console/network capture. Nothing here is speculative; every claim has a reproduction path stated.

**Test environment note:** the browser context used for this review scales logical CSS pixels by 1.25× versus the `browser_resize` request (confirmed via `window.innerWidth` cross-checks). All widths quoted below are the *verified actual* CSS px, not the requested value.

**One methodology correction for the record:** an early pass flagged the report's SVG region-outline boxes as broken (`viewBox` parse errors, escaped-quote attributes). That was a false positive caused by my own extraction method (`browser_evaluate` → file save round-tripped the HTML through JSON stringification, double-escaping the quotes). Verified against both the source template (`src/report/html.ts`, clean) and a live in-app render (clean, zero console errors). **The SVG region overlays are not broken.** Flagging this so nobody "fixes" a bug that doesn't exist.

---

## Executive summary

The backend/pipeline (capture → align → diff → report generation) is **correct** — every functional test in this pass confirmed it: correct region detection, correct alignment math, correct race-condition guarding, correct privacy (zero external network calls, verified against a full asset-load capture), no crashes under any stress input tried (malformed uploads, absurd scan names, rapid clicks, extreme zoom, orphaned references). None of that is in dispute.

The **presentation layer** is where this falls apart, and it falls apart at exactly the points the user already named plus several they hadn't seen yet:

1. **One outright BREAKING bug**: the report viewer shows a ~150px scrollable peephole instead of the report, on every screen size, every time. Root-caused precisely below.
2. **One outright BREAKING accessibility bug**: the scan-picker cards in Review have no keyboard affordance at all — a keyboard-only user cannot complete the core compare flow.
3. The desktop layout is a narrow mobile column stranded in a sea of unused dark space — confirmed by direct measurement, not just impression. The user's "not properly centered" complaint is precisely correct and precisely measurable (72px off true center at one tested width).
4. The 3D point-cloud visuals — the actual visual centerpiece of the product — are functionally solid but presentationally close to illegible: flat unlit single-color point mass, before/after overlay indistinguishable at default view, no auto-frame, no reset control.
5. The report is a correct but visually inert document: no branding, no at-a-glance overview, evidence tiles that are empty gray boxes in any session without real camera photos (which is every session captured in this environment, since there's no ARCore hardware here).
6. Scan/report organization has zero structure beyond a flat reverse-chronological list — confirmed to actively produce ambiguous, colliding entries in normal use (two scans both named "Demo baseline," indistinguishable except by a tiny timestamp).
7. One real WCAG AA contrast failure, quantified and located precisely.

None of this needed to be a research question — a next model can go straight to fixing every item below.

---

## Findings

### [BREAKING] Report viewer shrinks to ~150px regardless of viewport — report is real, container is broken

- **Location:** `src/ui/main.ts` `reportScreen()`, wrap div `style="flex:1;min-height:60dvh"` → `src/ui/style.css` `.report-frame { height: 100%; }`. Route: `#/report/:id`.
- **What's wrong:** `iframe.report-frame`'s `height: 100%` never resolves to a real percentage, because its flex-item parent only sets `min-height` (not `height`), and that parent's own ancestor chain (`.stack` with inline `height:100%`, nested inside `.content` which has no explicit height — a plain block div) never establishes the definite height that CSS percentage-height resolution requires for a *replaced element* like `<iframe>`. The iframe falls back to the browser UA-default intrinsic size (`150px`), confirmed by direct measurement (`getBoundingClientRect().height === 150` while `getComputedStyle(wrap).height === "600px"` in the same frame — the parent IS correctly sized, the iframe just isn't inheriting it).
- **Proof the content itself is fine:** `frame.contentDocument.readyState === "complete"`, `body.scrollHeight === 2268`, `body.children.length === 9` — a fully-formed, fully-correct report document sits behind a 150px window with its own internal scrollbar.
- **How observed:** `docs/critique-evidence/critique-report-viewport-only.png` and `critique-report-view.png` (full-page screenshot terminates after the metadata line; everything below — Summary, all 4 region cards, evidence tiles — is invisible without scrolling inside a tiny nested scrollbar most users will never notice exists). `critique-report-full-content.png` shows the same report with the iframe height forced to its content height at runtime (diagnostic only, not a code change) — proving the content renders perfectly once contained correctly.
- **Expected behavior:** the report should fill essentially the whole screen below the toolbar, on every device size, exactly the way the compare-viewer canvas does one screen over.
- **Fix direction (documented, not applied):** give the flex chain an actual definite height instead of relying on `height:100%` cascading through an auto-height block ancestor — e.g. make `.content` (or a report-specific wrapper) a flex column with `height: 100%` set on every link in the chain down from `main.screen` (which does have real height), or size the iframe via JS (`ResizeObserver` on the container, or set the iframe height in pixels after layout) instead of pure CSS percentage inheritance. This is one of the most common CSS/iframe interaction bugs and has several standard fixes; pick one and add a regression test that asserts the iframe's rendered height is within some tolerance of its content height at multiple viewport sizes.

### [BREAKING] Review's scan-picker cards are keyboard-inaccessible — a core flow has no keyboard path

- **Location:** `src/ui/main.ts` `reviewScreen()`, `pick()` template — `<div class="card tappable" data-pick="...">`. Route: `#/review`.
- **What's wrong:** these divs have no `tabindex`, no `role`, no `aria-selected`/`aria-pressed`, and no keyboard event handler — confirmed directly: `card.hasAttribute('tabindex') === false`, `getAttribute('role') === null` on the actually-selected card. A keyboard-only user (screen-reader users, motor-impairment users using switch/keyboard nav, or simply someone tabbing through the page) cannot select *either* scan for comparison. The entire compare flow — the product's core function — is unreachable without a pointing device.
- **How observed:** direct DOM inspection (`browser_evaluate` querying the selected card's attributes) after a real mouse-driven selection; no amount of Tab-key exploration reaches these elements because they're not in the tab order at all.
- **Expected behavior:** each pickable card should be a real interactive control — `role="radio"` inside `role="radiogroup"` (matching the pattern already correctly used for the Detection Strictness segmented control two sections below it, which DOES have `role="radiogroup"`/`role="radio"` — so the correct pattern exists in the same file and just wasn't applied here), with `tabindex="0"`, Enter/Space handling, and `aria-checked` reflecting selection state.
- **Severity note:** this is worse than a typical a11y polish gap — it's a full flow lockout, which is why it's rated BREAKING and not DEGRADED.

### [DEGRADED] Desktop layout is a narrow column adrift in unused space, and measurably off-center

- **Location:** `src/ui/style.css` `.content { max-width: 1040px; margin: 0 auto; }` inside `main.screen` (which sits beside a fixed 200px nav rail at ≥1024px). Every screen, every desktop width.
- **What's wrong, quantified:** at a verified 2400px-wide viewport (nav rail 200px + main area 2200px), `.content` centers correctly *within the 2200px main area* (580px gap left, 580px gap right — confirmed via `getBoundingClientRect`) — but the header `<h1>` title's center sits at **72px right of the true visual center of the browser window**, because centering-within-main-area and centering-within-full-window are different math once a fixed-width sidebar is in play, and the app does the former while a viewer's eye expects the latter. This is precisely the user's complaint, precisely reproduced and measured, not just a vibe.
- **Compounding problem:** even setting centering aside, the content column is capped at 1040px and the rest of a 1920–2560px monitor is just dark empty background — confirmed visually (`critique-scan-ultrawide.png`, `critique-library-ultrawide.png`): on a real desktop monitor the entire app occupies roughly the top-left third of the screen, vertically ending around 830px into a 1080px viewport with nothing below. This isn't "content that happens to be short" — it's a mobile-first layout that was never actually redesigned for desktop, just center-capped. A CEO opening this on a 27"+ display sees mostly void.
- **Expected behavior:** either (a) truly center the content column relative to the full viewport regardless of the nav rail (compute margin accounting for the rail width), or (b) actually use the space — e.g., a real desktop dashboard layout where the 3D viewer and stats/regions panel sit side-by-side rather than stacked in a narrow column, especially on the Review results screen where there's obviously paired content (viewer + legend + stats) that could be a two-pane layout at wide viewports.
- **How observed:** `docs/critique-evidence/critique-scan-ultrawide.png`, `critique-library-ultrawide.png`, plus the raw `getBoundingClientRect`/`getComputedStyle` numbers quoted above.

### [DEGRADED] Point cloud rendering is flat, unlit, and visually illegible as "before vs after"

- **Location:** `src/ui/viewer.ts` `PointCloudViewer.setCloud()` / `setCompareClouds()` — `THREE.PointsMaterial({ color, size: 0.012, sizeAttenuation: true })`, no lighting, no depth-based shading, both clouds rendered at identical opacity/size directly overlapping in world space.
- **What's wrong:** a single flat-color unlit point material with no ambient occlusion, no depth cueing, and no size/opacity falloff renders as a shapeless colored blob with zero perceptible structure at a glance — confirmed in `critique-scan-mobile-midcapture.png`, where a completed 166k-point capture of a distinctly-shaped enclosure renders as an amorphous blue mass with no readable geometry. On the compare screen, the two clouds (before = blue, after = green) occupy the *same physical space* since they're the same room scanned twice — at default framing they blend into an undifferentiated teal mass (`critique-compare-viewer-initial.png`); the only signal that anything changed is a set of thin, low-contrast orange/red/amber wireframe boxes that are easy to lose against the point noise. This is the product's actual visual centerpiece — the thing that's supposed to make "here's what changed" self-evident at a glance — and right now it requires the viewer to already know what they're looking for.
- **What's confirmed NOT wrong:** the interaction layer itself is solid. Drag-to-orbit works correctly (`critique-compare-viewer-after-drag.png` shows a proper rotated view after synthetic pointer-event drag testing), scroll-to-zoom works in both directions with no crashes or geometry artifacts even at extreme zoom (`critique-compare-viewer-zoomout.png`, `critique-compare-viewer-zoomin.png` — the latter actually reveals the region boxes and colored blobs clearly once close enough, proving the underlying data and region math are correct; it's purely a default-framing/material problem).
- **Missing entirely:** no "frame all" / reset-view control. Zoming out 30 notches (a plausible trackpad gesture) shrinks the model to a barely-visible speck with no way back except reloading the page — confirmed by reproduction.
- **Expected behavior:** depth- or normal-based point shading (even a cheap fake: color by height or by distance from camera) so the geometry reads as 3D instead of flat; dim/desaturate the unchanged/overlapping region and let only the changed regions pop in full color, instead of the reverse (currently everything is equally bright and the changes are the hardest thing to see); add a reset/frame-to-content button; clamp `OrbitControls` min/max distance to something sane relative to the scanned content's bounding box.

### [DEGRADED] Report is a correct but visually inert document with no identity

- **Location:** `src/report/html.ts` (generation) and the report viewer route.
- **What's wrong:** the report is plain black-on-white system-sans text with a single thin horizontal rule as its only visual structure. There is no Scan-Diff branding/logo/wordmark anywhere in the artifact itself — a downloaded or printed report, once separated from the app chrome, carries zero indication of what tool produced it. There's no whole-scene overview image (only per-region crops), no color/visual hierarchy distinguishing a big obvious change from a marginal one (badges are uniform size/weight regardless of region size or confidence), and — this is unavoidable given the test environment, but still worth stating plainly — every evidence tile in a session captured without a real camera (i.e., every session in this environment, since there's no ARCore hardware here) is a flat gray rectangle with a thin orange outline and the caption "no photo captured," repeated once per region per before/after side. Four regions × two sides = 8 nearly-identical empty gray boxes. Confirmed in `critique-report-full-content.png`.
- **Expected behavior:** at minimum, a masthead with product identity; some visual weight differentiation between a large/high-confidence change and a small/marginal one; and — separately from a code fix — this project needs a real photographed test capture (or a materially better synthetic-photo generator) before the report's visual quality can be fairly judged with actual evidence photos in place, since the geometry-only fallback is, by design, the least visually interesting path through the report renderer.
- **Not a defect, but adjacent and worth the next model's attention:** the report title is always the mechanical template `"Scan comparison: {A.label} → {B.label}"` — functionally fine, but it's the literal `<title>` and H1 of every report, and it inherits every naming problem from the scans below.

### [DEGRADED] Scan/report organization is a flat list with zero structure — confirmed to actively produce ambiguous state, not just theoretically capable of it

- **Location:** `src/ui/main.ts` `libraryScreen()`.
- **What's wrong, with reproduction:** running the demo capture twice (once on 2026-07-08, once on 2026-07-10, both defaulting to the label "Demo baseline") produced **two scans in the Library named identically "Demo baseline,"** distinguishable only by a small timestamp in the metadata line (`critique-library-ultrawide.png` shows both). Worse: when selecting scans for Review, Playwright's own `getByText` — a reasonable proxy for how a real user visually scans a list — matched the WRONG card on the first attempt precisely because of this collision (documented in the raw session trace of this review). If an automated tool and a careful reviewer can both mis-select here, a real user absolutely will. The Reports list has the identical problem at one remove: six reports in the list, several literally titled `"Scan comparison: sample-before → sample-after"` (three separate report runs of the exact same pair, at different times, with no way to tell from the list which is "the current one" or why there are three).
- **No grouping, filtering, search, or sort control exists anywhere in the Library.** No thumbnail/preview per scan or report. No badge on a report card indicating how many changes it found (a user must open every report to know if it's interesting). No indication in the Scans list of which scans are already paired into an existing report vs. never compared.
- **Compounding gap — orphaned reports, silently:** deleting a scan that existing reports reference produces **zero warning**. Reproduced directly: deleted `sample-before` (referenced by 3 saved reports) with a single click, no confirmation dialog of any kind, and the app gave no indication those reports existed or would be affected. The reports themselves don't break (they're self-contained HTML snapshots, verified to still open with zero console errors — `critique-library-ultrawide.png` precedes; orphan-open verified separately), but the user has no way to know from the UI which of their reports now reference a deleted scan.
- **Expected behavior:** unique-name enforcement or at least a visible warning on collision; delete confirmation, especially when the target is referenced by saved reports ("This scan is used in 3 reports — delete anyway?"); some grouping/pairing model in the Library (even simple client-side heuristics — group by matching label prefix, or an explicit "subject" field the user sets once and reuses); search/filter for users with more than a handful of scans, which will be everyone within a week of real use; a result-count badge on report cards.

### [DEGRADED] WCAG AA contrast failure on `--text-faint`, used pervasively

- **Location:** `src/ui/style.css` `--text-faint: #5c6577` on `--bg: #0a0d12`.
- **What's wrong, quantified:** contrast ratio **3.32:1** against the page background (computed via the standard WCAG relative-luminance formula, not eyeballed) — fails the 4.5:1 AA threshold for normal text; only clears the 3:1 AA-large threshold, and none of its uses are large text. Against `--bg-elev` it's even worse at 3.15:1. This color is used for: **unselected nav tab labels** (Scan/Review/Library when not the active tab — meaning it's wrong on literally every screen, all the time, for 2 of 3 nav items), every `.section-label` ("SCANS", "REPORTS", "DETECTION STRICTNESS"), the upload dropzone hint text, and every stat-tile label ("REGIONS", "ADDED", "REMOVED", "MOVED", "ALIGN RMSE" on the Review results). For comparison, `--text-dim` (#8b95a9) at 6.46:1 passes comfortably — the palette has a correctly-contrasted gray already; `--text-faint` is the one broken step below it.
- **How observed:** in-browser computation via `browser_evaluate`, formula and inputs stated above, reproducible by anyone.
- **Expected behavior:** either lighten `--text-faint` to clear 4.5:1 against both `--bg` and `--bg-elev`, or restrict its use to genuinely decorative/large-text contexts only and switch the six use-sites listed above to `--text-dim`.

### [POLISH] Error toast overlaps interactive content instead of a corner/inline placement

- **Location:** `src/ui/main.ts` `toastError()` — `position:fixed; ... bottom:76px`.
- **What's wrong:** on the Scan screen, an error toast (e.g., after a malformed upload) renders directly on top of the Scan-name input and partially over the Demo buttons (`critique-malformed-upload.png`) — during its full 6-second visible window, those controls are visually obscured (not necessarily un-clickable, but visually blocked, which reads as broken to a user mid-task).
- **Expected behavior:** corner toast (top-right is conventional) or an inline banner that pushes content down rather than floating over it.

### [POLISH] No input length limit on scan names

- **Location:** `src/ui/main.ts` scan-label `<input>`, no `maxlength`.
- **What's wrong:** a pasted full sentence (240 characters, tested) is accepted without warning, wraps a Library card to three lines, and would appear verbatim and equally unbounded in every report title. No crash, no truncation — just unbounded. Confirmed via reproduction (`critique-long-name.png`).
- **Expected behavior:** a practical `maxlength` (60–80 chars is typical for a "name" field) with a character counter as it approaches the limit, or graceful truncation with ellipsis in card/title display regardless of underlying length.

### [POLISH] Production bundle is a single 605 kB (158 kB gzip) chunk

- **Location:** `vite build` output, `dist/assets/index-*.js`.
- **What's wrong:** everything — three.js, the full pipeline, the UI — ships as one JS file with no route-based or vendor code-splitting. Not breaking (build succeeds, app works), but for a product this session's own goal explicitly says should "impress the top 500 CEOs," first-load performance is part of that impression, and 605 kB of JS before first paint is avoidable.
- **Expected behavior:** split three.js (only needed once a viewer actually mounts) from the core pipeline/UI shell; consider lazy-loading the Review 3D viewer specifically, since Library and initial Scan-screen-without-a-capture-running don't need it at all.

---

## What's actually working — stated plainly, so effort isn't wasted re-verifying it

- **Backend correctness is solid.** Alignment, diff, region classification, and report-data generation all produced correct results across every scenario tried this pass, including a genuinely adversarial one (malformed PLY upload correctly rejected with a precise, useful error message: `PLY: malformed vertex row 1 ("garbage row not numbers")`).
- **Privacy claim is true, verified, not just asserted.** A full network capture across a hard page reload showed every single request going to `localhost:5179` — zero external hosts, zero telemetry, zero analytics beacons. This directly and correctly serves the "security-conscious enterprise/IT" persona in the matrix below.
- **Race-condition handling is correct.** Triple-firing the Review button synchronously produced exactly one report, not three — the synchronous `disabled=true` guard works as intended.
- **Responsive breakpoint mechanics are correct**, even if the resulting desktop layout is under-designed (see above). Verified the exact 1024px boundary: 1022px CSS width correctly shows the mobile bottom-tab layout, 1025px correctly shows the desktop rail — no off-by-one, no flash of wrong layout.
- **Keyboard focus is NOT globally broken** — real `<button>` elements (Save, Delete, Export, the Detection Strictness segmented control, tab bar) all retain the browser's native focus ring; nothing in the stylesheet resets `outline: none`. The keyboard-accessibility failure is specific to the `.card.tappable` picker pattern in Review (see BREAKING finding above), not a systemic issue.
- **Orphaned-report handling doesn't crash.** A report referencing a since-deleted scan still opens cleanly with zero console errors — it's a UX/warning gap (user isn't told), not a data-integrity crash.
- **3D interaction primitives (orbit, zoom) are functionally correct** at every extreme tested, including 30 zoom-out and 80 zoom-in wheel events with no geometry corruption, no crash, no z-fighting.
- **Extension-agnostic drag-and-drop correctly rejects unsupported files** with the right toast copy, and doesn't crash on any malformed input thrown at it.

---

## Persona-based critique matrix

The user asked for something like a 500-persona sweep; 500 literal individual walkthroughs isn't a meaningful unit of rigor (it's not 500 materially different code paths), so this is the honest version: a representative spread of personas, each mapped to exactly which findings above would actually stop or annoy them, so a next model can prioritize by whose pain is worst.

| Persona | What they'd hit first | Which findings hit hardest |
|---|---|---|
| **Skeptical CEO/exec, five-minute first look** | Opens on a laptop or external monitor, sees a narrow column in a dark void; opens a sample report and sees what looks like a broken/empty page (doesn't know to scroll inside a 150px box) | Desktop layout/centering, **Report viewer BREAKING bug** — this persona alone justifies fixing that bug first |
| **Non-technical field user (property manager, insurance adjuster)** | Runs the demo or uploads a scan, tries to name it something descriptive, later can't tell their scans apart in the list | Name-length/collision, no organization/grouping, no delete confirmation |
| **Keyboard-only / screen-reader user** | Tries to Tab through Review to pick scans | **Scan-picker keyboard-accessibility BREAKING bug** — total flow lockout, not degraded |
| **Low-vision user / bright outdoor environment (a field-use product should expect this)** | Squints at "SCANS"/"REPORTS" headers and stat labels | WCAG contrast failure on `--text-faint` |
| **Power user with 50+ scans over months** | Scrolls a long undifferentiated flat list looking for one specific comparison | Organization/search/filter gap — currently untested at this scale but the flat-list architecture guarantees it degrades linearly with volume |
| **Security-conscious enterprise IT reviewer** | Opens devtools, checks the network tab before approving the tool for use | **This persona is fully satisfied** — verified zero external requests |
| **Mobile-only user (no laptop, doing everything on a phone in the field)** | Uses the app at 300–390px width | Structurally fine — no overflow, no crash, dropzone/buttons all usable; weakest complaint here is the same flat-color point cloud being even harder to read on a small screen |
| **First-time evaluator comparing this to a polished SaaS product before deciding to trust it with real data** | Judges "does this look like a company I can rely on" from visual polish alone in the first 30 seconds | Flat point-cloud rendering, inert/unbranded report, desktop void — this persona is the direct target of the user's "no finesse, no real complexity" complaint, and the complaint is accurate |
| **Someone dragging a random wrong file onto the dropzone by mistake** | Drops a `.docx` or screenshot instead of a `.ply` | **Handled correctly** — clear rejection, no crash |
| **User who scrolls their trackpad while looking at the 3D compare view** | Zooms out further than intended | No reset/frame-to-fit control, model can vanish to a speck with no recovery short of reload |

---

## Direct response to the user's own stated criticisms

Quoting the ask, then the independent verdict on each, since the user explicitly wants confirmation these were taken seriously rather than talked around:

- *"no refinement, no advanced design principles... no neomorphism, no advanced text fonts, no claymorphism, no minimalism... no finesse and true detail, no real complexity"* — **Accurate.** The design system (soft-depth shadows, mono labels, status pills) added in a prior pass is a real but shallow layer over a fundamentally plain component set; there is no consistent advanced design language applied with intent, and the point-cloud/report visuals — the parts that would actually carry "finesse" — are the weakest pieces, detailed above.
- *"the page itself is not scaled properly to the browser and I need it to properly be centered... if the browser window size changes Scan-Diff needs to accommodate for that change"* — **Accurate, and now precisely measured** (72px off true center at a tested width, plus the deeper problem that "centered in a capped column" isn't the same as "designed for the available space"). Responsive breakpoint *mechanics* do work correctly (verified at the exact pixel boundary); what's missing is a real desktop layout, not viewport-adaptation plumbing.
- *"the report is still extremely generic and there's no real finesse to it"* — **Accurate**, detailed in the report finding above, plus the **BREAKING container bug** that makes it look outright broken on top of being plain.
- *"there needs to be a better way to order and organize scans and reports"* — **Accurate, and reproduced concretely** (colliding "Demo baseline" names, ambiguous duplicate reports, silent orphaning on delete) rather than left as a vague concern.
- *"the entirety of the project just feels very shallow"* — the backend evidence in this document says the engineering underneath is not shallow (correct alignment/diff math, correct privacy, correct race-condition handling, correct edge-case rejection); the *presentation* of that work is where the shallowness lives, and every instance of it above is specific and actionable rather than a matter of taste.

---

## Suggested priority order for whoever picks this up

1. Report iframe height bug (BREAKING, trivial blast radius, huge perceived-quality impact — this is probably the single highest-leverage fix in this whole document).
2. Scan-picker keyboard accessibility (BREAKING, a full flow is legally/ethically inaccessible right now).
3. Desktop layout redesign — not just a centering patch, an actual wide-viewport layout (this is the load-bearing fix for "feels shallow"/"no finesse").
4. Point-cloud material + auto-frame/reset control (this is the second load-bearing fix for the same complaint — the product's visual centerpiece needs to read as 3D and needs to differentiate before/after at a glance).
5. Report visual design pass + branding (blocked in part on having real evidence photos to design around — flag to the user that a real-device capture, or at least a materially better synthetic photo generator, would make this fix much more judgeable).
6. Library organization: naming collisions, delete confirmation, orphan warnings, basic grouping/search.
7. Contrast fix (mechanical, low-risk, do it opportunistically alongside any of the above).
8. Toast placement, name length limit, bundle splitting — pick up whenever convenient, none of these are urgent.

No code was changed to produce this document. Everything above is reproducible from a clean `npm install && npm run dev`.
