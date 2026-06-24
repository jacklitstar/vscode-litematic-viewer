import { mat4 } from 'gl-matrix';
import type { CameraView, Vec3 } from '../types';

export interface Aabb {
  min: Vec3;
  max: Vec3;
}

export interface OrbitCameraFitOptions {
  aspect?: number;
  fovYDeg?: number;
  xRotation?: number;
  yRotation?: number;
  padding?: number;
  minDistance?: number;
}

export interface OrbitCameraFitResult extends CameraView {
  focus: Vec3;
  xRotation: number;
  yRotation: number;
  viewDist: number;
  near: number;
  far: number;
}

export const DEFAULT_ORBIT_X_ROTATION = 0.45;
export const DEFAULT_ORBIT_Y_ROTATION = 0.72;

const WORLD_UP: Vec3 = [0, 1, 0];

const subtract = (a: Vec3, b: Vec3): Vec3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];

const add = (a: Vec3, b: Vec3): Vec3 => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];

const scale = (v: Vec3, factor: number): Vec3 => [
  v[0] * factor,
  v[1] * factor,
  v[2] * factor,
];

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const length = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);

const normalize = (v: Vec3): Vec3 => {
  const len = length(v);
  if (len <= 1e-8) {
    return [0, 0, 1];
  }
  return [v[0] / len, v[1] / len, v[2] / len];
};

const getAabbCorners = (aabb: Aabb): Vec3[] => {
  const { min, max } = aabb;
  return [
    [min[0], min[1], min[2]],
    [min[0], min[1], max[2]],
    [min[0], max[1], min[2]],
    [min[0], max[1], max[2]],
    [max[0], min[1], min[2]],
    [max[0], min[1], max[2]],
    [max[0], max[1], min[2]],
    [max[0], max[1], max[2]],
  ];
};

export const createAabbFromSize = (size: Vec3): Aabb => ({
  min: [0, 0, 0],
  max: [size[0], size[1], size[2]],
});

export const getAabbCenter = (aabb: Aabb): Vec3 => [
  (aabb.min[0] + aabb.max[0]) / 2,
  (aabb.min[1] + aabb.max[1]) / 2,
  (aabb.min[2] + aabb.max[2]) / 2,
];

export const getOrbitCameraPosition = (
  focus: Vec3,
  viewDist: number,
  xRotation: number,
  yRotation: number,
): Vec3 => {
  const view = mat4.create();
  mat4.translate(view, view, [0, 0, -viewDist]);
  mat4.rotate(view, view, xRotation, [1, 0, 0]);
  mat4.rotate(view, view, yRotation, [0, 1, 0]);
  mat4.translate(view, view, [-focus[0], -focus[1], -focus[2]]);
  const invView = mat4.create();
  mat4.invert(invView, view);
  return [invView[12], invView[13], invView[14]];
};

export const createOrbitViewMatrix = (
  focus: Vec3,
  xRotation: number,
  yRotation: number,
  viewDist: number,
): mat4 => {
  const view = mat4.create();
  mat4.translate(view, view, [0, 0, -viewDist]);
  mat4.rotate(view, view, xRotation, [1, 0, 0]);
  mat4.rotate(view, view, yRotation, [0, 1, 0]);
  mat4.translate(view, view, [-focus[0], -focus[1], -focus[2]]);
  return view;
};

export const fitOrbitCameraToAabb = (
  aabb: Aabb,
  options: OrbitCameraFitOptions = {},
): OrbitCameraFitResult => {
  const aspect = Math.max(0.1, options.aspect ?? 1);
  const fovYDeg = options.fovYDeg ?? 35;
  const xRotation = options.xRotation ?? DEFAULT_ORBIT_X_ROTATION;
  const yRotation = options.yRotation ?? DEFAULT_ORBIT_Y_ROTATION;
  const padding = Math.max(1.01, options.padding ?? 1.12);
  const minDistance = Math.max(1, options.minDistance ?? 3);
  const focus = getAabbCenter(aabb);

  const unitCameraPos = getOrbitCameraPosition(focus, 1, xRotation, yRotation);
  const cameraDir = normalize(subtract(unitCameraPos, focus));
  const forward = normalize(scale(cameraDir, -1));
  let right = cross(forward, WORLD_UP);
  if (length(right) <= 1e-6) {
    right = [1, 0, 0];
  } else {
    right = normalize(right);
  }
  const up = normalize(cross(right, forward));

  const fovY = fovYDeg * Math.PI / 180;
  const tanY = Math.tan(fovY / 2);
  const tanX = tanY * aspect;

  let requiredDistance = minDistance;
  let maxDepth = 0;
  let minDepth = Number.POSITIVE_INFINITY;

  for (const corner of getAabbCorners(aabb)) {
    const relative = subtract(corner, focus);
    const depthOffset = dot(relative, cameraDir);
    const extentX = Math.abs(dot(relative, right));
    const extentY = Math.abs(dot(relative, up));
    requiredDistance = Math.max(
      requiredDistance,
      depthOffset + extentX / Math.max(tanX, 1e-5),
      depthOffset + extentY / Math.max(tanY, 1e-5),
    );
    maxDepth = Math.max(maxDepth, depthOffset);
    minDepth = Math.min(minDepth, depthOffset);
  }

  const viewDist = Math.max(minDistance, requiredDistance * padding);
  const cameraPosition = add(focus, scale(cameraDir, viewDist));
  const nearestSurface = Math.max(0.01, viewDist - maxDepth);
  const farthestSurface = Math.max(nearestSurface + 1, viewDist - minDepth);
  const near = Math.max(0.01, Math.min(0.5, nearestSurface * 0.5));
  const far = Math.max(near + 10, farthestSurface * 2);

  return {
    focus,
    xRotation,
    yRotation,
    viewDist,
    near,
    far,
    cameraPosition,
    view: createOrbitViewMatrix(focus, xRotation, yRotation, viewDist),
  };
};
