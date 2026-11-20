import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { StreetLights } from "./street-lights";

function fixture() {
  const geometry = new THREE.BoxGeometry(0.3, 6, 0.3);
  const material = new THREE.MeshBasicMaterial();
  const poles = new THREE.InstancedMesh(geometry, material, 2);
  const tips = new THREE.InstancedMesh(geometry, material, 2);
  const lights = new StreetLights(poles, tips, [{ x: 12.1, z: 0 }, { x: 30, z: 0 }], 6);
  return { poles, tips, lights, matrix: new THREE.Matrix4() };
}

describe("street lamps", () => {
  it("detects a fast pass through a pole in the next cell and leaves it fallen", () => {
    const { poles, tips, lights, matrix } = fixture();
    expect(lights.knock(9, 0, 16, 0, 0, 0.1)).toMatchObject({ x: 12.1, z: 0 });
    tips.getMatrixAt(0, matrix);
    expect(matrix.elements[0]).toBe(0);
    lights.update(0.26);
    poles.getMatrixAt(0, matrix);
    expect(matrix.elements[12]).toBeGreaterThan(12.1);
    expect(matrix.elements[13]).toBeLessThan(3);
    lights.update(0.26);
    poles.getMatrixAt(0, matrix);
    expect(matrix.elements[13]).toBeLessThan(0.4);
    expect(lights.knock(9, 0, 16, 0, 0, 0.1)).toBeNull();
    poles.getMatrixAt(1, matrix);
    expect(matrix.elements[13]).toBe(3);
  });

  it("keeps lamps standing when the car misses, crawls, or passes above the tip", () => {
    const { lights } = fixture();
    expect(lights.knock(9, 2, 16, 2, 0, 0.1)).toBeNull();
    expect(lights.knock(12, 0, 12.3, 0, 0, 0.1)).toBeNull();
    expect(lights.knock(9, 0, 16, 0, 7, 0.1)).toBeNull();
    expect(lights.knock(9, 0, 16, 0, 0, 0.1)).not.toBeNull();
  });
});
