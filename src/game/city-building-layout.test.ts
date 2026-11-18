import { describe, expect, it } from "vitest";
import { cityLayoutFor, parcelClearOfRoads } from "./map-layouts";
import { circleOrientedRectContact, cityBuildingMeshYaw, generateCityBuildingSites } from "./city-building-layout";

function siteSignature(sites: ReturnType<typeof generateCityBuildingSites>): string {
  let hash = 2166136261;
  const source = sites.map((site) => [site.x, site.z, site.width, site.depth, site.rotation, site.height]
    .map((value) => Number(value.toFixed(6))).join(",")).join(";");
  for (let i = 0; i < source.length; i++) hash = Math.imul(hash ^ source.charCodeAt(i), 16777619) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

function pointInPolygon(x: number, z: number, points: { x: number; z: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    const crosses = (a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function rectsOverlap(
  a: { x: number; z: number; width: number; depth: number; rotation: number },
  b: { x: number; z: number; width: number; depth: number; rotation: number },
): boolean {
  const axes = [a.rotation, a.rotation + Math.PI / 2, b.rotation, b.rotation + Math.PI / 2]
    .map((angle) => ({ x: Math.cos(angle), z: Math.sin(angle) }));
  return axes.every((axis) => {
    const distance = Math.abs((b.x - a.x) * axis.x + (b.z - a.z) * axis.z);
    const radius = (rect: typeof a) => {
      const c = Math.cos(rect.rotation);
      const s = Math.sin(rect.rotation);
      return Math.abs(c * axis.x + s * axis.z) * rect.width / 2
        + Math.abs(-s * axis.x + c * axis.z) * rect.depth / 2;
    };
    return distance < radius(a) + radius(b);
  });
}

describe("generated city infill", () => {
  it("fills both maps with hundreds of deterministic buildings", () => {
    for (const id of ["tokyo", "yokohama"] as const) {
      const layout = cityLayoutFor(id);
      const first = generateCityBuildingSites(layout);
      expect(first.length, `${id} building count`).toBe(id === "tokyo" ? 663 : 368);
      expect(siteSignature(first), `${id} site transforms`).toBe(id === "tokyo" ? "b84c691e" : "18543cfa");
      expect(generateCityBuildingSites(layout)).toEqual(first);
    }
  });

  it("keeps building footprints off roads and harbor water", () => {
    for (const id of ["tokyo", "yokohama"] as const) {
      const layout = cityLayoutFor(id);
      for (const site of generateCityBuildingSites(layout)) {
        expect(parcelClearOfRoads(layout, {
          ...site,
          zone: id === "yokohama" ? "port" : "downtown",
        }, 1), `${id} site at ${site.x},${site.z} overlaps a road`).toBe(true);
        const localCorners = [
          [-site.width / 2, -site.depth / 2],
          [site.width / 2, -site.depth / 2],
          [-site.width / 2, site.depth / 2],
          [site.width / 2, site.depth / 2],
        ];
        const c = Math.cos(site.rotation);
        const s = Math.sin(site.rotation);
        const corners = localCorners.map(([x, z]) => [site.x + x * c - z * s, site.z + x * s + z * c]);
        for (const water of layout.waterAreas) {
          expect(corners.some(([x, z]) => pointInPolygon(x, z, water.points)), `${id} site at ${site.x},${site.z} overlaps water`).toBe(false);
        }
      }
    }
  });

  it("rejects a water shape contained inside a building footprint", () => {
    const layout = cityLayoutFor("tokyo");
    const source = generateCityBuildingSites(layout)[0];
    const water = {
      id: "test-water-inside-building",
      points: [
        { x: source.x - 1, z: source.z - 1 },
        { x: source.x + 1, z: source.z - 1 },
        { x: source.x + 1, z: source.z + 1 },
        { x: source.x - 1, z: source.z + 1 },
      ],
    };
    const sites = generateCityBuildingSites({ ...layout, waterAreas: [...layout.waterAreas, water] });
    expect(sites.some((site) => rectsOverlap(site, { x: source.x, z: source.z, width: 2, depth: 2, rotation: 0 }))).toBe(false);
  });

  it("keeps generated footprints separate from each other and authored harbor facilities", () => {
    for (const id of ["tokyo", "yokohama"] as const) {
      const layout = cityLayoutFor(id);
      const sites = generateCityBuildingSites(layout);
      for (let i = 0; i < sites.length; i++) {
        for (let j = i + 1; j < sites.length; j++) {
          expect(rectsOverlap(sites[i], sites[j]), `${id} buildings overlap at ${sites[i].x},${sites[i].z}`).toBe(false);
        }
        for (const authored of layout.portSites) {
          expect(rectsOverlap(sites[i], authored), `${id} building overlaps an authored facility`).toBe(false);
        }
      }
    }
  });

  it("fills the manually authored Tokyo parcels instead of leaving their pads empty", () => {
    const tokyo = cityLayoutFor("tokyo");
    const sites = generateCityBuildingSites(tokyo);
    for (const parcel of tokyo.parcels) {
      expect(sites.some((site) => rectsOverlap(site, parcel)), `empty parcel at ${parcel.x},${parcel.z}`).toBe(true);
    }
  });

  it("converts layout angles to Three.js yaw without flipping diagonal sites", () => {
    expect(cityBuildingMeshYaw(Math.PI / 4)).toBeCloseTo(-Math.PI / 4);
  });

  it("collides with the visible footprint of rotated buildings, not their empty AABB corners", () => {
    const rotated = { x: 0, z: 0, width: 8, depth: 4, rotation: Math.PI / 4 };
    expect(circleOrientedRectContact(4, 4, 0.7, rotated)).toBeNull();
    const inside = circleOrientedRectContact(0, 0, 0.7, rotated);
    expect(inside).not.toBeNull();
    expect(Math.hypot(inside!.nx, inside!.nz)).toBeCloseTo(1);
    expect(inside!.penetration).toBeGreaterThan(2.6);
  });
});
