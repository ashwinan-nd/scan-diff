/**
 * Decimated three.js point-cloud viewer — the only place three.js is used
 * (ARCHITECTURE.md §3: core pipeline never imports three). Render-only
 * decimation follows the LingBot live-viewer pattern (point_cloud_viewer.py):
 * stride through points rather than rendering every one, so accumulation
 * during a live scan stays smooth.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const MAX_RENDERED_POINTS = 250_000;

export class PointCloudViewer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private points: THREE.Points | null = null;
  private raf = 0;

  constructor(private readonly container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0e13);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 100);
    this.camera.position.set(2, 2, 3);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0.5, 0);

    const grid = new THREE.GridHelper(6, 24, 0x2a3140, 0x1a1f29);
    this.scene.add(grid);
    const axes = new THREE.AxesHelper(0.3);
    this.scene.add(axes);

    this.resize();
    window.addEventListener('resize', this.resize);
    this.animate();
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

  /** Replace the displayed cloud, decimating to a render-friendly point budget. */
  setCloud(positions: Float32Array, count: number, color = 0x4da3ff): void {
    if (this.points) {
      this.scene.remove(this.points);
      this.points.geometry.dispose();
      (this.points.material as THREE.Material).dispose();
      this.points = null;
    }
    if (count === 0) return;

    const stride = Math.max(1, Math.floor(count / MAX_RENDERED_POINTS));
    const kept = Math.ceil(count / stride);
    const out = new Float32Array(kept * 3);
    let o = 0;
    for (let i = 0; i < count; i += stride) {
      out[3 * o] = positions[3 * i]!;
      out[3 * o + 1] = positions[3 * i + 1]!;
      out[3 * o + 2] = positions[3 * i + 2]!;
      o++;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(out, 3));
    const mat = new THREE.PointsMaterial({ color, size: 0.012, sizeAttenuation: true });
    this.points = new THREE.Points(geo, mat);
    this.scene.add(this.points);
  }

  /** Two-cloud overlay for the compare screen: A in one color, B (aligned) in another. */
  setCompareClouds(
    a: { positions: Float32Array; count: number },
    b: { positions: Float32Array; count: number },
  ): void {
    this.setCloud(a.positions, a.count, 0x4da3ff);
    const stride = Math.max(1, Math.floor(b.count / MAX_RENDERED_POINTS));
    const kept = Math.ceil(b.count / stride);
    const out = new Float32Array(kept * 3);
    let o = 0;
    for (let i = 0; i < b.count; i += stride) {
      out[3 * o] = b.positions[3 * i]!;
      out[3 * o + 1] = b.positions[3 * i + 1]!;
      out[3 * o + 2] = b.positions[3 * i + 2]!;
      o++;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(out, 3));
    const mat = new THREE.PointsMaterial({ color: 0x33d17a, size: 0.012, sizeAttenuation: true });
    const overlay = new THREE.Points(geo, mat);
    this.scene.add(overlay);
  }

  /** Highlight change regions as wireframe boxes, colored by kind. */
  addRegionBoxes(regions: Array<{ bboxMin: [number, number, number]; bboxMax: [number, number, number]; kind: string }>): void {
    const colors: Record<string, number> = { added: 0x2ea043, removed: 0xf85149, shifted: 0xd29922 };
    for (const r of regions) {
      const size: [number, number, number] = [
        r.bboxMax[0] - r.bboxMin[0], r.bboxMax[1] - r.bboxMin[1], r.bboxMax[2] - r.bboxMin[2],
      ];
      const center: [number, number, number] = [
        (r.bboxMin[0] + r.bboxMax[0]) / 2, (r.bboxMin[1] + r.bboxMax[1]) / 2, (r.bboxMin[2] + r.bboxMax[2]) / 2,
      ];
      const geo = new THREE.BoxGeometry(...size);
      const edges = new THREE.EdgesGeometry(geo);
      const mat = new THREE.LineBasicMaterial({ color: colors[r.kind] ?? 0xffffff, linewidth: 2 });
      const box = new THREE.LineSegments(edges, mat);
      box.position.set(...center);
      this.scene.add(box);
      geo.dispose();
    }
  }

  clearOverlays(): void {
    // remove everything except the grid/axes helpers (first two children) and the base cloud
    const keep = new Set<THREE.Object3D>([this.scene.children[0]!, this.scene.children[1]!]);
    if (this.points) keep.add(this.points);
    for (const child of [...this.scene.children]) {
      if (!keep.has(child)) this.scene.remove(child);
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
