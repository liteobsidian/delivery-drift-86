# Restore Tokyo and Redraw Yokohama Roads

## Intent

Return Neon Tokyo to the familiar square street grid with its central drift ring and four sweepers. Redraw Yokohama as a substantially denser, original road network so the two districts feel different and Yokohama reads as a real driving map. The deliverable is road geometry only; no borrowed buildings, landmarks, or other map art.

## Goals

- Keep existing map IDs, saves, bounds, and shared gameplay systems.
- Recreate Tokyo's previous 7-by-7 road grid, 44-unit central ring, and four 38-unit quarter-circle sweepers.
- Give Yokohama a hand-authored network of at least 24 connected streets with coastal, diagonal, and irregular city routes.
- Keep road rendering, collision, NPC routes, delivery destinations, traffic signals, and minimap based on each district's `CityLayout`.

## Non-goals

- Do not copy or import GTA San Andreas road geometry. A checked GitHub candidate, `Leuansin/GTA-SA-Nodes-Json`, declares no license; do not redistribute its data.
- Do not import buildings or landmarks from another game or map.
- Keep scenery generation, progression, vehicles, and city rendering logic in place; Yokohama's road layout itself contains no generated lot positions or borrowed objects.

## Approaches

- Restore Tokyo's old grid and manually draw a denser Yokohama network in `map-layouts.ts` — recommended. This returns the lost familiar map while preserving one road source for all systems; it requires careful road and parcel clearance checks.
- Pull an unlicensed game map from GitHub — rejected because its reuse terms are not declared.
- Use a real OpenStreetMap extract — rejected for this pass because it would add attribution and database share-alike obligations without improving the requested stylized driving layout enough to justify them.

## Architecture and constraints

Edit only the authored road layout data and its focused tests. Generate Tokyo's legacy straight grid and curved drift roads as `RoadPath` geometry. Author Yokohama polylines as original data in the same schema. Keep traffic loops, signals, and parcels inside or clear of the new network. Preserve `CITY_LAYOUTS`, `CityLayout`, and all public map IDs.

## Acceptance

Tokyo geometry tests pin the former road spacing, drift ring, and sweepers. Yokohama has at least 24 road paths, samples and traffic loops stay drivable, signal crossings remain valid, and all existing map tests and browser verification pass.
