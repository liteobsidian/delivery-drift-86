// Delivery tips accrue only during a controlled, grounded powerslide.
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
    Math.abs(steer) >= 0.18 &&
    forward > 6 &&
    lateral >= 3 &&
    lateral >= forward * Math.tan(Math.PI / 15)
  );
}

export function driftTip(seconds: number) {
  return Math.round(seconds * 35);
}
