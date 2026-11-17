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
    bounds,
    roads: [
      road("outer-coastal-loop", [
        { x: -162, z: -140 }, { x: -112, z: -154 }, { x: -58, z: -144 }, { x: 0, z: -154 },
        { x: 58, z: -144 }, { x: 115, z: -152 }, { x: 157, z: -122 }, { x: 148, z: -78 },
        { x: 162, z: -32 }, { x: 146, z: 12 }, { x: 159, z: 58 }, { x: 140, z: 108 },
        { x: 100, z: 146 }, { x: 42, z: 138 }, { x: -14, z: 156 }, { x: -72, z: 142 },
        { x: -124, z: 152 }, { x: -157, z: 112 }, { x: -146, z: 64 }, { x: -160, z: 20 },
        { x: -145, z: -22 }, { x: -161, z: -74 }, { x: -137, z: -111 }, { x: -162, z: -140 },
      ], 14),
      road("harbor-loop", [
        { x: -124, z: -88 }, { x: -76, z: -100 }, { x: -24, z: -90 }, { x: 28, z: -102 },
        { x: 78, z: -91 }, { x: 113, z: -58 }, { x: 108, z: -17 }, { x: 126, z: 24 },
        { x: 105, z: 65 }, { x: 60, z: 82 }, { x: 8, z: 72 }, { x: -44, z: 87 },
        { x: -96, z: 64 }, { x: -121, z: 28 }, { x: -109, z: -22 }, { x: -124, z: -88 },
      ], 12),
      road("north-terminal", [{ x: -150, z: -118 }, { x: -110, z: -105 }, { x: -65, z: -114 }, { x: -15, z: -102 }, { x: 40, z: -119 }, { x: 93, z: -100 }, { x: 151, z: -112 }], 11),
      road("north-ward", [{ x: -152, z: -76 }, { x: -100, z: -68 }, { x: -50, z: -81 }, { x: 0, z: -70 }, { x: 54, z: -79 }, { x: 104, z: -64 }, { x: 151, z: -74 }], 11),
      road("market-street", [{ x: -154, z: -30 }, { x: -112, z: -15 }, { x: -68, z: -31 }, { x: -18, z: -12 }, { x: 32, z: -34 }, { x: 81, z: -16 }, { x: 122, z: -35 }, { x: 153, z: -28 }], 10),
      road("central-avenue", [{ x: -152, z: 0 }, { x: -100, z: 0 }, { x: -50, z: 0 }, { x: 0, z: 0 }, { x: 50, z: 0 }, { x: 100, z: 0 }, { x: 152, z: 0 }], 14),
      road("south-ward", [{ x: -152, z: 34 }, { x: -113, z: 48 }, { x: -72, z: 27 }, { x: -28, z: 44 }, { x: 0, z: 38 }, { x: 37, z: 19 }, { x: 69, z: 34 }, { x: 105, z: 41 }, { x: 153, z: 31 }], 11),
      road("quay-road", [{ x: -149, z: 78 }, { x: -116, z: 65 }, { x: -78, z: 76 }, { x: -42, z: 61 }, { x: 0, z: 70 }, { x: 50, z: 85 }, { x: 100, z: 68 }, { x: 149, z: 78 }], 11),
      road("south-terminal", [{ x: -132, z: 118 }, { x: -103, z: 103 }, { x: -72, z: 115 }, { x: -34, z: 122 }, { x: 20, z: 106 }, { x: 74, z: 121 }, { x: 104, z: 108 }, { x: 123, z: 105 }], 10),
      road("western-gate", [{ x: -124, z: -142 }, { x: -120, z: -98 }, { x: -132, z: -50 }, { x: -124, z: -2 }, { x: -116, z: 48 }, { x: -128, z: 98 }, { x: -124, z: 145 }], 11),
      road("west-market", [{ x: -78, z: -145 }, { x: -72, z: -98 }, { x: -83, z: -50 }, { x: -69, z: 0 }, { x: -82, z: 50 }, { x: -70, z: 100 }, { x: -78, z: 145 }], 10),
      road("canal-street", [{ x: -32, z: -146 }, { x: -42, z: -99 }, { x: -30, z: -51 }, { x: -40, z: -5 }, { x: -28, z: 44 }, { x: -39, z: 96 }, { x: -24, z: 151 }], 10),
      road("central-spine", [{ x: 0, z: -150 }, { x: 0, z: -100 }, { x: 0, z: -50 }, { x: 0, z: 0 }, { x: 0, z: 50 }, { x: 0, z: 100 }, { x: 0, z: 150 }], 12),
      road("east-market", [{ x: 54, z: -145 }, { x: 48, z: -98 }, { x: 54, z: -50 }, { x: 50, z: 0 }, { x: 58, z: 50 }, { x: 46, z: 100 }, { x: 54, z: 145 }], 10),
      road("eastern-gate", [{ x: 108, z: -142 }, { x: 114, z: -98 }, { x: 105, z: -50 }, { x: 116, z: 0 }, { x: 109, z: 50 }, { x: 121, z: 100 }, { x: 108, z: 145 }], 11),
      road("harbor-gate", [{ x: 148, z: -140 }, { x: 139, z: -94 }, { x: 151, z: -48 }, { x: 143, z: 0 }, { x: 155, z: 48 }, { x: 141, z: 94 }, { x: 148, z: 140 }], 9),
      road("northwest-diagonal", [{ x: -148, z: -136 }, { x: -105, z: -119 }, { x: -64, z: -91 }, { x: -28, z: -56 }, { x: -5, z: -22 }], 9),
      road("northeast-diagonal", [{ x: 8, z: -40 }, { x: 42, z: -76 }, { x: 77, z: -104 }, { x: 116, z: -123 }, { x: 153, z: -130 }], 9),
      road("west-river-cut", [{ x: -151, z: 20 }, { x: -114, z: 3 }, { x: -78, z: -9 }, { x: -45, z: -28 }, { x: -20, z: -56 }], 9),
      road("south-river-cut", [{ x: -92, z: 146 }, { x: -59, z: 110 }, { x: -35, z: 78 }, { x: -8, z: 54 }, { x: 25, z: 42 }, { x: 52, z: 21 }], 9),
      road("east-quay-link", [{ x: 47, z: 18 }, { x: 79, z: 42 }, { x: 111, z: 62 }, { x: 141, z: 76 }], 9),
      road("west-neighborhood-loop", [{ x: -109, z: -50 }, { x: -94, z: -21 }, { x: -102, z: 13 }, { x: -83, z: 43 }, { x: -109, z: 67 }, { x: -124, z: 48 }, { x: -109, z: -50 }], 8.5),
      road("east-neighborhood-loop", [{ x: 78, z: -53 }, { x: 93, z: -24 }, { x: 82, z: 8 }, { x: 101, z: 35 }, { x: 82, z: 57 }, { x: 66, z: 38 }, { x: 78, z: -53 }], 8.5),
      road("old-town-loop", [{ x: -43, z: 17 }, { x: -19, z: 11 }, { x: 14, z: 17 }, { x: 30, z: 42 }, { x: 17, z: 63 }, { x: -12, z: 68 }, { x: -37, z: 52 }, { x: -43, z: 17 }], 8.5),
      road("ferry-approach", [{ x: 145, z: 78 }, { x: 158, z: 99 }, { x: 143, z: 120 }, { x: 123, z: 105 }], 8.5),
      road("hillside-switchback", [{ x: -157, z: 112 }, { x: -139, z: 96 }, { x: -153, z: 79 }, { x: -133, z: 60 }, { x: -146, z: 42 }], 8.5),
      road("backstreet-s", [{ x: 24, z: -145 }, { x: 45, z: -129 }, { x: 36, z: -109 }, { x: 55, z: -92 }, { x: 40, z: -77 }, { x: 54, z: -58 }], 8.5),
      road("dock-service-loop", [{ x: 120, z: -98 }, { x: 136, z: -75 }, { x: 127, z: -51 }, { x: 148, z: -35 }, { x: 135, z: -13 }, { x: 148, z: 0 }], 8.5),
    ],
    trafficRoutes: [],
    signalJunctions: [
      { x: -124, z: -70 }, { x: 54, z: -79 }, { x: 0, z: 38 }, { x: 108, z: 40 },
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
  route("yokohama-coastal-traffic", CITY_LAYOUTS.yokohama.roads.find((item) => item.id === "outer-coastal-loop")!),
  route("yokohama-port-traffic", CITY_LAYOUTS.yokohama.roads.find((item) => item.id === "harbor-loop")!),
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
