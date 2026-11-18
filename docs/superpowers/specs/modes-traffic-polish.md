# Modes and traffic polish

## Goal

Make Drift Trial and Time Attack complete, rewarding activities; remove delivery-only cargo feedback from them; keep NPC traffic smooth and believable; reduce repeated collision and generation work.

## Mode design

- Drift Trial runs for 60 seconds. It scores drift chains with a multiplier that rises over time; a hard collision drops only the unbanked chain. Scores below 250 still earn a small score-based payout; 250/500/750 are bronze/silver/gold, with larger fixed rewards. Existing drift achievements continue to use the best run score.
- Time Attack uses one fixed authored closed route per map, with five ordered gates including the finish. It displays the next gate and elapsed time; a missed gate cannot be skipped. Route length defines bronze/silver/gold target times at average speeds of 13/17/22 m/s, with an additional 25 seconds to finish without a medal. Completion pays a medal-based reward and records comparable best times per map and car.
- Neither mode changes delivery totals, cargo, or delivery achievements. Both contribute mode-specific achievements and can unlock garage cars in addition to the existing delivery path: Silvia from silver drift and Evo from gold Time Attack. Cars still require their listed purchase price.
- Hide cargo HUD and delivery tutorial messages in both modes. Do not apply cargo damage, traffic fines, police pursuits, or delivery cash popups there. Retain vehicle-body damage and make collisions break the current drift chain.

## Traffic and performance

- Interpolate NPC visual positions between fixed physics steps. Smooth route headings across corners and accelerate/brake toward speed targets instead of applying instantaneous speed changes.
- Keep NPC route position authoritative during collision response; resolve overlap by moving the player. Do not spawn an NPC within 100 world units of the player.
- Use a spatial hash to query building collision candidates around the car and to check nearby generated building sites. Preserve exact narrow-phase collision and placement rules.

## Research adapted

- NFS Heat separates cash rewards from reputation and makes night racing a risk/reward loop; this design keeps drift/time-attack rewards direct and legible. https://www.ea.com/able/resources/need-for-speed/need-for-speed-heat/pc/text-manual
- Forza Horizon 5 uses short, category-based Accolades and challenges; the two existing non-delivery modes gain clear medal tiers and persistent goals. https://forza.net/news/forza-horizon-5-road-to-mexico-september-update
- Forza Rivals lets players repeatedly target a comparable ghost/record; fixed routes make our Time Attack records meaningful across attempts. https://support.forza.net/hc/en-us/articles/360005424113-FM7-Rivals-and-Leaderboards
- Forza Horizon skill chains reward sustained play and risk of losing an unbanked chain; Drift Trial adopts this loop for drift scoring. https://support.forza.net/hc/en-us/articles/360005300834-FH3-Skills-and-Perks

## Verification

- Unit tests cover medal/payout thresholds, car unlock alternatives, fixed course construction/checkpoint order, and NPC spawn distance, corner continuity, acceleration, collision route consistency, plus building-grid equivalence.
- Run the unit suite and production build. Run the browser smoke check and inspect screenshots/gameplay for both modes and maps.
