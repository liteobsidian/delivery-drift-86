# Russian City Maps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three Russian city maps and the fastest drift turbo Zhiguli.

**Architecture:** Extend the existing authored `CityLayout` and `MapId` model. Keep gameplay data (unlock thresholds, track labels, courses, car stats) in existing config modules; add city geometry and lightweight map-specific scenery to the existing world renderer.

**Tech Stack:** TypeScript, Three.js, Vite.

**Spec:** `docs/superpowers/specs/2026-11-19-russian-city-maps-design.md`

## Global Constraints

- Preserve Tokyo and Yokohama layouts and existing save IDs.
- Keep dense generated buildings clear of roads, water, and explicit landmarks.
- Each authored traffic route is a closed drivable loop within map bounds.
- New unlock thresholds are 16, 24, and 32 deliveries after Yokohama's existing 8.
- LADA base top speed is 63 and its progression is 70 deliveries or the existing gold Drift Trial achievement.

## Review Focus

- Legacy saves and profile merges retain the selected map and owned cars.
- Every new map route stays inside its road width and feeds Time Attack checkpoints.
- Buildings and water leave no driveable road hidden under scenery.
- A fifth map card remains usable on narrow mobile screens.
- The car's achievement unlock works when earned before or after reaching 70 deliveries.

### Task 1: Author maps and gameplay configuration

**Files:** `src/game/types.ts`, `src/game/config.ts`, `src/game/map-layouts.ts`, `src/game/city-building-layout.ts`, `src/game/retention.ts`, `src/game/modes.ts`, `src/game/storage.ts`

- [x] Add `spb`, `kazan`, and `sochi` to `MapId` and saved-profile validation.
- [x] Add five map definitions with labels, descriptions, and unlock thresholds; use those thresholds in `mapAccessFor`.
- [x] Author road, water, signal, and closed traffic-route layouts for Saint Petersburg, Kazan, and Sochi.
- [x] Add one fixed Time Attack route and localized course name per map.
- [x] Give generated buildings deterministic city-specific seeds and keep the existing industrial treatment limited to Yokohama.

### Task 2: Render map identity and selection

**Files:** `src/game/world.ts`, `src/game/game.ts`, `src/index.css`

- [x] Render each new city's water polygons and low-poly landmark group; keep the Yokohama harbor renderer specific to Yokohama.
- [x] Use deterministic map-specific ground/building palettes and sky treatment.
- [x] Render map labels and unlock progress from config; accept any configured map ID in the action handler.
- [x] Add distinct track-card art for the three cities and keep the picker scrollable on mobile.

### Task 3: Add the turbo Zhiguli

**Files:** `src/game/config.ts`, `src/game/storage.ts`, `src/game/types.ts`

- [x] Add the procedural sedan `vaz2107turbo`, named `LADA 2107 Turbo «Боевая классика»`, with top speed 63, rear-drift tuning, price ₽90,000, and delivery/`drifter` gold-medal unlocks.
- [x] Add upgrade defaults for the new car while retaining existing profile data.
- [x] Confirm the garage uses the procedural sedan without requiring a missing model asset.

### Task 4: Build and review the integrated feature

**Files:** all files above.

- [x] Run `npm run build` and fix all TypeScript or bundling errors.
- [x] Review the final diff for unchanged Tokyo/Yokohama identity and complete routes, labels, and unlock wiring.
- [ ] Confirm `git status` and report the commit/deployment result.
