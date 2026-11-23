import * as THREE from "three";

interface Drop {
  x: number; z: number; surface: number; speed: number; offset: number; splash: boolean;
}

// A drop and the droplets it breaks into share a contact point and a clock.
// Surface queries run when the display model changes, outside the animation loop.
export function showroomRain() {
  const ambientCount = 96, bodyCount = 32, fragments = 4;
  const positions = new THREE.BufferAttribute(new Float32Array((ambientCount + bodyCount) * fragments * 6), 3)
    .setUsage(THREE.DynamicDrawUsage);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", positions);
  geometry.setDrawRange(0, 0);
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
    color: 0xd5e7ed, transparent: true, opacity: .64, depthWrite: false,
  }));
  lines.frustumCulled = false;
  const drops: Drop[] = [];
  let clock = 0;

  return {
    lines,
    sample(model: THREE.Object3D, body: THREE.Box3) {
      const parent = model.parent!;
      model.updateWorldMatrix(true, true);
      const ray = new THREE.Raycaster();
      const origin = new THREE.Vector3();
      const down = new THREE.Vector3(0,-1,0);
      const surfaces: THREE.Mesh[] = [];
      model.traverseVisible(node => { if (node instanceof THREE.Mesh) surfaces.push(node); });
      drops.length = 0;
      for (let i=0; i<ambientCount+bodyCount; i++) {
        const nearCar = i >= ambientCount;
        const x = nearCar ? THREE.MathUtils.lerp(body.min.x,body.max.x,.12+.76*Math.random()) : Math.random()*10-5;
        const z = nearCar ? THREE.MathUtils.lerp(body.min.z,body.max.z,.08+.84*Math.random()) : Math.random()*9-4.5;
        let surface = 0;
        if (x >= body.min.x && x <= body.max.x && z >= body.min.z && z <= body.max.z) {
          origin.set(x,body.max.y+1,z);
          ray.set(parent.localToWorld(origin),down);
          const hit = ray.intersectObjects(surfaces,false)[0];
          if (hit) surface = parent.worldToLocal(hit.point).y;
        }
        drops.push({x,z,surface,speed:5.6+Math.random()*1.8,offset:Math.random()*3,splash:surface>.1});
      }
    },
    update(dt:number) {
      clock += dt;
      let vertex = 0;
      for (const drop of drops) {
        const {x,z,surface,speed,offset,splash} = drop;
        const height = Math.max(2,5-surface), fallTime = height/speed;
        const time = (clock+offset) % (fallTime + (splash ? .18 : 0));
        if (time < fallTime) {
          const h = height-speed*time;
          positions.setXYZ(vertex++,x+h*.045,surface+h,z);
          positions.setXYZ(vertex++,x+(h+.18)*.045,surface+h+.18,z);
        } else {
          const t = (time-fallTime)/.18;
          for(let j=0; j<fragments; j++) {
            const a = j*Math.PI/2 + offset*4;
            const dx = Math.cos(a)*.16*t, dz = Math.sin(a)*.16*t;
            const y = surface+.012+.38*t*(1-t);
            positions.setXYZ(vertex++,x+dx*.75,y,z+dz*.75);
            positions.setXYZ(vertex++,x+dx,y+.022*(1-t),z+dz);
          }
        }
      }
      geometry.setDrawRange(0,vertex);
      positions.needsUpdate=true;
    },
  };
}
