import { afterEach, describe, expect, it, vi } from "vitest";
import { careerMedalPoints, completeWeeklyRoute, mapAccessFor, saveRecord, weeklyRoutes } from "./retention";
import { ProfileStore, PROFILE_KEY } from "./storage";
import { timeAttackCourse } from "./modes";

afterEach(() => vi.unstubAllGlobals());

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() { return data.size; },
  };
}

describe("map-specific weekly routes", () => {
  it("uses independent IDs for the same weekly route in different districts", () => {
    const date = new Date("2026-11-16T12:00:00Z");
    const tokyo = weeklyRoutes(date, "tokyo");
    const yokohama = weeklyRoutes(date, "yokohama");

    expect(tokyo).toHaveLength(3);
    expect(yokohama).toHaveLength(3);
    expect(new Set([...tokyo, ...yokohama].map((route) => route.id)).size).toBe(6);
  });

  it("keeps delivery and drift records while versioning fixed Time Attack records", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    storage.setItem("delivery-drift-86-records-v1", JSON.stringify({
      "tokyo:delivery:ae86": 820,
      "tokyo:drift-trial:ae86": 510,
      "tokyo:time-attack:ae86": 19.4,
    }));

    const store = new ProfileStore();
    expect(store.profile.records).toEqual({
      "tokyo:delivery:ae86": 820,
      "tokyo:drift-trial:ae86": 510,
    });
    expect(saveRecord(store.profile.records, "tokyo", "time-attack", "ae86", 55)).toBe(55);
    expect(store.save()).toBe("saved");
    expect(new ProfileStore().profile.records).toHaveProperty("tokyo:time-attack-course-v1:ae86", 55);
  });

  it("retains a Sunday finish in its original week after Monday routes start", () => {
    const old = weeklyRoutes(new Date("2026-11-22T23:59:59Z"), "spb")[0];
    const current = weeklyRoutes(new Date("2026-11-23T00:00:00Z"), "spb")[0];
    const completions: Record<string, string[]> = {};
    completeWeeklyRoute(completions, current);
    completeWeeklyRoute(completions, old);
    expect(completeWeeklyRoute(completions, old)).toEqual([old.id]);
    expect(completions[current.week]).toEqual([current.id]);
  });

  it("opens maps for the best medals across cities and modes without double-counting cars", () => {
    const records = {
      "tokyo:drift-trial:ae86": 750,
      "tokyo:drift-trial:supra": 800,
      "tokyo:time-attack-course-v1:ae86": timeAttackCourse("tokyo").goldTime,
    };
    const points = careerMedalPoints(records);
    expect(points).toBe(6);
    expect(mapAccessFor("spb", 0, "tokyo", points).unlocked).toBe(true);
    expect(mapAccessFor("kazan", 0, "tokyo", points).unlocked).toBe(false);
    expect(mapAccessFor("sochi", 32, "tokyo", 0).unlocked).toBe(true);
  });
});

describe("career persistence", () => {
  it("saves an original backup and repairs invalid fields without losing the garage", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    const raw = JSON.stringify({
      money: 21000, deliveries: 7, carId: "silvia", ownedCars: ["ae86", "silvia"], mapId: "removed-map",
      upgrades: { silvia: { engine: 2, tires: "?", turbo: 1 } },
      unlockedAch: {}, records: { "tokyo:time-attack-course-v1:ae86": "broken", "tokyo:delivery:ae86": 800 },
      seenTutorial: true,
    });
    storage.setItem("delivery-drift-86-save-v1", raw);
    const store = new ProfileStore();
    expect(store.profile).toMatchObject({
      money: 21000, deliveries: 7, carId: "silvia", mapId: "tokyo", ownedCars: ["ae86", "silvia"],
      upgrades: { silvia: { engine: 2, tires: 0, suspension: 0, turbo: 1 } },
      unlockedAch: [], records: { "tokyo:delivery:ae86": 800 }, seenTutorials: { delivery: true },
    });
    expect(Object.keys(store.profile.records)).toHaveLength(1);
    expect(store.save()).toBe("saved");
    expect(storage.getItem(`${PROFILE_KEY}-backup`)).toBe(raw);
    // An already-open older build can still write to v1 during deployment.
    storage.setItem("delivery-drift-86-save-v1", JSON.stringify({ money: 500 }));
    expect(new ProfileStore().profile.money).toBe(21000);
  });

  it("refuses to overwrite a newer save with a stale snapshot", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const active = new ProfileStore();
    const stale = new ProfileStore();
    active.profile.ownedCars.push("silvia");
    expect(active.save()).toBe("saved");
    stale.profile.deliveries++;
    expect(stale.save()).toBe("conflict");
    expect(new ProfileStore().profile.ownedCars).toContain("silvia");
  });

  it("allows an unsaved result to be retried after quota recovers", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    const store = new ProfileStore();
    const setItem = vi.spyOn(storage, "setItem").mockImplementationOnce(() => { throw new Error("Quota"); });
    store.profile.money += 100;
    store.profile.records["tokyo:delivery:ae86"] = 100;
    expect(store.save()).toBe("unavailable");
    expect(storage.getItem(PROFILE_KEY)).toBeNull();
    expect(setItem).toHaveBeenCalledOnce();
    expect(store.save()).toBe("saved");
    expect(new ProfileStore().profile).toMatchObject({ money: 600, records: { "tokyo:delivery:ae86": 100 } });
  });

  it("does not overwrite a career after read permission is restored", () => {
    const storage = memoryStorage();
    storage.setItem(PROFILE_KEY, JSON.stringify({ money: 12000 }));
    vi.stubGlobal("localStorage", storage);
    vi.spyOn(storage, "getItem").mockImplementationOnce(() => { throw new Error("Denied"); });
    const store = new ProfileStore();
    expect(store.readable).toBe(false);
    expect(store.save()).toBe("conflict");
    expect(new ProfileStore().profile.money).toBe(12000);
  });
});
