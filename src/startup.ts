// The tiny entry lets the first visit cache even the main JS/CSS bundles.
async function prepareAssetCache(): Promise<void> {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const workers = navigator.serviceWorker;
  const workerURL = new URL("asset-worker.js", document.baseURI);
  workerURL.searchParams.set("build", new URL(import.meta.url).pathname.split("/").pop()!);
  const registration = workers.register(workerURL, {updateViaCache: "none"});
  if (workers.controller?.scriptURL === workerURL.href) {
    void registration.catch(() => {});
    return;
  }
  // A browser that blocks site storage must still be able to launch the game.
  await new Promise<void>(resolve => {
    const done = () => {
      clearTimeout(timeout);
      workers.removeEventListener("controllerchange", done);
      resolve();
    };
    const timeout = setTimeout(done, 1500);
    workers.addEventListener("controllerchange", done);
    void registration.catch(done);
    if (workers.controller?.scriptURL === workerURL.href) done();
  });
}

void prepareAssetCache().catch(() => {}).then(() => import("./main"));
