import { describe, expect, it } from "vitest";
import { CITY_LAYOUTS, isOnLayoutRoad, type CityLayout } from "./map-layouts";
import { RoadSpatialIndex } from "./road-spatial-index";
import { centerlineRuns, transverseMarking } from "./road-surface";

const crossing: CityLayout = {
  ...CITY_LAYOUTS.sochi,
  roads: [
    { id: "horizontal", width: 10, points: [{ x: -30, z: 0 }, { x: 30, z: 0 }] },
    { id: "vertical", width: 12, points: [{ x: 0, z: -30 }, { x: 0, z: 30 }] },
  ],
};

describe("road surface markings", () => {
  it("interrupts both centerlines before they reach shared asphalt", () => {
    const index = new RoadSpatialIndex(crossing);
    for (const road of crossing.roads) {
      const runs = centerlineRuns(road, index);
      const axis = road.id === "horizontal" ? "x" : "z";
      const junctionEdge = crossing.roads.find((other) => other !== road)!.width / 2;
      expect(runs).toHaveLength(2);
      expect(runs[0].points.at(-1)![axis]).toBeLessThan(-junctionEdge);
      expect(runs[1].points[0][axis]).toBeGreaterThan(junctionEdge);
      expect(runs[0].points[0][axis]).toBeLessThan(-25);
      expect(runs[1].points.at(-1)![axis]).toBeGreaterThan(25);
      expect(runs[1].distance).toBeGreaterThan(30);
    }
  });

  it("fits signal markings to the approach width and leaves unpaved ground clear", () => {
    const index = new RoadSpatialIndex(crossing);
    const stripe = transverseMarking(index, 10, 0, true, 0.42)!;
    expect(stripe.width).toBeGreaterThan(8);
    expect(stripe.width).toBeLessThan(10);
    expect(stripe.z).toBeCloseTo(0);
    expect(transverseMarking(index, 10, 20, true, 0.42)).toBeNull();
  });

  it("shares the same pavement as the original map queries", () => {
    for (const layout of Object.values(CITY_LAYOUTS)) {
      const index = new RoadSpatialIndex(layout);
      const bounds = layout.bounds;
      for (let z = bounds.minZ; z <= bounds.maxZ; z += 13.2) for (let x = bounds.minX; x <= bounds.maxX; x += 11.7) {
        expect(index.covers(x, z), `${layout.id} at ${x},${z}`).toBe(isOnLayoutRoad(layout, x, z));
      }
    }
  });
});
