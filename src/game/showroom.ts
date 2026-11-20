import * as THREE from "three";
import type { LoadedModel } from "./assets";
import { applyUpgradeLooks, buildHeroMesh, disposeCarVisual } from "./car";
import type { CarSpec, UpgradeLevels } from "./types";

export function createShowroom() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101929);
  scene.fog = new THREE.Fog(0x101929, 12, 32);

  scene.add(new THREE.HemisphereLight(0x9eaccb, 0x303052, 1.6));
  const key = new THREE.DirectionalLight(0xfff0dd, 1.85);
  key.position.set(2, 6, -5);
  const rim = new THREE.DirectionalLight(0x70c8ff, 1.7);
  rim.position.set(-5, 3, 5);
  const fill = new THREE.DirectionalLight(0xff587e, 0.55);
  fill.position.set(5, 2, 3);
  scene.add(key, rim, fill);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({ color: 0x141c2a, metalness: 0.2, roughness: 0.8 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.23;
  const grid = new THREE.GridHelper(60, 40, 0x38445e, 0x252e43);
  grid.position.y = -0.22;
  scene.add(floor, grid);

  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(3.02, 3.18, 0.22, 56),
    new THREE.MeshStandardMaterial({ color: 0x263147, roughness: 0.5, metalness: 0.36 }),
  );
  disc.position.y = -0.11;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(3.03, 0.025, 8, 72),
    new THREE.MeshBasicMaterial({ color: 0x61daf7 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.015;
  scene.add(disc, ring);

  const carGroup = new THREE.Group();
  scene.add(carGroup);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 80);
  let car: THREE.Group | undefined;
  let activeModel: LoadedModel | undefined;
  let activeTune = "";
  let resumeAfter = 0;

  function clearCar(): void {
    if (car) {
      car.removeFromParent();
      disposeCarVisual(car, true);
    }
    car = undefined;
    activeModel = undefined;
    activeTune = "";
  }

  return {
    scene,
    camera,
    carGroup,
    clearCar,
    frame(aspect: number): void {
      camera.aspect = aspect;
      const fit = Math.max(1, 1.27 / aspect);
      camera.position.set(-4.45 * fit, 2.35 * fit, -5.9 * fit);
      camera.lookAt(0, 0.72, 0);
      camera.updateProjectionMatrix();
    },
    setCar(spec: CarSpec, up: UpgradeLevels, model: LoadedModel): void {
      const tune = `${up.engine}${up.tires}${up.suspension}${up.turbo}`;
      if (activeModel === model && activeTune === tune) return;
      const changedCar = activeModel !== model;
      clearCar();
      activeModel = model;
      activeTune = tune;
      car = buildHeroMesh(spec, model);
      applyUpgradeLooks(car, up);
      carGroup.add(car);
      if (changedCar) {
        carGroup.rotation.y = 0;
        resumeAfter = 0.85;
      }
    },
    rotate(radians: number): void {
      carGroup.rotation.y += radians;
      resumeAfter = 2.5;
    },
    update(dt: number, autoRotate: boolean): void {
      if (!car || !autoRotate) return;
      if (resumeAfter > 0) resumeAfter -= dt;
      else carGroup.rotation.y += dt * 0.52;
    },
    dispose(): void {
      clearCar();
      disposeCarVisual(scene);
    },
  };
}
