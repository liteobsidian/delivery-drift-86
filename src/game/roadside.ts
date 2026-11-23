import * as THREE from "three";
import type { World } from "./world";
import type { CityPoint } from "./map-layouts";
import { pointInPolygon } from "./city-building-layout";

const portraits = [
  new URL("../assets/roadside/flag.webp", import.meta.url),
  new URL("../assets/roadside/camera.webp", import.meta.url),
  new URL("../assets/roadside/balalaika.webp", import.meta.url),
  new URL("../assets/roadside/accordion.webp", import.meta.url),
];

function sites(world: World) {
  const points: CityPoint[] = [];
  const { bounds, roads, waterAreas } = world.layout;
  for (const road of roads) for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i-1], b = road.points[i];
    const dx = b.x-a.x, dz = b.z-a.z, length = Math.hypot(dx,dz);
    for (let d = Math.min(6,length/2); d < length; d += 17) for (const side of [-1,1]) {
      const offset = side*(road.width/2+2.4);
      const x = a.x+(dx*d-dz*offset)/length, z = a.z+(dz*d+dx*offset)/length;
      if (x < bounds.minX+2 || x > bounds.maxX-2 || z < bounds.minZ+2 || z > bounds.maxZ-2) continue;
      if (world.nearestRoadDist(x,z)<1.4 || world.rampAt(x,z)) continue;
      if (world.buildings.some(b=>x>b.minX-1.5 && x<b.maxX+1.5 && z>b.minZ-1.5 && z<b.maxZ+1.5)) continue;
      if (waterAreas.some(w=>pointInPolygon(x,z,w.points))) continue;
      points.push({x,z});
    }
  }
  return points;
}

export class Roadside {
  readonly group = new THREE.Group();
  private cache = new WeakMap<World,CityPoint[]>();
  private materials = new Map<number,THREE.SpriteMaterial>();

  reset(world: World, start: CityPoint) {
    this.group.clear();
    const points = this.cache.get(world) ?? sites(world);
    this.cache.set(world, points);
    const near = points.filter(p=>{const d=Math.hypot(p.x-start.x,p.z-start.z);return d>18 && d<85});
    const pick = (list: CityPoint[]) => list[Math.floor(Math.random()*list.length)];
    const first = pick(near.length ? near : points);
    if (!first) return;
    const second = pick(points.filter(p=>Math.hypot(p.x-first.x,p.z-first.z)>65));
    const japanese = world.mapId==="tokyo" || world.mapId==="yokohama";
    const variant = Math.random()<.5 ? 0 : 1;
    for (const [i, p] of [first, second].entries()) {
      if (!p) continue;
      const id = (japanese ? 0 : 2)+(variant+i)%2;
      let material = this.materials.get(id);
      if (!material) {
        const texture = new THREE.TextureLoader().load(portraits[id].href);
        texture.colorSpace = THREE.SRGBColorSpace;
        material = new THREE.SpriteMaterial({map:texture,transparent:true,alphaTest:.12,depthWrite:false});
        this.materials.set(id,material);
      }
      const figure = new THREE.Sprite(material);
      figure.name = "roadside-"+id;
      figure.center.set(.5,0);
      figure.position.set(p.x,.035,p.z);
      const height = japanese ? 2.2 : 2.75;
      figure.scale.set(height*.75,height,1);
      this.group.add(figure);
    }
  }
  dispose() {
    this.group.removeFromParent();
    this.group.clear();
    for (const material of this.materials.values()) { material.map?.dispose(); material.dispose(); }
  }
}
