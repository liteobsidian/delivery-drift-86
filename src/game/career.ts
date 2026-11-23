import { MAP_IDS, type MapId, type Profile } from "./types";
import { timeAttackCourse } from "./modes";

const chapterTitles = [
  ["Первый заказ", "Неоновая дуга", "Внешнее кольцо"],
  ["Смена в порту", "Контейнерный слалом", "Грузовая петля"],
  ["Посылка на Неву", "Белые ночи", "Кубок набережной"],
  ["Кремлёвский курьер", "Виражи слободы", "Кремлёвское кольцо"],
  ["Заказ у моря", "Южный занос", "Черноморский финал"],
];
const disciplines = ["delivery", "drift-trial", "time-attack"] as const;
export const EVENTS = MAP_IDS.flatMap((map, chapter) =>
  disciplines.map((mode, leg) => ({
    id: map + "-" + mode,
    map,
    chapter,
    leg,
    mode,
    title: chapterTitles[chapter][leg],
    number: chapter * 3 + leg + 1,
  })),
);
export type CareerEvent = (typeof EVENTS)[number];
export type Stars = Record<string, number>;
export const nextEvent = (stars: Stars) =>
  EVENTS.find((event) => !stars[event.id]);
export function canRace(event: CareerEvent, stars: Stars) {
  return event.number === 1 || !!stars[EVENTS[event.number - 2].id];
}
export function mapOpen(map: MapId, profile: Profile) {
  const chapter = MAP_IDS.indexOf(map);
  return (
    chapter === 0 ||
    profile.legacyMaps.includes(map) ||
    !!profile.career[EVENTS[chapter * 3 - 1].id]
  );
}
export function targets(event: CareerEvent): number[] {
  if (event.mode === "delivery") return [0, 75 + event.chapter * 3, 96];
  if (event.mode === "drift-trial") {
    const base = 45 + event.chapter * 35;
    return [base, base * 2, base * 4];
  }
  const course = timeAttackCourse(event.map);
  return [
    course.timeLimit,
    Math.ceil(course.bronzeTime),
    Math.ceil(course.silverTime),
  ];
}
export function goal(event: CareerEvent, tier: number) {
  const value = targets(event)[tier - 1];
  if (event.mode === "delivery")
    return tier === 1 ? "Доставить заказ" : `Сохранить ${value}% груза`;
  return event.mode === "drift-trial"
    ? `Набрать ${value} очк. за 60 с`
    : `Пройти круг за ${value} с`;
}
export function settleEvent(
  profile: Profile,
  event: CareerEvent,
  finished: boolean,
  value: number,
) {
  const earned = finished
    ? targets(event).filter((limit) =>
        event.mode === "time-attack" ? value <= limit : value >= limit,
      ).length
    : 0;
  const previous = profile.career[event.id] ?? 0;
  const bonus = Math.max(0, earned - previous) * (100 + 50 * event.chapter);
  if (earned > previous) {
    profile.career[event.id] = earned;
    profile.money += bonus;
    profile.totalEarn += bonus;
  }
  return { earned, bonus, first: !previous && earned > 0 };
}
