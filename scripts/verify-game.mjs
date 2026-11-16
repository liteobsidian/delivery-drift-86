/**
 * verify-game.mjs — Playwright smoke self-check: serve dist → zero console errors → three-state screenshots →
 * **direction-mapping assertions** (directly targets the most frequent playtest defect). When changing the input
 * mapping you must sync the assertions here.
 *
 * Usage: npm run build && node scripts/verify-game.mjs
 * Serves dist/public when a backend has been grafted on, otherwise dist/.
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
import { existsSync, mkdirSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not URL.pathname: .pathname keeps percent-encoding, so a project living under a
// path with a space (or any non-ASCII character) would yield ".../My%20Games/app" and every
// existsSync() below would miss, reporting "no build output" for a build that is right there.
const ROOT = fileURLToPath(new URL("../", import.meta.url));
// Build output location depends on whether a backend has been grafted on:
// plain game template -> dist/ ; after backend-building -> dist/public/ (dist/boot.js is the server bundle).
const DIST = existsSync(join(ROOT, "dist/public/index.html"))
  ? join(ROOT, "dist/public")
  : join(ROOT, "dist");
if (!existsSync(join(DIST, "index.html"))) {
  console.error(`VERIFY FAIL: no build output at ${DIST} — run \`npm run build\` first`);
  process.exit(1);
}
const SHOTS = join(ROOT, "verification-shots");
mkdirSync(SHOTS, { recursive: true });

// Must match <canvas id="..."> in src/pages/Home.tsx. Change both together.
const CANVAS_ID = "game-canvas";

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json", ".wasm": "application/wasm" };

const server = createServer(async (req, res) => {
  try {
    const raw = req.url === "/" ? "/index.html" : req.url.split("?")[0];
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

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
if (!(await page.locator('[data-a="event-dismiss"]').isVisible())) fail("Weekly event was not promoted on startup");
if (!(await page.locator('[data-a="event-start"]').isVisible())) fail("Weekly event popup has no start action");
await page.locator('[data-a="event-dismiss"]').click();
if (await page.locator('[data-a="event-dismiss"]').count()) fail("Weekly event popup did not dismiss");
await page.evaluate(() => window.__gameDebug?.exitMode?.());
if (await page.locator('[data-a="event-dismiss"]').count()) fail("Dismissed weekly event reappeared in the same week");
const eventPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await eventPage.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
await eventPage.locator('[data-a="event-start"]').waitFor({ state: "visible" });
await eventPage.screenshot({ path: join(SHOTS, "02-weekly-event.png") });
await eventPage.locator('[data-a="event-start"]').click();
if (await eventPage.evaluate(() => window.__gameDebug?.screen?.()) !== "playing") fail("Weekly event start action did not start its route");
if (!(await eventPage.evaluate(() => window.__gameDebug?.weeklyEventSeen?.()))) fail("Starting the weekly event did not record it as seen");
await eventPage.evaluate(() => {
  const ids = window.__gameDebug.weekly();
  localStorage.setItem("delivery-drift-86-weekly-v1", JSON.stringify({ week: window.__gameDebug.weekKey(), completed: ids }));
  localStorage.removeItem("delivery-drift-86-weekly-event-v1");
  window.__gameDebug.exitMode();
});
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
const mobileHomeFits = await page.evaluate(() => {
  const box = document.querySelector(".home-box")?.getBoundingClientRect();
  return Boolean(box && box.left >= 0 && box.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth);
});
if (!mobileHomeFits) fail("Home screen overflows the mobile viewport");
await page.screenshot({ path: join(SHOTS, "03-home-mobile.png") });
await page.setViewportSize({ width: 1280, height: 720 });
await page.locator('[data-a="play"]').click();
for (const mode of ["delivery", "drift-trial", "time-attack"]) {
  if (await page.locator(`[data-a="activity:${mode}"]`).count() !== 1) fail(`Activity picker is missing ${mode}`);
}
await page.locator('[data-a="activity:delivery"]').click();
const lockedPortMap = page.locator('[data-a="map:yokohama"]');
if (await lockedPortMap.count() !== 1) fail("Yokohama Port is missing from the tracks screen");
if (!(await lockedPortMap.isDisabled())) fail("Yokohama opened before the delivery threshold");
if (!(await page.getByText(/8 доставок/).count())) fail("Locked Yokohama does not show its delivery requirement");
await page.screenshot({ path: join(SHOTS, "04-tracks-locked.png") });
await page.locator('[data-a="map:tokyo"]').click();
if (await page.evaluate(() => window.__gameDebug?.mapId?.()) !== "tokyo") fail("Neon Tokyo could not be selected");
if (await page.evaluate(() => window.__gameDebug?.portVisuals?.())) fail("Port-only props leaked into Neon Tokyo");
if (await page.evaluate(() => window.__gameDebug?.screen?.()) !== "playing") fail("Choosing a map did not start the selected delivery");
const tokyoTraffic = await page.evaluate(() => window.__gameDebug.trafficPos());
if (!tokyoTraffic.length || (await page.evaluate((cars) => cars.some((car) => !window.__gameDebug.roadProbe(car.x, car.z).onRoad), tokyoTraffic))) fail("Tokyo NPC traffic left its authored roads");
const tokyoLayout = await page.evaluate(() => window.__gameDebug.layoutSnapshot());
if (!tokyoLayout.signals.length || (await page.evaluate((signals) => signals.some((point) => !window.__gameDebug.roadProbe(point.x, point.z).onRoad), tokyoLayout.signals))) fail("Tokyo signal junctions are not on authored roads");
await page.waitForTimeout(700);
await page.screenshot({ path: join(SHOTS, "06-tokyo-network.png") });
await page.evaluate(() => window.__gameDebug?.exitMode?.());
await page.evaluate(() => window.__gameDebug?.setDeliveriesForTest?.(8));
await page.locator('[data-a="play"]').click();
await page.locator('[data-a="activity:delivery"]').click();
await page.locator('[data-a="map:yokohama"]').click();
const selectedMap = await page.evaluate(() => window.__gameDebug?.mapId?.());
if (selectedMap !== "yokohama") fail("Selecting Yokohama did not switch the active map");
if (!(await page.evaluate(() => window.__gameDebug?.portVisuals?.()))) fail("Yokohama map props were not built");
const yokohamaTraffic = await page.evaluate(() => window.__gameDebug.trafficPos());
if (!yokohamaTraffic.length || (await page.evaluate((cars) => cars.some((car) => !window.__gameDebug.roadProbe(car.x, car.z).onRoad), yokohamaTraffic))) fail("Yokohama NPC traffic left its authored roads");
const yokohamaLayout = await page.evaluate(() => window.__gameDebug.layoutSnapshot());
if (!yokohamaLayout.signals.length || (await page.evaluate((signals) => signals.some((point) => !window.__gameDebug.roadProbe(point.x, point.z).onRoad), yokohamaLayout.signals))) fail("Yokohama signal junctions are not on authored roads");
const layoutSignature = (layout) => JSON.stringify(layout.roads.map(({ id, points }) => [id, points]));
if (layoutSignature(tokyoLayout) === layoutSignature(yokohamaLayout)) fail("Tokyo and Yokohama minimap road topologies are identical");
await page.waitForTimeout(700);
await page.screenshot({ path: join(SHOTS, "07-yokohama-network.png") });
const savedMap = await page.evaluate(() => JSON.parse(localStorage.getItem("delivery-drift-86-save-v1") ?? "{}").mapId);
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
const hasMapAccess = await page.evaluate(() => typeof window.__gameDebug?.mapAccessFor === "function");
if (!hasMapAccess) fail("Map unlock rules are missing");
const accessCases = await page.evaluate(() => {
  const check = window.__gameDebug.mapAccessFor;
  return [check("tokyo", 0, "tokyo"), check("yokohama", 0, "tokyo"), check("yokohama", 7, "tokyo"), check("yokohama", 8, "tokyo"), check("yokohama", 0, "yokohama")];
});
if (!accessCases[0].unlocked || accessCases[1].unlocked || accessCases[1].deliveriesRemaining !== 8 || accessCases[2].deliveriesRemaining !== 1 || !accessCases[3].unlocked || !accessCases[4].unlocked) fail("Map unlock thresholds or legacy access are incorrect");
const hasEventState = await page.evaluate(() => typeof window.__gameDebug?.weeklyEventSeen === "function" && typeof window.__gameDebug?.markWeeklyEventSeen === "function");
if (!hasEventState) fail("Weekly event seen state helpers are missing");
await page.evaluate(() => window.__gameDebug.markWeeklyEventSeen("2026-11-16T12:00:00Z"));
if (!(await page.evaluate(() => window.__gameDebug.weeklyEventSeen("2026-11-17T12:00:00Z")))) fail("Weekly event dismissal was not kept for the same UTC week");
if (await page.evaluate(() => window.__gameDebug.weeklyEventSeen("2026-11-23T00:00:00Z"))) fail("Weekly event dismissal leaked into the next UTC week");
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
if (!(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("delivery-drift-86-records-v1") ?? "{}")).some((key) => key.includes(":delivery:"))))) fail("Delivery personal records were not saved");
await page.locator('[data-a="back"]').click();

// Both short modes can start, complete, and be replayed without counting as deliveries.
for (const [mode, label] of [["drift-trial", "DRIFT TRIAL"], ["time-attack", "TIME ATTACK"]]) {
  const deliveries = await page.evaluate(() => JSON.parse(localStorage.getItem("delivery-drift-86-save-v1") ?? "{}").deliveries);
  await page.locator('[data-a="play"]').click();
  await page.locator(`[data-a="activity:${mode}"]`).click();
  await page.locator('[data-a="map:tokyo"]').click();
  if (await page.evaluate(() => window.__gameDebug?.mode?.()) !== mode) fail(`${label} did not start`);
  await page.evaluate(() => window.__gameDebug?.finishMode?.());
  if (!(await page.getByText(label, { exact: true }).count())) fail(`${label} did not show its result`);
  if (await page.evaluate(() => JSON.parse(localStorage.getItem("delivery-drift-86-save-v1") ?? "{}").deliveries) !== deliveries) fail(`${label} incorrectly counted as a delivery`);
  if (!(await page.evaluate((mode) => Object.keys(JSON.parse(localStorage.getItem("delivery-drift-86-records-v1") ?? "{}")).some((key) => key.includes(`:${mode}:`)), mode))) fail(`${label} personal record was not saved`);
  await page.locator('[data-a="replay"]').click();
  if (await page.evaluate(() => window.__gameDebug?.mode?.()) !== mode) fail(`${label} replay did not restart the same mode`);
  await page.evaluate(() => window.__gameDebug?.exitMode?.());
}
const beforeUnlimited = await page.evaluate(() => JSON.parse(localStorage.getItem("delivery-drift-86-save-v1") ?? "{}").deliveries);
for (let i = 0; i < 2; i++) {
  await page.locator('[data-a="play"]').click();
  await page.locator('[data-a="activity:delivery"]').click();
  await page.locator('[data-a="map:tokyo"]').click();
  const orderDest = await page.evaluate(() => window.__gameDebug.orderDest());
  if (!orderDest || !(await page.evaluate((point) => window.__gameDebug.roadProbe(point.x, point.z).onRoad, orderDest))) fail("A regular delivery destination is outside the authored road network");
  await page.evaluate(() => window.__gameDebug?.finishDelivery?.());
  await page.locator('[data-a="menu"]').click();
}
const afterUnlimited = await page.evaluate(() => JSON.parse(localStorage.getItem("delivery-drift-86-save-v1") ?? "{}").deliveries);
if (afterUnlimited !== beforeUnlimited + 2) fail("Ordinary deliveries were not available repeatedly");

// 1) The canvas must actually render content (not a black screen). Judge by reading the drawing
//    buffer, not the screenshot — on headless/swiftshader the compositor may show the canvas as
//    black while the drawing buffer holds the real frame. WebGL needs preserveDrawingBuffer for
//    that read (the template's src/game/boot.ts enables it); 2D canvases go through getImageData.
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
  const before = await page.evaluate(() => window.__gameProbe());
  await page.keyboard.down(key);
  try {
    await page.waitForFunction(
      ({ start, axis, direction, distance }) => (window.__gameProbe()[axis] - start) * direction > distance,
      { start: before[axis], axis, direction, distance },
      { timeout: 4000 },
    );
    return true;
  } catch (error) {
    if (error.name !== "TimeoutError") throw error;
    return false;
  } finally {
    await page.keyboard.up(key);
  }
}

const probe = await page.evaluate(() => !!window.__gameProbe);
if (probe) {
  if (!await checkDirection("KeyS", "z", 1, 0.75)) fail("S did not move the car backwards at a useful speed");
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

// 5) Zero console errors
if (consoleErrors.length) fail(`${consoleErrors.length} console error(s): ${consoleErrors[0]}`);

await browser.close();
server.close();
console.log("VERIFY OK: render/enter/direction/pause/console all passed; screenshots in verification-shots/");
