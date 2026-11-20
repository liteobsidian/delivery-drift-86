import { Game } from "./game";

const SESSION_LOCK = "delivery-drift-86-career";
let disposeSession: (() => void) | undefined;

export function startGame(canvas: HTMLCanvasElement): void {
  stopGame();
  const controller = new AbortController();
  const overlay = document.getElementById("ui-overlay")!;
  let game: Game | undefined;
  let unblock: (() => void) | undefined;

  const waiting = document.createElement("div");
  waiting.className = "screen-wrap";
  waiting.innerHTML = `
    <section class="panel">
      <h2>Игра открыта в другой вкладке</h2>
      <p class="dim" role="status">Закрой её, чтобы продолжить здесь с последнего сохранения.</p>
      <button class="btn primary" type="button">Ждать освобождения</button>
    </section>`;

  const launch = () => {
    waiting.remove();
    game = new Game(canvas);
    game.start();
  };

  const locks = navigator.locks;
  const acquire = (wait: boolean) => {
    void locks.request(SESSION_LOCK, wait ? { signal: controller.signal } : { ifAvailable: true }, async (lock) => {
      if (controller.signal.aborted) return;
      if (!lock) {
        overlay.appendChild(waiting);
        waiting.querySelector("button")!.focus();
        return;
      }
      launch();
      await new Promise<void>((resolve) => { unblock = resolve; });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      if (error instanceof DOMException && (error.name === "SecurityError" || error.name === "NotSupportedError")) {
        launch(); // ProfileStore still blocks writes over a newer snapshot.
        return;
      }
      console.error("Game startup failed", error);
      waiting.innerHTML = '<section class="panel" role="alert">Не удалось открыть игру. Перезагрузи страницу.</section>';
      overlay.appendChild(waiting);
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
    game?.dispose();
    waiting.remove();
    unblock?.();
  };
  if (locks) acquire(false);
  else launch();
}

export function stopGame(): void {
  disposeSession?.();
  disposeSession = undefined;
}
