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
  // The straight road vanishes just below the centre of the background plate.
  const streetHorizon = .52;
  let workshop: THREE.Texture | undefined;
  const ground = showroomGround();
  scene.add(ground.group);
  // Bake the parked car's silhouette once onto the pavement. The transparent
  // receiver darkens the photo underneath without replacing its wet texture.
  const streetLamp = new THREE.DirectionalLight(0xffd4b0, .33);
  streetLamp.position.set(4, 5, -2.5);
  streetLamp.castShadow = true;
  streetLamp.shadow.autoUpdate = false;
  streetLamp.shadow.mapSize.set(512, 512);
  streetLamp.shadow.camera.left = streetLamp.shadow.camera.bottom = -4;
  streetLamp.shadow.camera.right = streetLamp.shadow.camera.top = 4;
  streetLamp.shadow.camera.far = 14;
  streetLamp.shadow.bias = -.0005;
  streetLamp.shadow.radius = 2.25;
  const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.ShadowMaterial({
    opacity: .57, depthWrite: false, fog: false,
  }));
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.receiveShadow = true;
  scene.add(streetLamp, asphalt);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 80);
  let car: THREE.Group | undefined;
  let activeModel: LoadedModel | undefined;
  let activeTune = "";
  const inspectionHeading = Math.atan2(3.8, 5.4);
  const parkingHeading = inspectionHeading - THREE.MathUtils.degToRad(19);
  carGroup.rotation.y = parkingHeading;

  function fitBackground(texture: THREE.Texture, horizon: number): void {
    if (!texture.image?.width) return;
    const ratio = camera.aspect / (texture.image.width / texture.image.height);
    texture.repeat.set(Math.min(1, ratio), Math.min(1, 1 / ratio));
    texture.offset.set((1 - texture.repeat.x) / 2, (1 - texture.repeat.y) * (1 - horizon));
  }

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
      if (streetMenu) {
        // Match the eye line of the photograph so the tires sit on the street.
        camera.position.y = 1.18 * fit;
        const tanPitch = (2 * streetHorizon - 1) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        camera.lookAt(0, camera.position.y + Math.hypot(camera.position.x, camera.position.z) * tanPitch, 0);
        camera.setViewOffset(aspect, 1, aspect * .17, 0, aspect, 1);
      }
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
      car.traverse(node => { if (node instanceof THREE.Mesh) node.castShadow = true; });
      carGroup.add(car);
      weather.sample(car, box.translate(car.position));
      streetLamp.shadow.needsUpdate = true;
      if (changedCar) {
        carGroup.rotation.y = inspectionHeading;
      }
    },
    rotate(radians: number): void {
      carGroup.rotation.y += radians;
    },
    update(dt: number, animateRain: boolean, outside: boolean): void {
      scene.background = outside ? street : (workshop ??= background(new URL("../assets/ui/workshop.webp", import.meta.url).href));
      fitBackground(scene.background, outside ? streetHorizon : .5);
      streetLamp.visible = outside;
      asphalt.visible = outside && !!car;
      // The street has a fixed parking direction independent of the workshop turntable.
      if (outside) carGroup.rotation.y = parkingHeading;
      weatherGroup.visible = outside && animateRain;
      weatherGroup.rotation.y = ground.group.rotation.y = carGroup.rotation.y;
      ground.group.visible = !!car;
      ground.rails.visible = !outside;
      if (weatherGroup.visible) weather.update(dt);
    },
    dispose(): void {
      clearCar();
      streetLamp.shadow.dispose();
      street.dispose(); workshop?.dispose(); ground.texture.dispose();
      disposeCarVisual(scene);
    },
  };
}
