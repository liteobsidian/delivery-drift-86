import * as THREE from "three";

/**
 * Police pursuit — a single cruiser that spawns behind the player,
 * chases with capped turn rate, and can be escaped by distance.
 */
export class Police {
  readonly group = new THREE.Group();
  active = false;
  pos = new THREE.Vector3();
  heading = 0;
  speed = 0;
  private redMat: THREE.MeshStandardMaterial;
  private blueMat: THREE.MeshStandardMaterial;
  private flash = 0;
  /** distance to player, updated each frame while active */
  dist = 999;

  constructor() {
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x11141c,
      roughness: 0.4,
      metalness: 0.5,
    });
    const whiteMat = new THREE.MeshStandardMaterial({
      color: 0xdde3ee,
      roughness: 0.4,
      metalness: 0.4,
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.62, 4.4), bodyMat);
    body.position.y = 0.56;
    this.group.add(body);
    const doors = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.4, 1.6), whiteMat);
    doors.position.y = 0.62;
    this.group.add(doors);
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.7, 0.5, 2.1),
      new THREE.MeshStandardMaterial({ color: 0x0c1420, roughness: 0.2, metalness: 0.7 })
    );
    cabin.position.set(0, 1.06, 0.2);
    this.group.add(cabin);
    // light bar
    this.redMat = new THREE.MeshStandardMaterial({
      color: 0x330000,
      emissive: 0xff2222,
      emissiveIntensity: 3,
    });
    this.blueMat = new THREE.MeshStandardMaterial({
      color: 0x000033,
      emissive: 0x2244ff,
      emissiveIntensity: 0.4,
    });
    const barR = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.4), this.redMat);
    barR.position.set(-0.35, 1.4, 0.2);
    this.group.add(barR);
    const barB = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.4), this.blueMat);
    barB.position.set(0.35, 1.4, 0.2);
    this.group.add(barB);
    // headlights + push bar
    const hl = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.14, 0.08),
      new THREE.MeshStandardMaterial({
        color: 0xfff8dd,
        emissive: 0xffedb0,
        emissiveIntensity: 2.4,
      })
    );
    hl.position.set(0, 0.5, -2.22);
    this.group.add(hl);
    const push = new THREE.Mesh(
      new THREE.BoxGeometry(1.7, 0.4, 0.16),
      new THREE.MeshStandardMaterial({ color: 0x08090c })
    );
    push.position.set(0, 0.45, -2.28);
    this.group.add(push);
    const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0c });
    for (const [x, z] of [
      [-0.95, -1.45],
      [0.95, -1.45],
      [-0.95, 1.45],
      [0.95, 1.45],
    ]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.position.set(x, 0.34, z);
      this.group.add(w);
    }
    this.group.visible = false;
  }

  /** swap placeholder cruiser for a loaded police model (nose -z); light bar is rebuilt on the roof */
  setModel(model: THREE.Group, roofY: number): void {
    for (const child of [...this.group.children]) this.group.remove(child);
    this.group.add(model.clone(true));
    const barR = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.14, 0.42), this.redMat);
    barR.position.set(-0.33, roofY, 0.15);
    const barB = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.14, 0.42), this.blueMat);
    barB.position.set(0.33, roofY, 0.15);
    this.group.add(barR, barB);
  }

  start(px: number, pz: number): void {
    this.pos.set(px + 10, 0, pz + 18);
    this.heading = Math.atan2(px - this.pos.x, pz - this.pos.z);
    this.speed = 16;
    this.active = true;
    this.group.visible = true;
  }

  stop(): void {
    this.active = false;
    this.group.visible = false;
  }

  /** returns true when the cruiser is close enough to bust the player */
  update(dt: number, px: number, pz: number): boolean {
    if (!this.active) return false;
    this.flash += dt;
    const phase = Math.floor(this.flash * 6) % 2;
    this.redMat.emissiveIntensity = phase === 0 ? 3 : 0.4;
    this.blueMat.emissiveIntensity = phase === 0 ? 0.4 : 3;

    const dx = px - this.pos.x;
    const dz = pz - this.pos.z;
    this.dist = Math.hypot(dx, dz);
    const desired = Math.atan2(dx, dz);
    let diff = desired - this.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const turn = THREE.MathUtils.clamp(diff, -1.9 * dt, 1.9 * dt);
    this.heading += turn;
    // faster when far, cautious in turns
    const target = THREE.MathUtils.clamp(this.dist * 0.45, 13, 42) * (Math.abs(diff) > 0.9 ? 0.45 : 1);
    this.speed += (target - this.speed) * Math.min(1, dt * 1.6);
    this.pos.x += Math.sin(this.heading) * this.speed * dt;
    this.pos.z += Math.cos(this.heading) * this.speed * dt;

    this.group.position.copy(this.pos);
    this.group.rotation.y = this.heading + Math.PI;
    return this.dist < 3.4;
  }

  dispose(): void {
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | undefined;
      mat?.dispose();
    });
  }
}
