# Modes and Traffic Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Drift Trial and Time Attack rewarding, remove cargo-only feedback from those modes, smooth and de-pop NPC traffic, and cut repeated collision work.

**Architecture:** Put reusable medal/course/economy rules in a small pure game module, persist mode progression in the profile and achievements, and keep mode-specific orchestration in `Game`. Keep traffic fixed-step simulation authoritative, interpolate only rendering, and add spatial hashes for building queries.

**Tech Stack:** TypeScript, Three.js, Vitest, Playwright smoke verifier.

**Spec:** `docs/superpowers/specs/modes-traffic-polish.md`

## Global Constraints

- Keep all three modes; do not increment delivery totals outside delivery.
- Keep Time Attack records comparable by map and car by using fixed routes.
- Keep car-body damage and existing saved profiles working.
- Keep NPC pool bounded at 10 cars and avoid per-frame mesh creation.
- Preserve existing building placement and exact collision narrow phase.

## Review Focus

- Older local saves omit new stats: storage migration must merge nested defaults.
- Time Attack checkpoints must remain ordered around each closed course, including its finish line.
- Drift crashes must discard the active chain while preserving banked points.
- Spawn safety must hold at initial game start, after map switches, and during later respawns.
- Spatial-grid query results must match full building collision and overlap decisions at map edges and rotated footprints.

---

### Task 1: Pure mode rules and profile progression

**Files:**
- Create: `src/game/modes.ts`
- Test: `src/game/modes.test.ts`
- Modify: `src/game/types.ts`, `src/game/storage.ts`, `src/game/achievements.ts`, `src/game/config.ts`

**Interfaces:**
- `timeAttackCourse(mapId: MapId): TimeAttackCourse` returns route name, start, heading, ordered checkpoints, route length, target times, and time limit.
- `driftMedal(score: number): MedalTier | null`, `timeAttackMedal(course: TimeAttackCourse, elapsed: number): MedalTier | null`, and `modeReward(mode, medal, score)` define medal and payout rules.
- `canUnlockCar(car: CarSpec, profile: Profile): boolean` allows either the existing delivery threshold or the configured achievement.

- [x] **Step 1: Add failing tests** for the three drift thresholds and payout bands; map-specific fixed routes and ordered gates; time medal thresholds; delivery-or-achievement car access; and old profile stats merging.
- [x] **Step 2: Run the focused tests** with `npx vitest run src/game/modes.test.ts`; confirm the new APIs/expectations fail.
- [x] **Step 3: Implement mode rules and save migration.** Use 250/500/750 drift medals with payouts ₽180/₽450/₽900 and ₽40–₽200 score-based payout below bronze. Set Time Attack target averages to 13/17/22 m/s, allow 25 seconds past bronze to finish without a medal, and pay ₽300/₽650/₽1,100 for bronze/silver/gold. Map Silvia to `drifter-silver` and Evo to `time-attack-gold`, preserving delivery unlocks as alternatives.
- [x] **Step 4: Add Time Attack medal achievements** and persist best Time Attack medal tier in profile stats; merge nested defaults for existing saves.
- [x] **Step 5: Run focused tests** and check the Tokyo/Yokohama route lengths and resulting medal times are finite and ordered.

### Task 2: Mode-specific play, HUD, and rewards

**Files:**
- Modify: `src/game/game.ts`, `scripts/verify-game.mjs`
- Test: `src/game/game.modes.test.ts` or extend `scripts/verify-game.mjs`

**Interfaces:** Use Task 1's course, medal, payout, and car-unlock functions.

- [x] **Step 1: Add browser assertions** that Drift Trial and Time Attack hide cargo UI and delivery hints; Time Attack starts at its fixed course and advances ordered gates; mode completion pays money, saves records/achievements, and leaves delivery totals unchanged; car cards show mode unlocks.
- [x] **Step 2: Run the focused smoke assertions** against the mode flow and reward results.
- [x] **Step 3: Start each mode with its own order and state.** Keep Drift Trial at 60 seconds and add chain/banked score state; start Time Attack at its route start, set the first checkpoint, update its target in order, and finish at the start line.
- [x] **Step 4: Apply mode-specific rules.** Drift score multiplier rises by 1 every two active seconds to ×5, banks after 0.7 seconds without drifting, and resets unbanked points after traffic collision or impact above 9. Use medal thresholds to determine success/rewards. Pay fixed course rewards on Time Attack finish and save only completed fixed-route times.
- [x] **Step 5: Remove delivery-only feedback from both modes.** Hide cargo HUD, show accurate mode tutorial copy, skip cargo damage, fines, red-light checks, police pursuits, and delivery bonus popups; retain body damage and show neutral vehicle-collision copy.
- [x] **Step 6: Wire garage eligibility and update mode cards/HUD/result breakdown** to display routes, gates, current drift multiplier, medals, and ₽ earned.
- [x] **Step 7: Run focused browser smoke assertions** for mode finish/replay, achievements, car unlock paths, rewards, no cargo text, and unchanged delivery count.

### Task 3: Smooth and non-popping traffic

**Files:**
- Modify: `src/game/traffic.ts`, `src/game/game.ts`
- Test: `src/game/traffic.regression.test.ts`

- [x] **Step 1: Add traffic regression tests** for spawn distance ≥100m, heading/position continuity across sharp vertices, gradual speed change, and no NPC route snap after player collision.
- [x] **Step 2: Run `npx vitest run src/game/traffic.regression.test.ts`** and verify the traffic behavior assertions.
- [x] **Step 3: Add player-aware safe spawn** during construction, map switches, and timed respawns; initialize previous/current positions together on spawn.
- [x] **Step 4: Smooth corner headings and acceleration/braking.** Brake toward red lights using stopping distance and toward leaders/player using safe speed targets; approach desired speed at bounded acceleration.
- [x] **Step 5: Preserve route state on contact** by resolving overlap through player displacement only.
- [x] **Step 6: Interpolate NPC transforms in `renderFrame`** using the fixed-step accumulator fraction.
- [x] **Step 7: Run traffic regressions and the browser smoke check.**

### Task 4: Spatially indexed building work

**Files:**
- Modify: `src/game/world.ts`, `src/game/city-building-layout.ts`
- Test: `src/game/building-spatial-index.test.ts`, `src/game/city-building-layout.test.ts`

- [x] **Step 1: Add equivalence tests** that compare indexed building collision against a linear reference for empty space, interior/edge overlap, rotations, port structures, and bounds; assert deterministic generated site output and no adjacent overlap.
- [x] **Step 2: Run the focused tests** and confirm the broadphase baseline is recorded.
- [x] **Step 3: Build a building-AABB spatial hash once after world construction.** Query only nearby cells in `collideBuildings`, de-duplicate candidates with reusable generation marks, then run the same oriented-rectangle contact calculation.
- [x] **Step 4: Replace `sites.some` with a local cell lookup** in building generation while preserving SAT overlap clearance and deterministic iteration order.
- [x] **Step 5: Run focused collision/layout tests and compare site counts** on both maps to the baseline.

### Task 5: Full verification and integration

**Files:** all implementation files above.

- [x] **Step 1: Run `npx vitest run`.**
- [x] **Step 2: Run `npm run build`.**
- [x] **Step 3: Run `npm run verify` and inspect generated screenshots.**
- [x] **Step 4a: Check `git diff --check` and review the full diff.**
- [ ] **Step 4b: Push the finished branch for CI/deployment.**
