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
fn w_fbm4(p0: vec2f) -> f32 {
  var p = p0; var s = 0.0; var a = 0.5;
  for (var i = 0; i < 4; i++) { s += a * w_noise(p); p = p * 2.03 + vec2f(17.1, 9.7); a *= 0.5; }
  return s;
}
// slope of the fbm (forward differences: three taps instead of four)
fn w_grad(q: vec2f) -> vec2f {
  let e = 0.09;
  let a = w_fbm4(q);
  return vec2f(w_fbm4(q + vec2f(e, 0.0)) - a, w_fbm4(q + vec2f(0.0, e)) - a) / e;
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
// Rendering only: it reads the solver's fields (depth, flow, foam, turbidity) and never feeds back into them.
//
// What makes it read as water rather than a drawing (docs/fable52/08_水の見た目の設計.md):
//  A  all noise lives in WORLD space and is carried by the flow (two-phase flow map). Nothing is built in a
//     per-pixel "along the flow" frame: where the direction turns, such a frame draws the noise's contour lines
//     across the whole surface (the white fingerprint lines of the old version)
//  B  detail lost to distance, and fast flow, become ROUGHNESS: a rough surface is no mirror at grazing angles,
//     so the body colour of the water stays visible from eye level
//  C  water standing on land is sediment-laden flood water, whatever the advected turbidity says so far
//  D  foam is soft, uneven patches (thresholded fbm), not equal-sized cells
export const WATER_FN = /* wgsl */ `
fn w_water(p: vec3f, eye: vec3f, L: vec3f, nIn: vec2f, h: f32, turb: f32, foamIn: f32, flow: vec2f,
           env: vec4f, pt: texture_2d<f32>, ps: sampler, ct: texture_2d<f32>, cs: sampler,
           bt: texture_2d<f32>, bs: sampler) -> vec4f {
  let D = env.x;
  let time = env.y;
  let sp = length(flow);
  let fd = select(vec2f(1.0, 0.0), flow / max(sp, 1e-3), sp > 0.05);
  let fast = smoothstep(0.3, 2.5, sp);
  // two-phase flow map: each layer rides the current for T seconds, then hands over to the other
  let T = 3.0;
  let ph0 = fract(time / T);
  let ph1 = fract(time / T + 0.5);
  let wgt = abs(ph0 - 0.5) * 2.0;            // weight of layer 1 (layer 0 is weighted 1 − wgt)
  let a0 = flow * ((ph0 - 0.5) * T);         // how far layer 0 has been carried (zero at its full weight)
  let a1 = flow * ((ph1 - 0.5) * T);
  let x0 = p.xz - a0;
  let x1 = p.xz - a1 + vec2f(31.7, 12.3);

  // ── ripples: slopes of world-space noise ──
  let fw = length(fwidth(p.xz));
  let far = 1.0 / (1.0 + 2.5 * fw);           // detail fades with distance (a pixel covering metres must not sparkle)
  var g = mix(w_grad(x0 * 0.55), w_grad(x1 * 0.55), wgt);
  let nearW = 1.0 - smoothstep(0.015, 0.09, fw);
  if (nearW > 0.01) {                          // finer chop, only where it can be resolved
    let c = vec2f(time * 0.21, time * 0.13);
    g += mix(w_grad(x0 * 2.1 + c), w_grad(x1 * 2.1 + c), wgt) * (0.45 * nearW);
  }
  // fast water: slopes along the current are flattened → long ripples lying with the flow
  g -= fd * (dot(g, fd) * 0.7 * fast);
  let amp = 0.05 + 0.50 * fast + 0.07 * smoothstep(0.1, 0.6, turb);
  // boils and surges of a strong current: broad undulations (8–15 m), large enough to show from high above
  let big = mix(w_grad(x0 * 0.11), w_grad(x1 * 0.11), wgt) * (0.22 * fast);
  // calm swell ripples even without flow
  let sw = vec2f(sin(p.x * 0.9 + time * 1.7) * 0.5 + sin(p.x * 0.37 - p.z * 0.52 + time * 1.1),
                 cos(p.z * 0.8 + time * 1.5) * 0.5 + cos(p.x * 0.41 + p.z * 0.33 + time * 0.9)) * 0.018;
  let det = (g * amp + sw) * far + big;
  let n = normalize(vec3f(nIn.x - det.x, 1.0, nIn.y - det.y));
  let V = normalize(eye - p);
  let cosV = max(dot(n, V), 0.0);

  // per-pixel depth against the real ground → smooth shoreline instead of 2 m steps
  let uvP = (p.xz + vec2f(D * 0.5)) / D;
  let bedP = textureSampleLevel(bt, bs, uvP, 0.0);
  let hp = p.y - bedP.x;
  // flood water on land is muddy from the moment it arrives (a floor under the advected turbidity field).
  // A rendering assumption, not a computed quantity: the sea, canals and rivers keep the simulated value.
  // (ten taps around the pixel: the outer ring softens the land / sea edge of that floor, which otherwise shows
  //  the 10 m steps of the elevation data; the inner ring finds walls standing in the water for the contact shade)
  var landW = 1.0 - bedP.z;
  var nearB = 0.0;
  for (var k = 0; k < 10; k++) {
    let inner = k < 4;
    let ang = select(f32(k - 4) * 1.0472 + 0.4, f32(k) * 1.5708, inner);
    let rad = select(select(20.0, 11.0, k % 2 == 0), 3.0, inner);   // 3 m (walls) · 11 m and 20 m (the land / sea steps are 10–20 m)
    let b = textureSampleLevel(bt, bs, (p.xz + vec2f(cos(ang), sin(ang)) * rad + vec2f(D * 0.5)) / D, 0.0);
    landW += 1.0 - b.z;
    // only a wall that stands above the water throws a contact shade (washed-away houses lie under it)
    if (inner) { nearB += step(0.5, b.y) * step(p.y + 0.3, b.x + b.y); }
  }
  let onLand = smoothstep(0.2, 0.8, landW / 11.0);
  nearB = min(nearB * 0.5, 1.0);
  // faster water carries more silt (and looks it)
  let C = max(clamp(turb, 0.0, 1.0), onLand * min(mix(0.36, 0.62, smoothstep(0.05, 1.2, h)) + 0.18 * fast, 0.85));
  let mudW = smoothstep(0.08, 0.7, C);

  // ── reflection: a rough surface is not a mirror ──
  let rg = 1.0 - far;                          // roughness standing in for the detail lost to distance
  let rough = clamp(rg + 0.3 * fast + 0.25 * mudW, 0.0, 1.0);   // churned, silty water is rougher still
  let F = w_fresnel(max(cosV, mix(0.05, 0.26, rough)));
  let Rm = reflect(-V, n);
  let R = vec3f(Rm.x, abs(Rm.y), Rm.z);
  // a rough surface mirrors a patch of sky above the mirror direction, not the white band on the horizon
  var refl = w_sky(normalize(R + vec3f(0.0, 0.30 * rough, 0.0)), L);
  // buildings mirrored in the water: march the reflected ray over the height map
  {
    for (var i = 1; i <= 12; i++) {
      let q = p + R * (f32(i) * 4.0);
      let b = textureSampleLevel(bt, bs, (q.xz + vec2f(D * 0.5)) / D, 0.0);
      if (b.y > 0.5 && b.x + b.y > q.y) { refl = vec3f(0.30, 0.29, 0.27) * (0.45 + 0.55 * clamp(dot(normalize(vec3f(-R.x, 0.0, -R.z)), L) + 0.5, 0.0, 1.0)); break; }
    }
  }
  let sh = max(dot(R, L), 0.0);

  // sun shadow of buildings on the water: the lowest sunlit level is baked into bedTex.w
  let shadow = mix(0.25, 1.0, smoothstep(bedP.w - 1.2, bedP.w + 1.2, p.y));   // wide: the baked level has 2 m steps

  // ── body: clear coastal sea ↔ sediment-laden flood water ──
  let sigSea = vec3f(0.55, 0.32, 0.38);  // 伊勢湾・名古屋港: green-grey coastal water, not the Caribbean
  let sigMud = vec3f(2.4, 2.9, 3.8);
  let sig = mix(sigSea, sigMud, mudW);
  // silt clouds carried by the current: the body colour is never one flat brown
  let mudPatch = mix(0.76, 1.22, mix(w_fbm4(x0 * 0.05), w_fbm4(x1 * 0.05), wgt));
  // dark grey-brown, like the water that ran through the streets in 2011 — not the ochre of a dry lot
  let mudScat = mix(vec3f(0.17, 0.135, 0.095), vec3f(0.075, 0.06, 0.045), smoothstep(0.3, 3.0, h)) * mudPatch;
  let scat = mix(vec3f(0.04, 0.07, 0.05), mudScat, mudW);

  // refracted ray to the ground
  let Tr = refract(-V, n, 1.0 / 1.333);
  let tPath = h / max(-Tr.y, 0.18);
  let hitXZ = p.xz + Tr.xz * min(tPath, 40.0);
  let uvB = (hitXZ + vec2f(D * 0.5)) / D;
  let bed = textureSampleLevel(bt, bs, uvB, 0.0);
  let photo = textureSampleLevel(pt, ps, uvB, 0.0).rgb;
  let seaBed = vec3f(0.33, 0.36, 0.30);
  // ground seen through shallow water is wet ground: darker than the dry street next to it, so the reach of a
  // thin sheet of water stays readable without a broad band of foam
  let albedo = mix(photo * 0.85 * 0.50, seaBed, bed.z) * 0.9;
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
  // fast water shows its direction: world-space noise averaged along the current → long, low-contrast streaks
  // (a short line-integral convolution; nothing is drawn in a rotated frame, so no contour lines)
  var streak = 0.5;
  if (fast > 0.02) {
    // lanes a few metres wide and tens of metres long, and only in patches: fine parallel lines would read as tyre tracks
    let st = fd * 4.5;
    let l0 = (w_noise((x0 - st * 2.0) * 0.30) + w_noise((x0 - st) * 0.30) + w_noise(x0 * 0.30) + w_noise((x0 + st) * 0.30) + w_noise((x0 + st * 2.0) * 0.30)) * 0.2;
    let l1 = (w_noise((x1 - st * 2.0) * 0.30) + w_noise((x1 - st) * 0.30) + w_noise(x1 * 0.30) + w_noise((x1 + st) * 0.30) + w_noise((x1 + st * 2.0) * 0.30)) * 0.2;
    streak = 0.5 + (mix(l0, l1, wgt) - 0.5) / sqrt(wgt * wgt + (1.0 - wgt) * (1.0 - wgt));
    let lanes = smoothstep(0.35, 0.65, mudPatch * 0.5 + 0.02);
    body *= 1.0 + (streak - 0.5) * 1.6 * fast * mix(0.35, 1.0, lanes);
  }
  // light through the steep face of a bore (translucent green wall, clear water only)
  let slope = length(nIn);
  body += vec3f(0.10, 0.20, 0.14) * pow(clamp(dot(V, -L) * 0.5 + 0.5, 0.0, 1.0), 4.0) * smoothstep(0.05, 0.25, slope) * (1.0 - smoothstep(0.2, 0.8, C)) * 3.0 * shadow;
  // sun: sharp glints close by, a broad sheen where the surface is rough
  let glint = W_SUN * (pow(sh, mix(1200.0, 60.0, rg)) * mix(60.0, 3.0, rg) + pow(sh, 90.0) * 1.2) * shadow;

  // ── foam: how much comes from the solver's foam field, the bore face, the flood front and walls in the current ──
  let Fr = sp / sqrt(9.81 * max(h, 0.02));
  // the front of water running over dry ground: a narrow line, not a broad white band
  let edge = (1.0 - smoothstep(0.0, 0.18, hp)) * smoothstep(0.3, 1.0, sp);
  let hitB = step(0.5, textureSampleLevel(bt, bs, (p.xz + fd * 4.0 + vec2f(D * 0.5)) / D, 0.0).y) * smoothstep(0.3, 1.5, sp);
  let foamAmt = clamp(foamIn + smoothstep(0.05, 0.15, slope) * smoothstep(0.8, 1.2, Fr) + edge * 0.85 + hitB * 0.6
                      + smoothstep(0.58, 0.72, streak) * fast * 0.2, 0.0, 1.5);
  var cover = 0.0;
  var tex = 0.5;
  if (foamAmt > 0.01) {
    // soft patches of uneven size; the fine layer is averaged along the current → drawn-out streaks of bubbles
    let s3 = fd * (1.6 * fast);
    let t0 = w_fbm4(x0 * 0.27) * 0.62 + (w_noise((x0 - s3) * 1.9) + w_noise(x0 * 1.9) + w_noise((x0 + s3) * 1.9)) * (0.38 / 3.0);
    let t1 = w_fbm4(x1 * 0.27) * 0.62 + (w_noise((x1 - s3) * 1.9) + w_noise(x1 * 1.9) + w_noise((x1 + s3) * 1.9)) * (0.38 / 3.0);
    // blending two layers halves their contrast mid-way: restore it, or the foam would pulse every T seconds
    tex = 0.47 + (mix(t0, t1, wgt) - 0.47) / sqrt(wgt * wgt + (1.0 - wgt) * (1.0 - wgt));
    let amt = clamp(foamAmt, 0.0, 1.0);
    let th = mix(0.72, 0.30, amt);
    // little foam: no isolated blobs (they read as polka dots from above), only a soft veil; more foam: patches
    // soft-edged, and on silty water a thin brown scum rather than white floes (which would read as ice or debris)
    cover = smoothstep(th, th + mix(0.44, 0.22, amt), tex) * smoothstep(0.30, 0.70, amt) * mix(1.0, 0.55, mudW);
    cover = max(cover, amt * amt * 0.22);     // a thin veil of fine bubbles where the foam is thick
  }
  // foam on muddy water is cream, not paper white
  let foamAlb = mix(vec3f(0.90, 0.90, 0.87), vec3f(0.60, 0.55, 0.47), mudW);
  let foamCol = foamAlb * (W_SUN * 1.5 * max(L.y, 0.2) * shadow + vec3f(0.35, 0.40, 0.45)) * mix(0.84, 1.0, tex);
  var col = mix(body, refl, F) + glint * F;
  col = mix(col, foamCol, cover * 0.92);
  col *= mix(1.0, 0.80, nearB * (1.0 - cover));   // water touching a standing wall: a soft contact shade

  // optional hazard-map colouring of the depth (land only)
  if (env.w > 0.5 && bed.z < 0.5) {
    let dc = pow(w_depthColor(h), vec3f(2.2)) * 1.35; // same hue as the legend, not lit by the sun
    col = mix(col, dc, 0.9);
  }
  // shallow margins thin out → the flooded ground shows through
  let a = smoothstep(0.0, 0.10, hp) * smoothstep(0.0, 0.004, h);
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
