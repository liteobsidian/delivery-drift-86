import * as THREE from "three";
import { expect, it, vi } from "vitest";
import { showroomRain } from "./showroom-rain";

it("ends falling streaks on the displayed bodywork and emits short splash arcs", () => {
  const random = vi.spyOn(Math, "random").mockReturnValue(.5);
  try {
    const parent = new THREE.Group();
    parent.rotation.y = .32;
    const body = new THREE.Mesh(new THREE.BoxGeometry(2,1,4));
    body.position.y = .5;
    parent.add(body);
    const weather = showroomRain();
    weather.sample(body, new THREE.Box3(new THREE.Vector3(-1,0,-2), new THREE.Vector3(1,1,2)));
    let sawFall = false, sawSplash = false;
    for (let i=0;i<90;i++) {
      weather.update(1/60);
      const points = weather.lines.geometry.attributes.position;
      const y = points.getY(0);
      expect(y).toBeGreaterThanOrEqual(1);
      const isSplash = points.getY(1)-y < .05;
      if (isSplash) {
        expect(y).toBeLessThan(1.12);
        sawSplash = true;
      } else sawFall = true;
    }
    expect(sawFall && sawSplash).toBe(true);
  } finally { random.mockRestore(); }
});
