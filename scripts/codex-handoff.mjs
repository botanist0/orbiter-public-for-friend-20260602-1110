import {
  claimNextCodexCommand,
  formatCodexHandoff,
  readCodexCommands,
  updateCodexCommandStatus
} from "./codex-handoff-core.mjs";

const [, , action = "next", ...rawArgs] = process.argv;

// Parses simple --flag value CLI arguments without adding a dependency.
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

// Claims the oldest reviewed command and prints it for this Codex thread.
async function nextCommand() {
  const status = String(options.status || "reviewed").toLowerCase();
  const command = await claimNextCodexCommand({
    path: options.path || "",
    status,
    noClaim: Boolean(options["no-claim"])
  });

  if (!command) {
    console.log(`No ${status} commands ready for Codex handoff.`);
    return;
  }

  console.log(formatCodexHandoff(command));
}

// Lists commands in a compact one-line form for bridge diagnostics.
async function listCommands() {
  const status = String(options.status || "reviewed").toLowerCase();
  const commands = (await readCodexCommands()).filter((item) => status === "all" || item.status.toLowerCase() === status);
  if (!commands.length) {
    console.log(`No ${status} commands found.`);
    return;
  }

  for (const command of commands) {
    console.log(`${command.status}\t${command.created}\t${command.path}\t${command.title}`);
  }
}

if (action === "next") {
  await nextCommand();
} else if (action === "list") {
  await listCommands();
} else if (action === "done") {
  const updated = await updateCodexCommandStatus(options.path, "done");
  console.log(`Marked done: ${updated}`);
} else if (action === "reject") {
  const updated = await updateCodexCommandStatus(options.path, "rejected");
  console.log(`Marked rejected: ${updated}`);
} else if (action === "reviewed") {
  const updated = await updateCodexCommandStatus(options.path, "reviewed");
  console.log(`Marked reviewed: ${updated}`);
} else {
  console.log("Usage:");
  console.log("  npm run codex:next");
  console.log("  npm run codex:list");
  console.log("  npm run codex:done -- --path commands/inbox/example.md");
  console.log("  npm run codex:reject -- --path commands/inbox/example.md");
}
