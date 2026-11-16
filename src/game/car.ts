import * as THREE from "three";
import type { CarSpec } from "./types";
import type { InputState } from "./input";
import type { World } from "./world";
import type { LoadedModel } from "./assets";

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
  spoiler: THREE.Group;
}

export class Car {
  group = new THREE.Group();
  pos = new THREE.Vector3(0, 0, 40);
  vel = new THREE.Vector3();
  heading = Math.PI; // facing -z so W drives into -z (verify contract)
  spec: CarSpec;
  cargo = 100; // 0..100
  hp = 100; // car body condition 0..100 (persistent until repaired)
  gripPenalty = false;
  airY = 0;
  airV = 0;
  wrecked = false; // hp reached 0: no control, coasting wreck
  wheelLost = false;
  spoilerLost = false;
  bumperLost = false;
  onWheelLost: ((x: number, z: number) => void) | null = null;
  onPartLost: ((x: number, z: number, kind: "spoiler" | "bumper") => void) | null =
    null;
  private airTime = 0;
  private parts: CarParts | null = null;
  private flipT = -1; // >=0 while rolling over
  private flipDir = 1;
  private body: THREE.Group;
  private wheels: THREE.Mesh[] = [];
  private wheelPivots: THREE.Group[] = [];
  private heroModel: LoadedModel | null = null;
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

  /** Attach/detach a detailed library body (used when assets finish loading). */
  setHeroModel(model: LoadedModel | null): void {
    this.heroModel = model;
    this.rebuildMesh();
  }

  /** Full visual reset — used after repairs too. */
  private rebuildMesh(): void {
    this.group.remove(this.body);
    // hero (GLB) clones share geometry with the cached template — never dispose it
    disposeDeep(this.body, !!this.heroModel);
    this.wheels = [];
    this.wheelPivots = [];
    this.body = this.heroModel
      ? buildHeroMesh(this.spec, this.heroModel, this.wheels, this.wheelPivots, (p) => {
          this.parts = p;
        })
      : buildCarMesh(this.spec, this.wheels, this.wheelPivots, (p) => {
          this.parts = p;
        });
    applyUpgradeLooks(this.body, this.upgrades);
    this.group.add(this.body);
  }

  /** current visual upgrade levels (livery/spoiler/underglow/wheels) */
  private upgrades: UpgradeLevels = { engine: 0, tires: 0, suspension: 0, turbo: 0 };

  setUpgrades(up: UpgradeLevels): void {
    this.upgrades = up;
    applyUpgradeLooks(this.body, up);
  }

  repair(): number {
    this.hp = 100;
    this.wheelLost = false;
    this.spoilerLost = false;
    this.bumperLost = false;
    this.wrecked = false;
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
    // parts tear off as damage grows
    if (stage > 0.45) this.loseSpoiler();
    if (stage > 0.7) this.loseFrontBumper();
  }

  /** Spoiler rips off the trunk. */
  loseSpoiler(): void {
    if (this.spoilerLost || !this.parts || this.parts.spoiler.children.length === 0) return;
    this.spoilerLost = true;
    const s = this.parts.spoiler;
    s.removeFromParent();
    const wp = new THREE.Vector3();
    s.getWorldPosition(wp);
    this.onPartLost?.(wp.x, wp.z, "spoiler");
  }

  /** Front bumper tears off. */
  loseFrontBumper(): void {
    if (this.bumperLost || !this.parts) return;
    this.bumperLost = true;
    const b = this.parts.bumpers[0];
    if (b) {
      b.removeFromParent();
      const wp = new THREE.Vector3();
      b.getWorldPosition(wp);
      this.onPartLost?.(wp.x, wp.z, "bumper");
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

    if (this.wrecked) {
      // coasting wreck: no throttle, no steering, heavy scrub
      input = { steer: 0, throttle: 0, brake: 0, reverse: 0, handbrake: false, nitro: false };
    }

    const fwd = this.forward(tmpF);
    let speed = this.vel.dot(fwd);

    // --- steering (less at high speed, inverted in reverse) ---
    const speedFactor = THREE.MathUtils.clamp(speed / 8, -1, 1);
    const highSpeedDamp = 1 / (1 + Math.abs(speed) * 0.028);
    const steerInput = -input.steer; // D (right) => heading decreases => +x travel
    this.heading += steerInput * this.spec.steerRate * speedFactor * highSpeedDamp * dt;

    // --- engine / brake ---
    const boosting = input.nitro && input.throttle > 0 && speed >= -0.1;
    const topSpeed = this.spec.topSpeed * (this.gripPenalty ? 0.85 : 1) * (boosting ? 1.32 : 1);
    if (input.throttle > 0 && speed < topSpeed) {
      const fade = Math.max(0.22, 1 - speed / topSpeed);
      this.vel.addScaledVector(fwd, this.spec.accel * (boosting ? 1.28 : 1) * fade * input.throttle * dt);
    }
    // DO NOT BREAK REVERSE: never apply service-brake force while reverse is
    // engaged; the opposing forces cancel and make the car crawl backwards.
    if (input.reverse > 0) {
      if (speed > 0.8) {
        this.vel.addScaledVector(fwd, -this.spec.brake * input.reverse * dt);
      } else if (speed > -topSpeed * 0.5) {
        this.vel.addScaledVector(fwd, -this.spec.accel * 0.78 * input.reverse * dt);
      }
    } else if (input.brake > 0 && Math.abs(speed) > 0.08) {
      this.vel.addScaledVector(fwd, -Math.sign(speed) * this.spec.brake * input.brake * dt);
    }

    // --- drag ---
    const drag = 0.28 + Math.abs(speed) * 0.006;
    this.vel.multiplyScalar(Math.max(0, 1 - drag * dt));
    if (this.wrecked) {
      this.vel.multiplyScalar(Math.max(0, 1 - 1.3 * dt));
    }

    // --- ramps: launch only when driving UP the slope ---
    let rampImpact = 0;
    if (this.airY === 0 && this.airV === 0) {
      const ramp = world.rampAt(this.pos.x, this.pos.z);
      if (ramp) {
        const along = this.vel.x * ramp.dx + this.vel.z * ramp.dz;
        if (along > 1) {
          // any up-slope speed launches — otherwise the car just sinks
          // into the wedge while "climbing" it
          this.airV = along * 0.42 + 4;
        } else if (along < -8) {
          // slamming into the tall back wall of the wedge — that hurts
          rampImpact = -along;
          this.vel.multiplyScalar(0.1);
        }
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
    res.impact = Math.max(rampImpact, world.collideBuildings(this.pos, 1.5, this.vel));

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
    disposeDeep(this.group, !!this.heroModel);
  }
}

function disposeDeep(obj: THREE.Object3D, keepGeometry = false): void {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!keepGeometry && mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
  });
}

/** Parametric low-poly car; extruded side profile + details. */
export function buildCarMesh(
  spec: CarSpec,
  wheels: THREE.Mesh[] = [],
  pivots: THREE.Group[] = [],
  onParts?: (p: CarParts) => void
): THREE.Group {
  const root = new THREE.Group();
  const glassMats: THREE.MeshStandardMaterial[] = [];
  const bumpers: THREE.Mesh[] = [];
  const allWheelMeshes: THREE.Object3D[] = [];
  const bodyMat = new THREE.MeshStandardMaterial({
    color: spec.color,
    roughness: 0.42,
    metalness: 0.32,
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

  const body = spec.body ?? "hatch";
  const DIMS: Record<string, { L: number; W: number }> = {
    hatch: { L: 4.15, W: 1.72 },
    coupe: { L: 4.5, W: 1.85 },
    low: { L: 4.4, W: 1.88 },
    sedan: { L: 4.7, W: 1.86 },
  };
  const { L, W } = DIMS[body] ?? DIMS.hatch;

  // side profile (x = forward length, y = height), extruded across width
  const s = new THREE.Shape();
  if (body === "coupe") {
    s.moveTo(-L / 2, 0.28);
    s.lineTo(-L / 2 + 0.5, 0.42); // nose
    s.lineTo(-L / 2 + 1.6, 0.62); // hood slope
    s.lineTo(-0.3, 0.78); // windshield
    s.lineTo(0.9, 0.8); // roof
    s.lineTo(1.5, 0.6); // rear glass
    s.lineTo(L / 2 - 0.4, 0.52);
    s.lineTo(L / 2, 0.4);
    s.lineTo(L / 2, 0.28);
  } else if (body === "low") {
    // sleek low fastback (RX-7 / NSX flavor)
    s.moveTo(-L / 2, 0.26);
    s.lineTo(-L / 2 + 0.55, 0.36); // low nose
    s.lineTo(-L / 2 + 1.5, 0.5); // long hood
    s.lineTo(-0.1, 0.68); // raked windshield
    s.lineTo(0.9, 0.7); // low roof
    s.lineTo(1.9, 0.52); // fastback slope
    s.lineTo(L / 2 - 0.3, 0.46);
    s.lineTo(L / 2, 0.36);
    s.lineTo(L / 2, 0.26);
  } else if (body === "sedan") {
    // notchback with a real trunk (GT-R / Evo flavor)
    s.moveTo(-L / 2, 0.28);
    s.lineTo(-L / 2 + 0.45, 0.5);
    s.lineTo(-L / 2 + 1.3, 0.6); // hood
    s.lineTo(-L / 2 + 1.5, 0.92); // windshield
    s.lineTo(0.7, 0.95); // roof
    s.lineTo(1.25, 0.62); // rear glass
    s.lineTo(1.7, 0.6); // short deck
    s.lineTo(L / 2 - 0.25, 0.52); // trunk lid
    s.lineTo(L / 2, 0.42);
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
  const CABIN: Record<string, [number, number, number]> = {
    hatch: [0.82, 1.55, 0.15],
    coupe: [0.72, 1.7, 0.25],
    low: [0.66, 1.6, 0.28],
    sedan: [0.8, 1.75, 0.2],
  };
  const cab = CABIN[body] ?? CABIN.hatch;
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(W - 0.45, 0.42, cab[1]),
    glassMat
    );
  cabin.position.set(0, cab[0], cab[2]);
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
  if (body === "hatch") {
    // AE86 pop-up headlights
    for (const sx of [-1, 1]) {
      const pop = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.15, 0.3), hlMat);
      pop.position.set(sx * 0.56, 0.62, -L / 2 + 0.28);
      root.add(pop);
    }
  } else {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(W - 0.5, 0.14, 0.1), hlMat);
    hl.position.set(0, body === "low" ? 0.42 : 0.48, -L / 2 - 0.02);
    root.add(hl);
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
  // panda-style black bumpers (AE86 signature look); smoother on other bodies
  if (body === "hatch") {
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

  // spoiler (one group so the whole wing tears off)
  const spoiler = new THREE.Group();
  const spoilerKind = spec.spoiler ?? "wing";
  if (spoilerKind !== "none") {
    if (spoilerKind === "duck") {
      // low ducktail lip flush with the trunk
      const lip = new THREE.Mesh(new THREE.BoxGeometry(W - 0.3, 0.09, 0.3), darkMat);
      lip.position.set(0, 0.58, L / 2 - 0.12);
      spoiler.add(lip);
    } else {
      const big = spoilerKind === "big";
      const wing = new THREE.Mesh(
        new THREE.BoxGeometry(W - (big ? 0.1 : 0.25), big ? 0.09 : 0.07, big ? 0.6 : 0.34),
        darkMat
      );
      wing.position.set(0, big ? 1.02 : 0.95, L / 2 - (big ? 0.2 : 0.25));
      spoiler.add(wing);
      for (const sx of [-1, 1]) {
        const strut = new THREE.Mesh(new THREE.BoxGeometry(0.08, big ? 0.42 : 0.32, 0.08), darkMat);
        strut.position.set(sx * (W / 2 - 0.32), big ? 0.8 : 0.76, L / 2 - (big ? 0.2 : 0.25));
        spoiler.add(strut);
        if (big) {
          // endplates
          const plate = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.26, 0.55), darkMat);
          plate.position.set(sx * (W / 2 - 0.06), 1.0, L / 2 - 0.2);
          spoiler.add(plate);
        }
      }
    }
  } else {
    // bare lip so "spoiler lost" still has something to tear off
    const lip = new THREE.Mesh(new THREE.BoxGeometry(W - 0.4, 0.06, 0.16), darkMat);
    lip.position.set(0, 0.55, L / 2 - 0.06);
    spoiler.add(lip);
    // upgrade-grown GT wing (revealed by applyUpgradeLooks)
    spoiler.userData.procedural = true;
    const wing = new THREE.Mesh(new THREE.BoxGeometry(W - 0.2, 0.07, 0.4), darkMat);
    wing.position.set(0, 1.06, L / 2 - 0.2);
    spoiler.add(wing);
    for (const sx of [-1, 1]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.34, 0.08), darkMat);
      strut.position.set(sx * (W / 2 - 0.3), 0.88, L / 2 - 0.2);
      spoiler.add(strut);
    }
    spoiler.visible = false;
  }
  spoiler.name = "hero-spoiler";
  root.add(spoiler);

  // underglow in the car's own color
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(W + 0.7, L + 0.5),
    new THREE.MeshBasicMaterial({
      color: spec.color,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.06;
  glow.name = "hero-underglow";
  root.add(glow);

  // racing livery over the cabin (revealed by engine upgrades)
  root.add(makeLivery(W, cab[0] + 0.235, 3.2));

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
  const wz = body === "hatch" ? 1.32 : body === "sedan" ? 1.48 : 1.42;
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

  onParts?.({ bodyMesh, glassMats, bumpers, allWheelMeshes, spoiler });
  return root;
}

/**
 * Hero body from the design-asset library (detailed GLB-style model).
 * The cached template is cloned with per-instance materials; body paint is
 * recolored to the spec color. Wheel parents are detected by name pattern,
 * wrapped in steering pivots (front pair), and registered for spin/loss.
 * Geometry stays shared with the template — do NOT run disposeDeep on it
 * without keepGeometry.
 */
export function buildHeroMesh(
  spec: CarSpec,
  model: LoadedModel,
  wheels: THREE.Mesh[] = [],
  pivots: THREE.Group[] = [],
  onParts?: (p: CarParts) => void
): THREE.Group {
  const root = new THREE.Group();
  const inner = model.root.clone(true);
  root.add(inner);
  const s = model.size;

  // per-instance materials + body recolor
  const glassMats: THREE.MeshStandardMaterial[] = [];
  let bodyMesh: THREE.Mesh | null = null;
  inner.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.material) return;
    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(
      (m) => {
        const c = m.clone();
        const sm = c as THREE.MeshStandardMaterial;
        if (/body|paint/i.test(c.name) && sm.color) {
          sm.color.set(spec.color);
          if ("metalness" in sm) sm.metalness = 0.2;
          if ("roughness" in sm) sm.roughness = 0.42;
          if (!bodyMesh && /body/i.test(c.name)) bodyMesh = mesh;
        }
        if (/glass/i.test(c.name) && sm.color) glassMats.push(sm);
        return c;
      }
    );
    mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
  });
  if (!bodyMesh) bodyMesh = (inner.getObjectByProperty("type", "Mesh") as THREE.Mesh) ?? new THREE.Mesh();

  // wheel parents — name patterns differ per asset pack; first hit wins
  const WHEEL_PATTERNS = [/^wheel hub/i, /^dark wheel inset/i, /^hub_center/i];
  let hubNodes: THREE.Object3D[] = [];
  for (const re of WHEEL_PATTERNS) {
    const found: THREE.Object3D[] = [];
    inner.traverse((o) => {
      if (re.test(o.name)) found.push(o);
    });
    if (found.length === 4) {
      hubNodes = found;
      break;
    }
  }
  inner.updateWorldMatrix(true, true);
  // nose is local -z: front = smaller z. order [FL, FR, RL, RR] (x<0 = left)
  const pos = hubNodes.map((h) => h.getWorldPosition(new THREE.Vector3()));
  const idx = hubNodes.map((_, i) => i).sort((a, b) => pos[a].z - pos[b].z);
  const front = idx.slice(0, 2).sort((a, b) => pos[a].x - pos[b].x);
  const rear = idx.slice(2, 4).sort((a, b) => pos[a].x - pos[b].x);
  const order = [...front, ...rear];

  const allWheelMeshes: THREE.Object3D[] = [];
  order.forEach((i, k) => {
    const hub = hubNodes[i];
    allWheelMeshes.push(hub);
    wheels.push(hub as unknown as THREE.Mesh);
    if (k < 2 && hub.parent) {
      // wrap front hubs in a steering pivot at the hub position
      const pivot = new THREE.Group();
      pivot.position.copy(hub.position);
      hub.parent.add(pivot);
      pivot.attach(hub);
      pivots.push(pivot);
    }
  });

  // spoiler: collect wing nodes (may be empty for sedans/hatchbacks)
  const spoiler = new THREE.Group();
  spoiler.name = "hero-spoiler";
  const wingNodes: THREE.Object3D[] = [];
  inner.traverse((o) => {
    if (/rear wing|wing pedestal|spoiler/i.test(o.name)) wingNodes.push(o);
  });
  // bodyBox and generated wing dimensions are measured in the outer car's
  // normalized frame; keep the spoiler in that same frame, outside the GLB's
  // yaw/scale wrapper, to avoid transforming its position twice.
  root.add(spoiler);
  if (wingNodes.length) {
    // reparent only the outermost wing nodes into the removable spoiler group
    const roots = wingNodes.filter(
      (w) => !wingNodes.some((o) => o !== w && isDescendant(w, o))
    );
    for (const r of roots) spoiler.attach(r);
  }

  // soft radial underglow in the car's own color (hard-edged plane reads as a slab)
  const gc = document.createElement("canvas");
  gc.width = gc.height = 128;
  const gg = gc.getContext("2d")!;
  const grad = gg.createRadialGradient(64, 64, 6, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,0.85)");
  grad.addColorStop(0.55, "rgba(255,255,255,0.25)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  gg.fillStyle = grad;
  gg.fillRect(0, 0, 128, 128);
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(s.x + 1.0, s.z + 1.2),
    new THREE.MeshBasicMaterial({
      color: spec.color,
      map: new THREE.CanvasTexture(gc),
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.06;
  glow.name = "hero-underglow";
  root.add(glow);

  // racing livery stripes over the roof/hood — revealed by engine upgrades.
  // roofline comes from the body shell itself: the model bbox is inflated by
  // wings/antennas and would leave the stripes floating in the air
  root.add(makeBodyLivery(bodyMesh as THREE.Mesh));

  onParts?.({
    bodyMesh: bodyMesh as THREE.Mesh,
    glassMats,
    bumpers: [],
    allWheelMeshes,
    spoiler,
  });
  return root;
}

function isDescendant(node: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = node.parent;
  while (p) {
    if (p === ancestor) return true;
    p = p.parent;
  }
  return false;
}

/** Build racing stripes by sampling the actual body surface, so they follow hood and roof contours. */
function makeBodyLivery(body: THREE.Mesh): THREE.Group {
  const livery = new THREE.Group();
  livery.name = "hero-livery";
  const material = new THREE.MeshStandardMaterial({
    color: 0xeef2f8,
    roughness: 0.45,
    metalness: 0.25,
    emissive: 0xbfc8dd,
    emissiveIntensity: 0.12,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  body.updateWorldMatrix(true, false);
  const bounds = new THREE.Box3().setFromObject(body);
  const size = bounds.getSize(new THREE.Vector3());
  const raycaster = new THREE.Raycaster();
  const vertices: number[] = [];
  const indices: number[] = [];
  const segments = 40;
  for (const x of [-size.x * 0.16, size.x * 0.16]) {
    const base = vertices.length / 3;
    for (let i = 0; i <= segments; i++) {
      const z = bounds.max.z - (size.z * 0.08) - (size.z * 0.84 * i / segments);
      raycaster.set(new THREE.Vector3(x, bounds.max.y + size.y + 0.5, z), new THREE.Vector3(0, -1, 0));
      raycaster.far = size.y * 2 + 1;
      const hit = raycaster.intersectObject(body, false)[0];
      const y = hit ? hit.point.y + 0.012 : bounds.max.y + 0.012;
      vertices.push(x - 0.1, y, z, x + 0.1, y, z);
      if (i < segments) {
        const a = base + i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  livery.add(new THREE.Mesh(geometry, material));
  return livery;
}

function makeLivery(w: number, h: number, l: number): THREE.Group {
  const group = new THREE.Group();
  group.name = "hero-livery";
  const material = new THREE.MeshStandardMaterial({ color: 0xeef2f8, roughness: 0.45, metalness: 0.25 });
  for (const x of [-0.26, 0.26]) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.022, Math.max(1.5, l * 0.86)), material);
    stripe.position.set(x, h, -l * 0.04);
    group.add(stripe);
  }
  void w;
  return group;
}

export interface UpgradeLevels {
  engine: number;
  tires: number;
  suspension: number;
  turbo: number;
}

/** Reveal/visualize upgrade levels on a car body built by either builder.
 *  Nodes: "hero-spoiler" (procedural wings only), "hero-livery" stripes,
 *  "hero-underglow" (color tier by turbo), wheel tint by tires. */
export function applyUpgradeLooks(root: THREE.Object3D, up: UpgradeLevels): void {
  const total = up.engine + up.tires + up.suspension + up.turbo;
  const spoiler = root.getObjectByName("hero-spoiler");
  if (spoiler?.userData.procedural) {
    spoiler.visible = up.suspension + up.turbo >= 2;
  }
  const livery = root.getObjectByName("hero-livery");
  if (livery) livery.visible = up.engine >= 2 || total >= 7;
  const glow = root.getObjectByName("hero-underglow") as THREE.Mesh | undefined;
  if (glow) {
    const mat = glow.material as THREE.MeshBasicMaterial;
    const tiers = [0x35405c, 0x22d3ee, 0xa855f7, 0xff7a1a];
    const t = Math.max(0, Math.min(up.turbo, 3));
    mat.color.setHex(tiers[t]);
    mat.opacity = 0.45 + t * 0.15;
  }
  const tireTint = [0, 0x3a4150, 0x232833, 0x101218][Math.max(0, Math.min(up.tires, 3))];
  if (tireTint) {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !/hub|wheel/i.test(mesh.name)) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const sm = m as THREE.MeshStandardMaterial;
        if (sm.color) sm.color.setHex(tireTint);
      }
    });
  }
}
