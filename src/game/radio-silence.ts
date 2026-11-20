import { cityLayoutFor, type CityPoint } from "./map-layouts";
import type { MedalTier } from "./modes";
import { buildRouteData, routePose, type RouteData } from "./traffic";
import type { MapId } from "./types";

export const RADIO_TITLE = "Радиомолчание";
export const RADIO_TIME = 120;
export const RADIO_WAVES = 3;
export const RADIO_TRAFFIC_SEED = 79656;
export const RADIO_GATE_RADIUS = 8;
export const RADIO_CACHE_RADIUS = 3.25;

interface RadioLeg {
  transmitter: CityPoint;
  cache: CityPoint;
  jammer: CityPoint;
  spawnProgress: number;
  patrolSpeed: number;
  requiredGap: number;
}

export interface RadioCourse {
  route: RouteData;
  start: ReturnType<typeof routePose>;
  legs: readonly RadioLeg[];
  guide: readonly CityPoint[];
}

const courses = new Map<MapId, RadioCourse>();

/** Each map uses the first authored circuit, shared with traffic and Time Attack. */
export function radioCourse(map: MapId): RadioCourse {
  const existing = courses.get(map);
  if (existing) return existing;
  const route = buildRouteData(cityLayoutFor(map).trafficRoutes[0]);
  const startDistance = 12;
  const firstTransmitter = 46;
  const spacing = 146;
  const chaseDistance = 111;
  const start = routePose(route, startDistance, 1, 2.7);
  const legs = Array.from({ length: RADIO_WAVES }, (_, wave) => {
    const signal = firstTransmitter + wave * spacing;
    return {
      transmitter: routePose(route, signal, 1, 0),
      cache: routePose(route, signal + 54, 1, wave === 1 ? 3.4 : -3.4),
      jammer: routePose(route, signal + chaseDistance, 1, 0),
      spawnProgress: signal - (35 + wave * 6),
      patrolSpeed: [12.5, 13.5, 14.5][wave],
      requiredGap: [18, 22, 25][wave],
    };
  });
  const finishDistance = firstTransmitter + (RADIO_WAVES - 1) * spacing + chaseDistance;
  const guide = Array.from({ length: Math.ceil((finishDistance - startDistance) / 5) + 1 },
    (_, i) => routePose(route, Math.min(finishDistance, startDistance + i * 5), 1, 0));
  const course = { route, start, legs, guide };
  courses.set(map, course);
  return course;
}

type RadioEvent = "signal" | "cache" | "escape" | "finish" | "caught";
type RadioPhase = "transmitter" | "pursuit" | "complete" | "caught";

/** Attempt progress is independent of the profile and the 120-second game clock. */
export class RadioRun {
  phase: RadioPhase = "transmitter";
  escapes = 0;
  packets = 0;
  carryingPacket = false;
  private pursuitTime = 0;

  constructor(readonly course: RadioCourse) {}

  get leg(): RadioLeg {
    return this.course.legs[Math.min(this.escapes, RADIO_WAVES - 1)];
  }

  get target(): CityPoint {
    return this.phase === "transmitter" ? this.leg.transmitter : this.leg.jammer;
  }

  update(dt: number, x: number, z: number, onRoad: boolean, gap: number, caught: boolean): RadioEvent | null {
    if (this.phase === "complete" || this.phase === "caught") return null;
    if (this.phase === "transmitter") {
      if (!onRoad || !reached(x, z, this.leg.transmitter, RADIO_GATE_RADIUS)) return null;
      this.phase = "pursuit";
      this.pursuitTime = 0;
      return "signal";
    }
    if (caught) {
      this.phase = "caught";
      this.carryingPacket = false;
      return "caught";
    }

    this.pursuitTime += dt;
    if (!onRoad) return null;
    if (!this.carryingPacket && reached(x, z, this.leg.cache, RADIO_CACHE_RADIUS)) {
      this.carryingPacket = true;
      return "cache";
    }
    if (this.pursuitTime < 2.5 || gap < this.leg.requiredGap || !reached(x, z, this.leg.jammer, RADIO_GATE_RADIUS)) return null;
    if (this.carryingPacket) this.packets++;
    this.carryingPacket = false;
    this.escapes++;
    this.phase = this.escapes === RADIO_WAVES ? "complete" : "transmitter";
    return this.phase === "complete" ? "finish" : "escape";
  }
}

function reached(x: number, z: number, point: CityPoint, radius: number): boolean {
  return (x - point.x) ** 2 + (z - point.z) ** 2 <= radius ** 2;
}

export function radioScore(packets: number, timeLeft: number, carHealth: number): number {
  return 600 + packets * 120 + Math.round(Math.max(0, timeLeft) * 3) + Math.round(carHealth * 2);
}

export function radioMedal(score: number): MedalTier | null {
  if (score >= 1250) return "gold";
  if (score >= 1040) return "silver";
  return score >= 600 ? "bronze" : null;
}
