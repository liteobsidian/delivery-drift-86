import * as THREE from "three";
import {
  CARS,
  tunedSpec,
  UPGRADE_COST,
  UPGRADE_DEFS,
  UPGRADE_MAX,
  SUPRA_PRICE,
  SUPRA_UNLOCK_DELIVERIES,
  RED_LIGHT_FINE,
  ROAD_W,
  LIGHT_CYCLE,
  LIGHT_YELLOW,
  CARGO_NAMES,
  ORDER_TITLES,
  WORLD_HALF,
  CELL,
  GRID_N,
} from "./config";
import type { GameScreen, Order, Profile } from "./types";
import { loadProfile, saveProfile } from "./storage";
import { AudioSystem } from "./audio";
import { Input } from "./input";
import { World } from "./world";
import { Car } from "./car";
import { Traffic } from "./traffic";
import { Police } from "./police";
import { Effects } from "./effects";

const SD = ROAD_W / 2 + 1.6; // stop-line distance from intersection center

function el(tag: string, cls: string, html = ""): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  e.innerHTML = html;
  return e;
}

export class Game {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private raf = 0;
  private acc = 0;
  private running = false;

  profile: Profile = loadProfile();
  audio = new AudioSystem();
  private input!: Input;
  world = new World();
  car: Car;
  traffic: Traffic;
  effects = new Effects();

  screen: GameScreen = "title";
  order: Order | null = null;
  orders: Order[] = [];
  timeLeft = 0;
  driftScore = 0;
  orderFines = 0;
  bonusMoney = 0;
  trafficHits = 0;
  redLightRuns = 0;
  police = new Police();
  private chaseEscape = 0;
  private chaseTriggered = false;
  private elapsed = 0;
  private chaseTimedOut = 0;
  private orderId = 1;
  private wasInPuddle = false;
  private redFinedX = new Map<World["lights"][number], number>();
  private greenCooldown = new Map<World["lights"][number], number>();
  private scrapeCooldown = 0;
  private driftBonusTimer = 0;
  private debris: THREE.Mesh[] = [];
  private shake = 0;
  private camPos = new THREE.Vector3(0, 5, 55);
  private toastTimer = 0;
  private hudTimer = 0;
  private readyFlagged = false;

  // DOM refs
  private overlay: HTMLElement;
  private screenEl: HTMLElement;
  private hudEl: HTMLElement;
  private toastEl!: HTMLElement;
  private mmCanvas!: HTMLCanvasElement;
  private mmBase!: HTMLCanvasElement;
  private hOrder!: HTMLElement;
  private hTimer!: HTMLElement;
  private hCargoBar!: HTMLElement;
  private hCargoText!: HTMLElement;
  private hSpeed!: HTMLElement;
  private hMoney!: HTMLElement;
  private hDrift!: HTMLElement;
  private hChase!: HTMLElement;
  private popups!: HTMLElement;
  private tutorialEl!: HTMLElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1600);
    this.resize();
    window.addEventListener("resize", this.resize);

    // --- scene lighting: night city ---
    this.scene.background = new THREE.Color(0x0b1026);
    this.scene.fog = new THREE.FogExp2(0x0b1026, 0.0028);
    const hemi = new THREE.HemisphereLight(0x5a66a0, 0x201a30, 1.2);
    this.scene.add(hemi);
    const moon = new THREE.DirectionalLight(0x9fb4ff, 1.2);
    moon.position.set(-120, 200, -80);
    this.scene.add(moon);
    const pink = new THREE.DirectionalLight(0xff2d95, 0.25);
    pink.position.set(100, 60, 120);
    this.scene.add(pink);

    this.scene.add(this.world.group);
    this.car = new Car(tunedSpec(this.currentCarSpec(), this.currentUpgrades()));
    this.car.onSmoke = (x, z, strong) => this.effects.spawnSmoke(x, z, strong);
    this.scene.add(this.car.group);
    this.traffic = new Traffic(this.world);
    this.traffic.onNearMiss = () => {
      if (this.screen !== "playing") return;
      this.addBonus(60, "Впритирку!");
      this.audio.uiClick();
    };
    this.scene.add(this.traffic.group);
    this.scene.add(this.police.group);
    this.scene.add(this.effects.group);
    this.car.onWheelLost = (x, z) => {
      const geo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 12);
      geo.rotateZ(Math.PI / 2);
      const m = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ color: 0x0a0a0c })
      );
      m.position.set(x, 0.34, z);
      this.scene.add(m);
      this.debris.push(m);
      this.toast("Отвалилась колесо! Машина ведёт в сторону", true);
      this.audio.thud(0.7);
    };

    // blob shadow under car
    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(1.9, 16),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      })
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.02;
    this.car.group.add(blob);

    // --- UI ---
    this.overlay = document.getElementById("ui-overlay")!;
    this.screenEl = el("div", "screen-wrap");
    this.overlay.appendChild(this.screenEl);
    this.hudEl = el("div", "hud");
    this.hudEl.style.display = "none";
    this.overlay.appendChild(this.hudEl);

    this.input = new Input();
    this.buildHud();
    this.input.onPause = () => this.togglePause();
    this.input.onMute = () => this.toggleMute();
    this.input.onConfirm = () => {
      if (this.screen === "title") this.quickStart();
      else if (this.screen === "result") this.gotoOrders();
    };
    this.audio.muted = this.profile.muted;

    this.showScreen("title");
    (window as unknown as { __gameProbe: () => { x: number; y: number; z: number } }).__gameProbe =
      () => ({ x: this.car.pos.x, y: this.car.pos.y, z: this.car.pos.z });
    // verification hook (not user-facing)
    (window as unknown as { __gameDebug: unknown }).__gameDebug = {
      teleport: (x: number, z: number) => {
        this.car.pos.set(x, 0, z);
        this.car.vel.set(0, 0, 0);
      },
      cargo: () => this.car.cargo,
      screen: () => this.screen,
      orderDest: () =>
        this.order ? { x: this.order.dest.x, z: this.order.dest.z } : null,
      // feature test hooks (verification only)
      damageTest: () => {
        this.car.damageCar(75);
        this.car.loseWheel();
      },
      policeTest: () => {
        this.police.start(this.car.pos.x + 8, this.car.pos.z + 14);
      },
      hp: () => this.car.hp,
      policeActive: () => this.police.active,
      bonus: () => this.bonusMoney,
    };
  }

  // ================= screens =================

  private clearScreen(): void {
    this.screenEl.innerHTML = "";
    this.screenEl.style.display = "none";
  }

  showScreen(s: GameScreen): void {
    this.screen = s;
    this.hudEl.style.display = s === "playing" ? "block" : "none";
    this.input.setTouchVisible(s === "playing");
    if (s === "title") this.renderTitle();
    else if (s === "garage") this.renderGarage();
    else if (s === "orders") this.renderOrders();
    else if (s === "paused") this.renderPaused();
    else if (s === "result") this.renderResult();
    else this.clearScreen();
  }

  private renderTitle(): void {
    const p = this.profile;
    const supra = CARS[1];
    const locked = p.deliveries < SUPRA_UNLOCK_DELIVERIES;
    this.screenEl.style.display = "flex";
    this.screenEl.innerHTML = `
      <div class="title-box">
        <div class="logo-sub">ночной курьер Токио</div>
        <h1 class="logo">DELIVERY<span> DRIFT</span> <em>86</em></h1>
        <p class="tagline">Доставляй быстро. Дрифти жёстко. Не разбей груз.</p>
        <div class="title-buttons">
          <button class="btn primary" data-a="quick">БЫСТРАЯ ДОСТАВКА <kbd>ПРОБЕЛ</kbd></button>
          <button class="btn" data-a="garage">ГАРАЖ</button>
        </div>
        <div class="stats-row">
          <span>₽ ${p.money}</span>
          <span>доставок: ${p.deliveries}</span>
          <span>машина: ${this.currentCarSpec().name.replace("Toyota ", "")}</span>
          ${locked ? `<span class="dim">Supra: ещё ${SUPRA_UNLOCK_DELIVERIES - p.deliveries} доставок</span>` : `<span class="gold">Supra доступна!</span>`}
        </div>
        <div class="hint-row">
          <span>W/↑ газ</span><span>S/↓ тормоз</span><span>A D руль</span><span>ПРОБЕЛ дрифт</span><span>ESC пауза</span><span>M звук</span>
        </div>
        <p class="fine-print">прогресс хранится в этом браузере (localStorage)</p>
      </div>`;
    this.bindScreen({
      quick: () => this.quickStart(),
      garage: () => this.showScreen("garage"),
    });
    void supra;
  }

  private renderGarage(): void {
    const p = this.profile;
    const cur = this.currentCarSpec();
    const up = this.currentUpgrades();
    const carCards = CARS.map((c) => {
      const owned = p.ownedCars.includes(c.id);
      const isCur = p.carId === c.id;
      const locked = c.id === "supra" && p.deliveries < SUPRA_UNLOCK_DELIVERIES;
      let btn;
      if (isCur) btn = `<button class="btn small" disabled>В ГАРАЖЕ</button>`;
      else if (owned) btn = `<button class="btn small" data-a="select:${c.id}">ВЫБРАТЬ</button>`;
      else if (locked)
        btn = `<button class="btn small" disabled>🔒 ${p.deliveries}/${SUPRA_UNLOCK_DELIVERIES} доставок</button>`;
      else
        btn = `<button class="btn small ${p.money >= c.price ? "primary" : ""}" data-a="buy:${c.id}">КУПИТЬ ₽${c.price}</button>`;
      return `<div class="car-card ${isCur ? "current" : ""}">
        <div class="car-swatch" style="background:#${c.color.toString(16).padStart(6, "0")}"></div>
        <div class="car-name">${c.name}</div>
        <div class="car-stats">скорость ${c.topSpeed * 3} · разгон ${c.accel} · сцепление ${c.grip}</div>
        ${btn}
      </div>`;
    }).join("");

    const upRows = UPGRADE_DEFS.map((d) => {
      const lvl = up[d.key];
      const maxed = lvl >= UPGRADE_MAX;
      const cost = maxed ? 0 : UPGRADE_COST[lvl];
      const pips = Array.from({ length: UPGRADE_MAX }, (_, i) =>
        `<span class="pip ${i < lvl ? "on" : ""}"></span>`
      ).join("");
      return `<div class="up-row">
        <div class="up-info"><b>${d.name}</b><span>${d.desc}</span></div>
        <div class="pips">${pips}</div>
        ${maxed
          ? `<button class="btn small" disabled>МАКС</button>`
          : `<button class="btn small ${p.money >= cost ? "primary" : ""}" data-a="up:${d.key}">₽${cost}</button>`}
      </div>`;
    }).join("");

    this.screenEl.style.display = "flex";
    this.screenEl.innerHTML = `
      <div class="panel garage">
        <h2>ГАРАЖ</h2>
        <div class="money-line">Баланс: <b>₽${p.money}</b> · доставок: ${p.deliveries}</div>
        <div class="car-cards">${carCards}</div>
        <h3>Прокачка: ${cur.name.replace("Toyota ", "")}</h3>
        <div class="up-list">${upRows}</div>
        <h3>Состояние кузова</h3>
        <div class="cond-row">
          <div class="cond-bar"><div class="cond-fill" style="transform:scaleX(${this.car.hp / 100})"></div></div>
          <span class="${this.car.hp < 50 ? "neg" : ""}">${Math.round(this.car.hp)}%</span>
          <button class="btn small ${this.car.hp < 100 && p.money >= this.repairCost ? "primary" : ""}" data-a="repair" ${this.car.hp >= 100 ? "disabled" : ""}>
            ${this.car.hp >= 100 ? "ИСПРАВНА" : `РЕМОНТ ₽${this.repairCost}`}
          </button>
        </div>
        <p class="dim" style="font-size:11px">Удары сминают бамперы, трескают стёкла. При сильных повреждениях отваливается колесо.</p>
        <button class="btn" data-a="back">← НАЗАД</button>
      </div>`;
    this.bindScreen({
      back: () => this.showScreen("title"),
      repair: () => this.repairCar(),
    });
  }

  private get repairCost(): number {
    return Math.round((100 - this.car.hp) * 3.5);
  }

  private repairCar(): void {
    const cost = this.repairCost;
    if (this.car.hp >= 100 || this.profile.money < cost) return;
    this.profile.money -= cost;
    this.car.repair();
    saveProfile(this.profile);
    this.audio.cash();
    this.renderGarage();
  }

  private renderOrders(): void {
    if (this.orders.length === 0) this.genOrders();
    const cards = this.orders.map((o, i) => `
      <div class="order-card" data-a="take:${i}">
        <div class="order-title">${o.title}</div>
        <div class="order-cargo">📦 ${CARGO_NAMES[o.id % CARGO_NAMES.length]}</div>
        <div class="order-meta">
          <span>расстояние ~${Math.round(o.distance)} м</span>
          <span>лимит ${o.timeLimit} с</span>
          <span class="frag ${o.fragility > 1.3 ? "high" : o.fragility > 1 ? "mid" : ""}">хрупкость ×${o.fragility.toFixed(1)}</span>
        </div>
        <div class="order-reward">₽${o.reward}+</div>
      </div>`).join("");
    this.screenEl.style.display = "flex";
    this.screenEl.innerHTML = `
      <div class="panel orders">
        <h2>ВЫБОР ЗАКАЗА</h2>
        <p class="dim">Дальний заказ платит больше, но груз дольше трясётся. Выбирай маршрут с умом.</p>
        <div class="order-cards">${cards}</div>
        <button class="btn" data-a="back">← В ГАРАЖ</button>
      </div>`;
    this.bindScreen({ back: () => this.showScreen("garage") });
  }

  private renderPaused(): void {
    this.screenEl.style.display = "flex";
    this.screenEl.innerHTML = `
      <div class="panel pause">
        <h2>ПАУЗА</h2>
        <button class="btn primary" data-a="resume">ПРОДОЛЖИТЬ</button>
        <button class="btn" data-a="retry">ЗАНОВО ЗАКАЗ</button>
        <button class="btn" data-a="sound">${this.profile.muted ? "🔇 ВКЛ ЗВУК" : "🔊 ВЫКЛ ЗВУК"}</button>
        <button class="btn" data-a="quit">В МЕНЮ</button>
      </div>`;
    this.bindScreen({
      resume: () => this.togglePause(),
      retry: () => {
        if (this.order) this.startOrder(this.order);
      },
      sound: () => {
        this.toggleMute();
        this.renderPaused();
      },
      quit: () => {
        this.world.hideDestination();
        this.showScreen("title");
      },
    });
  }

  private lastResult: { ok: boolean; lines: string[] } = { ok: false, lines: [] };

  private renderResult(): void {
    const r = this.lastResult;
    this.screenEl.style.display = "flex";
    this.screenEl.innerHTML = `
      <div class="panel result ${r.ok ? "ok" : "bad"}">
        <h2>${r.ok ? "ДОСТАВЛЕНО!" : "ЗАКАЗ ПРОВАЛЕН"}</h2>
        <div class="result-lines">${r.lines.map((l) => `<div>${l}</div>`).join("")}</div>
        <button class="btn primary" data-a="more">ЕЩЁ ЗАКАЗ <kbd>ПРОБЕЛ</kbd></button>
        <button class="btn" data-a="garage">В ГАРАЖ</button>
        <button class="btn" data-a="menu">В МЕНЮ</button>
      </div>`;
    this.bindScreen({
      more: () => this.gotoOrders(),
      garage: () => this.showScreen("garage"),
      menu: () => this.showScreen("title"),
    });
  }

  private bindScreen(actions: Record<string, () => void>): void {
    this.screenEl.querySelectorAll("[data-a]").forEach((n) => {
      n.addEventListener("click", (e) => {
        e.preventDefault();
        this.audio.ensure();
        this.audio.uiClick();
        const a = (n as HTMLElement).dataset.a!;
        const [act, arg] = a.split(":");
        if (act === "buy" && arg) {
          this.buyCar(arg);
          return;
        }
        if (act === "select" && arg) {
          this.selectCar(arg);
          return;
        }
        if (act === "up" && arg) {
          this.buyUpgrade(arg as keyof Profile["upgrades"]["ae86"]);
          return;
        }
        if (act === "take" && arg !== undefined) {
          this.startOrder(this.orders[Number(arg)]);
          return;
        }
        actions[act]?.();
      });
    });
  }

  // ================= profile / economy =================

  private currentCarSpec() {
    return CARS.find((c) => c.id === this.profile.carId) ?? CARS[0];
  }

  private currentUpgrades() {
    return (
      this.profile.upgrades[this.profile.carId] ?? {
        engine: 0,
        tires: 0,
        suspension: 0,
        turbo: 0,
      }
    );
  }

  private buyCar(id: string): void {
    const car = CARS.find((c) => c.id === id);
    if (!car || this.profile.ownedCars.includes(id)) return;
    if (id === "supra" && this.profile.deliveries < SUPRA_UNLOCK_DELIVERIES) return;
    if (this.profile.money < car.price) return;
    this.profile.money -= car.price;
    this.profile.ownedCars.push(id);
    this.profile.carId = id;
    this.applyCarSpec();
    saveProfile(this.profile);
    this.audio.cash();
    this.renderGarage();
  }

  private selectCar(id: string): void {
    if (!this.profile.ownedCars.includes(id)) return;
    this.profile.carId = id;
    this.applyCarSpec();
    saveProfile(this.profile);
    this.renderGarage();
  }

  private buyUpgrade(key: keyof Profile["upgrades"]["ae86"]): void {
    const up = this.currentUpgrades();
    const lvl = up[key];
    if (lvl >= UPGRADE_MAX) return;
    const cost = UPGRADE_COST[lvl];
    if (this.profile.money < cost) return;
    this.profile.money -= cost;
    up[key] = lvl + 1;
    this.applyCarSpec();
    saveProfile(this.profile);
    this.audio.cash();
    this.renderGarage();
  }

  private applyCarSpec(): void {
    this.car.setSpec(tunedSpec(this.currentCarSpec(), this.currentUpgrades()));
  }

  // ================= orders =================

  private genOrders(): void {
    this.orders = [];
    const used = new Set<string>();
    for (let k = 0; k < 3; k++) {
      let dest = { x: 0, z: 0 };
      let key = "";
      let guard = 0;
      do {
        const i = Math.floor(Math.random() * GRID_N);
        const j = Math.floor(Math.random() * GRID_N);
        const off = (Math.random() - 0.5) * (CELL * 0.5);
        const vertical = Math.random() < 0.5;
        const cx = -WORLD_HALF + i * CELL;
        const cz = -WORLD_HALF + j * CELL;
        dest = vertical ? { x: cx + off, z: cz } : { x: cx, z: cz + off };
        const d = Math.hypot(dest.x, dest.z);
        key = `${Math.round(dest.x / 10)},${Math.round(dest.z / 10)}`;
        guard++;
        if (d > 90 && d < 300 && !used.has(key)) break;
      } while (guard < 40);
      used.add(key);
      const distance = Math.hypot(dest.x, dest.z);
      const fragility = 0.8 + Math.random() * 1.0;
      const reward = Math.round(
        180 + distance * 1.1 + fragility * 120 + Math.random() * 80
      );
      const timeLimit = Math.round(distance / 15 + 26 + Math.random() * 12);
      this.orders.push({
        id: this.orderId++,
        title: ORDER_TITLES[Math.floor(Math.random() * ORDER_TITLES.length)],
        dest,
        reward,
        timeLimit,
        fragility: Math.round(fragility * 10) / 10,
        distance,
      });
    }
  }

  private quickStart(): void {
    this.genOrders();
    this.startOrder(this.orders[0]);
  }

  private gotoOrders(): void {
    this.genOrders();
    this.showScreen("orders");
  }

  private startOrder(o: Order): void {
    this.order = o;
    this.orders = this.orders.filter((x) => x.id !== o.id);
    this.car.pos.set(0, 0, 0);
    this.car.vel.set(0, 0, 0);
    this.car.heading = Math.PI;
    this.car.cargo = 100;
    this.car.airY = 0;
    this.car.airV = 0;
    this.timeLeft = o.timeLimit;
    this.driftScore = 0;
    this.orderFines = 0;
    this.bonusMoney = 0;
    this.trafficHits = 0;
    this.redLightRuns = 0;
    this.chaseTriggered = false;
    this.chaseTimedOut = 0;
    this.police.stop();
    for (const d of this.debris) {
      this.scene.remove(d);
      d.geometry.dispose();
    }
    this.debris = [];
    this.wasInPuddle = false;
    this.redFinedX.clear();
    this.world.setDestination(o.dest.x, o.dest.z);
    this.audio.ensure();
    this.audio.startMusic();
    this.showScreen("playing");
    this.toast(`Заказ: доставьте за ${o.timeLimit} с. Берегите груз!`);
    if (this.input.isTouch && !this.profile.seenTutorial) {
      this.showTutorial(true);
    }
  }

  private togglePause(): void {
    if (this.screen === "playing") this.showScreen("paused");
    else if (this.screen === "paused") this.showScreen("playing");
  }

  private toggleMute(): void {
    this.profile.muted = !this.profile.muted;
    this.audio.ensure();
    this.audio.setMuted(this.profile.muted);
    saveProfile(this.profile);
  }

  // ================= HUD =================

  private buildHud(): void {
    const top = el("div", "hud-top");
    this.hOrder = el("span", "hud-order");
    this.hTimer = el("span", "hud-timer");
    const cargoWrap = el("div", "hud-cargo");
    this.hCargoBar = el("div", "hud-cargo-bar");
    cargoWrap.appendChild(this.hCargoBar);
    this.hCargoText = el("span", "hud-cargo-text");
    cargoWrap.appendChild(this.hCargoText);
    top.appendChild(this.hOrder);
    top.appendChild(this.hTimer);
    top.appendChild(cargoWrap);
    this.hChase = el("span", "hud-chase", "🚔 ПОГОНЯ!");
    this.hChase.style.display = "none";
    top.appendChild(this.hChase);
    this.hudEl.appendChild(top);

    const right = el("div", "hud-right");
    this.hSpeed = el("div", "hud-speed", "0");
    this.hMoney = el("div", "hud-money", "₽0");
    this.hDrift = el("div", "hud-drift", "");
    right.appendChild(this.hSpeed);
    right.appendChild(this.hMoney);
    right.appendChild(this.hDrift);
    this.hudEl.appendChild(right);

    this.mmCanvas = document.createElement("canvas");
    this.mmCanvas.id = "minimap";
    this.mmCanvas.width = this.mmCanvas.height = 150;
    this.hudEl.appendChild(this.mmCanvas);
    this.buildMinimapBase();

    this.toastEl = el("div", "toast");
    this.hudEl.appendChild(this.toastEl);

    this.popups = el("div", "bonus-popups");
    this.hudEl.appendChild(this.popups);

    const help = el("button", "hud-help", "?");
    help.addEventListener("click", () => this.showTutorial(true));
    this.hudEl.appendChild(help);

    this.tutorialEl = el("div", "tutorial");
    this.tutorialEl.innerHTML = `
      <div class="tutorial-box">
        <h3>КАК ИГРАТЬ</h3>
        <div class="tut-row"><span class="tut-ico wheel">↺</span><span><b>Руль</b> — води пальцем по кругу слева</span></div>
        <div class="tut-row"><span class="tut-ico gas">▶</span><span><b>ГАЗ / ТОРМОЗ</b> — держи круглые педали справа</span></div>
        <div class="tut-row"><span class="tut-ico hb">★</span><span><b>ДРИФТ</b> — занос на поворотах, даёт бонусы</span></div>
        <div class="tut-row"><span class="tut-ico">⚠</span><span>Брусчатка, лужи и удары бьют по <b>грузу</b>. На красный — штраф!</span></div>
        <div class="tut-row"><span class="tut-ico">🚀</span><span>Трамплины, впритирку, зелёный на скорости — всё это <b>₽ бонусы</b></span></div>
        <button class="btn primary" data-a="tut-ok">ПОНЯТНО!</button>
      </div>`;
    this.tutorialEl.style.display = "none";
    this.tutorialEl.querySelector("[data-a='tut-ok']")!.addEventListener("click", () => {
      this.audio.uiClick();
      this.profile.seenTutorial = true;
      saveProfile(this.profile);
      this.tutorialEl.style.display = "none";
    });
    this.hudEl.appendChild(this.tutorialEl);

    if (this.input?.isTouch) {
      const rh = el("div", "rotate-hint", "Поверните телефон горизонтально 🔄");
      this.hudEl.appendChild(rh);
    }
  }

  private showTutorial(force: boolean): void {
    if (!this.input.isTouch && !force) return;
    this.tutorialEl.style.display = "flex";
  }

  /** Floating "+₽" bonus popup. */
  private addBonus(amount: number, label: string): void {
    this.bonusMoney += amount;
    const p = el("div", "bonus-pop", `${label} <b>+₽${amount}</b>`);
    p.style.left = `${42 + Math.random() * 16}%`;
    this.popups.appendChild(p);
    window.setTimeout(() => p.remove(), 1400);
  }

  private buildMinimapBase(): void {
    this.mmBase = document.createElement("canvas");
    this.mmBase.width = this.mmBase.height = 150;
    const g = this.mmBase.getContext("2d")!;
    const S = 150;
    const scale = S / (WORLD_HALF * 2 + ROAD_W * 2);
    const u = (v: number) => (v + WORLD_HALF + ROAD_W) * scale;
    g.fillStyle = "rgba(10,14,28,0.75)";
    g.fillRect(0, 0, S, S);
    g.fillStyle = "#3a4152";
    for (let i = 0; i < GRID_N; i++) {
      const c = u(-WORLD_HALF + i * CELL);
      g.fillRect(c - (ROAD_W / 2) * scale, u(-WORLD_HALF - ROAD_W / 2), ROAD_W * scale, (WORLD_HALF * 2 + ROAD_W) * scale);
      g.fillRect(u(-WORLD_HALF - ROAD_W / 2), c - (ROAD_W / 2) * scale, (WORLD_HALF * 2 + ROAD_W) * scale, ROAD_W * scale);
    }
    // cobble patches
    g.fillStyle = "rgba(120,90,70,0.9)";
    for (const c of this.world.cobbles) {
      g.fillRect(u(c.x - c.w / 2), u(c.z - c.h / 2), c.w * scale, c.h * scale);
    }
  }

  private drawMinimap(): void {
    const g = this.mmCanvas.getContext("2d")!;
    g.clearRect(0, 0, 150, 150);
    g.drawImage(this.mmBase, 0, 0);
    const S = 150;
    const scale = S / (WORLD_HALF * 2 + ROAD_W * 2);
    const u = (v: number) => (v + WORLD_HALF + ROAD_W) * scale;
    // destination
    if (this.order) {
      const pulse = 3 + Math.sin(performance.now() / 200) * 1;
      g.fillStyle = "#22ffcc";
      g.beginPath();
      g.arc(u(this.order.dest.x), u(this.order.dest.z), pulse + 1.5, 0, Math.PI * 2);
      g.fill();
    }
    // player arrow
    g.save();
    g.translate(u(this.car.pos.x), u(this.car.pos.z));
    g.rotate(-this.car.heading + Math.PI);
    g.fillStyle = "#ff2d95";
    g.beginPath();
    g.moveTo(0, -5.5);
    g.lineTo(3.6, 4);
    g.lineTo(-3.6, 4);
    g.closePath();
    g.fill();
    g.restore();
  }

  private toast(msg: string, bad = false): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.toggle("bad", bad);
    this.toastEl.style.opacity = "1";
    this.toastTimer = 2.4;
  }

  // ================= main loop =================

  start(): void {
    this.running = true;
    this.clock.start();
    const loop = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(this.clock.getDelta(), 0.1);
      this.acc += dt;
      const step = 1 / 60;
      let n = 0;
      while (this.acc >= step && n < 5) {
        this.fixedStep(step);
        this.acc -= step;
        n++;
      }
      if (this.acc >= step) this.acc = 0;
      this.renderFrame(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private fixedStep(dt: number): void {
    this.elapsed += dt;
    this.world.update(dt);
    if (this.screen !== "playing" || !this.order) {
      this.audio.updateEngine(0, 0, 0);
      return;
    }
    const inp = this.input.update();
    const prevX = this.car.pos.x;
    const prevZ = this.car.pos.z;
    const res = this.car.step(dt, inp, this.world);
    const spec = this.car.spec;
    const frag = this.order.fragility;
    const protect = spec.cargoProtect;

    // traffic
    const tHit = this.traffic.update(
      dt,
      this.car.pos.x,
      this.car.pos.z,
      Math.abs(res.speed)
    );
    if (tHit > 4 && !this.car.isFlipping) {
      const dmg = 14 * (1 - protect * 0.5);
      this.car.damage(dmg * frag);
      this.car.damageCar(tHit * 0.8);
      this.trafficHits += 1;
      this.car.vel.multiplyScalar(0.55);
      this.shake = Math.min(1, this.shake + 0.6);
      this.audio.thud(0.8);
      this.effects.spawnFlash(this.car.pos.x, this.car.pos.z, 0xffaa44);
      this.toast("Авария с машиной! Груз пострадал", true);
      if (tHit > 12 && Math.abs(res.speed) > 12) {
        this.car.startRoll(Math.random() < 0.5 ? 1 : -1);
      }
    }

    // police pursuit
    if (this.police.active) {
      this.chaseTimedOut += dt;
      const caught = this.police.update(
        dt,
        this.car.pos.x,
        this.car.pos.z
      );
      if (caught) {
        this.orderFines += 350;
        this.audio.fine();
        this.effects.spawnFlash(this.car.pos.x, this.car.pos.z, 0x3355ff);
        this.toast("Вас поймали! Штраф −₽350", true);
        this.police.stop();
      } else if (this.police.dist > 75) {
        this.chaseEscape += dt;
        if (this.chaseEscape > 3) {
          this.addBonus(300, "Оторвался от погони!");
          this.audio.success();
          this.police.stop();
        }
      } else {
        this.chaseEscape = 0;
      }
      if (this.police.active && this.chaseTimedOut > 45) {
        this.addBonus(300, "Оторвался от погони!");
        this.police.stop();
      }
    } else if (!this.chaseTriggered && (this.redLightRuns >= 2 || this.trafficHits >= 2)) {
      this.chaseTriggered = true;
      this.police.start(this.car.pos.x, this.car.pos.z);
      this.chaseTimedOut = 0;
      this.chaseEscape = 0;
      this.audio.fine();
      this.toast("🚔 ПОГОНЯ! Оторвись или получишь штраф", true);
    }

    // red light check
    this.checkRedLight(prevX, prevZ);

    // damage from surfaces
    if (!this.car.isFlipping) {
      if (res.onCobble && Math.abs(res.speed) > 4) {
        const rate =
          (res.speed * res.speed * 0.0042 + Math.abs(res.speed) * 0.05) *
          frag *
          (1 - protect);
        this.car.damage(rate * dt);
        this.shake = Math.min(0.35, this.shake + dt * 2.4);
      }
      if (res.offRoad && Math.abs(res.speed) > 6) {
        const rate = Math.abs(res.speed) * 0.055 * frag * (1 - protect * 0.6);
        this.car.damage(rate * dt);
        this.shake = Math.min(0.3, this.shake + dt * 2);
      }
      if (res.inPuddle && !this.wasInPuddle && Math.abs(res.speed) > 10) {
        this.car.damage(1.6 * frag * (1 - protect));
        this.audio.splash();
        this.effects.spawnSplash(this.car.pos.x, this.car.pos.z);
      }
      this.wasInPuddle = res.inPuddle;
      if (res.impact > 3) {
        const dmg = res.impact * 1.15 * (1 - protect * 0.5);
        this.car.damage(dmg * frag);
        this.car.damageCar(res.impact * 0.9);
        this.shake = Math.min(1, this.shake + res.impact * 0.06);
        this.audio.thud(Math.min(1, res.impact / 25));
        this.effects.spawnFlash(this.car.pos.x, this.car.pos.z);
        if (dmg > 3) this.toast(`Удар! Груз −${Math.round(dmg)}%`, true);
        if (res.impact < 9 && this.scrapeCooldown <= 0) {
          this.scrapeCooldown = 3;
          this.addBonus(15, "Задел!");
        }
        if (this.car.hp < 30 && res.impact > 8 && !this.car.wheelLost) {
          this.car.loseWheel();
        }
      }
      this.scrapeCooldown = Math.max(0, this.scrapeCooldown - dt);
      // hard landing after a jump
      if (res.landing > 6) {
        const bonus = Math.min(150, Math.round(res.landing * 9));
        this.addBonus(bonus, "Прыжок!");
        this.audio.uiClick();
        if (res.landing > 11) {
          const ldmg = (res.landing - 11) * 1.2 * frag * (1 - protect);
          this.car.damage(ldmg);
          this.shake = Math.min(1, this.shake + 0.5);
          this.audio.thud(0.7);
          this.toast("Жёсткая посадка! Груз пострадал", true);
        }
      }
      if (res.rolled) {
        this.car.damage(35);
        this.shake = 1;
        this.audio.thud(1);
        this.audio.crack();
        this.toast("ПЕРЕВОРОТ! Груз сильно повреждён", true);
      }
    }

    // drift score + trickle bonuses
    if (res.drift > 5 && Math.abs(res.speed) > 8) {
      this.driftScore += res.drift * Math.abs(res.speed) * dt * 0.09;
      this.driftBonusTimer -= dt;
      if (this.driftBonusTimer <= 0) {
        this.driftBonusTimer = 1.6;
        this.addBonus(8, "Дрифт!");
      }
    }

    // engine audio
    const rpm = Math.min(1, Math.abs(res.speed) / spec.topSpeed);
    this.audio.updateEngine(rpm, inp.throttle, Math.min(1, res.drift / 14));

    // order timer / arrival / cargo
    this.timeLeft -= dt;
    const dDest = this.order
      ? Math.hypot(
          this.car.pos.x - this.order.dest.x,
          this.car.pos.z - this.order.dest.z
        )
      : 999;
    if (dDest < 4.2) this.completeOrder(true, "Точка назначения достигнута");
    else if (this.car.cargo <= 0)
      this.completeOrder(false, "Груз разбит вдребезги");
    else if (this.timeLeft <= 0)
      this.completeOrder(false, "Время вышло — клиент ушёл");

    // toast fade
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.style.opacity = "0";
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);

    // HUD @10Hz
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.1;
      this.updateHud();
    }
  }

  private checkRedLight(prevX: number, prevZ: number): void {
    if (!this.order || this.car.isFlipping) return;
    const x = this.car.pos.x;
    const z = this.car.pos.z;
    const spd = Math.abs(this.car.speed);
    for (const l of this.world.lights) {
      const t = l.timer;
      const redX = t >= LIGHT_CYCLE + LIGHT_YELLOW;
      const redZ = t < LIGHT_CYCLE + LIGHT_YELLOW;
      const fined = this.redFinedX.get(l) ?? -1;
      if (fined === l.phaseId) continue;
      const tryCross = (crossedIn: boolean, isRed: boolean) => {
        if (!crossedIn) return;
        if (isRed) {
          this.redFinedX.set(l, l.phaseId);
          this.redLightRuns += 1;
          this.applyFine("Проезд на красный!");
        } else if (
          spd > 12 &&
          this.elapsed - (this.greenCooldown.get(l) ?? -10) > 4
        ) {
          this.greenCooldown.set(l, this.elapsed);
          this.addBonus(25, "На зелёный!");
        }
      };
      if (Math.abs(z - l.cz) < ROAD_W / 2 - 1) {
        tryCross(
          (prevX < l.cx - SD && x >= l.cx - SD) ||
            (prevX > l.cx + SD && x <= l.cx + SD),
          redX
        );
      }
      if (Math.abs(x - l.cx) < ROAD_W / 2 - 1) {
        tryCross(
          (prevZ < l.cz - SD && z >= l.cz - SD) ||
            (prevZ > l.cz + SD && z <= l.cz + SD),
          redZ
        );
      }
    }
  }

  private applyFine(msg: string): void {
    this.orderFines += RED_LIGHT_FINE;
    this.audio.fine();
    this.effects.spawnFlash(this.car.pos.x, this.car.pos.z, 0xff3344);
    this.toast(`${msg} Штраф −₽${RED_LIGHT_FINE}`, true);
    this.shake = Math.min(1, this.shake + 0.25);
  }

  private completeOrder(ok: boolean, reason: string): void {
    if (!this.order) return;
    const o = this.order;
    this.world.hideDestination();
    this.audio.stopMusic();
    this.audio.updateEngine(0, 0, 0);
    const p = this.profile;
    const lines: string[] = [`${reason}.`];
    let total = 0;
    if (ok) {
      const integ = this.car.cargo / 100;
      const pay = Math.round(o.reward * (0.25 + 0.75 * integ));
      const timeBonus = Math.round((this.timeLeft / o.timeLimit) * o.reward * 0.35);
      const tip = Math.round(Math.min(this.driftScore, 4000) / 40);
      total = Math.max(0, pay + timeBonus + tip + this.bonusMoney - this.orderFines);
      lines.push(`Целостность груза: ${Math.round(this.car.cargo)}%`);
      lines.push(`Оплата: ₽${pay}`);
      lines.push(`Бонус за время: ₽${timeBonus}`);
      if (tip > 0) lines.push(`Дрифт-чаевые: ₽${tip}`);
      if (this.bonusMoney > 0)
        lines.push(`<span class="gold">Трюки и бонусы: ₽${this.bonusMoney}</span>`);
      if (this.orderFines > 0)
        lines.push(`<span class="neg">Штрафы за красный: −₽${this.orderFines}</span>`);
      lines.push(`<b class="gold">Итого: ₽${total}</b>`);
      lines.push(
        `Состояние машины: ${Math.round(this.car.hp)}%${
          this.car.hp < 50 ? ' — <span class="neg">надо в гараж</span>' : ""
        }`
      );
      p.money += total;
      p.deliveries += 1;
      p.totalEarn += total;
      p.bestEarn = Math.max(p.bestEarn, total);
      p.driftBest = Math.max(p.driftBest, Math.round(this.driftScore));
      this.audio.success();
    } else {
      const consolation = 40;
      p.money += consolation;
      lines.push(`<span class="neg">${reason}</span>`);
      lines.push(`Утешительные: ₽${consolation}`);
      if (this.orderFines > 0) {
        p.money = Math.max(0, p.money - this.orderFines);
        lines.push(`<span class="neg">Штрафы: −₽${this.orderFines}</span>`);
      }
      this.audio.fail();
    }
    saveProfile(p);
    this.lastResult = { ok, lines };
    this.order = null;
    this.police.stop();
    this.bonusMoney = 0;
    this.showScreen("result");
  }

  private updateHud(): void {
    if (!this.order) return;
    const o = this.order;
    this.hOrder.textContent = `📦 ${CARGO_NAMES[o.id % CARGO_NAMES.length]} · ₽${o.reward}`;
    const t = Math.max(0, this.timeLeft);
    this.hTimer.textContent = `⏱ ${t.toFixed(0)}с`;
    this.hTimer.classList.toggle("low", t < 12);
    const cargo = Math.max(0, this.car.cargo);
    this.hCargoBar.style.transform = `scaleX(${cargo / 100})`;
    this.hCargoBar.classList.toggle("low", cargo < 35);
    this.hCargoText.textContent = `груз ${cargo.toFixed(0)}%`;
    this.hSpeed.innerHTML = `${Math.round(Math.abs(this.car.speed) * 3.2)}<small>км/ч</small>`;
    const speed = Math.abs(this.car.speed);
    this.hMoney.textContent = `₽${this.profile.money}${this.orderFines ? ` (−${this.orderFines})` : ""}`;
    this.hDrift.textContent =
      this.driftScore > 50 && speed > 8
        ? `дрифт +${Math.round(this.driftScore)}`
        : "";
    this.hChase.style.display = this.police.active ? "inline" : "none";
    this.drawMinimap();
    void speed;
  }

  // ================= render =================

  private renderFrame(dt: number): void {
    // camera follow
    const fwd = this.car.forwardVec;
    const portrait = window.innerHeight > window.innerWidth;
    const dist = portrait ? 11.5 : 9;
    const height = portrait ? 5.6 : 4.2;
    const desired = new THREE.Vector3(
      this.car.pos.x - fwd.x * dist,
      height,
      this.car.pos.z - fwd.z * dist
    );
    const k = 1 - Math.exp(-dt * 4.6);
    this.camPos.lerp(desired, k);
    this.camera.position.copy(this.camPos);
    if (this.shake > 0.01) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.5;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.35;
      this.camera.position.z += (Math.random() - 0.5) * this.shake * 0.5;
    }
    const look = new THREE.Vector3(
      this.car.pos.x + fwd.x * 6,
      1.1,
      this.car.pos.z + fwd.z * 6
    );
    this.camera.lookAt(look);
    const speedRatio = Math.min(1, Math.abs(this.car.speed) / this.car.spec.topSpeed);
    const targetFov = 60 + speedRatio * 16 + (portrait ? 6 : 0);
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 5);
    this.camera.updateProjectionMatrix();

    this.effects.update(dt, this.camera.quaternion);
    this.renderer.render(this.scene, this.camera);

    if (!this.readyFlagged) {
      this.readyFlagged = true;
      (window as unknown as { __GAME_READY__: boolean }).__GAME_READY__ = true;
    }
  }

  private resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  dispose(): void {
    this.stop();
    window.removeEventListener("resize", this.resize);
    this.audio.dispose();
    this.input.dispose();
    this.car.dispose();
    this.traffic.dispose();
    this.police.dispose();
    this.effects.dispose();
    this.world.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    this.renderer.dispose();
    this.screenEl.remove();
    this.hudEl.remove();
  }
}
