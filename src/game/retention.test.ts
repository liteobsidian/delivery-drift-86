import { afterEach, describe, expect, it, vi } from "vitest";
import { loadRecords, saveRecord, weeklyRoutes } from "./retention";

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

    expect(loadRecords()).toEqual({
      "tokyo:delivery:ae86": 820,
      "tokyo:drift-trial:ae86": 510,
    });
    expect(JSON.parse(storage.getItem("delivery-drift-86-records-v1")!)).not.toHaveProperty("tokyo:time-attack:ae86");
    expect(saveRecord("tokyo", "time-attack", "ae86", 55)).toBe(55);
    expect(loadRecords()).toHaveProperty("tokyo:time-attack-course-v1:ae86", 55);
  });
});
