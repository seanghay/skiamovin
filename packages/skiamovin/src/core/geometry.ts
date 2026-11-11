export type Point = readonly [number, number];
export type Size = readonly [number, number];

/** A rectangle given by its edges. Methods return new rects. */
export class Rect {
  constructor(
    public left: number,
    public top: number,
    public right: number,
    public bottom: number,
  ) {}
  static fromXYWH(x: number, y: number, w: number, h: number): Rect {
    return new Rect(x, y, x + w, y + h);
  }
  static fromWH(w: number, h: number): Rect {
    return new Rect(0, 0, w, h);
  }
  static fromLTRB(l: number, t: number, r: number, b: number): Rect {
    return new Rect(l, t, r, b);
  }
  static empty(): Rect {
    return new Rect(0, 0, 0, 0);
  }
  get x(): number {
    return this.left;
  }
  get y(): number {
    return this.top;
  }
  width(): number {
    return this.right - this.left;
  }
  height(): number {
    return this.bottom - this.top;
  }
  centerX(): number {
    return (this.left + this.right) / 2;
  }
  centerY(): number {
    return (this.top + this.bottom) / 2;
  }
  isEmpty(): boolean {
    return !(this.right > this.left && this.bottom > this.top);
  }
  withOffset([dx, dy]: Point): Rect {
    return new Rect(this.left + dx, this.top + dy, this.right + dx, this.bottom + dy);
  }
  withOutset([dx, dy]: Point): Rect {
    return new Rect(this.left - dx, this.top - dy, this.right + dx, this.bottom + dy);
  }
  withInset([dx, dy]: Point): Rect {
    return this.withOutset([-dx, -dy]);
  }
  contains(x: number, y: number): boolean {
    return x >= this.left && x < this.right && y >= this.top && y < this.bottom;
  }
  intersect(o: RectLike): Rect | null {
    const r = toRect(o);
    const l = Math.max(this.left, r.left),
      t = Math.max(this.top, r.top);
    const rr = Math.min(this.right, r.right),
      b = Math.min(this.bottom, r.bottom);
    return rr > l && b > t ? new Rect(l, t, rr, b) : null;
  }
  join(o: RectLike): Rect {
    const r = toRect(o);
    return new Rect(
      Math.min(this.left, r.left),
      Math.min(this.top, r.top),
      Math.max(this.right, r.right),
      Math.max(this.bottom, r.bottom),
    );
  }
  toArray(): [number, number, number, number] {
    return [this.left, this.top, this.right, this.bottom];
  }
}

export type RectLike = Rect | readonly [number, number, number, number];

export function toRect(r: RectLike): Rect {
  return r instanceof Rect ? r : new Rect(r[0], r[1], r[2], r[3]);
}

export function rectArray(r: RectLike | null | undefined): Float32Array {
  if (!r) return new Float32Array(0);
  const x = toRect(r);
  return new Float32Array([x.left, x.top, x.right, x.bottom]);
}

/** A rounded rectangle: a rect plus radii for the four corners (TL, TR, BR, BL). */
export class RRect {
  constructor(
    public rect: Rect,
    public radii: [Point, Point, Point, Point],
  ) {}
  static newRectXY(rect: RectLike, rx: number, ry: number): RRect {
    const r = toRect(rect);
    const c: Point = [rx, ry];
    return new RRect(r, [c, c, c, c]);
  }
  static newOval(rect: RectLike): RRect {
    const r = toRect(rect);
    return RRect.newRectXY(r, r.width() / 2, r.height() / 2);
  }
  static newRect(rect: RectLike): RRect {
    return RRect.newRectXY(rect, 0, 0);
  }
  /** CSS-like: one radius, or [tl, tr, br, bl]. */
  static fromRadii(rect: RectLike, radii: number | readonly number[]): RRect {
    const r = toRect(rect);
    const v = typeof radii === 'number' ? [radii, radii, radii, radii] : radii;
    const c = (i: number): Point => [v[i] ?? 0, v[i] ?? 0];
    return new RRect(r, [c(0), c(1), c(2), c(3)]);
  }
  toArray(): Float32Array {
    const r = this.rect;
    const q = this.radii;
    return new Float32Array([
      r.left,
      r.top,
      r.right,
      r.bottom,
      q[0][0],
      q[0][1],
      q[1][0],
      q[1][1],
      q[2][0],
      q[2][1],
      q[3][0],
      q[3][1],
    ]);
  }
}

/** A 3x3 matrix, row-major. */
export class Matrix {
  readonly m: Float32Array;
  constructor(values?: ArrayLike<number>) {
    this.m = new Float32Array(9);
    if (values) this.m.set(values);
    else this.m.set([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  }
  static identity(): Matrix {
    return new Matrix();
  }
  static translate(dx: number, dy: number): Matrix {
    return new Matrix([1, 0, dx, 0, 1, dy, 0, 0, 1]);
  }
  static scale(sx: number, sy = sx, px = 0, py = 0): Matrix {
    return new Matrix([sx, 0, px - sx * px, 0, sy, py - sy * py, 0, 0, 1]);
  }
  static rotateDeg(deg: number, px = 0, py = 0): Matrix {
    const r = (deg * Math.PI) / 180;
    const c = Math.cos(r),
      s = Math.sin(r);
    return new Matrix([c, -s, px - c * px + s * py, s, c, py - s * px - c * py, 0, 0, 1]);
  }
  static skew(kx: number, ky: number): Matrix {
    return new Matrix([1, kx, 0, ky, 1, 0, 0, 0, 1]);
  }
  /** this × other */
  concat(o: Matrix): Matrix {
    const a = this.m,
      b = o.m;
    const r = new Float32Array(9);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        r[i * 3 + j] = a[i * 3]! * b[j]! + a[i * 3 + 1]! * b[3 + j]! + a[i * 3 + 2]! * b[6 + j]!;
    return new Matrix(r);
  }
  /** other × this */
  postConcat(o: Matrix): Matrix {
    return o.concat(this);
  }
  invert(): Matrix | null {
    const [a, b, c, d, e, f, g, h, i] = this.m as unknown as number[];
    const A = e! * i! - f! * h!,
      B = -(d! * i! - f! * g!),
      C = d! * h! - e! * g!;
    const det = a! * A + b! * B + c! * C;
    if (Math.abs(det) < 1e-12) return null;
    const inv = [
      A,
      -(b! * i! - c! * h!),
      b! * f! - c! * e!,
      B,
      a! * i! - c! * g!,
      -(a! * f! - c! * d!),
      C,
      -(a! * h! - b! * g!),
      a! * e! - b! * d!,
    ];
    return new Matrix(inv.map((v) => v / det));
  }
  mapPoint([x, y]: Point): [number, number] {
    const m = this.m;
    const w = m[6]! * x + m[7]! * y + m[8]!;
    return [(m[0]! * x + m[1]! * y + m[2]!) / w, (m[3]! * x + m[4]! * y + m[5]!) / w];
  }
  toArray(): Float32Array {
    return this.m;
  }
}

export type MatrixLike = Matrix | ArrayLike<number>;

export function matrixArray(m: MatrixLike | null | undefined): Float32Array {
  if (!m) return new Float32Array(0);
  return m instanceof Matrix ? m.m : new Float32Array(m as ArrayLike<number>);
}

/** A 4x4 matrix, row-major, for 3D transforms. */
export class M44 {
  readonly m: Float32Array;
  constructor(values?: ArrayLike<number>) {
    this.m = new Float32Array(16);
    if (values) this.m.set(values);
    else this.m.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }
  static identity(): M44 {
    return new M44();
  }
  static translate(x: number, y: number, z = 0): M44 {
    return new M44([1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1]);
  }
  static scale(x: number, y: number, z = 1): M44 {
    return new M44([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]);
  }
  /** Rotation of `radians` around `axis`. */
  static rotate(axis: readonly [number, number, number], radians: number): M44 {
    let [x, y, z] = axis;
    const len = Math.hypot(x, y, z) || 1;
    x /= len;
    y /= len;
    z /= len;
    const c = Math.cos(radians),
      s = Math.sin(radians),
      t = 1 - c;
    return new M44([
      t * x * x + c,
      t * x * y - s * z,
      t * x * z + s * y,
      0,
      t * x * y + s * z,
      t * y * y + c,
      t * y * z - s * x,
      0,
      t * x * z - s * y,
      t * y * z + s * x,
      t * z * z + c,
      0,
      0,
      0,
      0,
      1,
    ]);
  }
  /** A perspective projection, same as Skia's `SkM44::Perspective`. */
  static perspective(near: number, far: number, angle: number): M44 {
    const denomInv = 1 / (far - near);
    const halfAngle = angle * 0.5;
    const cot = Math.cos(halfAngle) / Math.sin(halfAngle);
    return new M44([cot, 0, 0, 0, 0, cot, 0, 0, 0, 0, (far + near) * denomInv, 2 * far * near * denomInv, 0, 0, -1, 1]);
  }
  /** A CSS-style perspective with the eye at distance `d` (pixels). */
  static cssPerspective(d: number): M44 {
    return new M44([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -1 / d, 1]);
  }
  static fromMatrix(m: Matrix): M44 {
    const a = m.m;
    return new M44([a[0]!, a[1]!, 0, a[2]!, a[3]!, a[4]!, 0, a[5]!, 0, 0, 1, 0, a[6]!, a[7]!, 0, a[8]!]);
  }
  /** this × other */
  concat(o: M44): M44 {
    const a = this.m,
      b = o.m;
    const r = new Float32Array(16);
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[i * 4 + k]! * b[k * 4 + j]!;
        r[i * 4 + j] = s;
      }
    return new M44(r);
  }
  postConcat(o: M44): M44 {
    return o.concat(this);
  }
  toArray(): Float32Array {
    return this.m;
  }
}
