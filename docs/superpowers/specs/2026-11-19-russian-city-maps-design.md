# Russian City Maps and Turbo Zhiguli

## Goal

Add three distinct Russian city districts and a late-game, drift-focused turbo LADA 2107 to Delivery Drift 86.

## Design

- **Saint Petersburg — Белые ночи:** compact orthogonal streets, a long diagonal Nevsky-style avenue, a central square loop, and a Neva waterfront.
- **Kazan — Кремлёвский вираж:** broad diagonals, a compact historic ring, stadium loops, and a Volga riverbank.
- **Sochi — Черноморский серпантин:** a winding coastal race loop, a mountain switchback, and Black Sea frontage.
- Each city uses authored, connected road networks with a closed NPC route and a fixed Time Attack lap. Dense procedural buildings continue to fill blocks between roads; water remains clear of roads and building footprints.
- Landmarks use simple low-poly geometry and distinct night palettes so the city identity reads while driving.
- Unlock the maps in stages after 8, 16, 24, and 32 deliveries (Yokohama remains at 8; the new cities use 16, 24, and 32).
- Add a procedural sedan: **LADA 2107 Turbo «Боевая классика»**, rear-wheel-drive drift tuning, base top speed 63 units/s (higher than every current car), and unlock through 70 deliveries or the existing `drifter` gold Drift Trial achievement.
- Preserve all legacy map IDs, road layouts, saves, and car ownership. Old saves continue to load with Tokyo as the default when no map is recorded.

## Game design references

Forza Horizon 5's official biome presentation is a useful model for giving each map a strong environmental identity; Need for Speed Unbound's Lakeshore activities show how named districts and focused drift routes can make the same road network support different play styles. This project adapts those high-level ideas to compact city circuits rather than copying locations or assets.

## Acceptance criteria

1. The map selector shows five distinct maps with correct badges, descriptions, and delivery unlock requirements.
2. Each new layout has a drivable spawn, a connected authored road network, a closed NPC loop, and a named Time Attack course.
3. Building generation stays dense on the three new maps and avoids roads and waterways.
4. Water and city landmarks differentiate the three Russian districts without placing a water surface across a road.
5. Legacy saves keep their map and car; new map IDs survive save/load.
6. The LADA appears in the garage, can be purchased by the stated progression conditions, and has the highest unmodified top speed.
