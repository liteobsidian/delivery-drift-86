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
const legacyGridCoordinates = [-174, -116, -58, 0, 58, 116, 174];
const legacyGridRoads: RoadPath[] = legacyGridCoordinates.flatMap((coordinate, index) => [
  road(`legacy-east-west-${index}`, [{ x: -174, z: coordinate }, { x: 174, z: coordinate }], 14),
  road(`legacy-north-south-${index}`, [{ x: coordinate, z: -174 }, { x: coordinate, z: 174 }], 14),
]);
function circularRoadPoints(cx: number, cz: number, radius: number, start: number, end: number, steps: number): CityPoint[] {
  const points = Array.from({ length: steps + 1 }, (_, index) => {
    const angle = start + (end - start) * index / steps;
    return { x: cx + Math.cos(angle) * radius, z: cz + Math.sin(angle) * radius };
  });
  if (Math.abs(Math.abs(end - start) - Math.PI * 2) < 1e-8) points[steps] = { ...points[0] };
  return points;
}
const legacyDriftRoads: RoadPath[] = [
  road("drift-ring", circularRoadPoints(0, 0, 44, 0, Math.PI * 2, 64), 14),
  road("drift-sweeper-ne", circularRoadPoints(58, 58, 38, Math.PI, Math.PI * 1.5, 12), 14),
  road("drift-sweeper-nw", circularRoadPoints(-58, 58, 38, -Math.PI / 2, 0, 12), 14),
  road("drift-sweeper-se", circularRoadPoints(58, -58, 38, Math.PI / 2, Math.PI, 12), 14),
  road("drift-sweeper-sw", circularRoadPoints(-58, -58, 38, 0, Math.PI / 2, 12), 14),
];

/** Original hand-authored neighborhood street plans. Coordinates are world units. */
export const CITY_LAYOUTS: Record<MapId, CityLayout> = {
  tokyo: {
    id: "tokyo",
    bounds,
    roads: [...legacyGridRoads, ...legacyDriftRoads],
    trafficRoutes: [],
    signalJunctions: [
      { x: -116, z: -116 }, { x: 0, z: -116 }, { x: 116, z: 0 }, { x: 58, z: 116 },
    ],
    parcels: [
      { x: 145, z: 145, width: 18, depth: 18, rotation: 0, zone: "downtown" },
      { x: 145, z: 87, width: 18, depth: 18, rotation: 0, zone: "downtown" },
      { x: 145, z: 29, width: 18, depth: 18, rotation: 0, zone: "downtown" },
      { x: 145, z: -29, width: 18, depth: 18, rotation: 0, zone: "downtown" },
      { x: 145, z: -87, width: 18, depth: 18, rotation: 0, zone: "downtown" },
      { x: 145, z: -145, width: 18, depth: 18, rotation: 0, zone: "downtown" },
      { x: -145, z: 145, width: 18, depth: 18, rotation: 0, zone: "downtown" },
      { x: -145, z: 87, width: 18, depth: 18, rotation: 0, zone: "downtown" },
      { x: -145, z: 29, width: 18, depth: 18, rotation: 0, zone: "downtown" },
      { x: -145, z: -29, width: 18, depth: 18, rotation: 0, zone: "downtown" },
      { x: -145, z: -87, width: 18, depth: 18, rotation: 0, zone: "downtown" },
      { x: -145, z: -145, width: 18, depth: 18, rotation: 0, zone: "downtown" },
    ],
  },
  yokohama: {
    id: "yokohama",
    bounds: { minX: -210, maxX: 210, minZ: -140, maxZ: 140 },
    roads: [
      road("central-market-ring", circularRoadPoints(0, 0, 42, 0, Math.PI * 2, 64), 14),
      road("papina-street", [
        { x: -194, z: -82 }, { x: -151, z: -67 }, { x: -108, z: -51 }, { x: -68, z: -37 }, { x: -30, z: -29 },
      ], 12),
      road("pobedy-avenue", [
        { x: -171, z: 123 }, { x: -135, z: 95 }, { x: -98, z: 66 }, { x: -62, z: 39 }, { x: -30, z: 29 },
      ], 14),
      road("nedelina-street", [
        { x: 4, z: -130 }, { x: 0, z: -92 }, { x: -4, z: -58 }, { x: -5, z: -39 },
        { x: -5, z: 0 }, { x: -5, z: 39 }, { x: -2, z: 77 }, { x: 4, z: 121 },
      ], 12),
      road("moskovskaya-street", [
        { x: -198, z: 18 }, { x: -153, z: 16 }, { x: -111, z: 14 }, { x: -72, z: 11 }, { x: -42, z: 5 },
      ], 12),
      road("8-marta-street", [
        { x: 29, z: -30 }, { x: 67, z: -39 }, { x: 109, z: -51 }, { x: 151, z: -68 }, { x: 198, z: -91 },
      ], 11),
    ],
    trafficRoutes: [],
    signalJunctions: [
      { x: 0, z: -42 }, { x: 0, z: 42 },
    ],
    parcels: [],
  },
};

CITY_LAYOUTS.tokyo.trafficRoutes = [
  {
    id: "tokyo-outer-traffic",
    points: [
      { x: -116, z: -116 }, { x: 116, z: -116 }, { x: 116, z: 116 },
      { x: -116, z: 116 }, { x: -116, z: -116 },
    ],
  },
  route("tokyo-downtown-traffic", CITY_LAYOUTS.tokyo.roads.find((item) => item.id === "drift-ring")!),
];
CITY_LAYOUTS.yokohama.trafficRoutes = [
  route("yokohama-market-traffic", CITY_LAYOUTS.yokohama.roads.find((item) => item.id === "central-market-ring")!),
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
  const x = segment.a.x + dx * t - (dz / length) * lateral;
  const z = segment.a.z + dz * t + (dx / length) * lateral;
  return {
    x: Math.max(layout.bounds.minX, Math.min(layout.bounds.maxX, x)),
    z: Math.max(layout.bounds.minZ, Math.min(layout.bounds.maxZ, z)),
  };
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
