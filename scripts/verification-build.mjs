import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export function buildForVerification() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const dist = mkdtempSync(join(tmpdir(), "delivery-drift-86-verify-"));
  process.once("exit", () => rmSync(dist, { recursive: true, force: true }));
  execFileSync(process.execPath, [
    join(root, "node_modules/vite/bin/vite.js"), "build", "--mode", "verification", "--outDir", dist,
  ], { cwd: root, stdio: "inherit" });
  return dist;
}
