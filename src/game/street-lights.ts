import * as THREE from "three";
import type { CityPoint } from "./map-layouts";

const CELL = 12;
const CONTACT_RADIUS = 1.4;
const FALL_TIME = 0.52;

interface Lamp extends CityPoint {
  index: number;
  down: boolean;
}

interface FallingLamp {
  lamp: Lamp;
  axis: THREE.Vector3;
  elapsed: number;
}

export class StreetLights {
  private readonly cells = new Map<string, Lamp[]>();
  private readonly falling: FallingLamp[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly rotation = new THREE.Quaternion();
  private readonly center = new THREE.Vector3();
  private readonly unitScale = new THREE.Vector3(1, 1, 1);

  constructor(
    private readonly poles: THREE.InstancedMesh,
    private readonly tips: THREE.InstancedMesh,
    points: readonly CityPoint[],
    private readonly height: number,
  ) {
    poles.name = "street-lamp-poles";
    tips.name = "street-lamp-tips";
    poles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    tips.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (const [index, point] of points.entries()) {
      const lamp = { x: point.x, z: point.z, index, down: false };
      const key = this.cell(lamp.x, lamp.z);
      const bucket = this.cells.get(key);
      if (bucket) bucket.push(lamp);
      else this.cells.set(key, [lamp]);
      this.matrix.makeTranslation(lamp.x, height / 2, lamp.z);
      poles.setMatrixAt(index, this.matrix);
      this.matrix.makeTranslation(lamp.x, height, lamp.z);
      tips.setMatrixAt(index, this.matrix);
    }
    poles.computeBoundingSphere();
    if (poles.boundingSphere) poles.boundingSphere.radius += height;
  }

  private cell(x: number, z: number): string {
    return `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  }

  /** Test the swept car footprint against standing poles in the cells it crossed. */
  knock(fromX: number, fromZ: number, x: number, z: number, elevation: number, dt: number): CityPoint | null {
    if (dt <= 0 || elevation > this.height + 0.35) return null;
    const dx = x - fromX;
    const dz = z - fromZ;
    const length2 = dx * dx + dz * dz;
    if (length2 < (dt * 5) ** 2) return null;

    let hit: Lamp | null = null;
    let first = Infinity;
    const r = CONTACT_RADIUS;
    const minX = Math.floor((Math.min(fromX, x) - r) / CELL);
    const maxX = Math.floor((Math.max(fromX, x) + r) / CELL);
    const minZ = Math.floor((Math.min(fromZ, z) - r) / CELL);
    const maxZ = Math.floor((Math.max(fromZ, z) + r) / CELL);
    for (let ix = minX; ix <= maxX; ix++) for (let iz = minZ; iz <= maxZ; iz++) {
      const bucket = this.cells.get(`${ix},${iz}`);
      if (!bucket) continue;
      for (const lamp of bucket) {
        if (lamp.down) continue;
        const px = lamp.x - fromX;
        const pz = lamp.z - fromZ;
        const along = (px * dx + pz * dz) / length2;
        const t = Math.max(0, Math.min(1, along));
        if (t >= first || (px - t * dx) ** 2 + (pz - t * dz) ** 2 > r * r) continue;
        hit = lamp;
        first = t;
      }
    }
    if (!hit) return null;

    hit.down = true;
    const length = Math.sqrt(length2);
    this.falling.push({ lamp: hit, elapsed: 0, axis: new THREE.Vector3(dz / length, 0, -dx / length) });
    this.matrix.makeScale(0, 0, 0);
    this.tips.setMatrixAt(hit.index, this.matrix);
    this.tips.instanceMatrix.addUpdateRange(16 * hit.index, 16);
    this.tips.instanceMatrix.needsUpdate = true;
    return hit;
  }

  update(dt: number): void {
    if (!this.falling.length) return;
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const fall = this.falling[i];
      fall.elapsed += dt;
      const progress = Math.min(fall.elapsed / FALL_TIME, 1);
      const angle = 1.54 * progress * progress;
      this.rotation.setFromAxisAngle(fall.axis, angle);
      this.center.set(0, this.height / 2, 0).applyQuaternion(this.rotation);
      this.center.x += fall.lamp.x;
      this.center.y += Math.sin(angle) * 0.16;
      this.center.z += fall.lamp.z;
      this.matrix.compose(this.center, this.rotation, this.unitScale);
      const { index } = fall.lamp;
      this.poles.setMatrixAt(index, this.matrix);
      this.poles.instanceMatrix.addUpdateRange(16 * index, 16);
      if (progress === 1) {
        const last = this.falling.pop()!;
        if (i < this.falling.length) this.falling[i] = last;
      }
    }
    this.poles.instanceMatrix.needsUpdate = true;
  }
}
