import { describe, expect, it } from "vitest";
import { Car } from "./car";
import { CARS } from "./config";
import { World, type Ramp } from "./world";

const ramp: Ramp = { x: 30, z: -10, dx: 0.6, dz: 0.8, width: 4, length: 7 };
const world = Object.assign(Object.create(World.prototype) as World, { ramps: [ramp] });

describe("ramp driving surface", () => {
  it("rises to the same height from either toe and stays within the ramp footprint", () => {
    expect(world.rampHeightAt(27.9, -12.8)).toBeCloseTo(0);
    expect(world.rampHeightAt(28.95, -11.4)).toBeCloseTo(0.75);
    expect(world.rampHeightAt(30, -10)).toBeCloseTo(1.5);
    expect(world.rampHeightAt(31.05, -8.6)).toBeCloseTo(0.75);
    expect(world.rampHeightAt(32.1, -7.2)).toBeCloseTo(0);
    expect(world.rampHeightAt(28, -8.5)).toBe(0);
  });

  it("detects a swept crest crossing in both directions", () => {
    const forward = world.rampLaunchAt(27.6, -13.2, 33, -6, 0.15);
    const backward = world.rampLaunchAt(33, -6, 27.6, -13.2, 0.15);
    expect(forward?.fraction).toBeCloseTo(4 / 9);
    expect(backward?.fraction).toBeCloseTo(5 / 9);
    expect(forward?.height).toBeCloseTo(1.5);
    expect(backward?.height).toBeCloseTo(1.5);
    expect(forward?.alongSpeed).toBeCloseTo(60);
    expect(backward?.alongSpeed).toBeCloseTo(60);
  });

  it("allows walking-speed driving, side passes, and turning back before the crest without launching", () => {
    expect(world.rampLaunchAt(29.7, -10.4, 30.3, -9.6, 0.5)).toBeNull();
    expect(world.rampLaunchAt(25.6, -11.7, 30.4, -5.3, 0.1)).toBeNull();
    expect(world.rampLaunchAt(33.2, -12.4, 26.8, -7.6, 0.1)).toBeNull();
    expect(world.rampLaunchAt(29.4, -10.8, 28.2, -12.4, 0.1)).toBeNull();
  });

  it("launches on contact with the crest exactly once", () => {
    expect(world.rampLaunchAt(29.4, -10.8, 30, -10, 0.1)?.fraction).toBeCloseTo(1);
    expect(world.rampLaunchAt(30, -10, 30.6, -9.2, 0.1)).toBeNull();
  });
});

it("climbs, jumps, and lands without a back-wall impact from either direction", () => {
  const track = Object.assign(Object.create(world) as World, {
    isOnRoad: () => true,
    isCobble: () => false,
    puddleAt: () => null,
    collideBuildings: () => 0,
  });
  const idle = { steer: 0, throttle: 0, brake: 0, reverse: 0, handbrake: false, nitro: false };
  for (const direction of [-1, 1]) {
    const car = new Car(CARS[0]);
    const dx = ramp.dx * direction;
    const dz = ramp.dz * direction;
    car.resetPose(ramp.x - dx * 5, ramp.z - dz * 5, Math.atan2(dx, dz));
    car.vel.set(dx * 18, 0, dz * 18);
    let climbed = false;
    let jumped = false;
    let landing = 0;
    for (let step = 0; step < 110 && !landing; step++) {
      const result = car.step(1 / 60, idle, track);
      expect(result.impact).toBe(0);
      if (!jumped && !result.airborne && car.airY > 0.25) climbed = true;
      if (result.airborne) jumped = true;
      landing = result.landing;
    }
    expect(climbed).toBe(true);
    expect(jumped).toBe(true);
    expect(landing).toBeGreaterThan(6);
    expect(car.airY).toBe(0);
    car.dispose();
  }
});
