// 3Dの地図を読みやすくする部品：道の線（地面に重ねる絵）・名前の札・選んだ地点の目印。
// 設計：docs/fable52/11_水の流れ・計算・画面・3D地図の設計.md（D3・D4）
import * as THREE from 'three/webgpu';
import { uv, float, vec4, vec3, smoothstep } from 'three/tsl';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { ROAD_WIDTH_M } from '../data/mapextra.js';

/**
 * the roads of the square painted into a transparent canvas (white strokes; the terrain shader tints them).
 * Only the alpha matters. Wide roads first, so narrow lanes stay visible where they meet.
 */
export function roadCanvas(roads, L, size = 2048) {
  const cv = new OffscreenCanvas(size, size);
  const g = cv.getContext('2d');
  g.clearRect(0, 0, size, size);
  g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#fff';
  const k = size / L, half = L / 2;
  for (let w = 4; w >= 0; w--) {
    g.lineWidth = Math.max(1.4, ROAD_WIDTH_M[w] * k);
    g.globalAlpha = w >= 2 ? 1 : 0.85;
    g.beginPath();
    for (const r of roads) {
      if (r.w !== w) continue;
      g.moveTo((r.pts[0][0] + half) * k, (r.pts[0][1] + half) * k);
      for (let i = 1; i < r.pts.length; i++) g.lineTo((r.pts[i][0] + half) * k, (r.pts[i][1] + half) * k);
    }
    g.stroke();
  }
  return cv;
}

const KIND_CLASS = { st: 'mp-st', sc: 'mp-sc', pub: 'mp-pub', tw: 'mp-tw' };
// how far away each kind is still worth a label (camera → label, metres)
const KIND_RANGE = { st: 4000, sc: 1800, pub: 1500, tw: 1100 };

/**
 * name labels on the 3-D map. At most `max` at a time; a label that would cover another gives way by rank
 * (station > school > hospital / fire / police > town name), then by distance to the chosen point.
 * @param list   [{ name, kind, rank, x, z }] in local metres
 * @param o      { groundAt(x, z), pin: { x, z }, half (m: labels outside ±half are dropped), max }
 */
export function createMapLabels(list, { groundAt, pin, half, max = 12 }) {
  const group = new THREE.Group();
  const items = list
    .filter((l) => Math.abs(l.x) < half && Math.abs(l.z) < half)
    .map((l) => ({ ...l, d: Math.hypot(l.x - pin.x, l.z - pin.z) }))
    .sort((a, b) => b.rank - a.rank || a.d - b.d)
    .slice(0, 90)
    .map((l) => {
      const el = document.createElement('div');
      el.className = `lbl mp ${KIND_CLASS[l.kind] ?? 'mp-tw'}`;
      el.textContent = l.name;
      const o = new CSS2DObject(el);
      o.position.set(l.x, groundAt(l.x, l.z) + (l.kind === 'st' ? 14 : 8), l.z);
      o.visible = false;
      group.add(o);
      // rough footprint on screen (12 px type, 8 px padding each side) — measuring the DOM every time is too slow
      return { ...l, o, w: l.name.length * 12.5 + 18, h: 22 };
    });
  const v = new THREE.Vector3();
  let shown = true;
  return {
    group, count: items.length,
    setVisible(on) { shown = on; if (!on) for (const it of items) it.o.visible = false; },
    /** call every few frames. `keep` = screen rectangles [x0, y0, x1, y1] the labels must stay clear of */
    update(camera, W, H, keep = []) {
      if (!shown) return;
      const taken = keep.slice();
      let n = 0;
      for (const it of items) {
        let ok = n < max;
        if (ok) {
          const dist = camera.position.distanceTo(it.o.position);
          ok = dist < (KIND_RANGE[it.kind] ?? 1000) && dist > 25;
        }
        if (ok) {
          v.copy(it.o.position).project(camera);
          ok = v.z > -1 && v.z < 1 && Math.abs(v.x) < 0.96 && Math.abs(v.y) < 0.94;
          if (ok) {
            const cx = (v.x * 0.5 + 0.5) * W, cy = (-v.y * 0.5 + 0.5) * H;
            const r = [cx - it.w / 2 - 4, cy - it.h / 2 - 3, cx + it.w / 2 + 4, cy + it.h / 2 + 3];
            // the whole label on screen (a name cut off by the edge reads as another name), clear of what is taken
            ok = r[0] >= 4 && r[2] <= W - 4 && r[1] >= 4 && r[3] <= H - 4 && !taken.some((t) => r[0] < t[2] && r[2] > t[0] && r[1] < t[3] && r[3] > t[1]);
            if (ok) { taken.push(r); n++; }
          }
        }
        it.o.visible = ok;
      }
    },
    dispose() { for (const it of items) it.o.element.remove(); group.clear(); },
  };
}

/**
 * the chosen point seen from far away: a thin column of light and a ring on the ground (the red pole itself
 * is 6 m tall and disappears in the overview). Thickness follows the viewing distance.
 */
export function createBeacon(ground, height = 80) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  // brightest at the foot, gone at the top; the same red as the 「ここ」 label (white is kept for the flow marks)
  mat.colorNode = vec4(vec3(1.0, 0.42, 0.34), 1);
  mat.opacityNode = float(1).sub(uv().y).pow(1.6).mul(0.5).mul(smoothstep(0.0, 0.04, uv().y).mul(0.6).add(0.4));
  const col = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, height, 20, 1, true), mat);
  col.position.y = height / 2;
  col.renderOrder = 5;
  g.add(col);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 48), new THREE.MeshBasicNodeMaterial({ color: 0xff6a57, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.3;
  ring.renderOrder = 5;
  g.add(ring);
  g.position.y = ground;
  return {
    group: g,
    /** dist = camera → point (m). Near the point the pole and its labels do the job: the column fades out */
    update(dist) {
      const r = THREE.MathUtils.clamp(dist * 0.0022, 0.35, 9);
      col.scale.set(r, 1, r);
      const rr = THREE.MathUtils.clamp(dist * 0.02, 4, 60);
      ring.scale.set(rr, rr, 1);
      g.visible = dist > 70;
    },
  };
}
