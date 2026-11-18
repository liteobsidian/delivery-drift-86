import type { CityPoint, TrafficRoute } from "./map-layouts";
import { cityLayoutFor } from "./map-layouts";
import type { CarSpec, MapId, Profile } from "./types";

export type MedalTier = "bronze" | "silver" | "gold";
export type GameMode = "drift-trial" | "time-attack";

export interface TimeAttackCourse {
  mapId: MapId;
  routeId: string;
  name: string;
  start: CityPoint;
  heading: number;
  checkpoints: CityPoint[];
  length: number;
  goldTime: number;
  silverTime: number;
  bronzeTime: number;
  timeLimit: number;
}

const COURSE_ROUTE: Record<MapId, string> = {
  tokyo: "tokyo-outer-traffic",
  yokohama: "yokohama-freight-traffic",
};

function routeMetrics(route: TrafficRoute): { cumulative: number[]; length: number } {
  const cumulative = [0];
  for (let i = 0; i < route.points.length - 1; i++) {
    const a = route.points[i];
    const b = route.points[i + 1];
    cumulative.push(cumulative[i] + Math.hypot(b.x - a.x, b.z - a.z));
  }
  return { cumulative, length: cumulative[cumulative.length - 1] };
}

function pointAtDistance(route: TrafficRoute, cumulative: number[], length: number, distance: number): CityPoint {
  const d = ((distance % length) + length) % length;
  let segment = 0;
  while (segment < route.points.length - 2 && cumulative[segment + 1] < d) segment++;
  const a = route.points[segment];
  const b = route.points[segment + 1];
  const segmentLength = cumulative[segment + 1] - cumulative[segment] || 1;
  const t = (d - cumulative[segment]) / segmentLength;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

/** One fixed lap on an authored traffic loop, so best times compare the same course. */
export function timeAttackCourse(mapId: MapId): TimeAttackCourse {
  const routeId = COURSE_ROUTE[mapId];
  const route = cityLayoutFor(mapId).trafficRoutes.find((item) => item.id === routeId);
  if (!route) throw new Error(`Missing Time Attack route ${routeId} for ${mapId}`);
  const { cumulative, length } = routeMetrics(route);
  if (length <= 0) throw new Error(`Time Attack route ${routeId} has no length`);
  const a = route.points[0];
  const b = route.points[1];
  const heading = Math.atan2(b.x - a.x, b.z - a.z);
  const start = { x: a.x, z: a.z };
  const checkpoints = Array.from({ length: 4 }, (_, i) => pointAtDistance(route, cumulative, length, length * (i + 1) / 5));
  checkpoints.push(start);
  const goldTime = length / 22;
  const silverTime = length / 17;
  const bronzeTime = length / 13;
  return {
    mapId,
    routeId,
    name: mapId === "tokyo" ? "Внешнее кольцо Токио" : "Грузовая петля Ёкохамы",
    start,
    heading,
    checkpoints,
    length,
    goldTime,
    silverTime,
    bronzeTime,
    timeLimit: bronzeTime + 25,
  };
}

export function driftMedal(score: number): MedalTier | null {
  if (score >= 750) return "gold";
  if (score >= 500) return "silver";
  if (score >= 250) return "bronze";
  return null;
}

/** One multiplier level every two seconds of a held drift, capped at five. */
export function driftMultiplierForSeconds(chainSeconds: number): number {
  return Math.min(5, 1 + Math.floor(Math.max(0, chainSeconds) / 2));
}

export function timeAttackMedal(course: TimeAttackCourse, elapsed: number): MedalTier | null {
  if (elapsed <= course.goldTime) return "gold";
  if (elapsed <= course.silverTime) return "silver";
  if (elapsed <= course.bronzeTime) return "bronze";
  return null;
}

/** Medal rewards are paid once per completed run; non-medal runs still earn a small purse. */
export function modeReward(mode: GameMode, medal: MedalTier | null, score: number): number {
  if (mode === "drift-trial") {
    if (medal === "gold") return 900;
    if (medal === "silver") return 450;
    if (medal === "bronze") return 180;
    return Math.max(40, Math.min(200, Math.round(score * 0.25)));
  }
  if (medal === "gold") return 1100;
  if (medal === "silver") return 650;
  if (medal === "bronze") return 300;
  return 100;
}

/** Delivery progress remains a valid alternative to the mode-specific garage unlock. */
export function canUnlockCar(car: CarSpec, profile: Profile): boolean {
  return profile.deliveries >= (car.unlockDeliveries ?? 0)
    || (!!car.unlockAchievement && profile.unlockedAch.includes(car.unlockAchievement));
}

export function medalRank(medal: MedalTier | null): number {
  return medal === "gold" ? 3 : medal === "silver" ? 2 : medal === "bronze" ? 1 : 0;
}
