import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { createAccessUser, readAccessUsers, slugifyAccessId, writeAccessConfig } from "./access-control.mjs";

const port = Number(process.env.PORT ?? 4173);
const tailscaleCandidates = process.platform === "win32"
  ? [
      "tailscale",
      "C:\\Program Files\\Tailscale\\tailscale.exe",
      path.join(process.env.LOCALAPPDATA ?? "", "Tailscale", "tailscale.exe")
    ]
  : ["tailscale"];

// Runs a local command and returns stdout, falling back to empty output.
function tryExec(file, args) {
  try {
    return execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

// Finds the Tailscale executable on Windows even when it is not on PATH.
function tailscaleExecutable() {
  for (const candidate of tailscaleCandidates.filter(Boolean)) {
    if (tryExec(candidate, ["version"])) {
      return candidate;
    }
  }
  return "";
}

// Reads the current machine's Tailscale IPv4 address.
function tailscaleIPv4(executable) {
  return tryExec(executable, ["ip", "-4"])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? "";
}

// Reads the MagicDNS hostname when available.
function tailscaleDnsName(executable) {
  const raw = tryExec(executable, ["status", "--json"]);
  if (!raw) {
    return "";
  }
  try {
    return String(JSON.parse(raw).Self?.DNSName ?? "").replace(/\.$/, "");
  } catch {
    return "";
  }
}

const config = await writeAccessConfig({ authRequired: true, networkGuard: "tailscale" });
const executable = tailscaleExecutable();
const tailscaleIp = executable ? tailscaleIPv4(executable) : "";
const dnsName = executable ? tailscaleDnsName(executable) : "";
const appHost = tailscaleIp || dnsName || "<windows-tailscale-ip>";
let createdOwner = null;

if (!(await readAccessUsers()).length) {
  const ownerId = slugifyAccessId(os.userInfo().username || "owner");
  createdOwner = await createAccessUser({ id: ownerId, name: ownerId, role: "admin" });
}

console.log("Orbiter local production setup");
console.log("");
console.log(`Auth required: ${config.authRequired}`);
console.log(`Network guard: ${config.networkGuard}`);
console.log(`Tailscale CLI: ${executable || "not found"}`);
console.log(`Tailscale IPv4: ${tailscaleIp || "not available"}`);
console.log(`Tailscale DNS: ${dnsName || "not available"}`);
console.log("");
console.log("Start local production:");
console.log("  npm run start:prod");
console.log("");
console.log("App URL:");
console.log(`  http://${appHost}:${port}/`);
console.log("");
console.log("Mobile command/capture endpoint:");
console.log(`  http://${appHost}:${port}/api/mobile/capture`);
console.log("  Header: x-orbiter-access-token");
console.log("  Body: { \"text\": \"COMMAND make Orbit better\", \"skill\": \"command\", \"source\": \"iphone\" }");

if (createdOwner) {
  console.log("");
  console.log("Created owner access user");
  console.log(`User: ${createdOwner.user.id}`);
  console.log(`Role: ${createdOwner.user.role}`);
  console.log("Access token:");
  console.log(createdOwner.token);
} else {
  console.log("");
  console.log("Owner already exists. Use npm run access:rotate -- --id <user-id> to issue a new token.");
}

console.log("");
console.log("Add another user:");
console.log("  npm run access:add -- --id wife --name \"Wife\" --role member");
