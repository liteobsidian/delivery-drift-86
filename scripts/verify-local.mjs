/**
 * verify-local.mjs — full verification pass under Xvfb (headed Chromium,
 * software WebGL). Desktop: render check, W/D direction assertions, pause.
 * Mobile (iPhone-sized, touch): title → quick start → gameplay with touch
 * controls → teleport to destination → result screen. Screenshots for every
 * state; zero console errors is a hard gate.
 * Run: npm run build && xvfb-run -a node scripts/verify-local.mjs
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DIST = join(ROOT, "dist");
const SHOTS = join(ROOT, "verification-shots");
mkdirSync(SHOTS, { recursive: true });
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
};

const server = createServer(async (req, res) => {
  try {
    const raw = req.url === "/" ? "/index.html" : req.url.split("?")[0];
    let p;
    try { p = decodeURIComponent(raw); } catch { p = raw; }
    const f = resolve(DIST, "." + p);
    if (f !== DIST && !f.startsWith(DIST + sep)) { res.writeHead(403).end(); return; }
    const data = await readFile(f);
    res.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream" });
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch({
  executablePath: "/opt/ms-playwright/chromium-1234/chrome-linux64/chrome",
  headless: false,
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1400,900"],
});

const consoleErrors = [];
let failures = 0;
const fail = (msg) => { failures++; console.error("FAIL:", msg); };
const ok = (msg) => console.log("ok:", msg);

// ---------- desktop pass ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__GAME_READY__ === true, null, { timeout: 10000 });
  ok("desktop: game ready");
  await page.waitForTimeout(2500); // shader warm-up under software GL

  // render check: canvas must not be black
  const lit = await page.evaluate(() => {
    const el = document.getElementById("game-canvas");
    const gl = el.getContext("webgl2") || el.getContext("webgl");
    const px = new Uint8Array(4);
    let lit = 0;
    for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.6], [0.7, 0.4], [0.5, 0.8]]) {
      gl.readPixels((gl.drawingBufferWidth * fx) | 0, (gl.drawingBufferHeight * fy) | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      if (px[0] + px[1] + px[2] > 8) lit++;
    }
    return lit;
  });
  if (lit < 2) fail(`desktop: canvas looks black (${lit}/4 lit samples)`);
  else ok(`desktop: canvas renders (${lit}/4 samples lit)`);

  await page.screenshot({ path: join(SHOTS, "01-title.png") });
  ok("desktop: title screenshot");

  // title -> playing via Space
  await page.keyboard.press("Space");
  await page.waitForTimeout(600);
  const screen1 = await page.evaluate(() => window.__gameDebug.screen());
  if (screen1 !== "playing") fail(`Space did not start gameplay (screen=${screen1})`);
  else ok("desktop: Space starts gameplay");

  // packed assets must decode and load (base64 shim → gzip payloads)
  try {
    await page.waitForFunction(() => window.__gameDebug.assetsReady() === true, null, { timeout: 30000 });
    ok("desktop: GLB assets loaded");
  } catch {
    fail("desktop: assets failed to load");
  }

  // direction assertions
  const pos = () => page.evaluate(() => window.__gameProbe());
  const before = await pos();
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(1500);
  await page.keyboard.up("KeyW");
  const afterW = await pos();
  if (!(afterW.z - before.z < -0.5)) fail(`W not forward (dz=${(afterW.z - before.z).toFixed(3)})`);
  else ok(`desktop: W drives forward (dz=${(afterW.z - before.z).toFixed(2)})`);
  const beforeD = await pos();
  await page.keyboard.down("KeyW"); // keep rolling so steering has effect
  await page.keyboard.down("KeyD");
  await page.waitForTimeout(1500);
  await page.keyboard.up("KeyD");
  await page.keyboard.up("KeyW");
  const afterD = await pos();
  if (!(afterD.x - beforeD.x > 0.2)) fail(`D not right (dx=${(afterD.x - beforeD.x).toFixed(3)})`);
  else ok(`desktop: D steers right (dx=${(afterD.x - beforeD.x).toFixed(2)})`);

  await page.keyboard.down("KeyW");
  await page.keyboard.down("Space"); // drift smoke
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(SHOTS, "02-gameplay.png") });
  await page.keyboard.up("Space");
  await page.keyboard.up("KeyW");
  ok("desktop: gameplay screenshot");

  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const screenP = await page.evaluate(() => window.__gameDebug.screen());
  if (screenP !== "paused") fail(`Esc did not pause (screen=${screenP})`);
  else ok("desktop: Esc pauses");
  await page.screenshot({ path: join(SHOTS, "03-paused.png") });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // --- new features: damage visuals + wheel loss + police ---
  await page.evaluate(() => window.__gameDebug.damageTest());
  await page.waitForTimeout(500);
  const hp = await page.evaluate(() => window.__gameDebug.hp());
  if (hp > 30) fail(`damageTest did not damage the car (hp=${hp})`);
  else ok(`desktop: car damage works (hp=${hp})`);
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(900);
  await page.keyboard.up("KeyW");
  await page.screenshot({ path: join(SHOTS, "03-damaged.png") });
  ok("desktop: damaged car screenshot");

  await page.evaluate(() => window.__gameDebug.policeTest());
  await page.waitForTimeout(1200);
  const policeOn = await page.evaluate(() => window.__gameDebug.policeActive());
  if (!policeOn) fail("policeTest did not activate the chase");
  else ok("desktop: police chase active");
  await page.screenshot({ path: join(SHOTS, "04-police.png") });
  ok("desktop: police chase screenshot");
  // escape the chase (sim time runs slower than real time under software GL)
  await page.evaluate(() => window.__gameDebug.teleport(160, 160));
  try {
    await page.waitForFunction(() => window.__gameDebug.policeActive() === false, null, { timeout: 30000 });
    ok("desktop: police escape works");
  } catch {
    fail("police did not disengage after escape");
  }

  await ctx.close();
}

// ---------- mobile pass (iPhone-ish, touch) ----------
{
  const ctx = await browser.newContext({
    viewport: { width: 844, height: 390 }, // iPhone landscape
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__GAME_READY__ === true, null, { timeout: 10000 });
  ok("mobile: game ready");
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(SHOTS, "04-mobile-title.png") });

  // settings reachable from title, volume slider present
  await page.tap('[data-a="settings"]');
  await page.waitForTimeout(300);
  const hasSlider = await page.evaluate(() => !!document.getElementById("vol-slider"));
  if (!hasSlider) fail("mobile: settings screen has no volume slider");
  else ok("mobile: settings screen with volume slider");
  await page.screenshot({ path: join(SHOTS, "04b-mobile-settings.png") });
  await page.tap(".panel.settings [data-a='back']");
  await page.waitForTimeout(300);

  // achievements screen
  await page.tap('[data-a="achievements"]');
  await page.waitForTimeout(300);
  const achRows = await page.evaluate(() => document.querySelectorAll(".ach-row").length);
  if (achRows < 5) fail(`mobile: achievements list too short (${achRows})`);
  else ok(`mobile: achievements screen (${achRows} rows)`);
  await page.screenshot({ path: join(SHOTS, "04c-mobile-achievements.png") });
  await page.tap(".panel.achievements [data-a='back']");
  await page.waitForTimeout(300);

  // keyboard hints must be hidden on touch devices
  const hintHidden = await page.evaluate(() => !document.querySelector(".hint-row"));
  if (!hintHidden) fail("mobile: keyboard hints still shown on touch device");
  else ok("mobile: keyboard hints hidden on touch");

  const touchVisible = await page.evaluate(() => {
    const el = document.getElementById("touch-controls");
    return el && getComputedStyle(el).display !== "none";
  });
  console.log("info: touch controls layer present:", touchVisible);

  // start via button tap
  await page.tap(".btn.primary");
  await page.waitForTimeout(600);
  const screen = await page.evaluate(() => window.__gameDebug.screen());
  if (screen !== "playing") fail(`mobile: tap start failed (screen=${screen})`);
  else ok("mobile: tap starts gameplay");

  // touch controls visible during play
  const tcOn = await page.evaluate(() => {
    const el = document.getElementById("touch-controls");
    return el && el.style.display !== "none" && getComputedStyle(el).display !== "none";
  });
  if (!tcOn) fail("mobile: touch controls not visible while playing");
  else ok("mobile: touch controls visible");

  // first-play tutorial overlay on touch devices
  const tutVisible = await page.evaluate(() => {
    const el = document.querySelector(".tutorial");
    return el && getComputedStyle(el).display !== "none";
  });
  if (!tutVisible) fail("mobile: tutorial overlay not shown on first play");
  else ok("mobile: tutorial overlay shown");
  await page.screenshot({ path: join(SHOTS, "05-mobile-tutorial.png") });
  await page.tap(".tutorial-box .btn.primary");
  await page.waitForTimeout(300);

  // drive with touch: joystick forward = throttle (synthetic pointer events)
  await page.evaluate(() => {
    const el = document.getElementById("tc-wheel");
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const opts = { pointerId: 7, bubbles: true, clientX: cx, clientY: cy };
    el.dispatchEvent(new PointerEvent("pointerdown", opts));
    el.dispatchEvent(new PointerEvent("pointermove", { ...opts, clientY: cy - 60 }));
  });
  await page.waitForTimeout(300);
  const p1 = await page.evaluate(() => window.__gameProbe());
  await page.waitForTimeout(2500);
  const p2 = await page.evaluate(() => window.__gameProbe());
  await page.evaluate(() => {
    const el = document.getElementById("tc-wheel");
    el.dispatchEvent(new PointerEvent("pointerup", { pointerId: 7, bubbles: true }));
  });
  const moved = Math.hypot(p2.x - p1.x, p2.z - p1.z);
  if (moved < 2) fail(`mobile: joystick forward did not move car (${moved.toFixed(2)}u)`);
  else ok(`mobile: joystick forward moves car (${moved.toFixed(1)}u)`);

  await page.screenshot({ path: join(SHOTS, "05-mobile-gameplay.png") });

  // teleport to destination to trigger result screen
  const done = await page.evaluate(() => {
    const dbg = window.__gameDebug;
    const d = dbg.orderDest();
    if (!d) return false;
    dbg.teleport(d.x, d.z);
    return true;
  });
  if (!done) {
    fail("mobile: orderDest hook unavailable");
  } else {
    await page.waitForTimeout(900);
    const s2 = await page.evaluate(() => window.__gameDebug.screen());
    if (s2 !== "result") fail(`mobile: no result screen after arrival (screen=${s2})`);
    else ok("mobile: result screen after delivery");
    await page.screenshot({ path: join(SHOTS, "06-mobile-result.png") });
    // back to orders via button
    await page.tap(".panel.result .btn.primary");
    await page.waitForTimeout(400);
    const s3 = await page.evaluate(() => window.__gameDebug.screen());
    if (s3 !== "orders") fail(`mobile: 'Ещё заказ' did not open orders (screen=${s3})`);
    else ok("mobile: orders screen from result");
    await page.screenshot({ path: join(SHOTS, "07-mobile-orders.png") });
  }
  await ctx.close();
}

await browser.close();
server.close();

if (consoleErrors.length) {
  fail(`${consoleErrors.length} console error(s). First: ${consoleErrors[0]?.slice(0, 300)}`);
} else {
  ok("zero console errors");
}

console.log(failures === 0 ? "VERIFY-LOCAL OK" : `VERIFY-LOCAL FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
