# Retention Expansion Design

## Goal
Give Delivery Drift 86 fresh destinations and repeatable reasons to play by adding new places, short activity modes, nitro, and recurring/personal score goals.

## Product sequence
1. **Maps:** keep Neon Tokyo and add a selectable Yokohama Port map. Reuse the existing driveable street grid so the first map ships with safe, bounded scope; make its identity visible in the skyline, block props, materials, map selector, and minimap label.
2. **Modes:** add short, replayable Drift Trial and Time Attack activities alongside unlimited deliveries. Keep earned career progress and normal delivery loop intact.
3. **Nitro:** add an optional boost that is easy to use on keyboard and touch, earns charge through skilled driving, and never replaces ordinary acceleration.
4. **Leaderboards and weekly routes:** add personal records first, then a stable set of three seeded routes that rotates every Monday at 00:00 UTC. Avoid daily attendance streaks and caps on ordinary deliveries. Public online rankings require a persistent server endpoint, which the current static hosting does not provide; ship a local results board unless a supported backend is found during this phase.

## Map 1 product decisions
- Existing map is **Неоновый Токио**; the first new map is **Порт Ёкохама**.
- Map selection is available from the title screen and persists in the existing browser save.
- Both maps retain the existing grid driving rules, traffic lights, collisions, delivery generation, and minimap footprint.
- Port visuals use low warehouses, colorful stacked shipping containers, gantry cranes, and water along the perimeter; Tokyo keeps its current skyline and neon dressing.
- No race limit, energy meter, or login streak is added.

## Measures
Track locally during development: map selection, order starts/completions, mode starts/results, nitro activation, and weekly-route completion. Once a privacy-safe analytics backend exists, measure first-delivery completion, next-job selection, D1/D7 return, and activity mix by cohort. Do not claim retention lift without cohort data.
