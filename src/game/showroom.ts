/**
 * showroom.ts — offscreen car rendering: garage thumbnails and the title-screen
 * turntable. One tiny WebGLRenderer is created lazily and reused.
 */
import * as THREE from "three";
import type { CarSpec } from "./types";
import { buildCarMesh, buildHeroMesh, applyUpgradeLooks } from "./car";
import { tunedSpec } from "./config";
import type { UpgradeLevels } from "./types";
import type { LoadedModel } from "./assets";

/** dispose per-instance materials; GLB hero clones share template geometry */
function disposeCarVisual(obj: THREE.Object3D, keepGeometry: boolean): void {
  obj.traverse((o) => {
    const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
    if (!keepGeometry) (o as THREE.Mesh).geometry?.dispose?.();
  });
}

let thumbRenderer: THREE.WebGLRenderer | null = null;
let thumbScene: THREE.Scene | null = null;
let thumbCamera: THREE.PerspectiveCamera | null = null;
const thumbCache = new Map<string, string>();

function ensureThumbRig(): void {
  if (thumbRenderer) return;
  thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  thumbRenderer.setSize(260, 160);
  thumbRenderer.setPixelRatio(1);
  thumbRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  thumbRenderer.toneMappingExposure = 1.25;
  thumbScene = new THREE.Scene();
  thumbScene.add(new THREE.HemisphereLight(0x8899cc, 0x1a1430, 1.6));
  const key = new THREE.DirectionalLight(0xfff2dd, 2.2);
  key.position.set(3, 5, 4);
  thumbScene.add(key);
  const rim = new THREE.DirectionalLight(0xff2d95, 1.4);
  rim.position.set(-4, 2, -4);
  thumbScene.add(rim);
  thumbScene.background = new THREE.Color(0x0d1122);
  thumbCamera = new THREE.PerspectiveCamera(34, 260 / 160, 0.1, 60);
  thumbCamera.position.set(4.4, 2.1, 5.0);
  thumbCamera.lookAt(0, 0.4, 0);
}

/** Render (and cache) a garage thumbnail for a car spec. */
export function carThumb(spec: CarSpec, up?: UpgradeLevels, hero?: LoadedModel): string {
  const tuned = up ? tunedSpec(spec, up) : spec;
  const key = `${tuned.id}/${up ? `${up.engine}${up.tires}${up.suspension}${up.turbo}` : "0"}${hero ? "+glb" : ""}`;
  const hit = thumbCache.get(key);
  if (hit) return hit;
  ensureThumbRig();
  const mesh = hero ? buildHeroMesh(tuned, hero) : buildCarMesh(tuned);
  applyUpgradeLooks(mesh, up ?? { engine: 0, tires: 0, suspension: 0, turbo: 0 });
  thumbScene!.add(mesh);
  thumbRenderer!.render(thumbScene!, thumbCamera!);
  const url = thumbRenderer!.domElement.toDataURL("image/png");
  thumbScene!.remove(mesh);
  disposeCarVisual(mesh, !!hero);
  thumbCache.set(key, url);
  return url;
}

export interface Showroom {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  carGroup: THREE.Group;
  setCar: (spec: CarSpec, up: UpgradeLevels, hero?: LoadedModel) => void;
  update: (dt: number) => void;
}

/** Full-screen title background: current car on a slowly spinning neon platform. */
export function createShowroom(): Showroom {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070a18);
  scene.fog = new THREE.Fog(0x070a18, 14, 34);

  scene.add(new THREE.HemisphereLight(0x6672aa, 0x141020, 1.1));
  const key = new THREE.DirectionalLight(0xfff0d8, 1.5);
  key.position.set(5, 8, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xff2d95, 1.5);
  rim.position.set(-6, 3, -6);
  scene.add(rim);
  const cool = new THREE.DirectionalLight(0x37e0ff, 1.2);
  cool.position.set(-4, 2, 6);
  scene.add(cool);

  // platform
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(3.4, 3.7, 0.22, 40),
    new THREE.MeshStandardMaterial({ color: 0x161c30, roughness: 0.4, metalness: 0.6 })
  );
  disc.position.y = -0.11;
  scene.add(disc);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(3.55, 0.07, 8, 48),
    new THREE.MeshBasicMaterial({ color: 0x37e0ff })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.02;
  scene.add(ring);
  const ring2 = new THREE.Mesh(
    new THREE.TorusGeometry(2.6, 0.045, 8, 40),
    new THREE.MeshBasicMaterial({ color: 0xff2d95 })
  );
  ring2.rotation.x = Math.PI / 2;
  ring2.position.y = 0.03;
  scene.add(ring2);

  const carGroup = new THREE.Group();
  scene.add(carGroup);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(4.6, 2.0, 5.2);
  camera.lookAt(0, 0.5, 0);

  let car: THREE.Group | null = null;
  let carWasHero = false;
  return {
    scene,
    camera,
    carGroup,
    setCar(spec, up, hero) {
      if (car) {
        carGroup.remove(car);
        disposeCarVisual(car, carWasHero);
      }
      carWasHero = !!hero;
      car = hero
        ? buildHeroMesh(tunedSpec(spec, up), hero)
        : buildCarMesh(tunedSpec(spec, up));
      applyUpgradeLooks(car, up);
      carGroup.add(car);
      // detailed library bodies are bulkier — frame them a bit wider
      camera.position.set(
        hero ? 6.2 : 4.6,
        hero ? 2.5 : 2.0,
        hero ? 7.0 : 5.2
      );
      camera.lookAt(0, 0.5, 0);
    },
    update(dt: number) {
      carGroup.rotation.y += dt * 0.45;
      const s = 1 + Math.sin(performance.now() * 0.0012) * 0.04;
      ring.scale.setScalar(s);
      ring2.scale.setScalar(2 - s);
    },
  };
}
