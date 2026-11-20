import * as THREE from "three";

export interface Ramp {
  x: number;
  z: number;
  width: number;
  length: number;
  /** Unit axis of the ramp. Both ends rise toward its center. */
  dx: number;
  dz: number;
}

export const RAMP_HEIGHT = 1.5;
export const RAMP_ARROW_LEAD = 1.4;
const RAMP_BASE_Y = 0.02;
const ARROW_SPACING = 1.35;

export function rampProfileHeight(along: number, length: number): number {
  return RAMP_HEIGHT * Math.max(0, 1 - Math.abs(along) / (length / 2));
}

function rampVertex(ramp: Ramp, along: number, across: number, lift = 0): [number, number, number] {
  return [
    ramp.x + along * ramp.dx - across * ramp.dz,
    RAMP_BASE_Y + rampProfileHeight(along, ramp.length) + lift,
    ramp.z + along * ramp.dz + across * ramp.dx,
  ];
}

export function buildRampSurface(ramps: readonly Ramp[], pavement: THREE.MeshStandardMaterial, roadSize: number): THREE.Mesh {
  const vertices: number[] = [];
  for (const ramp of ramps) {
    const length = ramp.length / 2;
    const width = ramp.width / 2;
    const nearLeft = rampVertex(ramp, -length, -width);
    const nearRight = rampVertex(ramp, -length, width);
    const crestLeft = rampVertex(ramp, 0, -width);
    const crestRight = rampVertex(ramp, 0, width);
    const farLeft = rampVertex(ramp, length, -width);
    const farRight = rampVertex(ramp, length, width);
    vertices.push(
      ...nearLeft, ...nearRight, ...crestLeft, ...nearRight, ...crestRight, ...crestLeft,
      ...crestLeft, ...crestRight, ...farLeft, ...crestRight, ...farRight, ...farLeft,
      ...nearLeft, ...crestLeft, ...farLeft, ...nearRight, ...farRight, ...crestRight,
    );
  }
  // Project the city-wide road texture so markings meet the surrounding pavement.
  const uv: number[] = [];
  for (let i = 0; i < vertices.length; i += 3) {
    uv.push(vertices[i] / roadSize + 0.5, 0.5 - vertices[i + 2] / roadSize);
  }
  const geometry = new THREE.BufferGeometry()
    .setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3))
    .setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, pavement);
  mesh.name = "ramp-asphalt";
  mesh.receiveShadow = true;
  return mesh;
}

export function buildRampArrows(ramps: readonly Ramp[]): { mesh: THREE.Mesh; texture: THREE.CanvasTexture } {
  const vertices: number[] = [];
  const uv: number[] = [];
  const color: number[] = [];
  const indices: number[] = [];
  for (const ramp of ramps) {
    const toe = ramp.length / 2;
    const approach = toe + RAMP_ARROW_LEAD;
    const width = Math.min(1.45, ramp.width * 0.31);
    const rows = [
      [approach, 0], [approach - 0.45, 1], [toe, 1], [0.7, 1], [0.23, 0],
    ] as const;
    for (const side of [-1, 1]) {
      const start = vertices.length / 3;
      const strip = side < 0 ? rows : [...rows].reverse();
      for (const [distance, opacity] of strip) {
        const along = distance * side;
        const v = (approach - distance) / ARROW_SPACING;
        vertices.push(...rampVertex(ramp, along, -width, 0.025), ...rampVertex(ramp, along, width, 0.025));
        uv.push(0, v, 1, v);
        color.push(1, 1, 1, opacity, 1, 1, 1, opacity);
      }
      for (let i = start; i < start + (strip.length - 1) * 2; i += 2) {
        indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
    .setIndex(indices)
    .setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3))
    .setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
    .setAttribute("color", new THREE.Float32BufferAttribute(color, 4));
  const texture = makeRampArrowTexture();
  const material = new THREE.MeshBasicMaterial({ map: texture, vertexColors: true, transparent: true, depthWrite: false, toneMapped: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "ramp-running-arrows";
  return { mesh, texture };
}

function makeRampArrowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const gold = ctx.createLinearGradient(0, 12, 0, 54);
  gold.addColorStop(0, "#fff2c1");
  gold.addColorStop(1, "#ffbd49");
  ctx.fillStyle = gold;
  ctx.shadowColor = "rgba(255, 164, 42, .95)";
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.moveTo(19, 42);
  ctx.lineTo(64, 12);
  ctx.lineTo(109, 42);
  ctx.lineTo(109, 53);
  ctx.lineTo(64, 25);
  ctx.lineTo(19, 53);
  ctx.closePath();
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}
