import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const commandsDir = path.join(workspace, "commands");

// Converts a markdown file's frontmatter into structured metadata and body text.
function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (!match) {
    return { fields: {}, body: markdown.trim() };
  }

  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }

  return {
    fields,
    body: markdown.slice(match[0].length).trim()
  };
}

// Serializes frontmatter back into Orbiter's simple markdown metadata format.
function frontmatter(fields) {
  return `---\n${Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}: ${String(value).replace(/\r?\n/g, " ").trim()}`)
    .join("\n")}\n---\n`;
}

// Rewrites frontmatter fields while keeping the command body unchanged.
function updateMarkdownFrontmatter(markdown, updates) {
  const { fields, body } = parseFrontmatter(markdown);
  return `${frontmatter({ ...fields, ...updates })}\n${body.trim()}\n`;
}

// Builds a readable fallback title from a markdown filename.
function titleFromFile(filePath) {
  return path
    .basename(filePath, ".md")
    .replace(/^\d{4}-\d{2}-\d{2}-/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

// Pulls the Codex prompt out of the # Command section.
function extractCommand(body) {
  const match = body.match(/# Command\s+([\s\S]*?)(?:\n# |$)/);
  return (match?.[1] ?? body).trim();
}

// Finds command markdown files under the command workspace.
async function walkMarkdown(dir) {
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

  await visit(dir);
  return files;
}

// Validates that a workspace-relative command path stays inside commands/.
function resolveCommandPath(relativePath) {
  const normalized = String(relativePath ?? "").replace(/\\/g, "/");
  if (!normalized.endsWith(".md") || normalized.includes("..")) {
    throw Object.assign(new Error("Command path must be a workspace-relative markdown file."), { statusCode: 400 });
  }
  if (path.basename(normalized).toLowerCase() === "readme.md") {
    throw Object.assign(new Error("Command path cannot be a README file."), { statusCode: 400 });
  }

  const filePath = path.resolve(workspace, normalized);
  const root = path.resolve(commandsDir);
  if (!filePath.startsWith(`${root}${path.sep}`)) {
    throw Object.assign(new Error("Command path is outside commands/."), { statusCode: 403 });
  }
  return filePath;
}

// Shapes a parsed markdown command into the record used by CLI and browser handoff.
function commandRecord(file, markdown) {
  const { fields, body } = parseFrontmatter(markdown);
  return {
    file,
    markdown,
    path: path.relative(workspace, file).replace(/\\/g, "/"),
    title: fields.title || titleFromFile(file),
    status: fields.status || "pending",
    skill: fields.skill_trigger || "",
    source: fields.source || "",
    owner: fields.owner_name || fields.owner || "",
    created: fields.local_created || fields.created || "",
    handoffStarted: fields.codex_handoff_started || "",
    command: extractCommand(body)
  };
}

// Loads command records for status filtering and handoff.
export async function readCodexCommands() {
  const commands = [];
  for (const file of await walkMarkdown(commandsDir)) {
    const markdown = await readFile(file, "utf8");
    const { fields } = parseFrontmatter(markdown);
    if ((fields.type || "command") !== "command") {
      continue;
    }
    commands.push(commandRecord(file, markdown));
  }

  return commands.sort((left, right) => String(left.created).localeCompare(String(right.created)) || left.title.localeCompare(right.title));
}

// Loads one command record by workspace-relative path.
export async function readCodexCommandAt(relativePath) {
  const file = resolveCommandPath(relativePath);
  const markdown = await readFile(file, "utf8");
  const { fields } = parseFrontmatter(markdown);
  if ((fields.type || "command") !== "command") {
    throw Object.assign(new Error("File is not a command."), { statusCode: 400 });
  }
  return commandRecord(file, markdown);
}

// Marks a command as claimed by Codex so it is not handed off repeatedly.
export async function claimCodexCommand(command, actor = null) {
  const now = new Date().toISOString();
  await writeFile(command.file, updateMarkdownFrontmatter(command.markdown, {
    status: "running",
    codex_handoff_started: now,
    codex_handoff_target: "codex-thread",
    codex_handoff_actor: actor?.id,
    codex_handoff_actor_name: actor?.name
  }), "utf8");
  return { ...command, status: "running", handoffStarted: now };
}

// Claims the oldest reviewed command or a specific reviewed command path.
export async function claimNextCodexCommand({ path: relativePath = "", status = "reviewed", noClaim = false, actor = null } = {}) {
  const expectedStatus = String(status || "reviewed").toLowerCase();
  const command = relativePath
    ? await readCodexCommandAt(relativePath)
    : (await readCodexCommands()).find((item) => item.status.toLowerCase() === expectedStatus);

  if (!command) {
    return null;
  }

  if (command.status.toLowerCase() !== expectedStatus) {
    throw Object.assign(new Error(`Command is ${command.status}, not ${expectedStatus}: ${command.path}`), { statusCode: 409 });
  }

  return noClaim ? command : claimCodexCommand(command, actor);
}

// Updates a command status after Codex finishes or rejects work.
export async function updateCodexCommandStatus(relativePath, status) {
  const allowed = new Set(["reviewed", "running", "done", "rejected"]);
  if (!allowed.has(status)) {
    throw Object.assign(new Error(`Unsupported status: ${status}`), { statusCode: 400 });
  }

  const filePath = resolveCommandPath(relativePath);
  await stat(filePath);
  const markdown = await readFile(filePath, "utf8");
  const { fields } = parseFrontmatter(markdown);
  const timestamp = new Date().toISOString();
  const updates = { status };

  if (status === "done") {
    updates.codex_completed = timestamp;
  } else if (status === "rejected") {
    updates.codex_rejected = timestamp;
  } else if (status === "reviewed") {
    updates.codex_reviewed = timestamp;
    updates.codex_updated = timestamp;
    if (String(fields.status || "").toLowerCase() === "running") {
      updates.codex_requeued = timestamp;
    }
  } else {
    updates.codex_updated = timestamp;
  }

  await writeFile(filePath, updateMarkdownFrontmatter(markdown, updates), "utf8");
  return path.relative(workspace, filePath).replace(/\\/g, "/");
}

// Formats a handoff in the exact shape Codex should treat as the delegated prompt.
export function formatCodexHandoff(command) {
  const lines = [
    "ORBITER_CODEX_HANDOFF",
    `path: ${command.path}`,
    `status: ${command.status}`,
    `title: ${command.title}`
  ];

  if (command.created) {
    lines.push(`created: ${command.created}`);
  }
  if (command.skill) {
    lines.push(`skill: ${command.skill}`);
  }
  if (command.source) {
    lines.push(`source: ${command.source}`);
  }
  if (command.owner) {
    lines.push(`owner: ${command.owner}`);
  }

  lines.push("", "PROMPT_FOR_CODEX:", command.command);
  return lines.join("\n");
}
