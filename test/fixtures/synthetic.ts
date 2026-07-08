/**
 * Synthetic scene + trajectory builders shared by capture/align/diff/pipeline
 * tests. Two structurally different scenario families prove pipeline
 * genericness (ARCHITECTURE.md §12): an interior "enclosure" scene scanned
 * from inside, and a free-standing "subject" scene orbited from outside.
 * Nothing in src/ knows these names — they exist only in tests.
 */

import type { Pose } from '../../src/core/types';
import { fromYawPitchTranslation, fromYawTranslation } from '../../src/core/mat4';
import type { SceneBox, SyntheticScene } from '../../src/capture/mock';

export const box = (
  min: [number, number, number],
  max: [number, number, number],
): SceneBox => ({ min, max });

/**
 * Enclosure scenario: 4m x 3m footprint, 2.5m tall shell (walls + floor),
 * with a few interior objects. Scanned from the middle, panning 360°.
 */
export function enclosureScene(objects: SceneBox[] = []): SyntheticScene {
  const t = 0.05; // shell thickness
  return {
    boxes: [
      box([-2, -0.05 - t, -1.5], [2, -0.05, 1.5]),          // floor
      box([-2 - t, -0.05, -1.5], [-2, 2.5, 1.5]),           // wall -x
      box([2, -0.05, -1.5], [2 + t, 2.5, 1.5]),             // wall +x
      box([-2, -0.05, -1.5 - t], [2, 2.5, -1.5]),           // wall -z
      box([-2, -0.05, 1.5], [2, 2.5, 1.5 + t]),             // wall +z
      ...objects,
    ],
  };
}

/**
 * Subject scenario: a free-standing 1.8m x 0.6m x 1.2m body on a ground
 * plane, orbited from outside. Structurally different from the enclosure:
 * convex subject, outward-in viewing, open space.
 */
export function subjectScene(extras: SceneBox[] = []): SyntheticScene {
  return {
    boxes: [
      // 6 x 6 m ground: big enough to orbit on, small enough that synthetic
      // captures keep realistic point density per voxel
      box([-3, -0.05, -3], [3, 0, 3]),
      box([-0.9, 0, -0.3], [0.9, 1.2, 0.3]),                // subject body
      ...extras,
    ],
  };
}

/**
 * Pan-in-place trajectory: stand at `at`, sweep 360° twice — once level and
 * once pitched 35° down, the way a person actually scans a space (a level
 * pan from standing height never puts the floor in the frustum; found the
 * hard way, see RESUME.md).
 */
export function panTrajectory(at: [number, number, number], steps = 24): Pose[] {
  const poses: Pose[] = [];
  const half = Math.ceil(steps / 2);
  for (const pitch of [0, (-35 * Math.PI) / 180]) {
    for (let i = 0; i < half; i++) {
      const yaw = (i / half) * Math.PI * 2;
      poses.push({ matrix: fromYawPitchTranslation(yaw, pitch, at) });
    }
  }
  return poses;
}

/** Orbit trajectory: circle of radius r around `center`, camera facing the center. */
export function orbitTrajectory(
  center: [number, number, number],
  radius: number,
  height: number,
  steps = 24,
): Pose[] {
  const poses: Pose[] = [];
  // pitch down toward the subject's mid-height so low geometry stays in frame
  const pitch = -Math.atan2(height - center[1], radius);
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const x = center[0] + radius * Math.sin(a);
    const z = center[2] + radius * Math.cos(a);
    // camera at (x, height, z) looking at center: default camera looks down -z;
    // yaw that turns -z toward the center is exactly `a`
    poses.push({ matrix: fromYawPitchTranslation(a, pitch, [x, height, z]) });
  }
  return poses;
}
