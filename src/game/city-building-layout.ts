import type { CityLayout, CityParcel } from "./map-layouts";
import { parcelClearOfRoads } from "./map-layouts";

export interface CityBuildingSite extends CityParcel {
  height: number;
}

interface Rect {
  x: number;
  z: number;
  width: number;
  depth: number;
  rotation: number;
}

const BUILDING_PITCH = 8;

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

function roadFacing(layout: CityLayout, x: number, z: number): number {
  let nearest = Number.POSITIVE_INFINITY;
  let angle = 0;
  for (const road of layout.roads) for (let i = 0; i < road.points.length - 1; i++) {
    const a = road.points[i];
    const b = road.points[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length2 = dx * dx + dz * dz;
    const t = length2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / length2)) : 0;
    const distance = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
    if (distance < nearest) {
      nearest = distance;
      angle = Math.atan2(dz, dx);
    }
  }
  return angle;
}

/** Deterministic road-aware infill for both maps, kept clear of water and authored port assets. */
export function generateCityBuildingSites(layout: CityLayout): CityBuildingSite[] {
  const sites: CityBuildingSite[] = [];
  const { minX, maxX, minZ, maxZ } = layout.bounds;
  const columns = Math.ceil((maxX - minX) / BUILDING_PITCH);
  const rows = Math.ceil((maxZ - minZ) / BUILDING_PITCH);
  const salt = layout.id === "tokyo" ? 0x32a17 : 0x7c931;
  const portSites = layout.portSites;

  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const x = minX + BUILDING_PITCH / 2 + column * BUILDING_PITCH;
    const z = minZ + BUILDING_PITCH / 2 + row * BUILDING_PITCH;
    const width = 6.5 + hash(column, row, salt) * 0.6;
    const depth = 6.3 + hash(column, row, salt + 31) * 0.6;
    const rotation = roadFacing(layout, x, z);
    const rect: Rect = { x, z, width, depth, rotation };
    const footprint: CityBuildingSite = {
      ...rect,
      zone: layout.id === "yokohama" ? "port" : "downtown",
      height: layout.id === "yokohama" ? 5 + hash(column, row, salt + 97) * 5 : 8 + hash(column, row, salt + 97) * 30,
    };
    const footprintCorners = corners(rect);
    if (footprintCorners.some((point) => point.x < minX || point.x > maxX || point.z < minZ || point.z > maxZ)) continue;
    if (!parcelClearOfRoads(layout, footprint, 1)) continue;
    if (layout.waterAreas.some((water) => overlapsWater(rect, water.points))) continue;
    if (layout.parcels.some((parcel) => rectanglesOverlap(rect, parcel, 1))) continue;
    if (portSites.some((site) => rectanglesOverlap(rect, site, 2))) continue;
    if (sites.some((site) => rectanglesOverlap(rect, site, 0.35))) continue;
    sites.push(footprint);
  }
  return sites;
}
