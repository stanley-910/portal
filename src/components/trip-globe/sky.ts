// The night sky behind the globe: stippled stars and nebulae, generated from a seed.
// Each load rolls a new seed unless one is passed in; a shared seed (a trip id) draws the same sky on every screen.
// The stars are a single instanced draw and the nebulae a texture baked once per seed, so the cost per frame
// doesn't grow with the sky.
import { FS_SKY_BAKE, FS_STAR, VS_QUAD, VS_STAR } from "./shaders";
import { add, cross, dot, mul, norm, sub, type Vec3 } from "./vec";

export interface Program {
  p: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
}
type Compile = (vs: string, fs: string, attrs: string[]) => Program;

const BAKE_W = 2048;
const BAKE_H = 1024;
const MAX_BLOBS = 12; // matches uBlob[12] in FS_SKY_BAKE

/** FNV-1a, so a trip id or any string makes a stable seed. */
export function seedOf(seed: string | number): number {
  const s = String(seed);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** A fresh seed, for a sky nobody asked to share. */
export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

/** mulberry32: small, fast and good enough for placing stars. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomDir(r: () => number): Vec3 {
  const z = r() * 2 - 1;
  const p = r() * Math.PI * 2;
  const s = Math.sqrt(1 - z * z);
  return [s * Math.sin(p), z, s * Math.cos(p)];
}

/**
 * n directions spread evenly over the sphere, but never in the same pattern twice: a Fibonacci lattice, turned to a
 * random orientation, with each point nudged up to `jitter` of the lattice spacing. Even spacing means any view of
 * the sky holds about the same number of stars, with no clumps or bare patches.
 */
function scatter(r: () => number, n: number, jitter: number): Vec3[] {
  // a uniformly random orientation: one random axis, then a second made perpendicular to it
  const ax = randomDir(r);
  const ay = randomDir(r);
  const by = norm(sub(ay, mul(ax, dot(ay, ax))));
  const bz = cross(ax, by);
  const spacing = Math.sqrt((4 * Math.PI) / n);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const z = 1 - (2 * i + 1) / n;
    const rad = Math.sqrt(1 - z * z);
    const th = golden * i;
    const p = norm(add(add(mul(ax, rad * Math.cos(th)), mul(by, z)), mul(bz, rad * Math.sin(th))));
    const q = randomDir(r);
    const t = norm(sub(q, mul(p, dot(q, p))));
    const a = spacing * jitter * Math.sqrt(r());
    out.push(norm(add(mul(p, Math.cos(a)), mul(t, Math.sin(a)))));
  }
  return out;
}

/**
 * Per-star instance data. aStar: direction, then the shell radius (0 = at infinity).
 * aLook: core radius (px), spike length (px, 0 = round), spike angle, brightness.
 * The view shows roughly a tenth of the sky, so these counts leave a few spiked stars on screen at a time.
 */
export function generateStars(seed: number) {
  const r = rng(seed);
  const stars: number[] = [];
  const looks: number[] = [];
  // a third of each class sits on a nearer shell, so the layers part as the camera moves
  const shell = () => (r() < 0.35 ? 5 + r() * 9 : 0);
  const add = (d: Vec3, core: number, spike: number, rot: number, bright: number) => {
    stars.push(d[0], d[1], d[2], shell());
    looks.push(core, spike, rot, bright);
  };
  for (const d of scatter(r, 48, 0.35)) add(d, 2.4 + r() * 1.6, 24 + Math.pow(r(), 1.5) * 52, (r() - 0.5) * 0.3, 1);
  for (const d of scatter(r, 150, 0.45)) add(d, 1.8 + Math.pow(r(), 2.5) * 2.4, 0, 0, 0.9 + r() * 0.1);
  for (const d of scatter(r, 900, 0.5)) add(d, 0.6 + r() * 0.6, 0, 0, 0.5 + r() * 0.5);
  return { stars: new Float32Array(stars), looks: new Float32Array(looks), count: stars.length / 4 };
}

/** A handful of nebula centres: xyz direction, w angular radius. */
export function generateNebulae(seed: number) {
  const r = rng(seed ^ 0x9e3779b9);
  const blobs = scatter(r, 9, 0.3).map((d) => [...d, 0.1 + r() * 0.16]);
  const offset: Vec3 = [r() * 100, r() * 100, r() * 100];
  return { blobs: new Float32Array(blobs.flat()), count: blobs.length, offset };
}

export class Sky {
  private pStar: Program;
  private pBake: Program;
  private vao: WebGLVertexArrayObject | null;
  private count = 0;
  private corners: WebGLBuffer | null;
  private bufStar: WebGLBuffer | null;
  private bufLook: WebGLBuffer | null;
  readonly texture: WebGLTexture | null;

  constructor(
    private gl: WebGL2RenderingContext,
    compile: Compile,
  ) {
    this.pStar = compile(VS_STAR, FS_STAR, ["aCorner", "aStar", "aLook"]);
    this.pBake = compile(VS_QUAD, FS_SKY_BAKE, ["aPos"]);

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.corners = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const instanced = (loc: number) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(loc, 1);
      return b;
    };
    this.bufStar = instanced(1);
    this.bufLook = instanced(2);
    gl.bindVertexArray(null);

    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG8, BAKE_W, BAKE_H);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  /** Regenerates the stars and re-bakes the nebulae. `quad` is a VAO holding the full-screen triangle. */
  setSeed(seed: string | number, quad: WebGLVertexArrayObject | null) {
    const gl = this.gl;
    const s = seedOf(seed);

    const st = generateStars(s);
    this.count = st.count;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufStar);
    gl.bufferData(gl.ARRAY_BUFFER, st.stars, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufLook);
    gl.bufferData(gl.ARRAY_BUFFER, st.looks, gl.STATIC_DRAW);

    const neb = generateNebulae(s);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
    gl.viewport(0, 0, BAKE_W, BAKE_H);
    gl.disable(gl.BLEND);
    const { p, u } = this.pBake;
    gl.useProgram(p);
    gl.bindVertexArray(quad);
    gl.uniform2f(u.uRes, BAKE_W, BAKE_H);
    gl.uniform4fv(u["uBlob[0]"], neb.blobs.subarray(0, MAX_BLOBS * 4));
    gl.uniform1i(u.uBlobs, Math.min(neb.count, MAX_BLOBS));
    gl.uniform3fv(u.uSeed, neb.offset);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
  }

  /** Frees the GPU resources. The context itself outlives the engine (Strict Mode remounts onto it). */
  dispose() {
    const gl = this.gl;
    gl.deleteTexture(this.texture);
    gl.deleteBuffer(this.corners);
    gl.deleteBuffer(this.bufStar);
    gl.deleteBuffer(this.bufLook);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.pStar.p);
    gl.deleteProgram(this.pBake.p);
  }

  /**
   * Draws the stars over the globe pass. `setCam` loads the camera uniforms; the nebula texture must already be
   * bound to `unit`.
   */
  draw(setCam: (u: Program["u"]) => void, res: [number, number], dpr: number, ink: Vec3, inkAlpha: number, unit: number) {
    if (!this.count) return;
    const gl = this.gl;
    const { p, u } = this.pStar;
    gl.useProgram(p);
    gl.bindVertexArray(this.vao);
    setCam(u);
    gl.uniform2f(u.uRes, res[0], res[1]);
    gl.uniform1f(u.uDpr, dpr);
    gl.uniform1i(u.uSky, unit);
    gl.uniform3fv(u.uInk, ink);
    gl.uniform1f(u.uSkyInk, inkAlpha);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }
}
