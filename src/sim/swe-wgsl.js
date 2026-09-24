// ─────────────────────────────────────────────────────────────
//  Non-linear shallow-water equations — one finite-volume cell update
//  (decided in the four-genius meeting, D1):
//   • MUSCL reconstruction of (η, h, u, v) with minmod, 1st order next to dry / wall cells
//   • hydrostatic reconstruction (Audusse et al. 2004) → well-balanced, positive depths
//   • HLL flux with Einfeldt wave speeds, upwinded tangential momentum
//   • buildings = reflective walls (mirror ghost state)
//   • Manning friction, semi-implicit; velocity desingularisation (Kurganov–Petrova)
//  Cell state q = (h, hu, hv, _), static s = (z, wall, manning n, _)
// ─────────────────────────────────────────────────────────────
export const SWE_LIB = /* wgsl */ `
const SW_G: f32 = 9.81;
const SW_HDRY: f32 = 1e-4;

struct SwRec { hm: f32, em: f32, um: f32, vm: f32, hp: f32, ep: f32, up: f32, vp: f32 }

fn sw_minmod(a: f32, b: f32) -> f32 {
  if (a * b <= 0.0) { return 0.0; }
  return select(b, a, abs(a) < abs(b));
}

fn sw_vel(h: f32, q: f32) -> f32 {
  let h4 = h * h * h * h;
  return 1.41421356 * h * q / sqrt(h4 + max(h4, 1e-12));
}

// primitive (h, eta, un, ut) of one cell for a given axis (ax = 0 → x, 1 → y)
fn sw_prim(q: vec4f, z: f32, ax: u32) -> vec4f {
  let h = max(q.x, 0.0);
  let u = select(0.0, sw_vel(h, q.y), h > SW_HDRY);
  let v = select(0.0, sw_vel(h, q.z), h > SW_HDRY);
  return select(vec4f(h, h + z, v, u), vec4f(h, h + z, u, v), ax == 0u);
}

// face values of cell c on its minus (−½) and plus (+½) side
fn sw_rec(pm: vec4f, wm: f32, pc: vec4f, pp: vec4f, wp: f32) -> SwRec {
  var s = vec4f(0.0);
  let limited = wm > 0.5 || wp > 0.5 || pm.x < 1e-3 || pc.x < 1e-3 || pp.x < 1e-3;
  if (!limited) {
    s = vec4f(
      sw_minmod(pc.x - pm.x, pp.x - pc.x),
      sw_minmod(pc.y - pm.y, pp.y - pc.y),
      sw_minmod(pc.z - pm.z, pp.z - pc.z),
      sw_minmod(pc.w - pm.w, pp.w - pc.w));
  }
  var r: SwRec;
  r.hm = max(pc.x - 0.5 * s.x, 0.0); r.em = pc.y - 0.5 * s.y; r.um = pc.z - 0.5 * s.z; r.vm = pc.w - 0.5 * s.w;
  r.hp = max(pc.x + 0.5 * s.x, 0.0); r.ep = pc.y + 0.5 * s.y; r.up = pc.z + 0.5 * s.z; r.vp = pc.w + 0.5 * s.w;
  return r;
}

fn sw_hll(hL: f32, uL: f32, vL: f32, hR: f32, uR: f32, vR: f32) -> vec3f {
  if (hL < 1e-6 && hR < 1e-6) { return vec3f(0.0); }
  let cL = sqrt(SW_G * hL);
  let cR = sqrt(SW_G * hR);
  var sL: f32; var sR: f32;
  if (hL < 1e-6) { sL = uR - 2.0 * cR; sR = uR + cR; }
  else if (hR < 1e-6) { sL = uL - cL; sR = uL + 2.0 * cL; }
  else {
    let us = 0.5 * (uL + uR) + cL - cR;
    let cs = 0.5 * (cL + cR) + 0.25 * (uL - uR);
    sL = min(uL - cL, us - cs);
    sR = max(uR + cR, us + cs);
  }
  let FL = vec2f(hL * uL, hL * uL * uL + 0.5 * SW_G * hL * hL);
  let FR = vec2f(hR * uR, hR * uR * uR + 0.5 * SW_G * hR * hR);
  var F: vec2f;
  if (sL >= 0.0) { F = FL; }
  else if (sR <= 0.0) { F = FR; }
  else { F = (sR * FL - sL * FR + sL * sR * (vec2f(hR, hR * uR) - vec2f(hL, hL * uL))) / (sR - sL); }
  // tangential momentum is carried upwind by the mass flux (HLLC-style contact)
  return vec3f(F.x, F.y, F.x * select(vR, vL, F.x > 0.0));
}

// flux through a face between left (L) and right (R) face states; returns (Fh, Fn, Ft, pressure fix for mySide)
// mySide = 0 → the calling cell is L, 1 → it is R.  Walls are mirrored.
fn sw_face(hL0: f32, eL: f32, uL0: f32, vL: f32, wL: f32,
           hR0: f32, eR: f32, uR0: f32, vR: f32, wR: f32, mySide: u32) -> vec4f {
  var hL = hL0; var hR = hR0; var uL = uL0; var uR = uR0;
  var zL = eL - hL0; var zR = eR - hR0;
  var vLL = vL; var vRR = vR;
  if (wR > 0.5) { hR = hL; zR = zL; uR = -uL; vRR = vL; }
  if (wL > 0.5) { hL = hR; zL = zR; uL = -uR; vLL = vR; }
  let zs = max(zL, zR);
  let hLs = max(0.0, hL + zL - zs);
  let hRs = max(0.0, hR + zR - zs);
  let F = sw_hll(hLs, uL, vLL, hRs, uR, vRR);
  let fix = select(0.5 * SW_G * (hR * hR - hRs * hRs), 0.5 * SW_G * (hL * hL - hLs * hLs), mySide == 0u);
  return vec4f(F, fix);
}
`;

// full cell update: returns q + dt·L(q) (friction included). Neighbours: e/w (x), n/s (y = z-world)
export const SWE_CELL = /* wgsl */ `
fn sw_cell(qc: vec4f, sc: vec4f,
           qe: vec4f, se: vec4f, qe2: vec4f, se2: vec4f,
           qw: vec4f, sw: vec4f, qw2: vec4f, sw2: vec4f,
           qs: vec4f, ss: vec4f, qs2: vec4f, ss2: vec4f,
           qn: vec4f, sn: vec4f, qn2: vec4f, sn2: vec4f,
           prm: vec4f) -> vec4f {
  let dt = prm.x;
  let dx = prm.y;
  if (sc.y > 0.5) { return vec4f(0.0, 0.0, 0.0, qc.w); }

  // ── x direction ──
  let pcx = sw_prim(qc, sc.x, 0u);
  let rc = sw_rec(sw_prim(qw, sw.x, 0u), sw.y, pcx, sw_prim(qe, se.x, 0u), se.y);
  let re = sw_rec(pcx, 0.0, sw_prim(qe, se.x, 0u), sw_prim(qe2, se2.x, 0u), se2.y);
  let rw = sw_rec(sw_prim(qw2, sw2.x, 0u), sw2.y, sw_prim(qw, sw.x, 0u), pcx, 0.0);
  let FE = sw_face(rc.hp, rc.ep, rc.up, rc.vp, 0.0, re.hm, re.em, re.um, re.vm, se.y, 0u);
  let FW = sw_face(rw.hp, rw.ep, rw.up, rw.vp, sw.y, rc.hm, rc.em, rc.um, rc.vm, 0.0, 1u);
  // well-balanced bed-slope source from the cell's own reconstruction
  let zxm = rc.em - rc.hm; let zxp = rc.ep - rc.hp;
  let Sx = 0.5 * SW_G * (rc.hm + rc.hp) * (zxm - zxp);

  // ── y direction (normal = v) ──
  let pcy = sw_prim(qc, sc.x, 1u);
  let tc = sw_rec(sw_prim(qn, sn.x, 1u), sn.y, pcy, sw_prim(qs, ss.x, 1u), ss.y);
  let ts = sw_rec(pcy, 0.0, sw_prim(qs, ss.x, 1u), sw_prim(qs2, ss2.x, 1u), ss2.y);
  let tn = sw_rec(sw_prim(qn2, sn2.x, 1u), sn2.y, sw_prim(qn, sn.x, 1u), pcy, 0.0);
  let GS = sw_face(tc.hp, tc.ep, tc.up, tc.vp, 0.0, ts.hm, ts.em, ts.um, ts.vm, ss.y, 0u);
  let GN = sw_face(tn.hp, tn.ep, tn.up, tn.vp, sn.y, tc.hm, tc.em, tc.um, tc.vm, 0.0, 1u);
  let zym = tc.em - tc.hm; let zyp = tc.ep - tc.hp;
  let Sy = 0.5 * SW_G * (tc.hm + tc.hp) * (zym - zyp);

  let k = dt / dx;
  var h  = qc.x - k * ((FE.x - FW.x) + (GS.x - GN.x));
  var hu = qc.y - k * ((FE.y + FE.w - FW.y - FW.w) + (GS.z - GN.z)) + k * Sx;
  var hv = qc.z - k * ((FE.z - FW.z) + (GS.y + GS.w - GN.y - GN.w)) + k * Sy;

  h = max(h, 0.0);
  if (h < SW_HDRY) { return vec4f(h, 0.0, 0.0, qc.w); }
  // semi-implicit Manning friction
  var u = sw_vel(h, hu); var v = sw_vel(h, hv);
  let sp = sqrt(u * u + v * v);
  let n = sc.z;
  let fr = 1.0 + dt * SW_G * n * n * sp / pow(max(h, 0.01), 4.0 / 3.0);
  u = u / fr; v = v / fr;
  // velocity cap 15 m/s (keeps the fixed dt stable). A thin-sheet cap ∝ √(gh) was tried and
  // halved the dam-break front speed (T2), so wet fronts are left to the desingularised velocity.
  let cap = 15.0;
  let sp2 = sqrt(u * u + v * v);
  if (sp2 > cap) { u = u * cap / sp2; v = v * cap / sp2; }
  return vec4f(h, h * u, h * v, qc.w);
}
`;
