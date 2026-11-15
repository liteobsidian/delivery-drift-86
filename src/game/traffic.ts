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
    // unlit glow quads: cars must read at night from any distance
    const headMat = new THREE.MeshBasicMaterial({ color: 0xfff3c0 });
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2d22 });
    const headGeo = new THREE.PlaneGeometry(0.4, 0.26);
    const tailGeo = new THREE.PlaneGeometry(0.34, 0.2);
    // shared model materials: give the body a faint self-glow so cars are
    // visible from the side too, not only head-on (materials are shared
    // between clones, so each is lifted exactly once)
    const lifted = new Set<THREE.Material>();
    const lift = (o: THREE.Object3D) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.material) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (lifted.has(m)) continue;
        lifted.add(m);
        const std = m as THREE.MeshStandardMaterial;
        if (std.emissive && std.color) {
          std.emissive.copy(std.color).multiplyScalar(0.28);
          std.emissiveIntensity = 1;
        }
      }
    };
    models.forEach((m) => m.traverse(lift));
    this.cars.forEach((c, i) => {
      const clone = models[i % models.length].clone(true);
      // headlights (nose at local -z) and taillights (+z)
      for (const s of [-1, 1]) {
        const h = new THREE.Mesh(headGeo, headMat);
        h.position.set(s * 0.62, 0.75, -2.02);
        h.rotation.y = Math.PI;
        clone.add(h);
        const t = new THREE.Mesh(tailGeo, tailMat);
        t.position.set(s * 0.62, 0.75, 2.0);
        clone.add(t);
      }
      c.mesh.clear();
      c.mesh.add(clone);
    });
  }

  /** advance traffic; returns closing speed if any car hit the player this step */
  update(
    dt: number,
    px: number,
    pz: number,
    playerSpeed: number,
    pvx: number,
    pvz: number
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
      const dx = px - c.x;
      const dz = pz - c.z;
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
      const cdx = c.x - px;
      const cdz = c.z - pz;
      const cd = Math.hypot(cdx, cdz);
      if (cd < 3.1 && c.hitCooldown === 0) {
        const cvx = c.axis === 0 ? c.dir * wantSpeed : 0;
        const cvz = c.axis === 1 ? c.dir * wantSpeed : 0;
        const closing = Math.hypot(pvx - cvx, pvz - cvz);
        if (closing > 3) {
          c.hitCooldown = 0.9;
          hit = Math.max(hit, closing);
          // push the traffic car out so it doesn't grind inside the player
          if (cd > 0.001) {
            const push = 3.1 - cd + 0.05;
            c.x += (cdx / cd) * push;
            c.z += (cdz / cd) * push;
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
