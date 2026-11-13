import type { CarSpec, UpgradeLevels } from "./types";

/** World layout constants. */
export const CELL = 58; // road pitch
export const ROAD_W = 14; // road width
export const GRID_N = 7; // road lines per axis (GRID_N-1 blocks)
export const WORLD_HALF = ((GRID_N - 1) * CELL) / 2; // 174
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
    price: SUPRA_PRICE,
    color: 0xff7a1a,
    accent: 0x10131a,
  },
];

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
