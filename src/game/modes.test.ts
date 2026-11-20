import { describe, expect, it } from "vitest";
import { CARS } from "./config";
import { MAP_IDS } from "./types";
import { isOnLayoutRoad, cityLayoutFor } from "./map-layouts";
import { defaultProfile, mergeProfileData } from "./storage";
import { canUnlockCar, driftMedal, driftMultiplierForSeconds, finalDriftScore, modeReward, timeAttackCourse, timeAttackMedal } from "./modes";

describe("mode rewards and progression", () => {
  it("awards drift medals at reachable bronze, silver, and gold thresholds", () => {
    expect(driftMedal(249)).toBeNull();
    expect(driftMedal(250)).toBe("bronze");
    expect(driftMedal(500)).toBe("silver");
    expect(driftMedal(750)).toBe("gold");
  });

  it("uses the displayed rounded score for drift medals and payouts", () => {
    const score = finalDriftScore(499.6);
    expect(score).toBe(500);
    expect(driftMedal(score)).toBe("silver");
    expect(modeReward("drift-trial", driftMedal(score), score)).toBe(450);
  });

  it("pays for drift score even below bronze and scales rewards by medal", () => {
    expect(modeReward("drift-trial", null, 0)).toBe(0);
    expect(modeReward("drift-trial", null, 20)).toBeGreaterThan(0);
    expect(modeReward("drift-trial", null, 800, false)).toBe(0);
    expect(modeReward("drift-trial", null, 800)).toBe(200);
    expect(modeReward("drift-trial", "bronze", 250)).toBe(180);
    expect(modeReward("drift-trial", "silver", 500)).toBe(450);
    expect(modeReward("drift-trial", "gold", 750)).toBe(900);
  });

  it("raises and caps the drift multiplier as the chain continues", () => {
    expect(driftMultiplierForSeconds(0)).toBe(1);
    expect(driftMultiplierForSeconds(1.99)).toBe(1);
    expect(driftMultiplierForSeconds(2)).toBe(2);
    expect(driftMultiplierForSeconds(8)).toBe(5);
    expect(driftMultiplierForSeconds(40)).toBe(5);
  });

  it("builds fixed ordered Time Attack courses on all five maps", () => {
    expect(timeAttackCourse("tokyo").routeId).toBe("tokyo-outer-traffic");
    expect(timeAttackCourse("yokohama").routeId).toBe("yokohama-freight-traffic");
    for (const mapId of MAP_IDS) {
      const course = timeAttackCourse(mapId);
      expect(course.checkpoints.every(({ x, z }) => isOnLayoutRoad(cityLayoutFor(mapId), x, z))).toBe(true);
      expect(course.length).toBeGreaterThan(500);
      expect(course.checkpoints).toHaveLength(5);
      expect(course.checkpoints.at(-1)).toEqual(course.start);
      expect(course.goldTime).toBeLessThan(course.silverTime);
      expect(course.silverTime).toBeLessThan(course.bronzeTime);
      expect(course.timeLimit).toBe(course.bronzeTime + 25);
      expect(Number.isFinite(course.heading)).toBe(true);
    }
  });

  it("awards Time Attack medals by fixed course thresholds", () => {
    const course = timeAttackCourse("tokyo");
    expect(timeAttackMedal(course, course.goldTime)).toBe("gold");
    expect(timeAttackMedal(course, course.silverTime)).toBe("silver");
    expect(timeAttackMedal(course, course.bronzeTime)).toBe("bronze");
    expect(timeAttackMedal(course, course.timeLimit)).toBeNull();
  });

  it("pays the Time Attack medal tier", () => {
    expect(modeReward("time-attack", null, 0)).toBe(100);
    expect(modeReward("time-attack", "bronze", 0)).toBe(300);
    expect(modeReward("time-attack", "silver", 0)).toBe(650);
    expect(modeReward("time-attack", "gold", 0)).toBe(1100);
  });

  it("keeps delivery unlocks and adds mode achievement unlocks", () => {
    const profile = defaultProfile();
    const silvia = CARS.find((car) => car.id === "silvia")!;
    const evo = CARS.find((car) => car.id === "evo")!;
    expect(canUnlockCar(silvia, profile)).toBe(false);
    profile.unlockedAch.push("drifter-silver");
    expect(canUnlockCar(silvia, profile)).toBe(true);
    expect(canUnlockCar(evo, profile)).toBe(false);
    profile.unlockedAch.push("time-attack-gold");
    expect(canUnlockCar(evo, profile)).toBe(true);
    profile.unlockedAch = [];
    profile.deliveries = 60;
    expect(canUnlockCar(evo, profile)).toBe(true);
  });

  it("merges new nested stats into legacy saves", () => {
    const defaults = defaultProfile();
    const migrated = mergeProfileData({ money: 1200, stats: { jumps: 4 } });
    expect(migrated.money).toBe(1200);
    expect(migrated.stats.jumps).toBe(4);
    expect(migrated.stats.timeAttackMedal).toBe(defaults.stats.timeAttackMedal);
    expect(migrated.stats.redLights).toBe(defaults.stats.redLights);
  });
});
