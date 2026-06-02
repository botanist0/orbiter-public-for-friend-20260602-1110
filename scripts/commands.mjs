import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const commandsDir = path.join(workspace, "commands");
const statusFilter = String(process.argv[2] ?? "pending").toLowerCase();

// Parses command markdown frontmatter into metadata fields and body text.
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

// Builds a readable fallback title from a command filename.
function titleFromFile(filePath) {
  return path
    .basename(filePath, ".md")
    .replace(/^\d{4}-\d{2}-\d{2}-/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

// Pulls the prompt text out of the # Command section.
function extractCommand(body) {
  const match = body.match(/# Command\s+([\s\S]*?)(?:\n# |$)/);
  return (match?.[1] ?? body).trim();
}

// Recursively finds command markdown files, ignoring README docs.
async function walkMarkdown(dir) {
  const files = [];

  // Visits nested command folders and records markdown files.
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

// Load every command record before applying the requested status filter.
const files = await walkMarkdown(commandsDir);
const commands = [];

for (const file of files) {
  const markdown = await readFile(file, "utf8");
  const { fields, body } = parseFrontmatter(markdown);
  commands.push({
    path: path.relative(workspace, file).replace(/\\/g, "/"),
    title: fields.title || titleFromFile(file),
    status: fields.status || "pending",
    skill: fields.skill_trigger || "",
    source: fields.source || "",
    created: fields.local_created || fields.created || "",
    command: extractCommand(body)
  });
}

// Show pending commands by default, or all/status-specific commands when requested.
const visible = commands
  .filter((command) => statusFilter === "all" || command.status.toLowerCase() === statusFilter)
  .sort((left, right) => String(right.created).localeCompare(String(left.created)) || left.title.localeCompare(right.title));

if (!visible.length) {
  console.log(`No ${statusFilter === "all" ? "" : `${statusFilter} `}commands found.`);
  process.exit(0);
}

// Print each command in a copy-friendly block for Codex/manual review.
for (const command of visible) {
  console.log(`[${command.status}] ${command.title}`);
  console.log(`path: ${command.path}`);
  if (command.created) {
    console.log(`created: ${command.created}`);
  }
  if (command.skill) {
    console.log(`skill: ${command.skill}`);
  }
  if (command.source) {
    console.log(`source: ${command.source}`);
  }
  console.log("command:");
  console.log(command.command);
  console.log("");
}
