import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { BuildingSpatialIndex, resolveBuildingContacts } from "./building-spatial-index";
import type { AABB } from "./world";

describe("building collision spatial index", () => {
  it("matches linear collision resolution for rotated sites and large port buildings", () => {
    const buildings: AABB[] = [
      { minX: -4.2, maxX: 4.2, minZ: -4.2, maxZ: 4.2, collisionRect: { x: 0, z: 0, width: 8, depth: 4, rotation: Math.PI / 4 } },
      { minX: 28, maxX: 68, minZ: -14, maxZ: 14 },
      { minX: -66, maxX: -56, minZ: 20, maxZ: 32, collisionRect: { x: -61, z: 26, width: 12, depth: 5, rotation: 0.35 } },
      { minX: 100, maxX: 110, minZ: 100, maxZ: 110 },
    ];
    const index = new BuildingSpatialIndex(buildings);
    const all = buildings.map((_, i) => i);
    for (const point of [{ x: 1.2, z: 0.5 }, { x: 29, z: 0 }, { x: -62, z: 27 }, { x: 98, z: 100 }, { x: -100, z: -100 }]) {
      const linearPos = new THREE.Vector3(point.x, 0, point.z);
      const indexedPos = linearPos.clone();
      const linearVel = new THREE.Vector3(7, 0, -3);
      const indexedVel = linearVel.clone();
      const linearImpact = resolveBuildingContacts(buildings, all, linearPos, 1.5, linearVel);
      const nearby = index.query(point.x, point.z, 1.5);
      const indexedImpact = index.resolve(nearby, indexedPos, 1.5, indexedVel);
      expect(indexedPos.distanceTo(linearPos)).toBeLessThan(1e-8);
      expect(indexedVel.distanceTo(linearVel)).toBeLessThan(1e-8);
      expect(indexedImpact).toBeCloseTo(linearImpact);
    }
  });

  it("returns only nearby candidates for large city grids", () => {
    const buildings: AABB[] = [];
    for (let x = -200; x <= 200; x += 8) for (let z = -200; z <= 200; z += 8) {
      buildings.push({ minX: x - 3.5, maxX: x + 3.5, minZ: z - 3.5, maxZ: z + 3.5 });
    }
    const index = new BuildingSpatialIndex(buildings);
    expect(index.query(0, 0, 1.5).length).toBeLessThan(50);
    expect(buildings.length).toBeGreaterThan(2500);
  });
});
