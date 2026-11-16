import { describe, expect, it } from "vitest";
import { weeklyRoutes } from "./retention";

describe("map-specific weekly routes", () => {
  it("uses independent IDs for the same weekly route in different districts", () => {
    const date = new Date("2026-11-16T12:00:00Z");
    const tokyo = weeklyRoutes(date, "tokyo");
    const yokohama = weeklyRoutes(date, "yokohama");

    expect(tokyo).toHaveLength(3);
    expect(yokohama).toHaveLength(3);
    expect(new Set([...tokyo, ...yokohama].map((route) => route.id)).size).toBe(6);
  });
});
