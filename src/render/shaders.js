// ─────────────────────────────────────────────────────────────
//  WGSL shading library — sky, tsunami water, caustic photons
//  World: x east, y up, z south (metres). Domain |x|,|z| < D/2 → uv = (xz + D/2) / D
//  L   : unit vector toward the sun
//  env : x = domain size D, y = time, z = caustic gain, w = depth-colour mode (0/1)
// ─────────────────────────────────────────────────────────────
export const LIB = /* wgsl */ `
const W_PI: f32 = 3.14159265;
const W_SUN: vec3f = vec3f(1.00, 0.93, 0.82);

// integer hash (PCG-style): exact at any coordinate — the fract(sin)-style hash lost f32 precision
// ~2 km from the origin and snapped foam lace / caustic nets to a grid (九条 r2 #1)
fn w_h2(p: vec2f) -> vec2f {
  var v = bitcast<vec2u>(vec2i(floor(p)));
  v = v * 1664525u + 1013904223u;
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v = v ^ (v >> vec2u(16u));
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  return vec2f(v >> vec2u(8u)) / 16777216.0;
}
fn w_hash(p: vec2f) -> f32 { return w_h2(p).x; }
fn w_noise(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(w_hash(i), w_hash(i + vec2f(1.0, 0.0)), u.x), mix(w_hash(i + vec2f(0.0, 1.0)), w_hash(i + vec2f(1.0, 1.0)), u.x), u.y);
}
fn w_fbm(p0: vec2f) -> f32 {
  var p = p0; var s = 0.0; var a = 0.5;
  for (var i = 0; i < 5; i++) { s += a * w_noise(p); p = p * 2.03 + vec2f(17.1, 9.7); a *= 0.5; }
  return s;
}
// cellular noise → lace-like foam
fn w_worley(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p);
  var d = 1.0;
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let o = vec2f(f32(x), f32(y));
    let r = w_h2(i + o);
    d = min(d, length(o + r - f));
  } }
  return d;
}

fn w_sky(d0: vec3f, L: vec3f) -> vec3f {
  let d = normalize(d0);
  let up = max(d.y, 0.0);
  let mu = max(dot(d, L), 0.0);
  var col = mix(vec3f(0.72, 0.80, 0.88), vec3f(0.20, 0.38, 0.70), pow(up, 0.45));
  col += vec3f(1.0, 0.82, 0.60) * (0.30 * pow(mu, 6.0) + 0.6 * pow(mu, 120.0));
  if (d.y > 0.0) {
    let cp = d.xz / (d.y + 0.10) * 1.4 + vec2f(3.0, 1.0);
    let c = smoothstep(0.48, 0.80, w_fbm(cp));
    let lit = 0.95 + 0.3 * pow(mu, 3.0);
    col = mix(col, vec3f(lit) * vec3f(1.0, 0.98, 0.95), c * 0.7 * smoothstep(0.0, 0.2, d.y));
  }
  col += W_SUN * 30.0 * smoothstep(0.99955, 0.99985, mu);
  if (d.y < 0.0) { col = mix(vec3f(0.62, 0.68, 0.72), vec3f(0.30, 0.33, 0.30), smoothstep(0.0, 0.1, -d.y)); }
  return col;
}

// JIS/MLIT-hazard-map-style depth ramp (0.3 / 1 / 2 / 5 / 10 / 20 m)
fn w_depthColor(h: f32) -> vec3f {
  if (h < 0.3) { return vec3f(1.00, 1.00, 0.70); }
  if (h < 1.0) { return vec3f(0.97, 0.96, 0.66); }
  if (h < 2.0) { return vec3f(1.00, 0.85, 0.75); }
  if (h < 5.0) { return vec3f(1.00, 0.72, 0.72); }
  if (h < 10.0) { return vec3f(1.00, 0.57, 0.57); }
  if (h < 20.0) { return vec3f(0.95, 0.52, 0.79); }
  return vec3f(0.86, 0.48, 0.86);
}

fn w_fresnel(c: f32) -> f32 {
  let x = 1.0 - clamp(c, 0.0, 1.0);
  return 0.02 + 0.98 * x * x * x * x * x;
}
`;

// water surface colour (analytic refraction to the flooded ground, reflection, foam)
export const WATER_FN = /* wgsl */ `
fn w_water(p: vec3f, eye: vec3f, L: vec3f, nIn: vec2f, h: f32, turb: f32, foamIn: f32, flow: vec2f,
           env: vec4f, pt: texture_2d<f32>, ps: sampler, ct: texture_2d<f32>, cs: sampler,
           bt: texture_2d<f32>, bs: sampler) -> vec4f {
  let D = env.x;
  let time = env.y;
  let sp = length(flow);
  // ripples advected by the flow (two-phase flow map avoids stretching)
  let T = 3.0;
  let ph0 = fract(time / T);
  let ph1 = fract(time / T + 0.5);
  let wgt = abs(ph0 - 0.5) * 2.0;
  let amp = 0.05 + 0.25 * smoothstep(0.3, 2.0, sp) + 0.06 * smoothstep(0.1, 0.6, turb);
  // ripples stretched 4× along the flow → streaky, directional turbulent surface
  let fd = select(vec2f(1.0, 0.0), flow / max(sp, 1e-3), sp > 0.05);
  let stretch = mix(1.0, 0.25, smoothstep(0.3, 2.0, sp)); // calm water: isotropic; fast flow: streaks
  let fq = vec2f(dot(p.xz, fd) * stretch, dot(p.xz, vec2f(-fd.y, fd.x)));
  let q0 = fq * 0.55 - vec2f(sp * ph0 * T * 0.55 * stretch, 0.0);
  let q1 = fq * 0.55 - vec2f(sp * ph1 * T * 0.55 * stretch, 0.0) + vec2f(5.2, 1.3);
  let e = 0.08;
  let g0 = vec2f(w_fbm(q0 + vec2f(e, 0.0)) - w_fbm(q0 - vec2f(e, 0.0)), w_fbm(q0 + vec2f(0.0, e)) - w_fbm(q0 - vec2f(0.0, e))) / (2.0 * e);
  let g1 = vec2f(w_fbm(q1 + vec2f(e, 0.0)) - w_fbm(q1 - vec2f(e, 0.0)), w_fbm(q1 + vec2f(0.0, e)) - w_fbm(q1 - vec2f(0.0, e))) / (2.0 * e);
  // calm swell ripples even without flow
  let sw = vec2f(sin(p.x * 0.9 + time * 1.7) * 0.5 + sin(p.x * 0.37 - p.z * 0.52 + time * 1.1),
                 cos(p.z * 0.8 + time * 1.5) * 0.5 + cos(p.x * 0.41 + p.z * 0.33 + time * 0.9)) * 0.018;
  // detail fades with distance (one pixel covering metres of water must not sparkle — セーブル #5)
  let fw = length(fwidth(p.xz));
  let far = 1.0 / (1.0 + 2.5 * fw);
  let det = (mix(g0, g1, wgt) * amp + sw) * far;
  let n = normalize(vec3f(nIn.x - det.x, 1.0, nIn.y - det.y));
  let V = normalize(eye - p);
  let cosV = max(dot(n, V), 0.0);
  let F = mix(w_fresnel(cosV), 0.12 + 0.88 * w_fresnel(cosV), smoothstep(0.1, 0.6, turb) * 0.6);

  // reflection: sky + sharp HDR sun glints
  let R = reflect(-V, n);
  var refl = w_sky(vec3f(R.x, abs(R.y), R.z), L);
  // buildings mirrored in the water: march the reflected ray over the height map (セーブル r2 #4)
  {
    let uvR = (p.xz + vec2f(D * 0.5)) / D;
    for (var i = 1; i <= 12; i++) {
      let q = p + R * (f32(i) * 4.0);
      let b = textureSampleLevel(bt, bs, (q.xz + vec2f(D * 0.5)) / D, 0.0);
      if (b.y > 0.5 && b.x + b.y > q.y) { refl = vec3f(0.30, 0.29, 0.27) * (0.45 + 0.55 * clamp(dot(normalize(vec3f(-R.x, 0.0, -R.z)), L) + 0.5, 0.0, 1.0)); break; }
    }
  }
  let sh = max(dot(R, L), 0.0);

  // absorption: clear coastal sea ↔ sediment-laden flood water (turbidity C)
  let C = clamp(turb, 0.0, 1.0);
  let sigSea = vec3f(0.55, 0.32, 0.38);  // 伊勢湾・名古屋港: green-grey coastal water, not the Caribbean
  let sigMud = vec3f(2.4, 2.9, 3.8);
  let sig = mix(sigSea, sigMud, smoothstep(0.08, 0.7, C));
  let mudPatch = mix(0.8, 1.15, w_fbm(p.xz * 0.012 - flow * time * 0.02));
  let mudScat = mix(vec3f(0.20, 0.15, 0.10), vec3f(0.07, 0.06, 0.045), smoothstep(0.3, 3.0, h)) * mudPatch;
  let scat = mix(vec3f(0.04, 0.07, 0.05), mudScat, smoothstep(0.08, 0.7, C));

  // per-pixel depth against the real ground → smooth shoreline instead of 2 m steps (セーブル #4)
  let uvP = (p.xz + vec2f(D * 0.5)) / D;
  let bedP = textureSampleLevel(bt, bs, uvP, 0.0);
  let hp = p.y - bedP.x;
  // sun shadow of buildings on the water: the lowest sunlit level is baked into bedTex.w (九条 r2 #2)
  let shadow = mix(0.25, 1.0, smoothstep(bedP.w - 0.4, bedP.w + 0.4, p.y));
  // refracted ray to the ground
  let Tr = refract(-V, n, 1.0 / 1.333);
  let tPath = h / max(-Tr.y, 0.18);
  let hitXZ = p.xz + Tr.xz * min(tPath, 40.0);
  let uvB = (hitXZ + vec2f(D * 0.5)) / D;
  let bed = textureSampleLevel(bt, bs, uvB, 0.0);
  let photo = textureSampleLevel(pt, ps, uvB, 0.0).rgb;
  let seaBed = vec3f(0.33, 0.36, 0.30);
  let albedo = mix(photo * 0.85, seaBed, bed.z) * 0.9;
  let caus = textureSampleLevel(ct, cs, uvB, 0.0).rgb;
  let Ls = refract(-L, vec3f(0.0, 1.0, 0.0), 1.0 / 1.333);
  let down = exp(-sig * h / max(-Ls.y, 0.2));
  let up = exp(-sig * tPath);
  let clearMask = (1.0 - smoothstep(0.15, 0.35, C)) * (1.0 - smoothstep(1.5, 4.0, h));
  let causL = mix(vec3f(1.0), caus, clearMask * env.z);
    // near-field caustic net drawn per pixel at the refracted hit (the map alone is ~1 m/texel)
  let cwW = clearMask * env.z * (1.0 - smoothstep(0.02, 0.2, fw)) * smoothstep(0.05, 0.3, h);
  var causNear = vec3f(1.0);
  if (cwW > 0.001) {
    let cw = pow(1.0 - w_worley(hitXZ * 1.6 + vec2f(time * 0.35, time * 0.2)), 4.0) + pow(1.0 - w_worley(hitXZ * 2.3 - vec2f(time * 0.25, -time * 0.3)), 4.0);
    causNear = mix(vec3f(1.0), vec3f(0.6 + 2.0 * cw), cwW);
  }
  let bottom = albedo * exp(-4.0 * sig.g * max(h - 1.0, 0.0)) * (W_SUN * 2.6 * L.y * down * causL * causNear * shadow + vec3f(0.35, 0.42, 0.5) * down * 0.9);
  let inscatter = scat * (W_SUN * 1.3 * L.y * shadow + vec3f(0.30, 0.38, 0.46)) * (vec3f(1.0) - up);
  var body = bottom * up + inscatter;
  // light through the steep face of a bore (translucent green wall — セーブル #5)
  let slope = length(nIn);
  body += vec3f(0.10, 0.20, 0.14) * pow(clamp(dot(V, -L) * 0.5 + 0.5, 0.0, 1.0), 4.0) * smoothstep(0.05, 0.25, slope) * (1.0 - smoothstep(0.2, 0.8, C)) * 3.0 * shadow;
  // detail lost to distance becomes roughness: a broad sun sheen instead of a flat plate (セーブル r2 #1)
  let rg = 1.0 - far;
  let glint = W_SUN * (pow(sh, mix(1200.0, 60.0, rg)) * mix(60.0, 3.0, rg) + pow(sh, 90.0) * 1.2) * shadow;

  // foam: lace from cellular noise, advected like the ripples
  let fp0 = p.xz * 0.9 - flow * ph0 * T * 0.9;
  let fp1 = p.xz * 0.9 - flow * ph1 * T * 0.9 + vec2f(2.1, 7.4);
  let cell = mix(w_worley(fp0), w_worley(fp1), wgt);
  let fine = w_fbm(p.xz * 3.1 + vec2f(time * 0.3, 0.0));
  let Fr = sp / sqrt(9.81 * max(h, 0.02));
  // front of water racing over dry ground + steep supercritical bore faces churn white
  let edgeBand = (1.0 - smoothstep(0.0, 0.25, hp)) * step(0.3, sp);
  let foamAmt = clamp(foamIn + smoothstep(0.05, 0.15, slope) * smoothstep(0.8, 1.2, Fr) + edgeBand * 0.8, 0.0, 1.5);
  let lace = smoothstep(0.62 - 0.5 * foamAmt, 0.9 - 0.4 * foamAmt, cell + 0.35 * fine);
  var cover = clamp(foamAmt * 1.1, 0.0, 1.0) * lace;
  // foam streaks drawn out along the current
  let streak = w_fbm(vec2f(dot(p.xz, fd) * 0.04 - sp * time * 0.04, dot(p.xz, vec2f(-fd.y, fd.x)) * 0.6));
  cover = max(cover, smoothstep(0.58, 0.75, streak) * smoothstep(0.2, 1.0, sp) * 0.6);
  // water touching a building: dark contact band, white wake where the current hits it
  var nearB = 0.0;
  for (var k = 0; k < 4; k++) {
    let o = vec2f(select(-3.0, 3.0, k % 2 == 0) * f32(k < 2), select(-3.0, 3.0, k % 2 == 0) * f32(k >= 2));
    nearB = max(nearB, step(0.5, textureSampleLevel(bt, bs, (p.xz + o + vec2f(D * 0.5)) / D, 0.0).y));
  }
  let hitB = step(0.5, textureSampleLevel(bt, bs, (p.xz + fd * 4.0 + vec2f(D * 0.5)) / D, 0.0).y) * smoothstep(0.3, 1.5, sp);
  cover = max(cover, hitB * 0.8 * lace);
  let foamAlb = vec3f(0.88, 0.88, 0.85);
  let foamCol = foamAlb * (W_SUN * 1.5 * max(L.y, 0.2) * shadow + vec3f(0.35, 0.40, 0.45)) * mix(0.85, 1.0, fine);
  let Fx = min(F + 0.04 * rg, 1.0);
  var col = mix(body, refl, Fx) + glint * Fx;
  col = mix(col, foamCol, cover);
  col *= mix(1.0, 0.6, nearB * (1.0 - cover));

  // optional hazard-map colouring of the depth (land only)
  if (env.w > 0.5 && bed.z < 0.5) {
    let dc = pow(w_depthColor(h), vec3f(2.2)) * 1.35; // same hue as the legend, not lit by the sun
    col = mix(col, dc, 0.9);
  }
  // shallow margins thin out → the flooded ground shows through
  let a = smoothstep(0.0, 0.15, hp) * smoothstep(0.0, 0.004, h);
  return vec4f(col, a);
}
`;

// caustic photons: refract a grid through the surface onto a flat bed h below it.
export const CAUSTIC_FN = /* wgsl */ `
fn w_causticPos(uvIn: vec2f, st: texture_2d<f32>, ss: sampler, L: vec3f, env: vec4f) -> vec4f {
  let D = env.x;
  let time = env.y;
  let s = textureSampleLevel(st, ss, uvIn, 0.0);
  let x = uvIn * D - vec2f(D * 0.5);
  // fine capillary ripples on top of the simulated surface (what makes real caustic nets)
  let q = x * 0.35 + vec2f(time * 0.25, time * 0.15); // ≥ 3 m ripples: resolvable by a 1 m/texel map
  let e = 0.05;
  let g = vec2f(w_fbm(q + vec2f(e, 0.0)) - w_fbm(q - vec2f(e, 0.0)), w_fbm(q + vec2f(0.0, e)) - w_fbm(q - vec2f(0.0, e))) / (2.0 * e);
  let sw = vec2f(sin(x.x * 0.9 + time * 1.7), cos(x.y * 0.8 + time * 1.5)) * 0.03;
  let n = normalize(vec3f(s.y - g.x * 0.25 - sw.x, 1.0, s.z - g.y * 0.25 - sw.y));
  let R0 = refract(-L, vec3f(0.0, 1.0, 0.0), 1.0 / 1.333);
  let R = refract(-L, n, 1.0 / 1.333);
  let h = max(s.x, 0.0);
  let hit = x + R.xz * (h / max(-R.y, 0.2));
  let flat = x + R0.xz * (h / max(-R0.y, 0.2));
  return vec4f(flat, hit);
}
`;
