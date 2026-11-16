import type { MapId } from "./types";
import { cityLayoutFor, sampleRoadPoint } from "./map-layouts";

const RECORD_KEY = "delivery-drift-86-records-v1";
const WEEK_KEY = "delivery-drift-86-weekly-v1";
const WEEKLY_EVENT_KEY = "delivery-drift-86-weekly-event-v1";
export type RecordMode = "delivery" | "drift-trial" | "time-attack";
export interface WeeklyRoute {
  id: string;
  title: string;
  dest: { x: number; z: number };
  timeLimit: number;
}
export interface WeeklyProgress { week: string; completed: string[] }
export interface MapAccess { unlocked: boolean; deliveriesRemaining: number }

export function mapAccessFor(mapId: MapId, deliveries: number, selectedMap: MapId): MapAccess {
  const threshold = mapId === "tokyo" ? 0 : 8;
  const unlocked = deliveries >= threshold || selectedMap === mapId;
  return { unlocked, deliveriesRemaining: unlocked ? 0 : threshold - Math.max(0, deliveries) };
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
  return Array.from({ length: 3 }, (_, i) => {
    let dest = { x: 0, z: 0 };
    let distance = 0;
    for (let attempt = 0; attempt < 40; attempt++) {
      dest = sampleRoadPoint(layout, random);
      distance = Math.hypot(dest.x, dest.z);
      const key = `${Math.round(dest.x / 10)},${Math.round(dest.z / 10)}`;
      if (distance > 60 && !used.has(key)) { used.add(key); break; }
    }
    return { id: `${week}-${i + 1}`, title: ["Ночной экспресс", "Портовый рывок", "Неоновый маршрут"][i], dest, timeLimit: Math.round(distance / 13 + 45) };
  });
}

export function loadRecords(): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECORD_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, number> : {};
  } catch { return {}; }
}
export function saveRecord(map: MapId, mode: RecordMode, carId: string, score: number): number {
  const records = loadRecords();
  const key = `${map}:${mode}:${carId}`;
  records[key] = mode === "time-attack"
    ? Math.min(records[key] ?? Number.POSITIVE_INFINITY, score)
    : Math.max(records[key] ?? 0, score);
  try { localStorage.setItem(RECORD_KEY, JSON.stringify(records)); } catch { /* private browsing */ }
  return records[key];
}
export function loadWeeklyProgress(date = new Date()): WeeklyProgress {
  const week = utcWeekKey(date);
  try {
    const p = JSON.parse(localStorage.getItem(WEEK_KEY) ?? "null") as WeeklyProgress | null;
    return p?.week === week && Array.isArray(p.completed) ? p : { week, completed: [] };
  } catch { return { week, completed: [] }; }
}
export function completeWeeklyRoute(id: string, date = new Date()): WeeklyProgress {
  const progress = loadWeeklyProgress(date);
  if (!progress.completed.includes(id)) progress.completed.push(id);
  try { localStorage.setItem(WEEK_KEY, JSON.stringify(progress)); } catch { /* private browsing */ }
  return progress;
}

export function weeklyEventSeen(date = new Date()): boolean {
  try { return localStorage.getItem(WEEKLY_EVENT_KEY) === utcWeekKey(date); }
  catch { return false; }
}

export function markWeeklyEventSeen(date = new Date()): void {
  try { localStorage.setItem(WEEKLY_EVENT_KEY, utcWeekKey(date)); }
  catch { /* private browsing */ }
}
