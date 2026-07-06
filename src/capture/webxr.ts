/**
 * WebXRCaptureSource: immersive-ar session with the depth-sensing module.
 * Chrome/Android (ARCore) is the only shipping implementation (2026-07,
 * ARCHITECTURE.md §3) — everything here feature-detects and throws
 * ScanDiffError with an actionable reason instead of failing silently.
 *
 * Browser-API-touching code is confined to this file (plus store/db.ts and ui/).
 * It is intentionally thin: one frame in, one CaptureFrame out — all logic
 * (unprojection, keyframing, anchoring, accumulation) is in pure modules.
 *
 * NOTE: typed against the WebXR depth-sensing spec via local ambient types
 * (webxr.d.ts) because lib.dom omits the module. Untested on real hardware in
 * this build session — see ARCHITECTURE.md §10.3 and RESUME.md.
 */

import type { Intrinsics } from '../core/types';
import { ScanDiffError } from '../core/types';
import type { CaptureFrame, CaptureOptions, CaptureSource } from './source';

interface DepthInfoLike {
  data: ArrayBuffer;
  width: number;
  height: number;
  rawValueToMeters: number;
}

export class WebXRCaptureSource implements CaptureSource {
  private session: XRSession | null = null;
  private stopRequested = false;

  static async isSupported(): Promise<boolean> {
    const xr = (navigator as unknown as { xr?: XRSystem }).xr;
    if (!xr) return false;
    try {
      return await xr.isSessionSupported('immersive-ar');
    } catch {
      return false;
    }
  }

  async *start(_opts?: CaptureOptions): AsyncIterable<CaptureFrame> {
    const xr = (navigator as unknown as { xr?: XRSystem }).xr;
    if (!xr) throw new ScanDiffError('no-webxr', 'This browser has no WebXR. Use Chrome on an ARCore-capable Android device.');
    if (!(await WebXRCaptureSource.isSupported())) {
      throw new ScanDiffError('no-webxr', 'Immersive AR is not supported on this device.');
    }

    let session: XRSession;
    try {
      session = await xr.requestSession('immersive-ar', {
        requiredFeatures: ['depth-sensing'],
        depthSensing: {
          usagePreference: ['cpu-optimized'],
          dataFormatPreference: ['float32', 'luminance-alpha'],
        },
      } as XRSessionInit);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotAllowedError') {
        throw new ScanDiffError('permission-denied', 'Camera/AR permission was denied.');
      }
      throw new ScanDiffError('no-depth', 'Depth sensing is unavailable on this device.');
    }
    this.session = session;

    const refSpace = await session.requestReferenceSpace('local');
    const gl = document.createElement('canvas').getContext('webgl2', { xrCompatible: true });
    if (!gl) throw new ScanDiffError('no-webxr', 'WebGL2 unavailable.');
    await session.updateRenderState({
      baseLayer: new XRWebGLLayer(session, gl),
    });

    // pump XR frames into an async queue the iterator drains
    const queue: CaptureFrame[] = [];
    let notify: (() => void) | null = null;
    let ended = false;
    const onFrame = (_time: number, frame: XRFrame): void => {
      if (this.stopRequested) return;
      session.requestAnimationFrame(onFrame);
      const viewerPose = frame.getViewerPose(refSpace);
      if (!viewerPose) return; // tracking not established this frame
      const view = viewerPose.views[0];
      if (!view) return;
      const getDepth = (frame as unknown as { getDepthInformation?: (v: XRView) => DepthInfoLike | null }).getDepthInformation;
      const depthInfo = getDepth ? getDepth.call(frame, view) : null;
      if (!depthInfo) return;

      const { width, height, rawValueToMeters } = depthInfo;
      // float32 or luminance-alpha (uint16) — normalize to meters
      const raw = depthInfo.data;
      let depth: Float32Array;
      if (raw.byteLength === width * height * 4) {
        const f = new Float32Array(raw);
        depth = new Float32Array(width * height);
        for (let i = 0; i < depth.length; i++) depth[i] = f[i]! * rawValueToMeters;
      } else {
        const u16 = new Uint16Array(raw);
        depth = new Float32Array(width * height);
        for (let i = 0; i < depth.length; i++) depth[i] = u16[i]! * rawValueToMeters;
      }

      // intrinsics from the projection matrix: pm[0] = 2fx/w-normalized, pm[5] = 2fy/h-normalized
      const pm = view.projectionMatrix;
      const intrinsics: Intrinsics = {
        fx: pm[0]! / 2,
        fy: pm[5]! / 2,
        cx: (1 - pm[8]!) / 2,
        cy: (1 + pm[9]!) / 2,
      };

      queue.push({
        depth,
        depthSize: { w: width, h: height },
        pose: { matrix: new Float32Array(view.transform.matrix) },
        intrinsics,
        timestamp: _time,
      });
      notify?.();
    };
    session.requestAnimationFrame(onFrame);
    session.addEventListener('end', () => {
      ended = true;
      notify?.();
    });

    try {
      while (!this.stopRequested && !ended) {
        if (queue.length === 0) {
          await new Promise<void>((res) => { notify = res; });
          notify = null;
          continue;
        }
        yield queue.shift()!;
      }
    } finally {
      await this.stop();
    }
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    if (this.session) {
      const s = this.session;
      this.session = null;
      try {
        await s.end();
      } catch {
        // already ended
      }
    }
  }
}
