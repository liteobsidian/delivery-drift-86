# Menu, Track Progression, and Weekly Event Design

## Intent
Make Delivery Drift 86 easier to enter and easier to understand. Put one clear play action on the home screen, move mode and map choices into dedicated screens, let a new district feel earned, and surface the weekly activity without interrupting every launch.

## Goals
- Reduce the home screen to the title, one primary play action, and a few secondary destinations.
- Add separate activity and map/track selection screens.
- Unlock Yokohama after eight completed deliveries for new careers; preserve access for existing saves whose selected map is already Yokohama.
- Keep map identity obvious in track cards. Tokyo remains the neon city; Yokohama remains the port with water, cranes, and containers.
- Show the current weekly route once per UTC week in a dismissible startup card with an immediate start action.
- Keep records, achievements, cars, garage, existing saves, and unlimited ordinary deliveries accessible.
- Keep controls and screens readable at the current desktop and mobile viewports.

## Non-goals
- No online leaderboard or account system.
- No changes to vehicle physics, earning balance, or collision rules.
- No forced event flow, attendance streak, or delivery cap.
- No new city geometry in this pass; both existing maps keep the shared road grid and their distinct visual dressing.

## Approaches considered
1. **Split the existing home menu into focused screens and add progressive map cards (selected).** Low-risk because the game already routes screens through `GameScreen`; keeps current maps and physics while making progression legible.
2. **Keep one screen and collapse options into tabs.** Smaller code change, but the map and mode options remain easy to miss and do not make new places feel earned.
3. **Build a new hub world with separate race circuits.** Strongest visual change, but requires new road/collision/traffic layouts and would expand this menu pass into a physics/world rewrite.

## User flow
- Home: one prominent “Играть” action; compact buttons for garage, cars, and profile.
- Play: choose Delivery, Drift Trial, or Time Attack.
- Tracks: choose Neon Tokyo or Yokohama Port; show delivery progress for locked Yokohama and start the selected activity after a map is chosen.
- Profile: combine personal records, weekly routes, and achievements in one organized screen.
- Startup event: when a new UTC week starts, show the first incomplete weekly route once. “Играть” starts it; “Позже” closes it and records that the card was seen for that week.

## Constraints and decisions
- New-save Yokohama unlock threshold: 8 completed deliveries, aligned with the first car unlock milestone.
- If an existing profile already has `mapId: "yokohama"`, treat it as unlocked to avoid taking away access.
- A locked map card shows the remaining delivery count and keeps the Tokyo card selectable.
- The event uses the existing weekly route seed and local storage, so it works without a backend and is stable for a UTC week.
- The event card is offered at most once per browser and UTC week; it is never modal after dismissal that week.

## Success checks
- New players see a clear first action and cannot choose Yokohama before unlocking it.
- Selecting an activity then a map starts exactly that activity/map.
- Existing Yokohama saves retain access and existing profile data remains intact.
- The event can be started or dismissed; it does not appear again in the same UTC week.
- Existing smoke checks for maps, modes, nitro, records, and unlimited deliveries continue to pass.
