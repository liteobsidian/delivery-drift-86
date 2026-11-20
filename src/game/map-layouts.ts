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
export interface WaterArea { id: string; points: CityPoint[] }
export type CityLandmarkKind = "spire" | "palace" | "kremlin" | "mosque" | "cauldron" | "stadium" | "palm-row" | "marina" | "bridge" | "torii" | "radio-tower" | "port-tower";
export interface CityLandmark {
  id: string;
  kind: CityLandmarkKind;
  x: number;
  z: number;
  width: number;
  depth: number;
  rotation: number;
}
export type PortSiteKind = "warehouse" | "container-yard" | "gantry-crane" | "pier" | "cargo-ship" | "tank-farm";
export interface PortSite {
  id: string;
  kind: PortSiteKind;
  x: number;
  z: number;
  width: number;
  depth: number;
  rotation: number;
}
export interface CityLayout {
  id: MapId;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  roads: RoadPath[];
  trafficRoutes: TrafficRoute[];
  signalJunctions: CityPoint[];
  parcels: CityParcel[];
  waterAreas: WaterArea[];
  portSites: PortSite[];
  landmarks: CityLandmark[];
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
    waterAreas: [],
    portSites: [],
    landmarks: [
      { id: "shrine-gate", kind: "torii", x: 18, z: 18, width: 12, depth: 12, rotation: 0 },
      { id: "tokyo-radio-tower", kind: "radio-tower", x: 87, z: 87, width: 20, depth: 20, rotation: 0 },
    ],
  },
  yokohama: {
    id: "yokohama",
    bounds: { minX: -210, maxX: 210, minZ: -140, maxZ: 140 },
    roads: [
      road("port-spine", [
        { x: 0, z: -121 }, { x: 5, z: -95 }, { x: -3, z: -54 }, { x: 0, z: -20 },
        { x: 0, z: 17 }, { x: 0, z: 43 },
      ], 14),
      road("west-approach", [
        { x: -200, z: 43 }, { x: -200, z: 54 }, { x: -194, z: 60 }, { x: -169, z: 64 },
        { x: -135, z: 62 }, { x: -103, z: 58 }, { x: -93, z: 54 }, { x: -82, z: 41 },
        { x: -59, z: 31 }, { x: -41, z: 19.2 },
      ], 14),
      road("port-roundabout", circularRoadPoints(-25, 0, 25, 0, Math.PI * 2, 48), 13),
      road("market-arterial", [
        { x: -203, z: -23 }, { x: -165, z: -18 }, { x: -121, z: -20 }, { x: -77, z: -27 },
        { x: -35, z: -23 }, { x: 0, z: -22 }, { x: 55, z: -24 }, { x: 110, z: -25 },
        { x: 160, z: -27 }, { x: 190.7, z: -31 },
      ], 12),
      road("quay-road", [
        { x: -200, z: 43 }, { x: -162, z: 48 }, { x: -122, z: 46 }, { x: -82, z: 41 },
        { x: -42, z: 46 }, { x: 0, z: 43 }, { x: 40, z: 47 }, { x: 80, z: 44 }, { x: 105, z: 42 },
        { x: 127, z: 37 }, { x: 150, z: 36 }, { x: 169, z: 41 },
      ], 12),
      road("freight-loop", [
        { x: -172, z: -119 }, { x: -124, z: -127 }, { x: -68, z: -112 }, { x: -8, z: -122 },
        { x: 52, z: -115 }, { x: 112, z: -124 }, { x: 162, z: -96 }, { x: 168, z: -58 },
        { x: 144, z: -32 }, { x: 102, z: -35 }, { x: 48, z: -52 }, { x: 0, z: -45 },
        { x: -47, z: -65 }, { x: -95, z: -86 }, { x: -142, z: -61 }, { x: -174, z: -36 },
        { x: -182, z: -73 }, { x: -172, z: -119 },
      ], 13),
      road("dock-service-road", [
        { x: 36, z: 46 }, { x: 51, z: 52 }, { x: 66, z: 53 }, { x: 73, z: 58 }, { x: 73, z: 98 },
      ], 10),
      road("west-loading-road", [
        { x: 12, z: 45 }, { x: 20, z: 53 }, { x: 29, z: 60 }, { x: 29, z: 98 },
      ], 10),
      road("east-loading-road", [
        { x: 80, z: 44 }, { x: 92, z: 52 }, { x: 103, z: 60 }, { x: 103, z: 98 },
      ], 10),
      road("west-yard-road", [
        { x: -102, z: 43.5 }, { x: -78, z: 24 }, { x: -72, z: -8 },
      ], 11),
      road("east-terminal-road", [
        { x: 162, z: -96 }, { x: 155, z: -65 }, { x: 145, z: -39 },
        { x: 130, z: -5 }, { x: 121, z: 27 }, { x: 105, z: 42 },
      ], 11),
      road("west-terminal-loop", [
        { x: -144, z: -42 }, { x: -126, z: -59 }, { x: -101, z: -68 }, { x: -84, z: -55 },
        { x: -91, z: -33 }, { x: -112, z: -24 }, { x: -138, z: -26 }, { x: -144, z: -42 },
      ], 9.5),
      road("east-terminal-loop", [
        { x: 55, z: -21 }, { x: 72, z: -40 }, { x: 101, z: -44 }, { x: 122, z: -25 },
        { x: 112, z: -2 }, { x: 86, z: 7 }, { x: 62, z: 2 }, { x: 55, z: -21 },
      ], 9.5),
      road("south-service-road", [
        { x: -72, z: -8 }, { x: -72, z: -36 }, { x: -78, z: -67 }, { x: -72, z: -96 }, { x: -68, z: -112 },
      ], 10),
      road("north-terminal-service", [
        { x: -82, z: 41 }, { x: -89, z: 21 }, { x: -95, z: -5 }, { x: -92, z: -28 },
      ], 9),
      road("east-yard-road", [
        { x: 145, z: -39 }, { x: 158, z: -61 }, { x: 180, z: -71 }, { x: 190, z: -53 },
        { x: 191, z: -19 }, { x: 177, z: 10 }, { x: 169, z: 41 },
      ], 10),
      road("west-freight-link", [{ x: -203, z: -23 }, { x: -203, z: -50 }, { x: -182, z: -73 }], 10),
    ],
    trafficRoutes: [],
    signalJunctions: [
      { x: 0, z: -23 }, { x: 0, z: 43 },
    ],
    parcels: [],
    waterAreas: [{
      id: "north-harbor-inlet",
      points: [
        { x: -210, z: 140 }, { x: -150, z: 140 }, { x: -98, z: 140 }, { x: -53, z: 140 },
        { x: -8, z: 140 }, { x: 39, z: 140 }, { x: 88, z: 140 }, { x: 128, z: 140 },
        { x: 165, z: 140 }, { x: 210, z: 140 }, { x: 210, z: 98 }, { x: 183, z: 100 },
        { x: 158, z: 111 }, { x: 138, z: 100 }, { x: 120, z: 80 }, { x: 102, z: 61 },
        { x: 82, z: 57 }, { x: 60, z: 61 }, { x: 39, z: 73 }, { x: 15, z: 81 },
        { x: -10, z: 82 }, { x: -35, z: 77 }, { x: -60, z: 69 }, { x: -90, z: 66 },
        { x: -120, z: 72 }, { x: -150, z: 82 }, { x: -178, z: 79 }, { x: -205, z: 72 },
      ],
    }],
    portSites: [
      { id: "west-gate-warehouse", kind: "warehouse", x: -157, z: 7, width: 34, depth: 24, rotation: 0.08 },
      { id: "west-inland-warehouse", kind: "warehouse", x: -145, z: -95, width: 40, depth: 22, rotation: 0.12 },
      { id: "south-terminal-warehouse", kind: "warehouse", x: -30, z: -90, width: 38, depth: 22, rotation: 0 },
      { id: "east-terminal-warehouse", kind: "warehouse", x: 74, z: -83, width: 38, depth: 24, rotation: -0.08 },
      { id: "west-gate-container-yard", kind: "container-yard", x: -191, z: 5, width: 24, depth: 16, rotation: 0 },
      { id: "south-container-yard", kind: "container-yard", x: 60, z: -90, width: 40, depth: 22, rotation: -0.04 },
      { id: "east-container-yard", kind: "container-yard", x: 187, z: 60, width: 28, depth: 18, rotation: 0 },
      { id: "east-tank-farm", kind: "tank-farm", x: 190, z: -112, width: 22, depth: 18, rotation: 0 },
      { id: "west-gantry-crane", kind: "gantry-crane", x: 29, z: 85, width: 30, depth: 20, rotation: 0 },
      { id: "east-gantry-crane", kind: "gantry-crane", x: 103, z: 85, width: 30, depth: 20, rotation: 0 },
      { id: "west-loading-pier", kind: "pier", x: 29, z: 85, width: 30, depth: 50, rotation: 0 },
      { id: "cargo-pier", kind: "pier", x: 73, z: 85, width: 18, depth: 58, rotation: 0 },
      { id: "east-loading-pier", kind: "pier", x: 103, z: 83, width: 30, depth: 54, rotation: 0 },
      { id: "moored-cargo-ship", kind: "cargo-ship", x: 90, z: 125, width: 60, depth: 17, rotation: 0 },
    ],
    landmarks: [
      { id: "marine-observation-tower", kind: "port-tower", x: 135, z: 55, width: 12, depth: 12, rotation: 0 },
    ],
  },
  spb: {
    id: "spb",
    bounds,
    roads: [
      road("spb-embankment-loop", [
        { x: -145, z: -116 }, { x: 145, z: -116 }, { x: 145, z: 95 },
        { x: -145, z: 95 }, { x: -145, z: -116 },
      ], 13),
      road("spb-nevsky-avenue", [
        { x: -145, z: -116 }, { x: -116, z: -94 }, { x: -76, z: -61 }, { x: -37, z: -31 },
        { x: 0, z: 0 }, { x: 38, z: 31 }, { x: 78, z: 62 }, { x: 116, z: 82 }, { x: 145, z: 95 },
      ], 14),
      road("spb-west-avenue", [{ x: -116, z: -116 }, { x: -116, z: 145 }], 11),
      road("spb-west-grid", [
        { x: -60, z: -116 }, { x: -55, z: -90 }, { x: -70, z: -63 },
        { x: -64, z: -38 }, { x: -58, z: 0 }, { x: -58, z: 95 },
      ], 11),
      road("spb-central-avenue", [{ x: 0, z: -116 }, { x: 0, z: 145 }], 13),
      road("spb-east-grid", [
        { x: 64, z: -116 }, { x: 70, z: -72 }, { x: 61, z: -49 },
        { x: 58, z: 0 }, { x: 58, z: 95 },
      ], 11),
      road("spb-east-avenue", [{ x: 116, z: -116 }, { x: 116, z: 145 }], 11),
      road("spb-south-embankment", [{ x: -145, z: -58 }, { x: 145, z: -58 }], 11),
      road("spb-sadovaya-street", [{ x: -145, z: 0 }, { x: 145, z: 0 }], 11),
      road("spb-palace-street", [{ x: -145, z: 58 }, { x: 145, z: 58 }], 11),
      road("spb-riverfront-road", [{ x: -116, z: 145 }, { x: 116, z: 145 }], 12),
      road("spb-palace-ring", circularRoadPoints(0, 0, 38, 0, Math.PI * 2, 48), 12),
      road("spb-backstreets", [
        { x: -145, z: -83 }, { x: -116, z: -80 }, { x: -96, z: -75 },
        { x: -70, z: -63 }, { x: -41, z: -72 }, { x: -20, z: -70 }, { x: 0, z: -58 },
      ], 9.5),
    ],
    trafficRoutes: [],
    signalJunctions: [{ x: 0, z: -58 }, { x: 58, z: 58 }],
    parcels: [],
    waterAreas: [{
      id: "neva-waterfront",
      points: [
        { x: -218, z: 104 }, { x: 218, z: 104 }, { x: 218, z: 136 }, { x: -218, z: 136 },
      ],
    }],
    portSites: [],
    landmarks: [
      { id: "admiralty-spire", kind: "spire", x: 29, z: 78, width: 34, depth: 16, rotation: 0 },
      { id: "palace-embankment", kind: "palace", x: -29, z: 78, width: 37, depth: 18, rotation: 0 },
      { id: "west-neva-bridge", kind: "bridge", x: -116, z: 120, width: 13, depth: 34, rotation: 0 },
      { id: "central-neva-bridge", kind: "bridge", x: 0, z: 120, width: 15, depth: 34, rotation: 0 },
      { id: "east-neva-bridge", kind: "bridge", x: 116, z: 120, width: 13, depth: 34, rotation: 0 },
    ],
  },
  kazan: {
    id: "kazan",
    bounds,
    roads: [
      road("kazan-kremlin-loop", [
        { x: -145, z: -145 }, { x: 145, z: -145 }, { x: 145, z: 145 },
        { x: -145, z: 145 }, { x: -145, z: -145 },
      ], 13),
      road("kazan-university-boulevard", [
        { x: -145, z: -8 }, { x: -92, z: -9 }, { x: -58, z: 0 }, { x: 0, z: 0 },
        { x: 62, z: 0 }, { x: 112, z: -12 }, { x: 145, z: -25 },
      ], 13),
      road("kazan-central-prospect", [
        { x: -15, z: -145 }, { x: -11, z: -77 }, { x: 0, z: -37 }, { x: 0, z: 0 },
        { x: 0, z: 58 }, { x: -11, z: 110 }, { x: -30, z: 145 },
      ], 13),
      road("kazan-volga-prospect", [
        { x: 116, z: -145 }, { x: 116, z: -58 }, { x: 122, z: -3 },
        { x: 132, z: 45 }, { x: 130, z: 102 }, { x: 145, z: 134 },
      ], 11),
      road("kazan-market-street", [
        { x: -145, z: -99 }, { x: -116, z: -85 }, { x: -90, z: -55 }, { x: -92, z: -9 },
        { x: -78, z: 28 }, { x: -63, z: 71 }, { x: -93, z: 116 }, { x: -110, z: 145 },
      ], 10),
      road("kazan-old-town", [
        { x: -145, z: 76 }, { x: -111, z: 68 }, { x: -71, z: 70 }, { x: -39, z: 58 },
        { x: 0, z: 58 }, { x: 24, z: 55 }, { x: 73, z: 57 }, { x: 118, z: 65 }, { x: 145, z: 76 },
      ], 10),
      road("kazan-university-lane", [
        { x: -13, z: -107 }, { x: 19, z: -103 }, { x: 47, z: -85 },
        { x: 86, z: -70 }, { x: 116, z: -58 }, { x: 145, z: -58 },
      ], 11),
      road("kazan-kremlin-diagonal", [
        { x: -145, z: -145 }, { x: -106, z: -98 }, { x: -54, z: -52 }, { x: 0, z: 0 },
        { x: 45, z: 48 }, { x: 94, z: 99 }, { x: 145, z: 145 },
      ], 13),
      road("kazan-stadium-diagonal", [
        { x: -145, z: 145 }, { x: -104, z: 100 }, { x: -55, z: 50 }, { x: 0, z: 0 },
        { x: 53, z: -51 }, { x: 101, z: -99 }, { x: 145, z: -145 },
      ], 12),
      road("kazan-central-ring", circularRoadPoints(0, 0, 37, 0, Math.PI * 2, 48), 12),
    ],
    trafficRoutes: [],
    signalJunctions: [{ x: 0, z: 58 }, { x: -92, z: -9 }, { x: 116, z: -58 }],
    parcels: [],
    waterAreas: [{
      id: "volga-riverbank",
      points: [
        { x: 154, z: -218 }, { x: 218, z: -218 }, { x: 218, z: 218 }, { x: 154, z: 218 },
      ],
    }],
    portSites: [],
    landmarks: [
      { id: "soyembika-tower", kind: "kremlin", x: 28, z: 86, width: 31, depth: 23, rotation: -0.1 },
      { id: "kul-sharif-mosque", kind: "mosque", x: 88, z: 23, width: 29, depth: 24, rotation: 0.1 },
      { id: "kazan-family-centre", kind: "cauldron", x: 130, z: -96, width: 12, depth: 15, rotation: 0 },
    ],
  },
  sochi: {
    id: "sochi",
    bounds,
    roads: [
      road("sochi-coast-loop", [
        { x: 0, z: -132 }, { x: 64, z: -138 }, { x: 126, z: -122 }, { x: 151, z: -88 },
        { x: 145, z: -44 }, { x: 118, z: -10 }, { x: 98, z: 28 }, { x: 111, z: 64 },
        { x: 84, z: 100 }, { x: 40, z: 126 }, { x: 0, z: 135 }, { x: -48, z: 126 },
        { x: -91, z: 103 }, { x: -116, z: 72 }, { x: -103, z: 38 }, { x: -132, z: 8 },
        { x: -148, z: -38 }, { x: -144, z: -83 }, { x: -103, z: -117 }, { x: -45, z: -139 },
        { x: 0, z: -132 },
      ], 13),
      road("sochi-mountain-switchbacks", [
        { x: 0, z: 135 }, { x: 36, z: 112 }, { x: -12, z: 87 }, { x: 24, z: 62 },
        { x: -24, z: 40 }, { x: 14, z: 15 }, { x: -35, z: -12 }, { x: 0, z: -41 },
        { x: -48, z: -61 }, { x: -45, z: -139 },
      ], 12),
      road("sochi-resort-avenue", [{ x: 0, z: -132 }, { x: 0, z: 0 }, { x: 0, z: 135 }], 13),
      road("sochi-midtown-boulevard", [{ x: -135, z: 0 }, { x: 112, z: 0 }], 12),
      road("sochi-north-ridge-road", [
        { x: -110, z: 80 }, { x: -70, z: 84 }, { x: -30, z: 75 }, { x: 0, z: 70 },
        { x: 40, z: 80 }, { x: 75, z: 92 }, { x: 84, z: 100 },
      ], 11),
      road("sochi-olympic-ring", circularRoadPoints(62, -60, 38, 0, Math.PI * 2, 40), 12),
      road("sochi-seaside-promenade", [
        { x: -103, z: -117 }, { x: -109, z: -135 }, { x: -99, z: -147 }, { x: -70, z: -151 },
        { x: -30, z: -152 }, { x: 16, z: -151 }, { x: 45, z: -147 }, { x: 64, z: -138 },
      ], 9.5),
      road("sochi-park-connector", [{ x: 98, z: 28 }, { x: 90, z: -6 }, { x: 86, z: -37 }], 10),
    ],
    trafficRoutes: [],
    signalJunctions: [{ x: 0, z: 0 }, { x: 0, z: 70 }],
    parcels: [],
    waterAreas: [{
      id: "black-sea-coast",
      points: [
        { x: -218, z: -218 }, { x: 218, z: -218 }, { x: 218, z: -160 }, { x: -218, z: -160 },
      ],
    }],
    portSites: [],
    landmarks: [
      { id: "fisht-stadium", kind: "stadium", x: 62, z: -60, width: 45, depth: 35, rotation: 0 },
      { id: "marine-terminal", kind: "marina", x: -78, z: -104, width: 29, depth: 16, rotation: 0 },
      { id: "promenade-palms", kind: "palm-row", x: -70, z: -76, width: 18, depth: 10, rotation: 0.15 },
      { id: "seaside-palms", kind: "palm-row", x: -83, z: -139, width: 16, depth: 5, rotation: -0.06 },
    ],
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
  route("yokohama-freight-traffic", CITY_LAYOUTS.yokohama.roads.find((item) => item.id === "freight-loop")!),
  route("yokohama-port-traffic", CITY_LAYOUTS.yokohama.roads.find((item) => item.id === "port-roundabout")!),
];
CITY_LAYOUTS.spb.trafficRoutes = [
  route("spb-embankment-loop", CITY_LAYOUTS.spb.roads.find((item) => item.id === "spb-embankment-loop")!),
  route("spb-palace-loop", CITY_LAYOUTS.spb.roads.find((item) => item.id === "spb-palace-ring")!),
];
CITY_LAYOUTS.kazan.trafficRoutes = [
  route("kazan-kremlin-loop", CITY_LAYOUTS.kazan.roads.find((item) => item.id === "kazan-kremlin-loop")!),
  route("kazan-central-traffic", CITY_LAYOUTS.kazan.roads.find((item) => item.id === "kazan-central-ring")!),
];
CITY_LAYOUTS.sochi.trafficRoutes = [
  route("sochi-coast-loop", CITY_LAYOUTS.sochi.roads.find((item) => item.id === "sochi-coast-loop")!),
  route("sochi-olympic-traffic", CITY_LAYOUTS.sochi.roads.find((item) => item.id === "sochi-olympic-ring")!),
];

const pointSegmentDistance = (px: number, pz: number, a: CityPoint, b: CityPoint): number => {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length2 = dx * dx + dz * dz;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / length2));
  return Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t));
};

export function cityLayoutFor(id: MapId): CityLayout { return CITY_LAYOUTS[id]; }

export function gantrySupports(site: PortSite) {
  const c = Math.cos(site.rotation);
  const s = Math.sin(site.rotation);
  return [-1, 1].flatMap((side) => [-1, 1].map((end) => {
    const localX = side * site.width * 0.42;
    const localZ = end * site.depth * 0.38;
    return {
      localX, localZ, width: 2.2, depth: 2, rotation: site.rotation,
      x: site.x + localX * c - localZ * s,
      z: site.z + localX * s + localZ * c,
    };
  }));
}

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
