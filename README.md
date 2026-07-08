# Scan-Diff

Domain-agnostic two-session 3D scan comparison. Scan a space or object with a
phone, save it, scan it again later — Scan-Diff aligns both point clouds and
reports **what changed**: added, removed, and moved material, with evidence
photos, bounding boxes, size estimates, and a written summary.

The product is the diff and the report, not the point cloud. The core pipeline
contains zero vertical-specific logic — the same code path serves property
condition records, site progress tracking, asset intake/pickup comparison, and
anything else shaped like "did this thing change".

## How it works

```
capture (WebXR Depth API) ─→ align (marker coarse + trimmed ICP) ─→ diff (voxel occupancy, occlusion-aware) ─→ report (self-contained HTML)
```

- **Capture** — real per-pixel sensor depth via the WebXR Depth API (Chrome on
  ARCore-capable Android). Every frame contributes points; keyframes keep
  evidence photos. A printed QR code placed in the scene anchors both sessions
  to a shared reference frame. A mock capture source (synthetic ray-marched
  scenes) drives all tests and the desktop demo.
- **Align** — marker-to-marker coarse alignment (exact regardless of where
  either scan started), refined by trimmed point-to-point ICP (kd-tree
  correspondences, Umeyama SVD). Alignment quality is graded; a poor grade
  refuses to diff rather than producing a silently wrong report.
- **Diff** — both clouds voxelized (5 cm default); occupancy compared with a
  1-voxel tolerance ring; "removed" only counts where the rescan *provably
  saw* the empty space (frustum + occlusion ray-march against its own
  geometry); connected components become change regions; matching
  added/removed pairs are classified as moved. Photos are annotation — the
  change signal is purely geometric, so lighting changes can't fake a diff.
- **Report** — one self-contained HTML file: summary, per-region before/after
  evidence with bounding boxes, size estimates, coverage disclosure, alignment
  quality. No external requests; prints cleanly to PDF.

## Privacy

Local-first: scans live in the browser's IndexedDB on the device. Nothing
leaves the device. Deleting a scan deletes its data.

## Development

```
npm install
npm test         # 76 tests: unit per module + cross-scenario integration
npm run typecheck
```

`docs/ARCHITECTURE.md` — every design decision, algorithms to implementation
precision. `docs/RESUME.md` — build state log (read this first when resuming).

## Capturing a scan

Three paths, one pipeline:

1. **AR capture** — Chrome on an ARCore-capable Android device: live WebXR
   depth, walk around the subject, keep the printed QR code in view.
2. **File upload** — export a point cloud (`.ply`) from any LiDAR scanning
   app (Polycam, Scaniverse, 3D Scanner App) and drop it on the Scan screen.
   Works on every device, including iOS.
3. **`.scandiff` exchange** — export any saved scan from the Library as a
   single portable file and import it on another device.

Review offers two detection strictness levels: Standard (5 cm voxels) and
Fine (2 cm, for dense careful scans).

## Status

Full pipeline + PWA UI built, tested (109 automated tests), and
browser-verified from 320 px phones to 1920 px desktops, including the
production bundle. The only hardware-gated remainder is a live smoke test on
an ARCore device (the WebXR path is written to spec and feature-detected).
See docs/STATUS.md for the precise ledger.

## License

Apache-2.0. Streaming-state / drift-correction / align-then-diff patterns
informed by the Apache-2.0 LingBot repositories (github.com/Robbyant) — see
docs/ARCHITECTURE.md §2 for the pattern-level attribution table.
