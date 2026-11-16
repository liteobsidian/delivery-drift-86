# Handdrawn City Roads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the repeated square street grid with two original, hand-authored district networks that drive visuals, collision, traffic, orders, and minimap.

**Architecture:** Add a data-only `map-layouts.ts` module with road centerlines, traffic loops, major signalized junctions, parcels, and bounds. World and gameplay systems will query the same layout so the road art, drivable area, NPCs, delivery points, and minimap stay aligned.

**Tech Stack:** TypeScript, Three.js CanvasTexture, Vitest, Playwright smoke verification.

**Spec:** `docs/superpowers/specs/2026-11-16-handdrawn-city-roads-design.md`

## Global Constraints

- Use original hand-authored roads; do not reproduce GTA San Andreas or other games' street geometry, landmarks, or silhouettes.
- Keep existing `MapId` values (`tokyo`, `yokohama`) and playable footprint; do not change player saves.
- Keep Three.js and the browser canvas renderer; add no package dependencies.
- Road detection, collision, traffic, orders, and minimap must consume the same layout data.
- Signalize only authored main crossings; use the existing two-phase axis cycle there.

## Review Focus

- Curved or diagonal centerlines are painted and measured with the same geometry; add point-to-segment tests for endpoints and midpoints.
- Traffic remains within road corridors while turning and traversing closed paths; add path-sampling tests and browser NPC position checks.
- Generated delivery points are on road and away from map bounds; add deterministic destination tests.
- Small parcels do not place buildings across road corridors; add parcel clearance assertions.
- Switching maps rebuilds geometry, map extent, traffic, and minimap together; cover both map choices in browser smoke.

---

### Task 1: Author District Layout Data and Geometry Helpers

**Files:**
- Create: `src/game/map-layouts.ts`
- Create: `src/game/map-layouts.test.ts`
- Modify: `package.json` (add `test:maps` script)

**Interfaces:**
- `CityPoint = { x: number; z: number }`.
- `RoadPath = { id: string; width: number; points: CityPoint[] }`.
- `TrafficRoute = { id: string; points: CityPoint[] }`, closed by repeating its first point.
- `CityParcel = { x: number; z: number; width: number; depth: number; rotation: number; zone: "downtown" | "port" }`.
- `CityLayout = { id: MapId; bounds: { minX: number; maxX: number; minZ: number; maxZ: number }; roads: RoadPath[]; trafficRoutes: TrafficRoute[]; signalJunctions: CityPoint[]; parcels: CityParcel[] }`.
- Export `CITY_LAYOUTS`, `cityLayoutFor(id)`, `distanceToRoad(layout,x,z)`, `isOnLayoutRoad(layout,x,z)`, `sampleRoadPoint(layout,rng)`, and `distanceToLayoutBounds`.

- [x] **Step 1: Write tests for road geometry, sampling, and layout integrity**
  - Test centerline, segment midpoint, diagonal segment, and outside-width points for both layouts.
  - Sample 200 deterministic destinations per layout and assert each lies on-road and inside bounds.
  - Sample every authored traffic route at 1-unit intervals and assert every sample lies within a road corridor.
  - Assert parcels lie inside bounds and have a road-free center with their rotated footprint clear of the road margin.

- [x] **Step 2: Run `npm run test:maps` and confirm failure because the layout module/API does not exist**

- [x] **Step 3: Implement geometry helpers and original Tokyo/Yokohama layout data**
  - Keep both maps within ±174 world units.
  - Use different street spacing and shapes; include loops, irregular blocks, a couple of diagonal connectors, and port access branches.
  - Build traffic paths only from authored road centerlines. Put signal nodes only at broad orthogonal crossings.
  - Define parcels as rotated rectangles clear of the roads.

- [x] **Step 4: Run `npm run test:maps` and confirm all geometry/layout checks pass**

- [x] **Step 5: Commit the layout schema and data**

### Task 2: Render Roads and Generate Safe Lots From Layouts

**Files:**
- Modify: `src/game/world.ts`
- Test: `src/game/map-layouts.test.ts`

**Interfaces:** consumes Task 1 `cityLayoutFor`, `isOnLayoutRoad`, and `CityLayout`.

- [x] **Step 1: Add tests for road widths, lot rotation, and boundary collision behavior**
- [x] **Step 2: Run focused tests and confirm the new world integration assertions fail**
- [x] **Step 3: Draw asphalt and road markings from road polylines; use rounded joins/caps and deterministic road wear**
- [x] **Step 4: Make `World.isOnRoad`/`nearestRoadDist`, bounds, and parcel collision use the layout; move Tokyo drift ring into its authored road paths**
- [x] **Step 5: Place Tokyo buildings and Yokohama warehouses/containers inside authored parcels; retain existing district materials and props**
- [x] **Step 6: Run `npm run test:maps` and `npm run build`; confirm tests pass**
- [x] **Step 7: Commit the world integration**

### Task 3: Route Traffic, Orders, Signals, and Minimap From the Same Data

**Files:**
- Modify: `src/game/traffic.ts`
- Modify: `src/game/game.ts`
- Test: `scripts/verify-game.mjs`

**Interfaces:** consumes Task 1 layout and Task 2 `World` road/bounds queries.

- [ ] **Step 1: Add browser assertions for NPCs on-road, road-sampled orders, signal junctions, and distinct minimap topology**
- [ ] **Step 2: Run `npm run verify` and confirm the new assertions fail on the old grid-backed systems**
- [ ] **Step 3: Make traffic follow closed authored routes with lane offsets and turn headings; stop at map bounds using the layout extent**
- [ ] **Step 4: Place the existing two-phase signals at authored major junctions and retain red-light checks at those locations**
- [ ] **Step 5: Generate delivery destinations by `sampleRoadPoint`; draw minimap roads from `CityLayout.roads`**
- [ ] **Step 6: Run `npm run verify` and confirm the new flow passes**
- [ ] **Step 7: Commit traffic and navigation integration**

### Task 4: Visual Review and Publish

**Files:**
- Modify: `scripts/verify-game.mjs` (capture city screenshots)
- Update: this plan's checkboxes

- [ ] **Step 1: Capture and inspect both city maps and minimaps at desktop/mobile sizes**
- [ ] **Step 2: Run `npm run build && npm run test:maps && npm run verify && git diff --check`**
- [ ] **Step 3: Fix any visual/gameplay mismatch and repeat verification**
- [ ] **Step 4: Request a read-only branch review; fix Critical/Important findings**
- [ ] **Step 5: Push a feature branch, open PR, wait for CI, merge to `main`, and verify production HTTPS deployment**
