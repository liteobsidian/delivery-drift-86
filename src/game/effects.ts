import * as THREE from "three";

interface Particle {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  vx: number;
  vy: number;
  vz: number;
  grow: number;
}

const SMOKE = 70;
const FLASH = 10;

/** Pooled billboard particles: tire smoke, splashes, hit flashes. Zero allocation in the loop. */
export class Effects {
  readonly group = new THREE.Group();
  private smoke: Particle[] = [];
  private smokeTex: THREE.Texture;
  private flash: Particle[] = [];
  private si = 0;
  private fi = 0;

  constructor() {
    this.smokeTex = makeSmokeTexture();
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < SMOKE; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.smokeTex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.NormalBlending,
        color: 0xcccccc,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.smoke.push({ mesh, life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0, grow: 1 });
    }
    const fgeo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < FLASH; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffcc66,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(fgeo, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.flash.push({ mesh, life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0, grow: 1 });
    }
  }

  spawnSmoke(x: number, z: number, strong: boolean): void {
    const p = this.smoke[this.si];
    this.si = (this.si + 1) % SMOKE;
    p.mesh.visible = true;
    p.mesh.position.set(x, 0.4, z);
    const s = strong ? 1.4 : 0.9;
    p.mesh.scale.set(s, s, 1);
    p.life = p.maxLife = strong ? 0.9 : 0.65;
    p.vx = (Math.random() - 0.5) * 2;
    p.vz = (Math.random() - 0.5) * 2;
    p.vy = 1.2 + Math.random();
    p.grow = strong ? 3.2 : 2.2;
  }

  spawnSplash(x: number, z: number): void {
    for (let k = 0; k < 5; k++) {
      const p = this.smoke[this.si];
      this.si = (this.si + 1) % SMOKE;
      p.mesh.visible = true;
      p.mesh.position.set(x, 0.25, z);
      p.mesh.scale.set(0.7, 0.7, 1);
      const mat = p.mesh.material as THREE.MeshBasicMaterial;
      mat.color.setHex(0x77aadd);
      p.life = p.maxLife = 0.5;
      p.vx = (Math.random() - 0.5) * 6;
      p.vz = (Math.random() - 0.5) * 6;
      p.vy = 2.5 + Math.random() * 2;
      p.grow = 1.4;
    }
  }

  spawnFlash(x: number, z: number, color = 0xffcc66): void {
    const p = this.flash[this.fi];
    this.fi = (this.fi + 1) % FLASH;
    p.mesh.visible = true;
    p.mesh.position.set(x, 0.9, z);
    p.mesh.scale.set(2.5, 2.5, 1);
    const mat = p.mesh.material as THREE.MeshBasicMaterial;
    mat.color.setHex(color);
    p.life = p.maxLife = 0.28;
    p.grow = 6;
  }

  update(dt: number, camQuat: THREE.Quaternion): void {
    for (const p of this.smoke) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.mesh.visible = false;
        continue;
      }
      const t = 1 - p.life / p.maxLife;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.z += p.vz * dt;
      p.mesh.position.y += p.vy * dt * (1 - t);
      const s = p.mesh.scale.x + p.grow * dt;
      p.mesh.scale.set(s, s, 1);
      const mat = p.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = (1 - t) * 0.5;
      p.mesh.quaternion.copy(camQuat);
    }
    for (const p of this.flash) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.mesh.visible = false;
        continue;
      }
      const t = 1 - p.life / p.maxLife;
      const s = p.mesh.scale.x + p.grow * dt;
      p.mesh.scale.set(s, s, 1);
      const mat = p.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = (1 - t) * 0.8;
      p.mesh.quaternion.copy(camQuat);
    }
  }

  dispose(): void {
    this.smokeTex.dispose();
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | undefined;
      mat?.dispose();
    });
  }
}

function makeSmokeTexture(): THREE.Texture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const g = cv.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 30);
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv);
  return tex;
}
