import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const queuePath = path.join(workspace, "outbox", "email", "drip", "travel-planning-gaps.json");
const [, , command = "next"] = process.argv;

// Produces an operator-visible timestamp for drip queue audit fields.
function nowIso() {
  return new Date().toISOString();
}

// Reads the staged email queue used by the travel-planning drip sender.
async function readQueue() {
  const raw = await readFile(queuePath, "utf8");
  return JSON.parse(raw.replace(/^\uFEFF/, ""));
}

// Saves drip queue status after each send attempt so retries are explicit.
async function writeQueue(queue) {
  await mkdir(path.dirname(queuePath), { recursive: true });
  await writeFile(queuePath, `${JSON.stringify(queue, null, 2)}\n`, "utf8");
}

// Runs an Orbiter npm script without invoking a shell, keeping arguments stable.
function npmRun(script, args = []) {
  return execFileSync("npm", ["run", script, "--", ...args], {
    cwd: workspace,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

// Sends one ready draft and only marks its command done after SMTP send succeeds.
async function sendNext() {
  const queue = await readQueue();
  const item = (queue.items ?? []).find((entry) => entry.status === "ready");

  if (!item) {
    queue.completedAt = queue.completedAt || nowIso();
    await writeQueue(queue);
    console.log("No ready travel planning gap email drafts remain.");
    return;
  }

  item.status = "sending";
  item.startedAt = nowIso();
  await writeQueue(queue);

  try {
    const sendOutput = npmRun("email:send", ["--path", item.draftPath, "--confirm-send", "SEND"]);
    item.status = "sent";
    item.sentAt = nowIso();
    item.sendOutput = sendOutput.trim();

    if (item.commandPath) {
      const doneOutput = npmRun("codex:done", ["--path", item.commandPath]);
      item.doneAt = nowIso();
      item.doneOutput = doneOutput.trim();
    }

    await writeQueue(queue);
    console.log(`Sent travel planning gap email: ${item.title}`);
  } catch (error) {
    item.status = "ready";
    item.lastErrorAt = nowIso();
    item.lastError = error.stderr?.toString().trim() || error.message;
    await writeQueue(queue);
    throw error;
  }
}

try {
  if (command === "next") {
    await sendNext();
  } else if (command === "status") {
    const queue = await readQueue();
    for (const item of queue.items ?? []) {
      console.log(`${item.status}\t${item.draftPath}\t${item.title}`);
    }
  } else {
    console.log("Usage: node scripts/email-drip.mjs next|status");
  }
} catch (error) {
  console.error(error.stderr?.toString().trim() || error.message);
  process.exitCode = 1;
}
