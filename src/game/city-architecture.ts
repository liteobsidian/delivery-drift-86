import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { MapId } from "./types";

const TILE = 256;
const ATLAS = TILE * 2;
const paint = {
  tokyo: { walls: ["#263b54", "#38485a"], trim: "#a5b3bf", glass: "#154660", roof: ["#344254", "#475363"] },
  yokohama: { walls: ["#929c91", "#867467"], trim: "#343f41", glass: "#182e39", roof: ["#456267", "#764e41"] },
  spb: { walls: ["#cfa56f", "#82aa97"], trim: "#eee0c3", glass: "#344559", roof: ["#665858", "#62756b"] },
  kazan: { walls: ["#c59173", "#4b8e81"], trim: "#f0dec2", glass: "#293e48", roof: ["#72564d", "#835346"] },
  sochi: { walls: ["#e5cfaa", "#e6e2d4"], trim: "#fff2d7", glass: "#39849d", roof: ["#a66049", "#9aa8a6"] },
} satisfies Record<MapId, { walls: [string, string]; trim: string; glass: string; roof: [string, string] }>;

function windows(g: CanvasRenderingContext2D, kind: MapId, variant: number): void {
  const style = paint[kind];
  const box = (color: string, x: number, y: number, w: number, h: number) => {
    g.fillStyle = color;
    g.fillRect(x, y, w, h);
  };
  box(style.walls[variant], 0, 0, TILE, TILE);
  if (kind === "yokohama") {
    for (let x = 0; x < TILE; x += 9) {
      box("rgba(29,41,45,.36)", x, 0, 2, TILE);
      box("rgba(240,233,198,.34)", x + 3, 0, 1, TILE);
    }
    box("#374647", 0, 207, TILE, 49);
    for (const x of [20, 142]) {
      box("#dfb964", x - 4, 103, 97, 132);
      box("#465559", x, 108, 89, 123);
      for (let y = 113; y < 230; y += 7) box("#303e43", x + 2, y, 85, 2);
      box("#b5c9c9", x + 6, 34, 73, 22);
      box(style.glass, x + 10, 38, 65, 14);
    }
    return;
  }

  if (kind === "tokyo") {
    const cols = variant ? 5 : 7;
    for (let row = 0; row < 10; row++) {
      const y = row * 25 + 3;
      box("#182a3d", 0, y, TILE, 19);
      for (let col = 0; col < cols; col++) {
        const w = 252 / cols;
        const x = col * w + 3;
        const lamp = (row * 31 + col * 17 + variant * 7) % 13;
        box(lamp < 3 ? "#eab785" : lamp < 7 ? "#6eacd0" : style.glass, x, y + 3, w - 6, 12);
        box("rgba(215,233,252,.22)", x, y + 3, 2, 12);
      }
      box("rgba(141,191,220,.28)", 0, y + 21, TILE, 2);
    }
    return;
  }

  if (kind === "sochi" && variant === 1) {
    box(style.glass, 0, 34, TILE, 155);
    box("#759495", 0, 148, TILE, 46);
    for (let x = 2; x < TILE; x += 34) {
      box("#dbe6e2", x, 32, 4, 168);
      box("rgba(207,239,239,.36)", x + 8, 43, 18, 31);
      box("#e9eee0", x + 9, 143, 2, 45);
      box("#e9eee0", x + 21, 143, 2, 45);
    }
    box("#f1e8d5", 0, 139, TILE, 7);
    box("#d3c7af", 0, 189, TILE, 22);
    return;
  }

  if (kind === "kazan" && variant === 1) {
    for (let y = 0; y < TILE; y += 10) {
      box("rgba(21,56,54,.65)", 0, y, TILE, 1.5);
      box("rgba(223,235,205,.24)", 0, y + 2, TILE, 1);
    }
    box("#315a58", 0, 214, TILE, 42);
    for (const x of [15, 96, 177]) {
      box(style.trim, x, 53, 64, 116);
      box(style.glass, x + 10, 68, 44, 85);
      box("#d9d8ad", x + 30, 68, 4, 85);
      box("#d9d8ad", x + 10, 105, 44, 4);
      box("#ad614a", x + 3, 50, 58, 6);
      for (let j = 0; j < 6; j++) {
        g.fillStyle = "#b66248";
        g.beginPath();
        g.moveTo(x + 6 + j * 9, 162);
        g.lineTo(x + 10 + j * 9, 157);
        g.lineTo(x + 14 + j * 9, 162);
        g.fill();
      }
    }
    return;
  }

  const floors = kind === "spb" ? 3 : kind === "kazan" ? 4 : 2;
  const rowHeight = 222 / floors;
  for (let row = 0; row < floors; row++) {
    const y = 8 + row * rowHeight;
    box("rgba(66,54,44,.26)", 0, y + rowHeight - 6, TILE, 2);
    for (let col = 0; col < 4; col++) {
      const x = 11 + col * 62;
      const width = 47;
      const height = rowHeight * 0.64;
      const glazed = (col * 7 + row * 3 + variant) % 9 < 2 ? "#e8b67e" : style.glass;
      g.fillStyle = style.trim;
      g.beginPath();
      g.roundRect(x, y + 6, width, height, kind === "spb" ? [13, 13, 0, 0] : 3);
      g.fill();
      g.fillStyle = glazed;
      g.beginPath();
      g.roundRect(x + 5, y + 11, width - 10, height - 10, kind === "spb" ? [9, 9, 0, 0] : 1);
      g.fill();
      box("#b3b8a9", x + width / 2 - 1, y + 14, 2, height - 14);
      box("#958c76", x - 3, y + height + 5, width + 6, 3);
      if (kind === "sochi") {
        box("#646e61", x - 4, y + height - 7, width + 8, 9);
        for (let p = 0; p < 5; p++) box("#b4aa8f", x + p * 9, y + height - 7, 2, 9);
      }
    }
  }
  box(kind === "spb" ? "#a49483" : "#979079", 0, 231, TILE, 25);
  if (kind === "spb") {
    for (let x = 3; x < TILE; x += 61) box("rgba(251,234,197,.59)", x, 0, 5, 231);
    box(style.trim, 0, 0, TILE, 6);
  }
  if (kind === "kazan") {
    for (let y = 0; y < TILE; y += 9) box("rgba(247,215,174,.24)", 0, y, TILE, 1);
  }
}

function roof(g: CanvasRenderingContext2D, id: MapId, variant: number): void {
  const style = paint[id];
  g.fillStyle = style.roof[variant];
  g.fillRect(0, 0, TILE, TILE);
  if (id === "sochi" && variant === 0 || id === "kazan" && variant === 1) {
    for (let y = 0; y < TILE; y += 12) {
      g.fillStyle = "rgba(62,32,25,.4)";
      g.fillRect(0, y, TILE, 2);
      for (let x = y % 24 ? 0 : 9; x < TILE; x += 18) g.fillRect(x, y, 1.5, 12);
    }
  } else {
    for (let x = 0; x < TILE; x += 19) {
      g.fillStyle = "rgba(32,38,39,.48)";
      g.fillRect(x, 0, 2, TILE);
      g.fillStyle = "rgba(215,229,209,.24)";
      g.fillRect(x + 2, 0, 1.5, TILE);
    }
  }
  if (id === "tokyo" || (id === "sochi" && variant === 1)) {
    g.fillStyle = "#9aa5a4";
    g.fillRect(28, 45, 48, 28);
    g.fillRect(154, 176, 60, 31);
    g.fillStyle = "#5c655f";
    g.fillRect(34, 50, 35, 18);
    g.fillRect(162, 181, 44, 18);
  }
}

export function createCityFacade(id: MapId): THREE.MeshStandardMaterial {
  const atlas = document.createElement("canvas");
  atlas.width = atlas.height = ATLAS;
  const g = atlas.getContext("2d")!;
  for (let variant = 0; variant < 2; variant++) {
    g.save();
    g.translate(variant * TILE, 0);
    windows(g, id, variant);
    g.translate(0, TILE);
    roof(g, id, variant);
    g.restore();
  }
  const texture = new THREE.CanvasTexture(atlas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.82,
    emissive: id === "tokyo" ? 0xafc9ff : 0x5d5149,
    emissiveIntensity: id === "tokyo" ? 0.48 : 0.15,
    emissiveMap: texture,
  });
}

// Inset the UVs from tile boundaries so roofs do not pick up the window grid.
function texel(u: number, v: number, tile: number): [number, number] {
  return [(tile % 2 * TILE + 3 + u * (TILE - 6)) / ATLAS, 1 - (Math.floor(tile / 2) * TILE + TILE - 3 - v * (TILE - 6)) / ATLAS];
}

export const TOKYO_TOWER_WIDTH = [0.94, 0.83] as const;

export function createBuildingGeometry(id: MapId, variant: 0 | 1): THREE.BufferGeometry {
  const pieces: THREE.BufferGeometry[] = [];
  const wallTile = variant;
  const roofTile = 2 + variant;
  const box = (w: number, bottom: number, top: number, d: number, tile: number = wallTile, x = 0) => {
    const indexed = new THREE.BoxGeometry(w, top - bottom, d);
    const geometry = indexed.toNonIndexed();
    indexed.dispose();
    geometry.translate(x, (bottom + top) / 2, 0);
    const uv = geometry.getAttribute("uv");
    const normal = geometry.getAttribute("normal");
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, ...texel(uv.getX(i), uv.getY(i), Math.abs(normal.getY(i)) > 0.5 ? roofTile : tile));
    }
    pieces.push(geometry);
  };

  const sloped = (bottom: number, top: number, w: number, d: number, peakW: number, peakD: number) => {
    const corners = (y: number, x: number, z: number) => [[-x, y, -z], [x, y, -z], [x, y, z], [-x, y, z]];
    const base = corners(bottom, w / 2, d / 2);
    const peak = corners(top, peakW / 2, peakD / 2);
    const pos: number[] = [];
    const uv: number[] = [];
    const plane = (points: number[][], tile: number, indices = [0, 1, 2, 0, 2, 3]) => {
      const coords = [[0, 0], [0, 1], [1, 1], [1, 0]];
      for (const i of indices) {
        pos.push(...points[i]);
        uv.push(...texel(coords[i][0], coords[i][1], tile));
      }
    };
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const gable = peakD === 0 && i % 2;
      plane([base[i], peak[i], peak[j], base[j]], gable ? wallTile : roofTile, gable ? [0, 1, 3] : undefined);
    }
    if (peakD > 0) plane(peak.slice().reverse(), roofTile);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geometry.computeVertexNormals();
    pieces.push(geometry);
  };

  switch (id) {
    case "tokyo":
      box(0.99, 0, 0.2, 0.99, 1);
      box(TOKYO_TOWER_WIDTH[variant], 0.2, 0.87, TOKYO_TOWER_WIDTH[variant]);
      box(0.68, 0.87, 0.95, 0.67, 1);
      box(0.28, 0.95, 1, 0.4, roofTile);
      break;
    case "yokohama":
      box(0.99, 0, variant ? 0.72 : 0.76, 0.99);
      if (variant) {
        for (const x of [-0.29, 0, 0.29]) box(0.27, 0.72, 0.92 - Math.abs(x) * 0.24, 0.87, roofTile, x);
        box(0.25, 0.92, 1, 0.34, roofTile);
      } else sloped(0.76, 1, 1, 1, 1, 0);
      break;
    case "spb":
      box(0.98, 0, 0.075, 0.99, roofTile);
      box(0.97, 0.075, 0.79, 0.97);
      box(1, 0.79, 0.825, 1, roofTile);
      if (variant) sloped(0.825, 1, 1, 1, 0.88, 0.24);
      else sloped(0.825, 1, 1, 1, 0.76, 0.59);
      break;
    case "kazan":
      box(0.97, 0, variant ? 0.69 : 0.92, 0.98);
      if (variant) sloped(0.69, 1, 1, 1, 1, 0);
      else {
        box(1, 0.92, 0.96, 1, roofTile);
        box(0.55, 0.96, 1, 0.32, roofTile);
      }
      break;
    case "sochi":
      if (variant) {
        box(0.99, 0, 0.29, 0.98);
        box(0.94, 0.29, 0.57, 0.89);
        box(0.87, 0.57, 0.79, 0.78);
        box(0.73, 0.79, 0.97, 0.66);
        box(0.51, 0.97, 1, 0.46, roofTile);
      } else {
        box(0.98, 0, 0.72, 0.96);
        sloped(0.72, 1, 1, 1, 0.57, 0.18);
      }
      break;
  }

  const geometry = mergeGeometries(pieces);
  pieces.forEach((piece) => piece.dispose());
  geometry.computeBoundingBox();
  return geometry;
}
