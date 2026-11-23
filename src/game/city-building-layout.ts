import type { CityLayout, CityParcel } from "./map-layouts";
import { buildingVariant, districtBuildingHeight } from "./city-style";
import { RoadSpatialIndex } from "./road-spatial-index";

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

export function pointInPolygon(x: number, z: number, points: { x: number; z: number }[]): boolean {
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

function spatialKey(x: number, z: number): string {
  return `${x},${z}`;
}

/** Deterministic road-aware infill, kept clear of water and authored landmark/port footprints. */
export function generateCityBuildingSites(layout: CityLayout, roadIndex = new RoadSpatialIndex(layout)): CityBuildingSite[] {
  const sites: CityBuildingSite[] = [];
  const acceptedSites = new Map<string, CityBuildingSite[]>();
  const { minX, maxX, minZ, maxZ } = layout.bounds;
  const columns = Math.ceil((maxX - minX) / BUILDING_PITCH);
  const rows = Math.ceil((maxZ - minZ) / BUILDING_PITCH);
  const footprintScale = layout.id === "yokohama" ? 0.99 : 1;
  const saltByMap = { tokyo: 0x32a17, yokohama: 0x7c931, spb: 0x32b19, kazan: 0x67ca3, sochi: 0x48d21 } as const;
  const salt = saltByMap[layout.id];
  const portSites = layout.portSites;

  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const x = minX + BUILDING_PITCH / 2 + column * BUILDING_PITCH;
    const z = minZ + BUILDING_PITCH / 2 + row * BUILDING_PITCH;
    const width = (6.5 + hash(column, row, salt) * 0.6) * footprintScale;
    const depth = (6.3 + hash(column, row, salt + 31) * 0.6) * footprintScale;
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
