import { CARS, WORLD_MAPS } from "./config";
import { sampleDeliveryDestination } from "./delivery-routing";
import { cityLayoutFor } from "./map-layouts";
import { driftMedal, medalRank, timeAttackCourse, timeAttackMedal } from "./modes";
import { radioMedal } from "./radio-silence";
import { MAP_IDS, type ActivityMode, type MapId } from "./types";

const TIME_ATTACK_RECORD_KEY = "time-attack-course-v1";
export interface WeeklyRoute {
  id: string;
  week: string;
  title: string;
  dest: { x: number; z: number };
  distance: number;
  timeLimit: number;
}

export function mapAccessFor(mapId: MapId, deliveries: number, selectedMap: MapId, medalPoints = 0) {
  const map = WORLD_MAPS.find((entry) => entry.id === mapId)!;
  const unlocked = deliveries >= map.unlockDeliveries || medalPoints >= map.unlockMedalPoints || selectedMap === mapId;
  return { unlocked, deliveriesRemaining: unlocked ? 0 : map.unlockDeliveries - Math.max(0, deliveries) };
}

export function utcWeekKey(date = new Date()): string {
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

export function weeklyRoutes(date = new Date(), mapId: MapId = "tokyo"): WeeklyRoute[] {
  const week = utcWeekKey(date);
  let seed = 2166136261;
  for (const c of week) seed = Math.imul(seed ^ c.charCodeAt(0), 16777619) >>> 0;
  for (const c of mapId) seed = Math.imul(seed ^ c.charCodeAt(0), 16777619) >>> 0;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const used = new Set<string>();
  const layout = cityLayoutFor(mapId);
  const titles = mapId === "tokyo" || mapId === "yokohama"
    ? ["Ночной экспресс", "Портовый рывок", "Неоновый маршрут"]
    : ["Ночной экспресс", "Дальний вираж", "Городской маршрут"];
  return titles.flatMap((title, i) => {
    const route = sampleDeliveryDestination(layout, random, used, 60);
    if (!route) return [];
    const id = mapId === "tokyo" ? `${week}-${i + 1}` : `${week}-${mapId}-${i + 1}`;
    return [{ ...route, id, week, title, timeLimit: Math.round(route.distance / 13 + 45) }];
  });
}

export function recordDetails(key: string) {
  const [map, kind, carId, extra] = key.split(":");
  if (extra !== undefined) return;
  const mapId = MAP_IDS.find((id) => id === map);
  const car = CARS.find((item) => item.id === carId);
  if (!mapId || !car) return;
  const mode: ActivityMode | undefined = kind === TIME_ATTACK_RECORD_KEY ? "time-attack"
    : kind === "drift-trial" || kind === "delivery" || kind === "radio-silence" ? kind : undefined;
  if (mode) return { mapId, mode, car };
}

export function saveRecord(
  records: Record<string, number>, map: MapId, mode: ActivityMode, carId: string, score: number,
): number {
  const recordMode = mode === "time-attack" ? TIME_ATTACK_RECORD_KEY : mode;
  const key = `${map}:${recordMode}:${carId}`;
  records[key] = mode === "time-attack"
    ? Math.min(records[key] ?? Infinity, score)
    : Math.max(records[key] ?? 0, score);
  return records[key];
}

/** Only the best medal in each city and mode counts, across all cars. */
export function careerMedalPoints(records: Readonly<Record<string, number>>): number {
  const best = new Map<string, number>();
  for (const [key, value] of Object.entries(records)) {
    const entry = recordDetails(key);
    if (!entry || entry.mode === "delivery") continue;
    const { mapId, mode } = entry;
    const group = `${mapId}:${mode}`;
    const medal = mode === "drift-trial" ? driftMedal(value)
      : mode === "radio-silence" ? radioMedal(value) : timeAttackMedal(timeAttackCourse(mapId), value);
    best.set(group, Math.max(best.get(group) ?? 0, medalRank(medal)));
  }
  return [...best.values()].reduce((total, rank) => total + rank, 0);
}

export function weeklyRouteIds(week: string, mapId: MapId): string[] {
  const prefix = mapId === "tokyo" ? week : `${week}-${mapId}`;
  return [1, 2, 3].map((i) => `${prefix}-${i}`);
}

export function completeWeeklyRoute(
  completions: Record<string, string[]>, route: Pick<WeeklyRoute, "id" | "week">,
): string[] {
  const completed = completions[route.week] ??= [];
  if (!completed.includes(route.id)) completed.push(route.id);
  // Keep recent weeks so a Sunday run can finish after Monday's routes have appeared.
  for (const week of Object.keys(completions).sort().slice(0, -3)) delete completions[week];
  return completed;
}
