/*!
 * DataWave — a lightweight WebGL point-cloud "ocean" for website backgrounds.
 * No dependencies. All animation runs in the vertex shader; the CPU only
 * updates a handful of uniforms per frame.
 *
 *   import { DataWave } from './datawave.js';
 *   const wave = new DataWave(document.getElementById('bg'), { density: 6 });
 *   wave.setOptions({ waveAmplitude: 1.6 });
 *   wave.destroy();
 */

export const DEFAULTS = {
  // Field (the flat grid of points before displacement)
  width: 68, // world units along X (across the wave -> terrain transition)
  depth: 58, // world units along Z (the direction the waves travel)
  density: 5.3, // points per world unit (total = width*density x depth*density)
  mobileDensity: 4.5, // density used when the canvas is narrower than 768px (null = same)
  maxPoints: 400000, // hard safety cap
  jitter: 0.68, // 0 = perfect grid, 1 = fully randomised within each cell
  seed: 85,

  // Ocean waves (sum of three Gerstner waves)
  waveAmplitude: 1.69,
  waveLength: 15.7,
  waveSpeed: 0.19,
  waveSteepness: 0.47, // 0 = round sine swells, 1 = sharp crests
  waveDirection: 1, // degrees; 0 = waves travel towards +Z (the camera)
  waveSpread: 24, // degrees between the secondary wave trains

  // Transition from waves (one side) to terrain (the other side), across X
  blendStart: 0.13, // 0..1 across the field, measured from the wave side
  blendEnd: 0.72,
  blendFlip: false, // false = waves on the right (+X), terrain on the left
  blendNoise: 0.15, // how irregular the transition boundary is
  blendNoiseScale: 0.115,
  waveFalloff: 0.03, // how much the waves fade out inside the terrain zone

  // Terrain (fractal simplex noise height)
  terrainAmplitude: 29.7,
  terrainScale: 0.05,
  terrainOctaves: 2,
  terrainPersistence: 0.49,
  terrainLacunarity: 1.72,
  terrainRidge: 0.39, // 0 = smooth hills, 1 = sharp ridges
  terrainSpeed: 0.015, // how fast the terrain morphs

  // Extra displacement inside the terrain zone
  warpAmount: 2.9, // XZ domain warp (bends and smears the waves sideways)
  warpScale: 0.1,
  warpSpeed: 0.025,
  scatter: 1.25, // random per-point 3D dispersion ("spray")
  scatterMotion: 0.14, // how much scattered points drift over time
  dropout: 0.58, // fraction of points removed where terrain is at full strength

  // Points
  pointSize: 1.3, // px (CSS) at the camera-target distance
  sizeRandom: 0.35, // 0..1 per-point size variation
  sizeAttenuation: true, // smaller points further away
  responsiveSize: true, // scale point size with canvas height (reference: 1000px)
  softness: 0.31, // 0 = hard disc, 1 = soft glow
  opacity: 1,
  blending: "normal", // 'normal' | 'additive'

  // Colour
  gradient: [
    { pos: 0.0, color: "#1f47b8" },
    { pos: 0.25, color: "#3d73dc" },
    { pos: 0.48, color: "#8db2e8" },
    { pos: 0.66, color: "#c2d4e4" },
    { pos: 0.84, color: "#dedc84" },
    { pos: 1.0, color: "#e8e06c" },
  ],
  colorBy: "heightDepth", // 'height' | 'depth' | 'heightDepth' | 'blend' | 'heightBlend' | 'across'
  colorMin: -2.4, // world height mapped to gradient start (colorBy height)
  colorMax: 2.2, // world height mapped to gradient end
  colorNoise: 0.18, // random per-point offset along the gradient (speckle)
  background: "#173a6b", // hex colour, or null for a transparent canvas
  fogNear: 34, // distance from camera where points start fading
  fogFar: 78, // distance where points are fully faded
  edgeFade: 0.08, // fade the field's borders (fraction of size)

  // Camera
  fov: 61,
  cameraX: -4.3,
  cameraY: 11.2,
  cameraZ: 36.9,
  targetX: 13.2,
  targetY: -8,
  targetZ: -40,
  rotation: -50, // degrees, rotates the whole field around Y
  mouseParallax: 0.8, // world units the camera shifts with the pointer (0 = off)

  // Animation & performance
  speed: 0.2,
  maxFps: 30,
  maxPixelRatio: 1.75,
  paused: false,
  pauseWhenHidden: true, // stop when off-screen or the tab is hidden
  respectReducedMotion: true, // render a still frame for prefers-reduced-motion
};

const GEOMETRY_KEYS = ["width", "depth", "density", "mobileDensity", "maxPoints", "jitter", "seed"];
const COLOR_MODES = { height: 0, blend: 1, heightBlend: 2, depth: 3, across: 4, heightDepth: 5 };
const MOBILE_BREAKPOINT = 768;

const NOISE_GLSL = /* glsl */ `
// 3D simplex noise — Ashima Arts / Stefan Gustavson (MIT)
vec3 mod289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

const VERTEX_SHADER = /* glsl */ `
precision highp float;
attribute vec4 aData; // x, z on the flat grid, two random numbers

uniform mat4 uProj;
uniform mat4 uModelView;
uniform float uTime;
uniform float uSeed;
uniform vec2 uField;     // width, depth
uniform vec4 uWave;      // amplitude, wavelength, speed, steepness
uniform vec3 uWave2;     // direction (rad), spread (rad), falloff in terrain zone
uniform vec4 uBlend;     // start, end, noise, noise scale
uniform float uFlip;
uniform vec4 uTerrain;   // amplitude, scale, speed, ridge
uniform vec3 uFbm;       // octaves, persistence, lacunarity
uniform vec3 uWarp;      // amount, scale, speed
uniform vec3 uScatter;   // amount, motion, dropout
uniform vec4 uPoint;     // size (device px), random, attenuation (0/1), reference distance
uniform vec4 uColor;     // mode, min, max, noise
uniform vec3 uFade;      // fog near, fog far, edge fade

varying float vT;
varying float vAlpha;

${NOISE_GLSL}

float hash(float n){ return fract(sin(n) * 43758.5453123); }

float fbm(vec3 p){
  float sum = 0.0, amp = 1.0, norm = 0.0;
  for (int i = 0; i < 8; i++) {
    if (float(i) >= uFbm.x) break;
    float n = snoise(p);
    n = mix(n, 1.0 - 2.0 * abs(n), uTerrain.w);
    sum += n * amp;
    norm += amp;
    amp *= uFbm.y;
    p = p * uFbm.z + vec3(19.1, -7.3, 3.7);
  }
  return sum / max(norm, 1e-4);
}

// One Gerstner wave: returns (dx, dy, dz).
vec3 gerstner(vec2 p, float angle, float len, float amp, float q, float phase){
  vec2 d = vec2(sin(angle), cos(angle));
  float k = 6.2831853 / len;
  float c = sqrt(9.8 / k);
  float f = k * (dot(d, p) - c * uWave.z * uTime) + phase;
  float qa = q / (k * max(amp, 1e-4) * 3.0) * amp;
  return vec3(d.x * qa * cos(f), amp * sin(f), d.y * qa * cos(f));
}

void main(){
  vec2 p = aData.xy;
  float r1 = aData.z;
  float r2 = aData.w;
  float r3 = hash(r1 * 113.17 + r2 * 17.31 + 0.5);
  float r4 = hash(r2 * 91.73 + r1 * 3.13 + 1.5);
  float r5 = hash(r1 * 7.77 + r2 * 57.91 + 2.5);
  float t = uTime;
  float seed = uSeed * 13.37;

  // 0 on the wave side, 1 on the terrain side
  float across = 0.5 - p.x / uField.x;
  if (uFlip > 0.5) across = 1.0 - across;
  float along = p.y / uField.y + 0.5; // 0 far edge, 1 near edge

  float bn = snoise(vec3(p * uBlend.w, seed + t * 0.02)) * uBlend.z;
  float m = smoothstep(uBlend.x, max(uBlend.y, uBlend.x + 1e-3), across + bn);

  // XZ domain warp — bends the waves inside the terrain zone
  vec2 wq = p * uWarp.y;
  float wt = t * uWarp.z;
  vec2 warp = vec2(snoise(vec3(wq, wt + seed)), snoise(vec3(wq + 31.7, wt - seed)));
  vec2 q = p + warp * uWarp.x * m;

  // Waves
  float A = uWave.x;
  float L = uWave.y;
  float dir = uWave2.x;
  float spr = uWave2.y;
  vec3 w = gerstner(q, dir, L, A, uWave.w, seed)
         + gerstner(q, dir + spr, L * 0.61, A * 0.42, uWave.w, seed * 1.7)
         + gerstner(q, dir - spr * 1.4, L * 0.37, A * 0.2, uWave.w, seed * 2.3);
  w *= mix(1.0, 1.0 - uWave2.z, m);

  // Terrain
  float h = fbm(vec3(q * uTerrain.y, t * uTerrain.z + seed));
  float terrain = h * uTerrain.x * m;

  vec3 pos = vec3(q.x + w.x, w.y + terrain, q.y + w.z);

  // Scatter / spray
  vec3 rnd = vec3(r1, r3, r2) - 0.5;
  vec3 drift = vec3(sin(t * 0.7 + r1 * 6.283), sin(t * 0.9 + r2 * 6.283), cos(t * 0.8 + r3 * 6.283));
  float sm = m * m;
  pos += (rnd * vec3(1.0, 0.7, 1.0) + drift * 0.25 * uScatter.y) * uScatter.x * sm * 1.6;

  vec4 mv = uModelView * vec4(pos, 1.0);
  gl_Position = uProj * mv;

  float dist = -mv.z;
  float size = uPoint.x * (1.0 + (r4 - 0.5) * 2.0 * uPoint.y);
  if (uPoint.z > 0.5) size *= uPoint.w / max(dist, 0.1);

  // Fade: fog, field borders, sub-pixel points
  float alpha = 1.0 - smoothstep(uFade.x, max(uFade.y, uFade.x + 1e-3), dist);
  float e = max(uFade.z, 1e-4);
  alpha *= smoothstep(0.0, e, across) * smoothstep(1.0, 1.0 - e, across);
  alpha *= smoothstep(0.0, e, along) * smoothstep(1.0, 1.0 - e, along);
  alpha *= clamp(size, 0.0, 1.0);
  vAlpha = alpha;
  gl_PointSize = max(size, 1.0);

  // Dropout: push removed points outside the clip volume
  if (r5 < uScatter.z * m || dist <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);

  // Colour coordinate
  float hT = clamp((pos.y - uColor.y) / max(uColor.z - uColor.y, 1e-3), 0.0, 1.0);
  float ct = hT;
  if (uColor.x > 4.5) ct = 0.5 * (hT + along);
  else if (uColor.x > 3.5) ct = across;
  else if (uColor.x > 2.5) ct = along;
  else if (uColor.x > 1.5) ct = 0.5 * (hT + m);
  else if (uColor.x > 0.5) ct = m;
  vT = clamp(ct + (hash(r5 * 71.3 + r1) - 0.5) * 2.0 * uColor.w, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision mediump float;
uniform sampler2D uGradient;
uniform float uSoftness;
uniform float uOpacity;
varying float vT;
varying float vAlpha;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = 1.0 - smoothstep(1.0 - uSoftness, 1.0, d);
  a *= vAlpha * uOpacity;
  if (a < 0.004) discard;
  vec3 c = texture2D(uGradient, vec2(vT, 0.5)).rgb;
  gl_FragColor = vec4(c * a, a); // premultiplied
}
`;

export class DataWave {
  /**
   * @param {HTMLElement|HTMLCanvasElement|string} target  container (a canvas is appended) or a canvas
   * @param {Partial<typeof DEFAULTS>} options
   */
  constructor(target, options = {}) {
    const el = typeof target === "string" ? document.querySelector(target) : target;
    if (!el) throw new Error("DataWave: target element not found");

    this.options = { ...DEFAULTS, ...options };
    this.options.gradient = normalizeGradient(this.options.gradient);
    this.time = 0;
    this._mouse = [0, 0];
    this._mouseTarget = [0, 0];
    this._last = 0;
    this._raf = 0;
    this._onScreen = true;

    if (el instanceof HTMLCanvasElement) {
      this.canvas = el;
      this._ownsCanvas = false;
    } else {
      this.canvas = document.createElement("canvas");
      this.canvas.setAttribute("aria-hidden", "true");
      Object.assign(this.canvas.style, {
        position: "absolute",
        inset: "0",
        width: "100%",
        height: "100%",
        display: "block",
        pointerEvents: "none",
      });
      if (getComputedStyle(el).position === "static") el.style.position = "relative";
      el.appendChild(this.canvas);
      this._ownsCanvas = true;
    }

    const gl = this.canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
    });
    this.gl = gl;
    this.supported = !!gl;
    if (!gl) return; // no WebGL: the container's CSS background shows through

    this._initGL();
    this._bindEvents();
    this._resize();
    this._update();
  }

  /** Merge new options. Geometry is rebuilt only when grid-related options change. */
  setOptions(opts = {}) {
    if (!this.gl) return;
    const prev = this.options;
    const next = { ...prev };
    for (const k in opts) if (opts[k] !== undefined) next[k] = opts[k];
    if (opts.gradient) next.gradient = normalizeGradient(opts.gradient);
    this.options = next;
    if (GEOMETRY_KEYS.some((k) => prev[k] !== next[k])) this._buildGeometry();
    if (opts.gradient) this._buildGradient();
    if (prev.maxPixelRatio !== next.maxPixelRatio) this._resize();
    this._update();
    if (!this._raf) this._render();
  }

  getOptions() {
    return { ...this.options, gradient: this.options.gradient.map((s) => ({ ...s })) };
  }

  get pointCount() {
    return this._count || 0;
  }

  play() {
    this.setOptions({ paused: false });
  }
  pause() {
    this.setOptions({ paused: true });
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    this._raf = 0;
    this._ro?.disconnect();
    this._io?.disconnect();
    this._motionQuery?.removeEventListener?.("change", this._onMotionChange);
    window.removeEventListener("pointermove", this._onPointer);
    document.removeEventListener("visibilitychange", this._onVisibility);
    this.canvas.removeEventListener("webglcontextlost", this._onContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this._onContextRestored);
    const gl = this.gl;
    if (gl) {
      gl.deleteBuffer(this._buffer);
      gl.deleteTexture(this._texture);
      gl.deleteProgram(this._program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
    if (this._ownsCanvas) this.canvas.remove();
    this.gl = null;
  }

  // ---------------------------------------------------------------- internals

  _initGL() {
    const gl = this.gl;
    this._program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    gl.useProgram(this._program);
    this._aData = gl.getAttribLocation(this._program, "aData");
    this._u = {};
    const n = gl.getProgramParameter(this._program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(this._program, i).name;
      this._u[name] = gl.getUniformLocation(this._program, name);
    }
    this._buffer = gl.createBuffer();
    this._texture = gl.createTexture();
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    this._buildGeometry();
    this._buildGradient();
  }

  _bindEvents() {
    this._onPointer = (e) => {
      this._mouseTarget[0] = (e.clientX / window.innerWidth) * 2 - 1;
      this._mouseTarget[1] = (e.clientY / window.innerHeight) * 2 - 1;
    };
    this._onVisibility = () => this._update();
    this._onMotionChange = () => this._update();
    this._onContextLost = (e) => {
      e.preventDefault();
      cancelAnimationFrame(this._raf);
      this._raf = 0;
      this._lost = true;
    };
    this._onContextRestored = () => {
      this._lost = false;
      this._initGL();
      this._resize();
      this._update();
    };

    window.addEventListener("pointermove", this._onPointer, { passive: true });
    document.addEventListener("visibilitychange", this._onVisibility);
    this.canvas.addEventListener("webglcontextlost", this._onContextLost);
    this.canvas.addEventListener("webglcontextrestored", this._onContextRestored);

    this._motionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    this._motionQuery?.addEventListener?.("change", this._onMotionChange);

    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(this.canvas);

    if ("IntersectionObserver" in window) {
      this._io = new IntersectionObserver((entries) => {
        this._onScreen = entries[entries.length - 1].isIntersecting;
        this._update();
      });
      this._io.observe(this.canvas);
    }
  }

  _isMobile() {
    return this.canvas.clientWidth > 0 && this.canvas.clientWidth < MOBILE_BREAKPOINT;
  }

  _buildGeometry() {
    const o = this.options;
    const gl = this.gl;
    const density = this._isMobile() && o.mobileDensity ? o.mobileDensity : o.density;
    this._builtMobile = this._isMobile();
    let nx = Math.max(2, Math.round(o.width * density));
    let nz = Math.max(2, Math.round(o.depth * density));
    if (nx * nz > o.maxPoints) {
      const s = Math.sqrt(o.maxPoints / (nx * nz));
      nx = Math.max(2, Math.floor(nx * s));
      nz = Math.max(2, Math.floor(nz * s));
    }
    const rand = mulberry32(Math.floor(o.seed * 7919) + 1);
    const dx = o.width / (nx - 1);
    const dz = o.depth / (nz - 1);
    const data = new Float32Array(nx * nz * 4);
    let i = 0;
    // Rows are written far (-Z) to near (+Z) so alpha blending layers correctly
    // for the default camera without any per-frame sorting.
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        data[i++] = -o.width / 2 + ix * dx + (rand() - 0.5) * dx * o.jitter;
        data[i++] = -o.depth / 2 + iz * dz + (rand() - 0.5) * dz * o.jitter;
        data[i++] = rand();
        data[i++] = rand();
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(this._aData);
    gl.vertexAttribPointer(this._aData, 4, gl.FLOAT, false, 0, 0);
    this._count = nx * nz;
  }

  _buildGradient() {
    const gl = this.gl;
    const stops = this.options.gradient.map((s) => ({ pos: s.pos, rgb: hexToRgb(s.color) }));
    const N = 256;
    const data = new Uint8Array(N * 4);
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      let a = stops[0];
      let b = stops[stops.length - 1];
      for (let k = 0; k < stops.length - 1; k++) {
        if (t >= stops[k].pos && t <= stops[k + 1].pos) {
          a = stops[k];
          b = stops[k + 1];
          break;
        }
      }
      const f = t <= a.pos ? 0 : t >= b.pos ? 1 : (t - a.pos) / Math.max(b.pos - a.pos, 1e-6);
      for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round((a.rgb[c] + (b.rgb[c] - a.rgb[c]) * f) * 255);
      data[i * 4 + 3] = 255;
    }
    gl.bindTexture(gl.TEXTURE_2D, this._texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, N, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  _resize() {
    if (!this.gl || this._lost) return;
    const dpr = Math.min(window.devicePixelRatio || 1, this.options.maxPixelRatio);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    this._dpr = dpr;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    if (this.options.mobileDensity && this._isMobile() !== this._builtMobile) this._buildGeometry();
    if (!this._raf) this._render();
  }

  _shouldAnimate() {
    const o = this.options;
    if (!this.gl || this._lost || o.paused) return false;
    if (o.respectReducedMotion && this._motionQuery?.matches) return false;
    if (o.pauseWhenHidden && (document.hidden || !this._onScreen)) return false;
    return true;
  }

  _update() {
    if (this._shouldAnimate()) {
      if (!this._raf) this._raf = requestAnimationFrame(this._frame);
    } else if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
      this._last = 0;
    }
  }

  _frame = (now) => {
    this._raf = 0;
    if (!this._shouldAnimate()) {
      this._last = 0;
      return;
    }
    this._raf = requestAnimationFrame(this._frame);
    const minDt = 1000 / Math.max(1, this.options.maxFps);
    if (this._last && now - this._last < minDt - 1.5) return;
    const dt = this._last ? Math.min((now - this._last) / 1000, 0.1) : 0;
    this._last = now;
    this.time += dt * this.options.speed;
    const k = Math.min(1, dt * 2.5);
    this._mouse[0] += (this._mouseTarget[0] - this._mouse[0]) * k;
    this._mouse[1] += (this._mouseTarget[1] - this._mouse[1]) * k;
    this._render();
  };

  _render() {
    const gl = this.gl;
    if (!gl || this._lost) return;
    const o = this.options;
    const { width, height } = this.canvas;

    gl.viewport(0, 0, width, height);
    const bg = o.background ? hexToRgb(o.background) : null;
    if (bg) gl.clearColor(bg[0], bg[1], bg[2], 1);
    else gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (o.blending === "additive") gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const px = this._mouse[0] * o.mouseParallax;
    const py = this._mouse[1] * o.mouseParallax * 0.5;
    const eye = [o.cameraX + px, o.cameraY - py, o.cameraZ];
    const target = [o.targetX, o.targetY, o.targetZ];
    const view = lookAt(eye, target);
    const model = rotationY((o.rotation * Math.PI) / 180);
    const proj = perspective(o.fov, width / height, 0.1, 400);
    const refDist = Math.hypot(eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]);
    const viewScale = o.responsiveSize ? this.canvas.clientHeight / 1000 : 1;
    const deg = Math.PI / 180;
    const u = this._u;

    gl.useProgram(this._program);
    gl.uniformMatrix4fv(u.uProj, false, proj);
    gl.uniformMatrix4fv(u.uModelView, false, multiply(view, model));
    gl.uniform1f(u.uTime, this.time);
    gl.uniform1f(u.uSeed, o.seed);
    gl.uniform2f(u.uField, o.width, o.depth);
    gl.uniform4f(u.uWave, o.waveAmplitude, Math.max(o.waveLength, 0.1), o.waveSpeed, o.waveSteepness);
    gl.uniform3f(u.uWave2, o.waveDirection * deg, o.waveSpread * deg, o.waveFalloff);
    gl.uniform4f(u.uBlend, o.blendStart, o.blendEnd, o.blendNoise, o.blendNoiseScale);
    gl.uniform1f(u.uFlip, o.blendFlip ? 1 : 0);
    gl.uniform4f(u.uTerrain, o.terrainAmplitude, o.terrainScale, o.terrainSpeed, o.terrainRidge);
    gl.uniform3f(u.uFbm, o.terrainOctaves, o.terrainPersistence, o.terrainLacunarity);
    gl.uniform3f(u.uWarp, o.warpAmount, o.warpScale, o.warpSpeed);
    gl.uniform3f(u.uScatter, o.scatter, o.scatterMotion, o.dropout);
    gl.uniform4f(u.uPoint, o.pointSize * this._dpr * viewScale, o.sizeRandom, o.sizeAttenuation ? 1 : 0, refDist);
    gl.uniform4f(u.uColor, COLOR_MODES[o.colorBy] ?? 0, o.colorMin, o.colorMax, o.colorNoise);
    gl.uniform3f(u.uFade, o.fogNear, o.fogFar, o.edgeFade);
    gl.uniform1f(u.uSoftness, Math.min(Math.max(o.softness, 0.02), 1));
    gl.uniform1f(u.uOpacity, o.opacity);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._texture);
    gl.uniform1i(u.uGradient, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer);
    gl.vertexAttribPointer(this._aData, 4, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.POINTS, 0, this._count);
  }
}

// ------------------------------------------------------------------ helpers

function createProgram(gl, vsSource, fsSource) {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      throw new Error("DataWave shader error: " + gl.getShaderInfoLog(s));
    }
    return s;
  };
  const vs = compile(gl.VERTEX_SHADER, vsSource);
  const fs = compile(gl.FRAGMENT_SHADER, fsSource);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error("DataWave link error: " + gl.getProgramInfoLog(p));
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return p;
}

/** Accepts ['#hex', ...] (evenly spaced), [{pos, color}], or [[pos, color]]. */
function normalizeGradient(g) {
  if (!Array.isArray(g) || g.length === 0) g = DEFAULTS.gradient;
  const stops = g.map((s, i) => {
    if (typeof s === "string") return { pos: g.length > 1 ? i / (g.length - 1) : 0, color: s };
    if (Array.isArray(s)) return { pos: +s[0], color: s[1] };
    return { pos: +s.pos, color: s.color };
  });
  stops.sort((a, b) => a.pos - b.pos);
  if (stops.length === 1) stops.push({ ...stops[0], pos: 1 });
  return stops;
}

function hexToRgb(hex) {
  let h = String(hex).trim().replace("#", "");
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function perspective(fovDeg, aspect, near, far) {
  const f = 1 / Math.tan((fovDeg * Math.PI) / 360);
  const nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}

function lookAt(eye, target) {
  let zx = eye[0] - target[0],
    zy = eye[1] - target[1],
    zz = eye[2] - target[2];
  let l = Math.hypot(zx, zy, zz) || 1;
  zx /= l;
  zy /= l;
  zz /= l;
  // x = up(0,1,0) × z
  let xx = zz,
    xy = 0,
    xz = -zx;
  l = Math.hypot(xx, xy, xz) || 1;
  xx /= l;
  xy /= l;
  xz /= l;
  // y = z × x
  const yx = zy * xz - zz * xy,
    yy = zz * xx - zx * xz,
    yz = zx * xy - zy * xx;
  return new Float32Array([
    xx,
    yx,
    zx,
    0,
    xy,
    yy,
    zy,
    0,
    xz,
    yz,
    zz,
    0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
    1,
  ]);
}

function rotationY(a) {
  const c = Math.cos(a),
    s = Math.sin(a);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}

function multiply(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}
