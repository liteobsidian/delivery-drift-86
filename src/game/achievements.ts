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
  /** progress text like "3/10"; null when not started */
  progress: (p: Profile) => string | null;
  done: (p: Profile) => boolean;
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
  {
    id: "courier-10",
    icon: "🛵",
    name: "Курьер",
    desc: "Выполни 10 доставок",
    progress: (p) => `${Math.min(p.deliveries, 10)}/10`,
    done: (p) => p.deliveries >= 10,
  },
  {
    id: "courier-50",
    icon: "🏆",
    name: "Легенда ночи",
    desc: "Выполни 50 доставок",
    progress: (p) => `${Math.min(p.deliveries, 50)}/50`,
    done: (p) => p.deliveries >= 50,
  },
  {
    id: "earner",
    icon: "💰",
    name: "Первая тысяча",
    desc: "Заработай ₽1000 за карьеру",
    progress: (p) => `₽${Math.min(p.totalEarn, 1000)}/₽1000`,
    done: (p) => p.totalEarn >= 1000,
  },
  {
    id: "drifter",
    icon: "💨",
    name: "Дрифтер",
    desc: "Набери 2000 очков дрифта за один заказ",
    progress: (p) => `${Math.min(p.driftBest, 2000)}/2000`,
    done: (p) => p.driftBest >= 2000,
  },
  {
    id: "speeder",
    icon: "⚡",
    name: "Скорость",
    desc: "Разгонись до 150 км/ч",
    progress: (p) => `${Math.min(p.stats.maxSpeedKmh, 150)}/150 км/ч`,
    done: (p) => p.stats.maxSpeedKmh >= 150,
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
