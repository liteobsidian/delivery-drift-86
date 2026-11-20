import type { CityPoint } from "./map-layouts";

interface Gate extends CityPoint { dx: number; dz: number; halfWidth: number }
interface Sector { name: string; entry: Gate; corner: CityPoint; exit: Gate }

export const NEVA_CONTRACT = {
  id: "neva-v1",
  title: "Доставь красиво",
  mapId: "spb",
  carId: "vaz2107turbo",
  start: { x: 95, z: 58, heading: -Math.PI / 2 },
  finish: { x: -74, z: 145 },
  timeLimit: 45,
  distance: 256,
  reward: 380,
  sectorBonus: 160,
  trafficSeed: 46051,
  maxScore: 1000,
} as const;

export const NEVA_SECTORS: readonly Sector[] = [
  {
    name: "Дворцовый поворот",
    entry: { x: 16, z: 58, dx: -1, dz: 0, halfWidth: 5.2 },
    corner: { x: 0, z: 58 },
    exit: { x: 0, z: 73, dx: 0, dz: 1, halfWidth: 6 },
  },
  {
    name: "Съезд с моста",
    entry: { x: 0, z: 134, dx: 0, dz: 1, halfWidth: 6 },
    corner: { x: 0, z: 145 },
    exit: { x: -14, z: 145, dx: -1, dz: 0, halfWidth: 5.5 },
  },
];

const MIN_DRIFT_SECONDS = 0.3;
const MAX_SECTOR_SECONDS = 6;
const sectorBounds = NEVA_SECTORS.map(({ entry, exit }) => ({
  minX: Math.min(entry.x, exit.x) - 7,
  maxX: Math.max(entry.x, exit.x) + 7,
  minZ: Math.min(entry.z, exit.z) - 7,
  maxZ: Math.max(entry.z, exit.z) + 7,
}));

function crosses(gate: Gate, fromX: number, fromZ: number, x: number, z: number): boolean {
  const start = (fromX - gate.x) * gate.dx + (fromZ - gate.z) * gate.dz;
  const end = (x - gate.x) * gate.dx + (z - gate.z) * gate.dz;
  if (start >= 0 || end < 0) return false;
  const fraction = -start / (end - start);
  const across = (fromX + (x - fromX) * fraction - gate.x) * gate.dz
    - (fromZ + (z - fromZ) * fraction - gate.z) * gate.dx;
  return Math.abs(across) <= gate.halfWidth;
}

interface SectorAttempt {
  state: "waiting" | "active" | "done";
  time: number;
  driftTime: number;
  points: number; // awarded at the exit only
  pendingPoints: number;
}

export class NevaRun {
  private sectors: SectorAttempt[] = NEVA_SECTORS.map(() => ({
    state: "waiting", time: 0, driftTime: 0, points: 0, pendingPoints: 0,
  }));
  cleanSectors = 0;
  bestSector = -1;

  /** Two fixed sectors with constant memory and no allocations per step. Returns a finished sector index. */
  update(
    fromX: number, fromZ: number, x: number, z: number, dt: number,
    speed: number, slip: number, clean: boolean,
  ): number {
    for (let i = 0; i < NEVA_SECTORS.length; i++) {
      const attempt = this.sectors[i];
      if (attempt.state === "done") continue;
      const sector = NEVA_SECTORS[i];
      if (attempt.state === "waiting") {
        if (!crosses(sector.entry, fromX, fromZ, x, z)) continue;
        attempt.state = "active";
      }

      const bounds = sectorBounds[i];
      attempt.time += dt;
      if (!clean || attempt.time > MAX_SECTOR_SECONDS ||
        x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) {
        attempt.state = "done";
        return i;
      }
      if (speed > 8 && slip > 4.5) {
        attempt.driftTime += dt;
        attempt.pendingPoints += speed * slip * dt * 0.15;
      }

      if (crosses(sector.exit, fromX, fromZ, x, z)) {
        attempt.state = "done";
        if (attempt.driftTime >= MIN_DRIFT_SECONDS) {
          attempt.points = Math.min(100, Math.round(attempt.pendingPoints));
          this.cleanSectors++;
          if (this.bestSector < 0 || attempt.points > this.sectors[this.bestSector].points) this.bestSector = i;
        }
        return i;
      }
    }
    return -1;
  }

  pointsAt(index: number): number { return this.sectors[index].points; }

  activeSector(): number { return this.sectors.findIndex(({ state }) => state === "active"); }
}

export function nevaResult(cargo: number, timeLeft: number, cleanSectors: number) {
  const timeRatio = Math.max(0, Math.min(1, timeLeft / NEVA_CONTRACT.timeLimit));
  const cargoRatio = Math.max(0, Math.min(100, cargo)) / 100;
  const score = Math.round(cargoRatio * 500 + timeRatio * 300 + cleanSectors * 100);
  return {
    score,
    base: Math.round(NEVA_CONTRACT.reward * (0.25 + 0.75 * cargoRatio)),
    timeBonus: Math.round(timeRatio * 130),
    driftBonus: cleanSectors * NEVA_CONTRACT.sectorBonus,
    mastered: cargo >= 90 && cleanSectors === NEVA_SECTORS.length,
  };
}

export function nevaChallengeTarget(search: string): number | null {
  const params = new URLSearchParams(search);
  const value = params.get("score");
  if (params.get("challenge") !== NEVA_CONTRACT.id || !value || !/^[1-9]\d{0,3}$/.test(value)) return null;
  const score = Number(value);
  return score <= NEVA_CONTRACT.maxScore ? score : null;
}

export function nevaChallengeLink(location: string, score: number): string {
  const url = new URL(location);
  url.search = new URLSearchParams({ challenge: NEVA_CONTRACT.id, score: String(score) }).toString();
  url.hash = "";
  return url.href;
}
