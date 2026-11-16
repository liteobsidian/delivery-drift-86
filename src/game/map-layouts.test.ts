import { describe, expect, it } from "vitest";
import { CITY_LAYOUTS, cityLayoutFor, distanceToRoad, isOnLayoutRoad, parcelClearOfRoads, sampleRoadPoint } from "./map-layouts";

describe("hand-authored city layouts", () => {
  it("keeps the shared car spawn point on a road in both districts", () => {
    expect(isOnLayoutRoad(cityLayoutFor("tokyo"), 0, 0)).toBe(true);
    expect(isOnLayoutRoad(cityLayoutFor("yokohama"), 0, 0)).toBe(true);
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
    expect(yokohama.roads.length).toBeGreaterThan(8);
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
    expect(distanceToRoad(layout, mid.x, mid.z)).toBeLessThan(0.01);
    expect(isOnLayoutRoad(layout, mid.x, mid.z)).toBe(true);
    expect(distanceToRoad(layout, mid.x, mid.z + road.width)).toBeGreaterThan(road.width / 2);
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
      expect(layout.parcels.length).toBeGreaterThanOrEqual(10);
      for (const parcel of layout.parcels) {
        expect(parcelClearOfRoads(layout, parcel, 3), `${layout.id}: parcel (${parcel.x}, ${parcel.z}) overlaps a road`).toBe(true);
        expect(parcel.x - parcel.width / 2).toBeGreaterThanOrEqual(layout.bounds.minX);
        expect(parcel.x + parcel.width / 2).toBeLessThanOrEqual(layout.bounds.maxX);
        expect(parcel.z - parcel.depth / 2).toBeGreaterThanOrEqual(layout.bounds.minZ);
        expect(parcel.z + parcel.depth / 2).toBeLessThanOrEqual(layout.bounds.maxZ);
      }
    }
  });
});
