/**
 * Input — keyboard + mobile touch controls.
 * Keyboard: W/↑ gas, S/↓ brake, A/D/←/→ steer, Space handbrake, Esc pause, M mute.
 * Touch: left joystick (up = gas, down = reverse, sideways = steer) and on the
 * right BRAKE pedal + handbrake (drift). The joystick knob follows the finger.
 * The touch layer is created lazily and only shown on coarse-pointer devices.
 */

export interface InputState {
  steer: number; // -1 left .. +1 right
  throttle: number; // 0..1
  brake: number; // 0..1
  reverse: number; // 0..1, used by keyboard S and the joystick downstroke
  handbrake: boolean;
  nitro: boolean;
}

const JOY_RADIUS = 52; // px of finger travel for full deflection
const JOY_DEAD = 8; // px deadzone around center

export class Input {
  keys = new Set<string>();
  state: InputState = { steer: 0, throttle: 0, brake: 0, reverse: 0, handbrake: false, nitro: false };

  onPause: (() => void) | null = null;
  onMute: (() => void) | null = null;
  onConfirm: (() => void) | null = null;

  private driving = false;
  private touchRoot: HTMLDivElement | null = null;
  private joyEl: HTMLDivElement | null = null;
  private joyKnob: HTMLDivElement | null = null;
  private joy: { id: number; x0: number; y0: number } | null = null;
  private joySteer = 0;
  private joyThrottle = 0;
  private joyBrake = 0;
  private brakeTouch: number | null = null;
  private hbTouch: number | null = null;
  private hb = false;
  private nitroTouch: number | null = null;

  readonly isTouch: boolean;

  constructor() {
    this.isTouch =
      window.matchMedia?.("(pointer: coarse)").matches ||
      "ontouchstart" in window;
    window.addEventListener("keydown", this.keyDown);
    window.addEventListener("keyup", this.keyUp);
    window.addEventListener("blur", this.clear);
    if (this.isTouch) this.buildTouch();
  }

  private keyDown = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    const target = e.target;
    if (target instanceof Element && target.closest("button, input, select, textarea, a[href], [contenteditable], dialog[open]")) return;
    const c = e.code;
    if (this.driving) {
      if (c.startsWith("Arrow") || c === "Space") e.preventDefault();
      if (!e.repeat) this.keys.add(c);
    }
    if (e.repeat) return;
    if (c === "Escape") this.onPause?.();
    if (c === "KeyM") this.onMute?.();
    if (!this.driving && (c === "Space" || c === "Enter")) this.onConfirm?.();
  };

  private keyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private clear = (): void => {
    this.keys.clear();
    this.joy = null;
    this.joySteer = 0;
    this.joyThrottle = 0;
    this.joyBrake = 0;
    this.brakeTouch = null;
    this.hbTouch = null;
    this.nitroTouch = null;
    this.hb = false;
    this.joyKnob?.style.setProperty("transform", "translate(0px, 0px)");
    this.touchRoot?.querySelectorAll(".on").forEach((button) => button.classList.remove("on"));
  };

  update(): InputState {
    const k = this.keys;
    let steer = 0;
    if (k.has("KeyA") || k.has("ArrowLeft")) steer -= 1;
    if (k.has("KeyD") || k.has("ArrowRight")) steer += 1;
    let throttle = k.has("KeyW") || k.has("ArrowUp") ? 1 : 0;
    let brake = k.has("KeyS") || k.has("ArrowDown") || this.brakeTouch !== null ? 1 : 0;
    let reverse = k.has("KeyS") || k.has("ArrowDown") ? 1 : 0;
    // joystick takes over when the finger is down
    if (this.joy) {
      steer = this.joySteer;
      throttle = this.joyThrottle;
      brake = Math.max(brake, this.joyBrake);
      reverse = Math.max(reverse, this.joyBrake);
    }
    this.state.steer = steer;
    this.state.throttle = throttle;
    this.state.brake = brake;
    this.state.reverse = reverse;
    this.state.handbrake = k.has("Space") || this.hb;
    this.state.nitro = k.has("ShiftLeft") || k.has("ShiftRight") || this.nitroTouch !== null;
    return this.state;
  }

  setDriving(active: boolean): void {
    this.driving = active;
    if (!active) this.clear();
    if (this.touchRoot) this.touchRoot.style.display = active ? "block" : "none";
  }

  private buildTouch(): void {
    const root = document.createElement("div");
    root.id = "touch-controls";
    root.style.display = "none";

    // left joystick: movement + steering
    const joy = document.createElement("div");
    joy.id = "tc-wheel";
    joy.innerHTML = "<div id='tc-wheel-knob'></div>";
    root.appendChild(joy);
    this.joyEl = joy;
    this.joyKnob = joy.querySelector("#tc-wheel-knob") as HTMLDivElement;

    // right side: brake pedal + handbrake (drift)
    const brake = document.createElement("div");
    brake.id = "tc-brake";
    brake.textContent = "ТОРМОЗ";
    const hb = document.createElement("div");
    hb.id = "tc-hb";
    hb.textContent = "ДРИФТ";
    root.appendChild(brake);
    root.appendChild(hb);
    const nitro = document.createElement("div");
    nitro.id = "tc-nitro";
    nitro.textContent = "НИТРО";
    root.appendChild(nitro);

    const onPointer = (
      el: HTMLElement,
      down: (id: number, x: number, y: number) => void,
      move?: (x: number, y: number) => void,
      up?: () => void
    ) => {
      let activeId: number | null = null;
      el.addEventListener("pointerdown", (e) => {
        if (!this.driving || activeId !== null && el.hasPointerCapture(activeId)) return;
        e.preventDefault();
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* synthetic pointers cannot be captured */
        }
        activeId = e.pointerId;
        down(e.pointerId, e.clientX, e.clientY);
      });
      if (move) {
        el.addEventListener("pointermove", (e) => {
          // accept either a captured pointer or the tracked id (synthetic
          // test pointers cannot capture, so id matching keeps them working)
          const mine =
            activeId === e.pointerId ||
            (() => {
              try {
                return el.hasPointerCapture(e.pointerId);
              } catch {
                return false;
              }
            })();
          if (mine) move(e.clientX, e.clientY);
        });
      }
      const release = (e: PointerEvent) => {
        if (e.pointerId !== activeId) return;
        activeId = null;
        try {
          if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
        } catch {
          /* synthetic pointers */
        }
        up?.();
      };
      el.addEventListener("pointerup", release);
      el.addEventListener("pointercancel", release);
      el.addEventListener("lostpointercapture", release);
    };

    const applyJoy = (x: number, y: number): void => {
      if (!this.joy) return;
      let dx = x - this.joy.x0;
      let dy = y - this.joy.y0;
      const dist = Math.hypot(dx, dy);
      if (dist > JOY_RADIUS) {
        dx = (dx / dist) * JOY_RADIUS;
        dy = (dy / dist) * JOY_RADIUS;
      }
      const axial = Math.abs(dy) < JOY_DEAD ? 0 : (dy - Math.sign(dy) * JOY_DEAD) / (JOY_RADIUS - JOY_DEAD);
      const lateral = Math.abs(dx) < JOY_DEAD ? 0 : (dx - Math.sign(dx) * JOY_DEAD) / (JOY_RADIUS - JOY_DEAD);
      this.joySteer = Math.max(-1, Math.min(1, lateral));
      this.joyThrottle = Math.max(0, Math.min(1, -axial)); // finger up = forward
      this.joyBrake = Math.max(0, Math.min(1, axial)); // finger down = reverse
      // knob follows the finger, clamped to the rim
      this.joyKnob?.style.setProperty(
        "transform",
        `translate(${dx * 0.55}px, ${dy * 0.55}px)`
      );
    };

    onPointer(
      joy,
      (id, x, y) => {
        this.joy = { id, x0: x, y0: y };
        applyJoy(x, y);
      },
      (x, y) => applyJoy(x, y),
      () => {
        this.joy = null;
        this.joySteer = 0;
        this.joyThrottle = 0;
        this.joyBrake = 0;
        this.joyKnob?.style.setProperty("transform", "translate(0px, 0px)");
      }
    );
    onPointer(
      brake,
      (id) => {
        this.brakeTouch = id;
        brake.classList.add("on");
      },
      undefined,
      () => {
        this.brakeTouch = null;
        brake.classList.remove("on");
      }
    );
    onPointer(
      hb,
      (id) => {
        this.hbTouch = id;
        this.hb = true;
        hb.classList.add("on");
      },
      undefined,
      () => {
        this.hbTouch = null;
        this.hb = false;
        hb.classList.remove("on");
      }
    );
    onPointer(
      nitro,
      (id) => { this.nitroTouch = id; nitro.classList.add("on"); },
      undefined,
      () => { this.nitroTouch = null; nitro.classList.remove("on"); }
    );

    document.getElementById("game-root")?.appendChild(root);
    this.touchRoot = root;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.keyDown);
    window.removeEventListener("keyup", this.keyUp);
    window.removeEventListener("blur", this.clear);
    this.touchRoot?.remove();
    this.touchRoot = null;
  }
}
