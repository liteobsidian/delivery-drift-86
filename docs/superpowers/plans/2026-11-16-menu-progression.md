# Menu and Track Progression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify the home screen, move activity/map choice into dedicated screens, gate Yokohama behind career progress, and offer the weekly event once per UTC week.

**Architecture:** Add `play`, `tracks`, and `profile` screens to the existing `GameScreen` flow. Store the selected activity in transient `Game` state; keep map unlocks derived from the existing saved delivery count, with an existing Yokohama selection counting as legacy access. Store the weekly event seen key beside the existing weekly local data.

**Tech Stack:** TypeScript, Three.js game UI, localStorage, Playwright smoke verification, Vite.

**Spec:** `docs/superpowers/specs/2026-11-16-menu-progression-design.md`

## Global Constraints

- New-save Yokohama unlock threshold is 8 completed deliveries.
- Existing profiles with `mapId: "yokohama"` retain access.
- Weekly event is shown at most once per browser and UTC week.
- Ordinary deliveries remain unlimited; weekly routes stay replayable.
- Tokyo and Yokohama keep their current shared road grid and distinct visual dressing.

## Review Focus

- Legacy Tokyo profile at 0 deliveries sees Yokohama locked; browser smoke verifies it.
- Legacy profile with Yokohama selected retains access; browser smoke verifies selection after reload.
- Selecting a mode then a map starts the exact combination; browser smoke covers all three activities.
- Dismissing the weekly event persists for the current UTC week; browser smoke verifies no repeat after returning home.
- Short viewport still shows the primary action and secondary navigation; inspect 1280×720 and mobile smoke viewport.

---

### Task 1: Unlock Rules and Weekly Event State

**Files:** `src/game/retention.ts`, `src/game/config.ts`, `scripts/verify-game.mjs`.

- [x] Add `mapAccessFor(mapId, deliveries, selectedMap)`; Tokyo is always open, Yokohama opens at 8 deliveries or when it is the profile's already-selected map.
- [x] Add UTC-week event state helpers beside weekly progress storage: read whether this week's event was seen and mark it seen.
- [x] Extend browser smoke checks for 0/7/8 delivery boundaries, legacy Yokohama access, and same-week event persistence.
- [x] Run `npm run build`, `npm run verify`, and `git diff --check`.

### Task 2: Focused Home, Activity, Track, and Profile Screens

**Files:** `src/game/types.ts`, `src/game/game.ts`, `src/index.css`, `scripts/verify-game.mjs`.

- [x] Add `play`, `tracks`, and `profile` to `GameScreen` and their render methods.
- [x] Reduce home to the title, selected-place summary, one primary play button, and compact garage/cars/profile actions.
- [x] Move Delivery, Drift Trial, and Time Attack cards to Play; selecting one opens Tracks.
- [x] Render distinct Tokyo and Yokohama cards; show an 8-delivery lock/progress state for new careers.
- [x] Route a chosen activity and unlocked map into `quickStart`, `startMode`, or the weekly route without resetting existing save data.
- [x] Put records, weekly routes, and achievements behind Profile with clear back navigation.
- [x] Verify navigation, selected activity/map, locked/unlocked threshold, legacy saves, and desktop/mobile layout in `scripts/verify-game.mjs`.
- [x] Run `npm run build`, `npm run verify`, inspect screenshots, and `git diff --check`.

### Task 3: Once-Weekly Startup Event Card

**Files:** `src/game/game.ts`, `src/game/retention.ts`, `src/index.css`, `scripts/verify-game.mjs`.

- [x] On the first home screen of a UTC week, offer the first incomplete weekly route in a compact dismissible card.
- [x] “Играть” starts the route; “Позже” closes it; both record that the event was seen for this UTC week.
- [x] Verify both actions, no repeat during the same week, and reappearance at the next UTC week key.
- [x] Run `npm run build`, `npm run verify`, inspect screenshots, and `git diff --check`.

### Task 4: Publish

- [ ] Commit changes on a feature branch, open a PR, wait for CI, merge, and confirm successful HTTPS asset verification.
