# Achievement Medals Design

## Intent
Add clear bronze, silver, and gold progression for repeatable driving goals, and make the drift score achievement attainable during the 60-second Drift Trial. Keep the existing local profile and single-event achievements.

## Approaches
- **Drift medals only:** smallest change, but adds little variety to the achievement list.
- **Medals for every achievement:** broad progression, but turns short one-off goals into a much longer list.
- **Medals for drift, deliveries, and speed (recommended):** adds three recognizable progress tracks while keeping special achievements concise; this is the proposed choice.

## Proposed scope
- Add bronze/silver/gold tiers for best drift score in one run (250/500/750), career deliveries (10/25/50), and top speed (90/120/150 km/h). Gold drift stays below the existing 800-point Drift Trial objective.
- Preserve existing unlock IDs where they already match a tier, add IDs only for missing tiers, and show each tier clearly in the achievements screen.
- At the end of any run, save its drift score as a career best when higher, then evaluate and persist achievements. This fixes Drift Trial, which currently returns before updating `driftBest` or checking achievements.
- Keep the 60-second timer, scoring formula, 800-point Drift Trial objective, and standalone achievements unchanged.

## Constraints and calls
- Use existing `Profile` stats and `unlockedAch` IDs in local storage; no backend or save reset.
- Existing achievements remain unlocked. Previously saved progress can satisfy the new lower tiers on the next achievement check.
- This is a small UI and progression change; exact medal colors and labels are implementation choices, with Russian bronze/silver/gold labels.
