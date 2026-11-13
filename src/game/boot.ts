import { Game } from "./game";

let game: Game | null = null;

export function startGame(canvas: HTMLCanvasElement): void {
  stopGame();
  game = new Game(canvas);
  game.start();
}

export function stopGame(): void {
  if (game) {
    game.dispose();
    game = null;
  }
}
