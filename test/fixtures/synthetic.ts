/**
 * Synthetic scene + trajectory builders shared by capture/align/diff/pipeline
 * tests. Two structurally different scenario families prove pipeline
 * genericness (ARCHITECTURE.md §12): an interior "enclosure" scene scanned
 * from inside, and a free-standing "subject" scene orbited from outside.
 * Nothing in src/ knows these names — they exist only in tests.
 */

import type { Pose } from '../../src/core/types';
import { fromYawTranslation } from '../../src/core/mat4';
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
      box([-5, -0.05, -5], [5, 0, 5]),                       // ground
      box([-0.9, 0, -0.3], [0.9, 1.2, 0.3]),                // subject body
      ...extras,
    ],
  };
}

/** Pan-in-place trajectory: stand at `at`, rotate `steps` view directions over 360°. */
export function panTrajectory(at: [number, number, number], steps = 24): Pose[] {
  const poses: Pose[] = [];
  for (let i = 0; i < steps; i++) {
    const yaw = (i / steps) * Math.PI * 2;
    poses.push({ matrix: fromYawTranslation(yaw, at) });
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
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const x = center[0] + radius * Math.sin(a);
    const z = center[2] + radius * Math.cos(a);
    // camera at (x, height, z) looking at center: default camera looks down -z;
    // yaw that turns -z toward the center is exactly `a`
    poses.push({ matrix: fromYawTranslation(a, [x, height, z]) });
  }
  return poses;
}
