import * as THREE from "three";
import {
  CELL,
  ROAD_W,
  GRID_N,
  WORLD_HALF,
  LIGHT_CYCLE,
  LIGHT_YELLOW,
} from "./config";

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
}

export interface LightVisual {
  cx: number; // intersection center
  cz: number;
  state: number; // 0: x-axis green, 1: x-axis red
  timer: number;
  phaseId: number;
  matX: THREE.MeshStandardMaterial;
  matZ: THREE.MeshStandardMaterial;
}

const GS = WORLD_HALF * 2 + ROAD_W * 2 + 60; // ground plane size

export class World {
  readonly group = new THREE.Group();
  readonly buildings: AABB[] = [];
  readonly puddles: Puddle[] = [];
  readonly cobbles: Cobble[] = [];
  readonly ramps: Ramp[] = [];
  readonly lights: LightVisual[] = [];
  readonly lightGrid = new Map<string, LightVisual>(); // "i,j" -> light (enforced only)

  private puddleMeshes: THREE.Mesh[] = [];
  private marker = new THREE.Group();
  private markerRing!: THREE.Mesh;
  private time = 0;

  constructor() {
    this.group.add(this.buildSky());
    this.group.add(this.buildGround());
    this.group.add(this.buildBuildings());
    this.group.add(this.buildStreetProps());
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
    return this.nearestRoadDist(x, z) <= ROAD_W / 2;
  }

  nearestRoadDist(x: number, z: number): number {
    const dx = this.distToLine(x);
    const dz = this.distToLine(z);
    return Math.min(dx, dz);
  }

  private distToLine(v: number): number {
    const k = Math.round((v + WORLD_HALF) / CELL);
    const c = -WORLD_HALF + Math.max(0, Math.min(GRID_N - 1, k)) * CELL;
    return Math.abs(v - c);
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
    const B = WORLD_HALF + ROAD_W / 2 + 4;
    if (Math.abs(pos.x) > B) {
      impact = Math.max(impact, Math.abs(vel.x));
      pos.x = Math.sign(pos.x) * B;
      vel.x *= -0.3;
    }
    if (Math.abs(pos.z) > B) {
      impact = Math.max(impact, Math.abs(vel.z));
      pos.z = Math.sign(pos.z) * B;
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
      // materials: 0 green, 1 yellow, 2 red
      const xColor = xGreen ? 0x22ff66 : xYellow ? 0xffcc22 : 0xff2233;
      const zColor = zPhase
        ? t < LIGHT_CYCLE * 2 + LIGHT_YELLOW
          ? 0x22ff66
          : 0xffcc22
        : 0xff2233;
      l.matX.emissive.setHex(xColor);
      l.matX.emissiveIntensity = 2.2;
      l.matZ.emissive.setHex(zColor);
      l.matZ.emissiveIntensity = 2.2;
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
  }

  // ---------- builders ----------

  private buildSky(): THREE.Group {
    const g = new THREE.Group();
    // mountain silhouette ring (Initial D vibe)
    const rng = mulberry32(1337);
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
      roughness: 0.92,
      metalness: 0.08,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    return mesh;
  }

  private makeGroundTexture(): THREE.CanvasTexture {
    const S = 2048;
    const cv = document.createElement("canvas");
    cv.width = cv.height = S;
    const g = cv.getContext("2d")!;
    const u = (v: number) => ((v + GS / 2) / GS) * S;
    const w = (v: number) => (v / GS) * S;

    // base sidewalk tone
    g.fillStyle = "#2b3140";
    g.fillRect(0, 0, S, S);

    // block pads slightly darker
    g.fillStyle = "#232936";
    const inner = CELL - ROAD_W;
    for (let i = 0; i < GRID_N - 1; i++) {
      for (let j = 0; j < GRID_N - 1; j++) {
        const bx = -WORLD_HALF + CELL * i + ROAD_W / 2;
        const bz = -WORLD_HALF + CELL * j + ROAD_W / 2;
        g.fillRect(u(bx), u(bz), w(inner), w(inner));
      }
    }

    // roads
    g.fillStyle = "#3a4050";
    const span = WORLD_HALF * 2 + ROAD_W;
    for (let i = 0; i < GRID_N; i++) {
      const c = -WORLD_HALF + i * CELL;
      g.fillRect(u(c - ROAD_W / 2), u(-WORLD_HALF - ROAD_W / 2), w(ROAD_W), w(span));
      g.fillRect(u(-WORLD_HALF - ROAD_W / 2), u(c - ROAD_W / 2), w(span), w(ROAD_W));
    }

    // road edge lines
    g.strokeStyle = "#4a5162";
    g.lineWidth = w(0.35);
    for (let i = 0; i < GRID_N; i++) {
      const c = -WORLD_HALF + i * CELL;
      for (const s of [-1, 1]) {
        const e = c + (s * ROAD_W) / 2;
        g.beginPath();
        g.moveTo(u(e), u(-WORLD_HALF - ROAD_W / 2));
        g.lineTo(u(e), u(WORLD_HALF + ROAD_W / 2));
        g.stroke();
        g.beginPath();
        g.moveTo(u(-WORLD_HALF - ROAD_W / 2), u(e));
        g.lineTo(u(WORLD_HALF + ROAD_W / 2), u(e));
        g.stroke();
      }
    }

    // center dashes
    g.strokeStyle = "#8b93a6";
    g.lineWidth = w(0.45);
    g.setLineDash([w(3), w(4)]);
    for (let i = 0; i < GRID_N; i++) {
      const c = -WORLD_HALF + i * CELL;
      g.beginPath();
      g.moveTo(u(c), u(-WORLD_HALF - ROAD_W / 2));
      g.lineTo(u(c), u(WORLD_HALF + ROAD_W / 2));
      g.stroke();
      g.beginPath();
      g.moveTo(u(-WORLD_HALF - ROAD_W / 2), u(c));
      g.lineTo(u(WORLD_HALF + ROAD_W / 2), u(c));
      g.stroke();
    }
    g.setLineDash([]);

    // enforced intersections: crosswalk + stop lines
    const stop = ROAD_W / 2 + 1.6;
    g.fillStyle = "#9aa2b5";
    for (let i = 0; i < GRID_N; i += 2) {
      for (let j = 0; j < GRID_N; j += 2) {
        const cx = -WORLD_HALF + i * CELL;
        const cz = -WORLD_HALF + j * CELL;
        // crosswalk stripes
        for (let k = -3; k <= 3; k++) {
          g.fillRect(u(cx + k * 1.7 - 0.6), u(cz - ROAD_W / 2 - 0.4), w(1.2), w(0.8));
          g.fillRect(u(cx + k * 1.7 - 0.6), u(cz + ROAD_W / 2 - 0.4), w(1.2), w(0.8));
          g.fillRect(u(cx - ROAD_W / 2 - 0.4), u(cz + k * 1.7 - 0.6), w(0.8), w(1.2));
          g.fillRect(u(cx + ROAD_W / 2 - 0.4), u(cz + k * 1.7 - 0.6), w(0.8), w(1.2));
        }
        // stop lines on all four entries
        g.fillRect(u(cx - stop - 0.5), u(cz - ROAD_W / 2 + 1), w(1), w(ROAD_W - 2));
        g.fillRect(u(cx + stop - 0.5), u(cz - ROAD_W / 2 + 1), w(1), w(ROAD_W - 2));
        g.fillRect(u(cx - ROAD_W / 2 + 1), u(cz - stop - 0.5), w(ROAD_W - 2), w(1));
        g.fillRect(u(cx - ROAD_W / 2 + 1), u(cz + stop - 0.5), w(ROAD_W - 2), w(1));
      }
    }

    // cobblestone patches
    const rng = mulberry32(4242);
    g.fillStyle = "#4a3f38";
    for (let i = 0; i < GRID_N; i++) {
      for (let j = 0; j < GRID_N - 1; j++) {
        if ((i * 3 + j) % 4 !== 1) continue;
        const vertical = (i + j) % 2 === 0;
        const c = -WORLD_HALF + i * CELL;
        const mid = -WORLD_HALF + CELL * (j + 0.5);
        const len = CELL * 0.62;
        const cw = ROAD_W - 1.6;
        const x = vertical ? c - cw / 2 : mid - len / 2;
        const z = vertical ? mid - len / 2 : c - cw / 2;
        const pw = vertical ? cw : len;
        const ph = vertical ? len : cw;
        this.cobbles.push({ x, z, w: pw, h: ph });
        g.fillRect(u(x), u(z), w(pw), w(ph));
      }
    }
    // cobble noise dots
    g.fillStyle = "#5a4c42";
    for (const c of this.cobbles) {
      const dots = 90;
      for (let k = 0; k < dots; k++) {
        const px = c.x + (rng() - 0.5) * c.w;
        const pz = c.z + (rng() - 0.5) * c.h;
        g.fillRect(u(px), u(pz), w(0.5), w(0.5));
      }
    }

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  private buildBuildings(): THREE.Group {
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
    }[] = [];
    const inner = CELL - ROAD_W;
    for (let i = 0; i < GRID_N - 1; i++) {
      for (let j = 0; j < GRID_N - 1; j++) {
        const bx = -WORLD_HALF + CELL * i + ROAD_W / 2;
        const bz = -WORLD_HALF + CELL * j + ROAD_W / 2;
        const n = 1 + Math.floor(rng() * 2);
        for (let b = 0; b < n; b++) {
          const w = inner * (n === 1 ? 0.82 : 0.42);
          const d = inner * (0.6 + rng() * 0.2);
          const h = 14 + rng() * 46;
          const x =
            n === 1
              ? bx + inner / 2 + (rng() - 0.5) * 4
              : bx + inner * (0.26 + 0.5 * b) + (rng() - 0.5) * 3;
          const z = bz + inner / 2 + (rng() - 0.5) * 4;
          placements.push({ x, z, w, d, h });
          this.buildings.push({
            minX: x - w / 2,
            maxX: x + w / 2,
            minZ: z - d / 2,
            maxZ: z + d / 2,
          });
        }
      }
    }
    const inst = new THREE.InstancedMesh(geo, mat, placements.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    placements.forEach((p, i) => {
      q.identity();
      m.compose(
        new THREE.Vector3(p.x, 0, p.z),
        q,
        new THREE.Vector3(p.w, p.h, p.d)
      );
      inst.setMatrixAt(i, m);
      const shade = 0.85 + rng() * 0.35;
      col.setRGB(shade, shade, shade * 1.08);
      inst.setColorAt(i, col);
    });
    inst.castShadow = false;
    inst.receiveShadow = false;
    g.add(inst);
    return g;
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
    for (let i = 0; i < GRID_N; i++) {
      for (let j = 0; j < GRID_N - 1; j++) {
        if (rng() < 0.4) continue;
        const c = -WORLD_HALF + i * CELL;
        const mid = -WORLD_HALF + CELL * (j + 0.5);
        positions.push(new THREE.Vector3(c + ROAD_W / 2 + 0.8, 7, mid));
        if (rng() < 0.5)
          positions.push(new THREE.Vector3(mid, 7, c - ROAD_W / 2 - 0.8));
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

    // neon signs on building faces
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
      const i = Math.floor(rng() * GRID_N);
      const vertical = rng() < 0.5;
      const c = -WORLD_HALF + i * CELL;
      const along = (rng() - 0.5) * (CELL * (GRID_N - 2));
      const off = (rng() - 0.5) * (ROAD_W - 6);
      const x = vertical ? c + off : along;
      const z = vertical ? along : c + off;
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
    geo.rotateY(-Math.PI / 2); // slope rises toward local -z (car enters from +z side going -z)
    geo.computeBoundingBox();
    if (geo.boundingBox) {
      const cz = (geo.boundingBox.min.z + geo.boundingBox.max.z) / 2;
      geo.translate(0, 0, -cz);
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
    while (this.ramps.length < 6 && guard++ < 60) {
      const i = Math.floor(rng() * GRID_N);
      const j = Math.floor(rng() * (GRID_N - 1));
      const vertical = rng() < 0.5;
      const c = -WORLD_HALF + i * CELL;
      const mid = -WORLD_HALF + CELL * (j + 0.5);
      const along = mid + (rng() - 0.5) * 14;
      const key = `${i},${j},${vertical}`;
      if (placed.has(key)) continue;
      placed.add(key);
      const x = vertical ? c : along;
      const z = vertical ? along : c;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, 0.02, z);
      // ramp rises opposite to the travel direction so cars launch off the top
      const angle = vertical ? Math.PI / 2 : 0;
      mesh.rotation.y = rng() < 0.5 ? angle : angle + Math.PI;
      g.add(mesh);
      this.ramps.push({ x, z, w: vertical ? 7 : 13, h: vertical ? 13 : 7, angle });
    }
    return g;
  }

  private buildLights(): THREE.Group {
    const g = new THREE.Group();
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x39404f });
    for (let i = 0; i < GRID_N; i += 2) {
      for (let j = 0; j < GRID_N; j += 2) {
        const cx = -WORLD_HALF + i * CELL;
        const cz = -WORLD_HALF + j * CELL;
        const matX = new THREE.MeshStandardMaterial({
          color: 0x111111,
          emissive: 0x22ff66,
          emissiveIntensity: 2,
        });
        const matZ = new THREE.MeshStandardMaterial({
          color: 0x111111,
          emissive: 0xff2233,
          emissiveIntensity: 2,
        });
        // one pole at corner, two heads facing each axis
        const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.14, 0.18, 6.4, 6),
          poleMat
        );
        pole.position.set(cx + ROAD_W / 2 + 1.2, 3.2, cz + ROAD_W / 2 + 1.2);
        g.add(pole);
        const headX = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.3, 0.4), matX);
        headX.position.set(
          cx + ROAD_W / 2 + 1.2,
          6.6,
          cz + ROAD_W / 2 + 0.4
        );
        g.add(headX);
        const headZ = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.3, 0.5), matZ);
        headZ.position.set(
          cx + ROAD_W / 2 + 0.4,
          6.6,
          cz + ROAD_W / 2 + 1.2
        );
        g.add(headZ);
        const light: LightVisual = {
          cx,
          cz,
          state: 0,
          timer: ((i + j) * 1.7) % ((LIGHT_CYCLE + LIGHT_YELLOW) * 2),
          phaseId: 0,
          matX,
          matZ,
        };
        this.lights.push(light);
        this.lightGrid.set(`${i},${j}`, light);
      }
    }
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
