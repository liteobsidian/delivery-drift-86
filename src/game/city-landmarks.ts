import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { CityLandmark } from "./map-layouts";
import { cityBuildingMeshYaw } from "./city-building-layout";

const IVORY = 0xf3e6c9;
const STONE = 0xa89e8b;
const BRASS = 0xf6bf54;
const GLASS = 0x294453;
const TEAL = 0x2788a6;
const GREEN = 0x4e6251;
type XYZ = [number, number, number];

/** Static parts share one vertex-colour mesh per landmark. */
class Sculpture {
  private parts: THREE.BufferGeometry[] = [];

  part(source: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0): void {
    const geometry = source.index ? source.toNonIndexed() : source;
    if (geometry !== source) source.dispose();
    geometry.translate(x, y, z);
    geometry.deleteAttribute("uv");
    const count = geometry.attributes.position.count;
    const data = new Float32Array(count * 3);
    const c = new THREE.Color(color);
    for (let i = 0; i < data.length; i += 3) {
      data[i] = c.r;
      data[i + 1] = c.g;
      data[i + 2] = c.b;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(data, 3));
    this.parts.push(geometry);
  }

  box(x: number, y: number, z: number, w: number, h: number, d: number, color: number): void {
    this.part(new THREE.BoxGeometry(w, h, d), color, x, y, z);
  }

  cylinder(x: number, y: number, z: number, top: number, bottom: number, h: number, color: number, sides = 10): void {
    this.part(new THREE.CylinderGeometry(top, bottom, h, sides), color, x, y, z);
  }

  lathe(x: number, base: number, z: number, profile: [number, number][], color: number): void {
    this.part(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 16), color, x, base, z);
  }

  rail(a: XYZ, b: XYZ, thickness: number, color: number): void {
    const start = new THREE.Vector3(...a);
    const end = new THREE.Vector3(...b);
    const axis = end.clone().sub(start);
    const geometry = new THREE.BoxGeometry(thickness, axis.length(), thickness);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize()));
    const center = start.add(end).multiplyScalar(0.5);
    this.part(geometry, color, center.x, center.y, center.z);
  }

  geometry(): THREE.BufferGeometry {
    const result = mergeGeometries(this.parts);
    for (const piece of this.parts) piece.dispose();
    return result;
  }
}

function classicalFront(b: Sculpture, width: number, depth: number, wall: number, height: number): void {
  b.box(0, 0.38, 0, width, 0.76, depth, STONE);
  b.box(0, height / 2 + 0.5, 0, width * 0.95, height - 1, depth * 0.90, wall);
  b.box(0, height - 0.6, 0, width, 0.66, depth * 0.98, IVORY);
  b.box(0, height, 0, width * 0.95, 0.7, depth * 0.91, GREEN);
  for (const side of [-1, 1]) {
    const z = side * depth * 0.454;
    for (let i = -3; i <= 3; i++) {
      const x = i * width / 7.65;
      for (const y of [height * 0.32, height * 0.69]) {
        b.box(x, y, z, width * 0.083, height * 0.23, 0.32, IVORY);
        b.box(x, y, z + side * 0.22, width * 0.068, height * 0.19, 0.18, GLASS);
      }
      b.box(x - width * 0.06, height * 0.53, z, width * 0.021, height * 0.83, 0.65, IVORY);
    }
    b.box(0, height * 0.55, z, width, 0.25, 0.58, IVORY);
    b.box(0, 1.5, z + side * 0.2, width * 0.092, 2.25, 0.25, 0x4a5b52);
  }
}

function admiralty(b: Sculpture, w: number, d: number): void {
  classicalFront(b, w, d, 0xdcb779, 9.1);
  b.box(0, 10.3, 0, w * 0.38, 2.7, d * 0.78, IVORY);
  b.box(0, 15, 0, 9, 7, 8.4, 0xe2c395);
  for (const z of [-4.4, 4.4]) for (const x of [-3.7, -1.25, 1.25, 3.7]) {
    b.cylinder(x, 15, z, 0.28, 0.38, 6.5, IVORY, 8);
  }
  b.box(0, 18.8, 0, 10.1, 1.1, 9.6, IVORY);
  b.box(0, 21.15, 0, 6.4, 3.6, 6.8, 0xf0dcae);
  b.cylinder(0, 24.5, 0, 1.45, 4.1, 3.1, GREEN, 4);
  b.cylinder(0, 33.8, 0, 0.1, 1.4, 17, BRASS, 6);
  b.cylinder(0, 44.4, 0, 0.03, 0.07, 4.4, BRASS, 6);
  b.cylinder(0, 42.4, 0, 0.36, 0.36, 0.58, BRASS, 8);
}

function palace(b: Sculpture, w: number, d: number): void {
  classicalFront(b, w, d, 0x75a38a, 10.3);
  b.box(0, 10.75, 0, w * 0.44, 0.95, d * 0.63, 0x84aba0);
  for (const x of [-w * 0.41, -w * 0.17, w * 0.17, w * 0.41]) for (const z of [-d * 0.35, d * 0.35]) {
    b.cylinder(x, 11, z, 0.24, 0.38, 1.25, IVORY, 6);
    b.cylinder(x, 11.72, z, 0.08, 0.32, 0.34, BRASS, 6);
  }
  for (const z of [-d * 0.46, d * 0.46]) {
    for (const x of [-4.2, -2.4, 2.4, 4.2]) b.cylinder(x, 3.95, z, 0.45, 0.54, 6.9, IVORY, 8);
    b.box(0, 7.45, z, 10.5, 0.7, 1, IVORY);
  }
}

function kremlin(b: Sculpture, w: number, d: number): void {
  const wall = 0xe3d8bf;
  b.box(0, 0.6, 0, w, 1.2, d, STONE);
  b.box(0, 2.7, 0, w * 0.88, 3, d * 0.80, wall);
  for (const z of [-d * 0.37, d * 0.37]) {
    for (let x = -w * 0.39; x <= w * 0.4; x += 2.3) b.box(x, 4.85, z, 1.25, 1.5, 1.35, wall);
    for (const x of [-w * 0.40, w * 0.40]) {
      b.cylinder(x, 3.9, z, 2.65, 2.85, 7.8, wall);
      b.cylinder(x, 8.75, z, 0, 2.85, 2.4, GREEN);
    }
    b.box(0, 1.9, z + Math.sign(z) * 0.75, 3.3, 3.25, 0.22, GLASS);
  }
  let base = 1;
  for (let level = 0; level < 6; level++) {
    const width = 10.5 - level * 1.42;
    const height = level > 2 ? 3.3 : 4.7;
    const x = -1.8 + level * 0.22;
    const brick = level % 2 ? 0xa0513b : 0xb66148;
    b.box(x, base + height / 2, -1, width, height, width * 0.79, brick);
    b.box(x, base + height - 0.12, -1, width + 0.48, 0.42, width * 0.79 + 0.48, 0xd58d68);
    b.box(x, base + height * 0.55, -1 + width * 0.401, width * 0.2, height * 0.48, 0.16, GLASS);
    base += height;
  }
  b.cylinder(-0.7, base + 3.45, -1, 0.11, 2.28, 7, GREEN, 8);
  b.cylinder(-0.7, base + 7.65, -1, 0.14, 0.32, 1.4, BRASS, 8);
}

function mosque(b: Sculpture, w: number, d: number): void {
  b.box(0, 0.6, 0, w * 0.94, 1.2, d * 0.94, STONE);
  b.box(0, 4.1, 0, w * 0.66, 6.4, d * 0.75, IVORY);
  b.cylinder(0, 8, 0, 6.7, 7.5, 2.1, IVORY, 8);
  b.lathe(0, 9.05, 0, [[6.5, 0], [6.7, 1.75], [5.95, 3.65], [4.45, 5.35], [2.8, 6.95], [1.2, 8.9], [0, 10.4]], TEAL);
  b.cylinder(0, 20.4, 0, 0.07, 0.16, 2.55, BRASS);
  for (const side of [-1, 1]) {
    b.box(0, 3.1, side * d * 0.378, 4.5, 5.1, 0.19, GLASS);
    for (const x of [-6.7, 6.7]) {
      b.box(x, 4.4, side * d * 0.38, 1.6, 3.6, 0.2, 0x487a86);
    }
    for (const s of [-1, 1]) {
      const x = side * w * 0.4;
      const z = s * d * 0.41;
      b.cylinder(x, 9.9, z, 0.91, 1.34, 19.8, IVORY, 8);
      b.cylinder(x, 20.1, z, 1.27, 1.18, 0.65, 0xb6c1b5, 8);
      b.cylinder(x, 22.2, z, 0.58, 0.68, 3.55, IVORY, 8);
      b.cylinder(x, 26.45, z, 0.06, 1.06, 5.1, TEAL, 8);
      b.cylinder(x, 29.42, z, 0.045, 0.09, 0.85, BRASS, 6);
    }
  }
}

function cauldron(b: Sculpture, width: number): void {
  b.cylinder(0, 0.6, 0, width * 0.45, width * 0.49, 1.2, STONE, 14);
  b.cylinder(0, 3.3, 0, width * 0.29, width * 0.37, 4.3, 0xa78d6c, 12);
  b.lathe(0, 5.45, 0, [[width * 0.28, 0], [width * 0.38, 1.3], [width * 0.47, 3.9],
    [width * 0.49, 7.4], [width * 0.5, 7.8], [0, 7.8]], 0xba9264);
  b.cylinder(0, 12.9, 0, width * 0.49, width * 0.485, 0.45, 0x665649, 18);
}

function stadium(b: Sculpture, w: number, d: number): void {
  const elliptic = (top: number, bottom: number, height: number, y: number, color: number, open = false) => {
    const geo = new THREE.CylinderGeometry(top, bottom, height, 28, 1, open);
    geo.scale(1, 1, d / w);
    b.part(geo, color, 0, y, 0);
  };
  elliptic(w * 0.49, w * 0.49, 1.2, 0.6, 0xbcb9a9);
  elliptic(w * 0.47, w * 0.43, 4.3, 3.25, 0x475b63, true);
  elliptic(w * 0.39, w * 0.39, 1.25, 2.1, 0x7d8c92);
  b.box(0, 2.78, 0, w * 0.49, 0.19, d * 0.43, 0x658a50);
  b.box(0, 2.89, 0, 0.13, 0.04, d * 0.41, IVORY);
  for (const x of [-w * 0.23, w * 0.23]) b.box(x, 2.9, 0, 0.14, 0.05, d * 0.4, IVORY);

  // Two curved canopies frame a clear view of the pitch.
  for (const side of [-1, 1]) {
    const positions: number[] = [];
    const point = (i: number, inner: boolean): XYZ => {
      const angle = Math.PI * i / 18;
      const end = Math.sin(angle);
      return [w * 0.47 * Math.cos(angle), 5.8 + end * (inner ? 7.3 : 5), side * (inner ? 0.22 : 0.49) * d * end];
    };
    for (let i = 0; i < 18; i++) {
      const a = point(i, false);
      const c = point(i + 1, true);
      const quad = [a, point(i + 1, false), c, a, c, point(i, true)];
      for (const p of side === 1 ? quad : quad.reverse()) positions.push(...p);
    }
    const roof = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    roof.computeVertexNormals();
    b.part(roof, 0xf3f0dc);
    for (const i of [3, 6, 9, 12, 15]) {
      const [x, y, z] = point(i, false);
      b.rail([x * 0.94, 1.2, z * 0.93], [x, y, z], 0.55, 0xc3d2cf);
      b.rail(point(i - 1, true), point(i + 1, true), 0.25, 0x91b9c4);
    }
  }
}

function marina(b: Sculpture, w: number, d: number): void {
  classicalFront(b, w, d, 0xe7d2a8, 6.9);
  b.box(0, 8.8, 0, w * 0.32, 3.4, d * 0.61, IVORY);
  for (const x of [-2.3, 0, 2.3]) for (const z of [-d * 0.32, d * 0.32]) {
    b.cylinder(x, 8.7, z, 0.29, 0.4, 3.5, IVORY, 8);
    b.box(x, 8.7, z * 0.98, 0.95, 2.2, 0.14, GLASS);
  }
  b.box(0, 10.9, 0, w * 0.36, 0.7, d * 0.67, 0xc29c70);
  b.cylinder(0, 13.2, 0, 1.1, 2.45, 3.9, IVORY, 8);
  b.cylinder(0, 20.1, 0, 0.1, 1.1, 10.2, 0xb29266, 6);
  b.cylinder(0, 25.3, 0, 0.24, 0.24, 0.65, BRASS, 6);
}

export const PALM_BASE_RADIUS = 0.72;

export function palmOffsets(width: number): number[] {
  return [-1.5, -0.5, 0.5, 1.5].map((position) => position * width * 0.21);
}

function palms(b: Sculpture, width: number): void {
  for (const [index, x] of palmOffsets(width).entries()) {
    const h = 5.4 + (index % 3) * 0.9;
    b.cylinder(x, h / 2, 0, 0.18, 0.27, h, 0x82614e, 6);
    b.cylinder(x, 0.22, 0, 0.52, PALM_BASE_RADIUS, 0.44, STONE, 8);
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * Math.PI * 2 + index;
      const length = 1.8 + (i % 3) * 0.24;
      const cx = Math.cos(a);
      const cz = Math.sin(a);
      const midX = x + cx * length * 0.54;
      const midZ = cz * length * 0.54;
      const spread = 0.48;
      const positions = [
        x, h, 0, midX - cz * spread, h + 0.32, midZ + cx * spread,
        x + cx * length, h - 0.64, cz * length,
        x, h, 0, x + cx * length, h - 0.64, cz * length, midX + cz * spread, h + 0.32, midZ - cx * spread,
      ];
      const frond = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      frond.computeVertexNormals();
      b.part(frond, i % 2 ? 0x678945 : 0x3f6b4a);
    }
  }
}

function bridge(b: Sculpture, w: number, d: number): void {
  b.box(0, -0.27, 0, w, 0.64, d, 0x474952);
  for (const side of [-1, 1]) {
    const x = side * (w / 2 - 0.26);
    b.box(x, 0.5, 0, 0.56, 0.9, d, 0x718581);
    b.box(x, 1.28, 0, 0.21, 0.16, d, 0xa0a18c);
    for (let z = -d / 2 + 3; z < d / 2 - 2; z += 5.2) {
      b.box(x, 0.99, z, 0.25, 0.63, 0.25, 0xa0a18c);
    }
    for (const z of [-d * 0.35, d * 0.35]) {
      b.box(x, 1.18, z, 0.69, 2.34, 0.74, STONE);
      b.cylinder(x, 3.35, z, 0.12, 0.18, 2.6, 0x3c504d, 6);
      b.box(x, 4.67, z, 0.45, 0.55, 0.45, 0xffe4ab);
    }
  }
}

function torii(b: Sculpture): void {
  const lacquer = 0xc9513c;
  b.box(0, 0.36, 0, 11, 0.72, 11.2, STONE);
  for (const x of [-3.2, 3.2]) {
    b.cylinder(x, 3.67, 0, 0.52, 0.63, 6.7, lacquer, 10);
    b.cylinder(x, 1.07, 0, 0.65, 0.76, 1.25, 0x2c4245, 10);
  }
  b.box(0, 5.25, 0, 8.7, 0.57, 0.69, lacquer);
  b.box(0, 7.16, 0, 9.45, 0.56, 0.86, lacquer);
  b.rail([-5.15, 7.95, 0], [-2.76, 7.4, 0], 0.52, 0x262d3d);
  b.rail([-2.76, 7.4, 0], [2.76, 7.4, 0], 0.55, 0x262d3d);
  b.rail([2.76, 7.4, 0], [5.15, 7.95, 0], 0.52, 0x262d3d);
  b.box(0, 6.23, 0.41, 1.3, 1.52, 0.34, BRASS);
}

function radioTower(b: Sculpture): void {
  const red = 0xdf563e;
  const stages = [[0.5, 8.15], [8.5, 5.8], [17.3, 3.7], [26.4, 2.2], [34, 1.25]] as const;
  b.box(0, 0.48, 0, 19.7, 0.96, 19.7, STONE);
  for (let s = 1; s < stages.length; s++) {
    const [loY, lo] = stages[s - 1];
    const [hiY, hi] = stages[s];
    const color = s % 2 ? red : IVORY;
    const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let i = 0; i < 4; i++) {
      const [x, z] = corners[i];
      const [nextX, nextZ] = corners[(i + 1) % 4];
      b.rail([x * lo, loY, z * lo], [x * hi, hiY, z * hi], 0.67, color);
      b.rail([x * lo, loY, z * lo], [nextX * hi, hiY, nextZ * hi], 0.27, color);
      b.rail([nextX * lo, loY, nextZ * lo], [x * hi, hiY, z * hi], 0.24, color);
      b.rail([x * hi, hiY, z * hi], [nextX * hi, hiY, nextZ * hi], 0.48, color);
    }
  }
  for (const [y, size] of [[18.3, 9.8], [34.6, 4.6]]) {
    b.box(0, y, 0, size, 1.36, size, IVORY);
    b.box(0, y + 0.72, 0, size * 0.94, 0.64, size * 0.94, GLASS);
    b.box(0, y + 1.15, 0, size * 0.98, 0.19, size * 0.98, red);
  }
  b.cylinder(0, 40.6, 0, 0.35, 0.8, 9.6, red, 7);
  b.cylinder(0, 46.7, 0, 0.075, 0.19, 4.45, IVORY, 7);
}

function portTower(b: Sculpture): void {
  const steel = 0x985b49;
  b.cylinder(0, 0.55, 0, 5.55, 5.7, 1.1, STONE, 12);
  b.cylinder(0, 12.9, 0, 0.95, 1.45, 24.6, 0xcfcac0, 8);
  for (const x of [-3, 3]) for (const z of [-3, 3]) {
    b.rail([x, 0.7, z], [x * 0.43, 24.4, z * 0.43], 0.47, steel);
    b.rail([-x, 0.7, z], [x * 0.43, 24.4, z * 0.43], 0.21, steel);
  }
  b.cylinder(0, 25.2, 0, 3.88, 2.9, 1.7, 0xe3b998, 14);
  b.cylinder(0, 26.65, 0, 3.82, 3.82, 1.28, GLASS, 14);
  b.cylinder(0, 27.65, 0, 3.62, 4.04, 0.75, IVORY, 14);
  b.cylinder(0, 30.45, 0, 0.06, 0.36, 5.1, steel, 8);
  b.cylinder(0, 33.1, 0, 0.16, 0.22, 0.4, BRASS, 8);
}

export function buildCityLandmarks(sites: readonly CityLandmark[]): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8 });
  for (const site of sites) {
    const b = new Sculpture();
    const { width: w, depth: d } = site;
    switch (site.kind) {
      case "palace": palace(b, w, d); break;
      case "spire": admiralty(b, w, d); break;
      case "kremlin": kremlin(b, w, d); break;
      case "mosque": mosque(b, w, d); break;
      case "cauldron": cauldron(b, w); break;
      case "stadium": stadium(b, w, d); break;
      case "marina": marina(b, w, d); break;
      case "palm-row": palms(b, w); break;
      case "bridge": bridge(b, w, d); break;
      case "torii": torii(b); break;
      case "radio-tower": radioTower(b); break;
      case "port-tower": portTower(b); break;
    }
    const mesh = new THREE.Mesh(b.geometry(), material);
    mesh.name = site.id;
    mesh.position.set(site.x, 0, site.z);
    mesh.rotation.y = cityBuildingMeshYaw(site.rotation);
    group.add(mesh);
  }
  return group;
}
