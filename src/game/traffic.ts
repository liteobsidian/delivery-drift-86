import * as THREE from "three";
import { CELL, GRID_N, WORLD_HALF, ROAD_W, LIGHT_CYCLE, LIGHT_YELLOW } from "./config";
import type { World, LightVisual } from "./world";

interface TrafficCar {
  mesh: THREE.Group;
  x: number;
  z: number;
  axis: 0 | 1; // 0: moves along x, 1: along z
  dir: 1 | -1;
  speed: number;
  active: boolean;
  nearCooldown: number;
  hitCooldown: number;
}

const MAX_CARS = 12;
const LANE = ROAD_W / 4;

/** Simple traffic: cars loop along grid roads, stop at red lights, avoid the player a bit. */
export class Traffic {
  readonly group = new THREE.Group();
  private cars: TrafficCar[] = [];
  private spawnTimer = 0;
  private rngState = 12345;

  constructor(private world: World) {
    const colors = [0x4a5568, 0x6b3a3a, 0x3a5a6b, 0x555f48, 0x777777, 0x3f3f5a];
    for (let i = 0; i < MAX_CARS; i++) {
      const mesh = buildTrafficCarMesh(colors[i % colors.length]);
      mesh.visible = false;
      this.group.add(mesh);
      this.cars.push({
        mesh,
        x: 0,
        z: 0,
        axis: 0,
        dir: 1,
        speed: 0,
        active: false,
        nearCooldown: 0,
        hitCooldown: 0,
      });
    }
    // pre-seed a few cars
    for (let i = 0; i < 6; i++) this.spawn(true);
  }

  private rnd(): number {
    this.rngState = (this.rngState * 1103515245 + 12345) & 0x7fffffff;
    return this.rngState / 0x7fffffff;
  }

  private spawn(anywhere = false): void {
    const car = this.cars.find((c) => !c.active);
    if (!car) return;
    const i = Math.floor(this.rnd() * GRID_N);
    car.axis = this.rnd() < 0.5 ? 0 : 1;
    car.dir = this.rnd() < 0.5 ? 1 : -1;
    const line = -WORLD_HALF + i * CELL + (car.dir === 1 ? -LANE : LANE);
    const along = anywhere
      ? (this.rnd() * 2 - 1) * WORLD_HALF
      : -car.dir * (WORLD_HALF + 10);
    if (car.axis === 0) {
      car.x = along;
      car.z = line;
    } else {
      car.x = line;
      car.z = along;
    }
    car.speed = 9 + this.rnd() * 5;
    car.active = true;
    car.mesh.visible = true;
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
  update(
    dt: number,
    playerPos: THREE.Vector3,
    playerVel: THREE.Vector3,
    playerSpeed: number,
  ): number {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 2.2;
      this.spawn();
    }
    let hit = 0;
    for (const c of this.cars) {
      if (!c.active) continue;
      c.nearCooldown = Math.max(0, c.nearCooldown - dt);
      c.hitCooldown = Math.max(0, c.hitCooldown - dt);

      // red light ahead?
      let wantSpeed = c.speed;
      const light = this.lightAhead(c);
      if (light) {
        const dist = c.axis === 0
          ? (light.cx - c.x) * c.dir
          : (light.cz - c.z) * c.dir;
        const stopAt =
          (c.axis === 0 ? light.cx : light.cz) -
          c.dir * (ROAD_W / 2 + 2.4);
        const dToStop =
          (c.axis === 0 ? stopAt - c.x : stopAt - c.z) * c.dir;
        if (dToStop > -1 && dToStop < 12) wantSpeed = 0;
        void dist;
      }
      // player in the same lane ahead -> brake for a red-style stop; but if
      // the player is beside/behind, keep going: ramming must actually collide
      const dx = playerPos.x - c.x;
      const dz = playerPos.z - c.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 64) {
        const ahead = c.axis === 0 ? dx * c.dir : dz * c.dir;
        const lateral = c.axis === 0 ? dz : dx;
        if (ahead > -1 && Math.abs(lateral) < 3.4)
          wantSpeed = Math.min(wantSpeed, Math.sqrt(d2) * 1.1);
      }
      if (
        c.nearCooldown === 0 &&
        playerSpeed > 12 &&
        d2 > 2.7 * 2.7 &&
        d2 < 4.9 * 4.9
      ) {
        c.nearCooldown = 3.5;
        this.onNearMiss?.();
      }

      // integrate
      const v = wantSpeed * dt * (c.dir as number);
      if (c.axis === 0) c.x += v;
      else c.z += v;

      // despawn at edges
      if (Math.abs(c.x) > WORLD_HALF + 16 || Math.abs(c.z) > WORLD_HALF + 16) {
        c.active = false;
        c.mesh.visible = false;
        continue;
      }

      // collide with player (circle-circle); impact = closing speed
      const cdx = playerPos.x - c.x;
      const cdz = playerPos.z - c.z;
      const cd = Math.hypot(cdx, cdz);
      const contactRadius = 3.4;
      if (cd < contactRadius && c.hitCooldown === 0) {
        const cvx = c.axis === 0 ? c.dir * wantSpeed : 0;
        const cvz = c.axis === 1 ? c.dir * wantSpeed : 0;
        const closing = Math.hypot(playerVel.x - cvx, playerVel.z - cvz);
        if (closing > 3) {
          c.hitCooldown = 0.9;
          hit = Math.max(hit, closing);
          // Separate both cars and cancel speed into the collision normal.
          // Before this, only the NPC moved, so the player seemed to pass
          // through it instead of hitting an obstacle.
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

      // place mesh
      c.mesh.position.set(c.x, 0, c.z);
      const targetRot =
        c.axis === 0
          ? c.dir === 1
            ? -Math.PI / 2
            : Math.PI / 2
          : c.dir === 1
            ? Math.PI
            : 0;
      c.mesh.rotation.y = targetRot;
    }
    return hit;
  }

  private lightAhead(c: TrafficCar): LightVisual | null {
    // find nearest enforced intersection ahead along movement
    for (const l of this.world.lights) {
      const ahead = c.axis === 0 ? (l.cx - c.x) * c.dir : (l.cz - c.z) * c.dir;
      if (ahead < 0 || ahead > ROAD_W * 2.2) continue;
      // must be on the same road line
      const laneCoord = c.axis === 0 ? c.z : c.x;
      const lightCoord = c.axis === 0 ? l.cz : l.cx;
      if (Math.abs(laneCoord - lightCoord) > ROAD_W / 2 + 1) continue;
      // red for this axis?
      const t = l.timer;
      const redForAxis =
        c.axis === 0
          ? t >= LIGHT_CYCLE + LIGHT_YELLOW // x-road is red only after its yellow
          : t < LIGHT_CYCLE + LIGHT_YELLOW;
      if (redForAxis) return l;
    }
    return null;
  }

  /** verification helper: active car positions */
  debugPositions(): { x: number; z: number; axis: 0 | 1; dir: 1 | -1 }[] {
    return this.cars
      .filter((c) => c.active)
      .map((c) => ({ x: c.x, z: c.z, axis: c.axis, dir: c.dir }));
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
