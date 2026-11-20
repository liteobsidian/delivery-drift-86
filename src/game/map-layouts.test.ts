import { describe, expect, it } from "vitest";
import { ROAD_W } from "./config";
import { CITY_LAYOUTS, cityLayoutFor, distanceToRoad, distanceToRoadPath, isOnLayoutRoad, parcelClearOfRoads, sampleRoadPoint, worldLengthToTexturePixels, worldToTextureCoordinate } from "./map-layouts";

describe("hand-authored city layouts", () => {
  it("maps world geometry into the same ground-plane scale used by road queries", () => {
    const textureSize = 2048;
    const groundSize = 436;
    expect(worldToTextureCoordinate(150, groundSize, textureSize)).toBeCloseTo((368 / 436) * textureSize);
    expect(worldToTextureCoordinate(-groundSize / 2, groundSize, textureSize)).toBe(0);
    expect(worldLengthToTexturePixels(14, groundSize, textureSize)).toBeCloseTo((14 / 436) * textureSize);
  });

  it("keeps the shared car spawn point on a road in both districts", () => {
    expect(isOnLayoutRoad(cityLayoutFor("tokyo"), 0, 0)).toBe(true);
    expect(isOnLayoutRoad(cityLayoutFor("yokohama"), 0, 0)).toBe(true);
  });

  it("preserves Tokyo's previous square grid, center ring, and four sweepers", () => {
    const tokyo = cityLayoutFor("tokyo");
    for (const coordinate of [-174, -116, -58, 0, 58, 116, 174]) {
      expect(distanceToRoad(tokyo, coordinate, 21)).toBeCloseTo(0, 1);
      expect(distanceToRoad(tokyo, 21, coordinate)).toBeCloseTo(0, 1);
    }
    const ring = tokyo.roads.find((item) => item.id === "drift-ring");
    expect(ring).toBeDefined();
    expect(distanceToRoadPath(ring!, 44, 0)).toBeLessThan(0.1);
    const sweepers = tokyo.roads.filter((item) => item.id.startsWith("drift-sweeper-"));
    expect(sweepers).toHaveLength(4);
    for (const sweeper of sweepers) expect(sweeper.points.length).toBeGreaterThanOrEqual(9);
  });

  it("rebuilds Yokohama as a dense harbor network based on the supplied road layout", () => {
    const yokohama = cityLayoutFor("yokohama");
    expect(yokohama.roads.length).toBeGreaterThanOrEqual(12);
    expect(yokohama.bounds.maxX - yokohama.bounds.minX).toBeGreaterThan(yokohama.bounds.maxZ - yokohama.bounds.minZ);
    expect(yokohama.roads.map(({ id }) => id)).toEqual(expect.arrayContaining([
      "port-spine", "west-approach", "port-roundabout", "quay-road", "freight-loop", "dock-service-road",
    ]));
    const ring = yokohama.roads.find(({ id }) => id === "port-roundabout");
    expect(ring).toBeDefined();
    expect(ring!.points[0]).toEqual(ring!.points[ring!.points.length - 1]);
    expect(distanceToRoadPath(ring!, 0, 0)).toBeLessThan(0.1);
    expect(Math.min(...yokohama.roads.flatMap((item) => item.points.map((point) => point.x)))).toBeLessThanOrEqual(-180);
    expect(Math.max(...yokohama.roads.flatMap((item) => item.points.map((point) => point.x)))).toBeGreaterThanOrEqual(180);
  });

  it("gives Yokohama an interior harbor and explicitly placed port facilities", () => {
    const yokohama = cityLayoutFor("yokohama");
    expect(yokohama.waterAreas.map(({ id }) => id)).toContain("north-harbor-inlet");
    expect(yokohama.waterAreas[0].points.length).toBeGreaterThanOrEqual(12);
    expect(yokohama.portSites.map(({ kind }) => kind)).toEqual(expect.arrayContaining([
      "warehouse", "container-yard", "gantry-crane", "pier", "cargo-ship", "tank-farm",
    ]));
    expect(yokohama.portSites.length).toBeGreaterThanOrEqual(10);
    expect(yokohama.waterAreas.some((area) => {
      const ship = yokohama.portSites.find((site) => site.kind === "cargo-ship")!;
      let inside = false;
      for (let i = 0, j = area.points.length - 1; i < area.points.length; j = i++) {
        const a = area.points[i];
        const b = area.points[j];
        const crosses = (a.z > ship.z) !== (b.z > ship.z) && ship.x < ((b.x - a.x) * (ship.z - a.z)) / (b.z - a.z) + a.x;
        if (crosses) inside = !inside;
      }
      return inside;
    })).toBe(true);
  });

  it("keeps land-based port facilities inside bounds and clear of roads", () => {
    const yokohama = cityLayoutFor("yokohama");
    for (const site of yokohama.portSites.filter(({ kind }) => kind !== "pier" && kind !== "cargo-ship")) {
      const c = Math.cos(site.rotation);
      const s = Math.sin(site.rotation);
      const halfWidth = Math.abs(c) * site.width / 2 + Math.abs(s) * site.depth / 2;
      const halfDepth = Math.abs(s) * site.width / 2 + Math.abs(c) * site.depth / 2;
      expect(site.x - halfWidth).toBeGreaterThanOrEqual(yokohama.bounds.minX);
      expect(site.x + halfWidth).toBeLessThanOrEqual(yokohama.bounds.maxX);
      expect(site.z - halfDepth).toBeGreaterThanOrEqual(yokohama.bounds.minZ);
      expect(site.z + halfDepth).toBeLessThanOrEqual(yokohama.bounds.maxZ);
      expect(parcelClearOfRoads(yokohama, {
        x: site.x,
        z: site.z,
        width: site.width,
        depth: site.depth,
        rotation: site.rotation,
        zone: "port",
      }, 3), `${site.id} overlaps a road`).toBe(true);
    }
  });

  it.each(Object.values(CITY_LAYOUTS))("connects every $id street to the same drivable network", ({ roads }) => {
    const samples = roads.map((item) => item.points.slice(0, -1).flatMap((point, index) => {
      const next = item.points[index + 1];
      const length = Math.hypot(next.x - point.x, next.z - point.z);
      const count = Math.max(1, Math.ceil(length / 3));
      return Array.from({ length: count + 1 }, (_, step) => ({
        x: point.x + (next.x - point.x) * step / count,
        z: point.z + (next.z - point.z) * step / count,
      }));
    }));
    const neighbors = roads.map((item, index) => roads.flatMap((other, otherIndex) => {
      if (index === otherIndex) return [];
      const joined = samples[index].some((point) => distanceToRoadPath(other, point.x, point.z) <= (item.width + other.width) / 2);
      return joined ? [otherIndex] : [];
    }));
    const reached = new Set([0]);
    const pending = [0];
    while (pending.length) {
      for (const next of neighbors[pending.pop()!]) {
        if (!reached.has(next)) { reached.add(next); pending.push(next); }
      }
    }
    expect([...reached]).toHaveLength(roads.length);
  });

  it("keeps landmark footprints clear of driving lanes except for bridges", () => {
    for (const layout of Object.values(CITY_LAYOUTS)) for (const landmark of layout.landmarks) {
      if (landmark.kind === "bridge") {
        expect(isOnLayoutRoad(layout, landmark.x, landmark.z), landmark.id).toBe(true);
      } else {
        expect(parcelClearOfRoads(layout, { ...landmark, zone: "downtown" }, 0.3), landmark.id).toBe(true);
      }
    }
  });

  it("places signals only where a horizontal and vertical arterial meet", () => {
    for (const layout of Object.values(CITY_LAYOUTS)) {
      expect(layout.signalJunctions.length).toBeGreaterThanOrEqual(2);
      for (const point of layout.signalJunctions) {
        const hasAxisApproach = (horizontal: boolean) => layout.roads.some((road) => {
          for (let i = 0; i < road.points.length - 1; i++) {
            const a = road.points[i];
            const b = road.points[i + 1];
            const dx = b.x - a.x;
            const dz = b.z - a.z;
            if (horizontal ? Math.abs(dx) < Math.abs(dz) * 1.8 : Math.abs(dz) < Math.abs(dx) * 1.8) continue;
            const length2 = dx * dx + dz * dz;
            const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / length2));
            const distance = Math.hypot(point.x - (a.x + dx * t), point.z - (a.z + dz * t));
            if (distance <= road.width / 2) return true;
          }
          return false;
        });
        expect(hasAxisApproach(true), `${layout.id} signal lacks a horizontal approach at ${point.x},${point.z}`).toBe(true);
        expect(hasAxisApproach(false), `${layout.id} signal lacks a vertical approach at ${point.x},${point.z}`).toBe(true);
      }
    }
  });

  it("gives both districts different, drivable street shapes", () => {
    const tokyo = cityLayoutFor("tokyo");
    const yokohama = cityLayoutFor("yokohama");
    expect(tokyo.roads.length).toBeGreaterThan(8);
    expect(yokohama.roads.length).toBeGreaterThan(5);
    expect(tokyo.roads.map((road) => road.id)).not.toEqual(yokohama.roads.map((road) => road.id));
    for (const layout of [tokyo, yokohama]) {
      for (const road of layout.roads) {
        expect(road.points.length).toBeGreaterThanOrEqual(2);
        expect(road.width).toBeGreaterThanOrEqual(8);
        expect(road.width).toBeLessThanOrEqual(16);
      }
    }
  });

  it("measures points against straight, diagonal, and curved road centerlines", () => {
    const layout = cityLayoutFor("tokyo");
    const road = layout.roads.find((candidate) => candidate.points.length > 2)!;
    const [a, b] = road.points;
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const normal = { x: -(b.z - a.z) / length, z: (b.x - a.x) / length };
    expect(distanceToRoad(layout, mid.x, mid.z)).toBeLessThan(0.01);
    expect(isOnLayoutRoad(layout, mid.x, mid.z)).toBe(true);
    expect(distanceToRoadPath(road, mid.x + normal.x * road.width, mid.z + normal.z * road.width)).toBeGreaterThan(road.width / 2);
    expect(isOnLayoutRoad(layout, 0, 0)).toBe(
      distanceToRoad(layout, 0, 0) <= Math.min(...layout.roads.map((item) => item.width / 2)),
    );
  });

  it("samples deterministic delivery positions on the drivable network", () => {
    for (const layout of Object.values(CITY_LAYOUTS)) {
      let state = 0x12345678;
      const rng = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
      for (let i = 0; i < 200; i++) {
        const point = sampleRoadPoint(layout, rng);
        expect(isOnLayoutRoad(layout, point.x, point.z)).toBe(true);
        expect(point.x).toBeGreaterThanOrEqual(layout.bounds.minX);
        expect(point.x).toBeLessThanOrEqual(layout.bounds.maxX);
        expect(point.z).toBeGreaterThanOrEqual(layout.bounds.minZ);
        expect(point.z).toBeLessThanOrEqual(layout.bounds.maxZ);
      }
    }
  });

  it("keeps closed traffic loops on-road and parcels clear of every road", () => {
    for (const layout of Object.values(CITY_LAYOUTS)) {
      expect(layout.trafficRoutes.length).toBeGreaterThan(0);
      for (const route of layout.trafficRoutes) {
        expect(route.points[0]).toEqual(route.points[route.points.length - 1]);
        for (let i = 0; i < route.points.length - 1; i++) {
          const a = route.points[i];
          const b = route.points[i + 1];
          const length = Math.hypot(b.x - a.x, b.z - a.z);
          for (let d = 0; d <= length; d += 1) {
            const t = Math.min(1, d / length);
            expect(isOnLayoutRoad(layout, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)).toBe(true);
          }
        }
      }
      expect(layout.parcels.length).toBe(layout.id === "tokyo" ? 12 : 0);
      const overlappingParcels = layout.parcels.filter((parcel) => !parcelClearOfRoads(layout, parcel, 3));
      expect(overlappingParcels.map(({ x, z }) => ({ x, z })), `${layout.id}: parcels overlap new road corridors`).toEqual([]);
      for (const parcel of layout.parcels) {
        expect(parcel.x - parcel.width / 2).toBeGreaterThanOrEqual(layout.bounds.minX);
        expect(parcel.x + parcel.width / 2).toBeLessThanOrEqual(layout.bounds.maxX);
        expect(parcel.z - parcel.depth / 2).toBeGreaterThanOrEqual(layout.bounds.minZ);
        expect(parcel.z + parcel.depth / 2).toBeLessThanOrEqual(layout.bounds.maxZ);
      }
    }
  });

  it("keeps traffic lane offsets inside each map's playable bounds", () => {
    const laneOffset = ROAD_W / 4;
    for (const layout of Object.values(CITY_LAYOUTS)) {
      for (const route of layout.trafficRoutes) {
        for (const point of route.points) {
          expect(point.x - laneOffset).toBeGreaterThanOrEqual(layout.bounds.minX);
          expect(point.x + laneOffset).toBeLessThanOrEqual(layout.bounds.maxX);
          expect(point.z - laneOffset).toBeGreaterThanOrEqual(layout.bounds.minZ);
          expect(point.z + laneOffset).toBeLessThanOrEqual(layout.bounds.maxZ);
        }
      }
    }
  });
});
