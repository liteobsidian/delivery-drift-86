import * as THREE from "three";
import {
  CARS,
  tunedSpec,
  UPGRADE_COST,
  UPGRADE_DEFS,
  UPGRADE_MAX,
  RED_LIGHT_FINE,
  ROAD_W,
  LIGHT_CYCLE,
  LIGHT_YELLOW,
  CARGO_NAMES,
  ORDER_TITLES,
  WORLD_MAPS,
  speedKmh,
} from "./config";
import type { ActivityMode, GameScreen, MapId, Order, UpgradeLevels } from "./types";
import { PROFILE_KEY, ProfileStore, type SaveStatus } from "./storage";
import { AudioSystem } from "./audio";
import { Input } from "./input";
import { World } from "./world";
import { Car } from "./car";
import { trafficLanePosition, Traffic } from "./traffic";
import { Police } from "./police";
import { loadGameAssets } from "./assets";
import type { HeroModelKey, LoadedModel } from "./assets";
import { Effects } from "./effects";
import { ACHIEVEMENTS, checkAchievements } from "./achievements";
import { sampleDeliveryDestination } from "./delivery-routing";
import { canUnlockCar, driftMedal, driftMultiplierForSeconds, finalDriftScore, medalRank, modeReward, timeAttackCourse, timeAttackMedal, type TimeAttackCourse } from "./modes";
import { carThumb, createShowroom } from "./showroom";
import {
  careerMedalPoints, completeWeeklyRoute, mapAccessFor, recordDetails, saveRecord,
  utcWeekKey, weeklyRouteIds, weeklyRoutes, type WeeklyRoute,
} from "./retention";

const VERIFICATION = import.meta.env.DEV || import.meta.env.MODE === "verification";
const WORLD_CACHE_LIMIT = 2;
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
  private showroom = createShowroom();
  private heroModels: Partial<Record<HeroModelKey, LoadedModel>> = {};

  private heroFor(car: { glb?: string }): LoadedModel | undefined {
    return car.glb ? this.heroModels[car.glb as HeroModelKey] : undefined;
  }
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private spawnFrustum = new THREE.Frustum();
  private spawnViewProjection = new THREE.Matrix4();
  private spawnSphere = new THREE.Sphere(new THREE.Vector3(), 3);
  private spawnCameraFrame = -1;
  /** verification-only free camera override [px,py,pz, tx,ty,tz] */
  private freeCam: number[] | null = null;
  private clock = new THREE.Clock();
  private raf = 0;
  private acc = 0;
  private running = false;
  private disposed = false;
  private tickCount = 0;

  private profileStore = new ProfileStore();
  profile = this.profileStore.profile;
  private saveStatus: SaveStatus = "saved";
  audio = new AudioSystem();
  private input!: Input;
  private worldCache = new Map<MapId, World>();
  world = new World(this.profile.mapId);
  car: Car;
  traffic: Traffic;
  private midriseAsset: { root: THREE.Group; size: THREE.Vector3 } | null = null;
  effects = new Effects();

  screen: GameScreen = "title";
  order: Order | null = null;
  mode: ActivityMode = "delivery";
  private pendingMode: ActivityMode = "delivery";
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
  private driftBankedScore = 0;
  private driftChainScore = 0;
  private driftChainTime = 0;
  private driftIdleTime = 0;
  private driftMultiplier = 1;
  private driftCrashThisStep = false;
  private timeAttackCourse: TimeAttackCourse | null = null;
  private timeAttackCheckpointIndex = 0;
  private debris: THREE.Mesh[] = [];
  private shake = 0;
  private wreckTimer = -1; // >=0 while the burning wreck is counting down to order fail
  assetsReady = false; // downloaded models swapped in
  private camPos = new THREE.Vector3(0, 5, 55);
  private toastTimer = 0;
  private hudTimer = 0;
  nitroFuel = 100;
  private hNitro!: HTMLElement;
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
  private hCargo!: HTMLElement;
  private hSpeed!: HTMLElement;
  private hMoney!: HTMLElement;
  private hDrift!: HTMLElement;
  private hChase!: HTMLElement;
  private popups!: HTMLElement;
  private tutorialEl!: HTMLDialogElement;
  private saveNotice: HTMLElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: VERIFICATION,
      powerPreference: "high-performance",
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.48;
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1600);
    this.resize();
    window.addEventListener("resize", this.resize);

    // --- scene lighting: night city ---
    this.scene.background = new THREE.Color(0x0b1026);
    this.scene.fog = new THREE.FogExp2(0x0b1026, 0.0028);
    const hemi = new THREE.HemisphereLight(0x7385bd, 0x302b3d, 1.5);
    this.scene.add(hemi);
    const moon = new THREE.DirectionalLight(0xb4c8ff, 1.5);
    moon.position.set(-120, 200, -80);
    this.scene.add(moon);
    const pink = new THREE.DirectionalLight(0xff5cae, 0.32);
    pink.position.set(100, 60, 120);
    this.scene.add(pink);

    this.scene.add(this.world.group);
    this.worldCache.set(this.world.mapId, this.world);
    this.car = new Car(tunedSpec(this.currentCarSpec(), this.currentUpgrades()));
    this.car.onSmoke = (x, z, strong) => this.effects.spawnSmoke(x, z, strong);
    this.scene.add(this.car.group);
    this.traffic = new Traffic(this.world, this.car.pos);
    this.traffic.onNearMiss = () => {
      if (this.screen !== "playing") return;
      if (this.mode === "delivery") {
        this.addBonus(60, "Впритирку!");
        this.audio.uiClick();
      }
    };
    this.scene.add(this.traffic.group);
    this.scene.add(this.police.group);
    this.scene.add(this.effects.group);
    // free downloaded models replace placeholders when they finish loading
    this.assetsReady = false;
    loadGameAssets(this.currentCarSpec().glb as HeroModelKey | undefined, (key, model) => {
      if (this.disposed) return;
      this.heroModels[key] = model;
      if (this.currentCarSpec().glb === key) this.applyCarSpec();
    })
      .then((assets) => {
        if (this.disposed) return;
        this.traffic.setCarModels(assets.traffic.map((m) => m.root));
        this.police.setModel(assets.police.root, assets.police.size.y + 0.05);
        this.midriseAsset = { root: assets.midrise.root, size: assets.midrise.size };
        for (const world of this.worldCache.values()) {
          world.setHeroBuildings(assets.midrise.root, assets.midrise.size);
        }
        this.heroModels = assets.hero;
        this.applyCarSpec(); // swap current car to its detailed body if available
        this.assetsReady = true;
      })
      .catch((err) => console.warn("asset load failed, placeholders stay:", err));
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
    this.car.onPartLost = (x, z, kind) => {
      const dark = new THREE.MeshStandardMaterial({ color: 0x17191f });
      const part =
        kind === "spoiler"
          ? new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.07, 0.4), dark)
          : new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.2, 0.34), dark);
      part.position.set(x, kind === "spoiler" ? 0.5 : 0.36, z);
      part.rotation.y = Math.random() * Math.PI;
      this.scene.add(part);
      this.debris.push(part);
      this.toast(kind === "spoiler" ? "Отвалился спойлер!" : "Отвалился бампер!", true);
      this.audio.thud(0.5);
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
    blob.name = "blob-shadow";
    this.car.group.add(blob);

    // --- UI ---
    this.overlay = document.getElementById("ui-overlay")!;
    this.screenEl = el("div", "screen-wrap");
    this.overlay.appendChild(this.screenEl);
    this.hudEl = el("div", "hud");
    this.hudEl.style.display = "none";
    this.overlay.appendChild(this.hudEl);
    this.saveNotice = el("section", "save-notice");
    this.saveNotice.hidden = true;
    this.saveNotice.setAttribute("aria-live", "polite");
    this.overlay.appendChild(this.saveNotice);
    window.addEventListener("storage", this.storageChanged);
    document.addEventListener("visibilitychange", this.visibilityChanged);


    this.input = new Input();
    this.buildHud();
    this.input.onPause = () => this.togglePause();
    this.input.onMute = () => this.toggleMute();
    this.input.onConfirm = () => {
      if (this.tutorialEl.open || this.saveStatus === "conflict") return;
      if (this.screen === "title" && !this.screenEl.querySelector(".weekly-event-shade")) this.showScreen("play");
      else if (this.screen === "result") {
        if (this.lastResult.mode) this.startMode(this.lastResult.mode);
        else this.gotoOrders();
      }
    };
    this.audio.muted = this.profile.muted;
    this.audio.volume = this.profile.volume;

    this.showScreen("title");
    if (!this.profileStore.readable) this.showSaveStatus("unavailable");
    if (VERIFICATION) {
      (window as unknown as { __gameProbe: () => { x: number; y: number; z: number } }).__gameProbe =
        () => ({ x: this.car.pos.x, y: this.car.pos.y, z: this.car.pos.z });
      // verification hook (not user-facing)
      (window as unknown as { __gameDebug: unknown }).__gameDebug = {
        mapId: () => this.world.mapId,
        roadProbe: (x: number, z: number) => ({
          onRoad: this.world.isOnRoad(x, z),
          nearestRoadDist: this.world.nearestRoadDist(x, z),
          bounds: { ...this.world.layout.bounds },
        }),
        layoutSnapshot: () => ({
          roads: this.world.layout.roads.map((road) => ({ id: road.id, points: road.points.map(({ x, z }) => ({ x, z })) })),
          signals: this.world.layout.signalJunctions.map(({ x, z }) => ({ x, z })),
        }),
        resolveBoundary: (x: number, z: number) => {
          const pos = new THREE.Vector3(x, 0, z);
          this.world.collideBuildings(pos, 1, new THREE.Vector3());
          return { x: pos.x, z: pos.z };
        },
        mode: () => this.mode,
        modeState: () => ({
          score: this.driftScore,
          driftMultiplier: this.driftMultiplier,
          driftChainScore: this.driftChainScore,
          checkpoint: this.timeAttackCheckpointIndex,
          course: this.timeAttackCourse,
          elapsed: this.order ? this.order.timeLimit - this.timeLeft : 0,
        }),
        profile: () => ({
          money: this.profile.money,
          deliveries: this.profile.deliveries,
          totalEarn: this.profile.totalEarn,
          bestEarn: this.profile.bestEarn,
          unlockedAch: [...this.profile.unlockedAch],
          timeAttackMedal: this.profile.stats.timeAttackMedal,
        }),
        seedDriftChainForTest: (banked: number, active: number) => {
          this.driftBankedScore = banked;
          this.driftChainScore = active;
          this.driftChainTime = active > 0 ? 2 : 0;
          this.driftMultiplier = active > 0 ? 2 : 1;
          this.driftScore = banked + active;
        },
        setElapsedForTest: (elapsed: number) => {
          if (this.order) this.timeLeft = Math.max(0, this.order.timeLimit - elapsed);
        },
        nitroFuel: () => this.nitroFuel,
        cityBuildingCount: () => this.world.buildingCount(),
        finishDelivery: () => { if (this.mode === "delivery" && this.order) this.completeOrder(true, "Тестовая доставка"); },
        exitMode: () => this.showScreen("title"),
        weekly: () => weeklyRoutes(new Date(), this.world.mapId).map((route) => route.id),
        weeklyRoutes: () => weeklyRoutes(new Date(), this.world.mapId),
        weekKey: (date?: string) => utcWeekKey(date ? new Date(date) : new Date()),
        finishWeekly: () => { if (this.order?.weekly) this.completeOrder(true, "Тестовый финиш"); },
        weeklyProgress: () => {
          const week = utcWeekKey();
          return { week, completed: this.profile.weeklyCompletions[week] ?? [] };
        },
        mapAccessFor,
        setDeliveriesForTest: (deliveries: number) => { this.profile.deliveries = deliveries; this.persistProfile(); },
        weeklyEventSeen: (date?: string) => this.profile.weeklyEventWeek === utcWeekKey(date ? new Date(date) : new Date()),
        markWeeklyEventSeen: (date?: string) => {
          this.profile.weeklyEventWeek = utcWeekKey(date ? new Date(date) : new Date());
          this.persistProfile();
        },
        worldCacheSize: () => this.worldCache.size,
        setCargoForTest: (cargo: number) => { this.car.cargo = cargo; },
        portVisuals: () => {
          if (this.world.mapId !== "yokohama") return null;
          const port = this.world.group.getObjectByName("port-warehouses-and-containers");
          const water = this.world.group.getObjectByName("harbor-water");
          const cranes = this.world.group.getObjectByName("port-gantry-cranes");
          const stats = port?.userData.portStats ?? {};
          return {
            interiorWater: water?.userData.interiorWater ?? 0,
            warehouses: stats.warehouses ?? 0,
            containerStacks: stats.containerStacks ?? 0,
            containerInstances: stats.containerInstances ?? 0,
            gantryCranes: cranes?.userData.gantryCranes ?? 0,
            piers: stats.piers ?? 0,
            cargoShips: stats.cargoShips ?? 0,
            tankFarms: stats.tankFarms ?? 0,
          };
        },
        scene: this.scene,
        teleport: (x: number, z: number, heading?: number) => {
          this.car.pos.set(x, 0, z);
          this.car.vel.set(0, 0, 0);
          if (heading !== undefined) this.car.heading = heading;
        },
        cargo: () => this.car.cargo,
        screen: () => this.screen,
        orderDest: () =>
          this.order ? { x: this.order.dest.x, z: this.order.dest.z } : null,
        destinationVisible: () => this.world.group.getObjectByName("destination-marker")?.visible ?? false,
        // feature test hooks (verification only)
        damageTest: () => {
          this.car.damageCar(75);
          this.car.loseWheel();
        },
        policeTest: () => {
          this.police.start(this.car.pos.x + 8, this.car.pos.z + 14);
        },
        hp: () => this.car.hp,
        ticks: () => this.tickCount,
        keys: () => [...this.input.keys],
        order: () => (this.order ? { x: this.order.dest.x, z: this.order.dest.z } : null),
        policeActive: () => this.police.active,
        bonus: () => this.bonusMoney,
        trafficHits: () => this.trafficHits,
        wrecked: () => this.car.wrecked,
        wreckTimer: () => this.wreckTimer,
        partsLost: () => ({
          spoiler: this.car.spoilerLost,
          bumper: this.car.bumperLost,
          wheel: this.car.wheelLost,
        }),
        assetsReady: () => this.assetsReady,
        heroCount: () => this.world.heroCount(),
        trafficPos: () => this.traffic.debugPositions(),
        ramps: () => this.world.ramps.map((r) => ({ x: r.x, z: r.z, dx: r.dx, dz: r.dz })),
        air: () => ({ airY: this.car.airY, airV: this.car.airV }),
        freeCam: (a: number[] | null) => {
          this.freeCam = a;
        },
        lightState: () =>
          this.world.lights.map((l) => ({
            t: Math.round(l.timer * 100) / 100,
            xLit: l.lampsX.findIndex((m) => m.emissiveIntensity > 2),
            zLit: l.lampsZ.findIndex((m) => m.emissiveIntensity > 2),
          })),
        speed: () => Math.hypot(this.car.vel.x, this.car.vel.z),
        tris: () => {
          let n = 0;
          this.scene.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh || !mesh.geometry) return;
            const geo = mesh.geometry;
            n += (geo.index ? geo.index.count : geo.attributes.position?.count ?? 0) / 3;
          });
          return Math.round(n);
        },
      };
    }
  }

  // ================= screens =================

  private clearScreen(): void {
    this.screenEl.innerHTML = "";
    this.screenEl.style.display = "none";
  }

  showScreen(s: GameScreen): void {
    this.screen = s;
    if (s !== "playing" && s !== "paused") this.tutorialEl.close();
    this.hudEl.style.display = s === "playing" ? "block" : "none";
    this.input.setDriving(s === "playing" && !this.tutorialEl.open && this.saveStatus !== "conflict");
    if (s === "title") this.renderTitle();
    else if (s === "play") this.renderPlay();
    else if (s === "tracks") this.renderTracks();
    else if (s === "profile") this.renderProfile();
    else if (s === "garage") this.renderGarage();
    else if (s === "cars") this.renderCars();
    else if (s === "orders") this.renderOrders();
    else if (s === "paused") this.renderPaused();
    else if (s === "result") this.renderResult();
    else if (s === "settings") this.renderSettings();
    else if (s === "achievements") this.renderAchievements();
    else this.clearScreen();
  }

  private persistProfile(): void {
    this.showSaveStatus(this.profileStore.save());
  }

  private showSaveStatus(status: SaveStatus): void {
    if (status === this.saveStatus) return;
    this.saveStatus = status;
    this.saveNotice.hidden = status === "saved";
    this.saveNotice.classList.toggle("save-conflict", status === "conflict");
    this.saveNotice.replaceChildren();
    if (status === "saved") return;

    const conflict = status === "conflict";
    this.saveNotice.append(
      el("span", "", conflict
        ? "Сохранение изменилось в другой вкладке. Загрузи последнюю версию, чтобы продолжить."
        : "Прогресс пока не сохранился. Разреши сохранение данных сайта или освободи место."),
      el("button", "btn small", conflict ? "Загрузить сохранение" : "Повторить сохранение"),
    );
    const button = this.saveNotice.querySelector("button")!;
    button.addEventListener("click", () => {
      if (conflict) window.location.reload();
      else this.persistProfile();
    });
    if (conflict) {
      this.tutorialEl.close();
      this.input.setDriving(false);
      this.audio.stopMusic();
      this.screenEl.inert = true;
      this.hudEl.inert = true;
      button.focus();
    }
  }

  private storageChanged = (event: StorageEvent): void => {
    if ((event.key === PROFILE_KEY || event.key === null) && this.profileStore.changedElsewhere()) {
      this.showSaveStatus("conflict");
    }
  };

  private visibilityChanged = (): void => {
    if (document.hidden && this.screen === "playing" && !this.tutorialEl.open) this.togglePause();
  };

  private renderTitle(): void {
    const p = this.profile;
    this.showroom.setCar(this.currentCarSpec(), this.currentUpgrades());
    const mapName = WORLD_MAPS.find((map) => map.id === p.mapId)?.name ?? "Неоновый Токио";
    const now = new Date();
    const week = utcWeekKey(now);
    const completed = p.weeklyCompletions[week] ?? [];
    const featuredWeekly = weeklyRoutes(now, p.mapId).find((route) => !completed.includes(route.id));
    const showWeeklyEvent = !!featuredWeekly && p.weeklyEventWeek !== week;
    const dismissWeeklyEvent = () => {
      p.weeklyEventWeek = week;
      this.persistProfile();
    };
    this.screenEl.style.display = "flex";
    this.screenEl.innerHTML = `
      <div class="title-box home-box">
        <div class="logo-sub">НОЧНОЙ КУРЬЕР · ${mapName.toUpperCase()}</div>
        <h1 class="logo">DELIVERY<span> DRIFT</span> <em>86</em></h1>
        <p class="tagline">Доставляй быстро. Дрифти жёстко. Не разбей груз.</p>
        <div class="home-place"><span class="home-place-pin">◉</span><span>${mapName}</span><i>·</i><span>${this.currentCarSpec().name.replace("Toyota ", "")}</span></div>
        <div class="home-actions">
          <button class="btn primary home-play" data-a="play">ИГРАТЬ <span>→</span></button>
          <div class="home-links">
            <button class="btn" data-a="cars">МАШИНЫ</button>
            <button class="btn" data-a="garage">ГАРАЖ</button>
            <button class="btn" data-a="profile">ПРОФИЛЬ</button>
          </div>
        </div>
        <div class="home-career"><span>₽ ${p.money}</span><span>${p.deliveries} доставок</span><span>${p.unlockedAch.length}/${ACHIEVEMENTS.length} достижений</span></div>
        <p class="fine-print">прогресс хранится в этом браузере (localStorage)</p>
      </div>
      ${showWeeklyEvent && featuredWeekly ? `<div class="weekly-event-shade"><section class="weekly-event-card" role="dialog" aria-modal="true" aria-labelledby="weekly-event-title">
        <div class="journey-eyebrow">СОБЫТИЕ НЕДЕЛИ · UTC ${week}</div>
        <h2 id="weekly-event-title">${featuredWeekly.title}</h2>
        <p>Особый маршрут недели уже ждёт. Успей доехать за ${Math.round(featuredWeekly.timeLimit)} секунд.</p>
        <div class="weekly-event-actions"><button class="btn" data-a="event-dismiss">ПОЗЖЕ</button><button class="btn primary" data-a="event-start">НАЧАТЬ ЗАЕЗД →</button></div>
      </section></div>` : ""}`;
    if (showWeeklyEvent) {
      this.screenEl.querySelector<HTMLElement>(".home-box")!.inert = true;
      this.screenEl.querySelector<HTMLButtonElement>('[data-a="event-dismiss"]')?.focus();
    }
    this.bindScreen({
      play: () => this.showScreen("play"),
      cars: () => this.showScreen("cars"),
      garage: () => this.showScreen("garage"),
      profile: () => this.showScreen("profile"),
      "event-dismiss": () => { dismissWeeklyEvent(); this.showScreen("title"); },
      "event-start": () => {
        dismissWeeklyEvent();
        if (featuredWeekly) this.startWeeklyRoute(featuredWeekly);
      },
    });
  }

  private renderPlay(): void {
    this.screenEl.style.display = "flex";
    this.screenEl.innerHTML = `<div class="panel journey-panel">
      <div class="journey-eyebrow">НОЧНОЙ КУРЬЕР · ${WORLD_MAPS.find((map) => map.id === this.profile.mapId)?.name}</div>
      <h2>ВЫБЕРИ ЗАЕЗД</h2>
      <p class="dim">Сначала выбери, как хочешь провести эту гонку.</p>
      <div class="activity-picker journey-activities">
        <button class="activity-card" data-a="activity:delivery"><b>ДОСТАВКА</b><span>Бесконечные заказы, деньги и развитие гаража</span><i>Выбрать →</i></button>
        <button class="activity-card" data-a="activity:drift-trial"><b>DRIFT TRIAL</b><span>60 секунд · комбо до ×5 · ₽ за очки · Silvia за серебро</span><i>Выбрать →</i></button>
        <button class="activity-card" data-a="activity:time-attack"><b>TIME ATTACK</b><span>Фиксированный круг с контрольными точками · медали и Evo за золото</span><i>Выбрать →</i></button>
      </div>
      <button class="btn" data-a="back">← НАЗАД</button>
    </div>`;
    this.bindScreen({ back: () => this.showScreen("title") });
  }

  private renderTracks(): void {
    const medalPoints = careerMedalPoints(this.profile.records);
    const cards = WORLD_MAPS.map((map) => {
      const access = mapAccessFor(map.id, this.profile.deliveries, this.profile.mapId, medalPoints);
      const locked = !access.unlocked;
      const progress = Math.min(map.unlockDeliveries, this.profile.deliveries);
      return `<button class="map-card track-card ${this.profile.mapId === map.id ? "selected" : ""} ${locked ? "locked" : ""}" data-a="map:${map.id}" ${locked ? "disabled" : ""} aria-pressed="${this.profile.mapId === map.id}">
        <span class="track-art track-${map.id}"><i>${map.badge}</i>${locked ? "<b class='track-lock'>🔒</b>" : ""}</span>
        <b>${map.name}</b>
        <span>${locked ? "Открывается за доставки или медали" : map.description}</span>
        ${locked ? `<span class="track-progress">${progress} / ${map.unlockDeliveries} доставок · ${medalPoints} / ${map.unlockMedalPoints} очков медалей</span>` : `<span class="track-enter">${this.profile.mapId === map.id ? "ТЕКУЩАЯ ЛОКАЦИЯ" : "ВЫБРАТЬ МЕСТО"}</span>`}
      </button>`;
    }).join("");
    const modeName = this.pendingMode === "delivery" ? "Доставка" : this.pendingMode === "drift-trial" ? "Drift Trial" : "Time Attack";
    this.screenEl.style.display = "flex";
    this.screenEl.innerHTML = `<div class="panel journey-panel tracks-panel">
      <div class="journey-eyebrow">${modeName.toUpperCase()}</div>
      <h2>ВЫБЕРИ МЕСТО</h2>
      <p class="dim">За лучшую медаль в каждом режиме на каждой карте начисляются очки. Бронза — 1, серебро — 2, золото — 3.</p>
      <div class="map-picker track-picker">${cards}</div>
      <button class="btn" data-a="back">← К РЕЖИМАМ</button>
    </div>`;
    this.bindScreen({ back: () => this.showScreen("play") });
  }

  private renderCars(): void {
    const p = this.profile;
    const carCards = CARS.map((c) => {
      const owned = p.ownedCars.includes(c.id);
      const isCur = p.carId === c.id;
      const need = c.unlockDeliveries ?? 0;
      const locked = !canUnlockCar(c, p);
      const achievement = c.unlockAchievement ? ACHIEVEMENTS.find((item) => item.id === c.unlockAchievement) : undefined;
      const unlockHint = c.unlockAchievement && achievement
        ? `${need} доставок или ${achievement.tier === "silver" ? "серебро" : achievement.tier === "gold" ? "золото" : "медаль"} «${achievement.name}»`
        : `${need} доставок`;
      let btn;
      if (isCur) btn = `<button class="btn small" disabled>ТЕКУЩАЯ</button>`;
      else if (owned) btn = `<button class="btn small" data-a="select:${c.id}">ВЫБРАТЬ</button>`;
      else if (locked)
        btn = `<button class="btn small" disabled>🔒 ${p.deliveries}/${need} · ${unlockHint}</button>`;
      else
        btn = `<button class="btn small ${p.money >= c.price ? "primary" : ""}" data-a="buy:${c.id}">КУПИТЬ ₽${c.price}</button>`;
      return `<div class="car-card ${isCur ? "current" : ""}">
        <img class="car-img" src="${carThumb(c, undefined, this.heroFor(c))}" alt="${c.name}">
        <div class="car-name">${c.name}</div>
        <div class="car-stats">скорость ${speedKmh(c.topSpeed)} км/ч · разгон ${c.accel} · сцепление ${c.grip}</div>
        ${btn}
      </div>`;
    }).join("");

    this.screenEl.style.display = "flex";
    this.screenEl.innerHTML = `
      <div class="panel cars">
        <h2>МАШИНЫ</h2>
        <div class="money-line">Баланс: <b>₽${p.money}</b> · доставок: ${p.deliveries}</div>
        <div class="car-cards">${carCards}</div>
        <button class="btn" data-a="back">← НАЗАД</button>
      </div>`;
    this.bindScreen({ back: () => this.showScreen("title") });
  }

  private renderGarage(): void {
    const p = this.profile;
    const cur = this.currentCarSpec();
    const up = this.currentUpgrades();
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
        <div class="garage-car-line">Сейчас: <b>${cur.name}</b>
          <button class="btn small" data-a="cars">СМЕНИТЬ МАШИНУ</button>
        </div>
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
      cars: () => this.showScreen("cars"),
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
    this.persistProfile();
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
        <button class="btn" data-a="retry">${this.mode === "delivery" ? "ЗАНОВО ЗАКАЗ" : "ЗАНОВО ЗАЕЗД"}</button>
        <button class="btn" data-a="help">❓ КАК ИГРАТЬ</button>
        <button class="btn" data-a="settings">⚙ НАСТРОЙКИ</button>
        <button class="btn" data-a="sound">${this.profile.muted ? "🔇 ВКЛ ЗВУК" : "🔊 ВЫКЛ ЗВУК"}</button>
        <button class="btn" data-a="quit">В МЕНЮ</button>
      </div>`;
    this.bindScreen({
      resume: () => this.togglePause(),
      retry: () => {
        if (this.mode === "delivery" && this.order) this.startOrder(this.order);
        else if (this.mode !== "delivery") this.startMode(this.mode);
      },
      help: () => this.showTutorial(),
      settings: () => {
        this.settingsFrom = "paused";
        this.showScreen("settings");
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

  private settingsFrom: GameScreen = "title";

  private renderSettings(): void {
    const p = this.profile;
    this.screenEl.style.display = "flex";
    this.screenEl.innerHTML = `
      <div class="panel settings">
        <h2>НАСТРОЙКИ</h2>
        <div class="set-row">
          <div class="set-info"><b>Громкость звука</b><span id="vol-label">${Math.round(p.volume * 100)}%</span></div>
          <input type="range" id="vol-slider" min="0" max="100" value="${Math.round(p.volume * 100)}">
        </div>
        <div class="set-row">
          <div class="set-info"><b>Звук</b><span>${p.muted ? "выключен" : "включён"}</span></div>
          <button class="btn small" data-a="sound">${p.muted ? "🔇 ВКЛ" : "🔊 ВЫКЛ"}</button>
        </div>
        <button class="btn" data-a="back">← НАЗАД</button>
      </div>`;
    this.bindScreen({
      back: () => this.showScreen(this.settingsFrom === "paused" ? "paused" : "title"),
      sound: () => {
        this.toggleMute();
        this.renderSettings();
      },
    });
    const slider = this.screenEl.querySelector<HTMLInputElement>("#vol-slider");
    slider?.addEventListener("input", () => {
      const v = Number(slider.value) / 100;
      this.profile.volume = v;
      this.audio.setVolume(v);
      const label = this.screenEl.querySelector("#vol-label");
      if (label) label.textContent = `${slider.value}%`;
      if (this.profile.muted && v > 0) {
        this.profile.muted = false;
        this.audio.setMuted(false);
      }
      this.persistProfile();
    });
  }

  private renderAchievements(): void {
    const p = this.profile;
    const rows = ACHIEVEMENTS.map((a) => {
      const got = p.unlockedAch.includes(a.id);
      const prog = a.progress(p);
      const tierLabel = a.tier === "bronze" ? "БРОНЗА" : a.tier === "silver" ? "СЕРЕБРО" : a.tier === "gold" ? "ЗОЛОТО" : "";
      return `<div class="ach-row ${got ? "got" : ""} ${a.tier ? `tier-${a.tier}` : ""}">
        <div class="ach-ico ${a.tier ? `tier-${a.tier}` : ""}">${got ? a.icon : "🔒"}</div>
        <div class="ach-info"><div class="ach-title"><b>${a.name}</b>${tierLabel ? `<small class="ach-tier ${a.tier}">${tierLabel}</small>` : ""}</div><span>${a.desc}</span></div>
        <div class="ach-prog">${prog ?? ""}</div>
      </div>`;
    }).join("");
    this.screenEl.style.display = "flex";
    this.screenEl.innerHTML = `
      <div class="panel achievements">
        <h2>АЧИВКИ</h2>
        <div class="money-line">Открыто: <b class="gold">${p.unlockedAch.length}/${ACHIEVEMENTS.length}</b></div>
        <div class="ach-list">${rows}</div>
        <button class="btn" data-a="back">← НАЗАД</button>
      </div>`;
    this.bindScreen({ back: () => this.showScreen("profile") });
  }

  private renderProfile(): void {
    const records = this.profile.records;
    const recordRows = Object.keys(records).sort().flatMap((key) => {
      const entry = recordDetails(key);
      if (!entry) return [];
      const { mapId, mode, car } = entry;
      const mapName = WORLD_MAPS.find((item) => item.id === mapId)!.name;
      const modeName = mode === "drift-trial" ? "Drift Trial" : mode === "time-attack" ? "Time Attack" : "Доставка";
      const value = records[key];
      const rounded = Math.round(value).toLocaleString("ru-RU");
      const metric = mode === "time-attack" ? `${value.toFixed(1)} с` : mode === "delivery" ? `₽${rounded}` : `${rounded} очк.`;
      return [`<div class="record-row"><b>${modeName}</b><span>${mapName} · ${car.name}</span><strong>${metric}</strong></div>`];
    }).join("") || `<p class="dim">Лучший результат появится здесь после первого завершённого заезда.</p>`;
    const now = new Date();
    const week = utcWeekKey(now);
    const routes = weeklyRoutes(now, this.world.mapId);
    const completed = this.profile.weeklyCompletions[week] ?? [];
    const routeRows = routes.map((route, i) => {
      const done = completed.includes(route.id);
      return `<div class="weekly-row ${done ? "done" : ""}">
        <div><b>${route.title}</b><span>${route.timeLimit} сек · ${Math.round(route.distance)} м${done ? " · уже пройден" : ""}</span></div>
        <button class="btn small ${done ? "" : "primary"}" data-a="weekly:${i}">${done ? "ПОВТОРИТЬ" : "СТАРТ"}</button>
      </div>`;
    }).join("");
    this.screenEl.style.display = "flex";
    this.screenEl.innerHTML = `<div class="panel records-panel">
      <div class="journey-eyebrow">ПРОФИЛЬ · ${this.currentCarSpec().name.replace("Toyota ", "")}</div>
      <h2>ЛИЧНЫЕ РЕКОРДЫ</h2>
      <p class="dim">Лучшие результаты по карте, режиму и машине · неделя UTC ${week}</p>
      <div class="record-list">${recordRows}</div>
      <h2>НЕДЕЛЬНЫЕ МАРШРУТЫ</h2>
      <p class="dim">Новый набор каждый понедельник по UTC · обычные доставки доступны без ограничений</p>
      <div class="weekly-list">${routeRows}</div>
      <button class="btn" data-a="achievements">ДОСТИЖЕНИЯ ${this.profile.unlockedAch.length}/${ACHIEVEMENTS.length}</button>
      <button class="btn" data-a="back">← В МЕНЮ</button>
    </div>`;
    this.bindScreen({
      back: () => this.showScreen("title"),
      achievements: () => this.showScreen("achievements"),
      ...Object.fromEntries(routes.map((route, i) => [`weekly:${i}`, () => this.startWeeklyRoute(route)])),
    });
  }

  private startWeeklyRoute(route: WeeklyRoute): void {
    const { distance } = route;
    this.startOrder({
      id: this.orderId++,
      title: route.title,
      dest: route.dest,
      reward: Math.round(220 + distance * 1.2),
      timeLimit: route.timeLimit,
      fragility: 1,
      distance,
      weekly: { id: route.id, week: route.week },
    });
  }

  private lastResult: { ok: boolean; lines: string[]; mode?: "drift-trial" | "time-attack"; title?: string } = { ok: false, lines: [] };

  private renderResult(): void {
    const r = this.lastResult;
    this.screenEl.style.display = "flex";
    this.screenEl.innerHTML = `
      <div class="panel result ${r.ok ? "ok" : "bad"}">
        <h2>${r.title ?? (r.ok ? "ДОСТАВЛЕНО!" : "ЗАКАЗ ПРОВАЛЕН")}</h2>
        <div class="result-lines">${r.lines.map((l) => `<div>${l}</div>`).join("")}</div>
        ${r.mode ? `<button class="btn primary" data-a="replay">ПОВТОРИТЬ ЗАЕЗД</button>` : `<button class="btn primary" data-a="more">ЕЩЁ ЗАКАЗ <kbd>ПРОБЕЛ</kbd></button>`}
        <button class="btn" data-a="garage">В ГАРАЖ</button>
        <button class="btn" data-a="menu">В МЕНЮ</button>
      </div>`;
    this.bindScreen({
      more: () => this.gotoOrders(),
      replay: () => this.lastResult.mode && this.startMode(this.lastResult.mode),
      garage: () => this.showScreen("garage"),
      menu: () => this.showScreen("title"),
    });
  }

  private bindScreen(actions: Record<string, () => void>): void {
    this.screenEl.querySelectorAll("[data-a]").forEach((n) => {
      n.addEventListener("click", (e) => {
        e.preventDefault();
        if (this.saveStatus === "conflict") return;
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
          this.buyUpgrade(arg as keyof UpgradeLevels);
          return;
        }
        if (act === "map" && arg && WORLD_MAPS.some((map) => map.id === arg)) {
          if (this.selectMap(arg as MapId)) {
            if (this.pendingMode === "delivery") this.quickStart();
            else this.startMode(this.pendingMode);
          }
          return;
        }
        if (act === "activity" && arg && (arg === "delivery" || arg === "drift-trial" || arg === "time-attack")) {
          this.pendingMode = arg;
          this.showScreen("tracks");
          return;
        }
        if (act === "take" && arg !== undefined) {
          this.startOrder(this.orders[Number(arg)]);
          return;
        }
        actions[a]?.();
      });
    });
  }

  private selectMap(mapId: MapId): boolean {
    const points = careerMedalPoints(this.profile.records);
    if (!mapAccessFor(mapId, this.profile.deliveries, this.profile.mapId, points).unlocked) return false;
    if (this.world.mapId !== mapId) {
      let nextWorld = this.worldCache.get(mapId);
      if (!nextWorld) {
        nextWorld = new World(mapId);
        if (this.midriseAsset) nextWorld.setHeroBuildings(this.midriseAsset.root, this.midriseAsset.size);
      }
      this.scene.remove(this.world.group);
      this.worldCache.delete(mapId);
      this.worldCache.set(mapId, nextWorld);
      if (this.worldCache.size > WORLD_CACHE_LIMIT) {
        const oldest = this.worldCache.keys().next().value!;
        this.worldCache.get(oldest)!.dispose();
        this.worldCache.delete(oldest);
      }
      this.world = nextWorld;
      this.scene.add(this.world.group);
      this.orders = [];
      this.redFinedX.clear();
      this.greenCooldown.clear();
      this.world.hideDestination();
      this.car.pos.set(0, 0, 0);
      this.car.vel.set(0, 0, 0);
      this.car.heading = Math.PI;
      this.traffic.setWorld(this.world, this.car.pos);
      this.buildMinimapBase();
      this.police.stop();
      this.profile.mapId = mapId;
      this.persistProfile();
    }
    return true;
  }

  // ================= profile / economy =================

  private currentCarSpec() {
    return CARS.find((c) => c.id === this.profile.carId) ?? CARS[0];
  }

  private currentUpgrades() {
    // create + persist the per-car entry: returning a throwaway object
    // here means buyUpgrade writes into the void (money gone, level lost)
    const id = this.profile.carId;
    if (!this.profile.upgrades[id]) {
      this.profile.upgrades[id] = {
        engine: 0,
        tires: 0,
        suspension: 0,
        turbo: 0,
      };
    }
    return this.profile.upgrades[id];
  }

  private buyCar(id: string): void {
    const car = CARS.find((c) => c.id === id);
    if (!car || this.profile.ownedCars.includes(id)) return;
    if (!canUnlockCar(car, this.profile)) return;
    if (this.profile.money < car.price) return;
    this.profile.money -= car.price;
    this.profile.ownedCars.push(id);
    this.profile.carId = id;
    this.applyCarSpec();
    this.grantAchievements(false);
    this.persistProfile();
    this.audio.cash();
    this.showScreen(this.screen);
  }

  private selectCar(id: string): void {
    if (!this.profile.ownedCars.includes(id)) return;
    this.profile.carId = id;
    this.applyCarSpec();
    this.persistProfile();
    this.showScreen(this.screen);
  }

  private buyUpgrade(key: keyof UpgradeLevels): void {
    const up = this.currentUpgrades();
    const lvl = up[key];
    if (lvl >= UPGRADE_MAX) return;
    const cost = UPGRADE_COST[lvl];
    if (this.profile.money < cost) return;
    this.profile.money -= cost;
    up[key] = lvl + 1;
    this.applyCarSpec();
    this.grantAchievements(false);
    this.persistProfile();
    this.audio.cash();
    this.renderGarage();
  }

  private applyCarSpec(): void {
    const up = this.currentUpgrades();
    const hero = this.heroFor(this.currentCarSpec());
    this.car.setSpec(tunedSpec(this.currentCarSpec(), up));
    this.car.setHeroModel(hero ?? null);
    this.car.setUpgrades(up);
    // title/garage background shows the current car
    this.showroom.setCar(this.currentCarSpec(), up, hero);
  }

  // ================= orders =================

  private genOrders(): void {
    this.orders = [];
    const used = new Set<string>();
    for (let k = 0; k < 3; k++) {
      const route = sampleDeliveryDestination(this.world.layout, Math.random, used, 90, 300);
      if (!route) break;
      const { dest, distance } = route;
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
    if (this.orders[0]) this.startOrder(this.orders[0]);
  }

  private startMode(mode: "drift-trial" | "time-attack"): void {
    if (mode === "drift-trial") {
      this.timeAttackCourse = null;
      this.startOrder({
        id: this.orderId++, title: "Drift Trial", dest: { x: 0, z: 0 },
        reward: 0, timeLimit: 60, fragility: 0, distance: 0,
      }, mode);
      return;
    }
    const course = timeAttackCourse(this.profile.mapId);
    this.timeAttackCourse = course;
    this.startOrder({
      id: this.orderId++, title: `Time Attack · ${course.name}`, dest: course.checkpoints[0],
      reward: 0, timeLimit: course.timeLimit, fragility: 0, distance: course.length,
    }, mode);
  }

  private gotoOrders(): void {
    this.genOrders();
    this.showScreen("orders");
  }

  private startOrder(o: Order, mode: ActivityMode = "delivery"): void {
    this.mode = mode;
    this.order = o;
    if (mode !== "time-attack") this.timeAttackCourse = null;
    this.timeAttackCheckpointIndex = 0;
    this.orders = this.orders.filter((x) => x.id !== o.id);
    this.car.pos.set(0, 0, 0);
    this.car.vel.set(0, 0, 0);
    this.car.heading = Math.PI;
    if (mode === "time-attack" && this.timeAttackCourse) {
      const tangent = { x: Math.sin(this.timeAttackCourse.heading), z: Math.cos(this.timeAttackCourse.heading) };
      const start = trafficLanePosition(this.timeAttackCourse.start, tangent, ROAD_W / 4);
      this.car.pos.set(start.x, 0, start.z);
      this.car.heading = this.timeAttackCourse.heading;
    }
    this.traffic.resetForPlayer(this.car.pos);
    this.car.cargo = 100;
    this.car.airY = 0;
    this.car.airV = 0;
    this.timeLeft = o.timeLimit;
    this.driftScore = 0;
    this.driftBankedScore = 0;
    this.driftChainScore = 0;
    this.driftChainTime = 0;
    this.driftIdleTime = 0;
    this.driftMultiplier = 1;
    this.driftCrashThisStep = false;
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
      (d.material as THREE.Material).dispose();
    }
    this.debris = [];
    this.wasInPuddle = false;
    this.wreckTimer = -1;
    this.redFinedX.clear();
    if (mode === "drift-trial") this.world.hideDestination();
    else this.world.setDestination(o.dest.x, o.dest.z);
    this.setTutorialContent(mode);
    this.hCargo.style.display = mode === "delivery" ? "flex" : "none";
    this.audio.ensure();
    this.showScreen("playing");
    this.updateHud();
    this.toast(mode === "drift-trial"
      ? "Drift Trial · удерживай занос, чтобы поднять множитель"
      : mode === "time-attack"
        ? `Time Attack · контрольная точка 1/${this.timeAttackCourse?.checkpoints.length ?? 5}`
        : `Доставь заказ за ${o.timeLimit} с. Береги груз!`);
    if (!this.profile.seenTutorials[mode]) this.showTutorial();
    else this.audio.startMusic();
  }

  private togglePause(): void {
    if (this.tutorialEl.open || this.saveStatus === "conflict") return;
    if (this.screen === "playing") this.showScreen("paused");
    else if (this.screen === "paused") this.showScreen("playing");
  }

  private toggleMute(): void {
    if (this.tutorialEl.open || this.saveStatus === "conflict") return;
    this.profile.muted = !this.profile.muted;
    this.audio.ensure();
    this.audio.setMuted(this.profile.muted);
    this.persistProfile();
  }

  // ================= HUD =================

  private buildHud(): void {
    const top = el("div", "hud-top");
    this.hOrder = el("span", "hud-order");
    this.hTimer = el("span", "hud-timer");
    const cargoWrap = el("div", "hud-cargo");
    this.hCargo = cargoWrap;
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
    this.hNitro = el("div", "hud-nitro", "НИТРО <span class='nitro-track'><i></i></span>");
    right.appendChild(this.hSpeed);
    right.appendChild(this.hMoney);
    right.appendChild(this.hDrift);
    right.appendChild(this.hNitro);
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

    const pauseBtn = el("button", "hud-pause", "❚❚");
    pauseBtn.setAttribute("aria-label", "Пауза");
    pauseBtn.title = "Пауза";
    pauseBtn.addEventListener("click", () => this.togglePause());
    this.hudEl.appendChild(pauseBtn);

    this.tutorialEl = document.createElement("dialog");
    this.tutorialEl.className = "tutorial";
    this.tutorialEl.setAttribute("aria-labelledby", "tutorial-title");
    this.setTutorialContent("delivery");
    this.tutorialEl.addEventListener("cancel", (event) => event.preventDefault());
    this.tutorialEl.addEventListener("click", (event) => {
      if (!(event.target as HTMLElement).closest("[data-a='tut-ok']")) return;
      this.audio.uiClick();
      this.profile.seenTutorials[this.mode] = true;
      this.persistProfile();
      this.tutorialEl.close();
      if (this.screen === "playing" && this.saveStatus !== "conflict") {
        this.input.setDriving(true);
        this.audio.startMusic();
      }
    });
    this.overlay.appendChild(this.tutorialEl);

    if (this.input?.isTouch) {
      const rh = el("div", "rotate-hint", "Поверните телефон горизонтально 🔄");
      this.hudEl.appendChild(rh);
    }
  }

  private showTutorial(): void {
    if (this.tutorialEl.open || this.saveStatus === "conflict") return;
    this.input.setDriving(false);
    this.tutorialEl.showModal();
  }

  private setTutorialContent(mode: ActivityMode): void {
    const controls = this.input.isTouch
      ? "Газ, задний ход и руль на джойстике. Справа тормоз, ручник и нитро."
      : "WASD или стрелки для вождения. Пробел включает ручник, Shift включает нитро, Esc ставит игру на паузу.";
    const activity = mode === "delivery"
      ? `<div class="tut-row"><span class="tut-ico">⚠</span><span>Береги груз от ударов и луж; красный сигнал стоит ₽${RED_LIGHT_FINE}.</span></div>
         <div class="tut-row"><span class="tut-ico">₽</span><span>Заказы, трюки и безопасные проезды дают деньги.</span></div>`
      : mode === "drift-trial"
        ? `<div class="tut-row"><span class="tut-ico">🔥</span><span>Держи занос: множитель растёт до ×5. Когда занос закончится, серия сохранится через 0,7 секунды.</span></div>
           <div class="tut-row"><span class="tut-ico">⚠</span><span>Сильный удар сбрасывает незабранные очки серии. За итоговый счёт выдаются медали и ₽.</span></div>`
        : `<div class="tut-row"><span class="tut-ico">🏁</span><span>Пройди контрольные точки строго по порядку и вернись на старт для финиша.</span></div>
           <div class="tut-row"><span class="tut-ico">🥇</span><span>Время круга определяет медаль, выплату и лучший результат трассы.</span></div>`;
    this.tutorialEl.innerHTML = `<div class="tutorial-box">
      <h3 id="tutorial-title">КАК ИГРАТЬ · ${mode === "delivery" ? "ДОСТАВКА" : mode === "drift-trial" ? "DRIFT TRIAL" : "TIME ATTACK"}</h3>
      <div class="tut-row"><span class="tut-ico wheel">🕹</span><span>${controls}</span></div>
      <div class="tut-row"><span class="tut-ico hb">★</span><span><b>ДРИФТ</b> — ручник и газ помогают начать занос; нитро пополняется за дрифт.</span></div>
      ${activity}
      <button class="btn primary" data-a="tut-ok" autofocus>ПОНЯТНО!</button>
    </div>`;
  }

  /** Floating "+₽" bonus popup. */
  private addBonus(amount: number, label: string): void {
    if (this.mode !== "delivery") return;
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
    const bounds = this.world.layout.bounds;
    const scale = S / Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
    const u = (x: number) => S / 2 + (x - (bounds.minX + bounds.maxX) / 2) * scale;
    const v = (z: number) => S / 2 + (z - (bounds.minZ + bounds.maxZ) / 2) * scale;
    g.fillStyle = this.world.layout.waterAreas.length ? "#102d39" : "rgba(10,14,28,0.75)";
    g.fillRect(0, 0, S, S);
    for (const area of this.world.layout.waterAreas) {
      g.beginPath();
      area.points.forEach((point, i) => i === 0 ? g.moveTo(u(point.x), v(point.z)) : g.lineTo(u(point.x), v(point.z)));
      g.closePath();
      g.fillStyle = "#0b3444";
      g.fill();
      g.strokeStyle = "rgba(115,174,184,.62)";
      g.lineWidth = 0.75;
      g.stroke();
    }
    const siteColors: Record<string, string> = {
      warehouse: "#7b8c8d",
      "container-yard": "#c48242",
      "gantry-crane": "#ffd273",
      pier: "#889295",
      "cargo-ship": "#b7d4d3",
      "tank-farm": "#83a4a6",
    };
    for (const site of this.world.layout.portSites) {
      g.save();
      g.translate(u(site.x), v(site.z));
      g.rotate(site.rotation);
      g.fillStyle = siteColors[site.kind] ?? "#89949a";
      const width = Math.max(1.3, site.width * scale * 0.65);
      const depth = Math.max(1.2, site.depth * scale * 0.65);
      g.fillRect(-width / 2, -depth / 2, width, depth);
      g.restore();
    }
    g.lineCap = "round";
    g.lineJoin = "round";
    for (const road of this.world.layout.roads) {
      g.beginPath();
      road.points.forEach((point, i) => i === 0 ? g.moveTo(u(point.x), v(point.z)) : g.lineTo(u(point.x), v(point.z)));
      g.strokeStyle = "#3a4152";
      g.lineWidth = road.width * scale;
      g.stroke();
    }
  }

  private drawMinimap(): void {
    const g = this.mmCanvas.getContext("2d")!;
    g.clearRect(0, 0, 150, 150);
    g.drawImage(this.mmBase, 0, 0);
    const S = 150;
    const bounds = this.world.layout.bounds;
    const scale = S / Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
    const u = (x: number) => S / 2 + (x - (bounds.minX + bounds.maxX) / 2) * scale;
    const v = (z: number) => S / 2 + (z - (bounds.minZ + bounds.maxZ) / 2) * scale;
    if (this.order && this.mode !== "drift-trial") {
      const pulse = 3 + Math.sin(performance.now() / 200) * 1;
      g.fillStyle = "#22ffcc";
      g.beginPath();
      g.arc(u(this.order.dest.x), v(this.order.dest.z), pulse + 1.5, 0, Math.PI * 2);
      g.fill();
    }
    g.save();
    g.translate(u(this.car.pos.x), v(this.car.pos.z));
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
      this.tickCount++;
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
    if (this.screen !== "playing" || !this.order || this.tutorialEl.open || this.saveStatus === "conflict") {
      this.audio.updateEngine(0, 0, 0);
      return;
    }
    this.elapsed += dt;
    this.world.update(dt);
    this.driftCrashThisStep = false;
    const inp = this.input.update();
    inp.nitro = inp.nitro && inp.throttle > 0 && this.nitroFuel > 0;
    if (inp.nitro) this.nitroFuel = Math.max(0, this.nitroFuel - dt * 28);
    // fully wrecked car explodes and ends the order
    if (this.car.hp <= 0 && !this.car.wrecked && this.wreckTimer < 0) {
      this.startWreck();
    }
    if (this.wreckTimer > 0) {
      this.wreckTimer -= dt;
      this.effects.spawnSmoke(this.car.pos.x, this.car.pos.z, true);
      if (this.wreckTimer <= 0) {
        this.completeOrder(false, "Машина уничтожена");
        this.car.hp = 20; // эвакуатор оттащил обломки, машина на ходу
        this.car.wrecked = false;
        this.wreckTimer = -1;
        return; // order is null now — nothing else to do this frame
      }
    }
    const prevX = this.car.pos.x;
    const prevZ = this.car.pos.z;
    const res = this.car.step(dt, inp, this.world);
    if (res.drift > 5 && Math.abs(res.speed) > 8) this.nitroFuel = Math.min(100, this.nitroFuel + dt * 5);
    const spec = this.car.spec;
    const frag = this.mode === "delivery" ? this.order.fragility : 0;
    const protect = spec.cargoProtect;

    // lifetime stat: top speed
    const kmhNow = speedKmh(res.speed);
    if (kmhNow > this.profile.stats.maxSpeedKmh)
      this.profile.stats.maxSpeedKmh = kmhNow;

    // traffic
    const tHit = this.traffic.update(
      dt,
      this.car.pos,
      this.car.vel,
      Math.abs(res.speed),
      this.trafficSpawnVisible,
    );
    if (tHit > 0 && !this.car.isFlipping) {
      this.driftCrashThisStep = true;
      this.breakDriftChain();
    }
    if (tHit > 4 && !this.car.isFlipping) {
      const dmg = 14 * (1 - protect * 0.5);
      if (this.mode === "delivery") this.car.damage(dmg * frag);
      this.car.damageCar(tHit * 0.8);
      this.trafficHits += 1;
      this.car.vel.multiplyScalar(0.55);
      this.shake = Math.min(1, this.shake + 0.6);
      this.audio.thud(0.8);
      this.effects.spawnFlash(this.car.pos.x, this.car.pos.z, 0xffaa44);
      this.toast(this.mode === "delivery" ? "Авария с машиной! Груз пострадал" : "Столкновение! Кузов повреждён", true);
      if (tHit > 20 && Math.abs(res.speed) > 12) {
        this.car.startRoll(Math.random() < 0.5 ? 1 : -1);
      }
    }

    // police pursuit
    if (this.mode === "delivery" && this.police.active) {
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
          this.profile.stats.escapes += 1;
          this.grantAchievements();
          this.audio.success();
          this.police.stop();
        }
      } else {
        this.chaseEscape = 0;
      }
      if (this.police.active && this.chaseTimedOut > 45) {
        this.addBonus(300, "Оторвался от погони!");
        this.profile.stats.escapes += 1;
        this.grantAchievements();
        this.police.stop();
      }
    } else if (this.mode === "delivery" && !this.chaseTriggered && (this.redLightRuns >= 2 || this.trafficHits >= 2)) {
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
        if (this.mode === "delivery") this.car.damage(rate * dt);
        this.shake = Math.min(0.35, this.shake + dt * 2.4);
      }
      if (res.offRoad && Math.abs(res.speed) > 6) {
        const rate = Math.abs(res.speed) * 0.055 * frag * (1 - protect * 0.6);
        if (this.mode === "delivery") this.car.damage(rate * dt);
        this.shake = Math.min(0.3, this.shake + dt * 2);
      }
      if (res.inPuddle && !this.wasInPuddle && Math.abs(res.speed) > 10) {
        if (this.mode === "delivery") this.car.damage(1.6 * frag * (1 - protect));
        this.audio.splash();
        this.effects.spawnSplash(this.car.pos.x, this.car.pos.z);
      }
      this.wasInPuddle = res.inPuddle;
      if (res.impact > 3) {
        const dmg = res.impact * 1.15 * (1 - protect * 0.5);
        if (this.mode === "delivery") this.car.damage(dmg * frag);
        this.car.damageCar(res.impact * 0.9);
        this.shake = Math.min(1, this.shake + res.impact * 0.06);
        this.audio.thud(Math.min(1, res.impact / 25));
        this.effects.spawnFlash(this.car.pos.x, this.car.pos.z);
        if (res.impact > 9) {
          this.driftCrashThisStep = true;
          this.breakDriftChain();
        }
        if (dmg > 3) this.toast(this.mode === "delivery" ? `Удар! Груз −${Math.round(dmg)}%` : "Удар! Кузов повреждён", true);
        if (res.impact < 9 && this.scrapeCooldown <= 0) {
          this.scrapeCooldown = 3;
          this.addBonus(15, "Задел!");
          this.nitroFuel = Math.min(100, this.nitroFuel + 12);
          this.profile.stats.scraps += 1;
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
        this.profile.stats.jumps += 1;
        this.grantAchievements();
        this.audio.uiClick();
        if (res.landing > 11) {
          const ldmg = (res.landing - 11) * 1.2 * frag * (1 - protect);
          if (this.mode === "delivery") this.car.damage(ldmg);
          else this.car.damageCar(Math.min(15, (res.landing - 11) * 0.6));
          this.shake = Math.min(1, this.shake + 0.5);
          this.audio.thud(0.7);
          this.toast(this.mode === "delivery" ? "Жёсткая посадка! Груз пострадал" : "Жёсткая посадка!", true);
        }
      }
      if (res.rolled) {
        if (this.mode === "delivery") this.car.damage(35);
        else this.car.damageCar(20);
        this.shake = 1;
        this.audio.thud(1);
        this.audio.crack();
        this.toast(this.mode === "delivery" ? "ПЕРЕВОРОТ! Груз сильно повреждён" : "ПЕРЕВОРОТ! Машина повреждена", true);
        this.profile.stats.rolls += 1;
        this.grantAchievements();
      }
    }

    // Delivery keeps its flat drift tips; Drift Trial uses a bankable combo chain.
    if (this.mode === "drift-trial") {
      this.updateDriftChain(res.drift, res.speed, dt);
    } else if (this.mode === "delivery" && res.drift > 5 && Math.abs(res.speed) > 8) {
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
    if (this.mode === "delivery" && this.car.cargo <= 0) {
      this.completeOrder(false, "Груз разбит вдребезги");
    } else if (this.timeLeft <= 0) {
      if (this.mode === "drift-trial") this.completeOrder(true, "60 секунд истекли");
      else this.completeOrder(false, this.mode === "time-attack" ? "Время вышло до финиша" : "Время вышло — клиент ушёл");
    } else if (this.mode === "delivery" && dDest < 4.2) {
      this.completeOrder(true, "Точка назначения достигнута");
    } else if (this.mode === "time-attack" && dDest < 8.5) {
      this.advanceTimeAttackCheckpoint();
    }

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

  private trafficSpawnVisible = (x: number, z: number): boolean => {
    if (this.spawnCameraFrame !== this.tickCount) {
      this.spawnViewProjection.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
      this.spawnFrustum.setFromProjectionMatrix(this.spawnViewProjection);
      this.spawnCameraFrame = this.tickCount;
    }
    this.spawnSphere.center.set(x, 1, z);
    if (this.spawnFrustum.intersectsSphere(this.spawnSphere)) return true;
    // Keep clear of the new driving direction while the chase camera catches up after a turn.
    const dx = x - this.car.pos.x;
    const dz = z - this.car.pos.z;
    const heading = this.car.heading;
    return dx * Math.sin(heading) + dz * Math.cos(heading) > Math.hypot(dx, dz) * 0.7;
  };

  private checkRedLight(prevX: number, prevZ: number): void {
    if (this.mode !== "delivery" || !this.order || this.car.isFlipping) return;
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
          this.profile.stats.redLights += 1;
          this.grantAchievements();
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

  private updateDriftChain(drift: number, speed: number, dt: number): void {
    const active = !this.driftCrashThisStep && drift > 5 && Math.abs(speed) > 8;
    if (active) {
      this.driftIdleTime = 0;
      this.driftChainTime += dt;
      this.driftMultiplier = driftMultiplierForSeconds(this.driftChainTime);
      this.driftChainScore += drift * Math.abs(speed) * dt * 0.09 * this.driftMultiplier;
      this.driftScore = this.driftBankedScore + this.driftChainScore;
      return;
    }
    if (this.driftChainScore <= 0) return;
    this.driftIdleTime += dt;
    if (this.driftIdleTime >= 0.7) this.bankDriftChain();
  }

  private bankDriftChain(): void {
    if (this.driftChainScore > 0) this.driftBankedScore += this.driftChainScore;
    this.driftChainScore = 0;
    this.driftChainTime = 0;
    this.driftIdleTime = 0;
    this.driftMultiplier = 1;
    this.driftScore = this.driftBankedScore;
  }

  private breakDriftChain(): void {
    if (this.driftChainScore <= 0) return;
    this.driftChainScore = 0;
    this.driftChainTime = 0;
    this.driftIdleTime = 0;
    this.driftMultiplier = 1;
    this.driftScore = this.driftBankedScore;
  }

  private advanceTimeAttackCheckpoint(): void {
    const course = this.timeAttackCourse;
    if (!course || !this.order) return;
    this.timeAttackCheckpointIndex++;
    if (this.timeAttackCheckpointIndex >= course.checkpoints.length) {
      this.completeOrder(true, "Круг завершён");
      return;
    }
    const point = course.checkpoints[this.timeAttackCheckpointIndex];
    this.order.dest = point;
    this.world.setDestination(point.x, point.z);
    const checkpointCount = course.checkpoints.length;
    this.toast(this.timeAttackCheckpointIndex === checkpointCount - 1
      ? `Финишная контрольная точка ${checkpointCount}/${checkpointCount} · возвращайся на старт`
      : `Контрольная точка ${this.timeAttackCheckpointIndex + 1}/${checkpointCount}`);
  }

  private startWreck(): void {
    this.car.wrecked = true;
    this.wreckTimer = 1.6;
    this.shake = 1;
    const { x, z } = this.car.pos;
    this.effects.spawnFlash(x, z, 0xff8822);
    this.effects.spawnFlash(x, z, 0xffcc44);
    this.effects.spawnFlash(x, z, 0xff3300);
    for (let i = 0; i < 8; i++) {
      this.effects.spawnSmoke(
        x + (Math.random() - 0.5) * 2,
        z + (Math.random() - 0.5) * 2,
        true
      );
    }
    this.audio.thud(1);
    this.audio.crack();
    this.toast("Машина взорвалась!", true);
  }

  /** Unlock newly completed achievements, announce them and persist. */
  private grantAchievements(save = true): void {
    const fresh = checkAchievements(this.profile);
    if (fresh.length === 0) return;
    if (save) this.persistProfile();
    for (const a of fresh) this.toast(`🏆 Ачивка: ${a.icon} ${a.name}`);
    this.audio.cash();
  }

  private completeOrder(ok: boolean, reason: string): void {
    if (!this.order) return;
    const o = this.order;
    this.world.hideDestination();
    this.audio.stopMusic();
    this.audio.updateEngine(0, 0, 0);
    const p = this.profile;
    if (this.mode === "drift-trial") this.bankDriftChain();
    const driftScore = finalDriftScore(this.driftScore);
    this.driftScore = driftScore;
    if (this.mode === "drift-trial" && ok) p.driftBest = Math.max(p.driftBest, driftScore);
    if (this.mode !== "delivery") {
      const title = this.mode === "drift-trial" ? "DRIFT TRIAL" : "TIME ATTACK";
      const elapsed = Math.max(0, o.timeLimit - this.timeLeft);
      const medal = this.mode === "drift-trial"
        ? ok ? driftMedal(driftScore) : null
        : ok && this.timeAttackCourse ? timeAttackMedal(this.timeAttackCourse, elapsed) : null;
      const record = ok
        ? this.mode === "drift-trial"
          ? saveRecord(p.records, p.mapId, this.mode, p.carId, driftScore)
          : saveRecord(p.records, p.mapId, this.mode, p.carId, elapsed)
        : null;
      const reward = modeReward(this.mode, medal, driftScore, ok);
      const medalLabel = medal ? `${medal === "gold" ? "🥇 золото" : medal === "silver" ? "🥈 серебро" : "🥉 бронза"}` : "без медали";
      const lines = this.mode === "drift-trial"
        ? [`${reason}.`, `Счёт: ${driftScore} · ${medalLabel}`]
        : ok
          ? [`${reason}.`, `Время круга: ${elapsed.toFixed(1)} с · ${medalLabel}`]
          : [`${reason}.`, `Время до схода: ${elapsed.toFixed(1)} с`];
      if (this.mode === "time-attack" && this.timeAttackCourse) {
        lines.push(this.timeAttackCourse.name);
        lines.push(`Пройдено контрольных точек: ${this.timeAttackCheckpointIndex}/${this.timeAttackCourse.checkpoints.length}`);
      }
      if (record !== null) lines.push(this.mode === "drift-trial" ? `Лучший счёт: ${Math.round(record)}` : `Лучшее время: ${record.toFixed(1)} с`);
      if (this.mode === "time-attack" && medal) {
        p.stats.timeAttackMedal = Math.max(p.stats.timeAttackMedal, medalRank(medal));
      }
      p.money += reward;
      p.totalEarn += reward;
      p.bestEarn = Math.max(p.bestEarn, reward);
      lines.push(`<b class="gold">Выплата за заезд: ₽${reward}</b>`);
      this.grantAchievements(false);
      this.persistProfile();
      this.lastResult = { ok, lines, mode: this.mode, title };
      this.order = null;
      this.police.stop();
      this.bonusMoney = 0;
      this.showScreen("result");
      return;
    }
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
      if (this.car.cargo >= 99.5) p.stats.perfectDeliveries += 1;
      const record = saveRecord(p.records, p.mapId, "delivery", p.carId, total);
      lines.push(`Личный рекорд доставки: ₽${Math.round(record)}`);
      if (o.weekly) {
        const completed = completeWeeklyRoute(p.weeklyCompletions, o.weekly);
        const completedOnMap = weeklyRouteIds(o.weekly.week, p.mapId).filter((id) => completed.includes(id)).length;
        lines.push(`<span class="gold">Маршруты недели от ${o.weekly.week}: ${completedOnMap}/3</span>`);
      }
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
    this.grantAchievements(false);
    this.persistProfile();
    this.lastResult = { ok, lines };
    this.order = null;
    this.police.stop();
    this.bonusMoney = 0;
    this.showScreen("result");
  }

  private updateHud(): void {
    if (!this.order) return;
    const o = this.order;
    this.hOrder.textContent = this.mode === "delivery"
      ? `📦 ${CARGO_NAMES[o.id % CARGO_NAMES.length]} · ₽${o.reward}`
      : this.mode === "drift-trial" ? "DRIFT TRIAL · комбо до ×5" : `TIME ATTACK · КП ${Math.min(this.timeAttackCheckpointIndex + 1, this.timeAttackCourse?.checkpoints.length ?? 5)}/${this.timeAttackCourse?.checkpoints.length ?? 5}`;
    const t = Math.max(0, this.timeLeft);
    this.hTimer.textContent = this.mode === "time-attack"
      ? `⏱ ${Math.max(0, o.timeLimit - this.timeLeft).toFixed(1)}с`
      : `⏱ ${t.toFixed(0)}с`;
    this.hTimer.classList.toggle("low", t < 12);
    const cargo = Math.max(0, this.car.cargo);
    this.hCargoBar.style.transform = `scaleX(${cargo / 100})`;
    this.hCargoBar.classList.toggle("low", cargo < 35);
    this.hCargoText.textContent = `груз ${cargo.toFixed(0)}%`;
    this.hCargo.style.display = this.mode === "delivery" ? "flex" : "none";
    this.hSpeed.innerHTML = `${speedKmh(this.car.speed)}<small>км/ч</small>`;
    const speed = Math.abs(this.car.speed);
    this.hMoney.textContent = `₽${this.profile.money}${this.orderFines ? ` (−${this.orderFines})` : ""}`;
    this.hDrift.textContent = this.mode === "drift-trial"
      ? `дрифт ${Math.round(this.driftScore)} · ×${this.driftMultiplier}${this.driftChainScore > 0 ? ` · серия ${Math.round(this.driftChainScore)}` : ""}`
      : this.mode === "delivery" && this.driftScore > 50 && speed > 8
        ? `дрифт +${Math.round(this.driftScore)}`
        : "";
    this.hNitro.querySelector("i")!.setAttribute("style", `transform:scaleX(${this.nitroFuel / 100})`);
    this.hChase.style.display = this.police.active ? "inline" : "none";
    this.drawMinimap();
  }

  // ================= render =================

  private renderFrame(dt: number): void {
    if (VERIFICATION && !this.readyFlagged) {
      this.readyFlagged = true;
      (window as unknown as { __GAME_READY__: boolean }).__GAME_READY__ = true;
    }
    // menu screens show the showroom turntable instead of the city
    if (
      this.screen === "title" ||
      this.screen === "play" ||
      this.screen === "tracks" ||
      this.screen === "profile" ||
      this.screen === "garage" ||
      this.screen === "orders" ||
      this.screen === "settings" ||
      this.screen === "achievements"
    ) {
      this.showroom.update(dt);
      this.renderer.render(this.showroom.scene, this.showroom.camera);
      return;
    }
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
    if (this.freeCam) {
      this.camera.position.set(this.freeCam[0], this.freeCam[1], this.freeCam[2]);
      this.camera.lookAt(this.freeCam[3], this.freeCam[4], this.freeCam[5]);
    }
    const speedRatio = Math.min(1, Math.abs(this.car.speed) / this.car.spec.topSpeed);
    const targetFov = 60 + speedRatio * 16 + (portrait ? 6 : 0);
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 5);
    this.camera.updateProjectionMatrix();

    this.traffic.render(Math.min(1, this.acc / (1 / 60)));
    this.effects.update(dt, this.camera.quaternion);
    this.renderer.render(this.scene, this.camera);
  }

  private resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.showroom.camera.aspect = w / h;
    this.showroom.camera.updateProjectionMatrix();
  };

  dispose(): void {
    this.disposed = true;
    this.stop();
    document.removeEventListener("visibilitychange", this.visibilityChanged);
    window.removeEventListener("storage", this.storageChanged);
    window.removeEventListener("resize", this.resize);
    this.audio.dispose();
    this.input.dispose();
    this.car.dispose();
    this.traffic.dispose();
    this.police.dispose();
    this.effects.dispose();
    for (const world of this.worldCache.values()) world.dispose();
    this.worldCache.clear();
    this.renderer.dispose();
    this.screenEl.remove();
    this.hudEl.remove();
    this.tutorialEl.remove();
    this.saveNotice.remove();
    if (VERIFICATION) {
      Reflect.deleteProperty(window, "__gameProbe");
      Reflect.deleteProperty(window, "__gameDebug");
      Reflect.deleteProperty(window, "__GAME_READY__");
    }
  }
}
