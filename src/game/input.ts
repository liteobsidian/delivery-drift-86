/**
 * Input — keyboard + mobile touch controls.
 * Keyboard: W/↑ gas, S/↓ brake, A/D/←/→ steer, Space handbrake, Esc pause, M mute.
 * Touch: steering wheel widget (left), GAS / BRAKE pedals + handbrake (right).
 * The touch layer is created lazily and only shown on coarse-pointer devices.
 */

export interface InputState {
  steer: number; // -1 left .. +1 right
  throttle: number; // 0..1
  brake: number; // 0..1
  handbrake: boolean;
}

export class Input {
  private keys = new Set<string>();
  state: InputState = { steer: 0, throttle: 0, brake: 0, handbrake: false };

  onPause: (() => void) | null = null;
  onMute: (() => void) | null = null;
  onConfirm: (() => void) | null = null;

  private touchRoot: HTMLDivElement | null = null;
  private wheelEl: HTMLDivElement | null = null;
  private steerTouch: { id: number; x0: number } | null = null;
  private steerValue = 0;
  private gasTouch: number | null = null;
  private brakeTouch: number | null = null;
  private hbTouch: number | null = null;
  private hb = false;

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
    const c = e.code;
    if (
      ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(c)
    ) {
      e.preventDefault();
    }
    if (e.repeat) return;
    this.keys.add(c);
    if (c === "Escape") this.onPause?.();
    if (c === "KeyM") this.onMute?.();
    if (c === "Space" || c === "Enter") this.onConfirm?.();
  };

  private keyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private clear = (): void => {
    this.keys.clear();
    this.steerValue = 0;
    this.gasTouch = null;
    this.brakeTouch = null;
    this.hbTouch = null;
    this.hb = false;
  };

  update(): InputState {
    const k = this.keys;
    let steer = 0;
    if (k.has("KeyA") || k.has("ArrowLeft")) steer -= 1;
    if (k.has("KeyD") || k.has("ArrowRight")) steer += 1;
    // touch steering takes over when active
    if (this.steerTouch) steer = this.steerValue;
    this.state.steer = steer;
    this.state.throttle =
      k.has("KeyW") || k.has("ArrowUp") || this.gasTouch !== null ? 1 : 0;
    this.state.brake =
      k.has("KeyS") || k.has("ArrowDown") || this.brakeTouch !== null ? 1 : 0;
    this.state.handbrake = k.has("Space") || this.hb;
    return this.state;
  }

  setTouchVisible(v: boolean): void {
    if (this.touchRoot) this.touchRoot.style.display = v ? "block" : "none";
  }

  private buildTouch(): void {
    const root = document.createElement("div");
    root.id = "touch-controls";
    root.style.display = "none";

    // steering wheel
    const wheel = document.createElement("div");
    wheel.id = "tc-wheel";
    wheel.innerHTML = "<div id='tc-wheel-knob'></div>";
    root.appendChild(wheel);
    this.wheelEl = wheel;

    // pedals
    const gas = document.createElement("div");
    gas.id = "tc-gas";
    gas.textContent = "ГАЗ";
    const brake = document.createElement("div");
    brake.id = "tc-brake";
    brake.textContent = "ТОРМОЗ";
    const hb = document.createElement("div");
    hb.id = "tc-hb";
    hb.textContent = "ДРИФТ";
    root.appendChild(gas);
    root.appendChild(brake);
    root.appendChild(hb);

    const onPointer = (
      el: HTMLElement,
      down: (id: number, x: number) => void,
      move?: (x: number) => void,
      up?: () => void
    ) => {
      el.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* synthetic pointers cannot be captured */
        }
        down(e.pointerId, e.clientX);
      });
      if (move) {
        el.addEventListener("pointermove", (e) => {
          try {
            if (el.hasPointerCapture(e.pointerId)) move(e.clientX);
          } catch {
            /* synthetic pointers */
          }
        });
      }
      const release = (e: PointerEvent) => {
        try {
          if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
        } catch {
          /* synthetic pointers */
        }
        up?.();
      };
      el.addEventListener("pointerup", release);
      el.addEventListener("pointercancel", release);
    };

    onPointer(
      wheel,
      (id, x) => {
        this.steerTouch = { id, x0: x };
      },
      (x) => {
        if (!this.steerTouch) return;
        const dx = x - this.steerTouch.x0;
        this.steerValue = Math.max(-1, Math.min(1, dx / 70));
        if (this.wheelEl)
          this.wheelEl.style.transform = `rotate(${this.steerValue * 90}deg)`;
      },
      () => {
        this.steerTouch = null;
        this.steerValue = 0;
        if (this.wheelEl) this.wheelEl.style.transform = "rotate(0deg)";
      }
    );
    onPointer(
      gas,
      (id) => {
        this.gasTouch = id;
        gas.classList.add("on");
      },
      undefined,
      () => {
        this.gasTouch = null;
        gas.classList.remove("on");
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
