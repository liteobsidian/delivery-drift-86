import type { MapId } from "./types";

export interface CityPoint { x: number; z: number }
export interface RoadPath { id: string; width: number; points: CityPoint[] }
export interface TrafficRoute { id: string; points: CityPoint[] }
export interface CityParcel {
  x: number;
  z: number;
  width: number;
  depth: number;
  rotation: number;
  zone: "downtown" | "port";
}
export interface CityLayout {
  id: MapId;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  roads: RoadPath[];
  trafficRoutes: TrafficRoute[];
  signalJunctions: CityPoint[];
  parcels: CityParcel[];
}

const bounds = { minX: -174, maxX: 174, minZ: -174, maxZ: 174 };
const road = (id: string, points: CityPoint[], width = 11): RoadPath => ({ id, width, points });
const route = (id: string, roadPath: RoadPath): TrafficRoute => ({ id, points: roadPath.points });

/** Original hand-authored neighborhood street plans. Coordinates are world units. */
export const CITY_LAYOUTS: Record<MapId, CityLayout> = {
  tokyo: {
    id: "tokyo",
    bounds,
    roads: [
      road("outer-ring", [
        { x: -150, z: -98 }, { x: -110, z: -132 }, { x: -48, z: -122 }, { x: 8, z: -146 },
        { x: 72, z: -126 }, { x: 128, z: -99 }, { x: 148, z: -40 }, { x: 131, z: 8 },
        { x: 150, z: 58 }, { x: 111, z: 122 }, { x: 52, z: 138 }, { x: 0, z: 116 },
        { x: -61, z: 141 }, { x: -121, z: 95 }, { x: -147, z: 34 }, { x: -128, z: -27 },
        { x: -150, z: -98 },
      ], 14),
      road("downtown-loop", [
        { x: -44, z: 0 }, { x: -39, z: -21 }, { x: -22, z: -38 }, { x: 0, z: -44 },
        { x: 23, z: -38 }, { x: 39, z: -21 }, { x: 44, z: 0 }, { x: 37, z: 23 },
        { x: 20, z: 39 }, { x: 0, z: 44 }, { x: -23, z: 37 }, { x: -39, z: 20 },
        { x: -44, z: 0 },
      ], 13),
      road("north-avenue", [{ x: -132, z: -72 }, { x: -88, z: -63 }, { x: -49, z: -74 }, { x: -4, z: -65 }, { x: 42, z: -79 }, { x: 98, z: -64 }, { x: 141, z: -78 }], 12),
      road("south-avenue", [{ x: -142, z: 74 }, { x: -91, z: 58 }, { x: -47, z: 72 }, { x: 5, z: 62 }, { x: 58, z: 78 }, { x: 106, z: 64 }, { x: 137, z: 82 }], 12),
      road("west-connector", [{ x: -126, z: -31 }, { x: -91, z: -8 }, { x: -65, z: 21 }, { x: -45, z: 38 }], 9),
      road("east-connector", [{ x: 42, z: -8 }, { x: 72, z: -34 }, { x: 105, z: -45 }, { x: 145, z: -40 }], 9),
      road("north-south-west", [{ x: -92, z: -128 }, { x: -78, z: -87 }, { x: -84, z: -44 }, { x: -65, z: 21 }, { x: -72, z: 61 }, { x: -61, z: 141 }], 10),
      road("north-south-center", [{ x: -4, z: -145 }, { x: 12, z: -96 }, { x: -4, z: -65 }, { x: 3, z: -43 }, { x: 1, z: 44 }, { x: -10, z: 99 }, { x: 0, z: 116 }], 10),
      road("north-south-east", [{ x: 91, z: -115 }, { x: 103, z: -68 }, { x: 73, z: -34 }, { x: 44, z: 0 }, { x: 72, z: 48 }, { x: 59, z: 78 }, { x: 52, z: 138 }], 10),
      road("market-cut", [{ x: -88, z: -63 }, { x: -54, z: -27 }, { x: -18, z: -7 }, { x: 18, z: 11 }, { x: 49, z: 39 }, { x: 72, z: 48 }], 8.5),
      road("station-spur", [{ x: 98, z: -64 }, { x: 82, z: -26 }, { x: 104, z: 9 }, { x: 110, z: 42 }], 8.5),
      road("hill-switchback", [{ x: -147, z: 34 }, { x: -119, z: 17 }, { x: -107, z: -1 }, { x: -126, z: -27 }], 8.5),
      road("river-bridge", [{ x: -10, z: 99 }, { x: 13, z: 83 }, { x: 34, z: 82 }, { x: 58, z: 78 }], 8.5),
    ],
    trafficRoutes: [],
    signalJunctions: [
      { x: -4, z: -65 }, { x: 1, z: 44 }, { x: -84, z: -64 }, { x: 100, z: -66 },
    ],
    parcels: [
      { x: 50, z: -50, width: 18, depth: 18, rotation: 0.08, zone: "downtown" },
      { x: 80, z: 10, width: 18, depth: 18, rotation: 0, zone: "downtown" },
      { x: -90, z: 30, width: 18, depth: 18, rotation: -0.08, zone: "downtown" },
      { x: -30, z: 90, width: 18, depth: 18, rotation: 0.08, zone: "downtown" },
      { x: -14, z: -110, width: 18, depth: 18, rotation: 0, zone: "downtown" },
      { x: 74, z: -94, width: 18, depth: 18, rotation: 0, zone: "downtown" },
      { x: 74, z: 106, width: 18, depth: 18, rotation: 0, zone: "downtown" },
      { x: -102, z: -86, width: 18, depth: 18, rotation: 0, zone: "downtown" },
      { x: -94, z: 82, width: 18, depth: 18, rotation: 0, zone: "downtown" },
      { x: 114, z: -22, width: 18, depth: 18, rotation: 0, zone: "downtown" },
    ],
  },
  yokohama: {
    id: "yokohama",
    bounds,
    roads: [
      road("coastal-boulevard", [
        { x: -158, z: -120 }, { x: -100, z: -102 }, { x: -35, z: -110 }, { x: 40, z: -82 },
        { x: 110, z: -86 }, { x: 152, z: -52 }, { x: 133, z: 6 }, { x: 145, z: 58 },
        { x: 99, z: 108 }, { x: 45, z: 122 }, { x: -10, z: 99 }, { x: -68, z: 122 },
        { x: -125, z: 88 }, { x: -151, z: 28 }, { x: -130, z: -28 }, { x: -158, z: -120 },
      ], 14),
      road("container-loop", [
        { x: -120, z: -30 }, { x: -70, z: -15 }, { x: -18, z: -25 }, { x: 32, z: -3 },
        { x: 88, z: -14 }, { x: 120, z: 20 }, { x: 112, z: 56 }, { x: 70, z: 72 },
        { x: 20, z: 52 }, { x: -35, z: 67 }, { x: -84, z: 48 }, { x: -120, z: 20 },
        { x: -120, z: -30 },
      ], 12),
      road("harbor-backstreet", [{ x: -150, z: 0 }, { x: -82, z: 12 }, { x: -38, z: 22 }, { x: 0, z: 0 }, { x: 50, z: -12 }, { x: 120, z: 20 }, { x: 145, z: 58 }], 12),
      road("pier-access-west", [{ x: -130, z: -28 }, { x: -100, z: -53 }, { x: -65, z: -65 }, { x: -35, z: -110 }], 10),
      road("pier-access-east", [{ x: 40, z: -82 }, { x: 58, z: -48 }, { x: 88, z: -14 }, { x: 110, z: -86 }], 10),
      road("quay-road", [{ x: -125, z: 88 }, { x: -88, z: 72 }, { x: -35, z: 67 }, { x: 20, z: 52 }, { x: 70, z: 72 }, { x: 112, z: 56 }, { x: 145, z: 58 }], 11),
      road("warehouse-row-west", [{ x: -100, z: -102 }, { x: -93, z: -65 }, { x: -120, z: -30 }, { x: -115, z: 5 }, { x: -125, z: 88 }], 9),
      road("warehouse-row-center", [{ x: -35, z: -110 }, { x: -35, z: -65 }, { x: -18, z: -25 }, { x: -35, z: 67 }, { x: -10, z: 99 }], 9),
      road("warehouse-row-east", [{ x: 110, z: -86 }, { x: 88, z: -14 }, { x: 92, z: 30 }, { x: 70, z: 72 }, { x: 99, z: 108 }], 9),
      road("rail-underpass", [{ x: -151, z: 28 }, { x: -109, z: 14 }, { x: -75, z: 6 }, { x: -18, z: -25 }, { x: 32, z: -3 }, { x: 84, z: 9 }, { x: 133, z: 6 }], 8.5),
      road("fish-market-spur", [{ x: 20, z: 52 }, { x: 5, z: 78 }, { x: 45, z: 122 }], 8.5),
      road("dry-dock-spur", [{ x: 120, z: 20 }, { x: 141, z: 33 }, { x: 145, z: 58 }], 8.5),
      road("western-service-loop", [{ x: -125, z: 88 }, { x: -151, z: 28 }, { x: -130, z: -28 }], 8.5),
    ],
    trafficRoutes: [],
    signalJunctions: [
      { x: -35, z: 67 }, { x: 112, z: 56 },
    ],
    parcels: [
      { x: 82, z: 146, width: 18, depth: 18, rotation: 0, zone: "port" },
      { x: 0, z: -50, width: 18, depth: 18, rotation: -0.08, zone: "port" },
      { x: 40, z: 20, width: 18, depth: 18, rotation: 0.08, zone: "port" },
      { x: -54, z: -46, width: 18, depth: 18, rotation: 0, zone: "port" },
      { x: -6, z: -142, width: 18, depth: 18, rotation: 0, zone: "port" },
      { x: 114, z: -30, width: 18, depth: 18, rotation: 0, zone: "port" },
      { x: -78, z: 90, width: 18, depth: 18, rotation: 0, zone: "port" },
      { x: -118, z: -70, width: 18, depth: 18, rotation: 0, zone: "port" },
      { x: 74, z: -110, width: 18, depth: 18, rotation: 0, zone: "port" },
      { x: 58, z: 90, width: 18, depth: 18, rotation: 0, zone: "port" },
      { x: 66, z: 26, width: 18, depth: 18, rotation: 0, zone: "port" },
      { x: 138, z: -94, width: 18, depth: 18, rotation: 0, zone: "port" },
    ],
  },
};

CITY_LAYOUTS.tokyo.trafficRoutes = [
  route("tokyo-outer-traffic", CITY_LAYOUTS.tokyo.roads.find((item) => item.id === "outer-ring")!),
  route("tokyo-downtown-traffic", CITY_LAYOUTS.tokyo.roads.find((item) => item.id === "downtown-loop")!),
];
CITY_LAYOUTS.yokohama.trafficRoutes = [
  route("yokohama-coastal-traffic", CITY_LAYOUTS.yokohama.roads.find((item) => item.id === "coastal-boulevard")!),
  route("yokohama-port-traffic", CITY_LAYOUTS.yokohama.roads.find((item) => item.id === "container-loop")!),
];

const pointSegmentDistance = (px: number, pz: number, a: CityPoint, b: CityPoint): number => {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length2 = dx * dx + dz * dz;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / length2));
  return Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t));
};

export function cityLayoutFor(id: MapId): CityLayout { return CITY_LAYOUTS[id]; }

export function worldToTextureCoordinate(value: number, planeSize: number, textureSize: number): number {
  return ((value + planeSize / 2) / planeSize) * textureSize;
}

export function worldLengthToTexturePixels(length: number, planeSize: number, textureSize: number): number {
  return (length / planeSize) * textureSize;
}

export function distanceToRoad(layout: CityLayout, x: number, z: number): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const roadPath of layout.roads) nearest = Math.min(nearest, distanceToRoadPath(roadPath, x, z));
  return nearest;
}

export function distanceToRoadPath(roadPath: RoadPath, x: number, z: number): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < roadPath.points.length - 1; i++) {
    nearest = Math.min(nearest, pointSegmentDistance(x, z, roadPath.points[i], roadPath.points[i + 1]));
  }
  return nearest;
}

export function isOnLayoutRoad(layout: CityLayout, x: number, z: number): boolean {
  return layout.roads.some((roadPath) => distanceToRoadPath(roadPath, x, z) <= roadPath.width / 2);
}

export function sampleRoadPoint(layout: CityLayout, rng: () => number): CityPoint {
  const segments: { road: RoadPath; a: CityPoint; b: CityPoint; length: number }[] = [];
  let total = 0;
  for (const roadPath of layout.roads) {
    for (let i = 0; i < roadPath.points.length - 1; i++) {
      const a = roadPath.points[i];
      const b = roadPath.points[i + 1];
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (!length) continue;
      total += length;
      segments.push({ road: roadPath, a, b, length });
    }
  }
  let target = Math.max(0, Math.min(0.999999, rng())) * total;
  const segment = segments.find((item) => (target -= item.length) <= 0) ?? segments[segments.length - 1];
  const t = Math.max(0, Math.min(1, (target + segment.length) / segment.length));
  const dx = segment.b.x - segment.a.x;
  const dz = segment.b.z - segment.a.z;
  const length = segment.length;
  const lateral = (rng() * 2 - 1) * Math.min(1.2, segment.road.width * 0.12);
  return { x: segment.a.x + dx * t - (dz / length) * lateral, z: segment.a.z + dz * t + (dx / length) * lateral };
}

export function parcelClearOfRoads(layout: CityLayout, parcel: CityParcel, margin = 0): boolean {
  const c = Math.cos(parcel.rotation);
  const s = Math.sin(parcel.rotation);
  const insideRoadFree = (lx: number, lz: number) => {
    const x = parcel.x + lx * c - lz * s;
    const z = parcel.z + lx * s + lz * c;
    return layout.roads.every((roadPath) => {
      for (let i = 0; i < roadPath.points.length - 1; i++) {
        if (pointSegmentDistance(x, z, roadPath.points[i], roadPath.points[i + 1]) <= roadPath.width / 2 + margin) return false;
      }
      return true;
    });
  };
  const nx = Math.max(2, Math.ceil(parcel.width / 3));
  const nz = Math.max(2, Math.ceil(parcel.depth / 3));
  for (let ix = 0; ix <= nx; ix++) for (let iz = 0; iz <= nz; iz++) {
    if (!insideRoadFree(-parcel.width / 2 + parcel.width * ix / nx, -parcel.depth / 2 + parcel.depth * iz / nz)) return false;
  }
  return true;
}

export function distanceToLayoutBounds(layout: CityLayout, x: number, z: number): number {
  const dx = Math.max(layout.bounds.minX - x, 0, x - layout.bounds.maxX);
  const dz = Math.max(layout.bounds.minZ - z, 0, z - layout.bounds.maxZ);
  return Math.hypot(dx, dz);
}
