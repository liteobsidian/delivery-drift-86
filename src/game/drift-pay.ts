// Drift rewards accrue only during a controlled, grounded powerslide.
export function isControlledDrift(
  handbrake: boolean,
  steer: number,
  lateral: number,
  forward: number,
  grounded: boolean,
) {
  return (
    grounded &&
    handbrake &&
    Math.abs(steer) >= 0.1 &&
    forward > 3 &&
    lateral >= 1.5 &&
    lateral >= forward * Math.tan(Math.PI / 15)
  );
}

export function driftTip(seconds: number) {
  return Math.round(seconds * 35);
}
