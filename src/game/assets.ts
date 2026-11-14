import * as THREE from "three";

export interface LoadedModel {
  /** wrapper group: metre scale, sits on y=0, nose faces local -z */
  root: THREE.Group;
  /** bounding size after normalization */
  size: THREE.Vector3;
}

export interface GameAssets {
  /** civilian cars for traffic */
  traffic: LoadedModel[];
  police: LoadedModel;
  midrise: LoadedModel;
}

type AssetModule = {
  createAsset: (
    three: unknown,
    opts: { states: string; sharedResources: boolean }
  ) => Promise<THREE.Group & { setState: (name: string) => Promise<void> }>;
  availableStates: string[];
};

/**
 * The packed asset payloads live in the repo as base64 text (`.b64`) because
 * the publishing channel is text-only. This shim transparently serves the
 * decoded gzip bytes for any `*.gz` request under /assets/, so the asset
 * loaders stay untouched.
 */
let b64ShimInstalled = false;
function installB64FetchShim(): void {
  if (b64ShimInstalled) return;
  b64ShimInstalled = true;
  const origFetch = window.fetch.bind(window);
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/assets/") && url.endsWith(".gz")) {
      const r = await origFetch(url + ".b64", init);
      if (r.ok) {
        const text = (await r.text()).trim();
        const bytes = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
        return new Response(bytes, {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        });
      }
    }
    return origFetch(input, init);
  }) as typeof window.fetch;
}

/**
 * Loads one packed Three.js asset module from /assets and normalizes it:
 * rotY aligns the nose to local -z, normalize() picks the uniform scale,
 * and the model is grounded so its bbox min.y sits at 0.
 */
async function loadModel(
  rel: string,
  rotY: number,
  normalize: (size: THREE.Vector3) => number
): Promise<LoadedModel> {
  const url = new URL(`assets/${rel}/asset.js`, document.baseURI).href;
  const mod = (await import(/* @vite-ignore */ url)) as AssetModule;
  const inner = await mod.createAsset(THREE, {
    states: "lazy",
    sharedResources: true,
  });
  // lazy states load geometry only on setState — without this the bounds
  // are empty and normalization would compute a gigantic scale
  await inner.setState(mod.availableStates[0]);
  // showroom materials use transmission, which forces a full extra render pass
  // in three.js — way too costly for a traffic fleet. Glass stays glass.
  inner.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const mats = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const m of mats) {
      const pm = m as THREE.MeshPhysicalMaterial;
      if (pm && "transmission" in pm) pm.transmission = 0;
    }
  });
  // the loader root carries its own Z-up -> Y-up conversion: never touch its
  // transform, yaw an outer group instead (same parent frame as placement)
  const yaw = new THREE.Group();
  yaw.rotation.y = rotY;
  yaw.add(inner);
  const wrap = new THREE.Group();
  wrap.add(yaw);
  const box = new THREE.Box3().setFromObject(wrap);
  const size = box.getSize(new THREE.Vector3());
  wrap.scale.setScalar(normalize(size));
  // ground the model
  const box2 = new THREE.Box3().setFromObject(wrap);
  wrap.position.y -= box2.min.y;
  const size2 = box2.getSize(new THREE.Vector3());
  return { root: wrap, size: size2 };
}

/**
 * Free downloaded vehicle/prop models. Nose axes were verified from renders:
 * hatchback + sedan nose = +x, coupe + police nose = +z.
 * Game convention: model nose must face local -z.
 */
export async function loadGameAssets(): Promise<GameAssets> {
  installB64FetchShim();
  const [hatchback, sedan, coupe, police, midrise] = await Promise.all([
    loadModel("vehicles/hatchback", Math.PI / 2, (s) => 4.15 / Math.max(s.x, s.z)),
    loadModel("vehicles/sedan", Math.PI / 2, (s) => 4.6 / Math.max(s.x, s.z)),
    loadModel("vehicles/coupe", Math.PI, (s) => 4.45 / Math.max(s.x, s.z)),
    loadModel("vehicles/police", Math.PI, (s) => 4.75 / Math.max(s.x, s.z)),
    loadModel("props/midrise", 0, (s) => 26 / s.y),
  ]);
  return { traffic: [hatchback, sedan, coupe], police, midrise };
}
