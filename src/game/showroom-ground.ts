import * as THREE from "three";

// Bake the contact pattern in car space once. Wheel positions follow the actual GLB.
export function showroomGround() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const texture = new THREE.CanvasTexture(canvas);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: texture, transparent: true, depthWrite: false, fog: false,
  }));
  mesh.rotation.x = -Math.PI / 2;
  const group = new THREE.Group();
  group.add(mesh);
  // Flush steel inspection rails give the workshop a perspective reference at wheel height.
  const rails = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x494442, roughness: .76, metalness: .25 });
  const marking = new THREE.MeshBasicMaterial({ color: 0xaa8959 });
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(.48, .028, 5.8), steel);
    rail.position.set(side * .79, -.016, 0);
    rails.add(rail);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(.025,.006,5.8), marking);
    lip.position.set(side * 1.02, -.003, 0);
    rails.add(lip);
  }
  group.add(rails);
  mesh.position.y = .002;
  function ellipse(x: number, y: number, w: number, h: number, strength: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(w, h);
    const shade = ctx.createRadialGradient(0, 0, .28, 0, 0, 1);
    shade.addColorStop(0, 'rgba(0,0,0,' + strength + ')');
    shade.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = shade;
    ctx.fillRect(-1,-1,2,2);
    ctx.restore();
  }
  return { group, rails, texture, fit(box: THREE.Box3, wheels: THREE.Vector3[]) {
    const size = box.getSize(new THREE.Vector3());
    const width = size.x * 1.55, length = size.z * 1.35;
    mesh.scale.set(width, length, 1);
    const track = wheels.length ? wheels.reduce((sum, p) => sum + Math.abs(p.x), 0) / wheels.length : size.x * .4;
    rails.scale.set(track / .79, 1, size.z * 1.27 / 5.8);
    ctx.clearRect(0,0,256,256);
    ellipse(130,130,123,122,.87);
    ellipse(128,128,93,98,.94);
    for (const wheel of wheels) {
      ellipse(128 + wheel.x / width * 256, 128 + wheel.z / length * 256, 17, 13, 1);
    }
    texture.needsUpdate = true;
  }};
}
