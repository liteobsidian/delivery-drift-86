import type { CityLayout, CityParcel } from "./map-layouts";
import { buildingVariant, districtBuildingHeight } from "./city-style";

export interface CityBuildingSite extends CityParcel {
  height: number;
  variant: 0 | 1;
}

interface Rect {
  x: number;
  z: number;
  width: number;
  depth: number;
  rotation: number;
  cosRotation?: number;
  sinRotation?: number;
}

const BUILDING_PITCH = 8;

/** Layout angles rotate counterclockwise in X/Z; Three.js positive yaw turns local +X toward -Z. */
export function cityBuildingMeshYaw(layoutRotation: number): number {
  return -layoutRotation;
}

export interface CircleRectContact {
  nx: number;
  nz: number;
  penetration: number;
}

/** Resolve a circle against a rotated footprint expressed in the layout's X/Z angle convention. */
export function circleOrientedRectContact(
  x: number,
  z: number,
  radius: number,
  rect: Rect,
): CircleRectContact | null {
  const c = rect.cosRotation ?? (rect.rotation === 0 ? 1 : Math.cos(rect.rotation));
  const s = rect.sinRotation ?? (rect.rotation === 0 ? 0 : Math.sin(rect.rotation));
  const dx = x - rect.x;
  const dz = z - rect.z;
  const localX = dx * c + dz * s;
  const localZ = -dx * s + dz * c;
  const nearestX = Math.max(-rect.width / 2, Math.min(localX, rect.width / 2));
  const nearestZ = Math.max(-rect.depth / 2, Math.min(localZ, rect.depth / 2));
  const localDx = localX - nearestX;
  const localDz = localZ - nearestZ;
  const distance = Math.hypot(localDx, localDz);
  if (distance >= radius) return null;

  let nxLocal: number;
  let nzLocal: number;
  let penetration: number;
  if (distance > 1e-6) {
    nxLocal = localDx / distance;
    nzLocal = localDz / distance;
    penetration = radius - distance;
  } else {
    const edgeX = rect.width / 2 - Math.abs(localX);
    const edgeZ = rect.depth / 2 - Math.abs(localZ);
    if (edgeX <= edgeZ) {
      nxLocal = Math.sign(localX) || 1;
      nzLocal = 0;
      penetration = radius + edgeX;
    } else {
      nxLocal = 0;
      nzLocal = Math.sign(localZ) || 1;
      penetration = radius + edgeZ;
    }
  }
  return {
    nx: nxLocal * c - nzLocal * s,
    nz: nxLocal * s + nzLocal * c,
    penetration,
  };
}

function hash(x: number, z: number, salt: number): number {
  let value = Math.imul(x + 1, 0x45d9f3b) ^ Math.imul(z + 1, 0x119de1f3) ^ salt;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 0x1_0000_0000;
}

function corners(rect: Rect): { x: number; z: number }[] {
  const c = Math.cos(rect.rotation);
  const s = Math.sin(rect.rotation);
  return [
    [-rect.width / 2, -rect.depth / 2],
    [rect.width / 2, -rect.depth / 2],
    [rect.width / 2, rect.depth / 2],
    [-rect.width / 2, rect.depth / 2],
  ].map(([x, z]) => ({ x: rect.x + x * c - z * s, z: rect.z + x * s + z * c }));
}

function rectanglesOverlap(a: Rect, b: Rect, clearance = 0): boolean {
  const ac = Math.cos(a.rotation);
  const as = Math.sin(a.rotation);
  const bc = Math.cos(b.rotation);
  const bs = Math.sin(b.rotation);
  const axes = [
    { x: ac, z: as }, { x: -as, z: ac },
    { x: bc, z: bs }, { x: -bs, z: bc },
  ];
  for (const axis of axes) {
    const centerDistance = Math.abs((b.x - a.x) * axis.x + (b.z - a.z) * axis.z);
    const radiusA = Math.abs(ac * axis.x + as * axis.z) * a.width / 2 + Math.abs(-as * axis.x + ac * axis.z) * a.depth / 2;
    const radiusB = Math.abs(bc * axis.x + bs * axis.z) * b.width / 2 + Math.abs(-bs * axis.x + bc * axis.z) * b.depth / 2;
    if (centerDistance >= radiusA + radiusB + clearance) return false;
  }
  return true;
}

function pointInPolygon(x: number, z: number, points: { x: number; z: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function segmentIntersectsRect(a: { x: number; z: number }, b: { x: number; z: number }, width: number, depth: number): boolean {
  let tMin = 0;
  let tMax = 1;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  for (const [p, q] of [
    [-dx, a.x + width / 2], [dx, width / 2 - a.x],
    [-dz, a.z + depth / 2], [dz, depth / 2 - a.z],
  ]) {
    if (Math.abs(p) < 1e-8) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) tMin = Math.max(tMin, t);
    else tMax = Math.min(tMax, t);
    if (tMin > tMax) return false;
  }
  return true;
}

function overlapsWater(rect: Rect, polygon: { x: number; z: number }[]): boolean {
  const c = Math.cos(rect.rotation);
  const s = Math.sin(rect.rotation);
  const local = (point: { x: number; z: number }) => {
    const dx = point.x - rect.x;
    const dz = point.z - rect.z;
    return { x: dx * c + dz * s, z: -dx * s + dz * c };
  };
  if (corners(rect).some(({ x, z }) => pointInPolygon(x, z, polygon))) return true;
  const localPolygon = polygon.map(local);
  if (localPolygon.some((point) => Math.abs(point.x) <= rect.width / 2 && Math.abs(point.z) <= rect.depth / 2)) return true;
  for (let i = 0; i < localPolygon.length; i++) {
    if (segmentIntersectsRect(localPolygon[i], localPolygon[(i + 1) % localPolygon.length], rect.width, rect.depth)) return true;
  }
  return false;
}

interface RoadSegment {
  order: number;
  ax: number;
  az: number;
  dx: number;
  dz: number;
  length2: number;
  width: number;
  angle: number;
  visited: number;
}

const ROAD_GRID_CELL = 32;

function spatialKey(x: number, z: number): string {
  return `${x},${z}`;
}

function distanceToSegment(segment: RoadSegment, x: number, z: number): number {
  const t = segment.length2
    ? Math.max(0, Math.min(1, ((x - segment.ax) * segment.dx + (z - segment.az) * segment.dz) / segment.length2))
    : 0;
  return Math.hypot(x - segment.ax - segment.dx * t, z - segment.az - segment.dz * t);
}

/** Small fixed road set, indexed once so each grid parcel only checks nearby segments. */
class RoadSpatialIndex {
  private cells = new Map<string, RoadSegment[]>();
  private segments: RoadSegment[] = [];
  private queryId = 0;
  private padding: number;
  private maxRadius: number;

  constructor(layout: CityLayout) {
    this.padding = Math.max(0, ...layout.roads.map((road) => road.width / 2 + 1));
    this.maxRadius = Math.ceil(Math.max(
      Math.abs(layout.bounds.minX), Math.abs(layout.bounds.maxX),
      Math.abs(layout.bounds.minZ), Math.abs(layout.bounds.maxZ),
    ) / ROAD_GRID_CELL) + 2;
    for (const road of layout.roads) for (let i = 0; i < road.points.length - 1; i++) {
      const a = road.points[i];
      const b = road.points[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const segment: RoadSegment = {
        order: this.segments.length,
        ax: a.x, az: a.z, dx, dz, length2: dx * dx + dz * dz,
        width: road.width, angle: Math.atan2(dz, dx), visited: 0,
      };
      this.segments.push(segment);
      const minX = Math.floor((Math.min(a.x, b.x) - this.padding) / ROAD_GRID_CELL);
      const maxX = Math.floor((Math.max(a.x, b.x) + this.padding) / ROAD_GRID_CELL);
      const minZ = Math.floor((Math.min(a.z, b.z) - this.padding) / ROAD_GRID_CELL);
      const maxZ = Math.floor((Math.max(a.z, b.z) + this.padding) / ROAD_GRID_CELL);
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

  clearOfRoads(rect: Rect, margin: number): boolean {
    const c = Math.cos(rect.rotation);
    const s = Math.sin(rect.rotation);
    const nx = Math.max(2, Math.ceil(rect.width / 3));
    const nz = Math.max(2, Math.ceil(rect.depth / 3));
    for (let ix = 0; ix <= nx; ix++) for (let iz = 0; iz <= nz; iz++) {
      const lx = -rect.width / 2 + rect.width * ix / nx;
      const lz = -rect.depth / 2 + rect.depth * iz / nz;
      const x = rect.x + lx * c - lz * s;
      const z = rect.z + lx * s + lz * c;
      const bucket = this.cells.get(spatialKey(Math.floor(x / ROAD_GRID_CELL), Math.floor(z / ROAD_GRID_CELL)));
      if (!bucket) continue;
      for (const segment of bucket) {
        if (distanceToSegment(segment, x, z) <= segment.width / 2 + margin) return false;
      }
    }
    return true;
  }
}

/** Deterministic road-aware infill, kept clear of water and authored landmark/port footprints. */
export function generateCityBuildingSites(layout: CityLayout): CityBuildingSite[] {
  const sites: CityBuildingSite[] = [];
  const roadIndex = new RoadSpatialIndex(layout);
  const acceptedSites = new Map<string, CityBuildingSite[]>();
  const { minX, maxX, minZ, maxZ } = layout.bounds;
  const columns = Math.ceil((maxX - minX) / BUILDING_PITCH);
  const rows = Math.ceil((maxZ - minZ) / BUILDING_PITCH);
  const saltByMap = { tokyo: 0x32a17, yokohama: 0x7c931, spb: 0x32b19, kazan: 0x67ca3, sochi: 0x48d21 } as const;
  const salt = saltByMap[layout.id];
  const portSites = layout.portSites;

  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const x = minX + BUILDING_PITCH / 2 + column * BUILDING_PITCH;
    const z = minZ + BUILDING_PITCH / 2 + row * BUILDING_PITCH;
    const width = 6.5 + hash(column, row, salt) * 0.6;
    const depth = 6.3 + hash(column, row, salt + 31) * 0.6;
    const rotation = roadIndex.nearestAngle(x, z);
    const rect: Rect = { x, z, width, depth, rotation };
    const variant = buildingVariant(layout.id, x, z, hash(column, row, salt + 157));
    const footprint: CityBuildingSite = {
      ...rect,
      zone: layout.id === "yokohama" ? "port" : "downtown",
      variant,
      height: districtBuildingHeight(layout.id, variant, hash(column, row, salt + 97), z),
    };
    const footprintCorners = corners(rect);
    if (footprintCorners.some((point) => point.x < minX || point.x > maxX || point.z < minZ || point.z > maxZ)) continue;
    if (!roadIndex.clearOfRoads(footprint, 1)) continue;
    if (layout.waterAreas.some((water) => overlapsWater(rect, water.points))) continue;
    if (portSites.some((site) => rectanglesOverlap(rect, site, 2))) continue;
    if (layout.landmarks.some((site) => rectanglesOverlap(rect, site, site.kind === "bridge" ? 9 : site.kind === "palm-row" ? 6 : 10))) continue;
    let overlapsAcceptedSite = false;
    const cellX = Math.floor(x / 16);
    const cellZ = Math.floor(z / 16);
    for (let dx = -1; dx <= 1 && !overlapsAcceptedSite; dx++) for (let dz = -1; dz <= 1 && !overlapsAcceptedSite; dz++) {
      for (const site of acceptedSites.get(spatialKey(cellX + dx, cellZ + dz)) ?? []) {
        if (rectanglesOverlap(rect, site, 0.35)) { overlapsAcceptedSite = true; break; }
      }
    }
    if (overlapsAcceptedSite) continue;
    sites.push(footprint);
    const key = spatialKey(cellX, cellZ);
    const bucket = acceptedSites.get(key);
    if (bucket) bucket.push(footprint);
    else acceptedSites.set(key, [footprint]);
  }
  return sites;
}
