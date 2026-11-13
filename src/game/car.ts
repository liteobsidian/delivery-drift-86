import * as THREE from "three";
import type { CarSpec } from "./types";
import type { InputState } from "./input";
import type { World } from "./world";

export interface CarStepResult {
  speed: number;
  drift: number; // lateral slip magnitude
  latG: number; // lateral acceleration (rollover stress source)
  onCobble: boolean;
  inPuddle: boolean;
  offRoad: boolean;
  impact: number; // building collision impact speed this step
  rolled: boolean; // rollover finished this step
  airborne: boolean;
  landing: number; // vertical impact speed at touchdown (0 = none)
}

const tmpF = new THREE.Vector3();
const tmpLat = new THREE.Vector3();

export interface CarParts {
  bodyMesh: THREE.Mesh;
  glassMats: THREE.MeshStandardMaterial[];
  bumpers: THREE.Mesh[];
  allWheelMeshes: THREE.Object3D[];
}

export class Car {
  group = new THREE.Group();
  pos = new THREE.Vector3(0, 0, 40);
  vel = new THREE.Vector3();
  heading = Math.PI; // facing -z so W drives into -z (verify contract)
  spec: CarSpec;
  cargo = 100; // 0..100
  hp = 100; // car body condition 0..100 (persistent until repaired)
  wheelLost = false;
  gripPenalty = false;
  airY = 0;
  airV = 0;
  onWheelLost: ((x: number, z: number) => void) | null = null;
  private airTime = 0;
  private parts: CarParts | null = null;
  private flipT = -1; // >=0 while rolling over
  private flipDir = 1;
  private body: THREE.Group;
  private wheels: THREE.Mesh[] = [];
  private wheelPivots: THREE.Group[] = [];
  private wheelSpin = 0;
  private smokeTimer = 0;
  private animT = 0;
  onSmoke: ((x: number, z: number, strong: boolean) => void) | null = null;
  private curbBump = 0;

  constructor(spec: CarSpec) {
    this.spec = spec;
    this.body = buildCarMesh(spec, this.wheels, this.wheelPivots, (p) => {
      this.parts = p;
    });
    this.group.add(this.body);
    this.syncMesh(0);
  }

  setSpec(spec: CarSpec): void {
    this.spec = spec;
    this.rebuildMesh();
  }

  /** Full visual reset — used after repairs too. */
  private rebuildMesh(): void {
    this.group.remove(this.body);
    disposeDeep(this.body);
    this.wheels = [];
    this.wheelPivots = [];
    this.body = buildCarMesh(this.spec, this.wheels, this.wheelPivots, (p) => {
      this.parts = p;
    });
    this.group.add(this.body);
  }

  repair(): number {
    this.hp = 100;
    this.wheelLost = false;
    this.gripPenalty = false;
    this.rebuildMesh();
    return 0;
  }

  /** Damage the car body; updates visual damage stages. */
  damageCar(amount: number): void {
    if (this.hp <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
    const stage = 1 - this.hp / 100;
    const p = this.parts;
    if (!p) return;
    // crumpled bumpers + compressed nose
    for (const b of p.bumpers) b.scale.z = 1 - 0.5 * stage;
    p.bodyMesh.scale.z = 1 - 0.07 * stage;
    p.bodyMesh.rotation.x = 0.05 * stage;
    // cracked / milky glass
    for (const m of p.glassMats) {
      if (stage > 0.35) {
        m.color.setHex(0x9db4c4);
        m.roughness = 0.55;
        m.transparent = true;
        m.opacity = 0.92;
      }
      if (stage > 0.6) {
        m.color.setHex(0xc4d2dc);
        m.opacity = 0.85;
      }
    }
  }

  /** Rear wheel rips off; car keeps driving with a penalty. */
  loseWheel(): void {
    if (this.wheelLost || !this.parts) return;
    this.wheelLost = true;
    this.gripPenalty = true;
    // wheels order: [FL, FR, RL, RR] — drop the rear-left
    const wheel = this.parts.allWheelMeshes[2];
    if (wheel) {
      wheel.removeFromParent();
      const wp = new THREE.Vector3();
      wheel.getWorldPosition(wp);
      this.onWheelLost?.(wp.x, wp.z);
    }
  }

  get speed(): number {
    return this.vel.dot(this.forward(tmpF));
  }

  get forwardVec(): THREE.Vector3 {
    return this.forward(new THREE.Vector3());
  }

  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  get isFlipping(): boolean {
    return this.flipT >= 0;
  }

  step(dt: number, input: InputState, world: World): CarStepResult {
    const res: CarStepResult = {
      speed: 0,
      drift: 0,
      latG: 0,
      onCobble: false,
      inPuddle: false,
      offRoad: false,
      impact: 0,
      rolled: false,
      airborne: false,
      landing: 0,
    };
    if (this.flipT >= 0) {
      // mid-roll: no control, slide to a stop
      this.flipT += dt;
      const p = Math.min(1, this.flipT / 0.9);
      this.body.rotation.z =
        this.flipDir * p * Math.PI * 2 * (this.spec.massFeel > 1.1 ? 1 : 1);
      this.body.position.y = Math.sin(p * Math.PI) * 0.8;
      this.vel.multiplyScalar(1 - 2.2 * dt);
      this.pos.addScaledVector(this.vel, dt);
      world.collideBuildings(this.pos, 1.5, this.vel);
      if (p >= 1) {
        this.flipT = -1;
        this.body.rotation.z = 0;
        this.body.position.y = 0;
        this.vel.multiplyScalar(0.2);
        res.rolled = true;
      }
      this.syncMesh(dt);
      return res;
    }

    const fwd = this.forward(tmpF);
    let speed = this.vel.dot(fwd);

    // --- steering (less at high speed, inverted in reverse) ---
    const speedFactor = THREE.MathUtils.clamp(speed / 8, -1, 1);
    const highSpeedDamp = 1 / (1 + Math.abs(speed) * 0.028);
    const steerInput = -input.steer; // D (right) => heading decreases => +x travel
    this.heading += steerInput * this.spec.steerRate * speedFactor * highSpeedDamp * dt;

    // --- engine / brake ---
    const topSpeed = this.spec.topSpeed * (this.gripPenalty ? 0.85 : 1);
    if (input.throttle > 0 && speed < topSpeed) {
      const fade = Math.max(0.22, 1 - speed / topSpeed);
      this.vel.addScaledVector(fwd, this.spec.accel * fade * input.throttle * dt);
    }
    if (input.brake > 0) {
      if (speed > 0.8) {
        this.vel.addScaledVector(fwd, -this.spec.brake * input.brake * dt);
      } else if (speed > -this.spec.topSpeed * 0.32) {
        this.vel.addScaledVector(fwd, -this.spec.accel * 0.55 * input.brake * dt);
      }
    }

    // --- drag ---
    const drag = 0.28 + Math.abs(speed) * 0.006;
    this.vel.multiplyScalar(Math.max(0, 1 - drag * dt));

    // --- ramps: launch when crossing one fast enough ---
    if (this.airY === 0 && this.airV === 0) {
      const ramp = world.rampAt(this.pos.x, this.pos.z);
      if (ramp && Math.abs(speed) > 13) {
        this.airV = Math.abs(speed) * 0.42 + 4;
      }
    }

    // --- airborne integration ---
    if (this.airY > 0 || this.airV !== 0) {
      res.airborne = true;
      this.airV -= 30 * dt;
      this.airY += this.airV * dt;
      if (this.airY <= 0 && this.airV < 0) {
        res.landing = -this.airV;
        this.airY = 0;
        this.airV = 0;
        this.vel.multiplyScalar(0.94);
      }
    }

    // --- surface (ignored while airborne) ---
    const onRoad = world.isOnRoad(this.pos.x, this.pos.z);
    res.offRoad = !onRoad && !res.airborne;
    res.onCobble = !res.airborne && world.isCobble(this.pos.x, this.pos.z);
    const puddle = res.airborne ? null : world.puddleAt(this.pos.x, this.pos.z);
    res.inPuddle = puddle !== null;
    let surfaceGrip = 1;
    if (res.inPuddle) surfaceGrip = 0.55;
    else if (res.onCobble) surfaceGrip = 0.85;
    else if (!onRoad) surfaceGrip = 0.6;

    // --- lateral grip (drift model) ---
    const fwd2 = this.forward(tmpF);
    speed = this.vel.dot(fwd2);
    tmpLat.copy(this.vel).addScaledVector(fwd2, -speed);
    const latMag = tmpLat.length();
    const gripRate =
      this.spec.grip *
      surfaceGrip *
      (this.gripPenalty ? 0.72 : 1) *
      (input.handbrake ? 0.16 : 1);
    const kill = Math.min(1, gripRate * dt);
    this.vel.addScaledVector(tmpLat, -kill);
    res.drift = latMag;
    res.speed = speed;

    // lateral acceleration felt by the cargo (for rollover + body roll)
    const latAccel = latMag * gripRate; // ~force pulling the car sideways
    res.latG = latAccel;

    // --- collisions ---
    res.impact = world.collideBuildings(this.pos, 1.5, this.vel);

    // --- rollover: only from a hard impact, and only at speed ---
    if (
      this.flipT < 0 &&
      res.impact > 20 &&
      Math.abs(speed) > 12
    ) {
      this.startRoll(steerInput !== 0 ? Math.sign(steerInput) : Math.random() < 0.5 ? 1 : -1);
    }

    // --- integrate ---
    this.pos.addScaledVector(this.vel, dt);

    // --- smoke when drifting ---
    this.smokeTimer -= dt;
    if (latMag > 6 && this.smokeTimer <= 0) {
      this.smokeTimer = 0.05;
      const back = fwd2.clone().multiplyScalar(-1.8);
      this.onSmoke?.(
        this.pos.x + back.x + (Math.random() - 0.5),
        this.pos.z + back.z + (Math.random() - 0.5),
        latMag > 12
      );
    }

    this.syncMesh(dt, latMag, steerInput, onRoad);
    return res;
  }

  startRoll(dir: number): void {
    if (this.flipT >= 0) return;
    this.flipT = 0;
    this.flipDir = dir;
  }

  private syncMesh(
    dt: number,
    latMag = 0,
    steerInput = 0,
    onRoad = true
  ): void {
    this.animT += dt;
    this.group.position.copy(this.pos);
    this.group.position.y = this.airY;
    // model nose is local -z; heading's forward is (sinθ, cosθ), so offset by π
    this.group.rotation.y = this.heading + Math.PI;

    // body roll visual
    const targetRoll = THREE.MathUtils.clamp(-latMag * 0.02 * Math.sign(steerInput || 1), -0.3, 0.3);
    this.body.rotation.z += (targetRoll - this.body.rotation.z) * Math.min(1, dt * 8);
    this.body.rotation.x += ((-latMag * 0.012) - this.body.rotation.x) * Math.min(1, dt * 6);

    // curb bump
    const targetY = onRoad ? 0 : 0.14;
    this.curbBump += (targetY - this.curbBump) * Math.min(1, dt * 10);
    if (!onRoad && this.flipT < 0) {
      this.body.position.y = this.curbBump + Math.random() * 0.03;
    } else if (this.flipT < 0) {
      this.body.position.y = this.curbBump;
    }

    // wheels
    this.wheelSpin += this.speed * dt * 1.6;
    for (let i = 0; i < this.wheels.length; i++) {
      this.wheels[i].rotation.x = this.wheelSpin;
    }
    for (let i = 0; i < this.wheelPivots.length; i++) {
      this.wheelPivots[i].rotation.y = steerInput * 0.45;
    }

    // damaged-car wobble (missing wheel / beat-up suspension)
    if (this.gripPenalty) {
      this.body.rotation.z += Math.sin(this.animT * 23) * 0.018;
      this.body.position.x = Math.sin(this.animT * 31) * 0.03;
    }
  }

  damage(amount: number): void {
    this.cargo = Math.max(0, this.cargo - amount);
  }

  dispose(): void {
    disposeDeep(this.group);
  }
}

function disposeDeep(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
  });
}

/** Parametric low-poly car; extruded side profile + details. */
function buildCarMesh(
  spec: CarSpec,
  wheels: THREE.Mesh[],
  pivots: THREE.Group[],
  onParts?: (p: CarParts) => void
): THREE.Group {
  const root = new THREE.Group();
  const glassMats: THREE.MeshStandardMaterial[] = [];
  const bumpers: THREE.Mesh[] = [];
  const allWheelMeshes: THREE.Object3D[] = [];
  const bodyMat = new THREE.MeshStandardMaterial({
    color: spec.color,
    roughness: 0.35,
    metalness: 0.55,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: spec.accent,
    roughness: 0.6,
    metalness: 0.3,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x0e1a26,
    roughness: 0.1,
    metalness: 0.9,
  });
  glassMats.push(glassMat);

  const isSupra = spec.id === "supra";

  // side profile (x = forward length, y = height), extruded across width
  const L = isSupra ? 4.5 : 4.15; // length
  const s = new THREE.Shape();
  if (isSupra) {
    s.moveTo(-L / 2, 0.28);
    s.lineTo(-L / 2 + 0.5, 0.42); // nose
    s.lineTo(-L / 2 + 1.6, 0.62); // hood slope
    s.lineTo(-0.3, 0.78); // windshield
    s.lineTo(0.9, 0.8); // roof
    s.lineTo(1.5, 0.6); // rear glass
    s.lineTo(L / 2 - 0.4, 0.52);
    s.lineTo(L / 2, 0.4);
    s.lineTo(L / 2, 0.28);
  } else {
    // boxy AE86 hatchback
    s.moveTo(-L / 2, 0.28);
    s.lineTo(-L / 2 + 0.3, 0.55); // flat nose
    s.lineTo(-L / 2 + 0.9, 0.58); // hood
    s.lineTo(-L / 2 + 1.15, 0.95); // windshield
    s.lineTo(0.75, 0.98); // roof
    s.lineTo(1.15, 0.6); // hatch slope
    s.lineTo(L / 2, 0.58);
    s.lineTo(L / 2, 0.28);
  }
  s.lineTo(-L / 2, 0.28);

  const W = isSupra ? 1.85 : 1.72;
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: W - 0.3,
    bevelEnabled: true,
    bevelThickness: 0.14,
    bevelSize: 0.12,
    bevelSegments: 1,
  });
  geo.rotateY(-Math.PI / 2); // profile nose (x=-L/2) must land on -z, where the headlights are
  geo.translate(-(W - 0.3) / 2 + 0.0, 0, 0);
  // after rotateY(PI/2): extrusion depth ran along +x; center it
  geo.computeBoundingBox();
  if (geo.boundingBox) {
    const cx = (geo.boundingBox.min.x + geo.boundingBox.max.x) / 2;
    geo.translate(-cx, 0, 0);
  }
  const bodyMesh = new THREE.Mesh(geo, bodyMat);
  bodyMesh.castShadow = true;
  root.add(bodyMesh);

  // glass cabin (slightly inset box over profile cabin area)
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(W - 0.45, 0.42, isSupra ? 1.7 : 1.55),
    glassMat
    );
  cabin.position.set(0, isSupra ? 0.72 : 0.82, isSupra ? 0.25 : 0.15);
  root.add(cabin);

  // bumpers / skirt
  const skirt = new THREE.Mesh(
    new THREE.BoxGeometry(W + 0.06, 0.22, L * 0.96),
    darkMat
  );
  skirt.position.y = 0.32;
  root.add(skirt);

  // headlights
  const hlMat = new THREE.MeshStandardMaterial({
    color: 0xfff8dd,
    emissive: 0xffedb0,
    emissiveIntensity: 2.6,
  });
  if (isSupra) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(W - 0.5, 0.14, 0.1), hlMat);
    hl.position.set(0, 0.48, -L / 2 - 0.02);
    root.add(hl);
  }
  // AE86 pop-up headlights
  if (!isSupra) {
    for (const sx of [-1, 1]) {
      const pop = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.15, 0.3), hlMat);
      pop.position.set(sx * 0.56, 0.62, -L / 2 + 0.28);
      root.add(pop);
    }
  }
  // taillights — thin strip
  const tlMat = new THREE.MeshStandardMaterial({
    color: 0xff2222,
    emissive: 0xff1a1a,
    emissiveIntensity: 1.8,
  });
  const tl = new THREE.Mesh(new THREE.BoxGeometry(W - 0.7, 0.09, 0.07), tlMat);
  tl.position.set(0, 0.54, L / 2 + 0.02);
  root.add(tl);
  // panda-style black bumpers (AE86 signature look)
  if (!isSupra) {
    const bf = new THREE.Mesh(new THREE.BoxGeometry(W + 0.04, 0.2, 0.34), darkMat);
    bf.position.set(0, 0.36, -L / 2 + 0.06);
    root.add(bf);
    bumpers.push(bf);
    const br = new THREE.Mesh(new THREE.BoxGeometry(W + 0.04, 0.2, 0.3), darkMat);
    br.position.set(0, 0.36, L / 2 - 0.04);
    root.add(br);
    bumpers.push(br);
  } else {
    const bf = new THREE.Mesh(new THREE.BoxGeometry(W + 0.04, 0.18, 0.3), darkMat);
    bf.position.set(0, 0.35, -L / 2 + 0.1);
    root.add(bf);
    bumpers.push(bf);
    const br = new THREE.Mesh(new THREE.BoxGeometry(W + 0.04, 0.18, 0.3), darkMat);
    br.position.set(0, 0.35, L / 2 - 0.1);
    root.add(br);
    bumpers.push(br);
  }

  // spoiler
  const wing = new THREE.Mesh(
    new THREE.BoxGeometry(W - 0.25, 0.07, isSupra ? 0.5 : 0.34),
    darkMat
  );
  wing.position.set(0, isSupra ? 0.95 : 0.92, L / 2 - 0.25);
  root.add(wing);
  for (const sx of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.32, 0.08), darkMat);
    strut.position.set(sx * (W / 2 - 0.32), isSupra ? 0.76 : 0.74, L / 2 - 0.25);
    root.add(strut);
  }

  // underglow
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(W + 0.7, L + 0.5),
    new THREE.MeshBasicMaterial({
      color: isSupra ? 0xff8c2a : 0x37e0ff,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.06;
  root.add(glow);

  // wheels: pivots for steering (front), spin meshes inside
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({
    color: 0x0c0d10,
    roughness: 0.9,
  });
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xb8c0cc,
    roughness: 0.3,
    metalness: 0.8,
  });
  const wz = isSupra ? 1.42 : 1.32;
  const wx = W / 2 + 0.08;
  const positions: [number, number, boolean][] = [
    [-wx, -wz, true],
    [wx, -wz, true],
    [-wx, wz, false],
    [wx, wz, false],
  ];
  for (const [x, z, front] of positions) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.34, z);
    const tire = new THREE.Mesh(wheelGeo, wheelMat);
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 0.28, 10),
      rimMat
    );
    rim.rotation.z = Math.PI / 2;
    const spinGroup = new THREE.Group();
    spinGroup.add(tire);
    spinGroup.add(rim);
    pivot.add(spinGroup);
    root.add(pivot);
    wheels.push(spinGroup as unknown as THREE.Mesh);
    allWheelMeshes.push(spinGroup);
    if (front) pivots.push(pivot);
  }

  onParts?.({ bodyMesh, glassMats, bumpers, allWheelMeshes });
  return root;
}
