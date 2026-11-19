import type { CarSpec, MapId, UpgradeLevels } from "./types";

/** World layout constants. */
export const CELL = 58; // road pitch
export const ROAD_W = 14; // road width
export const GRID_N = 7; // road lines per axis (GRID_N-1 blocks)
export const WORLD_HALF = ((GRID_N - 1) * CELL) / 2; // 174

export const WORLD_MAPS: { id: MapId; name: string; description: string; badge: string; unlockDeliveries: number }[] = [
  { id: "tokyo", name: "Неоновый Токио", description: "Дрифт-кольцо и ночные улицы", badge: "東京", unlockDeliveries: 0 },
  { id: "yokohama", name: "Порт Ёкохама", description: "Контейнеры, краны и вода у дорог", badge: "横浜", unlockDeliveries: 8 },
  { id: "spb", name: "Белые ночи · Петербург", description: "Набережные, мосты и длинный проспект", badge: "СПБ", unlockDeliveries: 16 },
  { id: "kazan", name: "Кремлёвский вираж · Казань", description: "Широкие улицы, кольцо и речной берег", badge: "КЗН", unlockDeliveries: 24 },
  { id: "sochi", name: "Черноморский серпантин · Сочи", description: "Береговая петля и горные связки", badge: "СОЧ", unlockDeliveries: 32 },
];
export const SIDEWALK_W = 3.2;

/** Fixed timestep. */
export const DT = 1 / 60;
export const MAX_STEPS = 5;

/** Economy / rules tuning. */
export const RED_LIGHT_FINE = 150; // money
export const RED_LIGHT_SCORE = 200; // score points lost
export const LIGHT_CYCLE = 7; // seconds per phase
export const LIGHT_YELLOW = 1.6;

export const UPGRADE_COST = [600, 1400, 3000]; // cost per level (level index 0..2)
export const UPGRADE_MAX = 3;

export const SUPRA_PRICE = 22000;
export const SUPRA_UNLOCK_DELIVERIES = 8;

export const DRIFT_TIP_DIV = 40; // drift score -> money tip divisor

export interface UpgradeDef {
  key: keyof UpgradeLevels;
  name: string;
  desc: string;
}

export const UPGRADE_DEFS: UpgradeDef[] = [
  { key: "engine", name: "Двигатель", desc: "+разгон и макс. скорость" },
  { key: "tires", name: "Шины", desc: "+сцепление, стабильность" },
  { key: "suspension", name: "Подвеска", desc: "−повреждения груза" },
  { key: "turbo", name: "Турбина", desc: "+мощность на высокой скорости" },
];

export const CARS: CarSpec[] = [
  {
    id: "ae86",
    name: "Toyota AE86 Sprinter",
    topSpeed: 38,
    accel: 16,
    grip: 7.5,
    steerRate: 2.5,
    brake: 26,
    massFeel: 1.0,
    cargoProtect: 0.1,
    stability: 1.0,
    price: 0,
    color: 0xf2f2ee,
    accent: 0x14161c,
    body: "hatch",
    glb: "ae86",
  },
  {
    id: "supra",
    name: "Toyota Supra MK4",
    topSpeed: 52,
    accel: 24,
    grip: 8.5,
    steerRate: 2.35,
    brake: 30,
    massFeel: 1.15,
    cargoProtect: 0.12,
    stability: 1.25,
    glb: "supra",
    price: SUPRA_PRICE,
    unlockDeliveries: SUPRA_UNLOCK_DELIVERIES,
    color: 0xff7a1a,
    accent: 0x10131a,
    body: "coupe",
  },
  {
    id: "silvia",
    name: "Nissan Silvia S15",
    topSpeed: 45,
    accel: 20,
    grip: 8.0,
    steerRate: 2.6,
    brake: 30,
    massFeel: 1.0,
    cargoProtect: 0.12,
    stability: 1.05,
    price: 8000,
    unlockDeliveries: 12,
    unlockAchievement: "drifter-silver",
    color: 0x2a52ff,
    accent: 0x0c0f16,
    body: "coupe",
    glb: "silvia",
    spoiler: "big",
  },
  {
    id: "rx7",
    name: "Mazda RX-7 FD",
    topSpeed: 49,
    accel: 23,
    grip: 8.8,
    steerRate: 2.45,
    brake: 32,
    massFeel: 1.05,
    cargoProtect: 0.1,
    stability: 1.1,
    price: 15000,
    unlockDeliveries: 20,
    color: 0xd21f2c,
    accent: 0x14161c,
    body: "low",
    glb: "rx7",
    spoiler: "duck",
  },
  {
    id: "r34",
    name: "Nissan Skyline GT-R R34",
    topSpeed: 56,
    accel: 27,
    grip: 9.4,
    steerRate: 2.35,
    brake: 34,
    massFeel: 1.3,
    cargoProtect: 0.16,
    stability: 1.4,
    price: 26000,
    unlockDeliveries: 30,
    color: 0x4a3f8f,
    accent: 0x0c0f16,
    body: "sedan",
    glb: "r34",
    spoiler: "big",
  },
  {
    id: "nsx",
    name: "Honda NSX",
    topSpeed: 51,
    accel: 25,
    grip: 9.0,
    steerRate: 2.65,
    brake: 33,
    massFeel: 0.95,
    cargoProtect: 0.1,
    stability: 1.0,
    price: 38000,
    unlockDeliveries: 45,
    color: 0xe9eaf2,
    accent: 0x14161c,
    body: "low",
    glb: "nsx",
    spoiler: "none",
  },
  {
    id: "evo",
    name: "Mitsubishi Lancer Evo IX",
    topSpeed: 47,
    accel: 22,
    grip: 9.8,
    steerRate: 2.5,
    brake: 34,
    massFeel: 1.1,
    cargoProtect: 0.2,
    stability: 1.5,
    price: 55000,
    unlockDeliveries: 60,
    unlockAchievement: "time-attack-gold",
    color: 0xd7a21a,
    accent: 0x10131a,
    body: "sedan",
    glb: "evo",
    spoiler: "wing",
  },
  {
    id: "vaz2107turbo",
    name: "LADA 2107 Turbo «Боевая классика»",
    topSpeed: 63,
    accel: 30,
    grip: 7.8,
    steerRate: 2.7,
    brake: 32,
    massFeel: 1.08,
    cargoProtect: 0.08,
    stability: 1.05,
    price: 90000,
    unlockDeliveries: 70,
    unlockAchievement: "drifter",
    color: 0xd7c9ac,
    accent: 0x9d292d,
    body: "sedan",
    spoiler: "duck",
  },
];

/** Courier ranks by lifetime deliveries. */
export const LEVELS = [
  { name: "Новобранец", deliveries: 0 },
  { name: "Курьер", deliveries: 3 },
  { name: "Знающий курьер", deliveries: 8 },
  { name: "Ночной волк", deliveries: 15 },
  { name: "Дрифт-курьер", deliveries: 25 },
  { name: "Ас города", deliveries: 40 },
  { name: "Легенда Токио", deliveries: 60 },
  { name: "Живая легенда", deliveries: 90 },
];

export function courierLevel(deliveries: number): number {
  let lvl = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    if (deliveries >= LEVELS[i].deliveries) lvl = i;
  }
  return lvl;
}

export function tunedSpec(car: CarSpec, up: UpgradeLevels): CarSpec {
  const engineBoost = 1 + up.engine * 0.09 + up.turbo * 0.12;
  return {
    ...car,
    topSpeed: car.topSpeed * (1 + up.engine * 0.05 + up.turbo * 0.07),
    accel: car.accel * engineBoost,
    grip: car.grip * (1 + up.tires * 0.12),
    steerRate: car.steerRate * (1 + up.tires * 0.03),
    cargoProtect: Math.min(0.7, car.cargoProtect + up.suspension * 0.13),
    stability: car.stability * (1 + up.suspension * 0.18 + up.tires * 0.05),
  };
}

export const CARGO_NAMES = [
  "Стеклянная ваза",
  "Суши-сет «Фудзи»",
  "Телевизор 4K",
  "Кофе для офиса",
  "Кошачий корм XL",
  "Гитара Fender",
  "Дрон DJI",
  "Краска «Неон Токио»",
  "Роллы «Гора Акаги»",
  "Призовой трофей",
];

export const ORDER_TITLES = [
  "Доставить бережно!",
  "Горячий заказ",
  "Хрупкий груз",
  "VIP-клиент",
  "Ночной экспресс",
  "Заказ горного прохода",
];
