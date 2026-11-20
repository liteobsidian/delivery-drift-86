import { describe, expect, it } from "vitest";
import { deliveryDistance, sampleDeliveryDestination } from "./delivery-routing";
import { cityLayoutFor, isOnLayoutRoad } from "./map-layouts";
import { MAP_IDS } from "./types";

describe("delivery route distance", () => {
  it("measures the detour to a Neva bridge and back to the destination", () => {
    const distance = deliveryDistance(cityLayoutFor("spb"), { x: 55, z: 145 });
    expect(distance).toBeGreaterThan(170);
    expect(distance).toBeLessThan(260);
  });

  it("finds distinct reachable destinations on all five maps", () => {
    let seed = 12345;
    const rng = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
    for (const mapId of MAP_IDS) {
      const layout = cityLayoutFor(mapId);
      const used = new Set<string>();
      for (let i = 0; i < 3; i++) {
        const route = sampleDeliveryDestination(layout, rng, used, 90, 300)!;
        expect(route, mapId).toBeDefined();
        expect(isOnLayoutRoad(layout, route.dest.x, route.dest.z)).toBe(true);
        expect(route.distance).toBeGreaterThanOrEqual(Math.hypot(route.dest.x, route.dest.z) - 0.01);
        expect(route.distance).toBeLessThanOrEqual(300);
      }
      expect(used.size).toBe(3);
    }
  });
});
