// 選んだ地点の「ここの深さ」柱（1m目盛り・人影・階の線）と、海岸の「海の高さ」標柱
import * as THREE from 'three/webgpu';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const label = (text, cls) => {
  const el = document.createElement('div');
  el.className = `lbl ${cls}`;
  el.textContent = text;
  return new CSS2DObject(el);
};

export function createPin(ground, poleH, seaH = null) {
  const g = new THREE.Group();
  const H = Math.max(6, Math.ceil(poleH));
  const white = new THREE.MeshStandardNodeMaterial({ color: 0xf4f4f0, roughness: 0.5 });
  const red = new THREE.MeshStandardNodeMaterial({ color: 0xd8483c, roughness: 0.45 });
  const dark = new THREE.MeshStandardNodeMaterial({ color: 0x2b2522, roughness: 0.8 });
  // pole: alternating red/white metre bands
  for (let m = 0; m < H; m++) {
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1, 12), m % 2 ? white : red);
    seg.position.y = m + 0.5;
    seg.castShadow = true;
    g.add(seg);
  }
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), red);
  cap.position.y = H + 0.15;
  g.add(cap);
  const ticks = [], details = [];
  for (const m of [1, 2, 3, 5, 10, 15, 20].filter((v) => v < H)) {
    const l = label(`${m}m`, 'tick');
    l.position.set(-0.35, m, 0);
    l.center.set(1, 0.5);
    g.add(l);
    ticks.push(l); details.push(l);
  }
  // 170 cm person (stylised, dark) next to the pole
  const person = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.75, 6, 12), dark);
  body.position.y = 0.2 + 0.375 + 0.35;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), dark);
  head.position.y = 1.57;
  const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.55, 4, 8), dark);
  legs.position.y = 0.4;
  person.add(body, head, legs);
  person.position.set(-0.7, 0, 0.25);
  person.traverse((o) => { o.castShadow = true; });
  g.add(person);
  // storey lines: ceiling of 1F (2.5 m) and floor of 2F (3.0 m)
  const ringMat = new THREE.MeshBasicNodeMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
  for (const [y, t] of [[2.5, null], [3.0, '2階の床 3m']]) {
    const r = new THREE.Mesh(new THREE.RingGeometry(1.4, 1.5, 48), ringMat);
    r.rotation.x = -Math.PI / 2;
    r.position.y = y;
    g.add(r);
    if (!t) continue;
    const l = label(t, 'floor');
    l.position.set(1.6, y, 0);
    l.center.set(0, 0.5);
    g.add(l);
    details.push(l);
  }
  // the assumed sea height drawn on this pole: "海の高さ H m ＝ 地面から (H − ground) m"
  if (seaH != null && seaH > ground) {
    const rel = seaH - ground;
    const band = new THREE.Mesh(new THREE.RingGeometry(0.2, 2.2, 48), new THREE.MeshBasicNodeMaterial({ color: 0x4fb3d9, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    band.rotation.x = -Math.PI / 2;
    band.position.y = rel;
    g.add(band);
    const l = label(`海の高さ ${seaH.toFixed(1)}m ＝ 地面から ${rel.toFixed(1)}m`, 'sea');
    l.position.set(2.3, rel, 0);
    l.center.set(0, 0.5);
    g.add(l);
    details.push(l);
  }
  // current water level marker
  const lvl = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.06, 8, 32), new THREE.MeshBasicNodeMaterial({ color: 0x4fb3d9 }));
  lvl.rotation.x = Math.PI / 2;
  lvl.visible = false;
  g.add(lvl);
  const head2 = label('ここ', 'here');
  head2.position.y = H + 1.1;
  g.add(head2);
  g.position.y = ground;
  return {
    group: g,
    set(depth, text) {
      lvl.visible = depth > 0.01;
      lvl.position.y = Math.min(depth, H);
      head2.element.textContent = text;
    },
    setScale(s) { g.scale.setScalar(s); },
    /** metre ticks and storey labels only when close enough to read (they overlap from afar) */
    setDetail(on) { for (const d of details) d.visible = on; },
  };
}

export function createSeaMarker(ground, H) {
  const g = new THREE.Group();
  const blue = new THREE.MeshStandardNodeMaterial({ color: 0x1b76a8, roughness: 0.4 });
  const top = Math.max(H, 1) + 2;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, top - ground + 2, 12), blue);
  pole.position.y = (top + ground - 2) / 2;
  pole.castShadow = true;
  g.add(pole);
  // triangular flag at the assumed sea height (a different shape from the red "ここ" pole)
  const shape = new THREE.Shape();
  shape.moveTo(0, 0); shape.lineTo(3.2, -1.1); shape.lineTo(0, -2.2);
  const flag = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicNodeMaterial({ color: 0x4fb3d9, side: THREE.DoubleSide }));
  flag.position.set(0.25, H + 1.1, 0);
  g.add(flag);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.12, 0.12), new THREE.MeshBasicNodeMaterial({ color: 0xffffff }));
  bar.position.set(0, H, 0);
  g.add(bar);
  const l = label(`海の高さ ${H.toFixed(1)}m（仮定）`, 'sea');
  l.position.set(0, top + 1.2, 0);
  g.add(l);
  return { group: g, label: l };
}
