import { describe, expect, it } from "vitest";
import { cityLayoutFor, isOnLayoutRoad, type CityPoint } from "./map-layouts";
import { modeReward } from "./modes";
import { RADIO_TIME, RADIO_WAVES, RadioRun, radioCourse, radioMedal, radioScore } from "./radio-silence";
import { careerMedalPoints, recordDetails, saveRecord } from "./retention";
import { mergeProfileData } from "./storage";
import { routePose } from "./traffic";
import { MAP_IDS } from "./types";

const advance = (run: RadioRun, point: CityPoint, gap = 45, dt = 1 / 60, caught = false) =>
  run.update(dt, point.x, point.z, true, gap, caught);

describe("Радиомолчание", () => {
  it("starts three separate pursuits and only awards each escape once", () => {
    const run = new RadioRun(radioCourse("tokyo"));
    expect(RADIO_TIME).toBe(120);
    for (let wave = 0; wave < RADIO_WAVES; wave++) {
      const { transmitter, cache, jammer, requiredGap } = run.leg;
      expect(advance(run, jammer)).toBeNull();
      expect(advance(run, transmitter)).toBe("signal");
      expect(advance(run, jammer)).toBeNull();
      expect(advance(run, cache)).toBe("cache");
      expect(advance(run, cache)).toBeNull();
      expect(run.packets).toBe(wave);
      expect(advance(run, jammer, requiredGap - 1, 3)).toBeNull();
      expect(advance(run, jammer, requiredGap)).toBe(wave === RADIO_WAVES - 1 ? "finish" : "escape");
      expect(run.escapes).toBe(wave + 1);
      expect(run.packets).toBe(wave + 1);
      expect(advance(run, jammer)).toBeNull();
    }
  });

  it("discards an undelivered packet on capture and allows an escape without collecting one", () => {
    const run = new RadioRun(radioCourse("spb"));
    expect(advance(run, run.target)).toBe("signal");
    expect(advance(run, run.target, 40, 3)).toBe("escape");
    expect(run.packets).toBe(0);
    expect(advance(run, run.target)).toBe("signal");
    expect(advance(run, run.leg.cache)).toBe("cache");
    expect(advance(run, run.target, 3, 3, true)).toBe("caught");
    expect(run.carryingPacket).toBe(false);
    expect(advance(run, run.target, 99, 10)).toBeNull();
    expect(run.escapes).toBe(1);
    expect(run.packets).toBe(0);
  });

  it("places transmitters, side packets, exits and each starting patrol on playable roads", () => {
    for (const map of MAP_IDS) {
      const layout = cityLayoutFor(map);
      const course = radioCourse(map);
      expect(course.legs).toHaveLength(RADIO_WAVES);
      for (const leg of course.legs) {
        const patrol = routePose(course.route, leg.spawnProgress, 1, 2.7);
        for (const { x, z } of [course.start, leg.transmitter, leg.cache, leg.jammer, patrol]) {
          expect(isOnLayoutRoad(layout, x, z), `${map} ${x},${z}`).toBe(true);
          expect(x).toBeGreaterThan(layout.bounds.minX);
          expect(x).toBeLessThan(layout.bounds.maxX);
          expect(z).toBeGreaterThan(layout.bounds.minZ);
          expect(z).toBeLessThan(layout.bounds.maxZ);
        }
        expect(Math.hypot(patrol.x - leg.transmitter.x, patrol.z - leg.transmitter.z)).toBeGreaterThan(20);
      }
    }
  });

  it("rewards a faster, cleaner data run and preserves its best medal in saved careers", () => {
    const bronze = radioScore(0, 0, 40);
    const silver = radioScore(1, 65, 85);
    const gold = radioScore(3, 70, 95);
    expect([bronze, silver, gold].map(radioMedal)).toEqual(["bronze", "silver", "gold"]);
    expect(modeReward("radio-silence", "gold", gold)).toBeGreaterThan(modeReward("radio-silence", "bronze", bronze));
    expect(modeReward("radio-silence", "gold", gold, false)).toBe(0);
    const records = {};
    const key = "tokyo:radio-silence:ae86";
    saveRecord(records, "tokyo", "radio-silence", "ae86", gold);
    saveRecord(records, "tokyo", "radio-silence", "ae86", silver);
    const p = mergeProfileData({ records, seenTutorials: { "radio-silence": true }, stats: { escapes: 2 } });
    expect(recordDetails(key)?.mode).toBe("radio-silence");
    expect(p.records[key]).toBe(gold);
    expect(p.stats.escapes).toBe(2);
    expect(p.seenTutorials["radio-silence"]).toBe(true);
    expect(careerMedalPoints(p.records)).toBe(3);
  });
});
