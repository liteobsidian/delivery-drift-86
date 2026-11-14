/** Shared game types. */

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export type GameScreen =
  | "title"
  | "garage"
  | "orders"
  | "playing"
  | "paused"
  | "result"
  | "settings"
  | "achievements";

export interface UpgradeLevels {
  engine: number; // 0..3
  tires: number; // 0..3
  suspension: number; // 0..3
  turbo: number; // 0..3
}

/** Lifetime stats used by achievements. */
export interface Stats {
  scraps: number; // "Задел!" grazes
  jumps: number; // ramp jumps
  escapes: number; // police chases escaped
  rolls: number; // rollovers
  redLights: number; // red lights run (lifetime)
  maxSpeedKmh: number;
  perfectDeliveries: number; // delivered with 100% cargo
}

export interface Profile {
  money: number;
  deliveries: number;
  carId: string; // "ae86" | "supra"
  ownedCars: string[];
  upgrades: Record<string, UpgradeLevels>;
  bestEarn: number;
  totalEarn: number;
  driftBest: number;
  muted: boolean;
  volume: number; // 0..1 master volume
  stats: Stats;
  unlockedAch: string[];
  seenTutorial?: boolean;
}

export interface CarSpec {
  id: string;
  name: string;
  topSpeed: number; // units/s
  accel: number; // units/s^2 at 0 speed
  grip: number; // lateral velocity kill rate (1/s)
  steerRate: number; // rad/s at standstill reference
  brake: number;
  massFeel: number; // inertia factor (higher = floatier)
  cargoProtect: number; // 0..1 base suspension protection
  stability: number; // rollover resistance
  price: number;
  /** deliveries required before the car can be bought (0 = always) */
  unlockDeliveries?: number;
  color: number;
  accent: number;
  /** silhouette style for the procedural body */
  body?: "hatch" | "coupe" | "low" | "sedan";
  spoiler?: "wing" | "big" | "duck" | "none";
}

export interface Order {
  id: number;
  title: string;
  dest: { x: number; z: number };
  reward: number;
  timeLimit: number; // seconds
  fragility: number; // damage multiplier
  distance: number;
}

export interface TrafficLight {
  x: number;
  z: number;
  /** 0 = green for x-axis traffic, 1 = red for x-axis */
  state: number;
  timer: number;
  phaseId: number;
}

export interface DamageEvent {
  amount: number;
  cause: string;
}
