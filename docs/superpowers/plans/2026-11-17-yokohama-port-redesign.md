# Yokohama Port Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Yokohama's roads and stage an unmistakable harbor around them.

**Architecture:** Keep `CityLayout` as the single source of world coordinates. Add typed water regions and port sites, author Yokohama's connected roads/sites there, then have `World` render that data into road texture, harbor water, and procedural port scenery.

**Tech Stack:** TypeScript, Three.js, Vitest, Vite.

**Spec:** `docs/superpowers/specs/2026-11-17-yokohama-port-redesign-design.md`

## Global Constraints

- Keep Tokyo, `MapId`, saves, game modes, map bounds, and the shared spawn point intact.
- Keep Yokohama roads between 8 and 16 units wide and connected as one drivable graph.
- Keep collision, traffic, delivery sampling, signals, and minimap aligned with `CityLayout`.
- Use procedural Three.js geometry; do not import unlicensed map data or models.

## Review Focus

- Road network connection at the main junction and service spurs — test graph reachability.
- Traffic loops remain on roads — sample route points against `CityLayout`.
- Port footprints avoid road corridors — use existing rotated parcel-clearance geometry.
- Harbor and ship sites fit the water and map bounds — assert their locations.
- Tokyo data remains unchanged — retain the legacy grid/ring assertions.

---

### Task 1: Describe and author the Yokohama layout

**Files:**
- Modify: `src/game/map-layouts.ts`
- Test: `src/game/map-layouts.test.ts`

**Interfaces:**
- Add `WaterArea` polygons and `PortSite` records to `CityLayout`.
- Keep the existing `RoadPath`, `TrafficRoute`, `CityParcel`, and `CITY_LAYOUTS` interfaces compatible.

- [x] Add failing tests for road count/connectivity, water areas, port-site kinds, road clearance, and bounds.
- [x] Run `npm run test:maps` and confirm the new expectations fail for Yokohama.
- [x] Author screenshot-inspired main roads, junctions, loops, service spurs, waterfront routes, and explicit port sites.
- [x] Run `npm run test:maps` and confirm both map layouts remain drivable.

### Task 2: Render the harbor and port facilities

**Files:**
- Modify: `src/game/world.ts`
- Test: `src/game/map-layouts.test.ts`

**Interfaces:**
- `World.buildHarborWater()` consumes `layout.waterAreas`.
- `World.buildPortBuildings()` and `World.buildPortCranes()` consume `layout.portSites`.

- [x] Render the harbor channel and dock apron from layout geometry.
- [x] Render warehouses, scaled container stacks, cranes, pier, ship, and safety lighting at authored sites.
- [x] Confirm Yokohama map geometry and gameplay queries still use the same road source.
- [x] Run the map tests and production build.
- [x] Open the game, inspect Yokohama's gameplay view and minimap, and adjust any misplaced or obscured props.
- [ ] Review `git diff --check` and push the finished branch.
