import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const orbiterDir = path.join(workspace, ".orbiter");
const commandsInboxDir = path.join(workspace, "commands", "inbox");
const issuesJournalDir = path.join(workspace, "issues-journal");
const statusPath = path.join(orbiterDir, "self-heal-status.json");
const defaultBaseUrl = "http://127.0.0.1:4173";
const mode = String(process.argv[2] ?? "check").toLowerCase();
const options = parseArgs(process.argv.slice(3));
const baseUrl = String(options.url ?? process.env.ORBITER_URL ?? defaultBaseUrl).replace(/\/+$/g, "");
const checks = [];

const requiredDirectories = [
  "app",
  "commands",
  "commands/inbox",
  "docs",
  "inbox",
  "inbox/attachments/email",
  "inbox/email",
  "issues-journal",
  "journal",
  "knowledge",
  "knowledge/areas",
  "knowledge/archive",
  "knowledge/decisions",
  "knowledge/projects",
  "knowledge/resources",
  "outbox/email/drafts",
  "scripts",
  "templates",
  "usernotes"
];

const requiredGitignoreFragments = [
  ".orbiter/",
  "inbox/*",
  "usernotes/*",
  "commands/inbox/*",
  "outbox/email/*",
  "issues-journal/*",
  "app/search-index.json",
  "*.pem",
  "*.key"
];

// Parses simple --flag value CLI arguments without adding a dependency.
function parseArgs(values) {
  const parsed = { _: [] };

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      parsed._.push(value);
      continue;
    }

    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }

  return parsed;
}

// Converts free text into a filesystem-safe slug for generated records.
function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "orbiter";
}

// Uses the local machine date for human-readable markdown filenames.
function localDate() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Produces local timestamp fields used by command and issue records.
function localTimestamp() {
  const now = new Date();
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return {
    iso: now.toISOString(),
    localDate: `${parts.year}-${parts.month}-${parts.day}`,
    localDateTime: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`,
    localTimeCompact: `${parts.hour}${parts.minute}${parts.second}`
  };
}

// Builds Orbiter's lightweight markdown frontmatter block.
function frontmatter(fields) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null && value !== "") {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---", "");
  return lines.join("\n");
}

// Records an individual check result for console, status JSON, and issue journaling.
function recordCheck(id, statusValue, summary, details = {}) {
  const check = {
    id,
    status: statusValue,
    summary,
    details
  };
  checks.push(check);
  return check;
}

async function exists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readText(targetPath) {
  try {
    return await readFile(targetPath, "utf8");
  } catch {
    return "";
  }
}

async function readJson(targetPath) {
  const text = await readFile(targetPath, "utf8");
  return JSON.parse(text);
}

// Keeps generated file names unique without overwriting user-created records.
async function uniqueFilePath(directory, filename) {
  const extension = path.extname(filename);
  const stem = path.basename(filename, extension);
  let candidate = path.join(directory, filename);
  let suffix = 2;

  while (await exists(candidate)) {
    candidate = path.join(directory, `${stem}-${suffix}${extension}`);
    suffix += 1;
  }

  return candidate;
}

// Parses the small frontmatter subset used by command markdown files.
function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (!match) {
    return {};
  }

  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return fields;
}

// Walks a directory tree and returns markdown files, skipping README placeholders.
async function walkMarkdown(directory) {
  const files = [];

  async function visit(current) {
    let entries = [];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(".md") && entry.name.toLowerCase() !== "readme.md") {
        files.push(entryPath);
      }
    }
  }

  await visit(directory);
  return files;
}

// Checks local folder invariants and creates missing folders in heal mode.
async function checkDirectories(heal) {
  const missing = [];

  for (const directory of requiredDirectories) {
    const absolute = path.join(workspace, directory);
    let directoryStat = null;
    try {
      directoryStat = await stat(absolute);
    } catch {
      // Missing directories are handled below.
    }

    if (!directoryStat?.isDirectory()) {
      missing.push(directory);
      if (heal) {
        await mkdir(absolute, { recursive: true });
      }
    }
  }

  if (!missing.length) {
    recordCheck("workspace-directories", "pass", "Required workspace directories exist.");
    return;
  }

  recordCheck(
    "workspace-directories",
    heal ? "healed" : "fail",
    heal ? "Created missing workspace directories." : "Required workspace directories are missing.",
    { missing }
  );
}

// Checks whether personal runtime and data folders are protected from Git commits.
async function checkGitignore() {
  const gitignore = await readText(path.join(workspace, ".gitignore"));
  const missing = requiredGitignoreFragments.filter((fragment) => !gitignore.includes(fragment));

  if (!missing.length) {
    recordCheck("gitignore-private-data", "pass", "Private runtime and user-data ignore rules are present.");
    return;
  }

  recordCheck("gitignore-private-data", "fail", "Private runtime or user-data ignore rules are missing.", { missing });
}

// Checks static UI assets that should be served before login.
async function checkStaticAssets() {
  const faviconExists = await exists(path.join(workspace, "app", "favicon.png"));
  recordCheck(
    "favicon-asset",
    faviconExists ? "pass" : "fail",
    faviconExists ? "Favicon asset exists." : "app/favicon.png is missing."
  );
}

// Calls an Orbiter endpoint with a timeout so a hung server is treated as unhealthy.
async function requestJson(pathname, timeoutMs = 3_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${pathname}`, { signal: controller.signal });
    const body = await response.json();
    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

// Starts the local backend in a known profile. The Cloudflare profile is the current home-production path.
async function startServer(profile) {
  await mkdir(orbiterDir, { recursive: true });
  const stdout = createWriteStream(path.join(orbiterDir, "self-heal-server.out"), { flags: "a" });
  const stderr = createWriteStream(path.join(orbiterDir, "self-heal-server.err"), { flags: "a" });
  const profileEnv = serverProfileEnv(profile);

  const child = spawn(process.execPath, ["scripts/server.mjs"], {
    cwd: workspace,
    detached: true,
    env: {
      ...process.env,
      ...profileEnv
    },
    stdio: ["ignore", stdout, stderr],
    windowsHide: true
  });
  child.unref();
}

function serverProfileEnv(profile) {
  if (profile === "prod") {
    return {
      HOST: "0.0.0.0",
      ORBITER_AUTH: "1",
      ORBITER_NETWORK_GUARD: "tailscale"
    };
  }

  if (profile === "local") {
    return {
      HOST: "127.0.0.1",
      ORBITER_NETWORK_GUARD: "off"
    };
  }

  return {
    HOST: "127.0.0.1",
    ORBITER_AUTH: "1",
    ORBITER_NETWORK_GUARD: "off",
    ORBITER_PUBLIC_ORIGIN: "https://example.com",
    ORBITER_ALLOWED_HOSTS: "example.com,www.example.com,orbiter.example.com,localhost,127.0.0.1",
    ORBITER_ALLOWED_ORIGINS: "https://example.com,https://www.example.com"
  };
}

async function waitForHealth(timeoutMs = 10_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await requestJson("/api/health", 1_500);
      if (result.ok && result.body?.ok) {
        return result;
      }
    } catch {
      // Retry until the timeout window closes.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

async function checkServerHealth(heal) {
  try {
    const result = await requestJson("/api/health");
    if (result.ok && result.body?.ok) {
      recordCheck("backend-health", "pass", "Backend health endpoint is responding.", {
        apiVersion: result.body.apiVersion,
        workspace: result.body.workspace
      });
      return;
    }
  } catch {
    // Heal mode gets a chance to restart below.
  }

  if (!heal) {
    recordCheck("backend-health", "fail", "Backend health endpoint is not responding.", { baseUrl });
    return;
  }

  const profile = String(options.profile ?? process.env.ORBITER_SELF_PROFILE ?? "cloudflare").toLowerCase();
  await startServer(profile);
  const result = await waitForHealth();
  recordCheck(
    "backend-health",
    result ? "healed" : "fail",
    result ? `Started backend with ${profile} profile.` : `Backend did not recover after starting ${profile} profile.`,
    { baseUrl, profile }
  );
}

// Checks generated itinerary state without treating missing travel data as a core failure.
async function checkTravelItinerary() {
  const itineraryPath = path.join(orbiterDir, "travel-itinerary.json");
  if (!await exists(itineraryPath)) {
    recordCheck("travel-itinerary", "warn", "Travel itinerary model has not been generated yet.");
    return;
  }

  try {
    const itinerary = await readJson(itineraryPath);
    const itemCount = Array.isArray(itinerary.items) ? itinerary.items.length : 0;
    recordCheck("travel-itinerary", "pass", "Travel itinerary model is valid JSON.", { itemCount });
  } catch (error) {
    recordCheck("travel-itinerary", "fail", "Travel itinerary model is not valid JSON.", { error: error.message });
  }
}

// Flags running Codex commands that look abandoned, but does not change their status automatically.
async function checkStaleCodexCommands() {
  const files = await walkMarkdown(commandsInboxDir);
  const staleHours = Number(process.env.ORBITER_STALE_CODEX_HOURS ?? 4);
  const cutoffMs = Date.now() - (Number.isFinite(staleHours) ? staleHours : 4) * 60 * 60 * 1000;
  const stale = [];

  for (const file of files) {
    const fields = parseFrontmatter(await readFile(file, "utf8"));
    if (String(fields.status ?? "").toLowerCase() !== "running") {
      continue;
    }

    const started = Date.parse(fields.codex_handoff_started || fields.created || "");
    if (!Number.isFinite(started) || started < cutoffMs) {
      stale.push({
        path: path.relative(workspace, file).replace(/\\/g, "/"),
        title: fields.title || path.basename(file, ".md"),
        handoffStarted: fields.codex_handoff_started || ""
      });
    }
  }

  recordCheck(
    "stale-codex-running",
    stale.length ? "warn" : "pass",
    stale.length ? "Some Codex commands have been running long enough to need review." : "No stale Codex running commands detected.",
    stale.length ? { stale } : {}
  );
}

// Runs the existing smoke test as the final verification gate in heal mode.
async function runSmokeCheck() {
  const result = await runNodeScript(["scripts/smoke.mjs"], {
    ORBITER_URL: baseUrl
  });
  recordCheck(
    "smoke-test",
    result.code === 0 ? "pass" : "fail",
    result.code === 0 ? "Smoke checks passed." : "Smoke checks failed.",
    {
      exitCode: result.code,
      output: result.output.slice(-3_000)
    }
  );
}

function runNodeScript(args, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: workspace,
      env: {
        ...process.env,
        ...extraEnv
      },
      windowsHide: true
    });
    let output = "";
    const timeout = setTimeout(() => {
      output += "\nProcess timed out.";
      child.kill();
    }, 45_000);

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, output });
    });
  });
}

// Writes one issue record per currently failing/warning check, avoiding duplicate records for the same check id.
async function writeIssueRecords() {
  await mkdir(issuesJournalDir, { recursive: true });
  const existing = (await walkMarkdown(issuesJournalDir)).length
    ? await Promise.all((await walkMarkdown(issuesJournalDir)).map(async (file) => readFile(file, "utf8")))
    : [];

  for (const check of checks.filter((item) => ["fail", "warn"].includes(item.status))) {
    const marker = `self_heal_check: ${check.id}`;
    if (existing.some((content) => content.includes(marker))) {
      continue;
    }

    const now = localTimestamp();
    const title = `Self-heal check needs attention: ${check.id}`;
    const filePath = await uniqueFilePath(issuesJournalDir, `${now.localDate}-self-heal-${slugify(check.id)}.md`);
    const content = `${frontmatter({
      title,
      type: "issue",
      status: "open",
      severity: check.status === "fail" ? "medium" : "low",
      created: now.iso,
      detected_by: "scripts/self-heal.mjs",
      related: "docs/ARCHITECTURE.md",
      self_heal_check: check.id
    })}

## Summary

Orbiter self-heal detected: ${check.summary}

## Impact

The affected subsystem may require review before Orbiter can be considered healthy.

## Evidence

\`\`\`json
${JSON.stringify(check.details, null, 2)}
\`\`\`

## Root Cause

Unknown until reviewed. This record was created automatically from a self-heal diagnostic check.

## Fix Options

### Option A

Pros:

- Use the self-heal script or a local repair when the fix is a safe filesystem or process invariant.

Cons:

- Does not cover product bugs or unsafe changes.

### Option B

Pros:

- Queue a Codex command so the fix is implemented and verified in the normal development loop.

Cons:

- Requires Codex review before resolution.

## Decision

Chosen fix:

Why:

## Resolution

Pending.

## Verification

Run \`npm run self:heal\` and \`npm run smoke\` after the fix.

## Follow Ups

- Decide whether this check should become a UI-visible system status item.
`;

    await writeFile(filePath, content, "utf8");
  }
}

// Saves the latest diagnostic report for future UI or automation surfaces.
async function writeStatusReport() {
  await mkdir(orbiterDir, { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    mode,
    baseUrl,
    summary: summarizeChecks(),
    checks
  };
  await writeFile(statusPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function summarizeChecks() {
  return checks.reduce((summary, check) => {
    summary[check.status] = (summary[check.status] ?? 0) + 1;
    return summary;
  }, {});
}

function printReport() {
  for (const check of checks) {
    console.log(`[${check.status}] ${check.id}: ${check.summary}`);
    if (Object.keys(check.details ?? {}).length) {
      console.log(JSON.stringify(check.details, null, 2));
    }
  }
  console.log(`Self-heal status written to ${path.relative(workspace, statusPath).replace(/\\/g, "/")}`);
}

async function runDiagnostics({ heal = false, smoke = false } = {}) {
  await checkDirectories(heal);
  await checkGitignore();
  await checkStaticAssets();
  await checkTravelItinerary();
  await checkStaleCodexCommands();
  await checkServerHealth(heal);
  if (smoke) {
    await runSmokeCheck();
  }
  if (heal || options["write-issues"]) {
    await writeIssueRecords();
  }
  await writeStatusReport();
  printReport();
}

// Queues upgrade work as a command rather than executing arbitrary code from the server.
async function queueUpgradeRequest() {
  const prompt = String(options.prompt ?? options._.join(" ")).trim();
  if (!prompt) {
    throw new Error('Usage: npm run self:upgrade -- --title "Title" --prompt "What Codex should improve"');
  }

  const now = localTimestamp();
  const title = String(options.title ?? prompt.slice(0, 80)).trim() || "Orbiter self-upgrade request";
  await mkdir(commandsInboxDir, { recursive: true });
  const filePath = await uniqueFilePath(commandsInboxDir, `${now.localDate}-${now.localTimeCompact}-${slugify(title)}.md`);
  const content = `${frontmatter({
    title,
    type: "command",
    status: "pending",
    tags: "command, codex, self-upgrade, orbiter-ops",
    created: now.iso,
    local_created: now.localDateTime,
    source: "orbiter-self-upgrade",
    skill_trigger: "self-upgrade"
  })}

# Command

${prompt}

# Execution Notes

- Status: pending
- Source: Orbiter self-upgrade lane
- Review this in the Commands tab before Codex handoff.
- Orbiter must not execute this directly from the browser or phone.
`;

  await writeFile(filePath, content, "utf8");
  console.log(`Queued ${path.relative(workspace, filePath).replace(/\\/g, "/")}`);
}

try {
  if (mode === "check") {
    await runDiagnostics({ heal: false, smoke: enabled(options.smoke) });
  } else if (mode === "heal") {
    await runDiagnostics({ heal: true, smoke: true });
  } else if (mode === "upgrade") {
    await queueUpgradeRequest();
  } else {
    console.log("Usage:");
    console.log("  node scripts/self-heal.mjs check [--smoke] [--write-issues] [--url http://127.0.0.1:4173]");
    console.log("  node scripts/self-heal.mjs heal [--profile cloudflare|prod|local] [--url http://127.0.0.1:4173]");
    console.log('  node scripts/self-heal.mjs upgrade --title "Title" --prompt "Prompt for Codex"');
  }

  if (checks.some((check) => check.status === "fail")) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

function enabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").toLowerCase());
}
