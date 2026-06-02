import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const orbiterDir = path.join(workspace, ".orbiter");
const tokenPath = path.join(orbiterDir, "mobile-token");
const port = Number(process.env.PORT ?? 4173);
const tailscaleCandidates = process.platform === "win32"
  ? [
      "tailscale",
      "C:\\Program Files\\Tailscale\\tailscale.exe",
      path.join(process.env.LOCALAPPDATA ?? "", "Tailscale", "tailscale.exe")
    ]
  : ["tailscale"];

// Loads or creates the same mobile token used by the local Wi-Fi capture endpoint.
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

// Runs a command and returns trimmed stdout, or an empty string when unavailable.
function tryExec(file, args) {
  try {
    return execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

// Finds Tailscale even when Windows installed it outside PATH.
function tailscaleExecutable() {
  for (const candidate of tailscaleCandidates.filter(Boolean)) {
    const output = tryExec(candidate, ["version"]);
    if (output) {
      return candidate;
    }
  }

  return "";
}

// Checks whether the Tailscale CLI is installed and visible to this shell.
function hasTailscaleCli(executable) {
  return Boolean(executable);
}

// Reads the machine's Tailscale IPv4 address when Tailscale is installed and logged in.
function tailscaleIPv4(executable) {
  return tryExec(executable, ["ip", "-4"])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? "";
}

// Reads the MagicDNS name if the tailnet exposes one for this Windows machine.
function tailscaleDnsName(executable) {
  const raw = tryExec(executable, ["status", "--json"]);
  if (!raw) {
    return "";
  }

  try {
    const status = JSON.parse(raw);
    return String(status.Self?.DNSName ?? "").replace(/\.$/, "");
  } catch {
    return "";
  }
}

const token = await getToken();
const executable = tailscaleExecutable();
const hasTailscale = hasTailscaleCli(executable);
const dnsName = hasTailscale ? tailscaleDnsName(executable) : "";
const ipAddress = hasTailscale ? tailscaleIPv4(executable) : "";
const primaryHost = ipAddress || dnsName || "<windows-tailscale-ip>";
const primaryEndpoint = `http://${primaryHost}:${port}/api/mobile/capture`;
const dnsEndpoint = dnsName ? `http://${dnsName}:${port}/api/mobile/capture` : "";

console.log("Orbiter 5G remote capture setup");
console.log("");

if (!hasTailscale) {
  console.log("Tailscale CLI: not found");
  console.log("Install Tailscale on Windows and iPhone, then sign into the same tailnet.");
  console.log("After that, run this command again.");
} else {
  console.log("Tailscale CLI: found");
  console.log(`Tailscale CLI path: ${executable}`);
  console.log(`Tailscale DNS: ${dnsName || "not available"}`);
  console.log(`Tailscale IPv4: ${ipAddress || "not available"}`);
}

console.log("");
console.log("Start Orbiter for remote capture:");
console.log("  npm run start:remote");
console.log("  This binds to 0.0.0.0 with the Tailscale network guard enabled.");
console.log("");
console.log("Shortcut endpoint, recommended for iPhone:");
console.log(`  ${primaryEndpoint}`);
if (dnsEndpoint && dnsEndpoint !== primaryEndpoint) {
  console.log("");
  console.log("MagicDNS endpoint, optional after DNS works on iPhone:");
  console.log(`  ${dnsEndpoint}`);
}
console.log("");
console.log("Shortcut headers:");
console.log("  x-orbiter-mobile-token:");
console.log(`  ${token}`);
console.log("  Content-Type:");
console.log("  application/json");
console.log("");
console.log("Shortcut JSON body:");
console.log("  text: Provided Input");
console.log("  skill: capture");
console.log("  source: iphone-back-tap-5g");
console.log("");
console.log("If Windows Firewall blocks the request, run PowerShell as Administrator and allow Orbiter on the Tailscale range:");
console.log('  New-NetFirewallRule -DisplayName "Orbiter Tailscale 4173" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 4173 -RemoteAddress 100.64.0.0/10');
