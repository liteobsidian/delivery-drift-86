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
import { CITY_STYLE } from "./city-style";
import { createBuildingGeometry, createCityFacade, TOKYO_TOWER_WIDTH } from "./city-architecture";
import { buildCityLandmarks, palmOffsets, PALM_BASE_RADIUS } from "./city-landmarks";
import { cityBuildingMeshYaw, generateCityBuildingSites, type CityBuildingSite } from "./city-building-layout";
import { BuildingSpatialIndex } from "./building-spatial-index";
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
  collisionRect?: { x: number; z: number; width: number; depth: number; rotation: number; cosRotation?: number; sinRotation?: number };
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
  readonly buildingSites: CityBuildingSite[];
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
  private heroBuildings = new THREE.Group();
  private heroFallbacks: { mesh: THREE.InstancedMesh; index: number }[] = [];
  /** tall buildings that get rooftop billboards */
  private roofSpots: { x: number; z: number; w: number; h: number; d: number }[] =
    [];
  private billboardTex: THREE.Texture[] = [];
  private flickerMats: THREE.MeshBasicMaterial[] = [];
  private chevronMats: THREE.Matrix4[] = [];
  private buildingIndex!: BuildingSpatialIndex;
  private flickerT = 0;
  private marker = new THREE.Group();
  private markerRing!: THREE.Mesh;
  private time = 0;

  constructor(mapId: MapId = "tokyo") {
    this.mapId = mapId;
    this.layout = cityLayoutFor(mapId);
    this.buildingSites = generateCityBuildingSites(this.layout);
    this.group.name = `world-${mapId}`;
    this.group.add(this.buildSky());
    this.group.add(this.buildGround());
    if (this.layout.waterAreas.length) this.group.add(this.buildWater());
    this.group.add(this.buildBuildings());
    this.group.add(this.buildStreetProps());
    if (mapId === "tokyo") {
      this.group.add(this.buildBladeSigns());
      this.group.add(this.buildNeonColumns());
      this.group.add(this.buildBillboards());
      this.group.add(this.buildNeonStrips());
    } else if (mapId === "yokohama") {
      this.group.add(this.buildPortCranes());
    }
    const landmarks = buildCityLandmarks(this.layout.landmarks);
    landmarks.name = `landmarks-${mapId}`;
    this.group.add(landmarks);
    if (mapId === "tokyo") this.group.add(this.buildRoadSigns());
    this.group.add(this.buildPuddles());
    this.group.add(this.buildRamps());
    this.group.add(this.buildLights());
    this.buildMarker();
    this.group.add(this.marker);
    this.buildingIndex = new BuildingSpatialIndex(this.buildings);
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

  /** keep a circle (the car) out of building footprints; returns impact speed or 0 */
  collideBuildings(
    pos: THREE.Vector3,
    radius: number,
    vel: THREE.Vector3
  ): number {
    const candidates = this.buildingIndex.query(pos.x, pos.z, radius);
    let impact = this.buildingIndex.resolve(candidates, pos, radius, vel);
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
    const style = CITY_STYLE[this.mapId];
    const rng = mulberry32(style.seed);
    const sphere = new THREE.SphereGeometry(940, 20, 14);
    const skyColor = new THREE.Color(style.sky);
    const horizon = new THREE.Color(style.horizon);
    const color = new THREE.Color();
    const colors = [];
    const positions = sphere.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const mix = THREE.MathUtils.smoothstep(positions.getY(i) / 940, -0.035, 0.56);
      color.copy(horizon).lerp(skyColor, mix);
      colors.push(color.r, color.g, color.b);
    }
    sphere.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const dome = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({
      side: THREE.BackSide, vertexColors: true, depthWrite: false, fog: false, toneMapped: false,
    }));
    dome.renderOrder = -10;
    g.add(dome);
    if (this.mapId === "sochi") {
      for (const [range, tint] of [[0, 0x8a9a97], [1, 0x5d796d]] as const) {
        const ridge = [];
        for (let i = 0; i < 48; i++) {
          const a = i * Math.PI / 48;
          const b = (i + 1) * Math.PI / 48;
          const r = 630 - range * 120;
          const height = (angle: number) => 12 + Math.sin(angle) * (78 + 23 * Math.sin(angle * 10 + range) + 11 * Math.sin(angle * 23));
          const x1 = r * Math.cos(a), z1 = r * Math.sin(a);
          const x2 = r * Math.cos(b), z2 = r * Math.sin(b);
          ridge.push(x1, -25, z1, x2, -25, z2, x1, height(a), z1, x1, height(a), z1, x2, -25, z2, x2, height(b), z2);
        }
        const geo = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(ridge, 3));
        g.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: tint, fog: false, side: THREE.DoubleSide, toneMapped: false })));
      }
    } else if (this.mapId === "tokyo") {
      const mat = new THREE.MeshBasicMaterial({ color: 0x161c3f, fog: false });
      const geo = new THREE.ConeGeometry(1, 1, 5);
      const inst = new THREE.InstancedMesh(geo, mat, 40);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI * 2 + rng() * 0.1;
        const r = 480 + rng() * 120;
        const h = 70 + rng() * 95;
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
    } else if (this.mapId === "yokohama") {
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
    } else {
      // Low city silhouettes give the historic districts a horizon without repeating Tokyo's peaks.
      const skyline = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ color: this.mapId === "spb" ? 0x625a6a : 0x48474e, fog: false }),
        36,
      );
      const matrix = new THREE.Matrix4();
      for (let i = 0; i < 36; i++) {
        const angle = (i / 36) * Math.PI * 2;
        const radius = 430 + rng() * 70;
        const height = 10 + rng() * (this.mapId === "spb" ? 17 : 29);
        const width = 22 + rng() * 38;
        matrix.compose(
          new THREE.Vector3(Math.cos(angle) * radius, height / 2 - 5, Math.sin(angle) * radius),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle),
          new THREE.Vector3(width, height, width),
        );
        skyline.setMatrixAt(i, matrix);
      }
      g.add(skyline);
    }
    if (this.mapId === "sochi" || this.mapId === "spb") return g;
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
      roughness: this.mapId === "yokohama" ? 0.72 : this.mapId === "sochi" ? 0.82 : 0.92,
      metalness: this.mapId === "yokohama" ? 0.14 : this.mapId === "sochi" ? 0.1 : 0.08,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    return mesh;
  }

  private buildWater(): THREE.Group {
    const group = new THREE.Group();
    const port = this.mapId === "yokohama";
    group.name = port ? "harbor-water" : `water-${this.mapId}`;
    const palette = CITY_STYLE[this.mapId];
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const g = canvas.getContext("2d")!;
    g.fillStyle = palette.water;
    g.fillRect(0, 0, 128, 128);
    const rng = mulberry32(palette.seed + 53);
    for (let i = 0; i < 145; i++) {
      const x = rng() * 128, y = rng() * 128, width = 3 + rng() * 14;
      g.strokeStyle = i % 3 ? "rgba(180,224,230,.22)" : "rgba(14,37,49,.17)";
      g.lineWidth = 0.45 + rng() * 0.7;
      for (const left of x + width > 128 ? [x, x - 128] : [x]) {
        g.beginPath();
        g.moveTo(left, y);
        g.quadraticCurveTo(left + width * 0.5, y - 1.7, left + width, y);
        g.stroke();
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(0.051, 0.073);
    texture.anisotropy = 4;
    const water = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
    if (port) {
      const { minX, maxX, minZ, maxZ } = this.layout.bounds;
      const coastGap = 36;
      const centerX = (minX + maxX) / 2;
      const centerZ = (minZ + maxZ) / 2;
      const strip = (width: number, depth: number, x: number, z: number) => {
        const geometry = new THREE.PlaneGeometry(width, depth);
        const uv = geometry.getAttribute("uv");
        const pos = geometry.getAttribute("position");
        for (let i = 0; i < uv.count; i++) uv.setXY(i, x + pos.getX(i), -z + pos.getY(i));
        const mesh = new THREE.Mesh(geometry, water);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(x, 0.025, z);
        group.add(mesh);
      };
      strip(maxX - minX + coastGap, coastGap, centerX, minZ - coastGap / 2);
      strip(maxX - minX + coastGap, coastGap, centerX, maxZ + coastGap / 2);
      strip(coastGap, maxZ - minZ, minX - coastGap / 2, centerZ);
      strip(coastGap, maxZ - minZ, maxX + coastGap / 2, centerZ);
    }

    const shoreline = new THREE.LineBasicMaterial({ color: palette.shore, transparent: true, opacity: 0.52 });
    for (const area of this.layout.waterAreas) {
      const shape = new THREE.Shape();
      shape.moveTo(area.points[0].x, -area.points[0].z);
      for (const point of area.points.slice(1)) shape.lineTo(point.x, -point.z);
      shape.closePath();
      const surface = new THREE.Mesh(new THREE.ShapeGeometry(shape), water);
      surface.rotation.x = -Math.PI / 2;
      surface.position.y = 0.04;
      surface.name = `water-area-${area.id}`;
      group.add(surface);
      const edge = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(area.points.map(({ x, z }) => new THREE.Vector3(x, 0.075, z))),
        shoreline,
      );
      edge.name = `shoreline-${area.id}`;
      group.add(edge);
    }
    group.userData.interiorWater = this.layout.waterAreas.length;
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

    const theme = CITY_STYLE[this.mapId];
    g.fillStyle = theme.ground;
    g.fillRect(0, 0, S, S);
    if (this.mapId === "sochi") {
      g.fillStyle = "#d0af83";
      g.fillRect(0, v(-160), S, w(15));
    }
    const speckle = mulberry32(theme.seed + 13);
    for (let i = 0; i < 3800; i++) {
      g.fillStyle = speckle() > 0.5 ? "rgba(220,207,165,.13)" : "rgba(21,34,35,.14)";
      const size = 1 + speckle() * 3.5;
      g.fillRect(speckle() * S, speckle() * S, size, size * 0.6);
    }
    for (const area of this.layout.waterAreas) {
      g.beginPath();
      area.points.forEach((point, i) => i === 0 ? g.moveTo(u(point.x), v(point.z)) : g.lineTo(u(point.x), v(point.z)));
      g.closePath();
      g.fillStyle = theme.water;
      g.fill();
      g.strokeStyle = "rgba(133,177,184,.5)";
      g.lineWidth = w(0.7);
      g.stroke();
    }
    for (const parcel of this.layout.parcels) {
      g.save();
      g.translate(u(parcel.x), v(parcel.z));
      g.rotate(parcel.rotation);
      g.fillStyle = parcel.zone === "port" ? "#35434c" : "#30394a";
      g.fillRect(-w(parcel.width / 2), -w(parcel.depth / 2), w(parcel.width), w(parcel.depth));
      g.restore();
    }
    for (const site of this.buildingSites) {
      g.save();
      g.translate(u(site.x), v(site.z));
      g.rotate(site.rotation);
      g.fillStyle = theme.paving;
      g.globalAlpha = 0.29;
      g.fillRect(-w(site.width / 2 + 0.46), -w(site.depth / 2 + 0.46), w(site.width + 0.92), w(site.depth + 0.92));
      g.restore();
    }
    for (const site of this.layout.portSites) {
      if (site.kind === "pier" || site.kind === "cargo-ship" || site.kind === "gantry-crane") continue;
      g.save();
      g.translate(u(site.x), v(site.z));
      g.rotate(site.rotation);
      g.fillStyle = site.kind === "container-yard" ? "#3c4a50" : site.kind === "tank-farm" ? "#454d4c" : "#4a5559";
      g.fillRect(-w(site.width / 2), -w(site.depth / 2), w(site.width), w(site.depth));
      g.strokeStyle = site.kind === "container-yard" ? "rgba(237,181,81,.74)" : "rgba(157,180,178,.48)";
      g.lineWidth = w(0.65);
      g.setLineDash([]);
      g.strokeRect(-w(site.width / 2), -w(site.depth / 2), w(site.width), w(site.depth));
      if (site.kind === "container-yard") {
        g.strokeStyle = "rgba(235,192,103,.55)";
        g.lineWidth = w(0.5);
        g.setLineDash([w(2), w(2)]);
        for (let i = -1; i <= 1; i++) {
          const x = i * site.width * 0.22;
          g.beginPath();
          g.moveTo(w(x), -w(site.depth * 0.4));
          g.lineTo(w(x), w(site.depth * 0.4));
          g.stroke();
        }
      }
      g.restore();
    }

    g.lineCap = "round";
    g.lineJoin = "round";
    const strokeRoads = (color: string, width: (road: number) => number) => {
      g.strokeStyle = color;
      for (const road of this.layout.roads) {
        g.beginPath();
        road.points.forEach((p, i) => i === 0 ? g.moveTo(u(p.x), v(p.z)) : g.lineTo(u(p.x), v(p.z)));
        g.lineWidth = w(width(road.width));
        g.stroke();
      }
    };
    strokeRoads(theme.paving, (width) => width + (this.mapId === "spb" ? 4.2 : 2.6));
    strokeRoads(theme.asphalt, (width) => width);
    g.globalAlpha = this.mapId === "tokyo" ? 0.60 : 0.79;
    g.setLineDash([w(this.mapId === "yokohama" ? 5 : 3.1), w(4.8)]);
    strokeRoads(theme.lane, () => this.mapId === "yokohama" ? 0.34 : 0.27);
    g.setLineDash([]);
    g.globalAlpha = 1;
    if (theme.line === "edge") {
      g.strokeStyle = theme.lane;
      g.lineWidth = w(0.22);
      for (const road of this.layout.roads) for (const side of [-1, 1]) {
        g.beginPath();
        road.points.forEach((point, index, points) => {
          const a = points[Math.max(0, index - 1)], b = points[Math.min(points.length - 1, index + 1)];
          const dx = b.x - a.x, dz = b.z - a.z;
          const offset = side * (road.width / 2 - 0.65) / (Math.hypot(dx, dz) || 1);
          const x = u(point.x - dz * offset), z = v(point.z + dx * offset);
          if (index) g.lineTo(x, z);
          else g.moveTo(x, z);
        });
        g.stroke();
      }
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
    const rng = mulberry32(CITY_STYLE[this.mapId].seed);
    for (let n = 0; n < 2300; n++) {
      const road = this.layout.roads[Math.floor(rng() * this.layout.roads.length)];
      const segment = Math.floor(rng() * (road.points.length - 1));
      const a = road.points[segment];
      const b = road.points[segment + 1];
      const t = rng();
      const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const lateral = (rng() - 0.5) * Math.max(0, road.width - 2);
      const px = a.x + (b.x - a.x) * t - (b.z - a.z) / length * lateral;
      const pz = a.z + (b.z - a.z) * t + (b.x - a.x) / length * lateral;
      g.fillStyle = rng() < 0.5 ? "rgba(16,19,26,.22)" : "rgba(166,158,143,.22)";
      const size = 0.15 + rng() * 0.68;
      g.fillRect(u(px - size / 2), v(pz - size / 2), w(size), w(size));
    }

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  private buildBuildings(): THREE.Group {
    const g = new THREE.Group();
    g.name = "city-buildings";
    const rng = mulberry32(CITY_STYLE[this.mapId].seed + 1);
    const material = createCityFacade(this.mapId);
    const placements = this.buildingSites.map((site) => ({
      x: site.x,
      z: site.z,
      w: site.width,
      h: site.height,
      d: site.depth,
      rotation: site.rotation,
      variant: site.variant,
    }));
    for (const site of this.buildingSites) this.addBuildingCollider(site.x, site.z, site.width, site.depth, site.rotation);
    for (const site of this.layout.landmarks) {
      if (site.kind === "bridge") continue;
      if (site.kind === "palm-row") {
        for (const offset of palmOffsets(site.width)) {
          this.addBuildingCollider(site.x + offset * Math.cos(site.rotation), site.z + offset * Math.sin(site.rotation),
            PALM_BASE_RADIUS * 2, PALM_BASE_RADIUS * 2, site.rotation);
        }
      } else this.addBuildingCollider(site.x, site.z, site.width, site.depth, site.rotation);
    }
    const batches: [(typeof placements)[number][], (typeof placements)[number][]] = [[], []];
    for (const [index, p] of placements.entries()) {
      if (this.mapId === "tokyo" && this.heroSpots.length < 8 && index % 73 === 2) {
        this.heroSpots.push(p);
        this.heroAABBs.push(this.buildings[index]);
      }
      // Retain the procedural body until the optional Tokyo GLB is available.
      batches[p.variant].push(p);
      if (this.mapId === "tokyo" && p.h > 31) this.roofSpots.push(p);
    }
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const color = new THREE.Color();
    for (const variant of [0, 1] as const) {
      const sites = batches[variant];
      if (!sites.length) continue;
      const mesh = new THREE.InstancedMesh(createBuildingGeometry(this.mapId, variant), material, sites.length);
      mesh.name = `architecture-${this.mapId}-${variant}`;
      for (const [index, site] of sites.entries()) {
        rotation.setFromAxisAngle(up, cityBuildingMeshYaw(site.rotation));
        matrix.compose(pos.set(site.x, 0, site.z), rotation, scale.set(site.w, site.h, site.d));
        mesh.setMatrixAt(index, matrix);
        const tone = rng();
        if (this.mapId === "spb") color.setHex([0xfffff2, 0xe3d3c8, 0xf4dfcc, 0xe7ece5][Math.floor(tone * 4)]);
        else if (this.mapId === "kazan") color.setHex([0xffffee, 0xf3dfbc, 0xc8e4cd, 0xddbbaa][Math.floor(tone * 4)]);
        else if (this.mapId === "sochi") color.setHex([0xfff3dd, 0xffdfa7, 0xffffff, 0xd7e7dc][Math.floor(tone * 4)]);
        else color.setScalar(0.82 + tone * 0.18);
        mesh.setColorAt(index, color);
        if (this.heroSpots.includes(site)) this.heroFallbacks.push({ mesh, index });
      }
      g.add(mesh);
    }
    if (this.mapId === "yokohama") g.add(this.buildPortBuildings());
    return g;
  }

  private addBuildingCollider(x: number, z: number, width: number, depth: number, rotation: number): void {
    const c = Math.cos(rotation), s = Math.sin(rotation);
    const ex = Math.abs(c) * width / 2 + Math.abs(s) * depth / 2;
    const ez = Math.abs(s) * width / 2 + Math.abs(c) * depth / 2;
    this.buildings.push({
      minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez,
      collisionRect: { x, z, width, depth, rotation, cosRotation: c, sinRotation: s },
    });
  }

  private buildPortBuildings(): THREE.Group {
    const group = new THREE.Group();
    group.name = "port-warehouses-and-containers";
    const stats = { warehouses: 0, containerStacks: 0, containerInstances: 0, piers: 0, cargoShips: 0, tankFarms: 0 };
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const cranePaint = new THREE.MeshStandardMaterial({ color: 0xd7ded7, roughness: 0.82, metalness: 0.16, map: this.makeWarehouseTexture() });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x48555a, roughness: 0.76, metalness: 0.28 });
    const gable = new THREE.Shape();
    gable.moveTo(-0.5, 0);
    gable.lineTo(0.5, 0);
    gable.lineTo(0.5, 0.14);
    gable.lineTo(0, 1);
    gable.lineTo(-0.5, 0.14);
    gable.closePath();
    const warehouseRoof = new THREE.ExtrudeGeometry(gable, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5);
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x17252a, emissive: 0x10232a, emissiveIntensity: 0.55, roughness: 0.65 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0xd6ab57, emissive: 0x593b0e, emissiveIntensity: 0.35, roughness: 0.58, metalness: 0.28 });
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x64757a, roughness: 0.42, metalness: 0.72 });
    const tankMat = new THREE.MeshStandardMaterial({ color: 0x71838a, roughness: 0.34, metalness: 0.66, emissive: 0x0b1a20 });
    const tankBandMat = new THREE.MeshStandardMaterial({ color: 0xe0a94b, emissive: 0x422907, emissiveIntensity: 0.45, metalness: 0.34 });
    const containerMat = new THREE.MeshStandardMaterial({ map: this.makeContainerTexture(), color: 0xffffff, roughness: 0.72, metalness: 0.28 });
    const containerPaint = [0xc74c3e, 0x2297a5, 0xd39632, 0x5c75a1, 0x71834c, 0xb8b9aa];
    const tint = new THREE.Color();
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const addBox = (parent: THREE.Group, material: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number) => {
      const mesh = new THREE.Mesh(unitBox, material);
      mesh.position.set(x, y, z);
      mesh.scale.set(w, h, d);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const addSite = (site: (typeof this.layout.portSites)[number], name: string) => {
      const siteGroup = new THREE.Group();
      siteGroup.name = `${name}-${site.id}`;
      siteGroup.position.set(site.x, 0, site.z);
      siteGroup.rotation.y = -site.rotation;
      siteGroup.userData.siteId = site.id;
      group.add(siteGroup);
      return siteGroup;
    };
    const addBuildingBounds = (site: (typeof this.layout.portSites)[number], x: number, z: number, w: number, d: number) => {
      const c = Math.cos(site.rotation);
      const s = Math.sin(site.rotation);
      const worldX = site.x + x * c - z * s;
      const worldZ = site.z + x * s + z * c;
      const ex = Math.abs(c) * w / 2 + Math.abs(s) * d / 2;
      const ez = Math.abs(s) * w / 2 + Math.abs(c) * d / 2;
      this.buildings.push({ minX: worldX - ex, maxX: worldX + ex, minZ: worldZ - ez, maxZ: worldZ + ez });
    };

    for (const [siteIndex, site] of this.layout.portSites.entries()) {
      if (site.kind === "warehouse") {
        const place = addSite(site, "warehouse");
        const width = site.width * 0.9;
        const depth = site.depth * 0.82;
        const height = 11;
        addBox(place, cranePaint, 0, height / 2, 0, width, height, depth);
        const roof = new THREE.Mesh(warehouseRoof, roofMat);
        roof.position.y = height;
        roof.scale.set(width + 1.8, 3.05, depth + 1.4);
        place.add(roof);
        addBox(place, steelMat, 0, height - 0.3, -depth * 0.32, width * 0.82, 0.32, 0.48);
        for (const x of [-0.28, 0, 0.28]) {
          const doorX = x * width;
          const faceZ = depth / 2 + 0.08;
          addBox(place, doorMat, doorX, 3.05, faceZ, 4.5, 5.5, 0.16);
          for (const side of [-1, 1]) addBox(place, trimMat, doorX + side * 2.4, 3.05, faceZ + 0.12, 0.18, 6, 0.16);
          addBox(place, trimMat, doorX, 6.05, faceZ + 0.12, 4.9, 0.2, 0.16);
          addBox(place, trimMat, doorX, 6.55, faceZ + 0.26, 0.8, 0.12, 0.22);
        }
        for (const x of [-width * 0.36, width * 0.36]) {
          addBox(place, roofMat, x, height + 1.5, -depth * 0.18, 2.4, 1.4, 2.6);
          const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffbd55 }));
          beacon.position.set(x, height + 2.35, depth * 0.2);
          place.add(beacon);
        }
        addBuildingBounds(site, 0, 0, width, depth);
        stats.warehouses++;
        continue;
      }

      if (site.kind === "container-yard") {
        const place = addSite(site, "container-yard");
        const containerW = 9.2;
        const containerD = 3.2;
        const containerH = 2.8;
        const cols = Math.max(2, Math.floor((site.width - 2) / 9.5));
        const rows = Math.max(2, Math.floor((site.depth - 2) / 4.2));
        const positions: { x: number; z: number; level: number; color: number }[] = [];
        for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
          const x = (col - (cols - 1) / 2) * ((site.width - 3) / cols);
          const z = (row - (rows - 1) / 2) * ((site.depth - 2) / rows);
          const levels = (row + col + siteIndex) % 3 === 0 ? 2 : 1;
          for (let level = 0; level < levels; level++) {
            positions.push({ x, z, level, color: containerPaint[(row * cols + col + siteIndex) % containerPaint.length] });
          }
          addBuildingBounds(site, x, z, containerW, containerD);
        }
        const instanced = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), containerMat, positions.length);
        positions.forEach((item, i) => {
          matrix.compose(new THREE.Vector3(item.x, item.level * containerH + containerH / 2, item.z), rotation.identity(), new THREE.Vector3(containerW, containerH, containerD));
          instanced.setMatrixAt(i, matrix);
          tint.setHex(item.color);
          instanced.setColorAt(i, tint);
        });
        instanced.castShadow = true;
        instanced.receiveShadow = true;
        place.add(instanced);
        stats.containerStacks++;
        stats.containerInstances += positions.length;
        continue;
      }

      if (site.kind === "tank-farm") {
        const place = addSite(site, "fuel-tank-farm");
        const radius = 3.1;
        const height = 8.8;
        const tank = new THREE.CylinderGeometry(radius, radius, height, 20);
        const lid = new THREE.CylinderGeometry(radius, radius, 0.48, 20);
        const band = new THREE.TorusGeometry(radius + 0.04, 0.16, 6, 20);
        for (const x of [-7, 0, 7]) {
          const body = new THREE.Mesh(tank, tankMat);
          body.position.set(x, height / 2, 0);
          body.castShadow = true;
          place.add(body);
          const top = new THREE.Mesh(lid, steelMat);
          top.position.set(x, height + 0.18, 0);
          place.add(top);
          const stripe = new THREE.Mesh(band, tankBandMat);
          stripe.rotation.x = Math.PI / 2;
          stripe.position.set(x, 2.2, 0);
          place.add(stripe);
          addBox(place, steelMat, x + 1.1, height + 0.9, -0.9, 0.45, 1.8, 0.45);
          addBuildingBounds(site, x, 0, radius * 2, radius * 2);
        }
        stats.tankFarms++;
        continue;
      }

      if (site.kind === "pier") {
        const place = addSite(site, "cargo-pier");
        const deckMat = new THREE.MeshStandardMaterial({ color: 0x59676b, roughness: 0.88, metalness: 0.12 });
        addBox(place, deckMat, 0, 0.18, 0, site.width, 0.85, site.depth);
        const pylonGeo = new THREE.CylinderGeometry(0.5, 0.7, 5.8, 8);
        const pylons = Math.max(3, Math.floor(site.depth / 12));
        for (let i = 0; i <= pylons; i++) {
          const z = -site.depth / 2 + 2 + (site.depth - 4) * i / pylons;
          for (const x of [-site.width * 0.38, site.width * 0.38]) {
            const pylon = new THREE.Mesh(pylonGeo, steelMat);
            pylon.position.set(x, -2.5, z);
            place.add(pylon);
          }
          if (i === 0 || i === pylons) {
            for (const side of [-1, 1]) {
              const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 0.9, 8), trimMat);
              bollard.position.set(side * (site.width * 0.38), 0.95, z);
              place.add(bollard);
            }
          }
        }
        for (const x of [-site.width / 2 + 0.5, site.width / 2 - 0.5]) {
          addBox(place, trimMat, x, 0.72, 0, 0.24, 0.14, site.depth * 0.92);
        }
        stats.piers++;
        continue;
      }

      if (site.kind === "cargo-ship") {
        const place = addSite(site, "cargo-ship");
        const hullShape = new THREE.Shape();
        hullShape.moveTo(-site.width * 0.48, -site.depth * 0.42);
        hullShape.lineTo(site.width * 0.3, -site.depth * 0.42);
        hullShape.lineTo(site.width * 0.5, 0);
        hullShape.lineTo(site.width * 0.3, site.depth * 0.42);
        hullShape.lineTo(-site.width * 0.48, site.depth * 0.42);
        hullShape.closePath();
        const hullGeo = new THREE.ExtrudeGeometry(hullShape, { depth: 2.6, bevelEnabled: true, bevelSegments: 1, bevelSize: 0.35, bevelThickness: 0.24 });
        hullGeo.rotateX(-Math.PI / 2);
        const hull = new THREE.Mesh(hullGeo, new THREE.MeshStandardMaterial({ color: 0x273c4d, roughness: 0.42, metalness: 0.54 }));
        hull.position.y = -1.2;
        hull.castShadow = true;
        place.add(hull);
        addBox(place, roofMat, -site.width * 0.05, 1.55, 0, site.width * 0.74, 0.5, site.depth * 0.64);
        const shipContainerGeo = new THREE.BoxGeometry(1, 1, 1);
        const shipContainerMat = new THREE.MeshStandardMaterial({ color: 0xc44d3b, roughness: 0.72, metalness: 0.32, map: this.makeContainerTexture() });
        for (const x of [-site.width * 0.2, 0, site.width * 0.2]) for (const z of [-site.depth * 0.17, site.depth * 0.17]) {
          const cargo = new THREE.Mesh(shipContainerGeo, shipContainerMat);
          cargo.position.set(x, 3.25, z);
          cargo.scale.set(site.width * 0.17, 3, site.depth * 0.27);
          cargo.castShadow = true;
          place.add(cargo);
        }
        addBox(place, cranePaint, -site.width * 0.28, 4.4, 0, site.width * 0.16, 5.5, site.depth * 0.72);
        addBox(place, doorMat, -site.width * 0.195, 4.5, site.depth * 0.37, 0.18, 3.7, site.depth * 0.32);
        addBox(place, steelMat, -site.width * 0.31, 7.4, 0, 0.7, 1.1, 0.7);
        for (const [x, color] of [[-site.width * 0.38, 0xff433d], [site.width * 0.42, 0x55ffb7]] as const) {
          const light = new THREE.Mesh(new THREE.SphereGeometry(0.48, 8, 6), new THREE.MeshBasicMaterial({ color }));
          light.position.set(x, 4.8, 0);
          place.add(light);
        }
        stats.cargoShips++;
      }
    }
    group.userData.portStats = stats;
    return group;
  }

  private buildPortCranes(): THREE.Group {
    const group = new THREE.Group();
    group.name = "port-gantry-cranes";
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xffa63d, emissive: 0x75340b, emissiveIntensity: 0.36, roughness: 0.54, metalness: 0.38 });
    const braceMat = new THREE.MeshStandardMaterial({ color: 0x29363a, roughness: 0.52, metalness: 0.46 });
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xffcc68 });
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    let craneCount = 0;
    for (const site of this.layout.portSites.filter(({ kind }) => kind === "gantry-crane")) {
      const crane = new THREE.Group();
      crane.name = `gantry-crane-${site.id}`;
      crane.position.set(site.x, 0, site.z);
      crane.rotation.y = -site.rotation;
      crane.userData.siteId = site.id;
      group.add(crane);
      const w = site.width;
      const d = site.depth;
      const h = 16;
      const addBeam = (x: number, y: number, z: number, width: number, height: number, depth: number, material: THREE.Material = frameMat, zRotation = 0) => {
        const mesh = new THREE.Mesh(unitBox, material);
        mesh.position.set(x, y, z);
        mesh.scale.set(width, height, depth);
        mesh.rotation.z = zRotation;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        crane.add(mesh);
        return mesh;
      };
      for (const x of [-w * 0.42, w * 0.42]) for (const z of [-d * 0.38, d * 0.38]) {
        addBeam(x, h / 2, z, 1.25, h, 1.1);
        addBeam(x, 1.1, z, 2.2, 0.7, 2.0, braceMat);
        const worldX = site.x + x * Math.cos(site.rotation) - z * Math.sin(site.rotation);
        const worldZ = site.z + x * Math.sin(site.rotation) + z * Math.cos(site.rotation);
        this.buildings.push({ minX: worldX - 0.8, maxX: worldX + 0.8, minZ: worldZ - 0.8, maxZ: worldZ + 0.8 });
      }
      for (const z of [-d * 0.38, d * 0.38]) {
        addBeam(0, h, z, w + 3.2, 1.4, 1.5);
        addBeam(0, h - 1.25, z, w + 3.2, 0.42, 2.1, braceMat);
        addBeam(0, h - 0.58, z + Math.sign(z) * 0.8, w * 0.72, 0.16, 0.12, lightMat);
      }
      for (const x of [-w * 0.42, w * 0.42]) addBeam(x, h - 0.15, 0, 1.3, 1.4, d * 0.9);
      addBeam(0, h - 2.1, 0, 6.6, 1.2, 5.8, braceMat);
      addBeam(0, h - 2.85, 0, 4.7, 0.55, 4.2, frameMat);
      for (const x of [-1.35, 1.35]) addBeam(x, h - 6.8, 0, 0.2, 10, 0.2, braceMat);
      addBeam(0, h - 11.6, 0, 8, 0.45, 3.2, frameMat);
      for (const [x, color] of [[-w * 0.42, 0xff463c], [w * 0.42, 0x52ffbd]] as const) {
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), new THREE.MeshBasicMaterial({ color }));
        lamp.position.set(x, h + 1.15, 0);
        crane.add(lamp);
      }
      craneCount++;
    }
    group.userData.gantryCranes = craneCount;
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
    this.heroBuildings.clear();
    if (!this.heroSpots.length) return;
    const hidden = new THREE.Matrix4().makeScale(1e-4, 1e-4, 1e-4).setPosition(0, -20, 0);
    for (const { mesh, index } of this.heroFallbacks) {
      mesh.setMatrixAt(index, hidden);
      mesh.instanceMatrix.needsUpdate = true;
    }
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
      this.heroBuildings.add(clone);
    }
    this.group.add(this.heroBuildings);
  }

  dispose(): void {
    // The model library owns the resources shared by these clones.
    this.heroBuildings.removeFromParent();
    this.heroBuildings.clear();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    this.group.traverse((node) => {
      if (node instanceof THREE.InstancedMesh) node.dispose();
      const mesh = node as THREE.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      if (!mesh.material) return;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        materials.add(material);
      }
    });
    for (const material of materials) {
      for (const property of Object.values(material)) {
        if (property instanceof THREE.Texture) textures.add(property);
      }
      material.dispose();
    }
    for (const texture of textures) texture.dispose();
    for (const geometry of geometries) geometry.dispose();
    this.group.clear();
  }

  heroCount(): number {
    return this.heroSpots.length;
  }

  buildingCount(): number {
    return this.buildingSites.length;
  }

  private buildStreetProps(): THREE.Group {
    const g = new THREE.Group();
    const rng = mulberry32(31337);
    // Lamp poles and emissive fixtures share two instanced batches.
    const height = this.mapId === "spb" ? 4.6 : this.mapId === "sochi" ? 5.3 : 6.5;
    const poleGeo = new THREE.CylinderGeometry(0.10, this.mapId === "spb" ? 0.25 : 0.17, height, 6);
    const poleMat = new THREE.MeshStandardMaterial({ color: this.mapId === "sochi" ? 0xa8a8a0 : 0x353b40 });
    const tipGeo = this.mapId === "tokyo" ? new THREE.SphereGeometry(0.42, 8, 6)
      : new THREE.CylinderGeometry(0.19, 0.33, 0.61, this.mapId === "spb" ? 4 : 6);
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
        positions.push(new THREE.Vector3(x, height, z));
      }
    }
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, positions.length);
    const tips = new THREE.InstancedMesh(tipGeo, tipMat, positions.length);
    const m = new THREE.Matrix4();
    positions.forEach((p, i) => {
      m.makeTranslation(p.x, height / 2, p.z);
      poles.setMatrixAt(i, m);
      m.makeTranslation(p.x, p.y, p.z);
      tips.setMatrixAt(i, m);
    });
    g.add(poles, tips);

    if (this.mapId === "tokyo") {
      // Neon signs belong to the downtown skyline, not the cargo terminal.
      const signTex = this.makeNeonTexture();
      for (let k = 0; k < 22; k++) {
        const b = this.buildings[Math.floor(rng() * this.buildingSites.length)];
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
    for (let index = 0; index < this.buildingSites.length; index++) {
      const b = this.buildings[index];
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
    for (let index = 0; index < this.buildingSites.length; index++) {
      const b = this.buildings[index];
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
    const position = new THREE.Vector3(), size = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (const [index, site] of this.buildingSites.entries()) {
      if (this.heroAABBs.includes(this.buildings[index]) || rng() < 0.73) continue;
      q.setFromAxisAngle(up, cityBuildingMeshYaw(site.rotation));
      const width = site.width * TOKYO_TOWER_WIDTH[site.variant];
      const depth = site.depth * TOKYO_TOWER_WIDTH[site.variant];
      const color = World.NEON[Math.floor(rng() * World.NEON.length)];
      const side = rng() < 0.5 ? -1 : 1;
      const append = (x: number, y: number, z: number, w: number, h: number, d: number) => {
        position.set(x, y, z).applyQuaternion(q);
        position.x += site.x;
        position.z += site.z;
        m.compose(position, q, size.set(w, h, d));
        mats.push({ m: m.clone(), c: color });
      };
      for (const sign of [-1, 1]) append(sign * width / 2, site.height * 0.535, side * depth / 2, 0.12, site.height * 0.67, 0.12);
      append(0, site.height * 0.87, side * depth / 2, width, 0.12, 0.12);
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
    this.marker.name = "destination-marker";
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
