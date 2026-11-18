import * as THREE from "three";
import { circleOrientedRectContact } from "./city-building-layout";
import type { AABB } from "./world";

const CELL_SIZE = 24;

function cellKey(x: number, z: number): number {
  return ((x & 0xffff) << 16) | (z & 0xffff);
}

type BuildingRect = NonNullable<AABB["collisionRect"]>;

function collisionRect(building: AABB): BuildingRect {
  return building.collisionRect ?? {
    x: (building.minX + building.maxX) / 2,
    z: (building.minZ + building.maxZ) / 2,
    width: building.maxX - building.minX,
    depth: building.maxZ - building.minZ,
    rotation: 0,
  };
}

/** Fixed broadphase for static city geometry; narrow phase stays the exact OBB contact test. */
export class BuildingSpatialIndex {
  private readonly cells = new Map<number, number[]>();
  private readonly collisionRects: BuildingRect[];
  private readonly seen: Uint32Array;
  private readonly scratch: number[] = [];
  private queryId = 0;
  readonly maxExtent: number;

  constructor(private readonly buildings: readonly AABB[]) {
    this.seen = new Uint32Array(buildings.length);
    this.collisionRects = buildings.map(collisionRect);
    this.maxExtent = buildings.reduce((extent, building) => Math.max(
      extent,
      (building.maxX - building.minX) / 2,
      (building.maxZ - building.minZ) / 2,
    ), 0);
    buildings.forEach((building, index) => {
      const minX = Math.floor(building.minX / CELL_SIZE);
      const maxX = Math.floor(building.maxX / CELL_SIZE);
      const minZ = Math.floor(building.minZ / CELL_SIZE);
      const maxZ = Math.floor(building.maxZ / CELL_SIZE);
      for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
        const key = cellKey(x, z);
        const bucket = this.cells.get(key);
        if (bucket) bucket.push(index);
        else this.cells.set(key, [index]);
      }
    });
  }

  /** Reuses the same result buffer; callers must consume it before the next query. */
  query(x: number, z: number, radius: number): number[] {
    this.scratch.length = 0;
    this.queryId = (this.queryId + 1) >>> 0;
    if (this.queryId === 0) {
      this.seen.fill(0);
      this.queryId = 1;
    }
    const broadRadius = Math.max(0, radius) + this.maxExtent;
    const minX = Math.floor((x - broadRadius) / CELL_SIZE);
    const maxX = Math.floor((x + broadRadius) / CELL_SIZE);
    const minZ = Math.floor((z - broadRadius) / CELL_SIZE);
    const maxZ = Math.floor((z + broadRadius) / CELL_SIZE);
    for (let cellX = minX; cellX <= maxX; cellX++) for (let cellZ = minZ; cellZ <= maxZ; cellZ++) {
      const bucket = this.cells.get(cellKey(cellX, cellZ));
      if (!bucket) continue;
      for (const index of bucket) {
        if (this.seen[index] === this.queryId) continue;
        this.seen[index] = this.queryId;
        this.scratch.push(index);
      }
    }
    this.scratch.sort(compareIndex);
    return this.scratch;
  }

  resolve(indices: readonly number[], pos: THREE.Vector3, radius: number, vel: THREE.Vector3): number {
    return resolveRectContacts(this.collisionRects, indices, pos, radius, vel);
  }
}

function compareIndex(a: number, b: number): number { return a - b; }

function resolveRectContacts(
  rects: readonly BuildingRect[],
  indices: readonly number[],
  pos: THREE.Vector3,
  radius: number,
  vel: THREE.Vector3,
): number {
  let impact = 0;
  for (const index of indices) {
    const contact = circleOrientedRectContact(pos.x, pos.z, radius, rects[index]);
    if (!contact) continue;
    pos.x += contact.nx * contact.penetration;
    pos.z += contact.nz * contact.penetration;
    const vn = vel.x * contact.nx + vel.z * contact.nz;
    if (vn < 0) {
      impact = Math.max(impact, -vn);
      vel.x -= vn * contact.nx * 1.4;
      vel.z -= vn * contact.nz * 1.4;
    }
  }
  return impact;
}

/** Resolve a list of candidate building contacts in stable world insertion order. */
export function resolveBuildingContacts(
  buildings: readonly AABB[],
  indices: readonly number[],
  pos: THREE.Vector3,
  radius: number,
  vel: THREE.Vector3,
): number {
  const rects = buildings.map(collisionRect);
  return resolveRectContacts(rects, indices, pos, radius, vel);
}
