/**
 * verify-game.mjs — Playwright smoke self-check: serve dist → zero console errors → three-state screenshots →
 * **direction-mapping assertions** (directly targets the most frequent playtest defect). When changing the input
 * mapping you must sync the assertions here.
 *
 * Usage: npm run verify. Serves a temporary build with diagnostic hooks.
 *
 * Notes:
 * - The canvas is looked up by id — CANVAS_ID below must match the <canvas id="..."> that
 *   src/pages/Home.tsx renders. Rename it in one place and you must rename it in the other.
 * - Both WebGL and 2D canvases are supported: WebGL is read through readPixels (needs
 *   preserveDrawingBuffer), a 2D canvas through getImageData.
 * - Headless falls back to SwiftShader (software GL): it proves rendering/logic correctness only,
 *   never performance. Measure fps on a real GPU separately.
 * - Screenshots land in verification-shots/ (process files: review them, then delete the dir
 *   before delivery — the deliverable must not keep process artifacts).
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { buildForVerification } from "./verification-build.mjs";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not URL.pathname: .pathname keeps percent-encoding, so a project living under a
// path with a space (or any non-ASCII character) would yield ".../My%20Games/app" and every
// existsSync() below would miss, reporting "no build output" for a build that is right there.
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DIST = buildForVerification();
const SHOTS = join(ROOT, "verification-shots");
mkdirSync(SHOTS, { recursive: true });

// Must match <canvas id="..."> in src/pages/Home.tsx. Change both together.
const CANVAS_ID = "game-canvas";

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".webp": "image/webp", ".json": "application/json", ".wasm": "application/wasm" };

const server = createServer(async (req, res) => {
  try {
    const pathname = req.url.split("?")[0];
    const raw = pathname === "/" ? "/index.html" : pathname;
    // Decode: request paths are percent-encoded, so an asset named "level 1.png" arrives as
    // "level%201.png" and would 404 (surfacing later as a bogus console-error failure).
    let path;
    try { path = decodeURIComponent(raw); } catch { path = raw; }
    const file = resolve(DIST, "." + path);
    if (file !== DIST && !file.startsWith(DIST + sep)) { res.writeHead(403).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404).end();
  }
});

const fail = (msg) => { console.error("VERIFY FAIL:", msg); server.close(); process.exit(1); };

await new Promise((r) => server.listen(0, r));
const port = server.address().port;
// prefer the playwright-bundled browser; fall back to system chrome (CHROMIUM_PATH overrides)
const CANDIDATES = [
  process.env.CHROMIUM_PATH,
  "/opt/gchrome/opt/google/chrome/chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].filter(Boolean);
let browser;
for (const exe of [null, ...CANDIDATES]) {
  try {
    browser = await chromium.launch(exe
      ? { executablePath: exe, args: ["--no-sandbox", "--disable-gpu-sandbox", "--use-gl=swiftshader"] }
      : {});
    break;
  } catch { /* try the next one */ }
}
if (!browser) fail("no usable browser found (playwright bundled/chrome/chromium all unavailable)");
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript(() => {
  // A legacy save has no mapId; the migration must keep the original city.
  localStorage.setItem("delivery-drift-86-save-v1", JSON.stringify({
    money: 500, deliveries: 0, carId: "ae86", ownedCars: ["ae86"], upgrades: {},
  }));
});

const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(String(e)));

let releaseBundle;
const bundleGate = new Promise((resolve) => { releaseBundle = resolve; });
await page.route("**/assets/index-*.js", async (route) => { await bundleGate; await route.continue(); });
let releasePolice;
const policeGate = new Promise((resolve) => { releasePolice = resolve; });
await page.route("**/assets/police-*.glb", async (route) => { await policeGate; await route.continue(); });
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "commit" });
const loadingScreen = page.locator("#startup-loading");
await loadingScreen.waitFor();
if (await page.locator("#startup-progress").getAttribute("value") !== null) fail("The startup screen invented progress before the game bundle loaded");
releaseBundle();
await page.waitForFunction(() => {
  const progress = document.querySelector("#startup-progress");
  return progress.value > 0 && progress.value === progress.max - 1;
});
if (!(await loadingScreen.isVisible()) || !(await page.locator("#game-root").evaluate((root) => root.inert)) ||
    await page.evaluate(() => window.__GAME_READY__ === true)) fail("The title screen opened before all startup models were ready");
await page.screenshot({ path: join(SHOTS, "01-loading.png") });
releasePolice();
await loadingScreen.waitFor({ state: "hidden" });
await page.waitForLoadState("networkidle");
if (!(await page.evaluate(() => window.__GAME_READY__ && window.__gameDebug.showroom().detailed))) fail("The loader closed before the detailed title frame was rendered");
if (!(await page.locator('[data-a="event-dismiss"]').isVisible())) fail("Weekly event was not promoted on startup");
if (!(await page.locator('[data-a="event-start"]').isVisible())) fail("Weekly event popup has no start action");
await page.locator('[data-a="event-dismiss"]').click();
if (await page.locator('[data-a="event-dismiss"]').count()) fail("Weekly event popup did not dismiss");
await page.evaluate(() => window.__gameDebug?.exitMode?.());
if (await page.locator('[data-a="event-dismiss"]').count()) fail("Dismissed weekly event reappeared in the same week");
await page.waitForFunction(() => window.__gameDebug.showroom().state === "ready");
await page.locator('[data-a="play"]').click();
await page.locator('[data-a="back"]').click();
await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const restoredTitle = await page.evaluate(() => window.__gameDebug.showroom());
if (restoredTitle.key !== "ae86" || !restoredTitle.detailed || restoredTitle.state !== "ready") {
  fail("Returning to the title screen replaced the detailed model");
}
const eventPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await eventPage.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
await eventPage.locator('[data-a="event-start"]').waitFor({ state: "visible" });
await eventPage.screenshot({ path: join(SHOTS, "02-weekly-event.png") });
await eventPage.locator('[data-a="event-start"]').click();
await eventPage.locator('[data-a="tut-ok"]').click();
if (await eventPage.evaluate(() => window.__gameDebug?.screen?.()) !== "playing") fail("Weekly event start action did not start its route");
if (!(await eventPage.evaluate(() => window.__gameDebug?.weeklyEventSeen?.()))) fail("Starting the weekly event did not record it as seen");
await eventPage.evaluate(() => {
  const key = "delivery-drift-86-save-v2";
  const profile = JSON.parse(localStorage.getItem(key));
  profile.weeklyCompletions[window.__gameDebug.weekKey()] = window.__gameDebug.weekly();
  profile.weeklyEventWeek = null;
  localStorage.setItem(key, JSON.stringify(profile));
});
await eventPage.reload({ waitUntil: "networkidle" });
if (await eventPage.locator('[data-a="event-start"]').count()) fail("Weekly event offered a replay after all routes were completed");
await eventPage.close();
// The page boots through a React shell (src/main.tsx -> src/App.tsx -> src/pages/Home.tsx),
// so the canvas only exists after the first effect runs: wait for the readiness flag the game
// raises on its first rendered frame, then fall back to a fixed delay if it never appears.
await page
  .waitForFunction(() => window.__GAME_READY__ === true, null, { timeout: 8000 })
  .catch(() => console.warn("WARN: window.__GAME_READY__ never turned true — falling back to a fixed wait (raise the flag in src/game/boot.ts)"));
await page.waitForTimeout(1200);

// Home leads into a focused mode picker, then a progressive map picker.
const defaultMap = await page.evaluate(() => window.__gameDebug?.mapId?.());
if (defaultMap !== "tokyo") fail("A legacy save did not default to Neon Tokyo");
const hasRoadProbe = await page.evaluate(() => typeof window.__gameDebug?.roadProbe === "function");
if (!hasRoadProbe) fail("World is not exposing the authored road query for verification");
if (await page.locator('[data-a="drift-trial"]').count()) fail("Activity modes still clutter the home screen");
if (await page.locator('[data-a="records"]').count()) fail("Records are still a top-level home button");
await page.screenshot({ path: join(SHOTS, "02-home-desktop.png") });
await page.setViewportSize({ width: 390, height: 844 });
await page.locator("#turn-phone:modal").waitFor();
await page.screenshot({ path: join(SHOTS, "03-home-mobile.png") });
await page.setViewportSize({ width: 1280, height: 720 });
await page.locator('[data-a="play"]').click();
for (const mode of ["delivery", "drift-trial", "time-attack", "radio-silence"]) {
  if (await page.locator(`[data-a="activity:${mode}"]`).count() !== 1) fail(`Activity picker is missing ${mode}`);
}
await page.locator('[data-a="activity:delivery"]').click();
await page.waitForFunction(() => {
  const images = [...document.querySelectorAll(".track-art img")];
  return images.length === 5 && images.every((image) => image.complete && image.naturalWidth === 768 && image.naturalHeight === 340) &&
    new Set(images.map((image) => image.src)).size === 5;
});
const lockedPortMap = page.locator('[data-a="map:yokohama"]');
if (await lockedPortMap.count() !== 1) fail("Yokohama Port is missing from the tracks screen");
if (!(await lockedPortMap.isDisabled())) fail("Yokohama opened before the delivery threshold");
if (!(await page.getByText(/Пройди этап 3/).count())) fail("Locked Yokohama does not show its career requirement");
await page.screenshot({ path: join(SHOTS, "04-tracks-locked.png") });
await page.locator('[data-a="map:tokyo"]').press("Space");
const firstTutorial = page.locator("dialog.tutorial[open]");
if (!(await firstTutorial.getByText(/WASD/).isVisible())) fail("Desktop tutorial did not show keyboard controls");
await firstTutorial.locator('[data-a="tut-ok"]').press("Space");
if (await page.evaluate(() => window.__gameDebug?.mapId?.()) !== "tokyo") fail("Neon Tokyo could not be selected");
if (await page.evaluate(() => window.__gameDebug?.portVisuals?.())) fail("Port-only props leaked into Neon Tokyo");
if (await page.evaluate(() => window.__gameDebug?.screen?.()) !== "playing") fail("Choosing a map did not start the selected delivery");
if (!(await page.locator(".hud-navigation").isVisible())) fail("Delivery has no route arrow");
const tokyoBuildingCount = await page.evaluate(() => window.__gameDebug.cityBuildingCount());
if (tokyoBuildingCount < 350) fail(`Tokyo's generated building infill is sparse: ${tokyoBuildingCount} sites`);
const tokyoTraffic = await page.evaluate(() => window.__gameDebug.trafficPos());
if (tokyoTraffic.length < 6 || tokyoTraffic.length > 10 || (await page.evaluate((cars) => cars.some((car) => !window.__gameDebug.roadProbe(car.x, car.z).onRoad), tokyoTraffic))) fail("Tokyo NPC traffic is missing, overcrowded, or off its authored roads");
if (tokyoTraffic.some((a, i) => tokyoTraffic.slice(i + 1).some((b) => {
  if (a.routeIndex !== b.routeIndex || a.dir !== b.dir) return false;
  const delta = Math.abs(a.progress - b.progress);
  return Math.min(delta, a.routeLength - delta) < 16;
}))) fail("Tokyo NPCs are packed too tightly in one lane");
const tokyoLayout = await page.evaluate(() => window.__gameDebug.layoutSnapshot());
if (!tokyoLayout.signals.length || (await page.evaluate((signals) => signals.some((point) => !window.__gameDebug.roadProbe(point.x, point.z).onRoad), tokyoLayout.signals))) fail("Tokyo signal junctions are not on authored roads");
await page.waitForTimeout(700);
async function verifyRoadside(page, ids) {
  for (const id of ids) {
    await page.waitForFunction(id => {
      const debug = window.__gameDebug;
      const figure = debug.scene.getObjectByName("roadside-" + id);
      return figure?.material.map.image?.width && !debug.roadProbe(figure.position.x, figure.position.z).onRoad;
    }, id);
    const frame = await page.evaluate(id =>
      window.__gameDebug.scene.getObjectByName("roadside-" + id).material.map.offset.toArray(), id);
    await page.waitForFunction(([id, x, y]) => {
      const offset = window.__gameDebug.scene.getObjectByName("roadside-" + id).material.map.offset;
      return offset.x !== x || offset.y !== y;
    }, [id, ...frame]);
  }
}
const outerLanesClear = await page.evaluate(() => {
  const d = window.__gameDebug;
  const wall = d.scene.getObjectByName("city-perimeter");
  const b = d.roadProbe(0, 0).bounds;
  return wall?.children.length === 4 && [-1, 1].every(sign =>
    [[sign * 177.5, 29], [29, sign * 177.5]].every(([x,z]) => {
      const p = d.resolveBoundary(x,z);
      return p.x === x && p.z === z && d.roadProbe(x,z).onRoad;
    })) && d.resolveBoundary(b.maxX + 5, 29).x === b.maxX - 1;
});
if (!outerLanesClear) fail("An outer Tokyo lane is blocked or its concrete perimeter disagrees with collision");
await verifyRoadside(page, [0, 1]);
await page.screenshot({ path: join(SHOTS, "06-tokyo-network.png") });
await page.evaluate(() => window.__gameDebug?.exitMode?.());
await page.evaluate(() => window.__gameDebug?.setLegacyMapsForTest(["yokohama"]));
await page.locator('[data-a="play"]').click();
await page.locator('[data-a="activity:delivery"]').click();
await page.locator('[data-a="map:yokohama"]').click();
const selectedMap = await page.evaluate(() => window.__gameDebug?.mapId?.());
if (selectedMap !== "yokohama") fail("Selecting Yokohama did not switch the active map");
const yokohamaBuildingCount = await page.evaluate(() => window.__gameDebug.cityBuildingCount());
if (yokohamaBuildingCount < 350) fail(`Yokohama's generated industrial infill is sparse: ${yokohamaBuildingCount} sites`);
const yokohamaPortScene = await page.evaluate(() => window.__gameDebug?.portVisuals?.());
if (
  !yokohamaPortScene || typeof yokohamaPortScene !== "object" ||
  yokohamaPortScene.interiorWater < 1 ||
  yokohamaPortScene.warehouses < 3 ||
  yokohamaPortScene.containerStacks < 3 ||
  yokohamaPortScene.containerInstances < 24 ||
  yokohamaPortScene.gantryCranes < 2 ||
  yokohamaPortScene.piers < 1 ||
  yokohamaPortScene.cargoShips < 1 ||
  yokohamaPortScene.tankFarms < 1
) fail(`Yokohama's harbor water or port facilities were not rendered: ${JSON.stringify(yokohamaPortScene)}`);
const yokohamaTraffic = await page.evaluate(() => window.__gameDebug.trafficPos());
if (yokohamaTraffic.length < 6 || yokohamaTraffic.length > 10 || (await page.evaluate((cars) => cars.some((car) => !window.__gameDebug.roadProbe(car.x, car.z).onRoad), yokohamaTraffic))) fail("Yokohama NPC traffic is missing, overcrowded, or off its authored roads");
if (yokohamaTraffic.some((a, i) => yokohamaTraffic.slice(i + 1).some((b) => {
  if (a.routeIndex !== b.routeIndex || a.dir !== b.dir) return false;
  const delta = Math.abs(a.progress - b.progress);
  return Math.min(delta, a.routeLength - delta) < 16;
}))) fail("Yokohama NPCs are packed too tightly in one lane");
const yokohamaLayout = await page.evaluate(() => window.__gameDebug.layoutSnapshot());
if (!yokohamaLayout.signals.length || (await page.evaluate((signals) => signals.some((point) => !window.__gameDebug.roadProbe(point.x, point.z).onRoad), yokohamaLayout.signals))) fail("Yokohama signal junctions are not on authored roads");
const layoutSignature = (layout) => JSON.stringify(layout.roads.map(({ id, points }) => [id, points]));
if (layoutSignature(tokyoLayout) === layoutSignature(yokohamaLayout)) fail("Tokyo and Yokohama minimap road topologies are identical");
await page.waitForTimeout(700);
await page.screenshot({ path: join(SHOTS, "07-yokohama-network.png") });
// Inspect the port props from a normal approach road, at the same following-camera height as play.
await page.evaluate(() => window.__gameDebug.teleport(45, 47, 0));
await page.waitForTimeout(900);
await page.screenshot({ path: join(SHOTS, "08-yokohama-quay.png") });
const savedMap = await page.evaluate(() => JSON.parse(localStorage.getItem("delivery-drift-86-save-v2") ?? "{}").mapId);
if (savedMap !== "yokohama") fail("The selected map was not saved to the player profile");
await page.evaluate(() => window.__gameDebug?.exitMode?.());
await page.locator('[data-a="play"]').click();
await page.locator('[data-a="activity:delivery"]').click();
await page.locator('[data-a="map:tokyo"]').click();
if (await page.evaluate(() => window.__gameDebug?.mapId?.()) !== "tokyo") fail("Switching back to Tokyo did not rebuild the city");
if (await page.evaluate(() => window.__gameDebug?.portVisuals?.())) fail("Port props remained after switching back to Tokyo");
await page.evaluate(() => window.__gameDebug?.exitMode?.());
await page.locator('[data-a="play"]').click();
await page.locator('[data-a="activity:delivery"]').click();
await page.locator('[data-a="map:yokohama"]').click();
if (await page.evaluate(() => window.__gameDebug?.mapId?.()) !== "yokohama") fail("Yokohama could not be reselected after returning to Tokyo");
const hasEventState = await page.evaluate(() => typeof window.__gameDebug?.weeklyEventSeen === "function" && typeof window.__gameDebug?.markWeeklyEventSeen === "function");
if (!hasEventState) fail("Weekly event seen state helpers are missing");
await page.evaluate(() => window.__gameDebug.markWeeklyEventSeen("2026-11-16T12:00:00Z"));
if (!(await page.evaluate(() => window.__gameDebug.weeklyEventSeen("2026-11-17T12:00:00Z")))) fail("Weekly event dismissal was not kept for the same UTC week");
if (await page.evaluate(() => window.__gameDebug.weeklyEventSeen("2026-11-23T00:00:00Z"))) fail("Weekly event dismissal leaked into the next UTC week");
await page.evaluate(() => window.__gameDebug.markWeeklyEventSeen());
const weeklyIds = await page.evaluate(() => window.__gameDebug?.weekly?.());
if (!Array.isArray(weeklyIds) || weeklyIds.length !== 3) fail("The weekly route set is missing");
const routeData = await page.evaluate(() => window.__gameDebug?.weeklyRoutes?.());
if (!(await page.evaluate((routes) => routes.every((route) => window.__gameDebug.roadProbe(route.dest.x, route.dest.z).onRoad), routeData))) fail("A weekly route destination is outside the authored road network");
if (await page.evaluate(() => window.__gameDebug?.weekKey?.("2026-11-15T23:59:00Z")) !== "2026-11-09") fail("UTC weekly key changed before Monday");
if (await page.evaluate(() => window.__gameDebug?.weekKey?.("2026-11-16T00:00:00Z")) !== "2026-11-16") fail("UTC weekly key did not rotate on Monday");
await page.evaluate(() => window.__gameDebug?.exitMode?.());
await page.locator('[data-a="profile"]').click();
if (!(await page.getByText("НЕДЕЛЬНЫЕ МАРШРУТЫ").count())) fail("The records and weekly routes screen did not open");
await page.screenshot({ path: join(SHOTS, "05-profile.png") });
await page.locator('[data-a="weekly:0"]').click();
await page.evaluate(() => window.__gameDebug?.finishWeekly?.());
if ((await page.evaluate(() => window.__gameDebug?.weeklyProgress?.()?.completed?.length)) !== 1) fail("Completing a weekly route was not saved");
await page.locator('[data-a="menu"]').click();
await page.locator('[data-a="profile"]').click();
await page.locator('[data-a="weekly:0"]').click();
await page.evaluate(() => window.__gameDebug?.finishWeekly?.());
if ((await page.evaluate(() => window.__gameDebug?.weeklyProgress?.()?.completed?.length)) !== 1) fail("Replaying a weekly route changed completed route progress");
await page.locator('[data-a="menu"]').click();
await page.locator('[data-a="profile"]').click();
if (!(await page.evaluate(() => Object.keys((JSON.parse(localStorage.getItem("delivery-drift-86-save-v2") ?? "{}").records ?? {})).some((key) => key.includes(":delivery:"))))) fail("Delivery personal records were not saved");
await page.locator('[data-a="back"]').click();
await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
if (Math.abs(await page.evaluate(() => window.__gameDebug.showroom().angle) - restoredTitle.angle) > .0001)
  fail("The parked title car inherited another screen's rotation");


// Both short modes can start, complete, and be replayed without counting as deliveries.
await page.evaluate(() => window.__gameDebug?.setDeliveriesForTest?.(0));
for (const [mode, label] of [["drift-trial", "DRIFT TRIAL"], ["time-attack", "TIME ATTACK"]]) {
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem("delivery-drift-86-save-v2") ?? "{}"));
  await page.locator('[data-a="play"]').click();
  if (mode === "drift-trial") await page.screenshot({ path: join(SHOTS, "mode-picker.png") });
  await page.locator(`[data-a="activity:${mode}"]`).click();
  await page.locator('[data-a="map:tokyo"]').click();
  if (await page.evaluate(() => window.__gameDebug?.mode?.()) !== mode) fail(`${label} did not start`);
  const modeState = await page.evaluate(() => window.__gameDebug?.modeState?.());
  if (await page.locator(".hud-cargo").isVisible()) fail(`${label} still shows irrelevant cargo damage`);
  if ((await page.evaluate(() => window.__gameDebug.destinationVisible())) !== (mode === "time-attack")) fail(`${label} showed the wrong destination marker`);
  if ((await page.locator(".hud-navigation").isVisible()) !== (mode === "time-attack")) fail(`${label} showed the wrong route arrow state`);
  const tutorial = page.locator("dialog.tutorial[open]");
  if (!(await tutorial.isVisible())) fail(`${label} did not show its own tutorial`);
  if (/груз|красн.{0,10}сигнал|штраф/i.test(await tutorial.textContent() ?? "")) fail(`${label} still shows delivery-only hints`);
  if (modeState.elapsed !== 0) fail(`${label} timer advanced while the tutorial was open`);
  await tutorial.locator('[data-a="tut-ok"]').click();
  await page.screenshot({ path: join(SHOTS, `mode-${mode}-hud.png`) });
  if (mode === "time-attack") {
    if (!modeState?.course || modeState.course.checkpoints.length !== 5 || modeState.checkpoint !== 0) fail("Time Attack did not start a fixed five-gate course");
    const trafficNearStart = await page.evaluate(() => {
      const player = window.__gameProbe();
      return window.__gameDebug.trafficPos().some((car) => Math.hypot(car.x - player.x, car.z - player.z) < 95);
    });
    if (trafficNearStart) fail("Time Attack spawned NPC traffic near its course start");
    const lapTimer = await page.locator(".hud-timer").textContent();
    const displayedLap = Number((lapTimer ?? "").match(/([\d.]+)с/)?.[1]);
    const elapsedNow = await page.evaluate(() => window.__gameDebug.modeState().elapsed);
    if (!Number.isFinite(displayedLap) || Math.abs(displayedLap - elapsedNow) > 1) fail("Time Attack HUD is not showing elapsed lap time");
    const target = await page.evaluate(() => window.__gameDebug?.orderDest?.());
    if (Math.hypot(target.x - modeState.course.checkpoints[0].x, target.z - modeState.course.checkpoints[0].z) > 0.01) fail("Time Attack did not display its first ordered checkpoint");
    await page.evaluate((point) => window.__gameDebug.teleport(point.x, point.z), modeState.course.checkpoints[1]);
    await page.waitForTimeout(120);
    if ((await page.evaluate(() => window.__gameDebug.modeState().checkpoint)) !== 0) fail("Time Attack accepted an out-of-order checkpoint");
    for (let checkpoint = 0; checkpoint < 4; checkpoint++) {
      await page.evaluate((point) => window.__gameDebug.teleport(point.x, point.z), modeState.course.checkpoints[checkpoint]);
      await page.waitForFunction(index => window.__gameDebug.modeState().checkpoint === index, checkpoint + 1, { timeout: 4000 });
      const nextState = await page.evaluate(() => window.__gameDebug.modeState());
      const nextTarget = await page.evaluate(() => window.__gameDebug.orderDest());
      if (nextState.checkpoint !== checkpoint + 1 || Math.hypot(nextTarget.x - modeState.course.checkpoints[checkpoint + 1].x, nextTarget.z - modeState.course.checkpoints[checkpoint + 1].z) > 0.01) fail(`Time Attack did not advance from gate ${checkpoint + 1} in order`);
      const checkpointToast = await page.locator(".toast").textContent();
      if (!checkpointToast?.includes(`${checkpoint + 2}/5`)) fail("Time Attack checkpoint toast has an inconsistent total");
    }
    await page.evaluate((point) => {
      window.__gameDebug.setElapsedForTest(window.__gameDebug.modeState().course.goldTime - 3);
      window.__gameDebug.teleport(point.x, point.z);
    }, modeState.course.checkpoints[4]);
    await page.locator(".result").waitFor();
  } else {
    await page.evaluate(() => {
      window.__gameDebug.seedDriftChainForTest(260, 240);
      window.__gameDebug.setElapsedForTest(59.95);
    });
    await page.locator(".result").waitFor();
  }
  if (!(await page.getByText(label, { exact: true }).count())) fail(`${label} did not show its result`);
  if (!(await page.locator(".result.ok").count())) fail(`${label} did not finish successfully`);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem("delivery-drift-86-save-v2") ?? "{}"));
  const expectedReward = mode === "drift-trial" ? 450 : 1100;
  if (after.deliveries !== before.deliveries) fail(`${label} incorrectly counted as a delivery`);
  if (after.money < before.money + expectedReward) fail(`${label} did not pay its medal reward`);
  if (after.totalEarn < (before.totalEarn ?? 0) + expectedReward) fail(`${label} reward was not added to career earnings`);
  if (mode === "drift-trial" && !after.unlockedAch.includes("drifter-silver")) fail("Drift Trial silver achievement was not awarded");
  if (mode === "time-attack" && !after.unlockedAch.includes("time-attack-gold")) fail("Time Attack gold achievement was not awarded");
  await page.screenshot({ path: join(SHOTS, `mode-${mode}-result.png`) });
  const hasRecord = await page.evaluate((mode) => Object.keys((JSON.parse(localStorage.getItem("delivery-drift-86-save-v2") ?? "{}").records ?? {})).some((key) => key.includes(mode === "time-attack" ? ":time-attack-course-v1:" : `:${mode}:`)), mode);
  if (!hasRecord) fail(`${label} personal record was not saved`);
  if (mode === "time-attack") {
    await page.locator('[data-a="replay"]').press("Enter");
  }
  else await page.locator('[data-a="replay"]').click();
  if (await page.evaluate(() => window.__gameDebug?.mode?.()) !== mode) fail(`${label} replay did not restart the same mode`);
  await page.keyboard.press("Escape");
  await page.locator('[data-a="retry"]').click();
  if (await page.evaluate(() => window.__gameDebug?.mode?.()) !== mode) fail(`${label} paused retry did not restart the same mode`);
  if (mode === "time-attack" && (await page.evaluate(() => window.__gameDebug.modeState().checkpoint)) !== 0) fail("Time Attack retry did not reset its checkpoint sequence");
  await page.evaluate(() => window.__gameDebug?.exitMode?.());
}
await page.locator('[data-a="cars"]').click();
for (const [carId, name] of [["silvia", "Nissan Silvia S15"], ["evo", "Mitsubishi Lancer Evo IX"]]) {
  await page.locator(`[data-a="inspect:${carId}"]`).click();
  const car = page.locator(".garage-detail").filter({ hasText: name });
  if (await car.locator(`[data-a="buy:${carId}"]`).count() !== 1 || (await car.locator(".garage-status").textContent()) !== "Доступна") {
    fail(`${name} did not unlock from its mode medal`);
  }
}
await page.locator('[data-showroom-stage][data-car="evo"][data-model="ready"]').waitFor();
if (await page.getByText("Перетащи, чтобы повернуть", { exact: false }).count()) fail("The showroom still explains the rotation gesture");
await page.screenshot({ path: join(SHOTS, "mode-unlocked-cars.png") });
await page.locator('[data-a="back"]').click();
const beforeUnlimited = await page.evaluate(() => JSON.parse(localStorage.getItem("delivery-drift-86-save-v2") ?? "{}").deliveries);
for (let i = 0; i < 2; i++) {
  await page.locator('[data-a="play"]').click();
  await page.locator('[data-a="activity:delivery"]').click();
  await page.locator('[data-a="map:tokyo"]').click();
  const orderDest = await page.evaluate(() => window.__gameDebug.orderDest());
  if (!orderDest || !(await page.evaluate((point) => window.__gameDebug.roadProbe(point.x, point.z).onRoad, orderDest))) fail("A regular delivery destination is outside the authored road network");
  await page.evaluate(() => window.__gameDebug?.finishDelivery?.());
  await page.locator('[data-a="menu"]').click();
}
const afterUnlimited = await page.evaluate(() => JSON.parse(localStorage.getItem("delivery-drift-86-save-v2") ?? "{}").deliveries);
if (afterUnlimited !== beforeUnlimited + 2) fail("Ordinary deliveries were not available repeatedly");

// 1) The canvas must actually render content (not a black screen). Judge by reading the drawing
//    buffer, not the screenshot — on headless/swiftshader the compositor may show the canvas as
//    black while the drawing buffer holds the real frame. WebGL needs preserveDrawingBuffer for
//    that read (the verification build enables it); 2D canvases go through getImageData.
const shot = await page.evaluate((id) => {
  const SAMPLES = [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75]];
  const el = document.getElementById(id);
  if (!el) {
    const others = Array.from(document.querySelectorAll("canvas")).map((c) => c.id || "(no id)");
    return { kind: "no-canvas", others };
  }
  if (!(el instanceof HTMLCanvasElement)) return { kind: "not-canvas", tag: el.tagName.toLowerCase() };

  const gl = el.getContext("webgl2") || el.getContext("webgl");
  if (gl) {
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    if (!w || !h) return { kind: "empty-buffer", api: "webgl", w, h };
    const px = new Uint8Array(4);
    let lit = 0;
    for (const [fx, fy] of SAMPLES) {
      gl.readPixels((w * fx) | 0, (h * fy) | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      if (px[3] > 0 && px[0] + px[1] + px[2] > 8) lit++;
    }
    return { kind: "lit", api: "webgl", lit, total: SAMPLES.length };
  }

  const ctx = el.getContext("2d");
  if (ctx) {
    const w = el.width, h = el.height;
    if (!w || !h) return { kind: "empty-buffer", api: "2d", w, h };
    let lit = 0;
    try {
      for (const [fx, fy] of SAMPLES) {
        const d = ctx.getImageData((w * fx) | 0, (h * fy) | 0, 1, 1).data;
        if (d[3] > 0 && d[0] + d[1] + d[2] > 8) lit++;
      }
    } catch (e) {
      return { kind: "tainted", message: String(e) };
    }
    return { kind: "lit", api: "2d", lit, total: SAMPLES.length };
  }
  return { kind: "no-context" };
}, CANVAS_ID);

switch (shot.kind) {
  case "no-canvas":
    fail(
      `no element with id="${CANVAS_ID}" on the page, so the render check could not run.\n` +
      `  This script looks up document.getElementById("${CANVAS_ID}"); the template renders that id from src/pages/Home.tsx.\n` +
      (shot.others.length
        ? `  Canvases that do exist: ${shot.others.join(", ")} — you renamed the id.\n`
        : `  There is no <canvas> on the page at all — did startGame() run, or did the page throw before mounting?\n`) +
      `  Fix: keep id="${CANVAS_ID}" in the page, or change CANVAS_ID at the top of this script to the id you use.`
    );
    break;
  case "not-canvas":
    fail(`the element with id="${CANVAS_ID}" is a <${shot.tag}>, not a <canvas> — give the canvas that id (src/pages/Home.tsx), or point CANVAS_ID at the right element.`);
    break;
  case "no-context":
    fail(`#${CANVAS_ID} exposes neither a WebGL nor a 2D context — this is not a drawable canvas, so "black" cannot be judged. Check how the renderer acquires its context in src/game/boot.ts.`);
    break;
  case "tainted":
    fail(`#${CANVAS_ID} is a 2D canvas whose pixels cannot be read back (${shot.message}) — a cross-origin image tainted it. Serve textures from the project itself so the render check can run.`);
    break;
  case "empty-buffer":
    fail(`#${CANVAS_ID} has a zero-sized ${shot.api} buffer (${shot.w}x${shot.h}) — the canvas was never sized. Set renderer.setSize()/canvas.width+height in src/game/boot.ts.`);
    break;
  case "lit":
    if (shot.lit < 2) {
      fail(shot.api === "webgl"
        ? `#${CANVAS_ID} (WebGL) is black: only ${shot.lit}/${shot.total} sampled pixels carry colour. If you are sure the game has visuals, check whether the renderer disabled preserveDrawingBuffer — without it the buffer reads back empty.`
        : `#${CANVAS_ID} (2D) is blank: only ${shot.lit}/${shot.total} sampled pixels carry colour. Nothing was drawn to the 2D context by the time of the check.`);
    }
    break;
  default:
    fail(`unexpected canvas check result: ${JSON.stringify(shot)}`);
}
await page.screenshot({ path: join(SHOTS, "01-title.png") });

// 2) Enter playing
await page.locator('[data-a="play"]').click();
await page.locator('[data-a="activity:delivery"]').click();
await page.locator('[data-a="map:tokyo"]').click();
await page.waitForTimeout(400);
const nitroBefore = await page.evaluate(() => window.__gameDebug?.nitroFuel?.());
if (typeof nitroBefore !== "number") fail("Nitro fuel meter is not exposed");
await page.keyboard.down("KeyW");
await page.keyboard.down("ShiftLeft");
await page.waitForTimeout(700);
await page.keyboard.up("ShiftLeft");
await page.keyboard.up("KeyW");
const nitroAfter = await page.evaluate(() => window.__gameDebug?.nitroFuel?.());
if (!(nitroAfter < nitroBefore && nitroAfter >= 0)) fail("Shift did not consume bounded nitro fuel");

// 3) Check direction without assuming a fixed frame rate on software-rendered CI.
async function checkDirection(key, axis, direction, distance = 0.05) {
  const before = await page.evaluate(() => ({ position: window.__gameProbe(), elapsed: window.__gameDebug.modeState().elapsed }));
  let passed = false;
  await page.keyboard.down(key);
  try {
    const result = await page.waitForFunction(
      ({ before, axis, direction, distance }) => {
        const moved = (window.__gameProbe()[axis] - before.position[axis]) * direction > distance;
        const elapsed = window.__gameDebug.modeState().elapsed - before.elapsed;
        return moved || elapsed >= 1.5 ? { passed: moved && elapsed <= 1.5 } : false;
      },
      { before, axis, direction, distance },
      { timeout: 12000 },
    );
    passed = (await result.jsonValue()).passed;
  } catch (error) {
    if (error.name !== "TimeoutError") throw error;
  } finally {
    await page.keyboard.up(key);
  }
  if (!passed) {
    const state = await page.evaluate(() => ({
      position: window.__gameProbe(), elapsed: window.__gameDebug.modeState().elapsed,
      speed: window.__gameDebug.speed(), screen: window.__gameDebug.screen(),
    }));
    console.error(`${key} did not travel ${distance} on ${axis}: ${JSON.stringify({ before, after: state })}`);
  }
  return passed;
}

const probe = await page.evaluate(() => !!window.__gameProbe);
if (probe) {
  // Test reverse from a stop independently of the nitro run above.
  await page.evaluate(() => window.__gameDebug.teleport(0, 0, Math.PI));
  if (!await checkDirection("KeyS", "z", 1, 0.75)) fail("S did not move the car backwards at a useful speed");
  await page.evaluate(() => window.__gameDebug.teleport(0, 0, Math.PI));
  if (!await checkDirection("KeyW", "z", -1)) fail("W did not move forward");
  // Steering changes heading while gas keeps the car moving.
  await page.keyboard.down("KeyW");
  const steeredRight = await checkDirection("KeyD", "x", 1);
  await page.keyboard.up("KeyW");
  if (!steeredRight) fail("D did not move right");
} else {
  console.warn("WARN: window.__gameProbe not injected, skipping direction assertions (expose a player-coordinate probe in src/game/boot.ts)");
}

// 4) Gameplay screenshot + Esc pause + restart
await page.screenshot({ path: join(SHOTS, "02-gameplay.png") });
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
await page.screenshot({ path: join(SHOTS, "03-paused.png") });

console.log("Gameplay smoke passed; checking audit regressions across maps and tabs.");
// Audit regressions across maps, mobile input, and shared saves.
await page.evaluate(() => {
  window.__gameDebug.exitMode();
  window.__gameDebug.setLegacyMapsForTest([]);
});
await page.locator('[data-a="play"]').click();
await page.locator('[data-a="activity:drift-trial"]').click();
if (!(await page.locator('[data-a="map:yokohama"]').isDisabled())) fail("Free-play medals bypassed the career gate");
await page.evaluate(() => {
  window.__gameDebug.exitMode();
  window.__gameDebug.setLegacyMapsForTest(["yokohama","spb","kazan","sochi"]);
});
const cityLandmarks = {
  tokyo: ["shrine-gate", "tokyo-radio-tower"],
  yokohama: ["marine-observation-tower"],
  spb: ["admiralty-spire", "palace-embankment", "central-neva-bridge"],
  kazan: ["soyembika-tower", "kul-sharif-mosque", "kazan-family-centre"],
  sochi: ["fisht-stadium", "marine-terminal", "seaside-palms"],
};
const cityPalettes = new Set();
for (const [city, landmarks] of Object.entries(cityLandmarks)) {
  await page.locator('[data-a="play"]').click();
  await page.locator('[data-a="activity:delivery"]').click();
  await page.locator(`[data-a="map:${city}"]`).click();
  const state = await page.evaluate(() => {
    const debug = window.__gameDebug;
    const mapId = debug.mapId();
    const world = debug.scene.getObjectByName(`world-${mapId}`);
    const batches = world.getObjectByName("city-buildings").children.filter((mesh) => mesh.isInstancedMesh);
    const atlas = batches[0]?.material.map;
    const ground = world.getObjectByName("city-ground");
    const decks = [];
    world.traverse((object) => { if (object.name === "road-deck") decks.push(object); });
    let clearCrossing = true;
    if (mapId === "sochi") {
      const texture = ground.material.map.image;
      const size = ground.geometry.parameters.width;
      const pixels = texture.getContext("2d");
      const toPixel = (value) => Math.floor((value / size + 0.5) * texture.width);
      clearCrossing = [[5.85, 2], [-5.85, -2], [2, 5.35], [-2, -5.35]].every(([x, z]) => {
        const [r, g, b] = pixels.getImageData(toPixel(x), toPixel(z), 1, 1).data;
        return Math.max(r, g, b) < 130;
      });
    }
    return {
      city: mapId, cache: debug.worldCacheSize(), buildings: debug.cityBuildingCount(), traffic: debug.trafficPos().length,
      landmarks: world.getObjectByName(`landmarks-${mapId}`).children.map((mesh) => mesh.name),
      batches: batches.length, instanceCount: batches.reduce((count, mesh) => count + mesh.count, 0),
      sharedAtlas: !!atlas && atlas.image.width === 512 && batches.every((mesh) => mesh.material.map === atlas),
      fog: debug.scene.fog.color.getHex(),
      decks: decks.length, sharedDeckSurface: decks.every((deck) => deck.material === ground.material), clearCrossing,
    };
  });
  if (state.city !== city || state.cache > 2 || state.buildings < (city === "yokohama" ? 350 : 400) || state.traffic < 5) {
    fail(`Unexpected world after switching to ${city}: ${JSON.stringify(state)}`);
  }
  if (state.batches !== 2 || state.instanceCount !== state.buildings || !state.sharedAtlas ||
      !landmarks.every((name) => state.landmarks.includes(name))) {
    fail(`Missing landmark or architecture batch in ${city}: ${JSON.stringify(state)}`);
  }
  if (state.decks !== (city === "yokohama" || city === "spb" ? 3 : 0) || !state.sharedDeckSurface || !state.clearCrossing) {
    fail(`Broken roadway paint or deck transition in ${city}: ${JSON.stringify(state)}`);
  }
  cityPalettes.add(state.fog);
  await page.evaluate(() => window.__gameDebug.exitMode());
}
if (cityPalettes.size !== Object.keys(cityLandmarks).length) fail("Cities reuse the same scene lighting palette");

await page.locator('[data-a="play"]').click();
await page.locator('[data-a="activity:delivery"]').click();
await page.locator('[data-a="map:tokyo"]').click();
const deliveriesBefore = await page.evaluate(() => window.__gameDebug.profile().deliveries);
await page.evaluate(() => {
  const debug = window.__gameDebug;
  const dest = debug.orderDest();
  debug.setCargoForTest(0);
  debug.teleport(dest.x, dest.z);
});
await page.locator(".result.bad").waitFor();
if (await page.evaluate(() => window.__gameDebug.profile().deliveries) !== deliveriesBefore) fail("Destroyed cargo counted as delivered");

await page.locator('[data-a="menu"]').click();
await page.locator('[data-a="play"]').click();
await page.locator('[data-a="activity:time-attack"]').click();
await page.locator('[data-a="map:tokyo"]').click();
await page.evaluate(() => window.__gameDebug.setElapsedForTest(9999));
await page.locator(".result.bad").waitFor();
if (!(await page.getByText("Время до схода", { exact: false }).isVisible())) fail("Failed Time Attack was presented as a finished lap");
// Enter a career event through its brief and continue from the saved result.
await page.locator('[data-a="menu"]').click();
await page.locator('[data-a="play"]').click();
await page.locator('[data-a="career"]').click();
await page.locator('[data-a="chapter-1"]').click();
if (!(await page.locator('[data-a="launch"]').isDisabled())) fail("Unplayed chapter let the player skip its qualifier");
await page.locator('[data-a="chapter-0"]').click();
await page.locator('[data-a="launch"]').click();
await page.evaluate(() => window.__gameDebug.finishDelivery());
await page.getByText("ЭТАП ПРОЙДЕН", {exact:true}).waitFor();
await page.locator('[data-a="career-next"]').click();
if (await page.locator('[data-a="stage-2"]').getAttribute("aria-pressed") !== "true") fail("Career did not select the next event");
await page.close();

const mobileContext = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });
const mobile = await mobileContext.newPage();
mobile.on("pageerror", (e) => consoleErrors.push(String(e)));
await mobile.clock.setFixedTime(new Date("2026-11-22T23:59:54Z"));
await mobile.addInitScript(() => {
  const raw = JSON.stringify({ money: 21000, deliveries: 7, carId: "ae86", ownedCars: ["ae86"], mapId: "old-map", upgrades: {}, unlockedAch: null });
  localStorage.setItem("delivery-drift-86-save-v1", raw);
  localStorage.setItem("delivery-drift-86-records-v1", JSON.stringify({
    "tokyo:time-attack-course-v1:ae86": "invalid",
    "tokyo:drift-trial:ae86": 260,
  }));
  const set = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (key === "delivery-drift-86-save-v2" && window.denyProfileWrite) {
      throw new DOMException("Temporarily blocked", "QuotaExceededError");
    }
    return set.call(this, key, value);
  };
});
await mobile.goto(`http://127.0.0.1:${port}/`);
await mobile.locator('[data-a="event-start"]').tap();
const touchTutorial = mobile.locator("dialog.tutorial[open]");
if (!(await touchTutorial.getByText(/джойстике/).isVisible())) fail("Touch tutorial did not show the joystick");
const tickBefore = await mobile.evaluate(() => window.__gameDebug.ticks());
await mobile.waitForFunction((start) => window.__gameDebug.ticks() > start + 8, tickBefore);
if (await mobile.evaluate(() => window.__gameDebug.modeState().elapsed) !== 0) fail("Mobile tutorial consumed race time");
await touchTutorial.locator('[data-a="tut-ok"]').tap();
if (!(await mobile.locator("#touch-controls").isVisible())) fail("Touch controls were not enabled after the tutorial");
await mobile.setViewportSize({width:390,height:844});
await mobile.locator("#turn-phone:modal").waitFor();
const frozenTime = await mobile.evaluate(() => window.__gameDebug.modeState().elapsed);
await mobile.waitForTimeout(350);
if (await mobile.evaluate(() => window.__gameDebug.modeState().elapsed) !== frozenTime) fail("Portrait consumed race time");
await mobile.setViewportSize({width:844,height:390});
await mobile.locator("#turn-phone").waitFor({state:"hidden"});
await mobile.waitForFunction(t => window.__gameDebug.modeState().elapsed > t, frozenTime);
await mobile.clock.setFixedTime(new Date("2026-11-23T00:00:02Z"));
await mobile.evaluate(() => {
  window.denyProfileWrite = true;
  window.__gameDebug.finishWeekly();
});
await mobile.locator(".result.ok").waitFor();
if (!(await mobile.getByText("Маршруты недели от 2026-11-16: 1/3", { exact: true }).isVisible())) fail("Weekly finish was credited to the wrong week");
const notice = mobile.locator(".save-notice");
if (!(await notice.isVisible())) fail("Write failure did not show the persistent save warning");
await mobile.evaluate(() => { window.denyProfileWrite = false; });
await notice.getByRole("button").tap();
if (await notice.isVisible()) fail("Save warning remained after a successful retry");
const saved = await mobile.evaluate(() => JSON.parse(localStorage.getItem("delivery-drift-86-save-v2")));
if (saved.money <= 21000 || saved.deliveries !== 8 || saved.weeklyCompletions["2026-11-16"]?.length !== 1 ||
    saved.weeklyCompletions["2026-11-23"]?.length || saved.mapId !== "tokyo") fail("Retry failed to retain the career and old weekly result");

const secondTab = await mobileContext.newPage();
await secondTab.goto(`http://127.0.0.1:${port}/`);
await secondTab.getByRole("heading", { name: "Игра открыта в другой вкладке" }).waitFor();
await secondTab.getByRole("button", { name: "Ждать освобождения" }).click();
await mobile.close();
await secondTab.locator(".home-career").waitFor();
const displayedMoney = await secondTab.locator(".home-career > span").first().textContent();
if (Number(displayedMoney.replace(/[^\d]/g, "")) !== saved.money) fail("The next tab did not load the latest progress");
if (await secondTab.locator('[data-a="event-dismiss"]').isVisible()) await secondTab.locator('[data-a="event-dismiss"]').tap();
await secondTab.locator('[data-a="profile"]').tap();
const row = secondTab.locator(".record-row").filter({ hasText: "Drift Trial" });
if (!(await row.getByText(/Toyota AE86 Sprinter/).isVisible()) || !(await row.getByText("260 очк.").isVisible())) {
  fail("Migrated records did not show the car name and score unit");
}
if (await secondTab.locator(".record-row").filter({ hasText: "Time Attack" }).count()) fail("Malformed time record reached the UI");
await mobileContext.close();

// A fresh career can lose three separate patrols, submit a record and retry.
const radioPage = await browser.newPage({ viewport: { width: 1000, height: 620 } });
radioPage.on("pageerror", (error) => consoleErrors.push(String(error)));
await radioPage.goto(`http://127.0.0.1:${port}/`);
await radioPage.locator('[data-a="event-dismiss"]').click();
await radioPage.evaluate(() => window.__gameDebug.damageTest());
await radioPage.locator('[data-a="play"]').click();
await radioPage.locator('[data-a="activity:radio-silence"]').click();
await radioPage.locator('[data-a="map:tokyo"]').click();
await radioPage.locator("dialog.tutorial[open]").waitFor();
const radioStart = await radioPage.evaluate(() => {
  const debug = window.__gameDebug;
  return { hp: debug.hp(), mode: debug.mode(), phase: debug.radio().phase, time: debug.radio().timeLeft };
});
if (radioStart.hp !== 100 || radioStart.mode !== "radio-silence" || radioStart.phase !== "transmitter" || radioStart.time !== 120 ||
  await radioPage.locator(".hud-cargo").isVisible()) fail(`Invalid Radio Silence start: ${JSON.stringify(radioStart)}`);
await radioPage.locator('[data-a="tut-ok"]').click();
await radioPage.keyboard.down("KeyW");
await radioPage.waitForFunction(() => window.__gameDebug.radio()?.phase === "pursuit");
await radioPage.keyboard.up("KeyW");
await radioPage.screenshot({ path: join(SHOTS, "mode-radio-silence-hud.png") });
for (let wave = 0; wave < 3; wave++) {
  if (wave > 0) {
    await radioPage.evaluate(() => {
      const debug = window.__gameDebug;
      const { x, z } = debug.radio().target;
      debug.teleport(x, z);
    });
    await radioPage.waitForFunction(() => window.__gameDebug.policeActive());
  }
  await radioPage.evaluate(() => {
    const debug = window.__gameDebug;
    const { x, z } = debug.radio().cache;
    debug.teleport(x, z);
  });
  await radioPage.waitForFunction(() => window.__gameDebug.radio()?.carryingPacket);
  await radioPage.evaluate(() => {
    const debug = window.__gameDebug;
    const { x, z } = debug.radio().target;
    debug.teleport(x, z);
  });
  await radioPage.waitForFunction((expected) => window.__gameDebug.radio()?.escapes === expected, wave + 1);
  if (await radioPage.evaluate(() => window.__gameDebug.policeActive())) fail("Patrol stayed active after reaching the safe zone");
}
await radioPage.locator(".result.ok").waitFor();
await radioPage.screenshot({ path: join(SHOTS, "mode-radio-silence-result.png") });
const radioSave = await radioPage.evaluate(() => JSON.parse(localStorage.getItem("delivery-drift-86-save-v2")));
if (radioSave.stats.escapes !== 3 || radioSave.deliveries !== 0 || !radioSave.unlockedAch.includes("escapee") ||
  radioSave.totalEarn !== 1300 || !(radioSave.records["tokyo:radio-silence:ae86"] >= 1250)) {
  fail("Radio Silence did not persist three escapes, the gold payout and the record");
}
await radioPage.locator('[data-a="replay"]').click();
if (await radioPage.evaluate(() => window.__gameDebug.radio().escapes !== 0) || await radioPage.locator("dialog.tutorial[open]").count()) {
  fail("Radio Silence replay reused progress or repeated the tutorial");
}
await radioPage.evaluate(() => window.__gameDebug.setElapsedForTest(120));
await radioPage.locator(".result.bad").waitFor();
if ((await radioPage.evaluate(() => window.__gameDebug.profile().money)) !== radioSave.money) fail("A timed-out attempt paid a reward");
await radioPage.locator('[data-a="garage"]').click();
if (await radioPage.evaluate(() => window.__gameDebug.radio() !== null || window.__gameDebug.hp() === 100)) {
  fail("Leaving Radio Silence did not restore the career car");
}
await radioPage.close();

// A fresh career can play the authored contract, share it, and return to its own car.
const nevaPage = await browser.newPage({ viewport: { width: 1000, height: 650 } });
nevaPage.on("pageerror", (error) => consoleErrors.push(String(error)));
await nevaPage.goto(`http://127.0.0.1:${port}/`);
await nevaPage.locator('[data-a="event-dismiss"]').click();
await nevaPage.locator('[data-a="play"]').click();
await nevaPage.locator('[data-a="neva"]').click();
await nevaPage.locator(".neva-brief").waitFor();
await nevaPage.screenshot({ path: join(SHOTS, "neva-briefing.png") });
await nevaPage.locator('[data-a="start-neva"]').click();
await nevaPage.locator("dialog.tutorial[open]").waitFor();
const trial = await nevaPage.evaluate(() => {
  const debug = window.__gameDebug;
  const save = JSON.parse(localStorage.getItem("delivery-drift-86-save-v2"));
  return { map: debug.mapId(), car: debug.neva()?.car, selected: save.mapId, elapsed: debug.modeState().elapsed };
});
if (trial.map !== "spb" || trial.car !== "vaz2107turbo" || trial.selected !== "tokyo" || trial.elapsed !== 0) {
  fail(`The fresh career did not receive an isolated contract car and route: ${JSON.stringify(trial)}`);
}
await nevaPage.waitForFunction(() => {
  const visual = window.__gameDebug.turboVisual();
  return visual.wing && visual.wheels.every(Boolean);
});
await nevaPage.locator('[data-a="tut-ok"]').click();
await nevaPage.keyboard.down("KeyW");
await nevaPage.keyboard.down("KeyA");
await nevaPage.waitForFunction(() => {
  const [front, , rear] = window.__gameDebug.turboVisual().wheels;
  return Math.abs(front.steer) > 0.05 && Math.abs(rear.steer) < 0.01 && Math.abs(front.spin) > 0.15;
});
await nevaPage.keyboard.up("KeyA");
await nevaPage.keyboard.up("KeyW");
await verifyRoadside(nevaPage, [2, 3]);
await nevaPage.screenshot({ path: join(SHOTS, "neva-course.png") });

await nevaPage.evaluate(() => {
  const debug = window.__gameDebug;
  // These samples exercise both gate transitions and the persisted finish separately from input timing.
  for (const [[x0, z0], bend, exit] of [[[17, 58], [0, 58], [0, 74]], [[0, 133], [0, 145], [-15, 145]]]) {
    let x = x0;
    let z = z0;
    for (const [tx, tz] of [bend, exit]) {
      const fromX = x;
      const fromZ = z;
      for (let i = 1; i <= 30; i++) {
        const nx = fromX + (tx - fromX) * i / 30;
        const nz = fromZ + (tz - fromZ) * i / 30;
        debug.driveNevaStepForTest(x, z, nx, nz, 12, 7, true);
        x = nx;
        z = nz;
      }
    }
  }
  debug.setElapsedForTest(15);
  const dest = debug.orderDest();
  debug.teleport(dest.x, dest.z);
});
await nevaPage.locator(".result.ok").waitFor();
if (!(await nevaPage.getByText(/за занос \+₽320/).isVisible())) fail("Both clean sectors did not pay their bonus");
const resultSave = await nevaPage.evaluate(() => JSON.parse(localStorage.getItem("delivery-drift-86-save-v2")));
if (resultSave.deliveries !== 1 || !resultSave.neva.mastered || !resultSave.unlockedAch.includes("neva-master") ||
    resultSave.carId !== "ae86" || resultSave.ownedCars.includes("vaz2107turbo")) fail("The contract did not save its reward and preserve the original garage");
await nevaPage.locator('[data-a="share-neva"]').click();
const shared = await nevaPage.getByRole("textbox", { name: "Ссылка на вызов" }).inputValue();
const link = new URL(shared);
if (link.searchParams.get("challenge") !== "neva-v1" || Number(link.searchParams.get("score")) !== resultSave.neva.bestScore) {
  fail("The share link did not carry the contract version and score");
}
await nevaPage.locator('[data-a="replay"]').click();
if ((await nevaPage.evaluate(() => window.__gameDebug.neva()?.cleanSectors)) !== 0 ||
    await nevaPage.locator("dialog.tutorial[open]").count()) fail("Contract replay did not reset its sectors or repeated the tutorial");
await nevaPage.evaluate(() => window.__gameDebug.setCargoForTest(0));
await nevaPage.locator(".result.bad").waitFor();
if ((await nevaPage.evaluate(() => window.__gameDebug.profile().money)) !== resultSave.money) fail("Failed contract paid a bonus");
await nevaPage.locator('[data-a="garage"]').click();
if ((await nevaPage.evaluate(() => window.__gameDebug.mapId())) !== "tokyo" ||
    !(await nevaPage.locator(".garage").getByText(/Toyota AE86 Sprinter/).first().isVisible())) fail("Leaving the contract did not restore the career car and world");
await nevaPage.close();

const rival = await browser.newPage({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });
rival.on("pageerror", (error) => consoleErrors.push(String(error)));
await rival.goto(link.href);
await rival.getByText(`Результат друга · ${resultSave.neva.bestScore} очк.`).waitFor();
await rival.locator('[data-a="start-neva"]').tap();
await rival.locator('[data-a="tut-ok"]').tap();
await rival.evaluate(() => {
  const debug = window.__gameDebug;
  const dest = debug.orderDest();
  debug.setElapsedForTest(20);
  debug.teleport(dest.x, dest.z);
});
await rival.locator(".result.ok").waitFor();
if (!(await rival.getByText(/До результата друга/).isVisible())) fail("The mobile challenge did not compare the safe finish with its target");
await rival.close();

// 5) Zero console errors
if (consoleErrors.length) fail(`${consoleErrors.length} console error(s): ${consoleErrors[0]}`);

await browser.close();
server.close();
console.log(`VERIFY OK: render/enter/direction/pause/console all passed; ${tokyoBuildingCount} Tokyo buildings, ${yokohamaBuildingCount} Yokohama buildings; screenshots in verification-shots/`);
