# Handdrawn City Roads Design

## Intent

Replace the repeated 7×7 road grid with authored neighborhood networks so each playable area feels like a coherent city district and can later be expanded by adding another layout. Roads should guide driving and delivery routes naturally while leaving clear, safe land parcels for buildings and props.

## Goals

- Give Tokyo and Yokohama distinct, irregular road plans with varying block sizes, loops, diagonals, service roads, and dead ends.
- Make rendered asphalt, road detection, traffic paths, signals, destinations, collisions, and the minimap use the same map data.
- Keep map layouts separate from scene decoration so districts can be added without changing road algorithms.
- Preserve existing city themes and the current play area scale.

## Non-goals

- Reproduce GTA San Andreas or another game's exact map, streets, landmarks, or silhouettes.
- Add a player-facing map editor or import external map images.
- Add full GPS pathfinding for the player.
- Redesign car handling, economy, or weekly challenges.

## Constraints

- Use original, hand-authored layouts inspired by broad urban planning ideas only.
- Keep the current Three.js renderer and browser Canvas map textures; add no dependency.
- A point is considered on-road only within the authored road width of a centerline.
- Traffic must remain on authored drivable roads; delivery destinations must be placed on those roads.
- Buildings must avoid roads and remain within authored land parcels.

## Approaches

1. **Authored road graph and parcels (chosen):** define centerline paths, junctions, traffic routes, and buildable parcels as data per map. This gives coherent movement and lets future districts add data without rewriting core geometry.
2. **Deform the existing grid:** vary line spacing and remove selected links. This is cheaper but still reads as a grid and makes irregular junctions difficult.
3. **Paint a map image only:** fast to draw, but traffic, collision, and destinations would still follow the old grid and visibly disagree with the image.

## Architecture

A new `map-layouts.ts` owns `CityLayout` data for Tokyo and Yokohama: bounds, road paths made of world-space points, major signalized junctions, traffic loops, and rectangular parcels. `World` reads that data for asphalt texture, road queries, boundaries, and parcel-based buildings. `Traffic` follows closed authored routes; the main two-axis crossings keep the existing alternating signal cycle, while secondary service roads remain unsignalized. `Game` uses road sampling for delivery destinations and draws the same paths into the minimap. Existing decoration stays in the scene layer and is placed against layout parcels/roads.

The first layouts remain within the existing playable footprint and preserve Tokyo's drift ring and Yokohama's harbor setting as original geometry. Existing save IDs remain unchanged.

## Acceptance

- The two districts have visibly different road patterns; Tokyo has an urban loop and irregular downtown blocks, while Yokohama has a waterfront arterial and port service branches.
- Every traffic route stays on a drivable road, and every generated delivery destination passes `World.isOnRoad`.
- Car collision limits use the layout bounds; driving outside the map cannot strand the car.
- The minimap and visible road texture show the same topology.
- Browser verification covers representative roads, block interiors, routes, destinations, switches, and both district screenshots.
