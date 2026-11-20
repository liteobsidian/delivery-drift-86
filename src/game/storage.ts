import { CARS, UPGRADE_DEFS, UPGRADE_MAX } from "./config";
import { recordDetails, weeklyRouteIds } from "./retention";
import { ACTIVITY_MODES, MAP_IDS, type Profile } from "./types";

export const PROFILE_KEY = "delivery-drift-86-save-v2";
const LEGACY_PROFILE_KEY = "delivery-drift-86-save-v1";
const BACKUP_KEY = `${PROFILE_KEY}-backup`;
const LEGACY_RECORDS_KEY = "delivery-drift-86-records-v1";
const LEGACY_WEEK_KEY = "delivery-drift-86-weekly-v1";
const LEGACY_EVENT_KEY = "delivery-drift-86-weekly-event-v1";

export type SaveStatus = "saved" | "unavailable" | "conflict";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function parse(value: string | null): unknown {
  try { return value === null ? undefined : JSON.parse(value); }
  catch { return undefined; }
}

function number(value: unknown, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.min(value, max) : fallback;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string"))] : [];
}

function weekKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function defaultProfile(): Profile {
  return {
    money: 500,
    deliveries: 0,
    carId: "ae86",
    mapId: "tokyo",
    ownedCars: ["ae86"],
    upgrades: Object.fromEntries(CARS.map(({ id }) => [id, { engine: 0, tires: 0, suspension: 0, turbo: 0 }])),
    bestEarn: 0,
    totalEarn: 0,
    driftBest: 0,
    muted: false,
    volume: 0.8,
    stats: {
      scraps: 0,
      jumps: 0,
      escapes: 0,
      rolls: 0,
      redLights: 0,
      maxSpeedKmh: 0,
      perfectDeliveries: 0,
      timeAttackMedal: 0,
    },
    unlockedAch: [],
    seenTutorials: {},
    records: {},
    weeklyCompletions: {},
    weeklyEventWeek: null,
  };
}

/** Recover valid fields independently. A bad map or record must not reset the garage. */
export function mergeProfileData(input: unknown): Profile {
  const saved = object(input);
  const profile = defaultProfile();
  const carId = CARS.find((car) => car.id === saved.carId)?.id;
  const owned = strings(saved.ownedCars);
  profile.ownedCars = ["ae86", ...owned.filter((id) => id !== "ae86" && CARS.some((car) => car.id === id))];
  if (carId && !Array.isArray(saved.ownedCars) && !profile.ownedCars.includes(carId)) profile.ownedCars.push(carId);
  if (carId && profile.ownedCars.includes(carId)) profile.carId = carId;
  profile.mapId = MAP_IDS.find((id) => id === saved.mapId) ?? profile.mapId;

  for (const key of ["money", "deliveries", "bestEarn", "totalEarn", "driftBest"] as const) {
    profile[key] = Math.floor(number(saved[key], profile[key]));
  }
  profile.muted = saved.muted === true;
  profile.volume = number(saved.volume, profile.volume, 1);
  const stats = object(saved.stats);
  for (const key of Object.keys(profile.stats) as (keyof Profile["stats"])[]) {
    profile.stats[key] = Math.floor(number(stats[key], 0, key === "timeAttackMedal" ? 3 : Number.MAX_SAFE_INTEGER));
  }
  const upgrades = object(saved.upgrades);
  for (const [id, levels] of Object.entries(profile.upgrades)) {
    const savedLevels = object(upgrades[id]);
    for (const { key } of UPGRADE_DEFS) {
      levels[key] = Math.floor(number(savedLevels[key], 0, UPGRADE_MAX));
    }
  }

  profile.unlockedAch = strings(saved.unlockedAch);
  const seen = object(saved.seenTutorials);
  for (const mode of ACTIVITY_MODES) {
    if (seen[mode] === true || (mode === "delivery" && saved.seenTutorial === true)) profile.seenTutorials[mode] = true;
  }
  for (const [key, value] of Object.entries(object(saved.records))) {
    const entry = recordDetails(key);
    if (entry && typeof value === "number" && Number.isFinite(value) && value >= 0 &&
      (entry.mode !== "time-attack" || value > 0)) profile.records[key] = value;
  }
  const completions = object(saved.weeklyCompletions);
  for (const week of Object.keys(completions).filter(weekKey).sort().slice(-3)) {
    const validIds = new Set(MAP_IDS.flatMap((id) => weeklyRouteIds(week, id)));
    profile.weeklyCompletions[week] = strings(completions[week]).filter((id) => validIds.has(id));
  }
  if (weekKey(saved.weeklyEventWeek)) profile.weeklyEventWeek = saved.weeklyEventWeek;
  return profile;
}

function legacyProgress(storage: Storage, saved: Record<string, unknown>): void {
  if (!Object.hasOwn(saved, "records")) saved.records = parse(storage.getItem(LEGACY_RECORDS_KEY));
  if (!Object.hasOwn(saved, "weeklyCompletions")) {
    const { week, completed } = object(parse(storage.getItem(LEGACY_WEEK_KEY)));
    if (weekKey(week)) saved.weeklyCompletions = { [week]: completed };
  }
  if (!Object.hasOwn(saved, "weeklyEventWeek")) saved.weeklyEventWeek = storage.getItem(LEGACY_EVENT_KEY);
}

/** The profile, records and weekly credit are committed together in a single storage write. */
export class ProfileStore {
  readonly profile: Profile;
  private snapshot: string | null | undefined;
  private backup: string | null = null;

  constructor() {
    let raw: string | null = null;
    let original: unknown;
    let saved: Record<string, unknown> = {};
    try {
      this.snapshot = localStorage.getItem(PROFILE_KEY);
      raw = this.snapshot ?? localStorage.getItem(LEGACY_PROFILE_KEY);
      original = parse(raw);
      saved = { ...object(original) };
      legacyProgress(localStorage, saved);
    } catch {
      // Keep the in-memory career playable, but never overwrite data we couldn't read.
      this.snapshot = undefined;
    }
    this.profile = mergeProfileData(saved);
    if (raw !== null && JSON.stringify(original) !== JSON.stringify(this.profile)) this.backup = raw;
  }

  get readable(): boolean { return this.snapshot !== undefined; }

  save(): SaveStatus {
    try {
      const current = localStorage.getItem(PROFILE_KEY);
      if (this.snapshot === undefined) {
        if (current !== null || [LEGACY_PROFILE_KEY, LEGACY_RECORDS_KEY, LEGACY_WEEK_KEY, LEGACY_EVENT_KEY].some((key) => localStorage.getItem(key) !== null)) {
          return "conflict";
        }
      } else if (current !== this.snapshot) {
        return "conflict";
      }
      if (this.backup !== null) localStorage.setItem(BACKUP_KEY, this.backup);
      const next = JSON.stringify(this.profile);
      localStorage.setItem(PROFILE_KEY, next);
      this.snapshot = next;
      this.backup = null;
      return "saved";
    } catch {
      return "unavailable";
    }
  }

  changedElsewhere(): boolean {
    try {
      return this.snapshot !== undefined && localStorage.getItem(PROFILE_KEY) !== this.snapshot;
    } catch {
      return false;
    }
  }
}
