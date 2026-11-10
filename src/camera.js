// 3Dの視点の操作。設計：docs/fable52/11_水の流れ・計算・画面・3D地図の設計.md（D1）
//  ・ドラッグ（1本指）＝回す。回す・寄る中心は、選んだ地点（視点「海側の建物」だけは、その建物）
//  ・動かす（右ドラッグ・2本指・Shift+ドラッグ・矢印キー）は、地点から panR m までの水平の移動だけ
//    （地下や空へは行かない）
//  ・視点を切り替えている最中でも、触ったら利用者の操作が勝つ
//  ・カメラは地面より下へ行かない
//  ・立って見る視点は、その場で首を振る
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * @param o { camera, dom, home: Vector3 (the chosen point, a little above the ground), groundAt(x, z),
 *            panR (m), maxDistance, views: { name: () => ({ pos, target, look?, center?, panR? }) }, reduceMotion,
 *            onView(name), homeView }
 */
export function createCameraRig(o) {
  const { camera, dom, home, groundAt, views, reduceMotion } = o;
  const controls = new OrbitControls(camera, dom);
  controls.enableDamping = true;
  controls.dampingFactor = 0.2;           // was 0.05: the view kept turning for most of a second after the hand let go
  controls.screenSpacePanning = false;    // moving slides over the ground; it never climbs into the sky or digs down
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 8;
  controls.maxDistance = o.maxDistance;
  controls.zoomSpeed = 1.1;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.keys = { LEFT: '', UP: '', RIGHT: '', BOTTOM: '' }; // our own keyboard handling below

  let anim = null;      // a running move between two views
  let look = false;     // "stand and look" mode: the camera stays put and turns its head
  let viewName = null;
  // the pivot stays within `panR` m of `center`: the chosen point — or, for a view that looks at something
  // else (the building on the sea side, the whole approach from the sea), what that view names
  let center = home, panR = o.panR;
  const tmp = new THREE.Vector3(), off = new THREE.Vector3();

  // the user's hand always wins over a running view change
  // (OrbitControls fires 'start' for a drag, a touch and a wheel that really zooms — nothing else stops a move)
  const onStart = () => { anim = null; };
  controls.addEventListener('start', onStart);

  function setLook(on) {
    look = on;
    if (on) { controls.minDistance = 0.5; controls.maxDistance = 0.5; controls.enablePan = false; controls.enableZoom = false; controls.rotateSpeed = -0.35; }
    else { controls.minDistance = 8; controls.maxDistance = o.maxDistance; controls.enablePan = true; controls.enableZoom = true; controls.rotateSpeed = 1; }
    o.onLook?.(on);
  }

  function moveTo(pos, target, instant, seconds = 1.2) {
    if (instant || reduceMotion) { camera.position.copy(pos); controls.target.copy(target); controls.update(); anim = null; return; }
    anim = { t: 0, T: seconds, p0: camera.position.clone(), t0: controls.target.clone(), p1: pos.clone(), t1: target.clone() };
  }

  function setView(name, instant = false) {
    const v = views[name]?.();
    if (!v) return;
    viewName = name;
    center = v.center ?? home; panR = v.panR ?? o.panR;
    if (v.look) {
      // look mode: the target sits half a metre in front of the eyes, so a drag turns the head.
      // Into and out of it is a cut, not a flight: the distance limits of the two modes cannot be blended
      // (the first frame of a flight snapped the camera to 0.5 m — or 8 m — from the pivot)
      const dir = tmp.copy(v.target).sub(v.pos).normalize();
      setLook(true);
      moveTo(v.pos, v.pos.clone().addScaledVector(dir, 0.5), true);
    } else {
      const wasLook = look;
      setLook(false);
      moveTo(v.pos, v.target, instant || wasLook);
    }
    o.onView?.(name);
  }

  /** keep the pivot near the point and on the ground plane, and the camera above the ground */
  function clamp() {
    const t = controls.target;
    if (!look) {
      const dx = t.x - center.x, dz = t.z - center.z, d = Math.hypot(dx, dz);
      if (d > panR) {
        const k = panR / d, nx = center.x + dx * k, nz = center.z + dz * k;
        camera.position.x += nx - t.x; camera.position.z += nz - t.z;
        t.x = nx; t.z = nz;
      }
      const g = groundAt(t.x, t.z);
      const ty = THREE.MathUtils.clamp(t.y, g + 0.5, g + 30);
      if (ty !== t.y) { camera.position.y += ty - t.y; t.y = ty; }
    }
    const floor = groundAt(camera.position.x, camera.position.z) + 1.5;
    if (camera.position.y < floor) camera.position.y = floor;
  }

  function update(rdt) {
    if (anim) {
      anim.t = Math.min(1, anim.t + rdt / anim.T);
      const e = anim.t * anim.t * (3 - 2 * anim.t);
      if (anim.turn != null) {
        // around the vertical axis through the pivot (look mode: through the eyes), by the share of the angle due
        const pivot = look ? camera.position : controls.target, moved = look ? controls.target : camera.position;
        off.copy(moved).sub(pivot).applyAxisAngle(THREE.Object3D.DEFAULT_UP, -anim.turn * (e - anim.e));
        moved.copy(pivot).add(off);
        anim.e = e;
      } else {
        camera.position.lerpVectors(anim.p0, anim.p1, e);
        controls.target.lerpVectors(anim.t0, anim.t1, e);
      }
      if (anim.t >= 1) anim = null;
    }
    controls.update();
    if (!anim) clamp();
  }

  // ── buttons / keyboard ──
  /** compass: 0 = the camera looks north (−z); positive = it has turned clockwise seen from above */
  const azimuth = () => { off.copy(controls.target).sub(camera.position); return Math.atan2(off.x, -off.z); };
  /** turn the view by `rad` around the pivot (positive = the camera looks further to the right) */
  function turn(rad, animate = true) {
    if (!animate || reduceMotion) {
      const pivot = look ? camera.position : controls.target, moved = look ? controls.target : camera.position;
      off.copy(moved).sub(pivot).applyAxisAngle(THREE.Object3D.DEFAULT_UP, -rad);
      moved.copy(pivot).add(off); controls.update(); anim = null;
      return;
    }
    anim = { t: 0, T: Math.min(0.9, 0.35 + Math.abs(rad) * 0.2), turn: rad, e: 0 };
  }
  /** north up: the same distance and height, seen from the south */
  function north() { turn(-azimuth()); } // azimuth() is within ±π: the short way round
  /** bring the pivot back to the chosen point, keeping the direction and distance of the view */
  function goHome() {
    if (look || center !== home) { setView(o.homeView ?? 'pin'); return; }
    off.copy(camera.position).sub(controls.target);
    const d = THREE.MathUtils.clamp(off.length(), controls.minDistance, Math.min(controls.maxDistance, 900));
    off.setLength(d);
    moveTo(home.clone().add(off), home, false, 0.6);
  }
  /** closer (f < 1) or further (f > 1) */
  function zoom(f) {
    if (look) return;
    off.copy(camera.position).sub(controls.target);
    off.setLength(THREE.MathUtils.clamp(off.length() * f, controls.minDistance, controls.maxDistance));
    moveTo(controls.target.clone().add(off), controls.target, false, 0.3);
  }
  /** slide over the ground: fx to the right, fz forward, as a share of the viewing distance */
  function pan(fx, fz) {
    if (look) return;
    off.copy(controls.target).sub(camera.position);
    const d = off.length();
    off.y = 0; off.normalize();
    const right = tmp.set(-off.z, 0, off.x);
    const step = new THREE.Vector3().addScaledVector(right, fx * d).addScaledVector(off, fz * d);
    moveTo(camera.position.clone().add(step), controls.target.clone().add(step), false, 0.25);
  }
  const onKey = (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key;
    if (k === 'ArrowLeft') pan(-0.12, 0);
    else if (k === 'ArrowRight') pan(0.12, 0);
    else if (k === 'ArrowUp') pan(0, 0.12);
    else if (k === 'ArrowDown') pan(0, -0.12);
    else if (k === '+' || k === '=' || (k === ';' && e.shiftKey)) zoom(0.8);
    else if (k === '-' || k === '_') zoom(1.25);
    else if (k === 'q' || k === 'Q') turn(-Math.PI / 12);
    else if (k === 'e' || k === 'E') turn(Math.PI / 12);
    else if (k === 'n' || k === 'N') north();
    else if (k === '0' || k === 'Home') goHome();
    else return;
    e.preventDefault();
  };
  dom.addEventListener('keydown', onKey);
  const onDbl = () => zoom(0.5);
  dom.addEventListener('dblclick', onDbl);

  return {
    controls, setView, update, azimuth, north, goHome, zoom, pan, turn,
    get view() { return viewName; }, get moving() { return !!anim; }, get looking() { return look; },
    dispose() {
      controls.removeEventListener('start', onStart);
      dom.removeEventListener('keydown', onKey);
      dom.removeEventListener('dblclick', onDbl);
      controls.dispose();
    },
  };
}
