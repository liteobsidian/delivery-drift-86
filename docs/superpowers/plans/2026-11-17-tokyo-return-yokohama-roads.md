# Tokyo Return and Yokohama Roads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the prior Tokyo road layout and replace Yokohama's sparse network with an original, denser road scheme.

**Architecture:** Keep `CityLayout` as the single road source. Generate Tokyo's old grid and curves from its legacy constants; manually author Yokohama street polylines, then update only linked traffic/signal/parcel metadata if tests require it.

**Tech Stack:** TypeScript, Vitest, Three.js browser verification.

**Spec:** `docs/superpowers/specs/2026-11-17-tokyo-return-yokohama-roads-design.md`

## Global Constraints

- Keep map IDs (`tokyo`, `yokohama`), saves, and the existing ±174 playable bounds.
- Do not import map geometry or scene assets from GTA or any game; use original road data.
- Keep rendering, collision, traffic, destinations, signals, and minimap driven by `CityLayout`.
- Make no unrelated scenery or progression changes.

## Review Focus

- Tokyo retains old street spacing, ring radius, and four drift sweepers — test former road centerlines and curve samples.
- Yokohama is denser than the rejected map — test minimum street count and distribution across the map bounds.
- NPC loops remain inside roads — sample every loop segment at one-unit intervals.
- Signals still occupy orthogonal crossings — retain existing signal geometry test.
- Building parcels remain clear of the new roads — retain rotated parcel clearance assertions.

---

### Task 1: Restore Tokyo and Redraw Yokohama Road Data

**Files:**
- Modify: `src/game/map-layouts.ts`
- Test: `src/game/map-layouts.test.ts`

**Interfaces:**
- Consume and preserve `CityLayout`, `RoadPath`, `TrafficRoute`, `CityParcel`, `CITY_LAYOUTS`.
- `roads`, `trafficRoutes`, `signalJunctions`, and `parcels` remain the shared source for existing gameplay.

- [x] **Step 1: Add failing tests for the legacy Tokyo grid/ring/sweepers and denser Yokohama network**
- [x] **Step 2: Run `npm run test:maps` and confirm the regression assertions fail**
- [x] **Step 3: Recreate Tokyo's grid at 58-unit spacing, ring radius 44, and four 38-unit quarter-circle roads**
- [x] **Step 4: Author at least 24 original connected Yokohama roads with coastal, diagonal, and irregular neighborhood links**
- [x] **Step 5: Update traffic loops and valid signals; keep Yokohama's layout road-only with no generated parcel placements**
- [x] **Step 6: Run `npm run test:maps` and confirm geometry, traffic, and parcel assertions pass**
- [ ] **Step 7: Commit the road layout revision**

### Task 2: Verify Visuals and Publish

**Files:**
- Modify: `scripts/verify-game.mjs` if map assertions need adjustment
- Update: this plan's checkboxes

- [x] **Step 1: Capture and inspect Tokyo/Yokohama gameplay and minimaps**
- [x] **Step 2: Run `npm run build && npm run test:maps && npm run verify && git diff --check`**
- [ ] **Step 3: Request read-only review and fix any Critical/Important findings**
- [ ] **Step 4: Push a PR to `main`, wait for CI, merge, and verify the deployed assets over HTTPS**
