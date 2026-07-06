/**
 * Minimal ambient WebXR declarations — just the surface webxr.ts touches.
 * lib.dom does not ship WebXR types; the full @types/webxr package is
 * unnecessary weight for one file.
 */

interface XRSystem {
  isSessionSupported(mode: string): Promise<boolean>;
  requestSession(mode: string, init?: XRSessionInit): Promise<XRSession>;
}

interface XRSessionInit {
  requiredFeatures?: string[];
  optionalFeatures?: string[];
  depthSensing?: {
    usagePreference: string[];
    dataFormatPreference: string[];
  };
}

interface XRSession extends EventTarget {
  requestReferenceSpace(type: string): Promise<XRReferenceSpace>;
  requestAnimationFrame(cb: (time: number, frame: XRFrame) => void): number;
  updateRenderState(state: { baseLayer?: XRWebGLLayer }): Promise<void>;
  end(): Promise<void>;
}

interface XRReferenceSpace {
  readonly __brand?: 'XRReferenceSpace';
}

interface XRFrame {
  getViewerPose(refSpace: XRReferenceSpace): XRViewerPose | null;
}

interface XRViewerPose {
  readonly views: readonly XRView[];
}

interface XRView {
  readonly projectionMatrix: Float32Array;
  readonly transform: { readonly matrix: Float32Array };
}

declare class XRWebGLLayer {
  constructor(session: XRSession, gl: WebGL2RenderingContext | WebGLRenderingContext);
}
