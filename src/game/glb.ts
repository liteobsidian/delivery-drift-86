import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/** Same shape as assets.ts LoadedModel (kept structurally identical on purpose). */
export interface GlbModel {
  /** wrapper group: metre scale, sits on y=0, nose faces local -z */
  root: THREE.Group;
  /** bounding size after normalization */
  size: THREE.Vector3;
}

export interface GlbLoadOptions {
  /** yaw applied inside the wrapper so the model nose ends at local -z */
  noseRotY: number;
  /** target length (max of x/z) in metres */
  targetLength: number;
  /** split the merged body into body + 4 spinning wheel meshes */
  splitWheels?: boolean;
  /** rename the main material so hero-body recolor/body-shell detection works */
  bodyPaint?: boolean;
}

const loader = new GLTFLoader();

/**
 * Load a GLB car model and normalize it exactly like the packed-asset loader:
 * yaw -> uniform scale -> ground at y=0. Tripo exports the whole car as one
 * merged mesh, so wheels are carved out at load time (connected components +
 * k-means on the low-slab pieces) and re-centred so they can spin in place.
 */
export async function loadGlbModel(url: string, opts: GlbLoadOptions): Promise<GlbModel> {
  const gltf = await loader.loadAsync(url);
  const inner = gltf.scene;
  inner.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const pm = m as THREE.MeshPhysicalMaterial;
      if (pm && "transmission" in pm) pm.transmission = 0;
    }
  });

  if (opts.splitWheels) splitWheels(inner, opts.bodyPaint ?? false);

  const yaw = new THREE.Group();
  yaw.rotation.y = opts.noseRotY;
  yaw.add(inner);
  const wrap = new THREE.Group();
  wrap.add(yaw);
  const box = new THREE.Box3().setFromObject(wrap);
  const size = box.getSize(new THREE.Vector3());
  wrap.scale.setScalar(opts.targetLength / Math.max(size.x, size.z));
  const box2 = new THREE.Box3().setFromObject(wrap);
  wrap.position.y -= box2.min.y;
  const size2 = box2.getSize(new THREE.Vector3());
  return { root: wrap, size: size2 };
}

/**
 * Carve 4 wheels out of a single-mesh car body. The mesh is heavily fragmented
 * (1400+ island components), so: union-find connected components -> keep
 * compact low-slab candidates -> k-means(4) on their centroids -> each cluster
 * becomes one wheel mesh with geometry re-centred on the cluster centroid.
 * Everything else stays in a "body shell" mesh. Falls back to the untouched
 * model when the layout doesn't look like 4 wheels.
 */
function splitWheels(root: THREE.Group, bodyPaint: boolean): void {
  interface GeoParts {
    position: Float32Array;
    normal: Float32Array;
    uv: Float32Array | null;
    index: Uint32Array;
  }
  const parts: GeoParts[] = [];
  const meshes: THREE.Mesh[] = [];
  root.updateWorldMatrix(true, true);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geo = mesh.geometry;
    const posAttr = geo.getAttribute("position");
    if (!posAttr) return;
    const pos = (posAttr.array as Float32Array).slice();
    const nrmAttr = geo.getAttribute("normal");
    const normal = nrmAttr ? (nrmAttr.array as Float32Array).slice() : new Float32Array(pos.length);
    const uvAttr = geo.getAttribute("uv");
    const uv = uvAttr ? (uvAttr.array as Float32Array).slice() : null;
    // bake the node's world transform so all parts share one space
    const m = mesh.matrixWorld;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.length; i += 3) {
      v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(m);
      pos[i] = v.x;
      pos[i + 1] = v.y;
      pos[i + 2] = v.z;
    }
    const index = geo.index
      ? new Uint32Array(geo.index.array)
      : new Uint32Array(Array.from({ length: pos.length / 3 }, (_, i) => i));
    parts.push({ position: pos, normal, uv, index });
    meshes.push(mesh);
  });
  if (parts.length === 0) return;
  if (parts.length > 1) {
    // multiple source meshes: merge into one soup (same atlas/material)
    let vtx = 0;
    let idx = 0;
    for (const p of parts) {
      vtx += p.position.length / 3;
      idx += p.index.length;
    }
    const position = new Float32Array(vtx * 3);
    const normal = new Float32Array(vtx * 3);
    let uv: Float32Array | null = parts.every((p) => p.uv) ? new Float32Array(vtx * 2) : null;
    const index = new Uint32Array(idx);
    let vo = 0;
    let io = 0;
    for (const p of parts) {
      position.set(p.position, vo * 3);
      normal.set(p.normal, vo * 3);
      if (uv && p.uv) uv.set(p.uv, vo * 2);
      for (let i = 0; i < p.index.length; i++) index[io + i] = p.index[i] + vo;
      vo += p.position.length / 3;
      io += p.index.length;
    }
    parts.length = 0;
    parts.push({ position, normal, uv, index });
    for (const m of meshes) m.removeFromParent();
  }

  const { position, normal, uv, index } = parts[0];
  const nv = position.length / 3;
  const nf = index.length / 3;

  // whole-model bounds
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < position.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], position[i + k]);
      max[k] = Math.max(max[k], position[i + k]);
    }
  }
  const totalH = max[1] - min[1];
  const totalL = Math.max(max[0] - min[0], max[2] - min[2]);

  // union-find over faces via shared edges
  const label = new Uint32Array(nf);
  for (let i = 0; i < nf; i++) label[i] = i;
  const find = (a: number): number => {
    while (label[a] !== a) {
      label[a] = label[label[a]];
      a = label[a];
    }
    return a;
  };
  const eKey = new Float64Array(nf * 3);
  const eFace = new Uint32Array(nf * 3);
  for (let f = 0; f < nf; f++) {
    const a = index[f * 3];
    const b = index[f * 3 + 1];
    const c = index[f * 3 + 2];
    const e = [
      [a, b],
      [b, c],
      [a, c],
    ];
    for (let k = 0; k < 3; k++) {
      const lo = Math.min(e[k][0], e[k][1]);
      const hi = Math.max(e[k][0], e[k][1]);
      eKey[f * 3 + k] = lo * nv + hi;
      eFace[f * 3 + k] = f;
    }
  }
  const order = Array.from({ length: nf * 3 }, (_, i) => i).sort(
    (x, y) => eKey[x] - eKey[y]
  );
  let s = 0;
  while (s < order.length) {
    let e = s + 1;
    while (e < order.length && eKey[order[e]] === eKey[order[s]]) e++;
    if (e - s > 1) {
      const root0 = find(eFace[order[s]]);
      for (let i = s + 1; i < e; i++) label[find(eFace[order[i]])] = root0;
    }
    s = e;
  }

  // group faces by component root
  const compMap = new Map<number, number[]>();
  for (let f = 0; f < nf; f++) {
    const r = find(f);
    let arr = compMap.get(r);
    if (!arr) {
      arr = [];
      compMap.set(r, arr);
    }
    arr.push(f);
  }

  // per-component stats
  interface Comp {
    faces: number[];
    min: [number, number, number];
    max: [number, number, number];
    cx: number;
    cy: number;
    cz: number;
  }
  const comps: Comp[] = [];
  for (const faces of compMap.values()) {
    const cmin = [Infinity, Infinity, Infinity];
    const cmax = [-Infinity, -Infinity, -Infinity];
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let cnt = 0;
    for (const f of faces) {
      for (let k = 0; k < 3; k++) {
        const vi = index[f * 3 + k];
        const x = position[vi * 3];
        const y = position[vi * 3 + 1];
        const z = position[vi * 3 + 2];
        cmin[0] = Math.min(cmin[0], x);
        cmin[1] = Math.min(cmin[1], y);
        cmin[2] = Math.min(cmin[2], z);
        cmax[0] = Math.max(cmax[0], x);
        cmax[1] = Math.max(cmax[1], y);
        cmax[2] = Math.max(cmax[2], z);
        sx += x;
        sy += y;
        sz += z;
        cnt++;
      }
    }
    comps.push({
      faces,
      min: cmin as [number, number, number],
      max: cmax as [number, number, number],
      cx: sx / cnt,
      cy: sy / cnt,
      cz: sz / cnt,
    });
  }

  // wheel candidates: compact pieces sitting in the lower slab
  const cand = comps.filter((c) => {
    const sx = c.max[0] - c.min[0];
    const sy = c.max[1] - c.min[1];
    const sz = c.max[2] - c.min[2];
    return (
      sy / Math.max(sx, 1e-6) > 0.5 &&
      sy / Math.max(sx, 1e-6) < 2.0 &&
      sz / totalL < 0.25 &&
      sy / totalH < 0.6 &&
      c.min[1] < min[1] + totalH * 0.25 &&
      c.faces.length > 20
    );
  });
  if (cand.length < 8) return; // not the fragmented layout we expect

  // k-means(4) on candidate centroids (x/z), weighted by face count
  let cxAll = 0;
  let czAll = 0;
  let wAll = 0;
  for (const c of cand) {
    cxAll += c.cx * c.faces.length;
    czAll += c.cz * c.faces.length;
    wAll += c.faces.length;
  }
  cxAll /= wAll;
  czAll /= wAll;
  const centers: [number, number][] = [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ].map(([qx, qz]) => {
    let sx = 0;
    let sz = 0;
    let sw = 0;
    for (const c of cand) {
      if ((c.cx < cxAll ? -1 : 1) === qx && (c.cz < czAll ? -1 : 1) === qz) {
        sx += c.cx * c.faces.length;
        sz += c.cz * c.faces.length;
        sw += c.faces.length;
      }
    }
    return sw > 0 ? [sx / sw, sz / sw] : [qx * 0.3 * totalL + cxAll, qz * 0.3 * totalL + czAll];
  });
  const assign = new Uint8Array(cand.length);
  for (let iter = 0; iter < 15; iter++) {
    for (let i = 0; i < cand.length; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let k = 0; k < 4; k++) {
        const dx = cand[i].cx - centers[k][0];
        const dz = cand[i].cz - centers[k][1];
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
      assign[i] = best;
    }
    const nsx = [0, 0, 0, 0];
    const nsz = [0, 0, 0, 0];
    const nsw = [0, 0, 0, 0];
    for (let i = 0; i < cand.length; i++) {
      nsx[assign[i]] += cand[i].cx * cand[i].faces.length;
      nsz[assign[i]] += cand[i].cz * cand[i].faces.length;
      nsw[assign[i]] += cand[i].faces.length;
    }
    for (let k = 0; k < 4; k++) {
      if (nsw[k] > 0) centers[k] = [nsx[k] / nsw[k], nsz[k] / nsw[k]];
    }
  }
  // reject degenerate clusters (two wheels merged or a phantom)
  const clusterW = [0, 0, 0, 0];
  for (let i = 0; i < cand.length; i++) clusterW[assign[i]] += cand[i].faces.length;
  if (clusterW.some((w) => w === 0)) return;

  const wheelFaces: number[][] = [[], [], [], []];
  for (let i = 0; i < cand.length; i++) wheelFaces[assign[i]].push(...cand[i].faces);
  const wheelSet = new Set<number>();
  for (const fs of wheelFaces) for (const f of fs) wheelSet.add(f);

  const srcMesh = meshes[0];
  const material = Array.isArray(srcMesh.material) ? srcMesh.material[0] : srcMesh.material;

  const buildSubGeometry = (faces: number[], recenter: [number, number, number] | null) => {
    const used = new Map<number, number>();
    const idx = new Uint32Array(faces.length * 3);
    for (let i = 0; i < faces.length; i++) {
      for (let k = 0; k < 3; k++) {
        const vi = index[faces[i] * 3 + k];
        let ni = used.get(vi);
        if (ni === undefined) {
          ni = used.size;
          used.set(vi, ni);
        }
        idx[i * 3 + k] = ni;
      }
    }
    const pos = new Float32Array(used.size * 3);
    const nrm = new Float32Array(used.size * 3);
    const uvOut = uv ? new Float32Array(used.size * 2) : null;
    const ox = recenter ? recenter[0] : 0;
    const oy = recenter ? recenter[1] : 0;
    const oz = recenter ? recenter[2] : 0;
    for (const [vi, ni] of used) {
      pos[ni * 3] = position[vi * 3] - ox;
      pos[ni * 3 + 1] = position[vi * 3 + 1] - oy;
      pos[ni * 3 + 2] = position[vi * 3 + 2] - oz;
      nrm[ni * 3] = normal[vi * 3];
      nrm[ni * 3 + 1] = normal[vi * 3 + 1];
      nrm[ni * 3 + 2] = normal[vi * 3 + 2];
      if (uvOut && uv) {
        uvOut[ni * 2] = uv[vi * 2];
        uvOut[ni * 2 + 1] = uv[vi * 2 + 1];
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    if (uvOut) geo.setAttribute("uv", new THREE.BufferAttribute(uvOut, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    return geo;
  };

  // replace the original mesh with body + 4 wheels
  const parent = srcMesh.parent ?? root;
  const worldPos = new THREE.Vector3();
  const worldQuat = new THREE.Quaternion();
  srcMesh.getWorldPosition(worldPos);
  srcMesh.getWorldQuaternion(worldQuat);
  srcMesh.removeFromParent();

  const bodyFaces: number[] = [];
  for (let f = 0; f < nf; f++) if (!wheelSet.has(f)) bodyFaces.push(f);
  const bodyMesh = new THREE.Mesh(buildSubGeometry(bodyFaces, null), material);
  if (bodyPaint) {
    material.name = "body paint";
    bodyMesh.name = "body shell";
  }
  const holder = new THREE.Group();
  holder.position.copy(worldPos);
  holder.quaternion.copy(worldQuat);
  holder.add(bodyMesh);
  parent.add(holder);

  for (let k = 0; k < 4; k++) {
    const faces = wheelFaces[k];
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let cnt = 0;
    for (const f of faces) {
      for (let i = 0; i < 3; i++) {
        const vi = index[f * 3 + i];
        sx += position[vi * 3];
        sy += position[vi * 3 + 1];
        sz += position[vi * 3 + 2];
        cnt++;
      }
    }
    const center: [number, number, number] = [sx / cnt, sy / cnt, sz / cnt];
    const geo = buildSubGeometry(faces, center);
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = `wheel hub ${k}`;
    const node = new THREE.Group();
    node.position.set(center[0], center[1], center[2]);
    node.add(mesh);
    parent.add(node);
  }
}
