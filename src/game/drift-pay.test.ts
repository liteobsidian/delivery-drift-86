import { expect, it } from "vitest";
import { driftTip, isControlledDrift } from "./drift-pay";

it("requires steering, handbrake and real sideways travel on the ground", () => {
  expect(isControlledDrift(true, -0.6, 5, 14, true)).toBe(true);
  expect(isControlledDrift(true, 0, 5, 14, true)).toBe(false);
  expect(isControlledDrift(true, 0.6, 1, 14, true)).toBe(false);
  expect(isControlledDrift(false, 0.6, 5, 14, true)).toBe(false);
  expect(isControlledDrift(true, 0.6, 5, 14, false)).toBe(false);
  expect(isControlledDrift(true, 0.6, 5, 0, true)).toBe(false);
});
it("pays in proportion to accumulated slide time, including fractions", () => {
  expect([0, 0.2, 1, 3, 10].map(driftTip)).toEqual([0, 7, 35, 105, 350]);
});
