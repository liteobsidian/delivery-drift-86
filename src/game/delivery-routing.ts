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
type Edge = [node: number, distance: number];

const ORIGIN = { x: 0, z: 0 };
const CELL_SIZE = 32;
const LOOK_AHEAD = 14;
const cache = new WeakMap<CityLayout, DeliveryNetwork>();

function projection(segment: RoadSegment, point: CityPoint): { t: number; offset: number } {
  const { a, dx, dz, length } = segment;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / (length * length)));
  return { t, offset: Math.hypot(point.x - a.x - dx * t, point.z - a.z - dz * t) };
}

class RouteQueue {
  private entries: Edge[] = [];

  push(entry: Edge): void {
    let i = this.entries.length;
    this.entries.push(entry);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.entries[parent][1] <= entry[1]) break;
      this.entries[i] = this.entries[parent];
      i = parent;
    }
    this.entries[i] = entry;
  }

  pop(): Edge | undefined {
    const first = this.entries[0];
    const last = this.entries.pop();
    if (!last || this.entries.length === 0) return first;
    let i = 0;
    while (2 * i + 1 < this.entries.length) {
      let child = 2 * i + 1;
      if (child + 1 < this.entries.length && this.entries[child + 1][1] < this.entries[child][1]) child++;
      if (last[1] <= this.entries[child][1]) break;
      this.entries[i] = this.entries[child];
      i = child;
    }
    this.entries[i] = last;
    return first;
  }
}

class DeliveryNetwork {
  private readonly segments: RoadSegment[] = [];
  private readonly cells = new Map<string, RoadSegment[]>();
  private readonly edges: Edge[][] = [];
  private readonly nodes: CityPoint[] = [];
  private readonly distances: Float64Array;

  constructor(layout: CityLayout) {
    const nodeIds = new Map<string, number>();
    const addCut = (segment: RoadSegment, t: number) => {
      const x = segment.a.x + segment.dx * t;
      const z = segment.a.z + segment.dz * t;
      const key = `${Math.round(x * 1e5)},${Math.round(z * 1e5)}`;
      let id = nodeIds.get(key);
      if (id === undefined) {
        id = this.edges.length;
        nodeIds.set(key, id);
        this.edges.push([]);
        this.nodes.push({ x, z });
      }
      segment.cuts.set(t, id);
      return id;
    };
    const connect = (a: number, b: number, length: number) => {
      if (a === b) return;
      this.edges[a].push([b, length]);
      this.edges[b].push([a, length]);
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
            const cell = this.cells.get(key);
            if (cell) {
              for (const other of cell) neighbors.add(other);
              cell.push(segment);
            } else this.cells.set(key, [segment]);
          }
        }
        for (const other of neighbors) connectRoads(segment, other);
      }
    }

    const start = this.edges.length;
    this.edges.push([]);
    this.nodes.push(ORIGIN);
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

    this.distances = this.routeFrom([[start, 0]]).distances;
  }

  private routeFrom(seeds: Edge[]) {
    const distances = new Float64Array(this.edges.length).fill(Infinity);
    const next = new Int32Array(this.edges.length).fill(-1);
    const queue = new RouteQueue();
    for (const [node, distance] of seeds) {
      if (distance >= distances[node]) continue;
      distances[node] = distance;
      queue.push([node, distance]);
    }
    for (let current = queue.pop(); current; current = queue.pop()) {
      const [node, length] = current;
      if (length !== distances[node]) continue;
      for (const [neighbor, edgeLength] of this.edges[node]) {
        const distance = length + edgeLength;
        if (distance >= distances[neighbor]) continue;
        distances[neighbor] = distance;
        next[neighbor] = node;
        queue.push([neighbor, distance]);
      }
    }
    return { distances, next };
  }

  private nearby(point: CityPoint): RoadSegment[] {
    return this.cells.get(`${Math.floor(point.x / CELL_SIZE)},${Math.floor(point.z / CELL_SIZE)}`) ?? [];
  }

  distanceTo(point: CityPoint): number {
    let best = Infinity;
    for (const segment of this.nearby(point)) {
      const { t, offset } = projection(segment, point);
      if (offset > segment.width / 2) continue;
      for (const [cut, node] of segment.cuts) {
        best = Math.min(best, this.distances[node] + Math.abs(t - cut) * segment.length + offset);
      }
    }
    return best;
  }

  /** Build one distance field per objective. Positions on the road only inspect their own grid cell. */
  guideTo(goal: CityPoint): (point: CityPoint) => CityPoint {
    const seeds: Edge[] = [];
    const goalSegments = new Map<RoadSegment, ReturnType<typeof projection>>();
    for (const segment of this.nearby(goal)) {
      const access = projection(segment, goal);
      if (access.offset > segment.width / 2) continue;
      goalSegments.set(segment, access);
      for (const [cut, node] of segment.cuts) {
        seeds.push([node, Math.abs(access.t - cut) * segment.length + access.offset]);
      }
    }
    if (!seeds.length) return () => goal;
    const { distances, next } = this.routeFrom(seeds);
    const connected = this.segments.filter((segment) =>
      [...segment.cuts.values()].some((id) => Number.isFinite(distances[id])));
    return (point) => {
      let best = Infinity;
      let first = -1;
      let roadPoint = point;
      for (const segment of this.nearby(point)) {
        const { t, offset } = projection(segment, point);
        if (offset > segment.width / 2) continue;
        const goalAccess = goalSegments.get(segment);
        if (goalAccess) {
          const distance = offset + Math.abs(t - goalAccess.t) * segment.length + goalAccess.offset;
          if (distance < best) {
            first = -1;
            best = distance;
          }
        }
        for (const [cut, node] of segment.cuts) {
          const distance = offset + Math.abs(t - cut) * segment.length + distances[node];
          if (distance >= best) continue;
          best = distance;
          first = node;
          roadPoint = { x: segment.a.x + t * segment.dx, z: segment.a.z + t * segment.dz };
        }
      }
      if (first === -1) {
        if (Number.isFinite(best)) return goal;
        // When off the network, take the closest point on a connected road back into it.
        for (const segment of connected) {
          const { t, offset } = projection(segment, point);
          if (offset >= best) continue;
          best = offset;
          roadPoint = { x: segment.a.x + t * segment.dx, z: segment.a.z + t * segment.dz };
        }
        return Number.isFinite(best) ? roadPoint : goal;
      }
      let remaining = LOOK_AHEAD;
      for (let node = first; ; node = next[node]) {
        const ahead = node >= 0 ? this.nodes[node] : goal;
        const dx = ahead.x - roadPoint.x;
        const dz = ahead.z - roadPoint.z;
        const length = Math.hypot(dx, dz);
        if (length >= remaining) {
          return { x: roadPoint.x + dx * remaining / length, z: roadPoint.z + dz * remaining / length };
        }
        if (node < 0) return goal;
        remaining -= length;
        roadPoint = ahead;
      }
    };
  }
}

function deliveryNetwork(layout: CityLayout): DeliveryNetwork {
  let network = cache.get(layout);
  if (!network) {
    network = new DeliveryNetwork(layout);
    cache.set(layout, network);
  }
  return network;
}

export function deliveryDistance(layout: CityLayout, dest: CityPoint): number {
  return deliveryNetwork(layout).distanceTo(dest);
}

export function guideAlongRoads(layout: CityLayout, target: CityPoint): (point: CityPoint) => CityPoint {
  return deliveryNetwork(layout).guideTo(target);
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
