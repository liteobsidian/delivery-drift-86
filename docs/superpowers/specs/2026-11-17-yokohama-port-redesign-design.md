# Yokohama Port Road and Scene Redesign

## Intent

Make the selectable Yokohama map read and drive like a port. Use the supplied street map as a reference for its long arterial, bending riverfront, diagonal approach, junctions, and smaller service roads, then stage recognizable cargo-port objects along that network.

## Goals

- Keep the Neon Tokyo map, map IDs, save data, bounds, and game modes intact.
- Replace Yokohama's sparse five-road market layout with a connected, hand-authored port street network.
- Add an in-map harbor channel with a clear shoreline and piers.
- Place visible warehouses, container yards, gantry cranes, and a moored cargo vessel in explicit map coordinates.
- Keep roads, traffic, delivery destinations, signals, collision queries, and the minimap driven by `CityLayout`.
- Keep port geometry procedural and consistent with the project's existing Three.js asset style.

## Non-goals

- Change Tokyo, progression, vehicles, map selection, or controls.
- Import unlicensed road data or third-party scene models.
- Add a separate road source or change the world scale.

## Approaches

- Extend Yokohama's existing `CityLayout` with authored harbor water and named port sites, then render those alongside its roads — chosen. This keeps the minimap, traffic, road surface, and gameplay queries aligned while giving the port props deliberate locations.
- Add props to the current five-road layout — rejected because it leaves the map sparse and still does not match the supplied street topology.
- Create a separate static port scene — rejected because roads, navigation, collision, and traffic would have to duplicate its geometry.

## Architecture and constraints

Use world-space polylines and polygons in `src/game/map-layouts.ts`. Add typed harbor areas and port sites to `CityLayout`; keep Yokohama's road loops connected and its signal positions at real arterial crossings. `World` draws the same water areas on the ground texture and as scene geometry, and creates site-specific port props from the same site list. Preserve the existing road width range, map bounds, spawn point, and two traffic loops.

## Acceptance

- Yokohama has at least 12 connected, drivable roads with a long north-south arterial, a diagonal approach, loops, and waterfront service access.
- Its map data includes a water channel and explicit warehouse, container-yard, crane, pier, and ship sites; non-water sites clear road corridors.
- The scene visibly reads as a harbor at gameplay camera height while Tokyo stays unchanged.
- Map-layout tests and the production build pass; the rendered Yokohama scene and minimap are inspected before publishing.
