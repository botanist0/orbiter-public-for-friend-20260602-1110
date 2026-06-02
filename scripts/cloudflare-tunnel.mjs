import { mkdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const orbiterCloudflareDir = path.join(workspace, ".orbiter", "cloudflare");
const configPath = path.join(orbiterCloudflareDir, "config.yml");
const commandPath = path.join(orbiterCloudflareDir, "commands.txt");
const [, , action = "check", ...rawArgs] = process.argv;

// Parses npm-forwarded flags such as --uuid <id> and --hostname example.com.
function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith("--")) {
      continue;
    }
    const key = value.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
    } else {
      options[key] = next;
      index += 1;
    }
  }
  return options;
}

const options = parseArgs(rawArgs);
const tunnelName = String(options.name || process.env.ORBITER_CLOUDFLARE_TUNNEL || "Orbiter");
const hostname = String(options.hostname || process.env.ORBITER_CLOUDFLARE_HOSTNAME || "example.com");
const service = String(options.service || process.env.ORBITER_CLOUDFLARE_SERVICE || "http://127.0.0.1:4173");
const devHostname = String(options.devHostname || process.env.ORBITER_CLOUDFLARE_DEV_HOSTNAME || `dev.${hostname}`);
const devService = String(options.devService || process.env.ORBITER_CLOUDFLARE_DEV_SERVICE || "http://127.0.0.1:4174");

// Runs a read-only cloudflared command when the binary exists on PATH.
function cloudflared(args) {
  return spawnSync(findCloudflaredPath() || "cloudflared", args, { encoding: "utf8" });
}

// Finds the first cloudflared executable on PATH, if Windows can resolve one.
function findCloudflaredPath() {
  const result = spawnSync("where.exe", ["cloudflared"], { encoding: "utf8" });
  if (result.status !== 0) {
    const candidates = [
      "C:\\Program Files\\cloudflared\\cloudflared.exe",
      "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe",
      "C:\\Windows\\System32\\cloudflared.exe"
    ];
    return candidates.find((candidate) => existsSync(candidate)) ?? "";
  }
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
}

// Reports whether the local Cloudflare connector is installed.
async function checkCloudflared() {
  const binaryPath = findCloudflaredPath();
  if (binaryPath) {
    const info = await stat(binaryPath).catch(() => null);
    if (info && info.size === 0) {
      console.log(`cloudflared exists but is empty: ${binaryPath}`);
      console.log("Delete the corrupt 0 byte file from an elevated terminal, then reinstall cloudflared.");
      return false;
    }
  }

  const result = cloudflared(["--version"]);
  if (result.error?.code === "ENOENT") {
    console.log("cloudflared is not installed or not on PATH.");
    console.log("Install it from Cloudflare, then run: npm run cloudflare:setup");
    return false;
  }
  if (result.status !== 0) {
    console.log(result.stderr || result.stdout || result.error?.message || "cloudflared check failed.");
    return false;
  }
  console.log(result.stdout.trim());
  return true;
}

// Writes the project-local tunnel config after the user creates a tunnel UUID.
async function writeTunnelConfig(uuid) {
  if (!uuid) {
    throw new Error("Missing --uuid. Create the tunnel first, then pass its UUID.");
  }

  const credentials = path.join(os.homedir(), ".cloudflared", `${uuid}.json`).replace(/\\/g, "/");
  const config = `tunnel: ${uuid}
credentials-file: ${credentials}

ingress:
  - hostname: ${hostname}
    service: ${service}
    originRequest:
      httpHostHeader: ${hostname}
  - hostname: ${devHostname}
    service: ${devService}
    originRequest:
      httpHostHeader: ${devHostname}
  - service: http_status:404
`;

  const commands = `Orbiter Cloudflare Tunnel commands

1. Authenticate cloudflared:
   cloudflared tunnel login

2. Create the tunnel:
   cloudflared tunnel create ${tunnelName}

3. Generate this config after copying the created UUID:
   npm run cloudflare:setup -- --uuid <TUNNEL_UUID>

4. Create the DNS route:
   cloudflared tunnel route dns ${tunnelName} ${hostname}
   cloudflared tunnel route dns ${tunnelName} ${devHostname}

5. Start Orbiter for Cloudflare:
   npm run start:cloudflare
   npm run start:cloudflare:dev

6. Run the tunnel in a second terminal:
   npm run cloudflare:run

7. Open:
   https://${hostname}/
   https://${devHostname}/

Config:
   ${configPath}
`;

  await mkdir(orbiterCloudflareDir, { recursive: true });
  await writeFile(configPath, config, "utf8");
  await writeFile(commandPath, commands, "utf8");

  console.log(`Wrote ${path.relative(workspace, configPath)}`);
  console.log(`Wrote ${path.relative(workspace, commandPath)}`);
  console.log("");
  console.log(`Next: cloudflared tunnel route dns ${tunnelName} ${hostname}`);
  console.log(`Then: cloudflared tunnel route dns ${tunnelName} ${devHostname}`);
}

// Prints the setup sequence without requiring credentials or admin rights.
async function printSetup() {
  await checkCloudflared();
  console.log("");
  console.log("Cloudflare Tunnel setup for Orbiter");
  console.log(`Tunnel name: ${tunnelName}`);
  console.log(`Hostname: ${hostname}`);
  console.log(`Local service: ${service}`);
  console.log(`Dev hostname: ${devHostname}`);
  console.log(`Dev service: ${devService}`);
  console.log("");
  console.log("Run:");
  console.log("  cloudflared tunnel login");
  console.log(`  cloudflared tunnel create ${tunnelName}`);
  console.log("  npm run cloudflare:setup -- --uuid <TUNNEL_UUID>");
  console.log(`  cloudflared tunnel route dns ${tunnelName} ${hostname}`);
  console.log(`  cloudflared tunnel route dns ${tunnelName} ${devHostname}`);
  console.log("  npm run start:cloudflare");
  console.log("  npm run start:cloudflare:dev");
  console.log("  npm run cloudflare:run");
}

if (action === "check") {
  await checkCloudflared();
} else if (action === "setup") {
  if (options.uuid) {
    await writeTunnelConfig(String(options.uuid));
  } else {
    await printSetup();
  }
} else {
  console.log("Usage:");
  console.log("  npm run cloudflare:check");
  console.log("  npm run cloudflare:setup");
  console.log("  npm run cloudflare:setup -- --uuid <TUNNEL_UUID>");
}
