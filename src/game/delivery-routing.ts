import { sampleRoadPoint, type CityLayout, type CityPoint } from "./map-layouts";

interface RoadSegment {
  a: CityPoint;
  b: CityPoint;
  dx: number;
  dz: number;
  length: number;
  width: number;
  road: number;
  cuts: Map<number, number>;
}
interface Destination { dest: CityPoint; distance: number }

const ORIGIN = { x: 0, z: 0 };
const CELL_SIZE = 32;
const cache = new WeakMap<CityLayout, DeliveryNetwork>();

function projection(segment: RoadSegment, point: CityPoint): { t: number; offset: number } {
  const { a, dx, dz, length } = segment;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / (length * length)));
  return { t, offset: Math.hypot(point.x - a.x - dx * t, point.z - a.z - dz * t) };
}

class DeliveryNetwork {
  private readonly segments: RoadSegment[] = [];
  private readonly distances: number[];

  constructor(layout: CityLayout) {
    const edges: [neighbor: number, length: number][][] = [];
    const nodeIds = new Map<string, number>();
    const addCut = (segment: RoadSegment, t: number) => {
      const x = segment.a.x + segment.dx * t;
      const z = segment.a.z + segment.dz * t;
      const key = `${Math.round(x * 1e5)},${Math.round(z * 1e5)}`;
      let id = nodeIds.get(key);
      if (id === undefined) {
        id = edges.length;
        nodeIds.set(key, id);
        edges.push([]);
      }
      segment.cuts.set(t, id);
      return id;
    };
    const connect = (a: number, b: number, length: number) => {
      if (a === b) return;
      edges[a].push([b, length]);
      edges[b].push([a, length]);
    };

    const connectRoads = (a: RoadSegment, b: RoadSegment) => {
      const den = a.dx * b.dz - a.dz * b.dx;
      if (Math.abs(den) > 1e-8) {
        const x = b.a.x - a.a.x;
        const z = b.a.z - a.a.z;
        const t = (x * b.dz - z * b.dx) / den;
        const u = (x * a.dz - z * a.dx) / den;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
          connect(addCut(a, t), addCut(b, u), 0);
          return;
        }
      }

      if (a.road === b.road) return;
      // Some authored streets meet through their paved width, even when the centrelines stop short.
      const clearance = Math.min(a.width, b.width) / 2;
      const connectEnd = (from: RoadSegment, to: RoadSegment, end: 0 | 1) => {
        const { t, offset } = projection(to, end ? from.b : from.a);
        if (offset <= clearance) connect(addCut(from, end), addCut(to, t), offset);
      };
      connectEnd(a, b, 0);
      connectEnd(a, b, 1);
      connectEnd(b, a, 0);
      connectEnd(b, a, 1);
    };

    // Compare only nearby segments. The graph is built once, outside the driving loop.
    const cells = new Map<string, RoadSegment[]>();
    for (const [road, path] of layout.roads.entries()) {
      for (let i = 1; i < path.points.length; i++) {
        const a = path.points[i - 1];
        const b = path.points[i];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const length = Math.hypot(dx, dz);
        if (!length) continue;
        const width = path.width;
        const segment: RoadSegment = { a, b, dx, dz, length, width, road, cuts: new Map() };
        this.segments.push(segment);
        addCut(segment, 0);
        addCut(segment, 1);
        const padding = width / 2;
        const neighbors = new Set<RoadSegment>();
        for (let x = Math.floor((Math.min(a.x, b.x) - padding) / CELL_SIZE); x <= Math.floor((Math.max(a.x, b.x) + padding) / CELL_SIZE); x++) {
          for (let z = Math.floor((Math.min(a.z, b.z) - padding) / CELL_SIZE); z <= Math.floor((Math.max(a.z, b.z) + padding) / CELL_SIZE); z++) {
            const key = `${x},${z}`;
            const cell = cells.get(key);
            if (cell) {
              for (const other of cell) neighbors.add(other);
              cell.push(segment);
            } else cells.set(key, [segment]);
          }
        }
        for (const other of neighbors) connectRoads(segment, other);
      }
    }

    const start = edges.length;
    edges.push([]);
    for (const segment of this.segments) {
      const { t, offset } = projection(segment, ORIGIN);
      if (offset <= segment.width / 2) connect(start, addCut(segment, t), offset);
      const cuts = [...segment.cuts].sort(([a], [b]) => a - b);
      for (let i = 1; i < cuts.length; i++) {
        const [from, a] = cuts[i - 1];
        const [to, b] = cuts[i];
        connect(a, b, (to - from) * segment.length);
      }
    }

    this.distances = edges.map(() => Infinity);
    this.distances[start] = 0;
    const frontier = new Set([start]);
    while (frontier.size) {
      let nearest = -1;
      for (const id of frontier) {
        if (nearest < 0 || this.distances[id] < this.distances[nearest]) nearest = id;
      }
      frontier.delete(nearest);
      for (const [neighbor, length] of edges[nearest]) {
        const distance = this.distances[nearest] + length;
        if (distance >= this.distances[neighbor]) continue;
        this.distances[neighbor] = distance;
        frontier.add(neighbor);
      }
    }
  }

  distanceTo(point: CityPoint): number {
    let best = Infinity;
    for (const segment of this.segments) {
      const { t, offset } = projection(segment, point);
      if (offset > segment.width / 2) continue;
      for (const [cut, node] of segment.cuts) {
        best = Math.min(best, this.distances[node] + Math.abs(t - cut) * segment.length + offset);
      }
    }
    return best;
  }
}

export function deliveryDistance(layout: CityLayout, dest: CityPoint): number {
  let network = cache.get(layout);
  if (!network) {
    network = new DeliveryNetwork(layout);
    cache.set(layout, network);
  }
  return network.distanceTo(dest);
}

export function sampleDeliveryDestination(
  layout: CityLayout, rng: () => number, used: Set<string>, min: number, max = Infinity,
): Destination | undefined {
  let fallback: Destination | undefined;
  let fallbackKey = "";
  for (let attempt = 0; attempt < 40; attempt++) {
    const dest = sampleRoadPoint(layout, rng);
    const key = `${Math.round(dest.x / 10)},${Math.round(dest.z / 10)}`;
    if (used.has(key)) continue;
    const distance = deliveryDistance(layout, dest);
    if (!(distance > 0 && Number.isFinite(distance))) continue;
    if (distance >= min && distance <= max) {
      used.add(key);
      return { dest, distance };
    }
    if (!fallback) {
      fallback = { dest, distance };
      fallbackKey = key;
    }
  }
  if (fallback) used.add(fallbackKey);
  return fallback;
}
