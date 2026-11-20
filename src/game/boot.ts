import { Game } from "./game";

const SESSION_LOCK = "delivery-drift-86-career";
const SLOW_LOAD_DELAY = 10_000;
let disposeSession: (() => void) | undefined;

export function startGame(canvas: HTMLCanvasElement): void {
  stopGame();
  const controller = new AbortController();
  const { signal } = controller;
  const released = new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
  const root = canvas.parentElement!;
  const overlay = document.getElementById("ui-overlay")!;
  const loading = document.getElementById("startup-loading")!;
  const status = document.getElementById("startup-status")!;
  const percent = document.getElementById("startup-percent")!;
  const progress = document.querySelector<HTMLProgressElement>("#startup-progress")!;
  const action = document.querySelector<HTMLButtonElement>("#startup-action")!;
  let game: Game | undefined;
  let slowTimer: number | undefined;

  const waiting = document.createElement("div");
  waiting.className = "screen-wrap";
  waiting.innerHTML = `
    <section class="panel">
      <h2>Игра открыта в другой вкладке</h2>
      <p class="dim" role="status">Закрой её, чтобы продолжить здесь с последнего сохранения.</p>
      <button class="btn primary" type="button">Ждать освобождения</button>
    </section>`;

  const fail = (error: unknown) => {
    if (signal.aborted) return;
    console.error("Game startup failed", error);
    game?.dispose();
    game = undefined;
    root.inert = true;
    loading.hidden = false;
    progress.hidden = true;
    percent.textContent = "";
    status.textContent = "Не удалось запустить игру";
    action.textContent = "Перезагрузить";
    action.hidden = false;
    action.onclick = () => window.location.reload();
  };

  const launch = async () => {
    waiting.remove();
    loading.hidden = false;
    root.inert = true;
    progress.hidden = false;
    progress.removeAttribute("value");
    percent.textContent = "";
    status.textContent = "Готовим игру…";
    action.hidden = true;
    action.textContent = "Играть сейчас";

    try {
      game = new Game(canvas, (finished, total) => {
        if (signal.aborted || loading.hidden) return;
        if (finished === 0) status.textContent = "Загружаем модели…";
        progress.max = total;
        progress.value = finished;
        percent.textContent = `${Math.floor(100 * finished / total)}%`;
      });
      const skip = new Promise<void>((resolve) => { action.onclick = () => resolve(); });
      slowTimer = window.setTimeout(() => {
        status.textContent = "Модели ещё загружаются…";
        action.hidden = false;
      }, SLOW_LOAD_DELAY);
      await Promise.race([game.initialModels, skip, released]);
      window.clearTimeout(slowTimer);
      if (signal.aborted) return;

      action.onclick = null;
      action.hidden = true;
      status.textContent = "Готовим первый кадр…";
      game.start();
      loading.hidden = true;
      root.inert = false;
      overlay.querySelector<HTMLButtonElement>('[data-a="event-dismiss"]')?.focus({ preventScroll: true });
      await released;
    } catch (error) {
      window.clearTimeout(slowTimer);
      fail(error);
    }
  };

  const locks = navigator.locks;
  const acquire = (wait: boolean) => {
    void locks.request(SESSION_LOCK, wait ? { signal } : { ifAvailable: true }, async (lock) => {
      if (signal.aborted) return;
      if (lock) {
        await launch();
      } else {
        loading.hidden = true;
        root.inert = false;
        overlay.appendChild(waiting);
        waiting.querySelector("button")!.focus();
      }
    }).catch((error: unknown) => {
      if (signal.aborted) return;
      if (error instanceof DOMException && (error.name === "SecurityError" || error.name === "NotSupportedError")) {
        void launch(); // ProfileStore still blocks writes over a newer snapshot.
      } else {
        fail(error);
      }
    });
  };

  const waitButton = waiting.querySelector("button")!;
  waitButton.addEventListener("click", () => {
    waitButton.disabled = true;
    waiting.querySelector("p")!.textContent = "Игра запустится здесь, как только закроешь другую вкладку.";
    acquire(true);
  });

  disposeSession = () => {
    controller.abort();
    window.clearTimeout(slowTimer);
    game?.dispose();
    waiting.remove();
    loading.hidden = true;
    root.inert = false;
    action.onclick = null;
  };

  loading.hidden = false;
  root.inert = true;
  // Let React finish its development mount/cleanup cycle before taking the tab lock.
  queueMicrotask(() => {
    if (signal.aborted) return;
    if (locks) acquire(false);
    else void launch();
  });
}

export function stopGame(): void {
  disposeSession?.();
  disposeSession = undefined;
}
