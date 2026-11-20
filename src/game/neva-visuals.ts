import * as THREE from "three";
import { NEVA_CONTRACT, NEVA_SECTORS } from "./neva-contract";
import { cityLayoutFor, type CityPoint } from "./map-layouts";

const { start: NEVA_START, finish: NEVA_FINISH } = NEVA_CONTRACT;

/** Bake both sectors into a single road decal mesh. */
export function buildNevaMarkings() {
  const positions: number[] = [];
  const stripe = (a: CityPoint, b: CityPoint, width: number) => {
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const x = (b.z - a.z) / length * width / 2;
    const z = (a.x - b.x) / length * width / 2;
    const h = 0.19;
    positions.push(
      a.x + x, h, a.z + z, a.x - x, h, a.z - z, b.x + x, h, b.z + z,
      a.x - x, h, a.z - z, b.x - x, h, b.z - z, b.x + x, h, b.z + z,
    );
  };
  for (const { entry, corner, exit } of NEVA_SECTORS) {
    for (const gate of [entry, exit]) {
      const w = gate.halfWidth;
      stripe({ x: gate.x + gate.dz * w, z: gate.z - gate.dx * w },
        { x: gate.x - gate.dz * w, z: gate.z + gate.dx * w }, 0.28);
    }
    for (const [a, b] of [[entry, corner], [corner, exit]]) {
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      const dx = (b.x - a.x) / length;
      const dz = (b.z - a.z) / length;
      for (let i = 2; i + 1.4 < length; i += 3) {
        stripe({ x: a.x + dx * i, z: a.z + dz * i },
          { x: a.x + dx * (i + 1.4), z: a.z + dz * (i + 1.4) }, 0.28);
      }
    }
  }
  const geometry = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.MeshBasicMaterial({ color: 0xffc06a, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "neva-contract-markings";
  return mesh;
}

export function drawNevaRoute(g: CanvasRenderingContext2D, u: (x: number) => number, v: (z: number) => number): void {
  const paintLine = (points: readonly CityPoint[], color: string, width: number) => {
    g.beginPath();
    for (const [index, point] of points.entries()) {
      if (index === 0) g.moveTo(u(point.x), v(point.z));
      else g.lineTo(u(point.x), v(point.z));
    }
    g.strokeStyle = color;
    g.lineWidth = width;
    g.stroke();
  };
  g.lineJoin = g.lineCap = "round";
  paintLine([NEVA_START, ...NEVA_SECTORS.map(({ corner }) => corner), NEVA_FINISH], "#5ceef0", 2);
  for (const { entry, corner, exit } of NEVA_SECTORS) paintLine([entry, corner, exit], "#ffc06a", 3);
}

export function drawNevaPreview(canvas: HTMLCanvasElement): void {
  const g = canvas.getContext("2d")!;
  const u = (x: number) => (x + 110) * 1.55;
  const v = (z: number) => (z - 23) * 1.55;
  g.fillStyle = "#161b2a";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = "#133846";
  g.fillRect(0, v(104), canvas.width, v(136) - v(104));
  g.font = "10px system-ui";
  g.fillStyle = "#83bcc8";
  g.fillText("НЕВА", 13, v(122));
  g.strokeStyle = "#31394d";
  g.lineWidth = 4;
  for (const { points } of cityLayoutFor(NEVA_CONTRACT.mapId).roads) {
    g.beginPath();
    points.forEach((point, index) => index === 0 ? g.moveTo(u(point.x), v(point.z)) : g.lineTo(u(point.x), v(point.z)));
    g.stroke();
  }
  drawNevaRoute(g, u, v);
  const dot = (point: CityPoint, color: string, label: string) => {
    const x = u(point.x);
    const z = v(point.z);
    g.beginPath();
    g.arc(x, z, 7.5, 0, 2 * Math.PI);
    g.fillStyle = color;
    g.fill();
    g.fillStyle = "#101521";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "bold 10px system-ui";
    g.fillText(label, x, z);
  };
  dot(NEVA_START, "#5ceef0", "С");
  NEVA_SECTORS.forEach(({ corner }, index) => dot(corner, "#ffc06a", String(index + 1)));
  dot(NEVA_FINISH, "#5ceef0", "Ф");
}
