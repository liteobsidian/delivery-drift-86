import * as THREE from "three";
import { showroomGround } from "./showroom-ground";
import { showroomRain } from "./showroom-rain";
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

  const carGroup = new THREE.Group();
  const weather = showroomRain();
  const weatherGroup = new THREE.Group();
  weatherGroup.add(weather.lines);
  scene.add(carGroup, weatherGroup);
  const loader = new THREE.TextureLoader();
  const background = (url: string) => {
    const texture = loader.load(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  };
  const street = background(new URL("../assets/ui/night-street.webp", import.meta.url).href);
  const workshop = background(new URL("../assets/ui/workshop.webp", import.meta.url).href);
  const ground = showroomGround();
  scene.add(ground.group);
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
    frame(aspect: number, streetMenu = false, workshopView = false): void {
      camera.aspect = aspect;
      const fit = Math.max(1, 1.27 / aspect);
      camera.position.set(-3.8 * fit, 1.38 * fit, -5.4 * fit);
      if (workshopView) camera.position.set(-6.1 * fit, 1.38 * fit, -2.8 * fit);
      camera.lookAt(0, 1.06, 0);
      camera.clearViewOffset();
      if (streetMenu && aspect > 1) camera.setViewOffset(aspect, 1, aspect * .17, 0, aspect, 1);
      camera.updateProjectionMatrix();
    },
    setCar(spec: CarSpec, up: UpgradeLevels, model: LoadedModel): void {
      const tune = `${up.engine}${up.tires}${up.suspension}${up.turbo}`;
      if (activeModel === model && activeTune === tune) return;
      const changedCar = activeModel !== model;

      clearCar();
      activeModel = model;
      activeTune = tune;
      const wheels: THREE.Mesh[] = [];
      car = buildHeroMesh(spec, model, wheels);
      const box = new THREE.Box3().setFromObject(car.children[0], true);
      const center = box.getCenter(new THREE.Vector3());
      const contacts = wheels.map(wheel => new THREE.Box3().setFromObject(wheel, true));
      const bottom = contacts.length ? Math.min(...contacts.map(contact => contact.min.y)) : box.min.y;
      car.position.set(-center.x, -bottom, -center.z);
      ground.fit(box, contacts.map(contact => contact.getCenter(new THREE.Vector3()).add(car!.position)));
      const glow = car.getObjectByName("hero-underglow");
      if (glow) glow.visible = false;
      applyUpgradeLooks(car, up);
      carGroup.add(car);
      weather.sample(car);
      if (changedCar) {
        carGroup.rotation.y = 0;
        resumeAfter = 0.85;
      }
    },
    rotate(radians: number): void {
      carGroup.rotation.y += radians;
      resumeAfter = 2.5;
    },
    update(dt: number, autoRotate: boolean, outside: boolean): void {
      scene.background = outside ? street : workshop;
      // Preserve the workshop photograph's proportions even on a tall phone.
      if (!outside && workshop.image?.width) {
        const ratio = camera.aspect / (workshop.image.width / workshop.image.height);
        workshop.repeat.set(Math.min(1, ratio), Math.min(1, 1 / ratio));
        workshop.offset.set((1 - workshop.repeat.x) / 2, (1 - workshop.repeat.y) / 2);
      }
      weatherGroup.visible = outside && autoRotate;
      weatherGroup.rotation.y = ground.group.rotation.y = carGroup.rotation.y;
      ground.group.visible = !!car;
      ground.rails.visible = !outside;
      if (weatherGroup.visible) weather.update(dt);
      if (outside) return;
      if (!car || !autoRotate) return;
      if (resumeAfter > 0) resumeAfter -= dt;
      else carGroup.rotation.y += dt * 0.15;
    },
    dispose(): void {
      clearCar();
      street.dispose(); workshop.dispose(); ground.texture.dispose();
      disposeCarVisual(scene);
    },
  };
}
