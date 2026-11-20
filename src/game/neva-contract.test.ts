import { describe, expect, it } from "vitest";
import { cityLayoutFor, isOnLayoutRoad } from "./map-layouts";
import type { CityPoint } from "./map-layouts";
import { NEVA_CONTRACT, NEVA_SECTORS, NevaRun, nevaChallengeLink, nevaChallengeTarget, nevaResult } from "./neva-contract";
import { mergeProfileData } from "./storage";

function passSector(run: NevaRun, index: number, slip: number, hitAt = -1) {
  const { entry, corner, exit } = NEVA_SECTORS[index];
  let p = { x: entry.x - entry.dx, z: entry.z - entry.dz };
  const targets: CityPoint[] = [corner, { x: exit.x + exit.dx, z: exit.z + exit.dz }];
  let step = 0;
  for (const target of targets) {
    const start = p;
    for (let i = 1; i <= 30; i++) {
      const t = i / 30;
      const next = { x: start.x + (target.x - start.x) * t, z: start.z + (target.z - start.z) * t };
      run.update(p.x, p.z, next.x, next.z, 1 / 60, 12, slip, step++ !== hitAt);
      p = next;
    }
  }
}

describe("Neva contract", () => {
  it("places the starts, exits and both turns on playable roads", () => {
    const layout = cityLayoutFor(NEVA_CONTRACT.mapId);
    const points = [NEVA_CONTRACT.start, NEVA_CONTRACT.finish, ...NEVA_SECTORS.flatMap(({ entry, corner, exit }) => [entry, corner, exit])];
    expect(points.every(({ x, z }) => isOnLayoutRoad(layout, x, z))).toBe(true);
  });

  it("credits a clean drift once per sector and retains the strongest turn", () => {
    const run = new NevaRun();
    passSector(run, 0, 6);
    passSector(run, 0, 10);
    passSector(run, 1, 8);
    expect(run.cleanSectors).toBe(2);
    expect(run.bestSector).toBe(1);
    expect(run.pointsAt(1)).toBeGreaterThan(run.pointsAt(0));
  });

  it("allows a safe delivery and rejects a turn spoiled by contact", () => {
    const run = new NevaRun();
    passSector(run, 0, 0);
    passSector(run, 1, 8, 12);
    expect(run.cleanSectors).toBe(0);
    expect(run.bestSector).toBe(-1);
    expect(nevaResult(95, 20, run.cleanSectors)).toMatchObject({ driftBonus: 0, mastered: false });
  });

  it("requires a forward entry within the lane before scoring at the exit", () => {
    const run = new NevaRun();
    const { entry, exit } = NEVA_SECTORS[0];
    run.update(entry.x - 1, entry.z, entry.x + 1, entry.z, 0.3, 12, 8, true);
    run.update(entry.x + 1, entry.z + 10, entry.x - 1, entry.z + 10, 0.3, 12, 8, true);
    run.update(exit.x, exit.z - 1, exit.x, exit.z + 1, 0.3, 12, 8, true);
    expect(run.cleanSectors).toBe(0);
    expect(run.activeSector()).toBe(-1);
  });

  it("separates ordinary pay and time from the optional drift premium", () => {
    const safe = nevaResult(100, 15, 0);
    const stylish = nevaResult(100, 15, 2);
    expect(safe).toMatchObject({ score: 600, base: 380, driftBonus: 0, mastered: false });
    expect(stylish).toMatchObject({ score: 800, base: safe.base, timeBonus: safe.timeBonus, driftBonus: 320, mastered: true });
    expect(nevaResult(89, 20, 2).mastered).toBe(false);
    expect(nevaResult(150, 99, 2).score).toBe(1000);
  });

  it("round-trips a versioned challenge target without carrying other URL data", () => {
    const link = new URL(nevaChallengeLink("https://game.test/?other=123#p", 827));
    expect(nevaChallengeTarget(link.search)).toBe(827);
    expect(link.searchParams.has("other")).toBe(false);
    expect(link.hash).toBe("");
    for (const search of ["?challenge=neva-v2&score=800", "?challenge=neva-v1&score=1001", "?challenge=neva-v1&score=1e2", "?challenge=neva-v1&score=<input>"]) {
      expect(nevaChallengeTarget(search)).toBeNull();
    }
  });

  it("adds the contract to older garages and sanitizes malformed scores", () => {
    expect(mergeProfileData({ money: 18000 }).neva).toEqual({ bestScore: 0, mastered: false, seenHelp: false });
    expect(mergeProfileData({ neva: { bestScore: 1100, mastered: null, seenHelp: true } }).neva)
      .toEqual({ bestScore: 1000, mastered: false, seenHelp: true });
  });
});
