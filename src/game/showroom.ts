import * as THREE from "three";
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
  const shadowCanvas = document.createElement("canvas");
  shadowCanvas.width = shadowCanvas.height = 64;
  const ctx = shadowCanvas.getContext("2d")!;
  const shade = ctx.createRadialGradient(32,32,4,32,32,32);
  shade.addColorStop(0,"rgba(0,0,0,.85)");
  shade.addColorStop(1,"transparent");
  ctx.fillStyle = shade;
  ctx.fillRect(0,0,64,64);
  const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.4,5.7),new THREE.MeshBasicMaterial({map:shadowTexture,transparent:true,depthWrite:false}));
  shadow.rotation.x=-Math.PI/2;
  scene.add(shadow);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 80);
  let car: THREE.Group | undefined;
  let activeModel: LoadedModel | undefined;
  let activeTune = "";
  let resumeAfter = 0;
  let tuneReveal = 0;

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
    frame(aspect: number, streetMenu = false): void {
      camera.aspect = aspect;
      const fit = Math.max(1, 1.27 / aspect);
      camera.position.set(-4.45 * fit, 2.35 * fit, -5.9 * fit);
      camera.lookAt(0, 0.72, 0);
      camera.clearViewOffset();
      if (streetMenu && aspect > 1) camera.setViewOffset(aspect, 1, aspect * .17, 0, aspect, 1);
      camera.updateProjectionMatrix();
    },
    setCar(spec: CarSpec, up: UpgradeLevels, model: LoadedModel): void {
      const tune = `${up.engine}${up.tires}${up.suspension}${up.turbo}`;
      if (activeModel === model && activeTune === tune) return;
      const changedCar = activeModel !== model;
      tuneReveal = changedCar ? 0 : .38;
      clearCar();
      activeModel = model;
      activeTune = tune;
      car = buildHeroMesh(spec, model);
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
      weatherGroup.visible = outside && autoRotate;
      weatherGroup.rotation.y = shadow.rotation.z = carGroup.rotation.y;
      if (weatherGroup.visible) weather.update(dt);
      if (tuneReveal > 0) {
        tuneReveal = Math.max(0, tuneReveal-dt);
        carGroup.position.y = autoRotate ? Math.sin(tuneReveal/.38*Math.PI)*.09 : 0;
      } else carGroup.position.y = 0;
      if (outside) return;
      if (!car || !autoRotate) return;
      if (resumeAfter > 0) resumeAfter -= dt;
      else carGroup.rotation.y += dt * 0.52;
    },
    dispose(): void {
      clearCar();
      street.dispose(); workshop.dispose(); shadowTexture.dispose();
      disposeCarVisual(scene);
    },
  };
}
