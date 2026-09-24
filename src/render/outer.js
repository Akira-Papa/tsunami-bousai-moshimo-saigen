// ─────────────────────────────────────────────────────────────
//  Wide (outer) square of a nested run: coarse terrain with the aerial photo and the SIMULATED
//  water of the wide solver, drawn around the detailed square so the whole approach of the
//  tsunami — sea → port → rivers/canals → the chosen point — can be watched.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three/webgpu';
import {
  wgslFn, uniform, texture, sampler, varying, vec3, float, storage, vertexIndex, positionLocal, positionWorld,
  cameraPosition, uv, mix, smoothstep, abs, select, clamp,
} from 'three/tsl';
import { WATER_FN } from './shaders.js';

export function createOuterLayer({ region, solver, offset, innerL, uL, uEnvInner, lib }) {
  const { N, L, dx } = region;
  const group = new THREE.Group();
  group.position.set(offset.x, 0, offset.z); // outer centre in the inner (world) frame
  const off3 = uniform(new THREE.Vector3(offset.x, 0, offset.z));
  const innerHalf = innerL / 2 - 1; // the detailed square owns everything inside this

  const photoTex = new THREE.CanvasTexture(region.photo.canvas);
  photoTex.flipY = false; photoTex.colorSpace = THREE.SRGBColorSpace; photoTex.anisotropy = 8;
  const bedArr = new Uint16Array(N * N * 4);
  for (let k = 0; k < N * N; k++) {
    bedArr[k * 4] = THREE.DataUtils.toHalfFloat(region.bed[k]);
    bedArr[k * 4 + 1] = THREE.DataUtils.toHalfFloat(0);
    bedArr[k * 4 + 2] = THREE.DataUtils.toHalfFloat(region.water[k] ? 1 : 0);
    bedArr[k * 4 + 3] = THREE.DataUtils.toHalfFloat(-1000); // always sunlit (no building walls out here)
  }
  const bedTex = new THREE.DataTexture(bedArr, N, N, THREE.RGBAFormat, THREE.HalfFloatType);
  bedTex.minFilter = bedTex.magFilter = THREE.LinearFilter;
  bedTex.needsUpdate = true;
  // caustics are off out here, but w_water still needs a filterable texture+sampler pair
  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255]), 2, 2);
  white.minFilter = white.magFilter = THREE.LinearFilter;
  white.needsUpdate = true;
  const uEnv = uniform(new THREE.Vector4(L, 0, 0, 0)); // D, time, caustics off, depth mode

  // inside the detailed square? (world coordinates)
  const inner = abs(positionWorld.x).lessThan(innerHalf).and(abs(positionWorld.z).lessThan(innerHalf));

  // ── terrain ──
  {
    const geo = new THREE.PlaneGeometry(L - dx, L - dx, N - 1, N - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, uvA = geo.attributes.uv;
    for (let k = 0; k < N * N; k++) {
      const wx = pos.getX(k) + offset.x, wz = pos.getZ(k) + offset.z;
      const hidden = Math.abs(wx) < innerHalf - dx && Math.abs(wz) < innerHalf - dx;
      pos.setY(k, hidden ? region.bed[k] - 30 : region.bed[k] - 0.3);
      uvA.setXY(k, (pos.getX(k) + L / 2) / L, (pos.getZ(k) + L / 2) / L);
    }
    geo.computeVertexNormals();
    const env = texture(solver.envTex, uv());
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.95 });
    const c = texture(photoTex, uv()).rgb;
    mat.colorNode = mix(c, c.mul(vec3(0.55, 0.52, 0.47)), env.x.mul(0.85));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ── simulated water of the wide square ──
  {
    const geo = new THREE.PlaneGeometry(L - dx, L - dx, N - 1, N - 1);
    geo.rotateX(-Math.PI / 2);
    const r = storage(solver.buffers.R.value, 'vec4', N * N).toReadOnly().element(vertexIndex);
    const r2 = storage(solver.buffers.R2.value, 'vec4', N * N).toReadOnly().element(vertexIndex);
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: true, side: THREE.DoubleSide });
    mat.positionNode = vec3(positionLocal.x, r.x.sub(0.05), positionLocal.z);
    const wFn = wgslFn(WATER_FN, [lib]);
    const pt = texture(photoTex), ct = texture(white), bt = texture(bedTex);
    const out = wFn({
      p: positionWorld.sub(off3), eye: cameraPosition.sub(off3), L: uL,
      nIn: varying(r.yz, 'vOWN'), h: varying(r.w, 'vOWH'), turb: varying(r2.y, 'vOWC'), foamIn: varying(r2.x, 'vOWF'), flow: varying(r2.zw, 'vOWU'),
      env: uEnv, pt, ps: sampler(pt), ct, cs: sampler(ct), bt, bs: sampler(bt),
    });
    mat.colorNode = out.xyz;
    mat.opacityNode = select(inner, float(0), out.w);
    mat.alphaTestNode = float(0.02);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    group.add(mesh);
  }

  // dashed frame of the wide square
  {
    const h = L / 2;
    const pts = [[-h, -h], [h, -h], [h, h], [-h, h], [-h, -h]].map(([x, z]) => new THREE.Vector3(x, 8, z));
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(g, new THREE.LineDashedNodeMaterial({ color: 0x9fd8ee, dashSize: 60, gapSize: 40, transparent: true, opacity: 0.5 }));
    line.computeLineDistances();
    group.add(line);
  }

  return {
    group,
    update() { uEnv.value.y = uEnvInner.value.y; uEnv.value.w = uEnvInner.value.w; },
    dispose() {
      group.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
      photoTex.dispose(); bedTex.dispose(); white.dispose();
    },
  };
}
