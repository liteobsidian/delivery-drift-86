import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { cityLayoutFor, isOnLayoutRoad } from "./map-layouts";
import { MAP_IDS } from "./types";
import { Traffic, trafficLanePosition, smoothedRouteTangent, type RouteData } from "./traffic";
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

  it("spawns every initial NPC outside the player's immediate camera area", () => {
    const traffic = makeTraffic();
    for (const car of traffic.debugPositions()) {
      expect(Math.hypot(car.x, car.z), `NPC ${car.id} spawned near the player`).toBeGreaterThanOrEqual(100);
    }
    traffic.dispose();
  });

  it("rechecks spawn clearance when switching maps and player positions", () => {
    const traffic = makeTraffic();
    const player = new THREE.Vector3(40, 0, 30);
    traffic.setWorld({ layout: cityLayoutFor("yokohama"), lights: [] } as unknown as World, player);
    const cars = traffic.debugPositions();
    expect(cars.length).toBeGreaterThan(0);
    for (const car of cars) {
      expect(Math.hypot(car.x - player.x, car.z - player.z)).toBeGreaterThanOrEqual(100);
    }
    traffic.dispose();
  });

  it("spawns during play outside the forward view and keeps traffic on all five road networks", () => {
    const player = new THREE.Vector3();
    const velocity = new THREE.Vector3();
    const visible = (x: number, z: number) => Math.abs(x) < -z * 0.55;
    for (const id of MAP_IDS) {
      const layout = cityLayoutFor(id);
      const traffic = new Traffic({ layout, lights: [] } as unknown as World, player);
      const seen = new Set(traffic.debugPositions().map((car) => car.id));
      const initialCount = seen.size;
      for (let step = 0; step < 1500; step++) {
        traffic.update(1 / 60, player, velocity, 0, visible);
        for (const car of traffic.debugPositions()) {
          expect(isOnLayoutRoad(layout, car.x, car.z), id).toBe(true);
          if (seen.has(car.id)) continue;
          expect(visible(car.x, car.z), id).toBe(false);
          expect(Math.hypot(car.x, car.z)).toBeGreaterThanOrEqual(99);
          seen.add(car.id);
        }
      }
      expect(seen.size, id).toBeGreaterThan(initialCount);
      traffic.dispose();
    }
  });

  it("reuses the same starting fleet on a fixed challenge and resumes ordinary spawns after it", () => {
    const player = new THREE.Vector3(95, 0, 58);
    const velocity = new THREE.Vector3();
    const world = { layout: cityLayoutFor("spb"), lights: [] } as unknown as World;
    const traffic = new Traffic(world);
    traffic.resetForPlayer(player, 46051);
    const grid = traffic.debugPositions();
    for (let step = 0; step < 30 * 60; step++) traffic.update(1 / 60, player, velocity, 0);
    expect(traffic.debugPositions()).toHaveLength(grid.length);
    traffic.resetForPlayer(player, 46051);
    expect(traffic.debugPositions()).toEqual(grid);
    traffic.resetForPlayer(player);
    for (let step = 0; step < 30 * 60; step++) traffic.update(1 / 60, player, velocity, 0);
    expect(traffic.debugPositions().length).toBeGreaterThan(grid.length);
    traffic.dispose();
  });

  it("repositions traffic around the exact start point without rebuilding routes", () => {
    const traffic = makeTraffic();
    const player = new THREE.Vector3(72, 0, -48);
    traffic.resetForPlayer(player);
    for (const car of traffic.debugPositions()) {
      expect(Math.hypot(car.x - player.x, car.z - player.z)).toBeGreaterThanOrEqual(100);
    }
    traffic.dispose();
  });

  it("keeps lane position and heading continuous across a sharp corner", () => {
    const route: RouteData = {
      points: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }, { x: 0, z: 0 }],
      cumulative: [0, 10, 20, 30, 40],
      tangents: [{ x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }, { x: 0, z: -1 }],
      length: 40,
    };
    const before = smoothedRouteTangent(route, 0, 9.99, 1);
    const after = smoothedRouteTangent(route, 1, 10.01, 1);
    const beforePosition = trafficLanePosition({ x: 9.99, z: 0 }, before, 3.5);
    const afterPosition = trafficLanePosition({ x: 10, z: 0.01 }, after, 3.5);
    expect(Math.hypot(afterPosition.x - beforePosition.x, afterPosition.z - beforePosition.z)).toBeLessThan(0.1);
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(0.01);
    const reverseBefore = smoothedRouteTangent(route, 1, 10.01, -1);
    const reverseAfter = smoothedRouteTangent(route, 0, 9.99, -1);
    expect(Math.hypot(reverseAfter.x - reverseBefore.x, reverseAfter.z - reverseBefore.z)).toBeLessThan(0.01);
  });

  it("keeps lane position continuous when adjacent route segments are short", () => {
    const route: RouteData = {
      points: [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 2 }, { x: 0, z: 2 }, { x: 0, z: 0 }],
      cumulative: [0, 2, 4, 6, 8],
      tangents: [{ x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }, { x: 0, z: -1 }],
      length: 8,
    };
    const before = smoothedRouteTangent(route, 0, 1.999, 1);
    const after = smoothedRouteTangent(route, 1, 2.001, 1);
    const beforePosition = trafficLanePosition({ x: 1.999, z: 0 }, before, 3.5);
    const afterPosition = trafficLanePosition({ x: 2, z: 0.001 }, after, 3.5);
    expect(Math.hypot(afterPosition.x - beforePosition.x, afterPosition.z - beforePosition.z)).toBeLessThan(0.02);
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(0.005);
  });

  it("limits NPC speed changes to a small fixed-step acceleration", () => {
    const traffic = makeTraffic();
    const before = traffic.debugPositions();
    traffic.update(0.05, new THREE.Vector3(500, 0, 500), new THREE.Vector3(), 0);
    const after = traffic.debugPositions();
    before.forEach((car, index) => {
      expect(Math.abs(after[index].actualSpeed - car.actualSpeed)).toBeLessThanOrEqual(0.51);
    });
    traffic.dispose();
  });

  it("interpolates rendered transforms between fixed traffic steps", () => {
    const traffic = makeTraffic();
    const car = traffic.debugPositions()[0];
    traffic.update(0.05, new THREE.Vector3(500, 0, 500), new THREE.Vector3(), 0);
    const current = traffic.debugPositions().find((item) => item.id === car.id)!;
    const mesh = traffic.group.children[car.id] as THREE.Group;
    traffic.render(0);
    expect(mesh.position.x).toBeCloseTo(car.x);
    expect(mesh.position.z).toBeCloseTo(car.z);
    traffic.render(1);
    expect(mesh.position.x).toBeCloseTo(current.x);
    expect(mesh.position.z).toBeCloseTo(current.z);
    traffic.dispose();
  });

  it("keeps collision positions consistent with route progress", () => {
    const traffic = makeTraffic();
    const car = traffic.debugPositions()[0];
    const player = new THREE.Vector3(car.x - car.dx * 1.8, 0, car.z - car.dz * 1.8);
    const playerVelocity = new THREE.Vector3(car.dx * 22, 0, car.dz * 22);
    traffic.update(0.05, player, playerVelocity, 22);
    const afterContact = traffic.debugPositions().find((item) => item.id === car.id)!;
    traffic.update(0, new THREE.Vector3(500, 0, 500), new THREE.Vector3(), 0);
    const afterRepose = traffic.debugPositions().find((item) => item.id === car.id)!;
    expect(Math.hypot(afterRepose.x - afterContact.x, afterRepose.z - afterContact.z)).toBeLessThan(0.001);
    traffic.dispose();
  });

  it("depenetrates low speed and cooldown contacts without moving NPCs off route", () => {
    const traffic = makeTraffic();
    const car = traffic.debugPositions()[0];
    const routeState = { routeIndex: car.routeIndex, progress: car.progress };
    const player = new THREE.Vector3(car.x, 0, car.z);
    const playerVelocity = new THREE.Vector3();
    const firstHit = traffic.update(0, player, playerVelocity, 0);
    expect(firstHit).toBeGreaterThan(3);
    expect(Math.hypot(player.x - car.x, player.z - car.z)).toBeGreaterThanOrEqual(3.4);

    player.set(car.x, 0, car.z);
    const cooldownHit = traffic.update(0, player, playerVelocity, 0);
    expect(cooldownHit).toBe(0);
    expect(Math.hypot(player.x - car.x, player.z - car.z)).toBeGreaterThanOrEqual(3.4);
    const after = traffic.debugPositions().find((item) => item.id === car.id)!;
    expect(after.routeIndex).toBe(routeState.routeIndex);
    expect(after.progress).toBeCloseTo(routeState.progress);
    traffic.dispose();
  });
});
