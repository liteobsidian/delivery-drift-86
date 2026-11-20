import * as THREE from "three";
import type { HeroModelKey } from "./types";

type PaintSection = readonly [start: number, end: number];
type PaintSections = readonly [PaintSection, PaintSection?, PaintSection?];

export interface PaintSurface {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
}

// Measured hood, roof and rear deck spans along the normalized nose-to-tail
// axis. These models bake windows and trim into the same atlas as the paint.
const BAKED_PAINT_SECTIONS: Partial<Record<HeroModelKey, PaintSections>> = {
  ae86: [[0.06, 0.294], [0.46, 0.687], [0.849, 0.907]],
  supra: [[0.09, 0.309], [0.495, 0.706], [0.878, 0.925]],
  silvia: [[0.075, 0.316], [0.477, 0.69], [0.855, 0.918]],
  rx7: [[0.065, 0.296], [0.485, 0.677], [0.835, 0.889]],
  r34: [[0.085, 0.283], [0.471, 0.69], [0.835, 0.925]],
  nsx: [[0.138, 0.252], [0.452, 0.618], [0.851, 0.906]],
  evo: [[0.148, 0.257], [0.448, 0.742], [0.887, 0.91]],
};
// The baked interiors share the roof's longitudinal coordinates. All seven
// roofs sit above this height, clear of the seats visible through the windows.
const BAKED_ROOF_FLOOR = 0.91;

const stripeColor = new THREE.Color(0xeef2f8);
const stripeEmissive = new THREE.Color(0xbfc8dd).multiplyScalar(0.12);
const liveryByCar = new WeakMap<THREE.Object3D, (visible: boolean) => void>();

export function prepareHeroLivery(
  root: THREE.Group,
  model: THREE.Group,
  key: HeroModelKey,
  body: THREE.Mesh,
  paintSurfaces: PaintSurface[],
): void {
  if (paintSurfaces.length > 0) {
    prepareCarLivery(root, paintSurfaces, new THREE.Box3().setFromObject(model), [[0.08, 0.92]]);
    return;
  }
  const sections = BAKED_PAINT_SECTIONS[key];
  const material = body.material as THREE.MeshStandardMaterial | THREE.Material[];
  if (sections && !Array.isArray(material) && material.isMeshStandardMaterial &&
      material.map && !/glass|window/i.test(material.name)) {
    prepareCarLivery(root, [{ mesh: body, material }], new THREE.Box3().setFromObject(model), sections, BAKED_ROOF_FLOOR);
  }
}

/** Project paint in the car's assembly pose so it moves and deforms with each mesh. */
export function prepareCarLivery(
  root: THREE.Group,
  surfaces: PaintSurface[],
  bounds: THREE.Box3,
  sections: PaintSections,
  roofFloor = -1,
): void {
  const size = bounds.getSize(new THREE.Vector3());
  if (size.x <= 0 || size.z <= 0) return;
  const center = bounds.getCenter(new THREE.Vector3());
  const projection = new THREE.Matrix4().makeScale(1, 1 / (size.y || 1), 1 / size.z)
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -bounds.min.z));
  const uniformCenter = { value: size.x * 0.16 };
  const [first, second = [0, 0], third = [0, 0]] = sections;
  const starts = { value: new THREE.Vector3(first[0], second[0], third[0]) };
  const ends = { value: new THREE.Vector3(first[1], second[1], third[1]) };
  const enabled = { value: false };
  const fits = surfaces.map(({ mesh, material }) => {
    mesh.updateWorldMatrix(true, false);
    return {
      material,
      frame: { value: projection.clone().multiply(mesh.matrixWorld) },
      normals: { value: new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld) },
    };
  });
  let installed = false;

  liveryByCar.set(root, (visible) => {
    enabled.value = visible;
    if (installed || !visible) return;
    installed = true;
    for (const { material, frame, normals } of fits) {
      material.customProgramCacheKey = () => "car-livery";
      material.onBeforeCompile = (shader) => {
        shader.uniforms.carLiveryEnabled = enabled;
        shader.uniforms.carLiveryFrame = frame;
        shader.uniforms.carLiveryNormals = normals;
        shader.uniforms.carLiveryCenter = uniformCenter;
        shader.uniforms.carLiveryStarts = starts;
        shader.uniforms.carLiveryEnds = ends;
        shader.uniforms.carLiveryRoofFloor = { value: roofFloor };
        shader.uniforms.carStripeColor = { value: stripeColor };
        shader.uniforms.carStripeEmissive = { value: stripeEmissive };
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", `#include <common>
            varying vec4 vCarLivery;
            uniform mat4 carLiveryFrame;
            uniform mat3 carLiveryNormals;
          `)
          .replace("#include <begin_vertex>", `#include <begin_vertex>
            vec3 liveryPos = (carLiveryFrame * vec4(position, 1.0)).xyz;
            vCarLivery = vec4(liveryPos, normalize(carLiveryNormals * normal).y);
          `);
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", `#include <common>
            varying vec4 vCarLivery;
            uniform bool carLiveryEnabled;
            uniform float carLiveryCenter;
            uniform vec3 carLiveryStarts;
            uniform vec3 carLiveryEnds;
            uniform float carLiveryRoofFloor;
            uniform vec3 carStripeColor;
            uniform vec3 carStripeEmissive;
          `)
          .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
            if (carLiveryEnabled && gl_FrontFacing) {
              vec3 panels = min(vCarLivery.z - carLiveryStarts, carLiveryEnds - vCarLivery.z);
              panels.y = mix(-1.0, panels.y, step(carLiveryRoofFloor, vCarLivery.y));
              float frontToBack = max(panels.x, max(panels.y, panels.z));
              float across = 0.10 - abs(abs(vCarLivery.x) - carLiveryCenter);
              float edge = min(frontToBack, across);
              float paint = smoothstep(0.0, max(fwidth(edge), 0.0001), edge)
                * smoothstep(0.2, 0.55, vCarLivery.w);
              diffuseColor.rgb = mix(diffuseColor.rgb, carStripeColor, paint);
              roughnessFactor = mix(roughnessFactor, 0.45, paint);
              metalnessFactor = mix(metalnessFactor, 0.25, paint);
              totalEmissiveRadiance = mix(totalEmissiveRadiance, carStripeEmissive, paint);
            }
          `);
      };
      material.needsUpdate = true;
    }
  });
}

export function setCarLiveryVisible(root: THREE.Object3D, visible: boolean): void {
  liveryByCar.get(root)?.(visible);
}
