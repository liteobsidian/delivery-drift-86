import * as THREE from "three";
import type { World } from "./world";
import type { CityPoint } from "./map-layouts";
import { pointInPolygon } from "./city-building-layout";

const portraits = [
  new URL("../assets/roadside/flag-motion.webp", import.meta.url),
  new URL("../assets/roadside/camera-motion.webp", import.meta.url),
  new URL("../assets/roadside/balalaika-motion.webp", import.meta.url),
  new URL("../assets/roadside/accordion-motion.webp", import.meta.url),
];

interface Site extends CityPoint {
  yaw: number;
  span: number;
}
function sites(world: World) {
  const points: Site[] = [];
  const { bounds, roads, waterAreas } = world.layout;
  for (const road of roads)
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1],
        b = road.points[i];
      const dx = b.x - a.x,
        dz = b.z - a.z,
        length = Math.hypot(dx, dz);
      for (let d = Math.min(6, length / 2); d < length; d += 17)
        for (const side of [-1, 1]) {
          const offset = side * (road.width / 2 + 2.4);
          const x = a.x + (dx * d - dz * offset) / length,
            z = a.z + (dz * d + dx * offset) / length;
          if (
            x < bounds.minX + 2 ||
            x > bounds.maxX - 2 ||
            z < bounds.minZ + 2 ||
            z > bounds.maxZ - 2
          )
            continue;
          if (world.nearestRoadDist(x, z) < 1.4 || world.rampAt(x, z)) continue;
          if (
            world.buildings.some(
              (b) =>
                x > b.minX - 1.5 &&
                x < b.maxX + 1.5 &&
                z > b.minZ - 1.5 &&
                z < b.maxZ + 1.5,
            )
          )
            continue;
          if (waterAreas.some((w) => pointInPolygon(x, z, w.points))) continue;
          points.push({
            x,
            z,
            yaw: Math.atan2(-dz * side, dx * side),
            span: road.width + 4.8,
          });
        }
    }
  return points;
}

function signMaterial(label: string, color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = "#ffdf85";
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, 496, 112);
  ctx.fillStyle = "#fff3d4";
  ctx.font = "bold 52px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 256, 65, 460);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide });
}

export class Roadside {
  readonly group = new THREE.Group();
  private cache = new WeakMap<World, Site[]>();
  private materials = new Map<number, THREE.SpriteMaterial>();
  private signs = new Map<string, THREE.MeshBasicMaterial>();
  private panel = new THREE.PlaneGeometry(1, 1);
  private box = new THREE.BoxGeometry();
  private metal = new THREE.MeshLambertMaterial({ color: 0x667882 });
  private props: { object: THREE.Group; feet: CityPoint[]; fall: number }[] =
    [];
  private time = 0;

  private sign(p: Site, overhead: boolean, japanese: boolean) {
    const group = new THREE.Group();
    group.position.set(p.x, 0, p.z);
    group.rotation.y = p.yaw;
    const feet: CityPoint[] = [p];
    const width = overhead ? p.span : 1.5;
    const height = overhead ? 5.7 : 1.15;
    const support = (z: number) => {
      const pole = new THREE.Mesh(this.box, this.metal);
      pole.scale.set(0.12, height, 0.12);
      pole.position.set(0, height / 2, z);
      group.add(pole);
    };
    support(0);
    if (overhead) {
      support(-width);
      feet.push({
        x: p.x - width * Math.sin(p.yaw),
        z: p.z - width * Math.cos(p.yaw),
      });
    }
    const label = japanese
      ? overhead
        ? "NIGHT RUN  /  ナイト"
        : "ラーメン"
      : overhead
        ? "НОЧНОЙ ЗАЕЗД"
        : "КОФЕ С СОБОЙ";
    let material = this.signs.get(label);
    if (!material) {
      material = signMaterial(label, overhead ? "#27334f" : "#974129");
      this.signs.set(label, material);
    }
    const board = new THREE.Mesh(this.panel, material);
    board.rotation.y = Math.PI / 2;
    board.scale.set(width, overhead ? 1.05 : 0.72, 1);
    board.position.set(0, height, overhead ? -width / 2 : 0);
    group.add(board);
    this.group.add(group);
    this.props.push({ object: group, feet, fall: 0 });
  }

  reset(world: World, start: CityPoint, heading: number) {
    this.group.clear();
    this.props = [];
    const points = this.cache.get(world) ?? sites(world);
    this.cache.set(world, points);
    const shuffled = [...points];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const distance = (a: CityPoint, b: CityPoint) =>
      Math.hypot(a.x - b.x, a.z - b.z);
    const ahead = shuffled
      .filter((p) => {
        const dx = p.x - start.x,
          dz = p.z - start.z;
        const forward = dx * Math.sin(heading) + dz * Math.cos(heading);
        return (
          forward > 7 &&
          forward < 45 &&
          Math.abs(dx * Math.cos(heading) - dz * Math.sin(heading)) < 16
        );
      })
      .sort((a, b) => distance(a, start) - distance(b, start));
    const occupied: Site[] = [];
    const japanese = world.mapId === "tokyo" || world.mapId === "yokohama";
    const variant = Math.floor(Math.random() * 2);
    for (const p of [...ahead, ...shuffled]) {
      if (occupied.some((q) => distance(p, q) < 27)) continue;
      const id = (japanese ? 0 : 2) + ((variant + occupied.length) % 2);
      let material = this.materials.get(id);
      if (!material) {
        const map = new THREE.TextureLoader().load(portraits[id].href);
        map.colorSpace = THREE.SRGBColorSpace;
        map.repeat.set(1 / 4, 1 / 3);
        material = new THREE.SpriteMaterial({
          map,
          transparent: true,
          alphaTest: 0.15,
        });
        this.materials.set(id, material);
      }
      const figure = new THREE.Sprite(material);
      figure.name = "roadside-" + id;
      figure.center.set(0.5, 0);
      figure.position.set(p.x, 0.035, p.z);
      const height = japanese ? 2.2 : 2.75;
      figure.scale.set(height * 0.75, height, 1);
      this.group.add(figure);
      occupied.push(p);
      if (occupied.length >= 14) break;
    }
    for (const p of shuffled) {
      if (occupied.some((q) => distance(p, q) < 9)) continue;
      const opposite = {
        x: p.x - p.span * Math.sin(p.yaw),
        z: p.z - p.span * Math.cos(p.yaw),
      };
      const overhead =
        this.props.length % 5 === 0 &&
        points.some((q) => distance(q, opposite) < 0.1) &&
        occupied.every((q) => distance(q, opposite) > 7);
      this.sign(p, overhead, japanese);
      occupied.push(p);
      if (this.props.length >= 32) break;
    }
  }

  update(
    dt: number,
    previous: CityPoint,
    current: CityPoint,
    canHit: boolean,
  ): number {
    this.time += dt;
    for (const [id, mat] of this.materials) {
      const frame = (Math.floor(this.time * 10) + id * 3) % 12;
      mat.map!.offset.set((frame % 4) / 4, (2 - Math.floor(frame / 4)) / 3);
    }
    let hits = 0;
    const dx = current.x - previous.x,
      dz = current.z - previous.z;
    const lengthSq = dx * dx + dz * dz;
    for (const prop of this.props) {
      if (prop.fall > 0) {
        prop.fall = Math.min(1, prop.fall + dt * 2.5);
        prop.object.rotation.z = (prop.fall * prop.fall * Math.PI) / 2;
        if (prop.fall === 1) prop.object.visible = false;
      } else if (
        canHit &&
        prop.feet.some((p) => {
          const t = lengthSq
            ? THREE.MathUtils.clamp(
                ((p.x - previous.x) * dx + (p.z - previous.z) * dz) / lengthSq,
                0,
                1,
              )
            : 0;
          return (
            Math.hypot(previous.x + t * dx - p.x, previous.z + t * dz - p.z) <
            1.2
          );
        })
      ) {
        prop.fall = dt;
        hits++;
      }
    }
    return hits;
  }
  dispose() {
    this.group.removeFromParent();
    this.group.clear();
    for (const material of [
      ...this.materials.values(),
      ...this.signs.values(),
    ]) {
      material.map?.dispose();
      material.dispose();
    }
    this.panel.dispose();
    this.box.dispose();
    this.metal.dispose();
  }
}
