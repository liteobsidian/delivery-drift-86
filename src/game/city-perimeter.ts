import * as THREE from "three";
import type { CityLayout } from "./map-layouts";

// Coordinates of the inner concrete faces. Include pavement, shoulders and road end caps.
export function perimeterBounds(layout: CityLayout) {
  const bounds = { ...layout.bounds };
  for (const road of layout.roads) {
    const shoulder = road.width / 2 + 3;
    for (const { x, z } of road.points) {
      bounds.minX = Math.min(bounds.minX, x - shoulder);
      bounds.maxX = Math.max(bounds.maxX, x + shoulder);
      bounds.minZ = Math.min(bounds.minZ, z - shoulder);
      bounds.maxZ = Math.max(bounds.maxZ, z + shoulder);
    }
  }
  return bounds;
}

function concreteMural(layout: CityLayout) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 128;
  const g = canvas.getContext("2d")!;
  const shade = g.createLinearGradient(0, 0, 0, 128);
  shade.addColorStop(0, "#b9b9b0");
  shade.addColorStop(0.2, "#969992");
  shade.addColorStop(1, "#525a5f");
  g.fillStyle = shade;
  g.fillRect(0, 0, 1024, 128);
  const japanese = layout.id === "tokyo" || layout.id === "yokohama";
  g.fillStyle = japanese ? "#d45754" : "#e9b54f";
  g.beginPath();
  g.arc(260, 57, 36, 0, Math.PI * 2);
  g.fill();
  for (const [offset, color] of [
    [0, "#34737a"],
    [16, "#27455a"],
  ] as const) {
    g.beginPath();
    g.moveTo(35, 105);
    for (let x = 35; x <= 570; x += 4) {
      const crest = japanese
        ? Math.sin(x / 42 + offset) * 13 + Math.sin(x / 20) * 5
        : -Math.abs(Math.sin(x / 53 + offset)) * 26;
      g.lineTo(x, 72 + offset + crest);
    }
    g.lineTo(570, 105);
    g.closePath();
    g.fillStyle = color;
    g.fill();
  }
  g.fillStyle = "#233844";
  g.font = "bold italic 42px sans-serif";
  g.fillText("DRIFT 86", 614, 80);
  // Cast panel seams, anchor holes and amber reflectors repeat at driving scale.
  for (let x = 0; x < 1024; x += 128) {
    g.fillStyle = "#626869";
    g.fillRect(x, 0, 3, 128);
    for (const y of [14, 106]) {
      g.fillStyle = "#53585a";
      g.fillRect(x + 12, y, 4, 4);
    }
    g.fillStyle = "#302f31";
    g.fillRect(x + 75, 8, 24, 9);
    g.fillStyle = "#ffcc60";
    g.fillRect(x + 77, 10, 20, 5);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

export function buildPerimeter(layout: CityLayout, b: CityLayout["bounds"]) {
  const group = new THREE.Group();
  group.name = "city-perimeter";
  const texture = concreteMural(layout);
  const mural = new THREE.MeshStandardMaterial({
    map: texture,
    emissive: 0xffffff,
    emissiveMap: texture,
    emissiveIntensity: 0.34,
    roughness: 1,
  });
  const concrete = new THREE.MeshStandardMaterial({
    color: 0x999991,
    roughness: 1,
  });
  const thickness = 0.65;
  function wall(length: number, x: number, z: number, angle: number) {
    const geometry = new THREE.BoxGeometry(length, 1.55, thickness);
    const uv = geometry.attributes.uv;
    // BoxGeometry places the two broad faces last.
    for (let i = 16; i < 24; i++) uv.setX(i, (uv.getX(i) * length) / 22);
    const mesh = new THREE.Mesh(geometry, [
      concrete,
      concrete,
      concrete,
      concrete,
      mural,
      mural,
    ]);
    mesh.position.set(x, 0.775, z);
    mesh.rotation.y = angle;
    group.add(mesh);
  }
  const cx = (b.minX + b.maxX) / 2,
    cz = (b.minZ + b.maxZ) / 2;
  for (const x of [b.minX - thickness / 2, b.maxX + thickness / 2])
    wall(b.maxZ - b.minZ, x, cz, Math.PI / 2);
  for (const z of [b.minZ - thickness / 2, b.maxZ + thickness / 2])
    wall(b.maxX - b.minX + 2 * thickness, cx, z, 0);
  return group;
}
