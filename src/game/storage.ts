import type { Profile } from "./types";

const KEY = "delivery-drift-86-save-v1";

export function defaultProfile(): Profile {
  return {
    money: 500,
    deliveries: 0,
    carId: "ae86",
    ownedCars: ["ae86"],
    upgrades: {
      ae86: { engine: 0, tires: 0, suspension: 0, turbo: 0 },
      supra: { engine: 0, tires: 0, suspension: 0, turbo: 0 },
    },
    bestEarn: 0,
    totalEarn: 0,
    driftBest: 0,
    muted: false,
  };
}

function isValid(p: unknown): p is Profile {
  if (!p || typeof p !== "object") return false;
  const o = p as Profile;
  return (
    typeof o.money === "number" &&
    typeof o.deliveries === "number" &&
    typeof o.carId === "string" &&
    Array.isArray(o.ownedCars) &&
    typeof o.upgrades === "object" &&
    o.upgrades !== null
  );
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultProfile();
    const parsed = JSON.parse(raw) as unknown;
    if (!isValid(parsed)) return defaultProfile();
    // merge over defaults so new fields never drown
    const d = defaultProfile();
    return {
      ...d,
      ...parsed,
      upgrades: { ...d.upgrades, ...(parsed.upgrades ?? {}) },
    };
  } catch {
    return defaultProfile();
  }
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage blocked — degrade silently */
  }
}

export function resetProfile(): Profile {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return defaultProfile();
}
