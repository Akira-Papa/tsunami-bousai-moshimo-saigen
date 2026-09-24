// ─────────────────────────────────────────────────────────────
//  Scene: sky, terrain (aerial photo), buildings, tsunami water, caustics, spray
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three/webgpu';
import {
  Fn, wgsl, wgslFn, uniform, texture, sampler, varying, vec2, vec3, vec4, float, int, storage, vertexIndex,
  instanceIndex, positionLocal, positionWorld, cameraPosition, uv, dFdx, dFdy, abs, max, min, clamp, mix,
  smoothstep, normalWorld, attribute, step, fract, floor, sin, pass, select, length, If, Discard,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { LIB, WATER_FN, CAUSTIC_FN } from './shaders.js';
import { createOuterLayer } from './outer.js';

export function createWorld(renderer, region, solver, opts = {}) {
  const { N, L, dx } = region;
  const half = L / 2;
  const scene = new THREE.Scene();
  const span = opts.outer ? opts.outer.region.L : L; // how far the stage reaches
  scene.fog = new THREE.Fog(0xb9cadb, span * 0.9, span * 4);

  // ── lights ──
  const uL = uniform(new THREE.Vector3(0, 1, 0));
  const sun = new THREE.DirectionalLight(0xfff0dd, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(N >= 1024 ? 4096 : 2048);
  const sc = sun.shadow.camera;
  sc.left = -half * 1.05; sc.right = half * 1.05; sc.top = half * 1.05; sc.bottom = -half * 1.05;
  sc.near = 10; sc.far = 6000;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  sun.shadow.autoUpdate = false; // sun, ground and buildings never move → render the map once
  sun.shadow.needsUpdate = true;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x6b6a5c, 0.9);
  scene.add(hemi);
  function setSun(azDeg, elDeg) {
    const az = THREE.MathUtils.degToRad(azDeg), el = THREE.MathUtils.degToRad(elDeg);
    const d = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)).normalize();
    uL.value.copy(d);
    sun.position.copy(d).multiplyScalar(3000);
    sun.target.position.set(0, 0, 0);
    sun.shadow.needsUpdate = true;
  }
  setSun(215, 32); // afternoon, sun in the south-west, 32° up (セーブル案)

  const uEnv = uniform(new THREE.Vector4(L, 0, 1.0, 0)); // D, time, caustic gain, depth-colour mode
  const lib = wgsl(LIB);

  // ── textures ──
  const photoTex = new THREE.CanvasTexture(region.photo.canvas);
  photoTex.flipY = false;
  photoTex.colorSpace = THREE.SRGBColorSpace;
  photoTex.anisotropy = 8;
  photoTex.generateMipmaps = true;
  photoTex.minFilter = THREE.LinearMipmapLinearFilter;
  // bed info: (ground/bed, building height, sea flag, official depth)
  const bedArr = new Float32Array(N * N * 4);
  for (let k = 0; k < N * N; k++) {
    bedArr[k * 4] = region.bed[k];
    bedArr[k * 4 + 1] = region.bldH[k];
    bedArr[k * 4 + 2] = region.water[k] ? 1 : 0;
  }
  // w = lowest water level that still sees the sun (buildings/ground toward the sun cast the rest into shade)
  function bakeSunLevel() {
    const l = uL.value, hl = Math.hypot(l.x, l.z) || 1, rise = (l.y / hl) * dx;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let z = -1e3;
      for (let st = 1; st <= 64; st++) {
        const a = Math.round(i + (l.x / hl) * st), b = Math.round(j + (l.z / hl) * st);
        if (a < 0 || b < 0 || a >= N || b >= N) break;
        const k = b * N + a;
        z = Math.max(z, region.bed[k] + region.bldH[k] - st * rise);
      }
      bedArr[(j * N + i) * 4 + 3] = z;
    }
  }
  bakeSunLevel();
  const bedTex = new THREE.DataTexture(toHalf(bedArr), N, N, THREE.RGBAFormat, THREE.HalfFloatType);
  bedTex.minFilter = bedTex.magFilter = THREE.LinearFilter;
  bedTex.needsUpdate = true;

  // official 100 m cells painted into a canvas (comparison overlay)
  // official 100 m cells as coloured HATCHING + outline, so they never look like the simulated fill (日向 #5)
  const OC = 2048;
  const offCanvas = new OffscreenCanvas(OC, OC);
  {
    const g = offCanvas.getContext('2d');
    g.clearRect(0, 0, OC, OC);
    const s = (100 / L) * OC;
    for (const c of region.official?.cells ?? []) {
      const x0 = ((c.x + half) / L) * OC - s / 2, y0 = ((c.z + half) / L) * OC - s / 2;
      const col = cssDepth(c.depth).replace('0.9)', '1)');
      g.save();
      g.beginPath(); g.rect(x0, y0, s, s); g.clip();
      g.strokeStyle = col; g.lineWidth = Math.max(1.5, s / 14);
      for (let t = -s; t < s * 2; t += s / 5) { g.beginPath(); g.moveTo(x0 + t, y0); g.lineTo(x0 + t - s, y0 + s); g.stroke(); }
      g.restore();
      g.strokeStyle = 'rgba(40,20,60,0.85)'; g.lineWidth = 1.2; g.strokeRect(x0 + 0.5, y0 + 0.5, s - 1, s - 1);
    }
  }
  const offTex = new THREE.CanvasTexture(offCanvas);
  offTex.flipY = false;
  offTex.colorSpace = THREE.SRGBColorSpace;
  const uShowOfficial = uniform(0);
  const uShowMax = uniform(0);

  // ── caustics (top-down map of the flooded ground) ──
  const CM = Math.min(2048, N * 2);
  const causticRT = new THREE.RenderTarget(CM, CM, { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false });
  causticRT.texture.minFilter = causticRT.texture.magFilter = THREE.LinearFilter;
  const causticScene = new THREE.Scene();
  const causticCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  {
    const st = texture(solver.surfTex);
    const cFn = wgslFn(CAUSTIC_FN, [lib]);
    const PG = Math.min(1024, N);
    const geo = new THREE.PlaneGeometry(2, 2, PG, PG);
    const m = new THREE.MeshBasicNodeMaterial();
    const uvp = vec2(uv().x, float(1).sub(uv().y)); // PlaneGeometry uv.y points north → flip to z-south
    const cp = cFn({ uvIn: uvp, st, ss: sampler(st), L: uL, env: uEnv });
    const vFlat = varying(cp.xy, 'vFlat');
    const vHit = varying(cp.zw, 'vHit');
    m.vertexNode = vec4(cp.z.div(half), cp.w.div(half).negate(), 0, 1);
    const dA = abs(dFdx(vFlat).x.mul(dFdy(vFlat).y).sub(dFdx(vFlat).y.mul(dFdy(vFlat).x)));
    const dB = abs(dFdx(vHit).x.mul(dFdy(vHit).y).sub(dFdx(vHit).y.mul(dFdy(vHit).x)));
    const ratio = min(dA.div(max(dB, 1e-7)), 25);
    m.fragmentNode = vec4(vec3(ratio), 1);
    m.blending = THREE.AdditiveBlending;
    m.transparent = true; m.depthTest = false; m.depthWrite = false;
    m.side = THREE.DoubleSide; m.toneMapped = false;
    const mesh = new THREE.Mesh(geo, m);
    mesh.frustumCulled = false;
    causticScene.add(mesh);
  }
  const cauTex = causticRT.texture;

  // ── terrain ──
  const envT = texture(solver.envTex);
  const terrain = (() => {
    const geo = new THREE.PlaneGeometry(L - dx, L - dx, N - 1, N - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let k = 0; k < N * N; k++) pos.setY(k, region.bed[k]);
    geo.computeVertexNormals();
    // uv in domain space (x east, z south)
    const uvA = geo.attributes.uv;
    for (let k = 0; k < N * N; k++) uvA.setXY(k, (pos.getX(k) + half) / L, (pos.getZ(k) + half) / L);
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
    const tuv = uv();
    const photo = texture(photoTex, tuv).rgb;
    const env = envT.sample(tuv);
    const bedI = texture(bedTex, tuv);
    const wet = env.x;
    // wet soil is darker and a touch browner; the flood leaves a mud film where it was deep
    const mud = smoothstep(0.2, 1.5, env.y);
    let col = mix(photo, photo.mul(vec3(0.55, 0.52, 0.47)), wet.mul(0.85));
    col = mix(col, vec3(0.30, 0.26, 0.20), mud.mul(0.35).mul(wet));
    col = mix(col, vec3(0.30, 0.33, 0.28), bedI.z); // sea floor under the (always present) sea
    const off = texture(offTex, tuv);
    col = mix(col, off.rgb, off.a.mul(uShowOfficial).mul(0.85));
    // max-depth map (after the run)
    mat.colorNode = col;
    mat.roughnessNode = mix(float(0.92), float(0.35), wet.mul(0.8));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    return mesh;
  })();
  scene.add(terrain);

  // skirt around the domain (diorama edge) so the cut never looks like a paper sheet
  scene.add(makeSkirt(region));

  // ── surroundings (not simulated): coarse terrain + photo, a calm outer sea at the incoming-wave level ──
  const uOuterEta = uniform(0);
  const outer = region.outer ? makeOuter(region, uL, uEnv, uOuterEta, lib) : null;
  if (outer) scene.add(outer[0], outer[1]);
  // nested run: the simulated wide square around this one
  const outerLayer = opts.outer ? createOuterLayer({ ...opts.outer, innerL: L, uL, uEnvInner: uEnv, lib }) : null;
  if (outerLayer) scene.add(outerLayer.group);
  scene.add(makeOutline(region));

  // ── seawalls: one box per levee cell; the top follows the live bed, so a breached wall drops away ──
  if (solver.leveeCount > 0) {
    const Sr = storage(solver.buffers.S.value, 'vec4', N * N).toReadOnly();
    const LIr = storage(solver.buffers.LI.value, 'uint', solver.leveeCount).toReadOnly();
    const LVr = storage(solver.buffers.LV.value, 'vec4', N * N).toReadOnly();
    const k = int(LIr.element(instanceIndex));
    const ci = k.mod(N), cj = k.div(N);
    const cx = float(ci).add(0.5).mul(dx).sub(half), cz = float(cj).add(0.5).mul(dx).sub(half);
    const ground = LVr.element(k).y;
    const top = Sr.element(k).x;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.8 });
    mat.positionNode = vec3(positionLocal.x.mul(dx * 1.02).add(cx), positionLocal.y.mul(max(top.sub(ground).add(0.4), 0.001)).add(ground.sub(0.4)), positionLocal.z.mul(dx * 1.02).add(cz));
    mat.colorNode = mix(vec3(0.62, 0.61, 0.58), vec3(0.72, 0.71, 0.68), step(0.5, fract(positionWorld.y.mul(0.5))).mul(0.3));
    const walls = new THREE.Mesh(geo, mat);
    walls.count = solver.leveeCount;
    walls.frustumCulled = false;
    walls.castShadow = true;
    walls.receiveShadow = true;
    scene.add(walls);
  }

  // ── buildings ──
  const buildings = makeBuildings(region, envT, photoTex, uShowOfficial);
  scene.add(buildings);

  // ── water ──
  const water = (() => {
    const geo = new THREE.PlaneGeometry(L - dx, L - dx, N - 1, N - 1);
    geo.rotateX(-Math.PI / 2);
    const Rr = storage(solver.buffers.R.value, 'vec4', N * N).toReadOnly();
    const R2r = storage(solver.buffers.R2.value, 'vec4', N * N).toReadOnly();
    const r = Rr.element(vertexIndex);
    const r2 = R2r.element(vertexIndex);
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: true });
    mat.positionNode = vec3(positionLocal.x, r.x.add(clamp(r2.x, 0, 1).mul(0.25)), positionLocal.z); // foam rides a little proud
    const vN = varying(r.yz, 'vWN');
    const vH = varying(r.w, 'vWH');
    const vF = varying(r2.x, 'vWF');
    const vC = varying(r2.y, 'vWC');
    const vU = varying(r2.zw, 'vWU');
    const wFn = wgslFn(WATER_FN, [lib]);
    const pt = texture(photoTex), ct = texture(cauTex), bt = texture(bedTex);
    const out = wFn({
      p: positionWorld, eye: cameraPosition, L: uL, nIn: vN, h: vH, turb: vC, foamIn: vF, flow: vU, env: uEnv,
      pt, ps: sampler(pt), ct, cs: sampler(ct), bt, bs: sampler(bt),
    });
    mat.colorNode = out.xyz;
    mat.opacityNode = out.w;
    mat.alphaTestNode = float(0.02);
    mat.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    return mesh;
  })();
  scene.add(water);

  // ── spray particles ──
  const spray = (() => {
    const Pr = storage(solver.buffers.P.value, 'vec4', solver.buffers.P.value.count).toReadOnly();
    const Vr = storage(solver.buffers.V.value, 'vec4', solver.buffers.V.value.count).toReadOnly();
    const p = Pr.element(instanceIndex);
    const v = Vr.element(instanceIndex);
    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
    mat.positionNode = p.xyz;
    const life = clamp(p.w, 0, 1);
    mat.scaleNode = select(p.w.greaterThan(0), v.w.mul(float(1.6).sub(life.mul(0.6))), float(0));
    const r = length(uv().sub(0.5)).mul(2);
    const soft = float(1).sub(smoothstep(0.35, 1.0, r));
    mat.colorNode = vec4(vec3(0.93, 0.94, 0.95), 1);
    mat.opacityNode = soft.mul(life.mul(0.8)).mul(0.4);
    mat.fog = true;
    const s = new THREE.Sprite(mat);
    s.count = solver.buffers.P.value.count;
    s.frustumCulled = false;
    s.renderOrder = 3;
    return s;
  })();
  scene.add(spray);

  // ── sky dome ──
  {
    const skyFn = wgslFn(/* wgsl */`fn w_skyCol(p: vec3f, eye: vec3f, L: vec3f) -> vec3f { return w_sky(p - eye, L); }`, [lib]);
    const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
    mat.colorNode = skyFn({ p: positionWorld, eye: cameraPosition, L: uL });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(Math.max(L * 12, span * 3), 48, 24), mat);
    sky.renderOrder = -1;
    sky.frustumCulled = false;
    scene.add(sky);
    scene.userData.sky = sky;
  }

  // ── post: bloom on sun glints ──
  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.5, Math.max(L * 14, span * 3.5));
  const pipeline = new THREE.RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  const col = scenePass.getTextureNode('output');
  const bl = bloom(col, 0.12, 0.3, 0.95);
  pipeline.outputNode = col.add(bl);

  let cFrame = 0;
  function renderCaustics(force = false) {
    if (!force && cFrame++ % 2) return; // 30 Hz is plenty for light nets
    renderer.setRenderTarget(causticRT);
    renderer.setClearColor(0x000000, 1);
    renderer.render(causticScene, causticCam);
    renderer.setRenderTarget(null);
  }

  return {
    scene, camera, pipeline, uEnv, uL, setSun, uShowOfficial, uShowMax, uOuterEta, outerLayer,
    terrain, buildings, water, spray, renderCaustics, causticScene, causticCam,
    dispose() {
      for (const sc of [scene, causticScene]) sc.traverse((o) => {
        // THREE.Sprite instances all share ONE module-level geometry: disposing it destroys the GPU buffer
        // the next town's spray sprite uses → "Buffer used in submit while destroyed" and a black screen
        // on the second run. Never dispose a sprite's geometry.
        if (!o.isSprite) o.geometry?.dispose?.();
        o.material?.dispose?.(); o.material?.map?.dispose?.();
      });
      sun.shadow.map?.dispose?.();
      scenePass.dispose?.(); pipeline.dispose?.(); bl.dispose?.();
      outer?.[2].forEach((t) => t.dispose());
      outerLayer?.dispose();
      photoTex.dispose(); bedTex.dispose(); causticRT.dispose(); offTex.dispose();
    },
  };
}

// hazard-map-style colours (0.3 / 1 / 2 / 5 / 10 / 20 m)
export function cssDepth(h) {
  if (h < 0.3) return 'rgba(255,255,179,0.9)';
  if (h < 1) return 'rgba(247,245,169,0.9)';
  if (h < 2) return 'rgba(255,216,192,0.9)';
  if (h < 5) return 'rgba(255,183,183,0.9)';
  if (h < 10) return 'rgba(255,145,145,0.9)';
  if (h < 20) return 'rgba(242,133,201,0.9)';
  return 'rgba(220,122,220,0.9)';
}

function toHalf(f32) {
  const out = new Uint16Array(f32.length);
  for (let i = 0; i < f32.length; i++) out[i] = THREE.DataUtils.toHalfFloat(f32[i]);
  return out;
}

function makeOuter(region, uL, uEnv, uOuterEta, lib) {
  const o = region.outer, { L } = region;
  const M = o.M, OL = o.L, inner = L / 2 - region.dx;
  const geo = new THREE.PlaneGeometry(OL, OL, M - 1, M - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, uvA = geo.attributes.uv;
  for (let k = 0; k < M * M; k++) {
    const x = pos.getX(k), z = pos.getZ(k);
    // hide the part under the detailed square (it lies below the real terrain)
    const inside = Math.abs(x) < inner && Math.abs(z) < inner;
    pos.setY(k, inside ? -60 : o.hgt[k] - 0.4);
    uvA.setXY(k, (x + OL / 2) / OL, (z + OL / 2) / OL);
  }
  geo.computeVertexNormals();
  const photo = new THREE.CanvasTexture(o.photo);
  photo.flipY = false; photo.colorSpace = THREE.SRGBColorSpace; photo.anisotropy = 8;
  const mask = new THREE.CanvasTexture(o.mask);
  mask.flipY = false;
  mask.minFilter = mask.magFilter = THREE.LinearFilter;
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.95 });
  // slightly desaturated so the computed square reads as the "stage"
  const c = texture(photo, uv()).rgb;
  mat.colorNode = mix(c, vec3(c.dot(vec3(0.3, 0.59, 0.11))), 0.35).mul(0.92);
  const ground = new THREE.Mesh(geo, mat);
  ground.receiveShadow = true;

  // outer sea: flat, at the level of the incoming wave, masked to the coarse sea area
  const sgeo = new THREE.PlaneGeometry(OL, OL, 1, 1);
  sgeo.rotateX(-Math.PI / 2);
  const sm = new THREE.MeshBasicNodeMaterial({ transparent: false });
  sm.positionNode = vec3(positionLocal.x, uOuterEta.sub(0.05), positionLocal.z);
  const seaFn = wgslFn(/* wgsl */`
fn w_outerSea(p: vec3f, eye: vec3f, L: vec3f, env: vec4f) -> vec3f {
  let t = env.y;
  let q = p.xz * 0.06 + vec2f(t * 0.05, t * 0.03);
  let e = 0.15;
  let g = vec2f(w_fbm(q + vec2f(e, 0.0)) - w_fbm(q - vec2f(e, 0.0)), w_fbm(q + vec2f(0.0, e)) - w_fbm(q - vec2f(0.0, e))) / (2.0 * e);
  let n = normalize(vec3f(-g.x * 0.12, 1.0, -g.y * 0.12));
  let V = normalize(eye - p);
  let F = w_fresnel(max(dot(n, V), 0.0));
  let R = reflect(-V, n);
  var refl = w_sky(vec3f(R.x, abs(R.y), R.z), L);
  refl += W_SUN * pow(max(dot(R, L), 0.0), 600.0) * 30.0;
  // same water as the simulated sea (sigSea/scat of w_water, 10 m deep → pure in-scatter)
  let body = vec3f(0.04, 0.07, 0.05) * (W_SUN * 1.3 * L.y + vec3f(0.30, 0.38, 0.46));
  return mix(body, refl, F);
}`, [lib]);
  sm.colorNode = seaFn({ p: positionWorld, eye: cameraPosition, L: uL, env: uEnv });
  const inSq = abs(positionWorld.x).lessThan(L / 2).and(abs(positionWorld.z).lessThan(L / 2));
  const seaAmt = smoothstep(0.35, 0.65, texture(mask, positionWorld.xz.add(OL / 2).div(OL)).r); // plane uv.y points north; mask rows run north→south
  sm.transparent = true;
  sm.depthWrite = false;
  sm.opacityNode = select(inSq, float(0), seaAmt);
  const seaMesh = new THREE.Mesh(sgeo, sm);
  return [ground, seaMesh, [photo, mask]];
}

/** thin dashed frame on the ground: "the physics is computed inside this square" */
function makeOutline(region) {
  const { N, L, dx, bed } = region;
  const pts = [];
  const h = L / 2 - dx / 2;
  const add = (i, j) => pts.push(new THREE.Vector3(-h + i * dx, Math.max(bed[j * N + i], 0) + 0.8, -h + j * dx));
  const step = 4;
  for (let i = 0; i < N; i += step) add(i, 0);
  for (let j = 0; j < N; j += step) add(N - 1, j);
  for (let i = N - 1; i >= 0; i -= step) add(i, N - 1);
  for (let j = N - 1; j >= 0; j -= step) add(0, j);
  pts.push(pts[0].clone());
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  const m = new THREE.LineDashedNodeMaterial({ color: 0xffffff, dashSize: 14, gapSize: 9, transparent: true, opacity: 0.55 });
  const line = new THREE.Line(g, m);
  line.computeLineDistances();
  return line;
}

function makeSkirt(region) {
  const { N, L, dx, bed } = region;
  const half = L / 2 - dx / 2;
  const bottom = -26;
  const pos = [], idx = [];
  const edge = (fn) => {
    const base = pos.length / 3;
    for (let t = 0; t < N; t++) {
      const [x, z, k] = fn(t);
      pos.push(x, bed[k], z, x, bottom, z);
    }
    for (let t = 0; t < N - 1; t++) {
      const a = base + t * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  };
  const c = (i) => -half + i * dx;
  edge((t) => [c(t), -half, t]);
  edge((t) => [c(t), half, (N - 1) * N + t]);
  edge((t) => [-half, c(t), t * N]);
  edge((t) => [half, c(t), t * N + N - 1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.MeshStandardNodeMaterial({ color: 0x5b5146, roughness: 1, side: THREE.DoubleSide });
  const yN = positionWorld.y;
  // strata bands for a cut-earth look
  m.colorNode = mix(vec3(0.36, 0.31, 0.25), vec3(0.24, 0.21, 0.18), smoothstep(-2, -20, yN)).mul(float(0.9).add(sin(yN.mul(2.3)).mul(0.05)));
  return new THREE.Mesh(g, m);
}

function makeBuildings(region, envT, photoTex, uShowOfficial) {
  const { L } = region;
  const half = L / 2;
  const pos = [], nor = [], uvs = [], info = [];
  const push = (x, y, z, nx, ny, nz, u, v, a, b, c, d) => { pos.push(x, y, z); nor.push(nx, ny, nz); uvs.push(u, v); info.push(a, b, c, d); };
  region.buildings.forEach((b, id) => {
    let ring = b.ring;
    // CCW (seen from above, y-up with z-south) → outward normals
    let area = 0;
    for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; area += p[0] * q[1] - q[0] * p[1]; }
    if (area < 0) ring = ring.slice().reverse();
    const base = b.base - 1.5, top = b.top;
    const seed = (id * 0.6180339) % 1;
    const kind = { normal: 0, solid: 1, tall: 2, shed: 3, plateau: b.height > 12 ? 1 : 0 }[b.kind] ?? 0;
    let run = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % ring.length];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 0.05) continue;
      // outward normal for a positive-area ring in (x, z): (dz, −dx)
      const nx = (z1 - z0) / len, nz = -(x1 - x0) / len;
      const u0 = run, u1 = run + len;
      run = u1;
      const hb = b.base; // wall v measured from local ground
      // (p1−p0)×(p2−p0) must point along the outward normal → base0, top1, base1 / base0, top0, top1
      push(x0, base, z0, nx, 0, nz, u0, base - hb, top - hb, seed, kind, 0);
      push(x1, top, z1, nx, 0, nz, u1, top - hb, top - hb, seed, kind, 0);
      push(x1, base, z1, nx, 0, nz, u1, base - hb, top - hb, seed, kind, 0);
      push(x0, base, z0, nx, 0, nz, u0, base - hb, top - hb, seed, kind, 0);
      push(x0, top, z0, nx, 0, nz, u0, top - hb, top - hb, seed, kind, 0);
      push(x1, top, z1, nx, 0, nz, u1, top - hb, top - hb, seed, kind, 0);
    }
    // roof
    const tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), []);
    for (const t of tris) {
      for (const k of [t[0], t[2], t[1]]) {
        const [x, z] = ring[k];
        push(x, top, z, 0, 1, 0, (x + half) / L, (z + half) / L, top - b.base, seed, kind, 1);
      }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('binfo', new THREE.Float32BufferAttribute(info, 4));
  // fix roof winding: triangles were pushed [0,2,1]; ensure facing up
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide });
  const bi = attribute('binfo', 'vec4');
  const isRoof = bi.w;
  const wuv = uv();
  // walls: storeys every 3 m, windows, per-building tint
  const seed = bi.y;
  const kind = bi.z;
  const tint = mix(vec3(0.86, 0.84, 0.80), vec3(0.72, 0.70, 0.66), seed);
  const wood = mix(vec3(0.62, 0.56, 0.48), vec3(0.78, 0.74, 0.68), fract(seed.mul(7.3)));
  const baseCol = select(kind.lessThan(0.5), wood, tint);
  const storeyH = float(3.0);
  const fy = fract(wuv.y.div(storeyH));
  const fx = fract(wuv.x.div(select(kind.lessThan(0.5), float(3.4), float(2.6))));
  const win = step(0.32, fy).mul(step(fy, 0.78)).mul(step(0.22, fx)).mul(step(fx, 0.78)).mul(step(1.2, wuv.y)).mul(step(wuv.y, bi.x.sub(0.8)));
  const glass = mix(vec3(0.20, 0.25, 0.30), vec3(0.35, 0.42, 0.5), fract(seed.mul(13.1)));
  let wall = mix(baseCol, glass, win.mul(select(kind.greaterThan(2.5), float(0), float(0.9))));
  // mud line: the highest water level around this wall, sampled just outside it
  const pW = positionWorld;
  const outUV = pW.xz.add(normalWorld.xz.mul(region.dx * 1.6)).add(half).div(L);
  const env = envT.sample(outUV);
  const hLocal = wuv.y; // height above local ground
  const reached = env.w; // max(η) − ground outside the wall
  const soaked = step(hLocal, reached).mul(isRoof.oneMinus());
  wall = mix(wall, wall.mul(vec3(0.45, 0.40, 0.33)), soaked.mul(0.85));
  const line = smoothstep(0.12, 0.0, abs(hLocal.sub(reached))).mul(step(0.05, reached)).mul(isRoof.oneMinus());
  wall = mix(wall, vec3(0.22, 0.18, 0.13), line.mul(0.9));
  const roofPhoto = texture(photoTex, wuv).rgb;
  const roof = mix(roofPhoto.mul(1.05), vec3(0.55, 0.55, 0.55), 0.25);
  m.colorNode = mix(wall, roof, isRoof);
  m.roughnessNode = mix(float(0.8), float(0.25), win.mul(isRoof.oneMinus()));
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
