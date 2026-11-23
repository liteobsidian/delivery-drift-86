import { expect, it } from "vitest";
import {
  EVENTS,
  canRace,
  mapOpen,
  nextEvent,
  settleEvent,
  targets,
} from "./career";
import { defaultProfile, mergeProfileData } from "./storage";
import { MAP_IDS } from "./types";

it("links chapter finals to districts and pays only star improvements", () => {
  const p = defaultProfile();
  for (const event of EVENTS) {
    expect(nextEvent(p.career)).toBe(event);
    expect(canRace(event, p.career)).toBe(true);
    const next = EVENTS[event.number];
    if (next) expect(canRace(next, p.career)).toBe(false);
    const nextMap = MAP_IDS[event.chapter + 1];
    if (nextMap) expect(mapOpen(nextMap, p)).toBe(false);
    const [one, , three] = targets(event);
    expect(settleEvent(p, event, false, three).earned).toBe(0);
    expect(settleEvent(p, event, true, one).earned).toBe(1);
    const bonus = settleEvent(p, event, true, three).bonus;
    expect(bonus).toBe(2 * (100 + 50 * event.chapter));
    expect(settleEvent(p, event, true, one).bonus).toBe(0);
    if (nextMap) expect(mapOpen(nextMap, p)).toBe(event.leg === 2);
  }
  expect(nextEvent(p.career)).toBeUndefined();
  expect(mergeProfileData(p).career).toEqual(p.career);
});

it("preserves earlier unlocks once, while new free-play records cannot unlock districts", () => {
  const p = mergeProfileData({ deliveries: 16, mapId: "sochi", money: 987 });
  expect(p.legacyMaps).toEqual(["tokyo", "yokohama", "spb", "sochi"]);
  p.deliveries = 50;
  expect(mapOpen("kazan", mergeProfileData(p))).toBe(false);
  expect(p.money).toBe(987);
});
