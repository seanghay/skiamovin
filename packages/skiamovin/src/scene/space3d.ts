// Flat things (cards, images, text) placed in 3D space and seen through one perspective camera, drawn back to front.
import { box, type NodeStyle, type SceneNode } from './nodes.ts';

type M = number[];

function mul(a: M, b: M): M {
  const out = new Array<number>(16).fill(0);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[r * 4 + k]! * b[k * 4 + c]!;
      out[r * 4 + c] = s;
    }
  return out;
}

const translate = (x: number, y: number, z: number): M => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
const scale = (s: number): M => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1];

function rotateX(deg: number): M {
  const r = (deg * Math.PI) / 180,
    c = Math.cos(r),
    s = Math.sin(r);
  return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1];
}
function rotateY(deg: number): M {
  const r = (deg * Math.PI) / 180,
    c = Math.cos(r),
    s = Math.sin(r);
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1];
}
function rotateZ(deg: number): M {
  const r = (deg * Math.PI) / 180,
    c = Math.cos(r),
    s = Math.sin(r);
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function apply(m: M, [x, y, z]: readonly [number, number, number]): [number, number, number, number] {
  return [0, 1, 2, 3].map((r) => m[r * 4]! * x + m[r * 4 + 1]! * y + m[r * 4 + 2]! * z + m[r * 4 + 3]!) as [
    number,
    number,
    number,
    number,
  ];
}

/** Camera tilt presets in degrees, from film language: how far the camera looks down (positive) or up. */
export const cameraAngles = Object.freeze({ overhead: 80, high: 25, eyeLevel: 0, low: -20, undershot: -55 });

export interface Camera3D {
  /** Vertical field of view in degrees. Default 40. */
  fov?: number;
  /** Degrees the camera looks down (positive) or up; see `cameraAngles`. */
  tilt?: number;
  /** Degrees the camera turns around the vertical axis. */
  pan?: number;
  /** Degrees the camera rolls. */
  roll?: number;
  /** The point the camera looks at, in world coordinates. Default the origin. */
  target?: readonly [number, number, number];
  /** Distance from the target. Default: where the plane z = 0 appears at its true size. */
  distance?: number;
  /**
   * Depth of field for `space3d`: the distance from the camera, in pixels, that is in focus. Things nearer or
   * farther blur more the larger the `aperture` (default 20 pixels of blur at twice or half the focus distance).
   */
  focus?: number;
  aperture?: number;
}

export interface Item3D {
  node: SceneNode;
  /** Center of the node in world coordinates: x right, y down, z toward the camera. */
  x?: number;
  y?: number;
  z?: number;
  rotateX?: number;
  rotateY?: number;
  rotateZ?: number;
  scale?: number;
  /** Hide the node when its back faces the camera, as for the two sides of a flipping card. */
  backface?: 'visible' | 'hidden';
}

/**
 * World to camera space (`eye`, looking down +z, depth in pixels) and camera to screen (`project`, divide by the
 * last row). @internal
 */
export function cameraTransform(viewport: { width: number; height: number }, camera: Camera3D): { eye: M; project: M } {
  const fov = camera.fov ?? 40;
  const focal = viewport.height / 2 / Math.tan((fov * Math.PI) / 360);
  const distance = camera.distance ?? focal;
  const [tx, ty, tz] = camera.target ?? [0, 0, 0];
  // World to camera: move the target to the origin, turn the world against the camera, then push it back.
  const view = mul(
    translate(0, 0, -distance),
    mul(
      rotateZ(-(camera.roll ?? 0)),
      mul(rotateX(-(camera.tilt ?? 0)), mul(rotateY(-(camera.pan ?? 0)), translate(-tx, -ty, -tz))),
    ),
  );
  const flip: M = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1];
  // Perspective onto the screen, centered, with depth = focal at true size.
  const project: M = [focal, 0, viewport.width / 2, 0, 0, focal, viewport.height / 2, 0, 0, 0, 1, 0, 0, 0, 1, 0];
  return { eye: mul(flip, view), project };
}

/** Model matrix: scale, then rotate X, Y, Z, then move. @internal */
export function placement(p: {
  x?: number;
  y?: number;
  z?: number;
  rotateX?: number;
  rotateY?: number;
  rotateZ?: number;
  scale?: number;
}): M {
  return mul(
    translate(p.x ?? 0, p.y ?? 0, p.z ?? 0),
    mul(rotateZ(p.rotateZ ?? 0), mul(rotateY(p.rotateY ?? 0), mul(rotateX(p.rotateX ?? 0), scale(p.scale ?? 1)))),
  );
}

export { mul as multiply44 };

/**
 * A 3D space seen through a perspective camera. Each item is a node (sized with a fixed `size`) placed by its center
 * and rotations. Items are drawn back to front, keeping their order when they're at the same depth.
 *
 * ```ts
 * space3d({ width: 1920, height: 1080 }, { tilt: cameraAngles.high, pan: t * 20 }, [
 *   { node: card, rotateY: t * 180, backface: 'hidden' },
 * ])
 * ```
 */
export function space3d(
  viewport: { width: number; height: number },
  camera: Camera3D,
  items: readonly Item3D[],
  style: NodeStyle = {},
): SceneNode {
  const { width, height } = viewport;
  const { eye: view, project } = cameraTransform(viewport, camera);
  const placed = items.map((it, index) => {
    const size = it.node.style.size;
    const w = typeof size === 'object' && typeof size.width === 'number' ? size.width : 0;
    const h = typeof size === 'object' && typeof size.height === 'number' ? size.height : 0;
    const model = mul(
      translate(it.x ?? 0, it.y ?? 0, it.z ?? 0),
      mul(
        rotateZ(it.rotateZ ?? 0),
        mul(
          rotateY(it.rotateY ?? 0),
          mul(rotateX(it.rotateX ?? 0), mul(scale(it.scale ?? 1), translate(-w / 2, -h / 2, 0))),
        ),
      ),
    );
    const eye = mul(view, model);
    const center = apply(eye, [w / 2, h / 2, 0]);
    const normal = apply(eye, [w / 2, h / 2, 1]);
    // Camera space after the flip looks down +z; the node faces the camera when its normal points back at it.
    const facing = normal[2] - center[2] < 0;
    return { it, index, eye, depth: center[2], facing };
  });
  const children: SceneNode[] = [];
  for (const p of placed.filter((p) => p.depth > 1).sort((a, b) => b.depth - a.depth || a.index - b.index)) {
    if (p.it.backface === 'hidden' && !p.facing) continue;
    // Divide by depth through the matrix's last row, as Skia's M44 does for perspective.
    const m = mul(project, p.eye);
    const node = {
      ...p.it.node,
      style: { ...p.it.node.style, position: 'absolute' as const, inset: { left: 0, top: 0 } },
    };
    const placedNode = box(
      { position: 'absolute', inset: { left: 0, top: 0 }, transformOrigin: [0, 0], transform: { matrix: m } },
      [node],
    );
    // Blur on screen grows with distance from the focus plane. It's applied after projection, in screen space,
    // because image filters don't follow a perspective transform.
    const blur =
      camera.focus === undefined ? 0 : ((camera.aperture ?? 20) * Math.abs(p.depth - camera.focus)) / p.depth;
    children.push(
      blur > 0.25
        ? box({ position: 'absolute', inset: { left: 0, top: 0 }, size: { width, height }, blur }, [placedNode])
        : placedNode,
    );
  }
  return box({ size: { width, height }, ...style }, children);
}
