import * as THREE from "three";
import tokyoPreview from "../assets/map-previews/tokyo.webp";
import yokohamaPreview from "../assets/map-previews/yokohama.webp";
import spbPreview from "../assets/map-previews/spb.webp";
import kazanPreview from "../assets/map-previews/kazan.webp";
import sochiPreview from "../assets/map-previews/sochi.webp";
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
import { ACTIVITY_MODES, type ActivityMode, type CarSpec, type GameScreen, type HeroModelKey, type MapId, type Order, type UpgradeLevels } from "./types";
import { PROFILE_KEY, ProfileStore, type SaveStatus } from "./storage";
import { AudioSystem } from "./audio";
import { Input } from "./input";
import { driftTip, isControlledDrift } from "./drift-pay";
import { EVENTS, nextEvent, canRace, mapOpen, settleEvent, goal, type CareerEvent } from "./career";
import { Roadside } from "./roadside";
import { World } from "./world";
import { CITY_STYLE } from "./city-style";
import { Car, disposeCarVisual } from "./car";
import { trafficLanePosition, Traffic } from "./traffic";
import { Police } from "./police";
import { loadGameAssets, loadHeroModel, type LoadedModel } from "./assets";
import { Effects } from "./effects";
import { ACHIEVEMENTS, checkAchievements } from "./achievements";
import { NEVA_CONTRACT, NEVA_SECTORS, NevaRun, nevaChallengeLink, nevaChallengeTarget, nevaResult } from "./neva-contract";
import { buildNevaMarkings, drawNevaPreview, drawNevaRoute } from "./neva-visuals";
import { guideAlongRoads, sampleDeliveryDestination } from "./delivery-routing";
import type { CityPoint } from "./map-layouts";
import { canUnlockCar, driftMedal, driftMultiplierForSeconds, finalDriftScore, medalRank, modeReward, timeAttackCourse, timeAttackMedal, type GameMode, type MedalTier, type TimeAttackCourse } from "./modes";
import { RADIO_CACHE_RADIUS, RADIO_GATE_RADIUS, RADIO_TIME, RADIO_TITLE, RADIO_TRAFFIC_SEED, RADIO_WAVES, RadioRun, radioCourse, radioMedal, radioScore } from "./radio-silence";
import { createShowroom } from "./showroom";
import {
  completeWeeklyRoute, recordDetails, saveRecord,
  utcWeekKey, weeklyRouteIds, weeklyRoutes, type WeeklyRoute,
} from "./retention";

const VERIFICATION = import.meta.env.DEV || import.meta.env.MODE === "verification";
const COUNTDOWN_BEAT_MS = 1000;
const WORLD_CACHE_LIMIT = 2;
const NEVA_CAR = CARS.find(({ id }) => id === NEVA_CONTRACT.carId)!;
const STOCK_UPGRADES: UpgradeLevels = { engine: 0, tires: 0, turbo: 0, suspension: 0 };
const { start: NEVA_START, finish: NEVA_FINISH } = NEVA_CONTRACT;
const SD = ROAD_W / 2 + 1.6; // stop-line distance from intersection center
const MAP_PREVIEWS: Record<MapId, string> = {
  tokyo: tokyoPreview, yokohama: yokohamaPreview, spb: spbPreview, kazan: kazanPreview, sochi: sochiPreview,
};
const MODE_NAMES: Record<ActivityMode, string> = {
  delivery: "Доставка", "drift-trial": "Drift Trial", "time-attack": "Time Attack", "radio-silence": RADIO_TITLE,
};
const RADIO_SIGNAL_COLOR = 0xb899ff;
const RADIO_CACHE_COLOR = 0xffbb62;
const SHOWROOM_SCREENS = new Set<GameScreen>(["title", "play", "career", "tracks", "neva-contract", "profile", "garage", "cars", "orders", "settings", "achievements"]);
const rubles = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });

function el(tag: string, cls: string, html = ""): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  e.innerHTML = html;
  return e;
}

function medalLabel(medal: MedalTier | null): string {
  return medal === "gold" ? "🥇 золото" : medal === "silver" ? "🥈 серебро" : medal === "bronze" ? "🥉 бронза" : "без медали";
}

export class Game {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private showroom = createShowroom();
  private readonly heroModels = new Map<HeroModelKey, LoadedModel | "loading" | "failed">();
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  private readonly showroomObserver = new ResizeObserver(() => this.frameShowroom());
  private showroomStage: HTMLElement | null = null;
  private showroomViewport: THREE.Vector4 | null = null;
  private showroomDrag: { pointer: number; x: number } | null = null;
  private viewportWidth = 1;
  private viewportHeight = 1;
  private garageIndex = 0;
  private garageReturn: "title" | "garage" = "title";
  private readonly roadside = new Roadside();
  private scene = new THREE.Scene();
  private readonly ambientLight = new THREE.HemisphereLight(0xffffff, 0xffffff, 1.5);
  private readonly keyLight = new THREE.DirectionalLight();
  private readonly accentLight = new THREE.DirectionalLight();
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
  private activeWorld?: World;
  get world(): World {
    if (!this.activeWorld) this.useWorld(this.profile.mapId);
    return this.activeWorld!;
  }
  car: Car;
  private readonly careerCar: Car;
  private nevaCar: Car | null = null;
  private radioCar: Car | null = null;
  private radioRun: RadioRun | null = null;
  private radioCache: THREE.Group | null = null;
  private nevaMarkings: ReturnType<typeof buildNevaMarkings> | null = null;
  private nevaRun: NevaRun | null = null;
  private nevaTarget = nevaChallengeTarget(window.location.search);
  private activeTraffic?: Traffic;
  get traffic(): Traffic {
    if (this.activeTraffic) return this.activeTraffic;
    this.activeTraffic = new Traffic(this.world, this.car.pos);
    this.activeTraffic.onNearMiss = () => {
      if (this.screen !== "playing") return;
      if (this.mode === "delivery" && !this.nevaRun) {
        this.addBonus(60, "Впритирку!");
        this.audio.uiClick();
      }
    };
    this.scene.add(this.activeTraffic.group);
    return this.activeTraffic;
  }
  private midriseAsset: { root: THREE.Group; size: THREE.Vector3 } | null = null;
  effects = new Effects();

  screen: GameScreen = "title";
  order: Order | null = null;
  mode: ActivityMode = "delivery";
  private selectedEvent = EVENTS[0];
  private activeEvent?: CareerEvent;
  private careerHudGoal = "";
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
  private paidDriftSeconds = 0;
  private driftCredited = 0;
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
  readonly initialModels: Promise<void>;
  private worldModelsRequested = false;
  assetsReady = false; // downloaded models swapped in
  private camPos = new THREE.Vector3(0, 5, 55);
  private camForward = new THREE.Vector3();
  private camDesired = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private toastTimer = 0;
  private hudTimer = 0;
  private countdownLeft = 0;
  private countdownFrameTime?: number;
  nitroFuel = 100;
  private hNitro!: HTMLElement;
  private readyFlagged = false;

  // DOM refs
  private overlay: HTMLElement;
  private screenEl: HTMLElement;
  private hudEl: HTMLElement;
  private countdownEl!: HTMLElement;
  private countdownDigit!: HTMLElement;
  private countdownPulse!: Animation;
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
  private hNavigation!: HTMLElement;
  private hArrow!: HTMLElement;
  private routeGuide: { world: World; x: number; z: number; aim: (point: CityPoint) => CityPoint } | null = null;
  private arrowAngle: number | null = null;
  private popups!: HTMLElement;
  private tutorialEl!: HTMLDialogElement;
  private saveNotice: HTMLElement;

  constructor(canvas: HTMLCanvasElement, onLoadingProgress: (finished: number, total: number) => void) {
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

    this.keyLight.position.set(-120, 200, -80);
    this.accentLight.position.set(100, 60, 120);
    this.scene.add(this.ambientLight, this.keyLight, this.accentLight);

    const upgrades = this.currentUpgrades();
    this.careerCar = new Car(tunedSpec(this.currentCarSpec(), upgrades));
    this.careerCar.setUpgrades(upgrades);
    this.configureCar(this.careerCar);
    this.car = this.careerCar;
    this.scene.add(this.car.group);
    this.scene.add(this.police.group);
    this.scene.add(this.effects.group);
    const initialScreen = this.nevaTarget === null ? "title" : "neva-contract";
    const firstModel = initialScreen === "neva-contract" ? NEVA_CAR.glb : this.currentCarSpec().glb;
    onLoadingProgress(0, 1);
    this.initialModels = Promise.resolve(this.requestHero(firstModel)).then(() => onLoadingProgress(1, 1));
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
    this.input.onMute = () => { if (this.tickCount > 0) this.toggleMute(); };
    this.input.onConfirm = () => {
      if (this.tickCount === 0 || this.tutorialEl.open || this.saveStatus === "conflict") return;
      if (this.screen === "title" && !this.screenEl.querySelector(".weekly-event-shade")) this.showScreen("play");
      else if (this.screen === "neva-contract") this.startNevaContract();
      else if (this.screen === "result") {
        if (this.activeEvent) this.continueCareer();
        else if (this.nevaRun) this.startNevaContract();
        else if (this.lastResult.mode) this.startMode(this.lastResult.mode);
        else this.gotoOrders();
      }
    };
    this.audio.muted = this.profile.muted;
    this.audio.volume = this.profile.volume;

    this.showScreen(initialScreen);
    if (!this.profileStore.readable) this.showSaveStatus("unavailable");
    if (VERIFICATION) {
      (window as unknown as { __gameProbe: () => { x: number; y: number; z: number } }).__gameProbe =
        () => ({ x: this.car.pos.x, y: this.car.pos.y, z: this.car.pos.z });
      // verification hook (not user-facing)
      (window as unknown as { __gameDebug: unknown }).__gameDebug = {
        mapId: () => this.activeWorld?.mapId ?? this.profile.mapId,
        roadProbe: (x: number, z: number) => ({
          onRoad: this.world.isOnRoad(x, z),
          nearestRoadDist: this.world.nearestRoadDist(x, z),
          bounds: { ...this.world.perimeter },
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
        radio: () => this.radioRun && ({
          phase: this.radioRun.phase, escapes: this.radioRun.escapes, packets: this.radioRun.packets,
          carryingPacket: this.radioRun.carryingPacket, target: this.radioRun.target, cache: this.radioRun.leg.cache,
          timeLeft: this.timeLeft, lead: this.police.dist,
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
        setLegacyMapsForTest: (maps: MapId[]) => { this.profile.legacyMaps = maps; this.persistProfile(); },
        setDeliveriesForTest: (deliveries: number) => { this.profile.deliveries = deliveries; this.persistProfile(); },
        weeklyEventSeen: (date?: string) => this.profile.weeklyEventWeek === utcWeekKey(date ? new Date(date) : new Date()),
        markWeeklyEventSeen: (date?: string) => {
          this.profile.weeklyEventWeek = utcWeekKey(date ? new Date(date) : new Date());
          this.persistProfile();
        },
        worldCacheSize: () => this.worldCache.size,
        neva: () => this.nevaRun && {
          cleanSectors: this.nevaRun.cleanSectors,
          activeSector: this.nevaRun.activeSector(),
          target: this.nevaTarget,
          car: this.car.spec.id,
          careerHp: this.careerCar.hp,
        },
        driveNevaStepForTest: (x: number, z: number, nextX: number, nextZ: number, speed: number, slip: number, clean: boolean) => {
          this.nevaRun?.update(x, z, nextX, nextZ, 1 / 60, speed, slip, clean);
        },
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
        showroom: () => ({
          key: this.showroomStage?.dataset.car,
          state: this.showroomStage?.dataset.model,
          detailed: this.showroom.carGroup.children.length === 1,
          angle: this.showroom.carGroup.rotation.y,
        }),
        turboVisual: () => ({
          wheels: ["FL", "FR", "RL", "RR"].map((corner) => {
            const wheel = this.car.group.getObjectByName(`hub_center_${corner}`);
            return wheel ? { spin: wheel.rotation.x, steer: wheel.parent?.rotation.y } : null;
          }),
          wing: this.car.group.getObjectByName("rear_spoiler") !== undefined,
        }),
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

  private configureCar(car: Car): void {
    car.onSmoke = (x, z, strong) => this.effects.spawnSmoke(x, z, strong);
    car.onWheelLost = (x, z) => {
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
    car.onPartLost = (x, z, kind) => {
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
    car.group.add(blob);
  }

  // ================= screens =================

  private clearScreen(): void {
    this.screenEl.innerHTML = "";
    this.screenEl.style.display = "none";
  }

  private showroomStatus(): string {
    return `<p class="showroom-message" role="status">Загрузка модели…</p>
      <button type="button" class="btn small showroom-retry" hidden>Повторить загрузку</button>`;
  }

  private mountShowroomStage(): void {
    this.showroomObserver.disconnect();
    this.showroomDrag = null;
    const stage = this.screenEl.querySelector<HTMLElement>("[data-showroom-stage]");
    this.showroomStage = stage;
    this.frameShowroom();
    if (!stage) return;
    this.showroomObserver.observe(stage);
    stage.querySelector(".showroom-retry")!.addEventListener("click", () => {
      const { glb } = this.showroomSpec();
      if (this.heroModels.get(glb) === "failed") this.heroModels.delete(glb);
      this.refreshShowroom();
    });
    if (this.screen !== "cars") return;
    stage.addEventListener("pointerdown", (event) => {
      if (!event.isPrimary || event.button !== 0 || (event.target as Element).closest("button")) return;
      this.showroomDrag = { pointer: event.pointerId, x: event.clientX };
      stage.setPointerCapture(event.pointerId);
    });
    stage.addEventListener("pointermove", (event) => {
      const drag = this.showroomDrag;
      if (drag?.pointer !== event.pointerId) return;
      this.showroom.rotate((event.clientX - drag.x) * 0.013);
      drag.x = event.clientX;
    });
    stage.addEventListener("lostpointercapture", () => { this.showroomDrag = null; });
    stage.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      this.showroom.rotate(event.key === "ArrowLeft" ? -0.32 : 0.32);
    });
  }

  private showroomSpec(): CarSpec {
    if (this.screen === "cars") return CARS[this.garageIndex];
    if (this.screen === "neva-contract") return NEVA_CAR;
    return this.currentCarSpec();
  }

  private refreshShowroom(): void {
    if (!SHOWROOM_SCREENS.has(this.screen)) return;
    const car = this.showroomSpec();
    this.requestHero(car.glb);
    const hero = this.heroFor(car);
    if (hero) this.showroom.setCar(car, this.screen === "neva-contract" ? STOCK_UPGRADES : this.profile.upgrades[car.id] ?? STOCK_UPGRADES, hero);
    else this.showroom.clearCar();
    if (this.showroomStage) {
      const failed = this.heroModels.get(car.glb) === "failed";
      this.showroomStage.dataset.car = car.id;
      this.showroomStage.dataset.model = hero ? "ready" : failed ? "failed" : "loading";
      const message = this.showroomStage.querySelector<HTMLElement>(".showroom-message")!;
      message.hidden = !!hero;
      message.textContent = failed ? "Модель не загрузилась" : "Загрузка модели…";
      this.showroomStage.querySelector<HTMLElement>(".showroom-retry")!.hidden = !failed;
    }
  }

  showScreen(s: GameScreen): void {
    if (s !== "playing" && s !== "paused" && s !== "settings" && s !== "result") {
      if (this.nevaRun) this.exitNevaContract();
      else if (this.screen === "neva-contract" && s !== "neva-contract") this.clearNevaTarget();
      if (this.radioRun) this.exitRadioRun();
    }
    if (s === "cars" && this.screen !== "cars") {
      this.garageReturn = this.screen === "garage" ? "garage" : "title";
      this.garageIndex = CARS.indexOf(this.currentCarSpec());
    }
    if (this.screen === "playing" && s !== "playing") this.creditDrift();
    if (!["playing", "paused", "settings", "result"].includes(s)) this.activeEvent = undefined;
    this.screen = s;
    if (s === "play" || s === "playing") this.prepareWorldModels();
    this.screenEl.dataset.screen = s;
    if (s !== "playing" && s !== "paused") this.tutorialEl.close();
    this.hudEl.style.display = s === "playing" ? "block" : "none";
    if (s !== "playing" && s !== "paused" && s !== "settings") this.countdownLeft = 0;
    this.updateCountdown();
    this.input.setDriving(s === "playing" && !this.tutorialEl.open && this.saveStatus !== "conflict");
    if (s === "title") this.renderTitle();
    else if (s === "career") this.renderCareer();
    else if (s === "play") this.renderPlay();
    else if (s === "neva-contract") this.renderNevaContract();
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
    this.mountShowroomStage();
    this.refreshShowroom();
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
      this.updateCountdown();
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
    const mapName = WORLD_MAPS.find((map) => map.id === p.mapId)?.name ?? "Неоновый Токио";
    const now = new Date();
    const week = utcWeekKey(now);
    const completed = p.weeklyCompletions[week] ?? [];
    const routes = weeklyRoutes(now, p.mapId);
    const featuredWeekly = routes.find((route) => !completed.includes(route.id));
    const showWeeklyEvent = !!featuredWeekly && p.weeklyEventWeek !== week;
    const dismissWeeklyEvent = () => {
      p.weeklyEventWeek = week;
      this.persistProfile();
    };
    const links = [
      ["cars", "Машины", "M3 14l2-5h14l2 5v4H3z M6 18v2m12-2v2M6 14h2m8 0h2"],
      ["garage", "Гараж", "M2 10l10-6 10 6M4 10v10h16V10M8 20v-7h8v7m-8-4h8"],
      ["profile", "Профиль", "M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0z M4 21v-2a8 6 0 0 1 16 0v2"],
    ];
    this.screenEl.style.display = "grid";
    this.screenEl.innerHTML = `
      <div class="title-box home-box">
        <button class="btn home-settings" data-a="settings" aria-label="Настройки">⚙</button>
        <div class="logo-sub">НОЧНОЙ КУРЬЕР · ${mapName.toUpperCase()}</div>
        <h1 class="logo">DELIVERY<span> DRIFT</span> <em>86</em></h1>
        <div class="home-place"><span class="home-place-pin">◉</span><span>${mapName}</span><i>·</i><span>${this.currentCarSpec().name.replace("Toyota ", "")}</span></div>
        <div class="home-actions">
          <button class="btn primary home-play" data-a="play">ВЫЕХАТЬ <span>→</span></button>
          <div class="home-links">
            ${links.map(([action, label, path]) => `<button class="btn" data-a="${action}">
              <svg aria-hidden="true" width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>
              <span>${label}</span></button>`).join("")}
          </div>
        </div>
        <div class="home-career"><span>₽${rubles.format(p.money)}</span><span>Карьера · ${Object.keys(p.career).length}/${EVENTS.length}</span><span>${p.unlockedAch.length}/${ACHIEVEMENTS.length} достижений</span></div>
      </div>
      <div class="showroom-stage home-showroom" data-showroom-stage aria-hidden="${showWeeklyEvent}">
        ${this.showroomStatus()}
      </div>
      ${showWeeklyEvent && featuredWeekly ? `<div class="weekly-event-shade"><section class="weekly-event-card" style="--event-art:url('${MAP_PREVIEWS[p.mapId]}')" role="dialog" aria-modal="true" aria-labelledby="weekly-event-title">
        <div class="journey-eyebrow">СОБЫТИЕ НЕДЕЛИ · ${mapName}</div>
        <h2 id="weekly-event-title">${featuredWeekly.title}</h2>
        <p>Доставь заказ за ${Math.round(featuredWeekly.timeLimit)} с. Пройдено маршрутов за неделю: ${routes.filter(route => completed.includes(route.id)).length} из ${routes.length}.</p>
        <div class="weekly-event-actions"><button class="btn" data-a="event-dismiss">ПОЗЖЕ</button><button class="btn primary" data-a="event-start">НАЧАТЬ ЗАЕЗД →</button></div>
      </section></div>` : ""}`;
    if (showWeeklyEvent) {
      this.screenEl.querySelector<HTMLElement>(".home-box")!.inert = true;
      this.screenEl.querySelector<HTMLElement>(".home-showroom")!.inert = true;
      this.screenEl.querySelector<HTMLButtonElement>('[data-a="event-dismiss"]')?.focus();
    }
    this.bindScreen({
      play: () => this.showScreen("play"),
      settings: () => { this.settingsFrom = "title"; this.showScreen("settings"); },
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
    const upcoming = nextEvent(this.profile.career);
    const activities = [
      { action: "neva", title: NEVA_CONTRACT.title, detail: "Петербург · два поворота с премией за занос", art: "spb" },
      { action: "activity:delivery", title: "Доставка", detail: "Бесконечные заказы · деньги на гараж", art: "tokyo" },
      { action: "activity:drift-trial", title: "Drift Trial", detail: "60 секунд · комбо ×5 · Silvia за серебро", art: "yokohama" },
      { action: "activity:time-attack", title: "Time Attack", detail: "Круг на время · Evo за золото", art: "sochi" },
      { action: "activity:radio-silence", title: RADIO_TITLE, detail: "2 минуты · три погони за пакетами данных", art: "kazan" },
    ] as const;
    this.screenEl.style.display = "flex";
    this.screenEl.innerHTML = `<section class="race-deck" aria-labelledby="race-choice-title">
      <header class="race-head"><button type="button" class="race-back" data-a="back" aria-label="Назад в меню">‹</button>
        <h2 id="race-choice-title">Выбери заезд</h2></header>
      <div class="race-program">
        <button type="button" class="race-poster" data-a="career" style="--poster:url('${MAP_PREVIEWS[upcoming?.map ?? "sochi"]}')">
          <span class="race-poster-copy"><small>Чемпионат · 5 глав</small><b>Карьера</b>
          <span>${upcoming ? "Этап " + upcoming.number + " · " + upcoming.title : "Все этапы пройдены"}</span></span>
          <span class="race-poster-action">К этапам <i aria-hidden="true">→</i></span>
        </button>
        <div class="race-menu" role="group" aria-label="Игровые режимы">${activities.map(mode => `
          <button type="button" class="race-mode" data-a="${mode.action}">
            <img src="${MAP_PREVIEWS[mode.art]}" alt=""><span><b>${mode.title}</b><small>${mode.detail}</small></span><i aria-hidden="true">›</i>
          </button>`).join("")}</div>
      </div></section>`;
    this.bindScreen({ career: () => this.openCareer(), back: () => this.showScreen("title"), neva: () => this.showScreen("neva-contract") });
  }

  private renderNevaContract(): void {
    const best = this.profile.neva.bestScore;
    this.screenEl.style.display = "flex";
    this.screenEl.innerHTML = `<section class="race-deck neva-brief" aria-labelledby="contract-title">
      <header class="race-head"><button type="button" class="race-back" data-a="back" aria-label="К режимам">‹</button>
        <div><small>Петербург · контракт</small><h2 id="contract-title">${NEVA_CONTRACT.title}</h2></div></header>
      <div class="race-brief-body">
        <figure><canvas width="350" height="235" role="img" aria-label="Маршрут через Неву с двумя поворотами"></canvas>
          <figcaption>1 · Дворцовый поворот <span>2 · Съезд с моста</span></figcaption></figure>
        <div class="race-brief-info"><div class="race-brief-scroll">
          <small>Премия за поворот</small><strong>+₽${NEVA_CONTRACT.sectorBonus}</strong>
          <p>Доставь груз через Неву на турбожиге. Пройди в заносе между золотыми линиями.</p>
          <p>Лимит ${NEVA_CONTRACT.timeLimit} с${this.nevaTarget === null ? "" : ` · Результат друга · ${this.nevaTarget} очк.`}${best ? ` · Твой рекорд ${best}` : ""}</p>
        </div><button type="button" class="race-launch" data-a="start-neva">Начать заезд <i aria-hidden="true">→</i></button></div>
      </div></section>`;
    drawNevaPreview(this.screenEl.querySelector("canvas")!);
    this.bindScreen({ "start-neva": () => this.startNevaContract(), back: () => this.showScreen("play") });
  }

  private openCareer(event = nextEvent(this.profile.career) ?? EVENTS[EVENTS.length - 1]): void {
    this.selectedEvent = event;
    this.showScreen("career");
  }

  private renderCareer(): void {
    const event = this.selectedEvent;
    const stars = this.profile.career;
    const district = WORLD_MAPS[event.chapter];
    const available = canRace(event, stars);
    const count = Object.values(stars).reduce((sum, n) => sum + n, 0);
    const buttons: Record<string, () => void> = {
      back: () => this.showScreen("play"),
      launch: () => this.startCareer(event),
    };
    const cities = ["Токио", "Ёкохама", "Петербург", "Казань", "Сочи"];
    const chapters = WORLD_MAPS.map((map, index) => {
      buttons["chapter-" + index] = () => this.openCareer(EVENTS.find(e => e.map === map.id && !stars[e.id]) ?? EVENTS[index * 3 + 2]);
      return `<button type="button" data-a="chapter-${index}" aria-pressed="${index === event.chapter}">
        <span>${cities[index]}</span></button>`;
    }).join("");
    const stages = EVENTS.filter(e => e.map === event.map).map(e => {
      buttons["stage-" + e.number] = () => this.openCareer(e);
      const best = stars[e.id] ?? 0;
      const status = best ? "★".repeat(best) + "☆".repeat(3 - best) : canRace(e, stars) ? "Открыт" : "Закрыт";
      return `<button type="button" data-a="stage-${e.number}" aria-pressed="${event === e}">
        <span><small>ЭТАП ${e.number}</small><i>${status}</i></span><b>${e.title}</b></button>`;
    }).join("");
    this.screenEl.style.display = "flex";
    this.screenEl.innerHTML = `<section class="career-board" aria-label="Карьера">
      <header class="career-mast"><button class="career-back" type="button" data-a="back" aria-label="Назад к заездам">←</button>
        <h2>Карьера</h2><nav aria-label="Главы карьеры">${chapters}</nav>
        <strong class="career-score" aria-label="Звёзды чемпионата: ${count} из 45"><i>★</i> ${count}<small>/45</small></strong>
      </header>
      <div class="career-atlas">
        <div class="career-city" style="--district-image:url('${MAP_PREVIEWS[event.map]}')">
          <div class="career-caption"><small>ГЛАВА ${String(event.chapter + 1).padStart(2,"0")} / 05</small><h3>${cities[event.chapter]}</h3>
          <p>${WORLD_MAPS[event.chapter+1] ? "За финал главы · " + WORLD_MAPS[event.chapter+1].name : "Финал чемпионата"}</p></div>
        </div>
        <div class="career-stages" role="group" aria-label="Этапы · ${district.name}">${stages}</div>
        <aside class="career-brief" aria-label="Задание этапа">
          <div class="career-objectives"><div class="career-docket"><small>ЭТАП ${String(event.number).padStart(2,"0")} / 15</small><strong>${MODE_NAMES[event.mode]}</strong></div>
          <h3>${event.title}</h3>
          <ul>${[1,2,3].map(t => `<li><b aria-label="Звёзд: ${t}">${"★".repeat(t)}</b><span>${goal(event,t)}</span></li>`).join("")}</ul>
          <div class="career-prize"><span>За новую звезду</span><strong>+ ₽${100+50*event.chapter}</strong></div></div>
          <button class="career-launch" type="button" data-a="launch" ${available ? "" : "disabled"}><b>${available ? stars[event.id] ? "Улучшить результат" : "На старт" : "Пройди этап " + (event.number-1)}</b><i class="career-arrow" aria-hidden="true"></i></button>
        </aside>
      </div></section>`;
    this.bindScreen(buttons);
    const activeChapter = this.screenEl.querySelector<HTMLElement>(".career-mast nav [aria-pressed=true]");
    activeChapter?.scrollIntoView({ inline: "nearest", block: "nearest" });
    const cover = this.screenEl.querySelector<HTMLElement>(".career-city")!;
    let startX = 0;
    cover.onpointerdown = e => { startX = e.clientX; cover.setPointerCapture(e.pointerId); };
    cover.onpointerup = e => {
      const dx = e.clientX - startX;
      if (Math.abs(dx) >= 44) buttons["chapter-" + (event.chapter - Math.sign(dx))]?.();
    };
  }

  private continueCareer(): void {
    if (this.activeEvent && !this.lastResult.ok) this.startCareer(this.activeEvent);
    else this.openCareer();
  }

  private startCareer(event: CareerEvent): void {
    if (!canRace(event, this.profile.career) || !this.selectMap(event.map)) return;
    this.activeEvent = event;
    this.careerHudGoal = `Этап ${event.number} · ${goal(event,1)}`;
    if (event.mode !== "delivery") {
      this.startMode(event.mode);
      return;
    }
    let seed = 86 + event.chapter;
    const route = sampleDeliveryDestination(this.world.layout, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    }, new Set(), 100 + event.chapter * 12, 330);
    if (!route) throw new Error("Missing career route " + event.id);
    this.startOrder({...route, id:this.orderId++, title:event.title, reward:400 + event.chapter*120,
      timeLimit:Math.ceil(route.distance/10)+38, fragility:1+event.chapter*.12});
  }

  private renderTracks(): void {
    const cards = WORLD_MAPS.map((map, index) => {
      const locked = !mapOpen(map.id, this.profile);
      const selected = this.profile.mapId === map.id;
      return `<button type="button" class="race-track" data-a="map:${map.id}" ${locked ? "disabled" : ""} aria-pressed="${selected}">
        <span class="track-art"><img src="${MAP_PREVIEWS[map.id]}" alt="" width="768" height="340" decoding="async"></span>
        <span class="race-track-copy"><small>Глава ${String(index + 1).padStart(2, "0")}${selected ? " · Текущая локация" : ""}</small><b>${map.name}</b>
          <span>${locked ? `Пройди этап ${index * 3} · ${EVENTS[index * 3 - 1]?.title}` : map.description}</span></span>
        <span class="race-track-action">${locked ? "Закрыто" : "Начать заезд"}<i aria-hidden="true">${locked ? "◇" : "→"}</i></span>
      </button>`;
    }).join("");
    this.screenEl.style.display = "flex";
    this.screenEl.innerHTML = `<section class="race-deck" aria-labelledby="track-choice-title">
      <header class="race-head"><button type="button" class="race-back" data-a="back" aria-label="К режимам">‹</button>
        <div><small>${MODE_NAMES[this.pendingMode]}</small><h2 id="track-choice-title">Выбери место</h2></div>
        <div class="race-stepper"><button type="button" data-a="prev" aria-label="Предыдущая локация">‹</button>
        <button type="button" data-a="next" aria-label="Следующая локация">›</button></div></header>
      <div class="race-track-strip" role="region" aria-label="Локации" tabindex="0">${cards}</div></section>`;
    const strip = this.screenEl.querySelector<HTMLElement>(".race-track-strip")!;
    const stepper = this.screenEl.querySelector<HTMLElement>(".race-stepper")!;
    const previous = stepper.querySelector<HTMLButtonElement>('[data-a="prev"]')!;
    const next = stepper.querySelector<HTMLButtonElement>('[data-a="next"]')!;
    const move = (direction: number) => {
      const cardWidth = strip.firstElementChild!.getBoundingClientRect().width;
      const gap = parseFloat(getComputedStyle(strip).columnGap);
      strip.scrollBy({
        left: direction * (cardWidth + gap),
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      });
    };
    const update = () => {
      previous.disabled = strip.scrollLeft <= 1;
      next.disabled = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 1;
    };
    strip.addEventListener("scroll", update, { passive: true });
    const selected = strip.querySelector<HTMLElement>('[aria-pressed="true"]');
    selected?.scrollIntoView({ inline: "nearest", block: "nearest" });
    update();
    this.bindScreen({ back: () => this.showScreen("play"), prev: () => move(-1), next: () => move(1) });
  }

  private renderCars(): void {
    const roster = CARS.map(car => `<button type="button" class="garage-tab" data-a="inspect:${car.id}" aria-pressed="false" style="--car-paint:#${car.color.toString(16).padStart(6, "0")}">
      <img src="${new URL(`../assets/ui/roster/${car.id}.webp`, import.meta.url).href}" alt="">
      <span class="garage-tab-name">${car.name.split(" «")[0]}</span>
    </button>`).join("");
    this.screenEl.style.display = "grid";
    this.screenEl.innerHTML = `
      <section class="motor-garage" aria-labelledby="garage-title">
        <header class="garage-header">
          <button class="btn small" type="button" data-a="back" aria-label="Назад">←</button>
          <h2 id="garage-title">Выбор машины</h2>
          <span class="garage-balance" aria-label="Баланс">₽${rubles.format(this.profile.money)}</span>
        </header>
        <div class="garage-display">
          <div class="showroom-stage garage-stage" data-showroom-stage tabindex="0" role="region" aria-label="Осмотр машины">
            ${this.showroomStatus()}
          </div>
          <article class="garage-detail" aria-labelledby="garage-car-name"></article>
        </div>
        <nav class="garage-picker" aria-label="Выбор машины">
          <button type="button" class="garage-arrow" data-a="car-prev" aria-label="Предыдущая машина">‹</button>
          <div class="garage-roster">${roster}</div>
          <button type="button" class="garage-arrow" data-a="car-next" aria-label="Следующая машина">›</button>
        </nav>
      </section>`;
    this.bindScreen({
      ...Object.fromEntries(CARS.map((car, index) => [`inspect:${car.id}`, () => this.inspectCar(index)])),
      "car-prev": () => this.inspectCar((this.garageIndex + CARS.length - 1) % CARS.length),
      "car-next": () => this.inspectCar((this.garageIndex + 1) % CARS.length),
      back: () => this.showScreen(this.garageReturn),
    });
    this.renderCarDetails();
  }

  private inspectCar(index: number): void {
    if (this.garageIndex === index) return;
    this.garageIndex = index;
    this.renderCarDetails();
    this.refreshShowroom();
  }

  private renderCarDetails(): void {
    const p = this.profile;
    const car = CARS[this.garageIndex];
    const tuned = tunedSpec(car, p.upgrades[car.id] ?? STOCK_UPGRADES);
    const owned = p.ownedCars.includes(car.id);
    const current = p.carId === car.id;
    const locked = !owned && !canUnlockCar(car, p);
    const goal = ACHIEVEMENTS.find(({ id }) => id === car.unlockAchievement);
    const need = car.unlockDeliveries ?? 0;
    const shortfall = car.price - p.money;
    const action = current ? '<button class="btn" disabled>Выбрана</button>'
      : owned ? `<button class="btn primary" data-a="select:${car.id}">Выбрать</button>`
      : `<button class="btn ${!locked && shortfall <= 0 ? "primary" : ""}" data-a="buy:${car.id}" ${locked || shortfall > 0 ? "disabled" : ""}>Купить · ₽${rubles.format(car.price)}</button>`;
    const note = locked
      ? `${p.deliveries} из ${need} доставок${goal ? ` или ${goal.tier === "silver" ? "серебро" : goal.tier === "gold" ? "золото" : "достижение"} «${goal.name}»` : ""}`
      : !owned && shortfall > 0 ? `Не хватает ₽${rubles.format(shortfall)}` : "";
    const detail = this.screenEl.querySelector<HTMLElement>(".garage-detail")!;
    detail.innerHTML = `
      <div class="garage-inspection"><div class="garage-ingress"><span class="car-counter">${String(this.garageIndex + 1).padStart(2, "0")} / ${String(CARS.length).padStart(2, "0")}</span><p class="garage-status">${owned ? "В гараже" : locked ? "Закрыта" : "Доступна"}</p></div>
      <h3 id="garage-car-name">${car.name}</h3>
      <dl class="garage-specs">
        <div class="garage-speed"><dt>Скорость</dt><dd>${speedKmh(tuned.topSpeed)} <small>км/ч</small></dd></div>
        <div class="garage-accel"><dt>Разгон</dt><dd>${tuned.accel.toFixed(1).replace(".", ",")}</dd></div>
        <div class="garage-grip"><dt>Сцепление</dt><dd>${tuned.grip.toFixed(1).replace(".", ",")}</dd></div>
      </dl>
      ${note ? `<p class="garage-unlock">${note}</p>` : ""}
      ${car.id === NEVA_CAR.id ? `<a class="garage-credit" href="https://sketchfab.com/3d-models/lada-2107-low-poly-5959908e4e304234b22f3436291cb588" target="_blank" rel="noopener">Кузов · Name’s_Been_Classified · CC BY 4.0</a>` : ""}</div>
      <div class="garage-purchase">${action}</div>`;
    this.bindScreen({}, detail);
    for (const tab of this.screenEl.querySelectorAll<HTMLButtonElement>(".garage-tab")) {
      const active = tab.dataset.a === `inspect:${car.id}`;
      tab.setAttribute("aria-pressed", String(active));
      if (active) tab.scrollIntoView({ inline: "nearest", block: "nearest" });
    }
  }

  private garagePart: keyof UpgradeLevels | "body" = "engine";

  private renderGarage(): void {
    const parts = [...UPGRADE_DEFS, { key: "body" as const, name: "Кузов" }];
    this.screenEl.style.display = "grid";
    this.screenEl.innerHTML = `
      <section class="garage pit">
        <div class="showroom-stage pit-stage" data-showroom-stage>${this.showroomStatus()}</div>
        <header class="pit-head">
          <button data-a="back" aria-label="Назад в меню">‹</button>
          <strong>ГАРАЖ</strong><span>₽ ${rubles.format(this.profile.money)}</span>
        </header>
        <div class="pit-car"><h2>${this.currentCarSpec().name}</h2><button data-a="cars">Сменить машину ›</button></div>
        <article class="pit-detail" aria-live="polite"></article>
        <nav class="pit-rack" aria-label="Оборудование машины">${parts.map(part => `
          <button data-a="part:${part.key}" data-part="${part.key}"><i></i><span>${part.name}</span></button>`).join("")}</nav>
      </section>`;
    this.bindScreen({
      back: () => this.showScreen("title"),
      cars: () => this.showScreen("cars"),
      ...Object.fromEntries(parts.map(part => [`part:${part.key}`, () => {
        this.garagePart = part.key;
        this.renderGaragePart();
      }])),
    });
    this.renderGaragePart();
  }

  private renderGaragePart(): void {
    const key = this.garagePart;
    const def = UPGRADE_DEFS.find(item => item.key === key);
    const upgrade = this.currentUpgrades();
    const car = this.currentCarSpec();
    const current = tunedSpec(car, upgrade);
    const body = key === "body";
    const level = body ? 0 : upgrade[key];
    const complete = body ? this.car.hp >= 100 : level >= UPGRADE_MAX;
    const next = tunedSpec(car, body ? upgrade : { ...upgrade, [key]: Math.min(level + 1, UPGRADE_MAX) });
    const values = {
      engine: [speedKmh(current.topSpeed), speedKmh(next.topSpeed), "км/ч", "Макс. скорость"],
      tires: [current.grip.toFixed(1), next.grip.toFixed(1), "", "Сцепление"],
      suspension: [Math.round(current.cargoProtect * 100), Math.round(next.cargoProtect * 100), "%", "Защита груза"],
      turbo: [current.accel.toFixed(1), next.accel.toFixed(1), "", "Разгон"],
      body: [Math.round(this.car.hp), 100, "%", "Состояние кузова"],
    };
    const [from, to, unit, metric] = values[key];
    const cost = body ? this.repairCost : UPGRADE_COST[level];
    const missing = complete ? 0 : Math.max(0, cost - this.profile.money);
    const detail = this.screenEl.querySelector<HTMLElement>(".pit-detail")!;
    detail.dataset.part = key;
    detail.innerHTML = `
      <div class="pit-readout"><small>${body ? "ОБСЛУЖИВАНИЕ" : `ТЮНИНГ / УРОВЕНЬ ${level} ИЗ ${UPGRADE_MAX}`}</small>
      <h3>${def?.name ?? "Кузов"}</h3>
      <div class="pit-level" aria-hidden="true" style="--completed:${body ? Math.max(0, Math.min(100, this.car.hp)) : 100 * level / UPGRADE_MAX}%"></div>
      <div class="pit-stat"><span>${metric}</span><b>${from}${complete ? "" : ` <em>→ ${to}</em>`} ${unit}</b></div>
      ${missing ? `<span class="pit-missing">Не хватает ₽ ${rubles.format(missing)}</span>` : ""}</div>
      <button class="pit-install" data-a="${body ? "repair" : `up:${key}`}" ${complete || missing ? "disabled" : ""}>
        ${complete ? (body ? "Кузов исправен" : "Макс. уровень") : `${body ? "Ремонт" : "Установить"} <b>₽ ${rubles.format(cost)}</b>`}</button>`;
    this.bindScreen({ repair: () => this.repairCar() }, detail);
    for (const tab of this.screenEl.querySelectorAll<HTMLButtonElement>(".pit-rack button")) {
      const selected = tab.dataset.a === `part:${key}`;
      tab.setAttribute("aria-pressed", String(selected));
      if (selected) tab.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
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
    this.showScreen("garage");
  }

  private renderOrders(): void {
    if (this.orders.length === 0) this.genOrders();
    const cards = this.orders.map((order, i) => `
      <button type="button" class="race-order" data-a="take:${i}">
        <span class="race-order-copy"><small>${CARGO_NAMES[order.id % CARGO_NAMES.length]}</small><b>${order.title}</b>
          <span>≈ ${Math.round(order.distance)} м · ${order.timeLimit} с · Хрупкость ×${order.fragility.toFixed(1)}</span></span>
        <span class="race-pay"><small>Выплата</small><b>₽${order.reward}+</b></span><i aria-hidden="true">›</i>
      </button>`).join("");
    this.screenEl.style.display = "flex";
    this.screenEl.innerHTML = `<section class="race-deck" aria-labelledby="orders-title">
      <header class="race-head"><button type="button" class="race-back" data-a="back" aria-label="В гараж">‹</button>
        <h2 id="orders-title">Выбор заказа</h2></header>
      <div class="race-dispatch">
        <div class="race-poster" style="--poster:url('${MAP_PREVIEWS[this.profile.mapId]}')">
          <div class="race-poster-copy"><small>Служба доставки</small><b>${WORLD_MAPS.find(map => map.id === this.profile.mapId)?.name}</b></div></div>
        <div class="race-menu" role="group" aria-label="Доступные заказы">${cards}</div>
      </div></section>`;
    this.bindScreen({ back: () => this.showScreen("garage") });
  }

  private renderPaused(): void {
    this.screenEl.style.display = "flex";
    this.screenEl.innerHTML = `
      <section class="pit-pause" aria-labelledby="pause-heading">
        <header style="--pause-art:url('${MAP_PREVIEWS[this.world.mapId]}')">
          <span>${WORLD_MAPS.find(map => map.id === this.world.mapId)?.name}</span>
          <h2 id="pause-heading">Пауза</h2>
          <strong>${this.nevaRun ? NEVA_CONTRACT.title : MODE_NAMES[this.mode]}</strong>
        </header>
        <div class="pit-actions">
          <nav aria-label="Действия в заезде">
            <button data-a="retry">${this.mode === "delivery" && !this.nevaRun ? "Заново заказ" : "Заново заезд"}</button>
            <button data-a="help">Как играть</button>
            <button data-a="settings">Настройки</button>
            <button data-a="sound">${this.profile.muted ? "Включить звук" : "Выключить звук"}</button>
            <button data-a="quit">В главное меню</button>
          </nav>
          <button class="pit-primary" data-a="resume">Продолжить <i aria-hidden="true">›</i></button>
        </div>
      </section>`;
    this.bindScreen({
      resume: () => this.togglePause(),
      retry: () => {
        if (this.activeEvent) this.startCareer(this.activeEvent);
        else if (this.nevaRun) this.startNevaContract();
        else if (this.mode === "delivery" && this.order) this.startOrder(this.order);
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
      <section class="driver-hub dh-settings" aria-labelledby="dh-title">
        <header class="dh-header"><button class="dh-back" data-a="back" aria-label="Назад">‹</button><h2 id="dh-title">Настройки</h2></header>
        <div class="dh-scroll dh-soundroom"><div class="dh-soundface"><span>Уровень звука</span><strong id="vol-label">${Math.round(p.volume * 100)}%</strong><div class="dh-wave" aria-hidden="true">${[28,42,62,48,80,54,92,70,46,34,62,84,54,38,20].map(h => `<i style="height:${h}%"></i>`).join("")}</div></div>
          <div class="dh-mixer"><label for="vol-slider">Общая громкость</label><input type="range" id="vol-slider" min="0" max="100" value="${Math.round(p.volume * 100)}"><div class="dh-limits" aria-hidden="true"><span>0%</span><span>100%</span></div>
          <button class="sound-switch dh-switch" role="switch" aria-checked="${!p.muted}" data-a="sound"><span>Звук</span><b>${p.muted ? "Выкл" : "Вкл"}</b><i aria-hidden="true"></i></button></div></div>
      </section>`;
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
        const toggle = this.screenEl.querySelector(".sound-switch");
        toggle?.setAttribute("aria-checked", "true");
        if (toggle) toggle.querySelector("b")!.textContent = "Вкл";
      }
      this.persistProfile();
    });
  }

  private renderAchievements(): void {
    const p = this.profile;
    const tiers = { bronze: "Бронза", silver: "Серебро", gold: "Золото" };
    const total = ACHIEVEMENTS.length;
    const earned = ACHIEVEMENTS.filter(a => p.unlockedAch.includes(a.id)).length;
    const cards = ACHIEVEMENTS.map(a => {
      const got = p.unlockedAch.includes(a.id);
      return `<article class="dh-trophy ${got ? "earned" : "locked"}">
        <span aria-hidden="true" class="dh-medal ${a.tier ?? ""}">${a.icon}</span>
        <div><small>${got ? "Открыто" : "В работе"}${a.tier ? ` · ${tiers[a.tier]}` : ""}</small>
        <h3>${a.name}</h3><p>${a.desc}</p><strong>${a.progress(p) ?? ""}</strong></div></article>`;
    }).join("");
    this.screenEl.style.display = "flex";
    this.screenEl.innerHTML = `<section class="driver-hub" aria-labelledby="dh-title">
      <header class="dh-header"><button class="dh-back" data-a="back" aria-label="Назад в профиль">‹</button>
      <h2 id="dh-title">Достижения</h2></header>
      <div class="dh-ach-layout"><aside class="dh-collection"><small>Коллекция</small><strong>${earned}<em>/ ${total}</em></strong>
      <progress aria-label="Открытые достижения" value="${earned}" max="${total}"></progress>
      <div class="dh-filter"><button data-a="all" aria-pressed="true">Все</button><button data-a="earned" aria-pressed="false">Открытые</button></div></aside>
      <div class="dh-scroll dh-shelf" tabindex="0" aria-label="Коллекция достижений">${cards}<p class="dh-empty" hidden>Здесь появятся открытые тобой достижения.</p></div></div></section>`;
    const filter = (onlyEarned: boolean) => {
      this.screenEl.querySelectorAll<HTMLElement>(".dh-trophy.locked").forEach(card => card.hidden = onlyEarned);
      this.screenEl.querySelector<HTMLElement>(".dh-empty")!.hidden = !onlyEarned || earned > 0;
      this.screenEl.querySelector('[data-a="all"]')!.setAttribute("aria-pressed", String(!onlyEarned));
      this.screenEl.querySelector('[data-a="earned"]')!.setAttribute("aria-pressed", String(onlyEarned));
      this.screenEl.querySelector(".dh-shelf")!.scrollTop = 0;
    };
    this.bindScreen({ back: () => this.showScreen("profile"), all: () => filter(false), earned: () => filter(true) });
  }

  private renderProfile(): void {
    const p = this.profile;
    const rows = Object.keys(p.records).sort().flatMap(key => {
      const entry = recordDetails(key);
      if (!entry) return [];
      const { mapId, mode, car } = entry;
      const mapName = WORLD_MAPS.find(item => item.id === mapId)!.name;
      const value = p.records[key];
      const rounded = Math.round(value).toLocaleString("ru-RU");
      const metric = mode === "time-attack" ? `${value.toFixed(1)} с` : mode === "delivery" ? `₽${rounded}` : `${rounded} очк.`;
      return [`<article class="record-row dh-record" style="--course:url('${MAP_PREVIEWS[mapId]}')"><small>${MODE_NAMES[mode]}</small><strong>${metric}</strong><h3>${mapName}</h3><p>${car.name}</p></article>`];
    });
    if (p.neva.bestScore) rows.unshift(
      `<article class="record-row dh-record dh-neva"><small>${NEVA_CONTRACT.title}</small><strong>${p.neva.bestScore} очк.</strong><h3>Петербург</h3><p>LADA 2107 Turbo</p></article>`,
    );
    const now = new Date();
    const week = utcWeekKey(now);
    const routes = weeklyRoutes(now, p.mapId);
    const completed = p.weeklyCompletions[week] ?? [];
    const weeklyCards = routes.map((route, i) => {
      const done = completed.includes(route.id);
      return `<article class="dh-route"><div><small>${done ? "Уже пройден" : "Доступен"}</small><h3>${route.title}</h3><p>${route.timeLimit} сек · ${Math.round(route.distance)} м</p></div>
      <button data-a="weekly:${i}">${done ? "Повторить" : "Старт"} <span aria-hidden="true">›</span></button></article>`;
    }).join("");
    const car = this.currentCarSpec();
    this.screenEl.style.display = "flex";
    this.screenEl.innerHTML = `<section class="driver-hub" aria-labelledby="dh-title">
      <header class="dh-header"><button class="dh-back" data-a="back" aria-label="В меню">‹</button><h2 id="dh-title">Профиль</h2>
      <button class="dh-trophylink" data-a="achievements">Достижения <b>${p.unlockedAch.length}/${ACHIEVEMENTS.length}</b></button></header>
      <div class="dh-profile-layout"><aside class="dh-license"><div class="dh-driver-car" style="--car:url('${new URL(`../assets/ui/roster/${car.id}.webp`, import.meta.url).href}')"><span>Моя машина</span><b>${car.name}</b></div>
      <nav aria-label="Разделы профиля"><button data-a="records-tab" aria-pressed="true">Личные рекорды</button>
      <button data-a="weekly-tab" aria-pressed="false">Недельные маршруты</button></nav></aside>
      <div class="dh-scroll dh-profile-pane" data-pane="records" tabindex="0"><h3>Личные рекорды</h3><p>Лучшие результаты по карте, режиму и машине</p>
      <div class="dh-records">${rows.join("") || `<div class="dh-debut" style="--course:url('${MAP_PREVIEWS[p.mapId]}')"><h3>Первый финиш</h3><p>Заверши заезд, чтобы поставить свой первый рекорд.</p></div>`}</div></div>
      <div class="dh-scroll dh-profile-pane" data-pane="weekly" tabindex="0" hidden><h3>Недельные маршруты</h3><p>Неделя UTC ${week} · новый набор каждый понедельник. Обычные доставки доступны без ограничений.</p><div class="dh-routes">${weeklyCards}</div></div>
      </div></section>`;
    const selectPane = (name: string) => {
      this.screenEl.querySelectorAll<HTMLElement>("[data-pane]").forEach(pane => {
        pane.hidden = pane.dataset.pane !== name;
        this.screenEl.querySelector(`[data-a="${pane.dataset.pane}-tab"]`)!.setAttribute("aria-pressed", String(!pane.hidden));
      });
    };
    this.bindScreen({
      back: () => this.showScreen("title"), achievements: () => this.showScreen("achievements"),
      "records-tab": () => selectPane("records"), "weekly-tab": () => selectPane("weekly"),
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

  private lastResult: {
    ok: boolean; lines: string[]; mode?: GameMode; title?: string; nevaScore?: number;
    metric: { label: string; value: string };
    gauges?: { label: string; value: number }[];
    record?: string;
    rewards?: { label: string; amount: number }[];
  } = { ok: false, lines: [], metric: { label: "", value: "" } };

  private renderResult(): void {
    const r = this.lastResult;
    const event = this.activeEvent;
    const title = r.title ?? (r.ok ? "ДОСТАВЛЕНО!" : "ЗАКАЗ ПРОВАЛЕН");
    const district = WORLD_MAPS.find(map => map.id === this.world.mapId)!;
    const primaryAction = event ? "career-next" : r.mode || this.nevaRun ? "replay" : "more";
    const primaryLabel = event
      ? r.ok ? event.number === EVENTS.length ? "К итогам карьеры" : "К этапам" : "Повторить этап"
      : primaryAction === "replay" ? "Повторить заезд" : "Ещё заказ";
    const detailRows = r.lines.map(line => {
      const divider = line.indexOf(": ");
      if (divider < 0 || line.includes("<")) return `<li>${line}</li>`;
      return `<li class="finish-split"><span>${line.slice(0, divider + 1)}</span> <strong>${line.slice(divider + 2)}</strong></li>`;
    }).join("");
    const gauges = r.gauges?.map(({label,value}) => `<div class="finish-gauge">
      <span>${label}</span><strong>${Math.round(value)}<small>%</small></strong>
      <i aria-hidden="true" style="--level:${Math.max(0,Math.min(100,value))}%"></i></div>`).join("") ?? "";
    const rewards = r.rewards?.map(({label,amount}) => `<div class="finish-reward"><span>${label}</span><b>₽${rubles.format(amount)}</b></div>`).join("") ?? "";
    this.screenEl.style.display = "flex";
    this.screenEl.innerHTML = `
      <section class="race-finish result ${r.ok ? "ok" : "bad"}" aria-labelledby="finish-heading" style="--finish-art:url('${MAP_PREVIEWS[this.world.mapId]}')">
        <div class="finish-poster">
          <div class="finish-location"><i aria-hidden="true"></i>${district.name}</div>
          <div class="finish-hero">
            <span class="finish-status">${r.ok ? "Финиш" : "Попытка не удалась"}${event ? ` · Этап ${event.number}` : ""}</span>
            <h2 id="finish-heading">${title}</h2>
            <div class="finish-metric"><strong>${r.metric.value}</strong><span>${r.metric.label}</span></div>
          </div>
        </div>
        <div class="finish-report">
          <h3>Итоги заезда</h3>
          <div class="finish-scroll" tabindex="0" aria-label="Подробности заезда">
            ${gauges ? `<div class="finish-gauges">${gauges}</div>` : ""}
            ${rewards ? `<div class="finish-rewards">${rewards}</div>` : ""}
            ${r.record ? `<div class="finish-record"><i aria-hidden="true">★</i><span>Личный рекорд</span><strong>${r.record}</strong></div>` : ""}
            <ul class="result-lines">${detailRows}</ul>
          </div>
          ${r.nevaScore === undefined ? "" : `<div class="neva-share" hidden><input aria-label="Ссылка на вызов" readonly><small role="status"></small></div>`}
        </div>
        <footer class="finish-actions">
          <button type="button" class="finish-back" data-a="menu"><i aria-hidden="true">‹</i> В меню</button>
          <button type="button" data-a="garage">В гараж</button>
          ${r.nevaScore === undefined ? "" : '<button type="button" class="finish-share" data-a="share-neva">Бросить вызов другу</button>'}
          <button type="button" class="finish-next" data-a="${primaryAction}">${primaryLabel}<i class="career-arrow" aria-hidden="true"></i></button>
        </footer>
      </section>`;
    this.bindScreen({
      "career-next": () => this.continueCareer(),
      more: () => this.gotoOrders(),
      replay: () => {
        if (this.nevaRun) this.startNevaContract();
        else if (r.mode) this.startMode(r.mode);
      },
      "share-neva": () => { if (r.nevaScore !== undefined) void this.shareNeva(r.nevaScore); },
      garage: () => this.showScreen("garage"),
      menu: () => this.showScreen("title"),
    });
  }

  private async shareNeva(score: number): Promise<void> {
    const box = this.screenEl.querySelector<HTMLElement>(".neva-share")!;
    const field = box.querySelector<HTMLInputElement>("input")!;
    const status = box.querySelector("small")!;
    field.value = nevaChallengeLink(window.location.href, score);
    box.hidden = false;
    try {
      await navigator.clipboard.writeText(field.value);
      status.textContent = "Ссылка скопирована";
    } catch {
      field.focus();
      field.select();
      status.textContent = "Скопируй ссылку из поля";
    }
  }

  private bindScreen(actions: Record<string, () => void>, scope = this.screenEl): void {
    scope.querySelectorAll("[data-a]").forEach((n) => {
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
        if (act === "activity") {
          const mode = ACTIVITY_MODES.find((item) => item === arg);
          if (mode) {
            this.pendingMode = mode;
            this.showScreen("tracks");
            return;
          }
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
    if (!mapOpen(mapId, this.profile)) return false;
    if (this.activeWorld?.mapId !== mapId) this.useWorld(mapId);
    if (this.profile.mapId !== mapId) {
      this.profile.mapId = mapId;
      this.persistProfile();
    }
    return true;
  }

  private applyCityLight(mapId: MapId): void {
    const style = CITY_STYLE[mapId];
    this.scene.background = new THREE.Color(style.horizon);
    this.scene.fog = new THREE.FogExp2(style.horizon, style.fog);
    this.ambientLight.color.setHex(style.fill);
    this.ambientLight.groundColor.setHex(style.bounce);
    this.keyLight.color.setHex(style.sun);
    this.keyLight.intensity = style.sunIntensity;
    this.accentLight.color.setHex(style.accent);
    this.accentLight.intensity = style.accentIntensity;
  }

  private useWorld(mapId: MapId): void {
    if (this.activeWorld?.mapId !== mapId) {
      let nextWorld = this.worldCache.get(mapId);
      if (!nextWorld) {
        nextWorld = new World(mapId);
        if (this.midriseAsset) nextWorld.setHeroBuildings(this.midriseAsset.root, this.midriseAsset.size);
      }
      this.activeWorld?.group.removeFromParent();
      this.worldCache.delete(mapId);
      this.worldCache.set(mapId, nextWorld);
      if (this.worldCache.size > WORLD_CACHE_LIMIT) {
        const oldest = this.worldCache.keys().next().value!;
        this.worldCache.get(oldest)!.dispose();
        this.worldCache.delete(oldest);
      }
      this.activeWorld = nextWorld;
      this.applyCityLight(mapId);
      this.scene.add(this.world.group);
      this.orders = [];
      this.redFinedX.clear();
      this.greenCooldown.clear();
      this.world.hideDestination();
      this.car.resetPose(0, 0, Math.PI);
      this.activeTraffic?.setWorld(nextWorld, this.car.pos);
      this.police.stop();
    }
    this.buildMinimapBase();
  }

  private prepareWorldModels(): void {
    if (this.worldModelsRequested) return;
    this.worldModelsRequested = true;
    void loadGameAssets().then((assets) => {
      if (this.disposed) {
        for (const model of [...assets.traffic, assets.police, assets.midrise]) {
          if (model) disposeCarVisual(model.root);
        }
        return;
      }
      this.assetsReady = true;
      this.traffic.setCarModels(assets.traffic.map((m) => m.root));
      if (assets.police) this.police.setModel(assets.police.root, assets.police.size.y + 0.05);
      if (assets.midrise) {
        this.midriseAsset = assets.midrise;
        for (const world of this.worldCache.values()) {
          world.setHeroBuildings(assets.midrise.root, assets.midrise.size);
        }
      }
    });
  }

  // ================= profile / economy =================

  private currentCarSpec(): CarSpec {
    return CARS.find((c) => c.id === this.profile.carId) ?? CARS[0];
  }

  private heroFor(car: CarSpec): LoadedModel | undefined {
    const model = this.heroModels.get(car.glb);
    return typeof model === "object" ? model : undefined;
  }

  private requestHero(key: HeroModelKey): Promise<void> | undefined {
    if (this.heroModels.has(key)) return;
    this.heroModels.set(key, "loading");
    return loadHeroModel(key).then((model) => {
      if (this.disposed) {
        disposeCarVisual(model.root);
        return;
      }
      this.heroModels.set(key, model);
      if (this.careerCar.spec.glb === key) this.careerCar.setHeroModel(model);
      if (this.nevaCar?.spec.glb === key) this.nevaCar.setHeroModel(model);
      if (this.radioCar?.spec.glb === key) this.radioCar.setHeroModel(model);
    }, () => {
      if (!this.disposed) this.heroModels.set(key, "failed");
    }).then(() => {
      if (!this.disposed && this.showroomSpec().glb === key) this.refreshShowroom();
    });
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
    this.showScreen("garage");
  }

  private applyCarSpec(): void {
    const up = this.currentUpgrades();
    const car = this.currentCarSpec();
    this.careerCar.setSpec(tunedSpec(car, up), this.heroFor(car) ?? null);
    this.careerCar.setUpgrades(up);
    this.requestHero(car.glb);
    this.refreshShowroom();
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

  private startMode(mode: GameMode): void {
    if (mode === "radio-silence") {
      this.startRadioRun();
      return;
    }
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

  private startRadioRun(): void {
    if (!this.radioCar) {
      const spec = this.currentCarSpec();
      const upgrades = this.currentUpgrades();
      const car = new Car(tunedSpec(spec, upgrades));
      this.configureCar(car);
      car.setUpgrades(upgrades);
      const hero = this.heroFor(spec);
      if (hero) car.setHeroModel(hero);
      this.radioCar = car;
      this.careerCar.group.removeFromParent();
      this.scene.add(car.group);
      this.car = car;
    } else if (this.radioCar.hp < 100 || this.radioCar.wrecked) {
      this.radioCar.repair();
    }
    const run = new RadioRun(radioCourse(this.world.mapId));
    this.radioRun = run;
    this.buildMinimapBase();
    this.nitroFuel = 100;
    this.startOrder({ id: this.orderId++, title: RADIO_TITLE, dest: run.target,
      timeLimit: RADIO_TIME, reward: 0, fragility: 0, distance: 0 }, "radio-silence");
  }

  private exitRadioRun(): void {
    this.police.stop();
    this.world.hideDestination();
    if (this.radioCache) this.radioCache.visible = false;
    this.radioRun = null;
    this.order = null;
    if (this.radioCar) {
      this.radioCar.group.removeFromParent();
      this.radioCar.dispose();
      this.radioCar = null;
    }
    this.car = this.careerCar;
    this.scene.add(this.careerCar.group);
    this.buildMinimapBase();
  }

  private updateRadioMarkers(run: RadioRun): void {
    if (!this.order) return;
    this.order.dest = run.target;
    const isTransmitter = run.phase === "transmitter";
    this.world.setDestination(run.target.x, run.target.z, isTransmitter ? RADIO_SIGNAL_COLOR : 0x22ffcc, RADIO_GATE_RADIUS);
    const showCache = run.phase === "pursuit" && !run.carryingPacket;
    if (showCache && !this.radioCache) {
      const group = new THREE.Group();
      group.name = "radio-cache";
      const halo = new THREE.Mesh(new THREE.RingGeometry(RADIO_CACHE_RADIUS - 0.55, RADIO_CACHE_RADIUS, 24),
        new THREE.MeshBasicMaterial({ color: RADIO_CACHE_COLOR, transparent: true, opacity: 0.88 }));
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = 0.13;
      const icon = new THREE.Mesh(new THREE.OctahedronGeometry(1.05),
        new THREE.MeshBasicMaterial({ color: RADIO_CACHE_COLOR }));
      icon.position.y = 2.55;
      group.add(halo, icon);
      this.scene.add(group);
      this.radioCache = group;
    }
    if (this.radioCache) {
      this.radioCache.visible = showCache;
      this.radioCache.position.set(run.leg.cache.x, 0, run.leg.cache.z);
    }
  }

  private gotoOrders(): void {
    this.genOrders();
    this.showScreen("orders");
  }

  private startNevaContract(): void {
    if (!this.nevaCar) {
      this.nevaCar = new Car(NEVA_CAR);
      const hero = this.heroFor(NEVA_CAR);
      if (hero) this.nevaCar.setHeroModel(hero);
      this.requestHero(NEVA_CAR.glb);
      this.configureCar(this.nevaCar);
    }
    const trial = this.nevaCar;
    if (this.car !== trial) {
      this.careerCar.group.removeFromParent();
      this.car = trial;
      this.scene.add(trial.group);
    }
    if (trial.hp < 100 || trial.wrecked || trial.wheelLost || trial.spoilerLost || trial.bumperLost) trial.repair();
    const firstAttempt = !this.nevaRun;
    this.nevaRun = new NevaRun();
    if (firstAttempt) {
      this.useWorld(NEVA_CONTRACT.mapId);
      this.nevaMarkings ??= buildNevaMarkings();
      this.scene.add(this.nevaMarkings);
    }
    for (const [i, light] of this.world.lights.entries()) {
      light.timer = i * 1.7;
      light.phaseId = 0;
    }
    this.world.update(0);
    this.nitroFuel = 100;
    this.startOrder({
      id: this.orderId++, title: NEVA_CONTRACT.title, dest: NEVA_FINISH,
      reward: NEVA_CONTRACT.reward, timeLimit: NEVA_CONTRACT.timeLimit,
      fragility: 0.8, distance: NEVA_CONTRACT.distance,
    });
  }

  private exitNevaContract(): void {
    this.world.hideDestination();
    this.nevaRun = null;
    this.order = null;
    this.nevaMarkings?.removeFromParent();
    this.nevaCar?.group.removeFromParent();
    this.car = this.careerCar;
    this.scene.add(this.careerCar.group);
    this.useWorld(this.profile.mapId);
    this.clearNevaTarget();
  }

  private clearNevaTarget(): void {
    if (this.nevaTarget === null) return;
    this.nevaTarget = null;
    const url = new URL(window.location.href);
    url.searchParams.delete("challenge");
    url.searchParams.delete("score");
    window.history.replaceState(window.history.state, "", url);
  }

  private startOrder(o: Order, mode: ActivityMode = "delivery"): void {
    this.mode = mode;
    this.hudEl.dataset.mode = mode;
    this.order = o;
    if (mode !== "time-attack") this.timeAttackCourse = null;
    this.timeAttackCheckpointIndex = 0;
    this.orders = this.orders.filter((x) => x.id !== o.id);
    if (this.nevaRun) {
      this.car.resetPose(NEVA_START.x, NEVA_START.z, NEVA_START.heading);
    } else if (this.radioRun) {
      const { x, z, dx, dz } = this.radioRun.course.start;
      this.car.resetPose(x, z, Math.atan2(dx, dz));
    } else if (mode === "time-attack" && this.timeAttackCourse) {
      const tangent = { x: Math.sin(this.timeAttackCourse.heading), z: Math.cos(this.timeAttackCourse.heading) };
      const start = trafficLanePosition(this.timeAttackCourse.start, tangent, ROAD_W / 4);
      this.car.resetPose(start.x, start.z, this.timeAttackCourse.heading);
    } else {
      this.car.resetPose(0, 0, Math.PI);
    }
    this.scene.add(this.roadside.group);
    this.roadside.reset(this.world, this.car.pos, this.car.heading);
    this.paidDriftSeconds = 0;
    this.driftCredited = 0;
    this.traffic.resetForPlayer(this.car.pos, this.nevaRun ? NEVA_CONTRACT.trafficSeed : this.radioRun ? RADIO_TRAFFIC_SEED : undefined);
    this.car.cargo = 100;
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
    this.shake = 0;
    this.wreckTimer = -1;
    this.routeGuide = null;
    this.arrowAngle = null;
    this.toastTimer = 0;
    this.toastEl.style.opacity = "0";
    this.redFinedX.clear();
    if (this.radioRun) this.updateRadioMarkers(this.radioRun);
    else if (mode === "drift-trial") this.world.hideDestination();
    else this.world.setDestination(o.dest.x, o.dest.z);
    this.setTutorialContent(mode);
    this.hCargo.style.display = mode === "delivery" ? "flex" : "none";
    this.audio.ensure();
    this.countdownLeft = 3 * COUNTDOWN_BEAT_MS;
    this.showScreen("playing");
    this.updateHud();
    if (!(this.nevaRun ? this.profile.neva.seenHelp : this.profile.seenTutorials[mode])) this.showTutorial();
    else this.audio.startMusic();
  }

  private updateCountdown(now?: number): void {
    const active = this.screen === "playing" && !this.tutorialEl.open && this.saveStatus !== "conflict";
    if (active && now !== undefined && this.countdownFrameTime !== undefined) {
      // A stalled frame must not skip an entire digit.
      const step = Math.min(now - this.countdownFrameTime, COUNTDOWN_BEAT_MS / 2);
      this.countdownLeft = Math.max(0, this.countdownLeft - step);
    }
    this.countdownFrameTime = active ? now : undefined;
    this.countdownEl.hidden = !active || this.countdownLeft === 0;
    if (this.countdownEl.hidden) return;

    const digit = Math.ceil(this.countdownLeft / COUNTDOWN_BEAT_MS);
    const label = String(digit);
    if (this.countdownDigit.textContent !== label) this.countdownDigit.textContent = label;
    // Scrub the pulse with the race countdown so pausing also freezes the animation.
    this.countdownPulse.currentTime = digit * COUNTDOWN_BEAT_MS - this.countdownLeft;
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
    const heading = el("div", "hud-heading");
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
    heading.appendChild(top);
    this.hNavigation = el("div", "hud-navigation");
    this.hNavigation.hidden = true;
    this.hNavigation.setAttribute("role", "img");
    this.hNavigation.setAttribute("aria-label", "Направление к цели");
    this.hArrow = el("span", "hud-arrow");
    this.hNavigation.appendChild(this.hArrow);
    heading.appendChild(this.hNavigation);
    this.hudEl.appendChild(heading);

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

    this.toastEl = el("div", "toast");
    heading.appendChild(this.toastEl);

    this.popups = el("div", "bonus-popups");
    this.hudEl.appendChild(this.popups);

    const pauseBtn = el("button", "hud-pause", "❚❚");
    pauseBtn.setAttribute("aria-label", "Пауза");
    pauseBtn.title = "Пауза";
    pauseBtn.addEventListener("click", () => this.togglePause());
    this.hudEl.appendChild(pauseBtn);

    this.countdownEl = el("div", "race-countdown");
    this.countdownEl.hidden = true;
    this.countdownEl.setAttribute("aria-hidden", "true");
    this.countdownDigit = el("span", "race-countdown-digit");
    this.countdownEl.appendChild(this.countdownDigit);
    this.hudEl.appendChild(this.countdownEl);
    this.countdownPulse = this.countdownDigit.animate([
      { opacity: 0, transform: "scale(1.45)", offset: 0, easing: "ease-out" },
      { opacity: 1, transform: "scale(1)", offset: 0.2 },
      { opacity: 1, transform: "scale(1)", offset: 0.78, easing: "ease-in" },
      { opacity: 0, transform: "scale(0.92)", offset: 1 },
    ], { duration: COUNTDOWN_BEAT_MS, fill: "both" });
    this.countdownPulse.pause();

    this.tutorialEl = document.createElement("dialog");
    this.tutorialEl.className = "tutorial";
    this.tutorialEl.setAttribute("aria-labelledby", "tutorial-title");
    this.setTutorialContent("delivery");
    this.tutorialEl.addEventListener("cancel", (event) => event.preventDefault());
    this.tutorialEl.addEventListener("click", (event) => {
      if (!(event.target as HTMLElement).closest("[data-a='tut-ok']")) return;
      this.audio.uiClick();
      if (this.nevaRun) this.profile.neva.seenHelp = true;
      else this.profile.seenTutorials[this.mode] = true;
      this.persistProfile();
      this.tutorialEl.close();
      this.updateCountdown();
      if (this.screen === "playing" && this.saveStatus !== "conflict") {
        this.input.setDriving(true);
        this.audio.startMusic();
      }
    });
    this.overlay.appendChild(this.tutorialEl);
  }

  private showTutorial(): void {
    if (this.tutorialEl.open || this.saveStatus === "conflict") return;
    this.input.setDriving(false);
    this.tutorialEl.showModal();
    this.updateCountdown();
  }

  private setTutorialContent(mode: ActivityMode): void {
    const controls = this.input.isTouch
      ? "Газ, задний ход и руль на джойстике. Справа тормоз, ручник и нитро."
      : "WASD или стрелки для вождения. Пробел включает ручник, Shift включает нитро, Esc ставит игру на паузу.";
    const activity = this.nevaRun
      ? [
          ["Повороты", "Начни занос между золотыми линиями и выезжай через вторую. Удар или выезд с дороги лишает премии за этот поворот."],
          ["Доставка", `Довези груз за ${NEVA_CONTRACT.timeLimit} с. Целый груз, запас времени и чистые повороты дают очки.`],
        ]
      : mode === "delivery"
        ? [
            ["Заказ", `Береги груз от ударов и луж. Проезд на красный стоит ₽${RED_LIGHT_FINE}.`],
            ["Премия", `Секунда заноса приносит ₽${driftTip(1)}, сбитая вывеска — ₽12.`],
          ]
        : mode === "radio-silence"
          ? [
              ["Передатчики", `За ${RADIO_TIME} с пройди три передатчика. После каждого уйди от погони в бирюзовой зоне тишины. Путь к ней отмечен на карте.`],
              ["Золотой пакет", "Пакет пополняет нитро и даёт очки после побега. Пакеты, запас времени и состояние кузова определяют медаль и выплату."],
            ]
          : mode === "drift-trial"
            ? [
                ["Серия", "Держи занос, чтобы поднять множитель до ×5. При выходе из заноса очки серии засчитаются."],
                ["Медаль", "Сильный удар сбрасывает незабранные очки серии. Итоговый счёт определяет медаль и выплату."],
              ]
            : [
                ["Чекпоинты", "Пройди контрольные точки по порядку и вернись на старт для финиша."],
                ["Время круга", "Время определяет медаль, выплату и лучший результат трассы."],
              ];
    const hints = [
      ["Управление", controls],
      ["Ручник", "На скорости поверни руль и держи ручник. Занос засчитывается, пока машина скользит боком."],
      ...activity,
    ];
    this.tutorialEl.innerHTML = `<div class="tutorial-box pit-guide">
      <header><span>${this.nevaRun ? NEVA_CONTRACT.title : MODE_NAMES[mode]}</span><h3 id="tutorial-title">Как играть</h3></header>
      <div class="pit-guide-scroll" tabindex="0" aria-label="Управление и цели заезда">
        ${hints.map(([title, hint]) => `<section class="pit-hint"><h4>${title}</h4><p>${hint}</p></section>`).join("")}
      </div>
      <button class="pit-primary" data-a="tut-ok" autofocus>ПОНЯТНО!</button>
    </div>`;
  }

  /** Floating "+₽" bonus popup. */
  private addBonus(amount: number, label: string): void {
    if (this.mode !== "delivery" || this.nevaRun) return;
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
    const bounds = this.world.perimeter;
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
    g.strokeStyle = "#ecc87e";
    g.lineWidth = 1.3;
    g.strokeRect(u(bounds.minX), v(bounds.minZ), (bounds.maxX-bounds.minX)*scale, (bounds.maxZ-bounds.minZ)*scale);
    if (this.nevaRun) drawNevaRoute(g, u, v);
    if (this.radioRun) {
      g.strokeStyle = "rgba(191,157,255,.82)";
      g.lineWidth = 1.6;
      g.beginPath();
      for (const [i, point] of this.radioRun.course.guide.entries()) {
        if (i === 0) g.moveTo(u(point.x), v(point.z));
        else g.lineTo(u(point.x), v(point.z));
      }
      g.stroke();
    }
  }

  private drawMinimap(): void {
    const g = this.mmCanvas.getContext("2d")!;
    g.clearRect(0, 0, 150, 150);
    g.drawImage(this.mmBase, 0, 0);
    const S = 150;
    const bounds = this.world.perimeter;
    const scale = S / Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
    const u = (x: number) => S / 2 + (x - (bounds.minX + bounds.maxX) / 2) * scale;
    const v = (z: number) => S / 2 + (z - (bounds.minZ + bounds.maxZ) / 2) * scale;
    if (this.order && this.mode !== "drift-trial") {
      const pulse = 3 + Math.sin(performance.now() / 200) * 1;
      g.fillStyle = this.radioRun?.phase === "transmitter" ? "#b899ff" : "#22ffcc";
      g.beginPath();
      g.arc(u(this.order.dest.x), v(this.order.dest.z), pulse + 1.5, 0, Math.PI * 2);
      g.fill();
    }
    if (this.radioRun?.phase === "pursuit") {
      if (!this.radioRun.carryingPacket) {
        const { x, z } = this.radioRun.leg.cache;
        g.fillStyle = "#ffbb62";
        g.fillRect(u(x) - 2, v(z) - 2, 4, 4);
      }
      g.beginPath();
      g.fillStyle = "#ff744b";
      g.arc(u(this.police.pos.x), v(this.police.pos.z), 2.5, 0, Math.PI * 2);
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
    this.renderFrame(0);
    this.running = true;
    this.clock.start();
    const loop = (now: number) => {
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
      if (this.countdownLeft > 0) this.updateCountdown(now);
      this.renderFrame(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  suspendForRotation(): void {
    this.input.setDriving(false);
    this.audio.updateEngine(0, 0, 0);
    this.stop();
  }

  resumeAfterRotation(): void {
    this.input.setDriving(this.screen === "playing" && !this.tutorialEl.open && this.saveStatus !== "conflict");
    this.acc = 0;
    this.start();
  }

  stop(): void {
    this.running = false;
    this.countdownFrameTime = undefined;
    cancelAnimationFrame(this.raf);
  }

  private fixedStep(dt: number): void {
    if (this.screen !== "playing" || !this.order || this.countdownLeft > 0 || this.tutorialEl.open || this.saveStatus === "conflict") {
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
    const signs = this.roadside.update(dt, {x:prevX,z:prevZ}, this.car.pos,
      !this.car.isFlipping && !this.car.wrecked && this.car.airY<1 && this.car.vel.lengthSq()>16);
    if (signs) {
      const coins = signs*12;
      this.profile.money += coins;
      this.persistProfile();
      this.effects.spawnFlash(this.car.pos.x,this.car.pos.z,0xffce56);
      this.toast(`Вывеска · +₽${coins}`);
    }
    const lamp = !this.car.isFlipping && this.car.vel.lengthSq() >= 25
      ? this.world.knockStreetLamp(prevX, prevZ, this.car.pos.x, this.car.pos.z, this.car.airY, dt)
      : null;
    if (lamp) {
      const strength = Math.min(1, this.car.vel.length() / 24);
      this.car.vel.multiplyScalar(0.9);
      this.car.damageCar(1 + 4 * strength);
      this.shake = Math.min(0.8, this.shake + 0.2 * strength);
      this.audio.thud(0.25 + 0.45 * strength);
      this.effects.spawnFlash(lamp.x, lamp.z, 0xffbc64);
    }
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
    if (this.mode === "delivery" && !this.nevaRun && this.police.active) {
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
    } else if (this.mode === "delivery" && !this.nevaRun && !this.chaseTriggered && (this.redLightRuns >= 2 || this.trafficHits >= 2)) {
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

    const controlledDrift = isControlledDrift(inp.handbrake, inp.steer, res.drift, res.speed,
      !res.airborne && !res.rolled && !this.car.isFlipping && !this.car.wrecked && !this.driftCrashThisStep);
    if (this.nevaRun) {
      const clean = !lamp && !res.offRoad && !res.airborne && !res.rolled && !this.car.isFlipping && !this.car.wrecked
        && res.impact <= 3 && tHit <= 0;
      const i = this.nevaRun.update(prevX, prevZ, this.car.pos.x, this.car.pos.z, dt, res.speed, controlledDrift ? res.drift : 0, clean);
      if (i >= 0) {
        const points = this.nevaRun.pointsAt(i);
        this.toast(points ? `${NEVA_SECTORS[i].name} · чистый занос +₽${NEVA_CONTRACT.sectorBonus}` : `${NEVA_SECTORS[i].name} · без премии`);
        if (points) this.audio.uiClick();
      }
    } else if (this.mode === "drift-trial") {
      this.updateDriftChain(controlledDrift ? res.drift : 0, res.speed, dt);
    }
    if (controlledDrift) this.paidDriftSeconds += dt;
    if (!controlledDrift || driftTip(this.paidDriftSeconds) - this.driftCredited >= 5) this.creditDrift();

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
      else this.completeOrder(false, this.mode === "time-attack" ? "Время вышло до финиша"
        : this.mode === "radio-silence" ? "Время эфира истекло" : "Время вышло — клиент ушёл");
    } else if (this.radioRun) {
      this.updateRadioRun(this.radioRun, dt);
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
    if (this.mode !== "delivery" || this.nevaRun || !this.order || this.car.isFlipping) return;
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

  private creditDrift(): void {
    const earned = driftTip(this.paidDriftSeconds);
    const delta = earned - this.driftCredited;
    if (delta <= 0) return;
    this.driftCredited = earned;
    this.profile.money += delta;
    this.profile.totalEarn += delta;
    this.persistProfile();
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

  private updateRadioRun(run: RadioRun, dt: number): void {
    const { x, z } = this.car.pos;
    const caught = run.phase === "pursuit" && this.police.update(dt, x, z);
    const canEnterGate = this.car.hp > 0 && !this.car.isFlipping && this.car.airY < 0.6 && this.world.isOnRoad(x, z);
    const event = run.update(dt, x, z, canEnterGate, this.police.dist, caught);
    if (event === "signal") {
      this.police.startOnRoute(run.course.route, run.leg.spawnProgress, run.leg.patrolSpeed, x, z);
      this.updateRadioMarkers(run);
      this.audio.fine();
      this.toast("Погоня началась · держи отрыв до зоны тишины", true);
    } else if (event === "cache") {
      this.nitroFuel = Math.min(100, this.nitroFuel + 25);
      this.updateRadioMarkers(run);
      this.audio.uiClick();
      this.toast("Пакет перехвачен · +25 к нитро");
    } else if (event === "escape" || event === "finish") {
      this.police.stop();
      this.profile.stats.escapes++;
      if (event === "finish") {
        this.completeOrder(true, "Три сигнала доставлены в зоны тишины");
      } else {
        this.updateRadioMarkers(run);
        this.audio.success();
        this.toast(`Побег ${run.escapes}/${RADIO_WAVES} · следующий передатчик отмечен`);
        this.grantAchievements(false);
        this.persistProfile();
      }
    } else if (event === "caught") {
      this.completeOrder(false, "Патруль перехватил машину");
    }
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
    this.creditDrift();
    this.world.hideDestination();
    this.audio.stopMusic();
    this.audio.updateEngine(0, 0, 0);
    if (this.nevaRun) {
      this.completeNevaContract(this.nevaRun, ok, reason);
      return;
    }
    if (this.radioRun) {
      this.completeRadioRun(this.radioRun, ok, reason);
      return;
    }
    const p = this.profile;
    if (this.mode === "drift-trial") this.bankDriftChain();
    const driftScore = finalDriftScore(this.driftScore);
    this.driftScore = driftScore;
    if (this.mode === "drift-trial" && ok) p.driftBest = Math.max(p.driftBest, driftScore);
    const event = this.activeEvent;
    const careerLines: string[] = [];
    let stagePassed = ok;
    let careerMetric: { label: string; value: string } | undefined;
    if (event) {
      const value = event.mode === "delivery" ? this.car.cargo : event.mode === "drift-trial" ? driftScore : o.timeLimit-this.timeLeft;
      const result = settleEvent(p,event,ok,value);
      stagePassed = result.earned > 0;
      careerMetric = { label: "Звёзды за этап", value: "★".repeat(result.earned) + "☆".repeat(3 - result.earned) };
      careerLines.push(event.title);
      if (!stagePassed) careerLines.push(`Цель этапа: ${goal(event,1)}`);
      if (result.bonus) careerLines.push(`Премия за новые звёзды: ₽${result.bonus}`);
      if (result.first && event.leg===2) careerLines.push(WORLD_MAPS[event.chapter+1] ? "Открыта карта · "+WORLD_MAPS[event.chapter+1].name : "Чемпионат пройден!");
    }
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
      const lines = this.mode === "drift-trial"
        ? [`${reason}.`, `Счёт: ${driftScore} · ${medalLabel(medal)}`]
        : ok
          ? [`${reason}.`, `Время круга: ${elapsed.toFixed(1)} с · ${medalLabel(medal)}`]
          : [`${reason}.`, `Время до схода: ${elapsed.toFixed(1)} с`];
      if (this.mode === "time-attack" && this.timeAttackCourse) {
        lines.push(this.timeAttackCourse.name);
        lines.push(`Пройдено контрольных точек: ${this.timeAttackCheckpointIndex}/${this.timeAttackCourse.checkpoints.length}`);
      }
      const recordLabel = record === null ? undefined : this.mode === "drift-trial" ? `${Math.round(record)} очк.` : `${record.toFixed(1)} с`;
      if (this.mode === "time-attack" && medal) {
        p.stats.timeAttackMedal = Math.max(p.stats.timeAttackMedal, medalRank(medal));
      }
      p.money += reward;
      p.totalEarn += reward;
      p.bestEarn = Math.max(p.bestEarn, reward);

      this.grantAchievements(false);
      this.persistProfile();
      this.lastResult = { ok: stagePassed, lines:[...careerLines,...lines], mode: this.mode, record:recordLabel, rewards:[{label:"За заезд",amount:reward}], metric: careerMetric ?? (this.mode === "drift-trial"
        ? { label: "Очки за дрифт", value: String(driftScore) }
        : { label: ok ? "Время на финише" : "Время в заезде", value: `${elapsed.toFixed(1)} с` }), title: event ? (stagePassed ? "ЭТАП ПРОЙДЕН" : "ЦЕЛЬ НЕ ВЫПОЛНЕНА") : title };
      this.order = null;
      this.police.stop();
      this.bonusMoney = 0;
      this.showScreen("result");
      return;
    }
    const lines: string[] = [`${reason}.`];
    let total = 0;
    let recordLabel: string | undefined;
    const rewards: {label:string; amount:number}[] = [];
    if (ok) {
      const integ = this.car.cargo / 100;
      const pay = Math.round(o.reward * (0.25 + 0.75 * integ));
      const timeBonus = Math.round((this.timeLeft / o.timeLimit) * o.reward * 0.35);
      const tip = this.driftCredited;
      total = Math.max(0, pay + timeBonus + this.bonusMoney - this.orderFines);
      rewards.push({label:"Оплата",amount:pay},{label:"Бонус за время",amount:timeBonus});
      if (tip > 0) lines.push(`Уже в кошельке за занос: ₽${tip}`);
      if (this.bonusMoney > 0) rewards.push({label:"Трюки",amount:this.bonusMoney});
      if (this.orderFines > 0) lines.push(`<span class="neg">Штрафы за красный: −₽${this.orderFines}</span>`);
      if (event) lines.push(`Выплата за заказ: ₽${total}`);
      if (this.car.hp < 50) lines.push('<span class="neg">Машине нужен ремонт</span>');
      p.money += total;
      p.deliveries += 1;
      p.totalEarn += total;
      p.bestEarn = Math.max(p.bestEarn, total + tip);
      if (this.car.cargo >= 99.5) p.stats.perfectDeliveries += 1;
      const record = saveRecord(p.records, p.mapId, "delivery", p.carId, total + tip);
      recordLabel = `₽${rubles.format(Math.round(record))}`;
      if (o.weekly) {
        const completed = completeWeeklyRoute(p.weeklyCompletions, o.weekly);
        const completedOnMap = weeklyRouteIds(o.weekly.week, p.mapId).filter((id) => completed.includes(id)).length;
        lines.push(`<span class="gold">Маршруты недели от ${o.weekly.week}: ${completedOnMap}/3</span>`);
      }
      this.audio.success();
    } else {
      const consolation = 40;
      p.money += consolation;
      rewards.push({label:"Утешительные",amount:consolation});
      if (this.orderFines > 0) {
        p.money = Math.max(0, p.money - this.orderFines);
        lines.push(`<span class="neg">Штрафы: −₽${this.orderFines}</span>`);
      }
      this.audio.fail();
    }
    this.grantAchievements(false);
    this.persistProfile();
    this.lastResult = { ok:stagePassed, lines:[...careerLines,...lines], record:recordLabel, rewards,
      gauges: ok || event ? [{label:"Груз",value:this.car.cargo},{label:"Кузов",value:this.car.hp}] : [{label:"Кузов",value:this.car.hp}],
      metric:careerMetric ?? (ok
      ? { label: "Выплата за заказ", value: `₽${rubles.format(total)}` }
      : { label: "Целостность груза", value: `${Math.round(this.car.cargo)}%` }), title:event ? (stagePassed ? "ЭТАП ПРОЙДЕН" : "ЭТАП НЕ ПРОЙДЕН") : undefined };
    this.order = null;
    this.police.stop();
    this.bonusMoney = 0;
    this.showScreen("result");
  }

  private completeRadioRun(run: RadioRun, ok: boolean, reason: string): void {
    const p = this.profile;
    const lines = [`${reason}.`, `Побеги ${run.escapes}/${RADIO_WAVES} · Пакеты ${run.packets}/${RADIO_WAVES}`];
    const timeLeft = Math.max(0, this.timeLeft);
    lines.push(`Время ${(RADIO_TIME - timeLeft).toFixed(1)} с · Кузов ${Math.round(this.car.hp)}%`);
    let recordLabel: string | undefined;
    let rewardAmount = 0;
    let metric = { label: "Успешные побеги", value: `${run.escapes}/${RADIO_WAVES}` };
    if (ok) {
      const score = radioScore(run.packets, timeLeft, this.car.hp);
      metric = { label: "Очки за операцию", value: String(score) };
      const medal = radioMedal(score);
      const best = saveRecord(p.records, this.world.mapId, "radio-silence", p.carId, score);
      const reward = modeReward("radio-silence", medal, score);
      p.money += reward;
      p.totalEarn += reward;
      p.bestEarn = Math.max(p.bestEarn, reward);
      recordLabel = `${best} очк.`;
      rewardAmount = reward;
      lines.push(medalLabel(medal));
      if (p.stats.escapes >= RADIO_WAVES && !p.unlockedAch.includes("escapee")) lines.push("Открыта ачивка «Невидимка»");
      this.audio.success();
    } else {
      if (run.escapes > 0) lines.push("Успешные побеги засчитаны в карьере");
      this.audio.fail();
    }
    this.police.stop();
    if (this.radioCache) this.radioCache.visible = false;
    this.grantAchievements(false);
    this.persistProfile();
    this.lastResult = { ok, title: RADIO_TITLE.toUpperCase(), mode: "radio-silence", lines, metric, record:recordLabel,
      rewards:ok ? [{label:"За операцию",amount:rewardAmount}] : [] };
    this.order = null;
    this.showScreen("result");
  }

  private completeNevaContract(run: NevaRun, ok: boolean, reason: string): void {
    const p = this.profile;
    const lines = [reason + "."];
    let score: number | undefined;
    if (ok) {
      const value = nevaResult(this.car.cargo, this.timeLeft, run.cleanSectors);
      const payout = value.base + value.timeBonus + value.driftBonus;
      const duration = NEVA_CONTRACT.timeLimit - this.timeLeft;
      score = value.score;
      const isRecord = score > p.neva.bestScore;
      p.neva.bestScore = Math.max(p.neva.bestScore, score);
      p.neva.mastered ||= value.mastered;
      p.deliveries++;
      p.money += payout;
      p.totalEarn += payout;
      p.bestEarn = Math.max(p.bestEarn, payout);
      if (this.car.cargo >= 99.5) p.stats.perfectDeliveries++;
      lines.push(
        `Время ${duration.toFixed(1)} с · Чистые повороты ${run.cleanSectors}/${NEVA_SECTORS.length}`,
        `Оплата ₽${value.base} · за время +₽${value.timeBonus} · за занос +₽${value.driftBonus}`,
        `<b class="gold">Итого ₽${payout}</b>`,
      );
      if (isRecord) lines.push("Новый рекорд контракта!");
      if (run.bestSector >= 0) lines.push(`Лучший поворот · ${NEVA_SECTORS[run.bestSector].name}, ${run.pointsAt(run.bestSector)} очк. заноса`);
      if (this.nevaTarget !== null) {
        const difference = score - this.nevaTarget;
        lines.push(difference > 0
          ? `Результат друга побит на ${difference} очк.`
          : difference === 0 ? "Результат друга повторён" : `До результата друга ${-difference} очк.`);
      }
    } else {
      lines.push(`Чистые повороты ${run.cleanSectors}/${NEVA_SECTORS.length}`);
    }
    if (ok) this.audio.success();
    else this.audio.fail();
    this.grantAchievements(false);
    this.persistProfile();
    this.lastResult = { ok, lines, title: NEVA_CONTRACT.title, nevaScore: score,
      record:ok ? `${p.neva.bestScore} очк.` : undefined, gauges:[{label:"Груз",value:this.car.cargo},{label:"Кузов",value:this.car.hp}],
      metric: score === undefined ? { label: "Чистые повороты", value: `${run.cleanSectors}/${NEVA_SECTORS.length}` }
        : { label: "Очки контракта", value: String(score) } };
    this.order = null;
    this.police.stop();
    this.bonusMoney = 0;
    this.showScreen("result");
  }

  private updateNavigation(dest: CityPoint): void {
    this.hNavigation.hidden = this.mode === "drift-trial";
    if (this.hNavigation.hidden) return;
    let guide = this.routeGuide;
    if (!guide || guide.world !== this.world || guide.x !== dest.x || guide.z !== dest.z) {
      guide = { world: this.world, ...dest, aim: guideAlongRoads(this.world.layout, dest) };
      this.routeGuide = guide;
    }
    const point = guide.aim(this.car.pos);
    const dx = point.x - this.car.pos.x;
    const dz = point.z - this.car.pos.z;
    if (dx * dx + dz * dz < 0.1) return;
    const angle = this.car.heading - Math.atan2(dx, dz);
    const previous = this.arrowAngle ?? 0;
    const change = angle - previous;
    this.arrowAngle = previous + Math.atan2(Math.sin(change), Math.cos(change));
    this.hArrow.style.transform = `rotate(${this.arrowAngle}rad)`;
  }

  private updateHud(): void {
    if (!this.order) return;
    const o = this.order;
    const radio = this.radioRun;
    this.hOrder.textContent = this.nevaRun ? NEVA_CONTRACT.title : radio
      ? `${Math.min(radio.escapes + 1, RADIO_WAVES)}/${RADIO_WAVES} · ${radio.phase === "transmitter" ? "К передатчику" : "В зону тишины"}`
      : this.mode === "delivery"
      ? `📦 ${CARGO_NAMES[o.id % CARGO_NAMES.length]} · ₽${o.reward}`
      : this.mode === "drift-trial" ? "DRIFT TRIAL · комбо до ×5" : `TIME ATTACK · КП ${Math.min(this.timeAttackCheckpointIndex + 1, this.timeAttackCourse?.checkpoints.length ?? 5)}/${this.timeAttackCourse?.checkpoints.length ?? 5}`;
    if (this.activeEvent) this.hOrder.textContent = this.activeEvent.mode === "time-attack"
      ? `Этап ${this.activeEvent.number} · КП ${Math.min(this.timeAttackCheckpointIndex + 1, 5)}/5`
      : this.careerHudGoal;
    const t = Math.max(0, this.timeLeft);
    const seconds = Math.ceil(t);
    this.hTimer.textContent = radio ? `⏱ ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : this.mode === "time-attack"
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
    this.hMoney.textContent = radio ? `Кузов ${Math.round(this.car.hp)}%` : this.nevaRun && this.nevaTarget !== null
      ? `Цель ${this.nevaTarget} очк.`
      : `₽${this.profile.money}${this.orderFines ? ` (−${this.orderFines})` : ""}`;
    const sector = this.nevaRun?.activeSector() ?? -1;
    this.hDrift.textContent = this.nevaRun
      ? sector >= 0 ? `ЗОНА ЗАНОСА · ${NEVA_SECTORS[sector].name}` : `Чистые повороты ${this.nevaRun.cleanSectors}/${NEVA_SECTORS.length}`
      : radio ? `Побеги ${radio.escapes}/${RADIO_WAVES} · Пакеты ${radio.packets}${radio.carryingPacket ? "+1" : ""}/${RADIO_WAVES}`
      : this.mode === "drift-trial"
      ? `дрифт ${Math.round(this.driftScore)} · ×${this.driftMultiplier}${this.driftChainScore > 0 ? ` · серия ${Math.round(this.driftChainScore)}` : ""}`
      : this.mode === "delivery" && this.paidDriftSeconds > 0
        ? `Занос ${this.paidDriftSeconds.toFixed(1)} с · +₽${this.driftCredited}`
        : "";
    if ((this.mode !== "delivery" || this.nevaRun) && this.driftCredited > 0)
      this.hDrift.textContent += ` · занос +₽${this.driftCredited}`;
    this.hNitro.querySelector("i")!.setAttribute("style", `transform:scaleX(${this.nitroFuel / 100})`);
    const radioPursuit = radio?.phase === "pursuit" && this.police.active;
    this.hChase.textContent = radioPursuit ? `🚔 Отрыв ${Math.floor(this.police.dist)}/${radio.leg.requiredGap} м` : "🚔 ПОГОНЯ!";
    this.hChase.classList.toggle("radio-lead", !!radioPursuit && this.police.dist >= radio.leg.requiredGap);
    this.hChase.style.display = this.police.active ? "inline" : "none";
    this.updateNavigation(o.dest);
    this.drawMinimap();
  }

  // ================= render =================

  private renderFrame(dt: number): void {
    if (VERIFICATION && !this.readyFlagged) {
      this.readyFlagged = true;
      (window as unknown as { __GAME_READY__: boolean }).__GAME_READY__ = true;
    }
    // menu screens show the showroom turntable instead of the city
    if (SHOWROOM_SCREENS.has(this.screen)) {
      this.renderShowroom(dt);
      return;
    }
    // camera follow
    const fwd = this.car.forward(this.camForward);
    const portrait = window.innerHeight > window.innerWidth;
    const dist = portrait ? 11.5 : 9;
    const height = portrait ? 5.6 : 4.2;
    const desired = this.camDesired.set(
      this.car.pos.x - fwd.x * dist,
      height,
      this.car.pos.z - fwd.z * dist
    );
    const k = this.countdownLeft > 0 ? 1 : 1 - Math.exp(-dt * 4.6);
    this.camPos.lerp(desired, k);
    this.camera.position.copy(this.camPos);
    if (this.shake > 0.01) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.5;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.35;
      this.camera.position.z += (Math.random() - 0.5) * this.shake * 0.5;
    }
    const look = this.camLook.set(
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
    this.viewportWidth = w;
    this.viewportHeight = h;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.frameShowroom();
  };

  private frameShowroom(): void {
    const stage = this.showroomStage;
    if (stage && stage.clientWidth > 0 && stage.clientHeight > 0) {
      const rect = stage.getBoundingClientRect();
      this.showroomViewport ??= new THREE.Vector4();
      this.showroomViewport.set(
        Math.round(rect.left + stage.clientLeft),
        Math.round(this.viewportHeight - rect.top - stage.clientTop - stage.clientHeight),
        stage.clientWidth,
        stage.clientHeight,
      );
      this.showroom.frame(stage.clientWidth / stage.clientHeight, this.screen === "title" && this.viewportWidth > this.viewportHeight, this.screen === "garage" || this.screen === "cars");
    } else {
      this.showroomViewport = null;
      this.showroom.frame(this.viewportWidth / this.viewportHeight);
    }
  }

  private renderShowroom(dt: number): void {
    const outside = this.screen === "title";
    this.showroom.update(dt, !this.reducedMotion.matches && !this.showroomDrag, outside);
    const viewport = this.showroomViewport;
    if (viewport) {
      this.renderer.setClearColor(0x0c111d);
      this.renderer.clear();
      this.renderer.setViewport(viewport);
      this.renderer.setScissor(viewport);
      this.renderer.setScissorTest(true);
    }
    this.renderer.shadowMap.enabled = outside;
    this.renderer.render(this.showroom.scene, this.showroom.camera);
    this.renderer.shadowMap.enabled = false;
    if (viewport) {
      this.renderer.setScissorTest(false);
      this.renderer.setViewport(0, 0, this.viewportWidth, this.viewportHeight);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    document.removeEventListener("visibilitychange", this.visibilityChanged);
    window.removeEventListener("storage", this.storageChanged);
    window.removeEventListener("resize", this.resize);
    this.showroomObserver.disconnect();
    this.audio.dispose();
    this.input.dispose();
    this.careerCar.dispose();
    this.nevaCar?.dispose();
    this.radioCar?.dispose();
    this.roadside.dispose();
    this.showroom.dispose();
    for (const model of this.heroModels.values()) {
      if (typeof model === "object") disposeCarVisual(model.root);
    }
    this.heroModels.clear();
    for (const object of this.radioCache?.children ?? []) {
      const mesh = object as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    if (this.nevaMarkings) {
      this.nevaMarkings.geometry.dispose();
      this.nevaMarkings.material.dispose();
    }
    this.activeTraffic?.dispose();
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
