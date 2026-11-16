# Retention Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add repeatable content to Delivery Drift 86 in four independently publishable stages: maps, activity modes, nitro, and personal leaderboards with weekly routes.

**Architecture:** Keep the browser game static and preserve the current local save. Add each stage as an additive player-facing loop that reuses the delivery physics; ship a separately tested deployment after each stage. Public cross-player rankings are out of scope until a persistent server is available; stage four ships durable local personal records and deterministic weekly routes.

**Tech Stack:** TypeScript, Three.js, Vite, localStorage, Playwright smoke verification, GitHub Actions deployment to IT-Garage.

**Spec:** `docs/superpowers/specs/2026-11-16-retention-expansion.md`

## Global Constraints

- Ordinary deliveries remain unlimited.
- Existing Tokyo, vehicle ownership, upgrades, and saved career progress remain available.
- Each stage builds, passes browser smoke checks, merges to `main`, and completes HTTPS deployment before the next stage starts.
- No paid power, login punishment, or artificial energy wait is introduced.

## Review Focus

- An old save without a map selection still loads into Tokyo — Task 1 tests legacy profile migration.
- Selecting a map rebuilds its traffic and destination world consistently — Task 1 verifies both selectable maps.
- Added modes still reset their timers and results between runs — Task 2 tests one full run per mode.
- Nitro cannot drive fuel negative or exceed its defined speed cap — Task 3 tests activation, depletion, and refill.
- Weekly routes stay identical throughout a UTC week and rotate at the boundary — Task 4 tests fixed dates around a week change.
- Local records survive reload and ordinary delivery remains unlimited — Task 4 tests persistence and menu flow.

---

### Task 1: Playable Yokohama Port Map

**Files:** `src/game/types.ts`, `src/game/storage.ts`, `src/game/world.ts`, `src/game/traffic.ts`, `src/game/game.ts`, `src/index.css`, `scripts/verify-game.mjs`.

- [x] Add a typed map ID and default old profiles to Tokyo.
- [x] Build a port visual set (water perimeter, warehouses, container stacks, cranes) while preserving the current collision/traffic grid.
- [x] Add persistent title-screen selection and rebuild world dressing, traffic binding, and minimap after a change.
- [x] Extend browser smoke checks to select both maps and enter a delivery on the port map.
- [x] Run `npm run build`, `npm run verify`, inspect the port gameplay screenshot, and `git diff --check`.
- [ ] Commit, PR, merge, and wait for successful HTTPS deployment.

### Task 2: Short Activity Modes

- [x] Add Drift Trial and Time Attack cards using the current map and car physics.
- [x] Give each mode a short target, result screen, and replay path; keep delivery as the default.
- [x] Add smoke checks for start, completion, and replay, then publish independently.

### Task 3: Nitro

- [ ] Add a finite nitro meter, a boost input for keyboard and touch, and a restrained speed/acceleration boost.
- [ ] Refill through driving skill and near misses; do not add a purchase or energy wait.
- [ ] Test fuel bounds, boost cap, mobile/keyboard input, and publish independently.

### Task 4: Personal Scoreboards and Weekly Routes

- [ ] Add persistent personal records keyed by map, mode, and vehicle.
- [ ] Generate a stable weekly route set from the UTC week key; show progress and replay.
- [ ] Test persistence, weekly rotation, and unlimited ordinary deliveries; publish independently.
