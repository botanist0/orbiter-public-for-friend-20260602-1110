import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeBin = process.execPath;

// Runs one Node script and streams output so the skill behaves like a normal CLI command.
function runNodeScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(nodeBin, [scriptPath, ...args], {
      cwd: workspace,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${path.basename(scriptPath)} exited with code ${code}`));
    });
  });
}

console.log("Running /itinerary: importing travel Gmail, then regenerating itinerary.");
await runNodeScript(path.join("scripts", "gmail.mjs"), ["ingest", "--account", "gmail-travel", "--travel"]);
await runNodeScript(path.join("scripts", "travel-itinerary.mjs"));
console.log("Itinerary refresh complete. Review the Travel tab or knowledge/projects/travel/itinerary.md.");
