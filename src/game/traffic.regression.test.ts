import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { cityLayoutFor } from "./map-layouts";
import { Traffic, trafficLanePosition } from "./traffic";
import type { World } from "./world";

interface TrafficDebugCar {
  x: number;
  z: number;
  dx: number;
  dz: number;
  dir: 1 | -1;
  routeIndex: number;
  progress: number;
  routeLength: number;
}

function makeTraffic(): Traffic {
  const world = { layout: cityLayoutFor("tokyo"), lights: [] } as unknown as World;
  return new Traffic(world);
}

describe("NPC traffic regressions", () => {
  it("keeps traffic moving in opposite directions on opposite lanes", () => {
    const forward = trafficLanePosition({ x: 0, z: 0 }, { x: 1, z: 0 }, 3.5);
    const reverse = trafficLanePosition({ x: 0, z: 0 }, { x: -1, z: 0 }, 3.5);
    expect(forward.z).toBeLessThan(reverse.z);
    expect(Math.hypot(forward.x - reverse.x, forward.z - reverse.z)).toBeCloseTo(7);
  });

  it("faces in the direction its route progress actually moves", () => {
    const traffic = makeTraffic();
    const before = traffic.debugPositions() as unknown as TrafficDebugCar[];
    expect(before.some((car) => car.dir === -1)).toBe(true);
    traffic.update(0.05, new THREE.Vector3(500, 0, 500), new THREE.Vector3(), 0);
    const after = traffic.debugPositions() as unknown as TrafficDebugCar[];
    before.forEach((car, index) => {
      const moved = after[index];
      const dx = moved.x - car.x;
      const dz = moved.z - car.z;
      expect(dx * car.dx + dz * car.dz, `car ${index} moved against its heading`).toBeGreaterThan(0.1);
    });
    traffic.dispose();
  });

  it("keeps NPCs from spawning and driving in tight same-lane packs", () => {
    const traffic = makeTraffic();
    const farAway = new THREE.Vector3(500, 0, 500);
    for (let step = 0; step < 450; step++) {
      traffic.update(0.1, farAway, new THREE.Vector3(), 0);
    }
    const cars = traffic.debugPositions() as unknown as TrafficDebugCar[];
    expect(cars.length).toBeGreaterThanOrEqual(8);
    expect(cars.length).toBeLessThanOrEqual(10);
    for (const car of cars) {
      expect(car.routeIndex).toBeDefined();
      expect(car.routeLength).toBeGreaterThan(0);
      expect(car.progress).toBeGreaterThanOrEqual(0);
    }
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i];
      const b = cars[j];
      if (a.routeIndex !== b.routeIndex || a.dir !== b.dir) continue;
      const delta = Math.abs(a.progress - b.progress);
      const gap = Math.min(delta, a.routeLength - delta);
      expect(gap, `same-lane NPC gap ${gap.toFixed(1)}m`).toBeGreaterThanOrEqual(16);
    }
    traffic.dispose();
  });
});
