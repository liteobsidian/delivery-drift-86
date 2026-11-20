import { CITY_STYLE } from "./city-style";
import { ROAD_W } from "./config";
import { worldLengthToTexturePixels, worldToTextureCoordinate, type CityLayout, type CityPoint, type RoadPath } from "./map-layouts";
import type { RoadSpatialIndex } from "./road-spatial-index";

const MARKING_GAP = 1.4;

export function centerlineRuns(road: RoadPath, roads: RoadSpatialIndex): { distance: number; points: CityPoint[] }[] {
  const lengths = road.points.slice(1).map((point, index) => Math.hypot(point.x - road.points[index].x, point.z - road.points[index].z));
  const total = lengths.reduce((distance, length) => distance + length, 0);
  const first = road.points[0];
  const last = road.points[road.points.length - 1];
  const closed = first.x === last.x && first.z === last.z;
  const runs: { distance: number; points: CityPoint[] }[] = [];
  let run: CityPoint[] = [];
  let start = 0;
  let traveled = 0;
  const finish = () => {
    if (run.length > 1) runs.push({ distance: start, points: run });
    run = [];
  };

  for (const [index, length] of lengths.entries()) {
    if (length === 0) continue;
    const a = road.points[index];
    const b = road.points[index + 1];
    const steps = Math.ceil(length / 1.15);
    for (let step = index ? 1 : 0; step <= steps; step++) {
      const t = step / steps;
      const distance = traveled + length * t;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      if ((!closed && (distance < 2 || distance > total - 2)) || roads.covers(x, z, MARKING_GAP, road)) {
        if (run.length) finish();
        continue;
      }
      if (!run.length) start = distance;
      run.push({ x, z });
    }
    traveled += length;
  }
  finish();
  return runs;
}

/** Fit a transverse stripe inside the asphalt, including its leading and trailing edges. */
export function transverseMarking(
  roads: RoadSpatialIndex, x: number, z: number, alongX: boolean, thickness: number,
): { x: number; z: number; width: number } | null {
  const limit = ROAD_W / 2;
  const inside = (lateral: number) => {
    for (const edge of [-thickness / 2, thickness / 2]) {
      const px = x + (alongX ? edge : lateral);
      const pz = z + (alongX ? lateral : edge);
      if (!roads.covers(px, pz, -0.4)) return false;
    }
    return true;
  };
  if (!inside(0)) return null;
  let min = 0;
  let max = 0;
  while (min - 0.25 >= -limit && inside(min - 0.25)) min -= 0.25;
  while (max + 0.25 <= limit && inside(max + 0.25)) max += 0.25;
  if (max - min < 2) return null;
  const shift = (min + max) / 2;
  return { x: x + (alongX ? 0 : shift), z: z + (alongX ? shift : 0), width: max - min };
}

export function paintRoadSurface(
  g: CanvasRenderingContext2D, layout: CityLayout, roads: RoadSpatialIndex, planeSize: number, textureSize: number,
): void {
  const style = CITY_STYLE[layout.id];
  const coord = (value: number) => worldToTextureCoordinate(value, planeSize, textureSize);
  const size = (value: number) => worldLengthToTexturePixels(value, planeSize, textureSize);
  const trace = (points: readonly CityPoint[]) => {
    g.beginPath();
    g.moveTo(coord(points[0].x), coord(points[0].z));
    for (const point of points.slice(1)) g.lineTo(coord(point.x), coord(point.z));
  };
  const strokeRoads = (color: string, extraWidth: number) => {
    g.strokeStyle = color;
    for (const road of layout.roads) {
      trace(road.points);
      g.lineWidth = size(road.width + extraWidth);
      g.stroke();
    }
  };

  g.save();
  g.lineCap = "round";
  g.lineJoin = "round";
  // Draw the entire asphalt network last, so it covers every inward-facing curb.
  strokeRoads(style.paving, layout.id === "spb" ? 4.2 : 2.6);
  if (style.line === "edge") strokeRoads("#e1d5b9", 0.44);
  strokeRoads(style.asphalt, 0);

  g.lineCap = "butt";
  g.globalAlpha = layout.id === "tokyo" ? 0.67 : 0.84;
  g.strokeStyle = style.lane;
  g.lineWidth = size(layout.id === "yokohama" ? 0.36 : 0.29);
  g.setLineDash([size(layout.id === "yokohama" ? 5 : 3.3), size(4.5)]);
  for (const road of layout.roads) for (const run of centerlineRuns(road, roads)) {
    trace(run.points);
    g.lineDashOffset = size(run.distance);
    g.stroke();
  }

  g.globalAlpha = 1;
  g.fillStyle = "rgba(216,219,214,.62)";
  const crosswalkOffset = ROAD_W / 2 + 0.35;
  const thickness = 0.86;
  for (const junction of layout.signalJunctions) for (const alongX of [false, true]) for (const direction of [-1, 1]) {
    const x = junction.x + (alongX ? direction * crosswalkOffset : 0);
    const z = junction.z + (alongX ? 0 : direction * crosswalkOffset);
    const span = transverseMarking(roads, x, z, alongX, thickness);
    if (!span) continue;
    const stripes = Math.floor(span.width / 1.75);
    const band = span.width / stripes;
    for (let i = 0; i < stripes; i++) {
      const lateral = -span.width / 2 + (i + 0.25) * band;
      g.fillRect(coord(span.x + (alongX ? -thickness / 2 : lateral)), coord(span.z + (alongX ? lateral : -thickness / 2)),
        size(alongX ? thickness : band * 0.54), size(alongX ? band * 0.54 : thickness));
    }
  }
  g.restore();
}
