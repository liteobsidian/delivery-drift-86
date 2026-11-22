import * as THREE from "three";

// The roof contacts are sampled once per model. All drops and splashes share one draw call.
export function showroomRain() {
  const drops = 110, contacts = 12, rays = 4;
  const vertices = new Float32Array((drops + contacts * rays) * 6);
  const positions = new THREE.BufferAttribute(vertices, 3).setUsage(THREE.DynamicDrawUsage);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", positions);
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
    color: 0xc3e5e8, transparent: true, opacity: .55, depthWrite: false,
  }));
  lines.frustumCulled = false;
  const seeds = Array.from({ length: drops }, () => [Math.random()*10-5, Math.random()*5, Math.random()*9-4.5]);
  const hits: THREE.Vector3[] = [];
  let clock = 0;
  return {
    lines,
    sample(model: THREE.Object3D) {
      model.updateWorldMatrix(true,true);
      const box = new THREE.Box3().setFromObject(model);
      const ray = new THREE.Raycaster();
      hits.length = 0;
      for (let i=0; i<contacts; i++) {
        const x = THREE.MathUtils.lerp(box.min.x,box.max.x,.28+.44*Math.random());
        const z = THREE.MathUtils.lerp(box.min.z,box.max.z,.18+.64*Math.random());
        ray.set(new THREE.Vector3(x,box.max.y+1,z),new THREE.Vector3(0,-1,0));
        const hit=ray.intersectObject(model,true)[0];
        if(hit) hits.push(model.parent!.worldToLocal(hit.point));
      }
      geometry.setDrawRange(0,(drops+hits.length*rays)*2);
    },
    update(dt:number) {
      clock+=dt;
      seeds.forEach(([x,y,z],i)=>{
        const h=5-(y+clock*5)%5;
        positions.setXYZ(i*2,x+h*.07,h,z);
        positions.setXYZ(i*2+1,x+h*.07+.012,h+.17,z);
      });
      hits.forEach((p,i)=>{
        const t=(clock*2+i*.618)%1;
        for(let j=0;j<rays;j++){
          const a=j*Math.PI/2+i, index=(drops+i*rays+j)*2;
          const dx=Math.cos(a)*t*.11,dz=Math.sin(a)*t*.11,h=.24*t*(1-t);
          positions.setXYZ(index,p.x+dx*.8,p.y+h,p.z+dz*.8);
          positions.setXYZ(index+1,p.x+dx,p.y+h+.014,p.z+dz);
        }
      });
      positions.needsUpdate=true;
    },
  };
}
