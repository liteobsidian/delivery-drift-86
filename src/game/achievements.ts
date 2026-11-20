/**
 * Achievements — static definitions + progress evaluation.
 * Unlocked ids are stored in Profile.unlockedAch; stats in Profile.stats.
 */
import type { Profile } from "./types";

export interface AchievementDef {
  id: string;
  icon: string;
  name: string;
  desc: string;
  tier?: "bronze" | "silver" | "gold";
  /** progress text like "3/10"; null when not started */
  progress: (p: Profile) => string | null;
  done: (p: Profile) => boolean;
}

type MedalTier = NonNullable<AchievementDef["tier"]>;

function milestone(
  id: string,
  category: string,
  tier: MedalTier,
  icon: string,
  current: (p: Profile) => number,
  target: number,
  description: string,
  unit = "",
): AchievementDef {
  return {
    id,
    icon,
    tier,
    name: category,
    desc: description,
    progress: (p) => `${Math.min(current(p), target)}/${target}${unit}`,
    done: (p) => current(p) >= target,
  };
}

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: "first-delivery",
    icon: "📦",
    name: "Первая доставка",
    desc: "Довези первый заказ",
    progress: (p) => `${Math.min(p.deliveries, 1)}/1`,
    done: (p) => p.deliveries >= 1,
  },
  milestone("courier-10", "Курьер", "bronze", "🥉", (p) => p.deliveries, 10, "Выполни 10 доставок"),
  milestone("courier-25", "Курьер", "silver", "🥈", (p) => p.deliveries, 25, "Выполни 25 доставок"),
  {
    ...milestone("courier-50", "Курьер", "gold", "🥇", (p) => p.deliveries, 50, "Выполни 50 доставок"),
    name: "Легенда ночи",
  },
  {
    id: "earner",
    icon: "💰",
    name: "Первая тысяча",
    desc: "Заработай ₽1000 за карьеру",
    progress: (p) => `₽${Math.min(p.totalEarn, 1000)}/₽1000`,
    done: (p) => p.totalEarn >= 1000,
  },
  milestone("drifter-bronze", "Дрифтер", "bronze", "🥉", (p) => p.driftBest, 250, "Набери 250 очков дрифта за один заезд"),
  milestone("drifter-silver", "Дрифтер", "silver", "🥈", (p) => p.driftBest, 500, "Набери 500 очков дрифта за один заезд"),
  {
    ...milestone("drifter", "Дрифтер", "gold", "🥇", (p) => p.driftBest, 750, "Набери 750 очков дрифта за один заезд"),
    progress: (p) => `${Math.min(p.driftBest, 750)}/750`,
  },
  {
    id: "neva-master",
    icon: "🏅",
    name: "Мастер Невы",
    desc: "Закончи «Доставь красиво» с двумя чистыми заносами и грузом от 90%",
    tier: "gold",
    progress: (p) => p.neva.mastered ? "Выполнено" : null,
    done: (p) => p.neva.mastered,
  },
  milestone("time-attack-bronze", "Time Attack", "bronze", "🥉", (p) => p.stats.timeAttackMedal, 1, "Получи бронзу в Time Attack"),
  milestone("time-attack-silver", "Time Attack", "silver", "🥈", (p) => p.stats.timeAttackMedal, 2, "Получи серебро в Time Attack"),
  milestone("time-attack-gold", "Time Attack", "gold", "🥇", (p) => p.stats.timeAttackMedal, 3, "Получи золото в Time Attack"),
  milestone("speeder-bronze", "Скорость", "bronze", "🥉", (p) => p.stats.maxSpeedKmh, 90, "Разгонись до 90 км/ч", " км/ч"),
  milestone("speeder-silver", "Скорость", "silver", "🥈", (p) => p.stats.maxSpeedKmh, 120, "Разгонись до 120 км/ч", " км/ч"),
  {
    ...milestone("speeder", "Скорость", "gold", "🥇", (p) => p.stats.maxSpeedKmh, 150, "Разгонись до 150 км/ч", " км/ч"),
    progress: (p) => `${Math.min(p.stats.maxSpeedKmh, 150)}/150 км/ч`,
  },
  {
    id: "escapee",
    icon: "🚔",
    name: "Невидимка",
    desc: "Уйди от полиции 3 раза",
    progress: (p) => `${Math.min(p.stats.escapes, 3)}/3`,
    done: (p) => p.stats.escapes >= 3,
  },
  {
    id: "jumper",
    icon: "🛫",
    name: "Покоритель трамплинов",
    desc: "Соверши 5 прыжков",
    progress: (p) => `${Math.min(p.stats.jumps, 5)}/5`,
    done: (p) => p.stats.jumps >= 5,
  },
  {
    id: "acrobat",
    icon: "🌀",
    name: "Акробат",
    desc: "Переверни машину хотя бы раз",
    progress: (p) => `${Math.min(p.stats.rolls, 1)}/1`,
    done: (p) => p.stats.rolls >= 1,
  },
  {
    id: "reddevil",
    icon: "🚦",
    name: "Светофор — не указ",
    desc: "Проедь 5 красных сигналов",
    progress: (p) => `${Math.min(p.stats.redLights, 5)}/5`,
    done: (p) => p.stats.redLights >= 5,
  },
  {
    id: "perfect",
    icon: "✨",
    name: "Идеальный курьер",
    desc: "Доставь 3 заказа без потерь груза",
    progress: (p) => `${Math.min(p.stats.perfectDeliveries, 3)}/3`,
    done: (p) => p.stats.perfectDeliveries >= 3,
  },
  {
    id: "rank-courier",
    icon: "🎖️",
    name: "Знающий курьер",
    desc: "Достигни 3 уровня (8 доставок)",
    progress: (p) => `${Math.min(p.deliveries, 8)}/8`,
    done: (p) => p.deliveries >= 8,
  },
  {
    id: "rank-drift",
    icon: "🌃",
    name: "Дрифт-курьер",
    desc: "Достигни 5 уровня (25 доставок)",
    progress: (p) => `${Math.min(p.deliveries, 25)}/25`,
    done: (p) => p.deliveries >= 25,
  },
  {
    id: "rank-legend",
    icon: "👑",
    name: "Легенда Токио",
    desc: "Достигни 7 уровня (60 доставок)",
    progress: (p) => `${Math.min(p.deliveries, 60)}/60`,
    done: (p) => p.deliveries >= 60,
  },
];

/** Unlock any newly completed achievements; returns the newly unlocked defs. */
export function checkAchievements(p: Profile): AchievementDef[] {
  const fresh: AchievementDef[] = [];
  for (const a of ACHIEVEMENTS) {
    if (p.unlockedAch.includes(a.id)) continue;
    if (a.done(p)) {
      p.unlockedAch.push(a.id);
      fresh.push(a);
    }
  }
  return fresh;
}
