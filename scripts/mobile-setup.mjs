import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const orbiterDir = path.join(workspace, ".orbiter");
const tokenPath = path.join(orbiterDir, "mobile-token");
const port = Number(process.env.PORT ?? 4173);

// Loads or creates the shared token that the iPhone Shortcut sends to Orbiter.
async function getToken() {
  try {
    return (await readFile(tokenPath, "utf8")).trim();
  } catch {
    await mkdir(orbiterDir, { recursive: true });
    const token = randomBytes(24).toString("hex");
    await writeFile(tokenPath, `${token}\n`, "utf8");
    return token;
  }
}

// On Windows, prefers addresses attached to adapters with a default gateway.
function defaultGatewayIPv4Addresses() {
  if (process.platform !== "win32") {
    return [];
  }

  try {
    const output = execFileSync("powershell", [
      "-NoProfile",
      "-Command",
      "Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address } | ForEach-Object { $_.IPv4Address.IPAddress }"
    ], { encoding: "utf8" });

    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Lists non-internal IPv4 addresses as fallback LAN endpoint candidates.
function localIPv4Addresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((network) => network && network.family === "IPv4" && !network.internal)
    .filter((network) => !network.address.startsWith("169.254."))
    .map((network) => network.address);
}

// Compute the endpoint and print the exact fields needed in iOS Shortcuts.
const token = await getToken();
const addresses = [...new Set([...defaultGatewayIPv4Addresses(), ...localIPv4Addresses()])];
const preferredAddress = addresses[0] ?? "<your-computer-local-ip>";
const endpoint = `http://${preferredAddress}:${port}/api/mobile/capture`;

console.log("Orbiter iPhone capture setup");
console.log("");
console.log(`Start LAN backend: npm run start:lan`);
console.log(`Endpoint: ${endpoint}`);
console.log(`Header: x-orbiter-mobile-token`);
console.log(`Token: ${token}`);
if (addresses.length > 1) {
  console.log(`Other local candidates: ${addresses.slice(1).join(", ")}`);
}
console.log("");
console.log("Shortcut actions:");
console.log("1. Ask for Input");
console.log("   Prompt: Orbiter note");
console.log("   Input Type: Text");
console.log("2. Get Contents of URL");
console.log(`   URL: ${endpoint}`);
console.log("   Method: POST");
console.log("   Headers:");
console.log(`     x-orbiter-mobile-token: ${token}`);
console.log("     Content-Type: application/json");
console.log("   Request Body: JSON");
console.log("     text: Provided Input");
console.log("     skill: capture");
console.log("     source: iphone-back-tap");
console.log("3. Show Notification");
console.log("   Text: Sent to Orbiter");
console.log("");
console.log("Then assign the Shortcut to Back Tap on the iPhone.");
