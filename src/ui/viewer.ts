/**
 * Decimated three.js point-cloud viewer — the only place three.js is used
 * (ARCHITECTURE.md §3: core pipeline never imports three). Render-only
 * decimation follows the LingBot live-viewer pattern (point_cloud_viewer.py):
 * stride through points rather than rendering every one, so accumulation
 * during a live scan stays smooth.
 *
 * Rendering upgrades from docs/CRITIQUE.md: height-ramp vertex colors so
 * geometry reads as 3D, dimmed context + emphasized change regions in
 * compare views, auto-frame on load, a reset-view control, and orbit
 * distance clamps so the cloud can't be zoomed into oblivion.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  bboxCenter, bboxDiagonal, computeBbox, frameDistance,
  rampColors, rampColorsWithEmphasis, type Bbox,
} from './viewer-math';

const MAX_RENDERED_POINTS = 250_000;
const FOV_DEG = 60;

/** low/high height-ramp stops, 0..1 rgb */
const RAMP_BEFORE: [[number, number, number], [number, number, number]] = [
  [0.10, 0.28, 0.55], [0.45, 0.72, 1.0],
];
const RAMP_AFTER: [[number, number, number], [number, number, number]] = [
  [0.08, 0.42, 0.30], [0.42, 0.95, 0.62],
];

const KIND_COLORS: Record<string, number> = {
  added: 0x2ea043,
  removed: 0xff5d5d,
  shifted: 0xe0a832,
};

function decimate(positions: Float32Array, count: number): { positions: Float32Array; count: number } {
  if (count <= MAX_RENDERED_POINTS) return { positions: positions.subarray(0, count * 3) as Float32Array, count };
  const stride = Math.ceil(count / MAX_RENDERED_POINTS);
  const kept = Math.ceil(count / stride);
  const out = new Float32Array(kept * 3);
  let o = 0;
  for (let i = 0; i < count; i += stride) {
    out[3 * o] = positions[3 * i]!;
    out[3 * o + 1] = positions[3 * i + 1]!;
    out[3 * o + 2] = positions[3 * i + 2]!;
    o++;
  }
  return { positions: out, count: o };
}

export class PointCloudViewer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly clouds: THREE.Points[] = [];
  private readonly overlays: THREE.Object3D[] = [];
  private raf = 0;
  private homeBbox: Bbox | null = null;
  private resetBtn: HTMLButtonElement | null = null;

  constructor(private readonly container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0d12);

    this.camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.05, 200);
    this.camera.position.set(2, 2, 3);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0.5, 0);

    const grid = new THREE.GridHelper(6, 24, 0x232b3a, 0x151a24);
    grid.position.y = -0.051;
    this.scene.add(grid);

    this.mountResetButton();
    this.resize();
    window.addEventListener('resize', this.resize);
    this.animate();
  }

  /** overlay control inside .viewer-wrap; hidden until a cloud exists */
  private mountResetButton(): void {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'viewer-reset';
    btn.setAttribute('aria-label', 'Reset view');
    btn.innerHTML = '&#8982; reset view';
    btn.style.display = 'none';
    btn.addEventListener('click', () => this.frameHome());
    this.container.appendChild(btn);
    this.resetBtn = btn;
  }

  private resize = (): void => {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private animate = (): void => {
    this.raf = requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private disposeObjects(list: THREE.Object3D[]): void {
    for (const obj of list) {
      this.scene.remove(obj);
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose?.();
    }
    list.length = 0;
  }

  private addCloud(positions: Float32Array, count: number, colors: Float32Array): void {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    // viewer-math colors are authored in sRGB (design values); three treats
    // vertex colors as LINEAR and converts to sRGB on output, which washes
    // everything pale unless we pre-convert (gamma 2.2 approximation)
    const linear = new Float32Array(colors.length);
    for (let i = 0; i < colors.length; i++) linear[i] = Math.pow(colors[i]!, 2.2);
    geo.setAttribute('color', new THREE.BufferAttribute(linear, 3));
    const mat = new THREE.PointsMaterial({ vertexColors: true, size: 0.014, sizeAttenuation: true });
    const pts = new THREE.Points(geo, mat);
    this.clouds.push(pts);
    this.scene.add(pts);
  }

  /** Fit camera to a bbox and clamp orbit distances relative to its size. */
  private frameTo(bbox: Bbox | null): void {
    if (!bbox) return;
    this.homeBbox = bbox;
    const center = bboxCenter(bbox);
    const diag = bboxDiagonal(bbox) || 1;
    const dist = frameDistance(diag, FOV_DEG);
    this.controls.target.set(center[0], center[1], center[2]);
    // viewing direction: elevated three-quarter view
    const dir = new THREE.Vector3(0.55, 0.5, 1).normalize().multiplyScalar(dist);
    this.camera.position.set(center[0] + dir.x, center[1] + dir.y, center[2] + dir.z);
    this.controls.minDistance = Math.max(0.05, diag * 0.08);
    this.controls.maxDistance = dist * 3;
    this.controls.update();
    if (this.resetBtn) this.resetBtn.style.display = '';
  }

  frameHome(): void {
    this.frameTo(this.homeBbox);
  }

  /** Replace the displayed cloud; height-ramped colors, auto-framed. */
  setCloud(positions: Float32Array, count: number): void {
    this.disposeObjects(this.clouds);
    this.disposeObjects(this.overlays);
    if (count === 0) return;
    const d = decimate(positions, count);
    this.addCloud(d.positions, d.count, rampColors(d.positions, d.count, ...RAMP_BEFORE));
    // during live capture setCloud fires every frame — only frame the camera
    // when the bbox meaningfully grows, so the user's orbiting isn't hijacked
    const bbox = computeBbox(d.positions, d.count);
    if (bbox && (!this.homeBbox || bboxDiagonal(bbox) > bboxDiagonal(this.homeBbox) * 1.25)) {
      this.frameTo(bbox);
    } else if (bbox) {
      this.homeBbox = bbox;
    }
  }

  /**
   * Compare overlay: both clouds height-ramped, context dimmed, change
   * regions vivid. Call addRegionBoxes afterwards with the same regions.
   */
  setCompareClouds(
    a: { positions: Float32Array; count: number },
    b: { positions: Float32Array; count: number },
    emphasisBoxes: Bbox[] = [],
  ): void {
    this.disposeObjects(this.clouds);
    this.disposeObjects(this.overlays);
    const da = decimate(a.positions, a.count);
    const db = decimate(b.positions, b.count);
    this.addCloud(da.positions, da.count, rampColorsWithEmphasis(da.positions, da.count, ...RAMP_BEFORE, emphasisBoxes));
    this.addCloud(db.positions, db.count, rampColorsWithEmphasis(db.positions, db.count, ...RAMP_AFTER, emphasisBoxes));
    // frame the union
    const merged = new Float32Array((da.count + db.count) * 3);
    merged.set(da.positions.subarray(0, da.count * 3), 0);
    merged.set(db.positions.subarray(0, db.count * 3), da.count * 3);
    this.frameTo(computeBbox(merged, da.count + db.count));
  }

  /** Change regions: translucent filled boxes + bright edges, kind-colored. */
  addRegionBoxes(
    regions: Array<{ bboxMin: [number, number, number]; bboxMax: [number, number, number]; kind: string }>,
  ): void {
    for (const r of regions) {
      const size: [number, number, number] = [
        Math.max(0.02, r.bboxMax[0] - r.bboxMin[0]),
        Math.max(0.02, r.bboxMax[1] - r.bboxMin[1]),
        Math.max(0.02, r.bboxMax[2] - r.bboxMin[2]),
      ];
      const center: [number, number, number] = [
        (r.bboxMin[0] + r.bboxMax[0]) / 2,
        (r.bboxMin[1] + r.bboxMax[1]) / 2,
        (r.bboxMin[2] + r.bboxMax[2]) / 2,
      ];
      const color = KIND_COLORS[r.kind] ?? 0xffffff;
      const geo = new THREE.BoxGeometry(...size);

      const fill = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.14, depthWrite: false }),
      );
      fill.position.set(...center);
      this.overlays.push(fill);
      this.scene.add(fill);

      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 }),
      );
      edges.position.set(...center);
      this.overlays.push(edges);
      this.scene.add(edges);
    }
  }

  clearOverlays(): void {
    this.disposeObjects(this.overlays);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    this.controls.dispose();
    this.disposeObjects(this.clouds);
    this.disposeObjects(this.overlays);
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.resetBtn?.remove();
  }
}
