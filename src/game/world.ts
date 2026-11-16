import * as THREE from "three";
import {
  CELL,
  ROAD_W,
  GRID_N,
  WORLD_HALF,
  LIGHT_CYCLE,
  LIGHT_YELLOW,
} from "./config";
import type { MapId } from "./types";
import { cityLayoutFor, distanceToRoad, distanceToRoadPath, isOnLayoutRoad, worldLengthToTexturePixels, worldToTextureCoordinate } from "./map-layouts";

/** Central drift ring (radius) at map center. */
export const RING_R = 44;
/** Cloverleaf-style arcs: quarter circles tangent to the ring, one per
 *  central block, merging the grid roads into the ring with long sweepers. */
export const ARC_R = 38;
export interface DriftArc {
  cx: number;
  cz: number;
  a0: number;
  a1: number;
}
export const DRIFT_ARCS: DriftArc[] = [
  { cx: CELL, cz: CELL, a0: Math.PI, a1: Math.PI * 1.5 }, // NE (58,58)
  { cx: -CELL, cz: CELL, a0: -Math.PI / 2, a1: 0 }, // NW (-58,58)
  { cx: CELL, cz: -CELL, a0: Math.PI / 2, a1: Math.PI }, // SE (58,-58)
  { cx: -CELL, cz: -CELL, a0: 0, a1: Math.PI / 2 }, // SW (-58,-58)
];

/** Deterministic PRNG so the city is identical every session. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface AABB {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface Puddle {
  x: number;
  z: number;
  r: number;
}

export interface Cobble {
  x: number;
  z: number;
  w: number;
  h: number;
}

export interface Ramp {
  x: number;
  z: number;
  w: number;
  h: number;
  angle: number;
  /** world-space direction of travel that goes UP the slope (launch direction) */
  dx: number;
  dz: number;
}

export interface LightVisual {
  cx: number; // intersection center
  cz: number;
  state: number; // 0: x-axis green, 1: x-axis red
  timer: number;
  phaseId: number;
  /** glowing stop-line strips on the road, [+x, -x, +z, -z]; x entries follow
   * the x-road lamp state, z entries the z-road state */
  strips: THREE.MeshBasicMaterial[];
  /** per-head lamp materials, index 0 = red, 1 = yellow, 2 = green */
  lampsX: THREE.MeshStandardMaterial[];
  lampsZ: THREE.MeshStandardMaterial[];
}

const GS = WORLD_HALF * 2 + ROAD_W * 2 + 60; // ground plane size

export class World {
  readonly mapId: MapId;
  readonly layout;
  readonly group = new THREE.Group();
  readonly buildings: AABB[] = [];
  readonly puddles: Puddle[] = [];
  readonly cobbles: Cobble[] = [];
  readonly ramps: Ramp[] = [];
  readonly lights: LightVisual[] = [];
  readonly lightGrid = new Map<string, LightVisual>(); // "i,j" -> light (enforced only)

  private puddleMeshes: THREE.Mesh[] = [];
  private heroSpots: { x: number; z: number; w: number; h: number; d: number }[] =
    [];
  /** AABBs reserved for real mid-rise models — no neon/signs placed there */
  private heroAABBs: AABB[] = [];
  /** tall buildings that get rooftop billboards */
  private roofSpots: { x: number; z: number; w: number; h: number; d: number }[] =
    [];
  private billboardTex: THREE.Texture[] = [];
  private flickerMats: THREE.MeshBasicMaterial[] = [];
  private chevronMats: THREE.Matrix4[] = [];
  /** building heights aligned with this.buildings (AABBs carry no height) */
  private buildingHeights: number[] = [];
  private flickerT = 0;
  private marker = new THREE.Group();
  private markerRing!: THREE.Mesh;
  private time = 0;

  constructor(mapId: MapId = "tokyo") {
    this.mapId = mapId;
    this.layout = cityLayoutFor(mapId);
    this.group.name = `world-${mapId}`;
    this.group.add(this.buildSky());
    this.group.add(this.buildGround());
    if (mapId === "yokohama") this.group.add(this.buildHarborWater());
    this.group.add(this.buildBuildings());
    this.group.add(this.buildStreetProps());
    if (mapId === "tokyo") {
      this.group.add(this.buildBladeSigns());
      this.group.add(this.buildNeonColumns());
      this.group.add(this.buildBillboards());
      this.group.add(this.buildNeonStrips());
    } else {
      this.group.add(this.buildPortCranes());
    }
    if (mapId === "tokyo") this.group.add(this.buildRoadSigns());
    this.group.add(this.buildPuddles());
    this.group.add(this.buildRamps());
    this.group.add(this.buildLights());
    this.buildMarker();
    this.group.add(this.marker);
  }

  // ---------- queries ----------

  roadCoord(i: number): number {
    return -WORLD_HALF + i * CELL;
  }

  /** true when the point is over a road surface (not inside a block) */
  isOnRoad(x: number, z: number): boolean {
    return isOnLayoutRoad(this.layout, x, z);
  }

  nearestRoadDist(x: number, z: number): number {
    return Math.max(0, Math.min(...this.layout.roads.map((road) => distanceToRoadPath(road, x, z) - road.width / 2)));
  }

  /** distance to the drift ring + cloverleaf arcs (the central plaza). */
  private driftRoadDist(x: number, z: number): number {
    let d = Math.abs(Math.hypot(x, z) - RING_R);
    for (const a of DRIFT_ARCS) {
      const dd = this.arcDist(x, z, a);
      if (dd < d) d = dd;
    }
    return d;
  }

  /** distance to one arc segment; points outside the angle window measure
   *  to the nearest endpoint, so spurs don't read as road. */
  private arcDist(x: number, z: number, a: DriftArc): number {
    const dx = x - a.cx;
    const dz = z - a.cz;
    const ang = Math.atan2(dz, dx);
    if (ang >= a.a0 && ang <= a.a1) {
      return Math.abs(Math.hypot(dx, dz) - ARC_R);
    }
    const x0 = a.cx + ARC_R * Math.cos(a.a0);
    const z0 = a.cz + ARC_R * Math.sin(a.a0);
    const x1 = a.cx + ARC_R * Math.cos(a.a1);
    const z1 = a.cz + ARC_R * Math.sin(a.a1);
    return Math.min(
      Math.hypot(x - x0, z - z0),
      Math.hypot(x - x1, z - z1)
    );
  }

  /** would a w×d rect centered at (x,z) overlap the drift road corridor? */
  private rectHitsDriftRoad(x: number, z: number, w: number, d: number): boolean {
    const hw = w / 2;
    const hd = d / 2;
    const half = 0.8;
    const samples: [number, number][] = [
      [x, z],
      [x - hw, z - hd], [x + hw, z - hd], [x - hw, z + hd], [x + hw, z + hd],
      [x, z - hd], [x, z + hd], [x - hw, z], [x + hw, z],
    ];
    return samples.some(([sx, sz]) => this.layout.roads.some((road) =>
      distanceToRoadPath(road, sx, sz) <= road.width / 2 + half));
  }

  rampAt(x: number, z: number): Ramp | null {
    for (const r of this.ramps) {
      if (
        x >= r.x - r.w / 2 &&
        x <= r.x + r.w / 2 &&
        z >= r.z - r.h / 2 &&
        z <= r.z + r.h / 2
      )
        return r;
    }
    return null;
  }

  isCobble(x: number, z: number): boolean {
    for (const c of this.cobbles) {
      if (
        x >= c.x - c.w / 2 &&
        x <= c.x + c.w / 2 &&
        z >= c.z - c.h / 2 &&
        z <= c.z + c.h / 2
      )
        return true;
    }
    return false;
  }

  puddleAt(x: number, z: number): Puddle | null {
    for (const p of this.puddles) {
      const dx = x - p.x;
      const dz = z - p.z;
      if (dx * dx + dz * dz <= p.r * p.r) return p;
    }
    return null;
  }

  /** keep a circle (the car) out of building AABBs; returns impact speed or 0 */
  collideBuildings(
    pos: THREE.Vector3,
    radius: number,
    vel: THREE.Vector3
  ): number {
    let impact = 0;
    for (const b of this.buildings) {
      const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
        const d = Math.sqrt(d2) || 0.001;
        const nx = dx / d;
        const nz = dz / d;
        const push = radius - d;
        pos.x += nx * push;
        pos.z += nz * push;
        const vn = vel.x * nx + vel.z * nz;
        if (vn < 0) {
          impact = Math.max(impact, -vn);
          vel.x -= vn * nx * 1.4;
          vel.z -= vn * nz * 1.4;
        }
      }
    }
    // world bounds
    const { minX, maxX, minZ, maxZ } = this.layout.bounds;
    if (pos.x < minX || pos.x > maxX) {
      impact = Math.max(impact, Math.abs(vel.x));
      pos.x = Math.max(minX, Math.min(maxX, pos.x));
      vel.x *= -0.3;
    }
    if (pos.z < minZ || pos.z > maxZ) {
      impact = Math.max(impact, Math.abs(vel.z));
      pos.z = Math.max(minZ, Math.min(maxZ, pos.z));
      vel.z *= -0.3;
    }
    return impact;
  }

  // ---------- marker ----------

  setDestination(x: number, z: number): void {
    this.marker.position.set(x, 0, z);
    this.marker.visible = true;
  }

  hideDestination(): void {
    this.marker.visible = false;
  }

  // ---------- per-frame ----------

  update(dt: number): void {
    this.time += dt;
    // traffic lights cycle
    for (const l of this.lights) {
      l.timer += dt;
      const period = (LIGHT_CYCLE + LIGHT_YELLOW) * 2;
      if (l.timer >= period) {
        l.timer -= period;
        l.phaseId++;
        l.state = 0;
      }
      const t = l.timer;
      const xGreen = t < LIGHT_CYCLE;
      const xYellow = t >= LIGHT_CYCLE && t < LIGHT_CYCLE + LIGHT_YELLOW;
      const zPhase = t >= LIGHT_CYCLE + LIGHT_YELLOW;
      // lamp index: 0 red, 1 yellow, 2 green — exactly one lamp lit per head
      const xLamp = xGreen ? 2 : xYellow ? 1 : 0;
      const zLamp = zPhase
        ? t < LIGHT_CYCLE * 2 + LIGHT_YELLOW
          ? 2
          : 1
        : 0;
      const LAMP_COLORS = [0xff2233, 0xffcc22, 0x22ff66];
      for (let k = 0; k < 3; k++) {
        const mx = l.lampsX[k];
        const mz = l.lampsZ[k];
        // one lens blazes in its color; the other two are dark glass —
        // a traffic light must never read as "all colors at once"
        const xOn = k === xLamp;
        const zOn = k === zLamp;
        mx.color.setHex(xOn ? LAMP_COLORS[k] : 0x14161c);
        mx.emissive.setHex(LAMP_COLORS[k]);
        mx.emissiveIntensity = xOn ? 5.2 : 0;
        mz.color.setHex(zOn ? LAMP_COLORS[k] : 0x14161c);
        mz.emissive.setHex(LAMP_COLORS[k]);
        mz.emissiveIntensity = zOn ? 5.2 : 0;
      }
      // paint the stop line with the active color; green = strip off
      const paint = (lamp: number, mat: THREE.MeshBasicMaterial) => {
        if (lamp === 0) {
          mat.color.setHex(0xff2a2a);
          mat.opacity = 0.62;
        } else if (lamp === 1) {
          mat.color.setHex(0xffc22a);
          mat.opacity = 0.62;
        } else {
          mat.opacity = 0;
        }
      };
      paint(xLamp, l.strips[0]);
      paint(xLamp, l.strips[1]);
      paint(zLamp, l.strips[2]);
      paint(zLamp, l.strips[3]);
    }
    // puddle shimmer
    for (let i = 0; i < this.puddleMeshes.length; i++) {
      const m = this.puddleMeshes[i];
      const s = 1 + Math.sin(this.time * 1.7 + i * 1.3) * 0.04;
      m.scale.set(s, s, 1);
    }
    // destination marker pulse + spin
    this.markerRing.rotation.z += dt * 1.5;
    const s = 1 + Math.sin(this.time * 4) * 0.12;
    this.markerRing.scale.set(s, s, 1);
    // rooftop billboards scroll their text
    for (const t of this.billboardTex) {
      t.offset.x = (t.offset.x + dt * 0.018) % 1;
    }
    // neon signs buzz and occasionally drop out
    this.flickerT += dt;
    for (let i = 0; i < this.flickerMats.length; i++) {
      const m = this.flickerMats[i];
      const base = m.userData.base as THREE.Color;
      const t = this.flickerT;
      const buzz = 0.82 + 0.18 * Math.sin(t * 29 + i * 7.3) * Math.sin(t * 7.1 + i);
      const gate = Math.sin(t * 1.4 + i * 2.6) > -0.985 ? 1 : 0.08;
      m.color.copy(base).multiplyScalar(buzz * gate);
    }
  }

  // ---------- builders ----------

  private buildSky(): THREE.Group {
    const g = new THREE.Group();
    const rng = mulberry32(1337);
    if (this.mapId === "tokyo") {
      // Mountain silhouette ring (Initial D vibe).
      const mat = new THREE.MeshBasicMaterial({ color: 0x0d1226, fog: false });
      const geo = new THREE.ConeGeometry(1, 1, 5);
      const inst = new THREE.InstancedMesh(geo, mat, 40);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI * 2 + rng() * 0.1;
        const r = 480 + rng() * 120;
        const h = 90 + rng() * 130;
        const w = 120 + rng() * 140;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI);
        m.compose(
          new THREE.Vector3(Math.cos(a) * r, h / 2 - 4, Math.sin(a) * r),
          q,
          new THREE.Vector3(w, h, w)
        );
        inst.setMatrixAt(i, m);
      }
      g.add(inst);
    } else {
      // Distant harbor cranes break the mountain silhouette on the coastline.
      const craneMat = new THREE.MeshBasicMaterial({ color: 0x172c3c, fog: false });
      const craneGeo = new THREE.BoxGeometry(1, 1, 1);
      const cranes = new THREE.InstancedMesh(craneGeo, craneMat, 24);
      const matrix = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      let index = 0;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const r = 440 + rng() * 40;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const span = 70 + rng() * 35;
        const height = 80 + rng() * 45;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a + Math.PI / 2);
        const sideX = Math.cos(a + Math.PI / 2);
        const sideZ = Math.sin(a + Math.PI / 2);
        for (const side of [-1, 1]) {
          matrix.compose(new THREE.Vector3(x + sideX * span * 0.45 * side, height / 2, z + sideZ * span * 0.45 * side), q, new THREE.Vector3(3, height, 3));
          cranes.setMatrixAt(index++, matrix);
        }
        matrix.compose(new THREE.Vector3(x, height, z), q, new THREE.Vector3(span, 3, 3));
        cranes.setMatrixAt(index++, matrix);
        matrix.compose(new THREE.Vector3(x, height * 0.55, z), q, new THREE.Vector3(1, height * 0.8, 1));
        cranes.setMatrixAt(index++, matrix);
      }
      g.add(cranes);
    }
    // stars
    const starGeo = new THREE.BufferGeometry();
    const n = 350;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      const e = rng() * Math.PI * 0.45 + 0.05;
      const r = 700;
      pos[i * 3] = Math.cos(a) * Math.cos(e) * r;
      pos[i * 3 + 1] = Math.sin(e) * r;
      pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({
        color: 0xaabbee,
        size: 1.6,
        sizeAttenuation: false,
        fog: false,
      })
    );
    g.add(stars);
    // moon
    const moon = new THREE.Mesh(
      new THREE.CircleGeometry(26, 24),
      new THREE.MeshBasicMaterial({ color: 0xe8ecff, fog: false })
    );
    moon.position.set(-320, 330, -520);
    moon.lookAt(0, 0, 0);
    g.add(moon);
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(48, 24),
      new THREE.MeshBasicMaterial({
        color: 0x8899dd,
        transparent: true,
        opacity: 0.25,
        fog: false,
      })
    );
    glow.position.set(-320, 330, -521);
    glow.lookAt(0, 0, 0);
    g.add(glow);
    return g;
  }

  private buildGround(): THREE.Mesh {
    const tex = this.makeGroundTexture();
    const geo = new THREE.PlaneGeometry(GS, GS);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: this.mapId === "yokohama" ? 0.72 : 0.92,
      metalness: this.mapId === "yokohama" ? 0.14 : 0.08,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    return mesh;
  }

  private buildHarborWater(): THREE.Group {
    const group = new THREE.Group();
    group.name = "harbor-water";
    const water = new THREE.MeshBasicMaterial({ color: 0x123748 });
    const edge = WORLD_HALF + ROAD_W / 2 + 14;
    const strip = (width: number, depth: number, x: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), water);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, 0.025, z);
      group.add(mesh);
    };
    strip(GS, 28, 0, -edge);
    strip(GS, 28, 0, edge);
    strip(28, GS, -edge, 0);
    strip(28, GS, edge, 0);
    return group;
  }

  private makeGroundTexture(): THREE.CanvasTexture {
    const S = 2048;
    const cv = document.createElement("canvas");
    cv.width = cv.height = S;
    const g = cv.getContext("2d")!;
    const u = (x: number) => worldToTextureCoordinate(x, GS, S);
    const v = (z: number) => worldToTextureCoordinate(z, GS, S);
    const w = (value: number) => worldLengthToTexturePixels(value, GS, S);

    g.fillStyle = this.mapId === "yokohama" ? "#424c55" : "#414a5c";
    g.fillRect(0, 0, S, S);
    for (const parcel of this.layout.parcels) {
      g.save();
      g.translate(u(parcel.x), v(parcel.z));
      g.rotate(-parcel.rotation);
      g.fillStyle = parcel.zone === "port" ? "#35434c" : "#30394a";
      g.fillRect(-w(parcel.width / 2), -w(parcel.depth / 2), w(parcel.width), w(parcel.depth));
      g.restore();
    }

    g.lineCap = "round";
    g.lineJoin = "round";
    for (const road of this.layout.roads) {
      const drawPath = () => {
        g.beginPath();
        road.points.forEach((p, i) => i === 0 ? g.moveTo(u(p.x), v(p.z)) : g.lineTo(u(p.x), v(p.z)));
      };
      drawPath();
      g.strokeStyle = "#242a36";
      g.lineWidth = w(road.width + 2.4);
      g.stroke();
      drawPath();
      g.strokeStyle = this.mapId === "yokohama" ? "#56616a" : "#596273";
      g.lineWidth = w(road.width);
      g.stroke();
      drawPath();
      g.strokeStyle = "rgba(177,188,207,.48)";
      g.lineWidth = w(0.42);
      g.setLineDash([]);
      g.stroke();
      drawPath();
      g.strokeStyle = "rgba(178,185,199,.68)";
      g.lineWidth = w(0.52);
      g.setLineDash([w(3.5), w(5)]);
      g.stroke();
      g.setLineDash([]);
    }

    // Crosswalks only mark the major authored intersections.
    g.fillStyle = "rgba(193,202,217,.72)";
    for (const junction of this.layout.signalJunctions) {
      for (let i = -3; i <= 3; i++) {
        g.fillRect(u(junction.x + i * 1.8 - 0.55), v(junction.z - 9), w(1.1), w(1.25));
        g.fillRect(u(junction.x + i * 1.8 - 0.55), v(junction.z + 7.8), w(1.1), w(1.25));
        g.fillRect(u(junction.x - 9), v(junction.z + i * 1.8 - 0.55), w(1.25), w(1.1));
        g.fillRect(u(junction.x + 7.8), v(junction.z + i * 1.8 - 0.55), w(1.25), w(1.1));
      }
    }

    // Deterministic asphalt wear sampled along the same centerlines as driving.
    const rng = mulberry32(this.mapId === "tokyo" ? 31337 : 9182);
    for (let n = 0; n < 3200; n++) {
      const road = this.layout.roads[Math.floor(rng() * this.layout.roads.length)];
      const segment = Math.floor(rng() * (road.points.length - 1));
      const a = road.points[segment];
      const b = road.points[segment + 1];
      const t = rng();
      const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const lateral = (rng() - 0.5) * Math.max(0, road.width - 2);
      const px = a.x + (b.x - a.x) * t - (b.z - a.z) / length * lateral;
      const pz = a.z + (b.z - a.z) * t + (b.x - a.x) / length * lateral;
      g.fillStyle = rng() < 0.5 ? "rgba(16,19,26,.42)" : "rgba(118,126,143,.3)";
      const size = 0.4 + rng() * 1.8;
      g.fillRect(u(px - size / 2), v(pz - size / 2), w(size), w(size));
    }

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  private buildBuildings(): THREE.Group {
    if (this.mapId === "yokohama") return this.buildPortBuildings();
    const g = new THREE.Group();
    const rng = mulberry32(777);
    const winTex = this.makeBuildingTexture();
    const mat = new THREE.MeshStandardMaterial({
      map: winTex,
      emissive: 0xffffff,
      emissiveMap: winTex,
      emissiveIntensity: 0.85,
      color: 0x9aa0b4,
      roughness: 0.85,
      metalness: 0.1,
    });
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const placements: {
      x: number;
      z: number;
      w: number;
      h: number;
      d: number;
      rotation: number;
    }[] = [];
    for (const parcel of this.layout.parcels) {
      const n = parcel.width > 20 && rng() > 0.45 ? 2 : 1;
      for (let b = 0; b < n; b++) {
        const localX = n === 1 ? 0 : (b === 0 ? -1 : 1) * parcel.width * 0.22;
        const localZ = (rng() - 0.5) * parcel.depth * 0.12;
        const c = Math.cos(parcel.rotation);
        const s = Math.sin(parcel.rotation);
        const x = parcel.x + localX * c - localZ * s;
        const z = parcel.z + localX * s + localZ * c;
        const w = parcel.width * (n === 1 ? 0.72 : 0.36);
        const d = parcel.depth * 0.72;
        const h = 14 + rng() * 46;
        placements.push({ x, z, w, d, h, rotation: parcel.rotation });
        const ex = Math.abs(c) * w / 2 + Math.abs(s) * d / 2;
        const ez = Math.abs(s) * w / 2 + Math.abs(c) * d / 2;
        this.buildings.push({ minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez });
        this.buildingHeights.push(h);
      }
    }
    const inst = new THREE.InstancedMesh(geo, mat, placements.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    placements.forEach((p, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rotation);
      if (i % 5 === 2) {
        // reserve this spot for a real mid-rise model (dropped in when assets load)
        this.heroSpots.push(p);
        const ex = Math.abs(Math.cos(p.rotation)) * p.w / 2 + Math.abs(Math.sin(p.rotation)) * p.d / 2;
        const ez = Math.abs(Math.sin(p.rotation)) * p.w / 2 + Math.abs(Math.cos(p.rotation)) * p.d / 2;
        this.heroAABBs.push({
          minX: p.x - ex,
          maxX: p.x + ex,
          minZ: p.z - ez,
          maxZ: p.z + ez,
        });
        m.compose(
          new THREE.Vector3(p.x, -60, p.z),
          q,
          new THREE.Vector3(0.001, 0.001, 0.001)
        );
        inst.setMatrixAt(i, m);
        return;
      }
      m.compose(
        new THREE.Vector3(p.x, 0, p.z),
        q,
        new THREE.Vector3(p.w, p.h, p.d)
      );
      inst.setMatrixAt(i, m);
      const shade = 0.85 + rng() * 0.35;
      col.setRGB(shade, shade, shade * 1.08);
      inst.setColorAt(i, col);
      if (p.h > 38) this.roofSpots.push(p);
    });
    inst.castShadow = false;
    inst.receiveShadow = false;
    g.add(inst);
    return g;
  }

  private buildPortBuildings(): THREE.Group {
    const group = new THREE.Group();
    group.name = "port-warehouses-and-containers";
    const rng = mulberry32(9182);
    const warehouses: { x: number; z: number; w: number; h: number; d: number; rotation: number }[] = [];
    const containers: { x: number; z: number; w: number; h: number; d: number; color: number; level: number; rotation: number }[] = [];
    const paint = [0xe15a42, 0x32a8b4, 0xe1a83c, 0x627ead, 0x829951];

    for (const [index, parcel] of this.layout.parcels.entries()) {
      const c = Math.cos(parcel.rotation);
      const s = Math.sin(parcel.rotation);
      const place = (lx: number, lz: number) => ({ x: parcel.x + lx * c - lz * s, z: parcel.z + lx * s + lz * c });
      if (index % 2 === 0) {
        const w = parcel.width * 0.72;
        const d = parcel.depth * 0.66;
        const h = 8 + rng() * 3;
        warehouses.push({ x: parcel.x, z: parcel.z, w, h, d, rotation: parcel.rotation });
        const ex = Math.abs(c) * w / 2 + Math.abs(s) * d / 2;
        const ez = Math.abs(s) * w / 2 + Math.abs(c) * d / 2;
        this.buildings.push({ minX: parcel.x - ex, maxX: parcel.x + ex, minZ: parcel.z - ez, maxZ: parcel.z + ez });
        this.buildingHeights.push(h);
        continue;
      }
      for (const dx of [-4, 4]) for (const dz of [-4, 4]) {
        const { x, z } = place(dx, dz);
        const w = 4.4;
        const d = 3.1;
        const h = 2.7;
        const color = paint[Math.floor(rng() * paint.length)];
        const levels = rng() > 0.72 ? 2 : 1;
        for (let level = 0; level < levels; level++) containers.push({ x, z, w, h, d, color, level, rotation: parcel.rotation });
        const ex = Math.abs(c) * w / 2 + Math.abs(s) * d / 2;
        const ez = Math.abs(s) * w / 2 + Math.abs(c) * d / 2;
        this.buildings.push({ minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez });
        this.buildingHeights.push(levels * h);
      }
    }

    const warehouseGeo = new THREE.BoxGeometry(1, 1, 1);
    warehouseGeo.translate(0, 0.5, 0);
    const warehouseTexture = this.makeWarehouseTexture();
    const warehouseMat = new THREE.MeshStandardMaterial({
      map: warehouseTexture,
      color: 0xffffff,
      roughness: 0.86,
      metalness: 0.08,
      emissive: 0x101820,
    });
    const warehouseMesh = new THREE.InstancedMesh(warehouseGeo, warehouseMat, warehouses.length);
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const tint = new THREE.Color();
    warehouses.forEach((b, i) => {
      quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.rotation);
      matrix.compose(new THREE.Vector3(b.x, 0, b.z), quat, new THREE.Vector3(b.w, b.h, b.d));
      warehouseMesh.setMatrixAt(i, matrix);
      tint.setHex(i % 2 ? 0x8b999e : 0x737f86);
      warehouseMesh.setColorAt(i, tint);
      this.buildings.push({ minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2 });
      this.buildingHeights.push(b.h);
    });
    group.add(warehouseMesh);

    const containerGeo = new THREE.BoxGeometry(1, 1, 1);
    containerGeo.translate(0, 0.5, 0);
    const containerMat = new THREE.MeshStandardMaterial({ map: this.makeContainerTexture(), color: 0xffffff, roughness: 0.72, metalness: 0.26 });
    const containerMesh = new THREE.InstancedMesh(containerGeo, containerMat, containers.length);
    containers.forEach((b, i) => {
      quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.rotation);
      matrix.compose(new THREE.Vector3(b.x, b.level * b.h, b.z), quat, new THREE.Vector3(b.w, b.h, b.d));
      containerMesh.setMatrixAt(i, matrix);
      tint.setHex(b.color);
      containerMesh.setColorAt(i, tint);
    });
    group.add(containerMesh);
    return group;
  }

  private buildPortCranes(): THREE.Group {
    const group = new THREE.Group();
    group.name = "port-gantry-cranes";
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xffad4d, emissive: 0x542307, emissiveIntensity: 0.24, roughness: 0.62, metalness: 0.24 });
    const beam = new THREE.BoxGeometry(1, 1, 1);
    const addBeam = (x: number, y: number, z: number, w: number, h: number, d: number) => {
      const mesh = new THREE.Mesh(beam, frameMat);
      mesh.position.set(x, y, z);
      mesh.scale.set(w, h, d);
      group.add(mesh);
    };
    const spots = [
      { x: -151, z: -148 }, { x: 151, z: -142 }, { x: 157, z: 116 }, { x: -157, z: 140 },
    ];
    for (const { x: cx, z: cz } of spots) {
      const w = 24;
      const d = 13;
      if (this.rectHitsDriftRoad(cx, cz, w, d)) continue;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const x = cx + sx * w * 0.42;
          const z = cz + sz * d * 0.38;
          addBeam(x, 6.5, z, 0.8, 13, 0.8);
          this.buildings.push({ minX: x - 0.6, maxX: x + 0.6, minZ: z - 0.6, maxZ: z + 0.6 });
          this.buildingHeights.push(13);
        }
      }
      addBeam(cx, 13, cz, w, 0.9, 0.9);
      addBeam(cx, 13.8, cz, 2, 0.6, 2);
    }
    return group;
  }

  private makeContainerTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#d8dcda";
    ctx.fillRect(0, 0, 128, 64);
    for (let x = 3; x < 128; x += 7) {
      ctx.fillStyle = "rgba(18,28,34,0.24)";
      ctx.fillRect(x, 0, 2, 64);
      ctx.fillStyle = "rgba(255,255,255,0.2)";
      ctx.fillRect(x + 2, 0, 1, 64);
    }
    ctx.fillStyle = "rgba(12,20,26,0.68)";
    ctx.fillRect(7, 48, 50, 9);
    ctx.fillStyle = "#f5edda";
    ctx.font = "bold 7px sans-serif";
    ctx.fillText("YOKOHAMA · CARGO", 10, 55);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private makeWarehouseTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#69777c";
    ctx.fillRect(0, 0, 128, 128);
    for (let y = 5; y < 128; y += 8) {
      ctx.fillStyle = "rgba(230,238,235,0.11)";
      ctx.fillRect(0, y, 128, 2);
    }
    ctx.fillStyle = "#26333a";
    ctx.fillRect(28, 48, 72, 72);
    ctx.strokeStyle = "#b9c3c0";
    ctx.lineWidth = 2;
    for (let y = 55; y < 118; y += 9) {
      ctx.beginPath();
      ctx.moveTo(31, y);
      ctx.lineTo(97, y);
      ctx.stroke();
    }
    ctx.fillStyle = "#e5b64d";
    ctx.fillRect(5, 15, 21, 7);
    ctx.fillStyle = "#f5edda";
    ctx.font = "bold 7px sans-serif";
    ctx.fillText("DOCK 86", 5, 32);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  /** drop loaded mid-rise models onto the reserved spots (call once, after assets load) */
  setHeroBuildings(model: THREE.Group, modelSize: THREE.Vector3): void {
    const rng = mulberry32(4242);
    for (const s of this.heroSpots) {
      const clone = model.clone(true);
      const fit = Math.min(
        (s.h * 1.05) / modelSize.y,
        (s.w * 0.94) / modelSize.x,
        (s.d * 0.94) / modelSize.z
      );
      clone.scale.setScalar(fit);
      clone.position.set(s.x, 0, s.z);
      clone.rotation.y = Math.floor(rng() * 4) * (Math.PI / 2);
      this.group.add(clone);
    }
  }

  heroCount(): number {
    return this.heroSpots.length;
  }

  private makeBuildingTexture(): THREE.CanvasTexture {
    const cv = document.createElement("canvas");
    cv.width = 128;
    cv.height = 256;
    const g = cv.getContext("2d")!;
    // walls — near black in the emissive map so only windows glow
    g.fillStyle = "#181e2e";
    g.fillRect(0, 0, 128, 256);
    const rng = mulberry32(99);
    for (let y = 6; y < 250; y += 14) {
      for (let x = 6; x < 122; x += 12) {
        if (rng() < 0.55) {
          const warm = rng() < 0.6;
          const a = 0.55 + rng() * 0.45;
          g.fillStyle = warm
            ? `rgba(255,190,105,${a})`
            : `rgba(130,215,255,${a * 0.9})`;
          g.fillRect(x, y, 7, 9);
        }
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private buildStreetProps(): THREE.Group {
    const g = new THREE.Group();
    const rng = mulberry32(31337);
    // lamp poles along roads — emissive tips + additive glow sprites
    const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 7, 6);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a4152 });
    const tipGeo = new THREE.SphereGeometry(0.42, 8, 8);
    const tipMat = new THREE.MeshStandardMaterial({
      color: 0xffd9a0,
      emissive: 0xffc070,
      emissiveIntensity: 2.4,
    });
    const positions: THREE.Vector3[] = [];
    for (const road of this.layout.roads) for (let i = 0; i < road.points.length - 1; i++) {
      const a = road.points[i];
      const b = road.points[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length = Math.hypot(dx, dz) || 1;
      const count = Math.floor(length / 30);
      for (let j = 1; j <= count; j++) {
        if (rng() < 0.4) continue;
        const t = j / (count + 1);
        const side = j % 2 === 0 ? 1 : -1;
        const offset = road.width / 2 + 1.6;
        const x = a.x + dx * t - dz / length * offset * side;
        const z = a.z + dz * t + dx / length * offset * side;
        if (this.isOnRoad(x, z)) continue;
        positions.push(new THREE.Vector3(x, 7, z));
      }
    }
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, positions.length);
    const tips = new THREE.InstancedMesh(tipGeo, tipMat, positions.length);
    const m = new THREE.Matrix4();
    positions.forEach((p, i) => {
      m.makeTranslation(p.x, 3.5, p.z);
      poles.setMatrixAt(i, m);
      m.makeTranslation(p.x, 7, p.z);
      tips.setMatrixAt(i, m);
    });
    g.add(poles, tips);

    if (this.mapId === "tokyo") {
      // Neon signs belong to the downtown skyline, not the cargo terminal.
      const signTex = this.makeNeonTexture();
      for (let k = 0; k < 22; k++) {
        const b = this.buildings[Math.floor(rng() * this.buildings.length)];
        if (!b) continue;
        const hue = rng();
        const color = new THREE.Color().setHSL(hue, 1, 0.6);
        const mat = new THREE.MeshBasicMaterial({
          map: signTex,
          transparent: true,
          opacity: 0.9,
          color,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const w = 3 + rng() * 3;
        const h = w * 2;
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
        const side = Math.floor(rng() * 4);
        const y = 5 + rng() * 12;
        if (side === 0) {
          sign.position.set((b.minX + b.maxX) / 2, y, b.minZ - 0.15);
        } else if (side === 1) {
          sign.position.set((b.minX + b.maxX) / 2, y, b.maxZ + 0.15);
        } else if (side === 2) {
          sign.position.set(b.minX - 0.15, y, (b.minZ + b.maxZ) / 2);
          sign.rotation.y = -Math.PI / 2;
        } else {
          sign.position.set(b.maxX + 0.15, y, (b.minZ + b.maxZ) / 2);
          sign.rotation.y = Math.PI / 2;
        }
        g.add(sign);
      }
    }
    return g;
  }

  private makeNeonTexture(): THREE.CanvasTexture {
    const cv = document.createElement("canvas");
    cv.width = 64;
    cv.height = 128;
    const g = cv.getContext("2d")!;
    g.clearRect(0, 0, 64, 128);
    g.strokeStyle = "#ffffff";
    g.lineWidth = 3;
    g.strokeRect(4, 4, 56, 120);
    // glyph-like strokes
    const rng = mulberry32(555);
    for (let i = 0; i < 4; i++) {
      const y = 16 + i * 26;
      g.beginPath();
      g.moveTo(14 + rng() * 8, y);
      g.lineTo(50 - rng() * 8, y);
      g.moveTo(20 + rng() * 10, y + 4);
      g.lineTo(20 + rng() * 10, y + 18);
      if (rng() < 0.7) {
        g.moveTo(14, y + 12 + rng() * 6);
        g.lineTo(50, y + 12 + rng() * 6);
      }
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // ---------- city dressing: neon / signs / road signs ----------

  private static readonly NEON = [0xff2d95, 0x00e5ff, 0x22ff88, 0xffd24a, 0xb14aff];

  private isHeroSpot(b: AABB): boolean {
    for (const h of this.heroAABBs)
      if (b.minX === h.minX && b.minZ === h.minZ) return true;
    return false;
  }

  /** stroke-cluster glyphs, drawn by hand so no font/CJK support is needed */
  private drawGlyphStrokes(
    g: CanvasRenderingContext2D,
    rng: () => number,
    x: number,
    y: number,
    w: number,
    h: number
  ): void {
    g.save();
    g.translate(x, y);
    g.lineWidth = Math.max(2, w * 0.09);
    g.lineCap = "round";
    const cols = Math.max(1, Math.round(w / 26));
    for (let c = 0; c < cols; c++) {
      const cw = w / cols;
      const ox = c * cw + cw * 0.18;
      const iw = cw * 0.64;
      const n = 2 + Math.floor(rng() * 3);
      for (let k = 0; k < n; k++) {
        const yy = h * (0.12 + 0.76 * rng());
        g.beginPath();
        g.moveTo(ox, yy);
        g.lineTo(ox + iw * (0.5 + rng() * 0.5), yy);
        g.stroke();
        if (rng() < 0.65) {
          const xx = ox + iw * rng();
          g.beginPath();
          g.moveTo(xx, yy + 2);
          g.lineTo(xx, yy + h * (0.1 + rng() * 0.18));
          g.stroke();
        }
      }
    }
    g.restore();
  }

  /** vertical blade sign face (128x256) */
  private makeBladeTexture(kind: number): THREE.CanvasTexture {
    const cv = document.createElement("canvas");
    cv.width = 128;
    cv.height = 256;
    const g = cv.getContext("2d")!;
    const rng = mulberry32(6000 + kind * 77);
    g.strokeStyle = "#ffffff";
    g.fillStyle = "#ffffff";
    // rounded frame
    g.lineWidth = 5;
    g.beginPath();
    g.roundRect(7, 7, 114, 242, 14);
    g.stroke();
    if (kind === 0) {
      // steaming bowl
      g.beginPath();
      g.arc(64, 150, 30, 0, Math.PI);
      g.stroke();
      g.beginPath();
      g.moveTo(30, 150);
      g.lineTo(98, 150);
      g.stroke();
      for (const sx of [-16, 0, 16]) {
        g.beginPath();
        g.moveTo(64 + sx, 128);
        g.quadraticCurveTo(64 + sx + 8, 108, 64 + sx, 88);
        g.stroke();
      }
      g.beginPath();
      g.moveTo(42, 108);
      g.lineTo(86, 108);
      g.stroke();
    } else if (kind === 1) {
      // bottle
      g.beginPath();
      g.moveTo(56, 60);
    g.lineTo(56, 96);
        g.lineTo(44, 116);
        g.lineTo(44, 200);
        g.lineTo(84, 200);
        g.lineTo(84, 116);
        g.lineTo(72, 96);
        g.lineTo(72, 60);
        g.closePath();
        g.stroke();
      g.beginPath();
      g.moveTo(44, 150);
      g.lineTo(84, 150);
      g.stroke();
    } else if (kind === 2) {
      g.font = "900 64px sans-serif";
      g.textAlign = "center";
      g.fillText("24H", 64, 128);
      g.font = "900 34px sans-serif";
      g.fillText("OPEN", 64, 178);
    } else {
      // music note
      g.beginPath();
      g.ellipse(52, 186, 16, 12, -0.3, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(66, 182);
      g.lineTo(66, 84);
      g.lineTo(96, 96);
      g.stroke();
    }
    this.drawGlyphStrokes(g, rng, 24, 208, 80, 36);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /** projecting vertical neon signs on building walls, plus a few flickering ones */
  private buildBladeSigns(): THREE.Group {
    const g = new THREE.Group();
    const rng = mulberry32(80808);
    const geo = new THREE.PlaneGeometry(1.15, 3.6);
    const kinds = [0, 1, 2, 3].map((k) => this.makeBladeTexture(k));
    const perKind: THREE.Matrix4[][] = [[], [], [], []];
    const placements: { x: number; z: number; ry: number; y: number }[] = [];
    for (const b of this.buildings) {
      if (this.isHeroSpot(b) || rng() < 0.42) continue;
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;
      const cands = [
        { d: this.nearestRoadDist(b.minX - 0.5, cz), x: b.minX - 0.5, z: cz, ry: -Math.PI / 2 },
        { d: this.nearestRoadDist(b.maxX + 0.5, cz), x: b.maxX + 0.5, z: cz, ry: Math.PI / 2 },
        { d: this.nearestRoadDist(cx, b.minZ - 0.5), x: cx, z: b.minZ - 0.5, ry: Math.PI },
        { d: this.nearestRoadDist(cx, b.maxZ + 0.5), x: cx, z: b.maxZ + 0.5, ry: 0 },
      ];
      cands.sort((a, bb) => a.d - bb.d);
      const c = cands[0];
      if (c.d > 11) continue;
      placements.push({ x: c.x, z: c.z, ry: c.ry, y: 3.4 + rng() * 4.6 });
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const eul = new THREE.Euler();
    const col = new THREE.Color();
    for (const p of placements) {
      const k = Math.floor(rng() * 4);
      eul.set(0, p.ry, 0);
      q.setFromEuler(eul);
      m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(1, 1, 1));
      perKind[k].push(m.clone());
    }
    for (let k = 0; k < 4; k++) {
      const list = perKind[k];
      if (!list.length) continue;
      const mat = new THREE.MeshBasicMaterial({
        map: kinds[k],
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const inst = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((mm, i) => {
        inst.setMatrixAt(i, mm);
        col.setHex(World.NEON[Math.floor(rng() * World.NEON.length)]);
        inst.setColorAt(i, col);
      });
      g.add(inst);
    }
    // individually flickering signs
    for (let i = 0; i < 5 && i < placements.length; i++) {
      const p = placements[Math.floor(rng() * placements.length)];
      const kind = Math.floor(rng() * 4);
      const base = new THREE.Color(
        World.NEON[Math.floor(rng() * World.NEON.length)]
      );
      const mat = new THREE.MeshBasicMaterial({
        map: kinds[kind],
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        color: base.clone(),
      });
      mat.userData.base = base;
      const sign = new THREE.Mesh(geo, mat);
      sign.position.set(p.x, p.y + 0.4, p.z);
      sign.rotation.y = p.ry;
      g.add(sign);
      this.flickerMats.push(mat);
    }
    return g;
  }

  /** vertical kanji-style neon columns (white glyph art, tinted per instance) */
  private makeColumnTexture(): THREE.CanvasTexture {
    const cv = document.createElement("canvas");
    cv.width = 96;
    cv.height = 384;
    const g = cv.getContext("2d")!;
    const rng = mulberry32(5150);
    g.strokeStyle = "#ffffff";
    g.lineCap = "round";
    // stacked signboard cells with a glyph each
    for (let k = 0; k < 4; k++) {
      const y = 8 + k * 94;
      g.lineWidth = 5;
      g.strokeRect(8, y, 80, 82);
      this.drawGlyphStrokes(g, rng, 18, y + 8, 60, 66);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /** tall vertical neon glyph columns on facades + a few flickering */
  private buildNeonColumns(): THREE.Group {
    const g = new THREE.Group();
    const rng = mulberry32(31337);
    const tex = this.makeColumnTexture();
    const geo = new THREE.PlaneGeometry(1.35, 5.4);
    const mats: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const eul = new THREE.Euler();
    const col = new THREE.Color();
    const picked: { x: number; z: number; ry: number; y: number }[] = [];
    for (const b of this.buildings) {
      if (this.isHeroSpot(b) || rng() < 0.5) continue;
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;
      const cands = [
        { d: this.nearestRoadDist(b.minX - 0.45, cz), x: b.minX - 0.45, z: cz, ry: -Math.PI / 2 },
        { d: this.nearestRoadDist(b.maxX + 0.45, cz), x: b.maxX + 0.45, z: cz, ry: Math.PI / 2 },
        { d: this.nearestRoadDist(cx, b.minZ - 0.45), x: cx, z: b.minZ - 0.45, ry: Math.PI },
        { d: this.nearestRoadDist(cx, b.maxZ + 0.45), x: cx, z: b.maxZ + 0.45, ry: 0 },
      ];
      cands.sort((a, bb) => a.d - bb.d);
      const c = cands[0];
      if (c.d > 11) continue;
      const y = 4.6 + rng() * 6.5;
      eul.set(0, c.ry, 0);
      q.setFromEuler(eul);
      m.compose(new THREE.Vector3(c.x, y, c.z), q, new THREE.Vector3(1, 1, 1));
      mats.push(m.clone());
      picked.push({ x: c.x, z: c.z, ry: c.ry, y });
    }
    if (mats.length) {
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const inst = new THREE.InstancedMesh(geo, mat, mats.length);
      mats.forEach((mm, i) => {
        inst.setMatrixAt(i, mm);
        col.setHex(World.NEON[Math.floor(rng() * World.NEON.length)]);
        inst.setColorAt(i, col);
      });
      g.add(inst);
    }
    // flickering columns
    for (let i = 0; i < 4 && i < picked.length; i++) {
      const p = picked[Math.floor(rng() * picked.length)];
      const base = new THREE.Color(World.NEON[Math.floor(rng() * World.NEON.length)]);
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        color: base.clone(),
      });
      mat.userData.base = base;
      const sign = new THREE.Mesh(geo, mat);
      sign.position.set(p.x, p.y + 1.2, p.z);
      sign.rotation.y = p.ry;
      g.add(sign);
      this.flickerMats.push(mat);
    }
    return g;
  }

  /** scrolling text texture for rooftop billboards */
  private makeBillboardTexture(seed: number): THREE.CanvasTexture {
    const cv = document.createElement("canvas");
    cv.width = 256;
    cv.height = 128;
    const g = cv.getContext("2d")!;
    const rng = mulberry32(seed);
    g.fillStyle = "#0a0616";
    g.fillRect(0, 0, 256, 128);
    g.strokeStyle = "#ffffff";
    g.fillStyle = "#ffffff";
    this.drawGlyphStrokes(g, rng, 10, 14, 236, 44);
    g.font = "900 30px sans-serif";
    g.textAlign = "center";
    g.fillText(seed % 2 ? "DRIFT 86" : "NIGHT CITY", 128, 96);
    g.strokeRect(4, 4, 248, 120);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    return tex;
  }

  /** bright rooftop billboards on the tallest buildings */
  private buildBillboards(): THREE.Group {
    const g = new THREE.Group();
    const rng = mulberry32(515151);
    const texA = this.makeBillboardTexture(11);
    const texB = this.makeBillboardTexture(22);
    this.billboardTex.push(texA, texB);
    const boardGeo = new THREE.PlaneGeometry(9, 4.5);
    const legGeo = new THREE.BoxGeometry(0.25, 2.6, 0.25);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x2a3040 });
    const spots = [...this.roofSpots].sort(() => rng() - 0.5).slice(0, 6);
    spots.forEach((s, i) => {
      const grp = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({
        map: i % 2 ? texA : texB,
        side: THREE.DoubleSide,
        fog: false,
      });
      const board = new THREE.Mesh(boardGeo, mat);
      board.position.y = 3.4;
      grp.add(board);
      for (const lx of [-3.4, 3.4]) {
        const leg = new THREE.Mesh(legGeo, legMat);
        leg.position.set(lx, 1.3, 0);
        grp.add(leg);
      }
      grp.position.set(s.x, s.h, s.z);
      grp.rotation.y = Math.floor(rng() * 4) * (Math.PI / 2);
      g.add(grp);
    });
    return g;
  }

  /** neon edge strips on building corners and rooflines */
  private buildNeonStrips(): THREE.Group {
    const g = new THREE.Group();
    const rng = mulberry32(919191);
    const mats: { m: THREE.Matrix4; c: number }[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    for (let bi = 0; bi < this.buildings.length; bi++) {
      const b = this.buildings[bi];
      if (this.isHeroSpot(b) || rng() < 0.35) continue;
      const w = b.maxX - b.minX;
      const h = b.maxZ - b.minZ;
      const height = this.buildingHeights[bi];
      const c = World.NEON[Math.floor(rng() * World.NEON.length)];
      // vertical corner strips
      const corners: [number, number][] = [
        [b.minX, b.minZ],
        [b.maxX, b.minZ],
        [b.minX, b.maxZ],
        [b.maxX, b.maxZ],
      ];
      const nv = rng() < 0.5 ? 1 : 2;
      for (let k = 0; k < nv; k++) {
        const [x, z] = corners[Math.floor(rng() * 4)];
        const out = 0.1;
        const sx = x === b.minX ? -out : out;
        const sz = z === b.minZ ? -out : out;
        m.compose(
          new THREE.Vector3(x + sx, height / 2, z + sz),
          q.identity(),
          new THREE.Vector3(0.14, height, 0.14)
        );
        mats.push({ m: m.clone(), c });
      }
      // roofline strip
      if (rng() < 0.6) {
        const horiz = rng() < 0.5;
        m.compose(
          new THREE.Vector3(
            (b.minX + b.maxX) / 2,
            height,
            horiz ? b.minZ - 0.1 : (b.minZ + b.maxZ) / 2
          ),
          q.identity(),
          horiz
            ? new THREE.Vector3(w + 0.2, 0.14, 0.14)
            : new THREE.Vector3(0.14, 0.14, h + 0.2)
        );
        mats.push({ m: m.clone(), c });
      }
    }
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({});
    const inst = new THREE.InstancedMesh(geo, mat, mats.length);
    mats.forEach((e, i) => {
      inst.setMatrixAt(i, e.m);
      col.setHex(e.c);
      inst.setColorAt(i, col);
    });
    g.add(inst);
    return g;
  }

  /** Japanese-style direction guide sign face (256x128) */
  private makeGuideTexture(dir: "left" | "right" | "up"): THREE.CanvasTexture {
    const cv = document.createElement("canvas");
    cv.width = 256;
    cv.height = 128;
    const g = cv.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, "#1557b0");
    grad.addColorStop(1, "#0d3a8a");
    g.fillStyle = grad;
    g.beginPath();
    g.roundRect(2, 2, 252, 124, 18);
    g.fill();
    g.strokeStyle = "#ffffff";
    g.lineWidth = 5;
    g.beginPath();
    g.roundRect(6, 6, 244, 116, 14);
    g.stroke();
    // white arrow
    g.fillStyle = "#ffffff";
    g.save();
    g.translate(150, 64);
    if (dir === "left") g.rotate(Math.PI);
    else if (dir === "up") g.rotate(-Math.PI / 2);
    g.beginPath();
    g.moveTo(52, 0);
    g.lineTo(18, -26);
    g.lineTo(18, -10);
    g.lineTo(-52, -10);
    g.lineTo(-52, 10);
    g.lineTo(18, 10);
    g.lineTo(18, 26);
    g.closePath();
    g.fill();
    g.restore();
    // destination glyph strokes + route number
    g.strokeStyle = "#ffffff";
    const rng = mulberry32(dir === "left" ? 31 : dir === "right" ? 32 : 33);
    this.drawGlyphStrokes(g, rng, 20, 30, 66, 66);
    g.font = "900 26px sans-serif";
    g.textAlign = "center";
    g.fillStyle = "#0d3a8a";
    g.fillStyle = "#ffffff";
    g.fillText(dir === "left" ? "R 17" : dir === "right" ? "R 58" : "R 86", 58, 112);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /** direction guide signs on light poles + chevron boards on the other corners */
  private buildRoadSigns(): THREE.Group {
    const g = new THREE.Group();
    const guideGeo = new THREE.PlaneGeometry(1.7, 0.85);
    const kinds = {
      left: this.makeGuideTexture("left"),
      right: this.makeGuideTexture("right"),
      up: this.makeGuideTexture("up"),
    } as const;
    const per: Record<"left" | "right" | "up", THREE.Matrix4[]> = {
      left: [],
      right: [],
      up: [],
    };
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const eul = new THREE.Euler();
    const dirs = ["left", "right", "up"] as const;
    let k = 0;
    for (const { x: cx, z: cz } of this.layout.signalJunctions) {
        const px = cx + ROAD_W / 2 + 1.2;
        const pz = cz + ROAD_W / 2 + 1.2;
        // guide sign for the x-road, mounted on the light pole below the heads
        const d1 = dirs[k % 3];
        k++;
        eul.set(0, Math.PI / 2, 0);
        q.setFromEuler(eul);
        m.compose(new THREE.Vector3(px, 4.6, pz - 0.3), q, new THREE.Vector3(1, 1, 1));
        per[d1].push(m.clone());
        // guide sign for the z-road
        const d2 = dirs[k % 3];
        k++;
        eul.set(0, 0, 0);
        q.setFromEuler(eul);
        m.compose(new THREE.Vector3(px - 0.3, 5.5, pz), q, new THREE.Vector3(1, 1, 1));
        per[d2].push(m.clone());
        // chevron boards on the three plain corners
        for (const [sx, sz] of [
          [-1, 1],
          [1, -1],
          [-1, -1],
        ] as const) {
          const x = cx + sx * (ROAD_W / 2 + 1.4);
          const z = cz + sz * (ROAD_W / 2 + 1.4);
          eul.set(0, Math.atan2(sx, sz), 0);
          q.setFromEuler(eul);
          m.compose(new THREE.Vector3(x, 1.15, z), q, new THREE.Vector3(1, 1, 1));
          this.chevronMats.push(m.clone());
        }
    }
    for (const d of dirs) {
      const list = per[d];
      if (!list.length) continue;
      const mat = new THREE.MeshBasicMaterial({
        map: kinds[d],
        side: THREE.DoubleSide,
      });
      const inst = new THREE.InstancedMesh(guideGeo, mat, list.length);
      list.forEach((mm, i) => inst.setMatrixAt(i, mm));
      g.add(inst);
    }
    // chevron instanced mesh
    const chevTex = this.makeChevronTexture();
    const chevGeo = new THREE.PlaneGeometry(1.15, 0.6);
    const chevMat = new THREE.MeshBasicMaterial({
      map: chevTex,
      side: THREE.DoubleSide,
    });
    const chev = new THREE.InstancedMesh(chevGeo, chevMat, this.chevronMats.length);
    this.chevronMats.forEach((mm, i) => chev.setMatrixAt(i, mm));
    g.add(chev);
    return g;
  }

  /** yellow curve-warning chevron board */
  private makeChevronTexture(): THREE.CanvasTexture {
    const cv = document.createElement("canvas");
    cv.width = 128;
    cv.height = 64;
    const g = cv.getContext("2d")!;
    g.fillStyle = "#ffd24a";
    g.fillRect(0, 0, 128, 64);
    g.strokeStyle = "#16181d";
    g.lineWidth = 10;
    g.lineCap = "round";
    for (let x = 18; x < 128; x += 30) {
      g.beginPath();
      g.moveTo(x - 10, 10);
      g.lineTo(x + 10, 32);
      g.lineTo(x - 10, 54);
      g.stroke();
    }
    g.strokeStyle = "#16181d";
    g.lineWidth = 4;
    g.strokeRect(2, 2, 124, 60);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private buildPuddles(): THREE.Group {
    const g = new THREE.Group();
    const rng = mulberry32(2024);
    const geo = new THREE.CircleGeometry(1, 20);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1a3a5c,
      roughness: 0.05,
      metalness: 0.9,
      transparent: true,
      opacity: 0.85,
    });
    for (let k = 0; k < 12; k++) {
      // scatter on road segments
      const road = this.layout.roads[Math.floor(rng() * this.layout.roads.length)];
      const segment = Math.floor(rng() * (road.points.length - 1));
      const a = road.points[segment];
      const b = road.points[segment + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length = Math.hypot(dx, dz) || 1;
      const t = rng();
      const off = (rng() - 0.5) * (road.width - 6);
      const x = a.x + dx * t - dz / length * off;
      const z = a.z + dz * t + dx / length * off;
      const r = 2.2 + rng() * 1.8;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, 0.03, z);
      mesh.scale.set(r, r, 1);
      g.add(mesh);
      this.puddleMeshes.push(mesh);
      this.puddles.push({ x, z, r });
    }
    return g;
  }

  private buildRamps(): THREE.Group {
    const g = new THREE.Group();
    const rng = mulberry32(9090);
    // wedge profile: low edge -> high edge, extruded across the width
    const shape = new THREE.Shape();
    shape.moveTo(-3.5, 0);
    shape.lineTo(3.5, 1.5);
    shape.lineTo(3.5, 0);
    shape.lineTo(-3.5, 0);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 6.4,
      bevelEnabled: false,
    });
    geo.rotateY(Math.PI / 2); // slope rises toward local -z (car enters from +z going -z)
    geo.computeBoundingBox();
    if (geo.boundingBox) {
      const cx = (geo.boundingBox.min.x + geo.boundingBox.max.x) / 2;
      const cz = (geo.boundingBox.min.z + geo.boundingBox.max.z) / 2;
      geo.translate(-cx, 0, -cz);
    }
    // hazard stripes
    const cv = document.createElement("canvas");
    cv.width = cv.height = 64;
    const cg = cv.getContext("2d")!;
    cg.fillStyle = "#c86018";
    cg.fillRect(0, 0, 64, 64);
    cg.strokeStyle = "#ffd24a";
    cg.lineWidth = 8;
    for (let i = -64; i < 128; i += 22) {
      cg.beginPath();
      cg.moveTo(i, 64);
      cg.lineTo(i + 64, 0);
      cg.stroke();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 2);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.7,
      emissive: 0x552200,
      emissiveIntensity: 0.25,
    });
    const placed = new Set<string>();
    let guard = 0;
    // traffic keeps right: dir=+1 rides at -LANE, dir=-1 at +LANE; the ramp
    // sits IN a lane and its slope follows that lane's travel direction
    const LANE = ROAD_W / 4;
    while (this.ramps.length < 6 && guard++ < 120) {
      const road = this.layout.roads[Math.floor(rng() * this.layout.roads.length)];
      const segment = Math.floor(rng() * (road.points.length - 1));
      const a = road.points[segment];
      const b = road.points[segment + 1];
      const segX = b.x - a.x;
      const segZ = b.z - a.z;
      const segLength = Math.hypot(segX, segZ) || 1;
      const along = 0.2 + rng() * 0.6;
      const side = rng() < 0.5 ? -1 : 1;
      const x = a.x + segX * along - segZ / segLength * side * LANE;
      const z = a.z + segZ * along + segX / segLength * side * LANE;
      const key = `${road.id},${segment},${Math.round(along * 5)}`;
      if (placed.has(key)) continue;
      placed.add(key);
      const direction = side === -1 ? 1 : -1;
      const dx = segX / segLength * direction;
      const dz = segZ / segLength * direction;
      const rotY = Math.atan2(-dx, -dz);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, 0.02, z);
      mesh.rotation.y = rotY;
      g.add(mesh);
      const extentX = Math.abs(Math.cos(rotY)) * 3.3 + Math.abs(Math.sin(rotY)) * 3.5;
      const extentZ = Math.abs(Math.sin(rotY)) * 3.3 + Math.abs(Math.cos(rotY)) * 3.5;
      this.ramps.push({ x, z, w: extentX * 2, h: extentZ * 2, angle: rotY, dx, dz });
    }
    return g;
  }

  /** one traffic-light head: housing + red/yellow/green lenses (lit one glows) */
  private makeLightHead(axis: "x" | "z"): {
    group: THREE.Group;
    mats: THREE.MeshStandardMaterial[];
  } {
    const group = new THREE.Group();
    const housing = new THREE.Mesh(
      new THREE.BoxGeometry(axis === "x" ? 0.5 : 0.34, 1.7, axis === "x" ? 0.34 : 0.5),
      new THREE.MeshStandardMaterial({ color: 0x2a3242, roughness: 0.7 })
    );
    group.add(housing);
    const lampGeo = new THREE.SphereGeometry(0.22, 12, 10);
    const off = 0.5; // vertical spacing between lamps
    const mats: THREE.MeshStandardMaterial[] = [];
    const colors = [0xff2233, 0xffcc22, 0x22ff66];
    // lenses bulge out of both faces so the head reads from either direction
    const nudge = axis === "x" ? 0.16 : 0; // along the facing axis
    const nudgeZ = axis === "z" ? 0.16 : 0;
    for (let k = 0; k < 3; k++) {
      const mat = new THREE.MeshStandardMaterial({
        color: colors[k],
        emissive: colors[k],
        emissiveIntensity: 0.22, // dim lens when off
        roughness: 0.35,
      });
      mats.push(mat);
      for (const s of [-1, 1]) {
        const lamp = new THREE.Mesh(lampGeo, mat);
        lamp.position.set(s * nudge, (1 - k) * off, s * nudgeZ);
        group.add(lamp);
      }
    }
    // hoods above each lamp like a real signal head
    const hoodMat = new THREE.MeshStandardMaterial({ color: 0x232a38 });
    for (let k = 0; k < 3; k++) {
      const hood = new THREE.Mesh(
        new THREE.BoxGeometry(
          axis === "x" ? 0.56 : 0.3,
          0.1,
          axis === "x" ? 0.3 : 0.56
        ),
        hoodMat
      );
      hood.position.set(0, (1 - k) * off + 0.24, 0);
      group.add(hood);
    }
    return { group, mats };
  }

  private buildLights(): THREE.Group {
    const g = new THREE.Group();
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x39404f });
    this.layout.signalJunctions.forEach(({ x: cx, z: cz }, index) => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 6.4, 6), poleMat);
      pole.position.set(cx + ROAD_W / 2 + 1.2, 3.2, cz + ROAD_W / 2 + 1.2);
      g.add(pole);
      const headX = this.makeLightHead("x");
      headX.group.position.set(cx + ROAD_W / 2 + 1.2, 6.7, cz + ROAD_W / 2 + 0.4);
      g.add(headX.group);
      const headZ = this.makeLightHead("z");
      headZ.group.position.set(cx + ROAD_W / 2 + 0.4, 6.7, cz + ROAD_W / 2 + 1.2);
      g.add(headZ.group);
      const stop = ROAD_W / 2 + 1.6;
      const stripGeo = new THREE.PlaneGeometry(ROAD_W - 2, 1.5);
      const strips: THREE.MeshBasicMaterial[] = [];
      const stripDefs: [number, number, number][] = [
        [cx + stop, cz, Math.PI / 2], [cx - stop, cz, Math.PI / 2],
        [cx, cz + stop, 0], [cx, cz - stop, 0],
      ];
      for (const [sx, sz, rot] of stripDefs) {
        const sm = new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0, depthWrite: false });
        const strip = new THREE.Mesh(stripGeo, sm);
        strip.rotation.x = -Math.PI / 2;
        strip.rotation.z = rot;
        strip.position.set(sx, 0.04, sz);
        g.add(strip);
        strips.push(sm);
      }
      const light: LightVisual = {
        cx, cz, state: 0,
        timer: (index * 1.7) % ((LIGHT_CYCLE + LIGHT_YELLOW) * 2),
        phaseId: 0, strips, lampsX: headX.mats, lampsZ: headZ.mats,
      };
      this.lights.push(light);
      this.lightGrid.set(`${index}`, light);
    });
    return g;
  }

  private buildMarker(): void {
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0x22ffcc,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 2.2, 40, 16, 1, true),
      beamMat
    );
    beam.position.y = 20;
    this.marker.add(beam);
    this.markerRing = new THREE.Mesh(
      new THREE.RingGeometry(2.2, 3.1, 32),
      new THREE.MeshBasicMaterial({
        color: 0x22ffcc,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this.markerRing.rotation.x = -Math.PI / 2;
    this.markerRing.position.y = 0.06;
    this.marker.add(this.markerRing);
    this.marker.visible = false;
  }
}
