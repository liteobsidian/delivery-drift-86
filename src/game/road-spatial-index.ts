import type { CityLayout, CityParcel, RoadPath } from "./map-layouts";

function spatialKey(x: number, z: number): string {
  return `${x},${z}`;
}

interface RoadSegment {
  road: RoadPath;
  order: number;
  ax: number;
  az: number;
  dx: number;
  dz: number;
  length2: number;
  angle: number;
  visited: number;
}

const ROAD_GRID_CELL = 32;

function distanceToSegment(segment: RoadSegment, x: number, z: number): number {
  const t = segment.length2
    ? Math.max(0, Math.min(1, ((x - segment.ax) * segment.dx + (z - segment.az) * segment.dz) / segment.length2))
    : 0;
  return Math.hypot(x - segment.ax - segment.dx * t, z - segment.az - segment.dz * t);
}

/** The driving surface, paint and building clearance share the same road segments. */
export class RoadSpatialIndex {
  private cells = new Map<string, RoadSegment[]>();
  private queryId = 0;
  private maxRadius: number;

  constructor(layout: CityLayout) {
    const padding = Math.max(0, ...layout.roads.map((road) => road.width / 2 + 2));
    this.maxRadius = Math.ceil(Math.max(
      Math.abs(layout.bounds.minX), Math.abs(layout.bounds.maxX),
      Math.abs(layout.bounds.minZ), Math.abs(layout.bounds.maxZ),
    ) / ROAD_GRID_CELL) + 2;
    let order = 0;
    for (const road of layout.roads) for (let i = 0; i < road.points.length - 1; i++) {
      const a = road.points[i];
      const b = road.points[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const segment: RoadSegment = {
        road, order: order++,
        ax: a.x, az: a.z, dx, dz, length2: dx * dx + dz * dz,
        angle: Math.atan2(dz, dx), visited: 0,
      };
      const minX = Math.floor((Math.min(a.x, b.x) - padding) / ROAD_GRID_CELL);
      const maxX = Math.floor((Math.max(a.x, b.x) + padding) / ROAD_GRID_CELL);
      const minZ = Math.floor((Math.min(a.z, b.z) - padding) / ROAD_GRID_CELL);
      const maxZ = Math.floor((Math.max(a.z, b.z) + padding) / ROAD_GRID_CELL);
      for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
        const key = spatialKey(x, z);
        const bucket = this.cells.get(key);
        if (bucket) bucket.push(segment);
        else this.cells.set(key, [segment]);
      }
    }
  }

  nearestAngle(x: number, z: number): number {
    const cellX = Math.floor(x / ROAD_GRID_CELL);
    const cellZ = Math.floor(z / ROAD_GRID_CELL);
    const id = ++this.queryId;
    let nearest = Number.POSITIVE_INFINITY;
    let nearestOrder = Number.POSITIVE_INFINITY;
    let angle = 0;
    for (let radius = 0; radius <= this.maxRadius; radius++) {
      for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
        if (radius > 0 && Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;
        const bucket = this.cells.get(spatialKey(cellX + dx, cellZ + dz));
        if (!bucket) continue;
        for (const segment of bucket) {
          if (segment.visited === id) continue;
          segment.visited = id;
          const distance = distanceToSegment(segment, x, z);
          if (distance < nearest || (distance === nearest && segment.order < nearestOrder)) {
            nearest = distance;
            nearestOrder = segment.order;
            angle = segment.angle;
          }
        }
      }
      const left = (cellX - radius) * ROAD_GRID_CELL;
      const right = (cellX + radius + 1) * ROAD_GRID_CELL;
      const top = (cellZ - radius) * ROAD_GRID_CELL;
      const bottom = (cellZ + radius + 1) * ROAD_GRID_CELL;
      const outsideDistance = Math.max(0, Math.min(x - left, right - x, z - top, bottom - z));
      if (nearest < outsideDistance) break;
    }
    return angle;
  }

  covers(x: number, z: number, margin = 0, except?: RoadPath): boolean {
    const bucket = this.cells.get(spatialKey(Math.floor(x / ROAD_GRID_CELL), Math.floor(z / ROAD_GRID_CELL)));
    if (!bucket) return false;
    for (const segment of bucket) {
      if (segment.road !== except && distanceToSegment(segment, x, z) <= segment.road.width / 2 + margin) return true;
    }
    return false;
  }

  clearOfRoads(rect: Pick<CityParcel, "x" | "z" | "width" | "depth" | "rotation">, margin: number): boolean {
    const c = Math.cos(rect.rotation);
    const s = Math.sin(rect.rotation);
    const nx = Math.max(2, Math.ceil(rect.width / 3));
    const nz = Math.max(2, Math.ceil(rect.depth / 3));
    for (let ix = 0; ix <= nx; ix++) for (let iz = 0; iz <= nz; iz++) {
      const lx = -rect.width / 2 + rect.width * ix / nx;
      const lz = -rect.depth / 2 + rect.depth * iz / nz;
      const x = rect.x + lx * c - lz * s;
      const z = rect.z + lx * s + lz * c;
      if (this.covers(x, z, margin)) return false;
    }
    return true;
  }
}
