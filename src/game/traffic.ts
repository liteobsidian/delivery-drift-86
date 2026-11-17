import * as THREE from "three";
import { ROAD_W, LIGHT_CYCLE, LIGHT_YELLOW } from "./config";
import type { CityPoint, TrafficRoute } from "./map-layouts";
import type { World, LightVisual } from "./world";

interface RouteData {
  points: TrafficRoute["points"];
  cumulative: number[];
  length: number;
}

interface TrafficCar {
  mesh: THREE.Group;
  x: number;
  z: number;
  dx: number;
  dz: number;
  axis: 0 | 1;
  dir: 1 | -1;
  routeIndex: number;
  progress: number;
  speed: number;
  actualSpeed: number;
  active: boolean;
  nearCooldown: number;
  hitCooldown: number;
}

const MAX_CARS = 10;
const LANE = ROAD_W / 4;
const INITIAL_CARS = 6;
const SPAWN_INTERVAL = 6;
const SPAWN_GAP = 22;
const FOLLOWING_GAP = 20;

/** Offset an NPC into the same relative lane side as its heading; reversing flips world-space lanes. */
export function trafficLanePosition(center: CityPoint, tangent: CityPoint, lane: number): CityPoint {
  return { x: center.x + tangent.z * lane, z: center.z - tangent.x * lane };
}

/** City traffic follows authored closed routes, including their bends and cul-de-sacs. */
export class Traffic {
  readonly group = new THREE.Group();
  private cars: TrafficCar[] = [];
  private routes: RouteData[] = [];
  private spawnTimer = SPAWN_INTERVAL;
  private rngState = 12345;

  constructor(private world: World) {
    const colors = [0x4a5568, 0x6b3a3a, 0x3a5a6b, 0x555f48, 0x777777, 0x3f3f5a];
    for (let i = 0; i < MAX_CARS; i++) {
      const mesh = buildTrafficCarMesh(colors[i % colors.length]);
      mesh.visible = false;
      this.group.add(mesh);
      this.cars.push({ mesh, x: 0, z: 0, dx: 1, dz: 0, axis: 0, dir: 1, routeIndex: 0, progress: 0, speed: 0, actualSpeed: 0, active: false, nearCooldown: 0, hitCooldown: 0 });
    }
    this.rebuildRoutes();
    for (let i = 0; i < INITIAL_CARS; i++) this.spawn();
  }

  setWorld(world: World): void {
    this.world = world;
    this.cars.forEach((car) => { car.active = false; car.mesh.visible = false; });
    this.rebuildRoutes();
    this.spawnTimer = SPAWN_INTERVAL;
    for (let i = 0; i < INITIAL_CARS; i++) this.spawn();
  }

  private rebuildRoutes(): void {
    this.routes = this.world.layout.trafficRoutes.map((route) => {
      const cumulative = [0];
      for (let i = 0; i < route.points.length - 1; i++) {
        const a = route.points[i];
        const b = route.points[i + 1];
        cumulative.push(cumulative[i] + Math.hypot(b.x - a.x, b.z - a.z));
      }
      return { points: route.points, cumulative, length: cumulative[cumulative.length - 1] };
    }).filter((route) => route.length > 0);
  }

  private rnd(): number {
    this.rngState = (this.rngState * 1103515245 + 12345) & 0x7fffffff;
    return this.rngState / 0x7fffffff;
  }

  private pose(car: TrafficCar): void {
    const route = this.routes[car.routeIndex];
    if (!route) return;
    const distance = ((car.progress % route.length) + route.length) % route.length;
    const sampled = distance;
    let segment = 0;
    while (segment < route.points.length - 2 && route.cumulative[segment + 1] < sampled) segment++;
    const a = route.points[segment];
    const b = route.points[segment + 1];
    const segmentLength = route.cumulative[segment + 1] - route.cumulative[segment] || 1;
    const t = Math.max(0, Math.min(1, (sampled - route.cumulative[segment]) / segmentLength));
    const direction = car.dir;
    const tx = (b.x - a.x) / segmentLength * direction;
    const tz = (b.z - a.z) / segmentLength * direction;
    const centerX = a.x + (b.x - a.x) * t;
    const centerZ = a.z + (b.z - a.z) * t;
    const lanePosition = trafficLanePosition({ x: centerX, z: centerZ }, { x: tx, z: tz }, LANE);
    car.x = lanePosition.x;
    car.z = lanePosition.z;
    car.dx = tx;
    car.dz = tz;
    car.axis = Math.abs(tx) >= Math.abs(tz) ? 0 : 1;
  }

  private place(car: TrafficCar): void {
    this.pose(car);
    car.mesh.position.set(car.x, 0, car.z);
    car.mesh.rotation.y = Math.atan2(-car.dx, -car.dz);
  }

  private spawn(): void {
    const car = this.cars.find((c) => !c.active);
    if (!car || !this.routes.length) return;
    let positionFound = false;
    for (let attempt = 0; attempt < 48; attempt++) {
      const routeIndex = Math.floor(this.rnd() * this.routes.length);
      const dir = this.rnd() < 0.5 ? 1 : -1;
      const progress = this.rnd() * this.routes[routeIndex].length;
      if (this.cars.some((other) => {
        if (!other.active || other.routeIndex !== routeIndex || other.dir !== dir) return false;
        const gap = this.forwardGap(progress, other.progress, dir, this.routes[routeIndex].length);
        return Math.min(gap, this.routes[routeIndex].length - gap) < SPAWN_GAP;
      })) continue;
      car.routeIndex = routeIndex;
      car.dir = dir;
      car.progress = progress;
      positionFound = true;
      break;
    }
    if (!positionFound) return;
    car.speed = 9 + this.rnd() * 5;
    car.actualSpeed = car.speed;
    car.active = true;
    car.mesh.visible = true;
    this.place(car);
  }

  onNearMiss: (() => void) | null = null;

  /** swap placeholder boxes for loaded 3D car models (nose must face -z) */
  setCarModels(models: THREE.Group[]): void {
    if (models.length === 0) return;
    const paint = [0xd84b3f, 0x3f78c5, 0x5b9d65, 0xd5b348, 0x7a64b5, 0xadb8c4];
    // The imported traffic GLBs use metallicFactor=1 and JPEG body maps.
    // In the dark city that makes their shells read like translucent holes;
    // use car-paint values and a restrained self-glow instead.
    const lifted = new Set<THREE.Material>();
    const lift = (o: THREE.Object3D) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.material) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (lifted.has(m)) continue;
        lifted.add(m);
        m.transparent = false;
        m.opacity = 1;
        m.depthWrite = true;
        const std = m as THREE.MeshStandardMaterial;
        if (std.emissive && std.color) {
          std.emissive.copy(std.color).multiplyScalar(0.04);
          std.emissiveIntensity = 1;
        }
        if ("metalness" in std) std.metalness = 0.12;
        if ("roughness" in std) std.roughness = 0.62;
      }
    };
    models.forEach((m) => m.traverse(lift));
    this.cars.forEach((c, i) => {
      const clone = models[i % models.length].clone(true);
      // The generated paint maps are mostly white/gray. Tint each instance so
      // traffic reads as a fleet of distinct cars, not washed-out glass shells.
      clone.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !mesh.material) return;
        const tint = (m: THREE.Material) => {
          const copy = m.clone();
          const std = copy as THREE.MeshStandardMaterial;
          if (std.color) {
            std.color.multiply(new THREE.Color(paint[i % paint.length]));
            std.emissive.copy(std.color).multiplyScalar(0.04);
            std.metalness = 0.12;
            std.roughness = 0.62;
          }
          copy.transparent = false;
          copy.opacity = 1;
          copy.depthWrite = true;
          copy.blending = THREE.NormalBlending;
          return copy;
        };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(tint) : tint(mesh.material);
      });
      c.mesh.clear();
      c.mesh.add(clone);
    });
  }

  /** advance traffic; returns closing speed if any car hit the player this step */
  update(dt: number, playerPos: THREE.Vector3, playerVel: THREE.Vector3, playerSpeed: number): number {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = SPAWN_INTERVAL;
      this.spawn();
    }
    let hit = 0;
    for (const c of this.cars) {
      if (!c.active) continue;
      this.pose(c);
      c.nearCooldown = Math.max(0, c.nearCooldown - dt);
      c.hitCooldown = Math.max(0, c.hitCooldown - dt);
      let wantSpeed = c.speed;
      const light = this.lightAhead(c);
      if (light) {
        const direction = c.axis === 0 ? Math.sign(c.dx) : Math.sign(c.dz);
        const stopAt = (c.axis === 0 ? light.cx : light.cz) - direction * (ROAD_W / 2 + 2.4);
        const coordinate = c.axis === 0 ? c.x : c.z;
        const dToStop = (stopAt - coordinate) * direction;
        if (dToStop > -1 && dToStop < 12) wantSpeed = 0;
      }

      const leader = this.carAhead(c);
      if (leader && leader.gap < FOLLOWING_GAP) {
        wantSpeed = Math.min(wantSpeed, Math.max(0, leader.car.actualSpeed + (leader.gap - FOLLOWING_GAP) * 0.8));
      }

      const dx = playerPos.x - c.x;
      const dz = playerPos.z - c.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 64) {
        const ahead = dx * c.dx + dz * c.dz;
        const lateral = -dx * c.dz + dz * c.dx;
        if (ahead > -1 && Math.abs(lateral) < 3.4) wantSpeed = Math.min(wantSpeed, Math.sqrt(d2) * 1.1);
      }
      if (c.nearCooldown === 0 && playerSpeed > 12 && d2 > 2.7 * 2.7 && d2 < 4.9 * 4.9) {
        c.nearCooldown = 3.5;
        this.onNearMiss?.();
      }

      const route = this.routes[c.routeIndex];
      c.progress = (c.progress + wantSpeed * dt * c.dir + route.length) % route.length;
      c.actualSpeed = wantSpeed;
      this.pose(c);
      const cvx = c.dx * wantSpeed;
      const cvz = c.dz * wantSpeed;
      const cdx = playerPos.x - c.x;
      const cdz = playerPos.z - c.z;
      const cd = Math.hypot(cdx, cdz);
      const contactRadius = 3.4;
      if (cd < contactRadius && c.hitCooldown === 0) {
        const closing = Math.hypot(playerVel.x - cvx, playerVel.z - cvz);
        if (closing > 3) {
          c.hitCooldown = 0.9;
          hit = Math.max(hit, closing);
          const nx = cd > 0.001 ? cdx / cd : 1;
          const nz = cd > 0.001 ? cdz / cd : 0;
          const push = contactRadius - cd + 0.04;
          playerPos.x += nx * push * 0.55;
          playerPos.z += nz * push * 0.55;
          c.x -= nx * push * 0.45;
          c.z -= nz * push * 0.45;
          const relativeNormal = (playerVel.x - cvx) * nx + (playerVel.z - cvz) * nz;
          if (relativeNormal < 0) {
            playerVel.x -= relativeNormal * nx * 1.15;
            playerVel.z -= relativeNormal * nz * 1.15;
          }
        }
      }
      c.mesh.position.set(c.x, 0, c.z);
      c.mesh.rotation.y = Math.atan2(-c.dx, -c.dz);
    }
    return hit;
  }

  private lightAhead(c: TrafficCar): LightVisual | null {
    for (const l of this.world.lights) {
      const dx = l.cx - c.x;
      const dz = l.cz - c.z;
      const ahead = dx * c.dx + dz * c.dz;
      if (ahead < 0 || ahead > ROAD_W * 2.2) continue;
      const lateral = -dx * c.dz + dz * c.dx;
      if (Math.abs(lateral) > ROAD_W / 2 + 1) continue;
      const redForAxis = c.axis === 0
        ? l.timer >= LIGHT_CYCLE + LIGHT_YELLOW
        : l.timer < LIGHT_CYCLE + LIGHT_YELLOW;
      if (redForAxis) return l;
    }
    return null;
  }

  private forwardGap(from: number, to: number, direction: 1 | -1, routeLength: number): number {
    const signed = (to - from) * direction;
    return ((signed % routeLength) + routeLength) % routeLength;
  }

  private carAhead(car: TrafficCar): { car: TrafficCar; gap: number } | null {
    const length = this.routes[car.routeIndex]?.length ?? 0;
    if (!length) return null;
    let leader: TrafficCar | null = null;
    let closest = Number.POSITIVE_INFINITY;
    for (const other of this.cars) {
      if (!other.active || other === car || other.routeIndex !== car.routeIndex || other.dir !== car.dir) continue;
      const gap = this.forwardGap(car.progress, other.progress, car.dir, length);
      if (gap > 0.1 && gap < closest) {
        closest = gap;
        leader = other;
      }
    }
    return leader ? { car: leader, gap: closest } : null;
  }

  /** verification helper: active car positions, heading and route spacing */
  debugPositions(): { id: number; x: number; z: number; dx: number; dz: number; axis: 0 | 1; dir: 1 | -1; routeIndex: number; progress: number; routeLength: number }[] {
    return this.cars.flatMap((c, id) => c.active ? [{
      id, x: c.x, z: c.z, dx: c.dx, dz: c.dz, axis: c.axis, dir: c.dir,
      routeIndex: c.routeIndex, progress: c.progress, routeLength: this.routes[c.routeIndex]?.length ?? 0,
    }] : []);
  }

  dispose(): void {
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | undefined;
      mat?.dispose();
    });
  }
}

function buildTrafficCarMesh(color: number): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.5,
    metalness: 0.4,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x101820,
    roughness: 0.2,
    metalness: 0.7,
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 4.1), bodyMat);
  body.position.y = 0.55;
  g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 2.2), glassMat);
  cabin.position.set(0, 1.05, 0.1);
  g.add(cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0c });
  for (const [x, z] of [
    [-0.92, -1.35],
    [0.92, -1.35],
    [-0.92, 1.35],
    [0.92, 1.35],
  ]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(x, 0.33, z);
    g.add(w);
  }
  const tl = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.12, 0.06),
    new THREE.MeshStandardMaterial({
      color: 0xff2222,
      emissive: 0xaa1111,
      emissiveIntensity: 1.2,
    })
  );
  tl.position.set(0, 0.62, 2.06);
  g.add(tl);
  return g;
}
