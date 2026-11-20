import type { MapId } from "./types";

export const CITY_STYLE = {
  tokyo: {
    ground: "#3a3d51", asphalt: "#465367", paving: "#3f475c", lane: "#b1cbea", line: "dash", seed: 31337,
    water: "#24334a", shore: 0x798cb8,
    sky: 0x080e2b, horizon: 0x272858, fog: 0.0027, fill: 0x849dd9, bounce: 0x322744,
    sun: 0xa9c5ff, sunIntensity: 1.25, accent: 0xff5cae, accentIntensity: 0.4,
  },
  yokohama: {
    ground: "#404646", asphalt: "#494e50", paving: "#767670", lane: "#f7c360", line: "dash", seed: 9182,
    water: "#164353", shore: 0x75a4ae,
    sky: 0x081722, horizon: 0x334c52, fog: 0.0030, fill: 0xa1a7ad, bounce: 0x42352b,
    sun: 0xffcc9d, sunIntensity: 1.48, accent: 0x55bdd9, accentIntensity: 0.34,
  },
  spb: {
    ground: "#696767", asphalt: "#494d57", paving: "#a3a19b", lane: "#eadfcb", line: "dash", seed: 52231,
    water: "#384b66", shore: 0xabb7c6,
    sky: 0x39436a, horizon: 0xc2918a, fog: 0.0029, fill: 0xcccadb, bounce: 0x5b514f,
    sun: 0xffdfae, sunIntensity: 1.8, accent: 0x83bbec, accentIntensity: 0.38,
  },
  kazan: {
    ground: "#5a5b42", asphalt: "#53504b", paving: "#9b8667", lane: "#f5dcaa", line: "dash", seed: 265379,
    water: "#244951", shore: 0x92aaa1,
    sky: 0x152d4b, horizon: 0xbc7763, fog: 0.0026, fill: 0xa2bdd1, bounce: 0x6b5337,
    sun: 0xffc483, sunIntensity: 1.88, accent: 0x75cbc1, accentIntensity: 0.37,
  },
  sochi: {
    ground: "#5e754f", asphalt: "#575c59", paving: "#cbbda2", lane: "#fff2d6", line: "edge", seed: 298529,
    water: "#216d80", shore: 0xa4d4d9,
    sky: 0x5c97bb, horizon: 0xefc8a0, fog: 0.0025, fill: 0xcbecf8, bounce: 0x7c7148,
    sun: 0xffe4b1, sunIntensity: 2.15, accent: 0x91d7e5, accentIntensity: 0.44,
  },
} as const satisfies Record<MapId, {
  ground: string; asphalt: string; paving: string; lane: string; line: "dash" | "edge"; seed: number;
  water: string; shore: number;
  sky: number; horizon: number; fog: number; fill: number; bounce: number;
  sun: number; sunIntensity: number; accent: number; accentIntensity: number;
}>;

export function buildingVariant(id: MapId, x: number, z: number, entropy: number): 0 | 1 {
  switch (id) {
    case "tokyo": return entropy > 0.59 ? 1 : 0;
    case "yokohama": return entropy > 0.57 ? 1 : 0;
    case "spb": return ((x < -12 || z > 62) ? entropy > 0.32 : entropy > 0.64) ? 1 : 0;
    case "kazan": return (z > 28 || x < -62) && entropy > 0.24 ? 1 : 0;
    case "sochi": return z < 10 && x > -50 && entropy > 0.52 ? 1 : 0;
  }
}

export function districtBuildingHeight(id: MapId, variant: 0 | 1, noise: number, z: number): number {
  switch (id) {
    case "tokyo": return 8 + noise * 30;
    case "yokohama": return 5 + noise * 5;
    case "spb": return 7.5 + Math.floor(noise * 3) * 1.15 + (variant ? 0 : 1.6);
    case "kazan": return variant ? 4.5 + noise * 2.2 : 9.5 + Math.floor(noise * 4) * 2.6;
    case "sochi": return variant ? 9 + noise * 6 : 4.8 + noise * (z < -100 ? 1.4 : 3);
  }
}
