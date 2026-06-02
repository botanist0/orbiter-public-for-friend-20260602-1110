import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inboxDir = path.join(workspace, "inbox");
const usernotesDir = path.join(workspace, "usernotes");
const knowledgeDir = path.join(workspace, "knowledge");
const journalDir = path.join(workspace, "journal");
const issuesJournalDir = path.join(workspace, "issues-journal");
const skillsDir = path.join(workspace, "skills");
const appDir = path.join(workspace, "app");

const [, , command, ...args] = process.argv;

// Parses simple CLI flags into named options plus positional arguments.
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

// Converts titles into filesystem-safe filename fragments.
function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "note";
}

// Returns the local date used for new note filenames.
function today() {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));

  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Builds the standard frontmatter block for newly created notes.
function frontmatter(fields) {
  return [
    "---",
    `title: ${fields.title}`,
    `type: ${fields.type}`,
    `tags: ${fields.tags}`,
    `created: ${fields.created}`,
    "---",
    ""
  ].join("\n");
}

// Creates a markdown note in inbox/ from CLI arguments.
async function createNote(values) {
  const parsed = parseArgs(values);
  const title = parsed._.join(" ").trim();

  if (!title) {
    throw new Error('Usage: npm run note -- "Title" --tags work,idea --body "Text"');
  }

  await mkdir(inboxDir, { recursive: true });

  const created = new Date().toISOString();
  const filename = `${today()}-${slugify(title)}.md`;
  const filePath = path.join(inboxDir, filename);
  const tags = typeof parsed.tags === "string" ? parsed.tags : "inbox";
  const type = typeof parsed.type === "string" ? parsed.type : "note";
  const body = typeof parsed.body === "string" ? parsed.body : "";
  const content = `${frontmatter({ title, type, tags, created })}\n${body}\n`;

  await writeFile(filePath, content, "utf8");
  console.log(`Created ${path.relative(workspace, filePath)}`);
}

// Recursively lists markdown files under a directory.
async function walkMarkdown(dir) {
  const files = [];

  // Visits nested folders and records markdown file paths.
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
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(entryPath);
      }
    }
  }

  await visit(dir);
  return files;
}

// Parses Orbiter's lightweight frontmatter format from a markdown string.
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
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    fields[key] = value;
  }

  return {
    fields,
    body: markdown.slice(match[0].length).trim()
  };
}

// Normalizes comma-separated frontmatter tags into an array.
function splitTags(value) {
  return String(value)
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

// Derives a readable title when a markdown file does not declare one.
function titleFromFile(filePath) {
  return path
    .basename(filePath, ".md")
    .replace(/^\d{4}-\d{2}-\d{2}-/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

// Extracts Obsidian-style wiki links used for backlink generation.
function extractWikiLinks(markdown) {
  const links = [];
  const pattern = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  let match = pattern.exec(markdown);

  while (match) {
    links.push(match[1].trim());
    match = pattern.exec(markdown);
  }

  return links;
}

// Extracts markdown links that point to other markdown files.
function extractMarkdownLinks(markdown) {
  const links = [];
  const pattern = /\[[^\]]+\]\(([^)]+\.md(?:#[^)]+)?)\)/g;
  let match = pattern.exec(markdown);

  while (match) {
    links.push(decodeURIComponent(match[1].split("#")[0]).replace(/\\/g, "/"));
    match = pattern.exec(markdown);
  }

  return links;
}

// Produces a comparable lowercase title key.
function normalizeTitle(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Pulls useful words from a title for related-note scoring.
function titleTokens(value) {
  return normalizeTitle(value)
    .split(" ")
    .filter((token) => token.length > 3);
}

// Produces a short preview of a note body for search/index output.
function excerpt(body) {
  return body.replace(/\s+/g, " ").trim().slice(0, 220);
}

// Builds the searchable text field for a note record.
function noteText(note) {
  return [note.title, note.type, note.path, note.body, ...note.tags].join(" ").toLowerCase();
}

// Populates backlinks and related-note suggestions for indexed notes.
function buildRelationships(notes) {
  const byTitle = new Map(notes.map((note) => [normalizeTitle(note.title), note]));
  const byPath = new Map(notes.map((note) => [note.path.replace(/\\/g, "/"), note]));

  for (const note of notes) {
    note.backlinks = [];
    note.relatedNotes = [];
  }

  for (const note of notes) {
    const targets = [
      ...note.outgoingLinks.map((link) => byTitle.get(normalizeTitle(link))),
      ...note.outgoingPaths.map((linkPath) => byPath.get(linkPath))
    ].filter(Boolean);

    for (const target of targets) {
      if (target.id !== note.id && !target.backlinks.includes(note.title)) {
        target.backlinks.push(note.title);
      }
    }
  }

  for (const note of notes) {
    const tags = new Set(note.tags);
    const tokens = new Set(titleTokens(note.title));
    const related = [];

    for (const other of notes) {
      if (other.id === note.id) {
        continue;
      }

      const sharedTagCount = other.tags.filter((tag) => tags.has(tag)).length;
      const sharedTitleCount = titleTokens(other.title).filter((token) => tokens.has(token)).length;
      const explicitLink = note.outgoingLinks.some((link) => normalizeTitle(link) === normalizeTitle(other.title));
      const score = sharedTagCount * 3 + sharedTitleCount + (explicitLink ? 5 : 0);

      if (score > 0) {
        related.push({ title: other.title, path: other.path, score });
      }
    }

    note.relatedNotes = related
      .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
      .slice(0, 5)
      .map(({ title, path: relatedPath }) => ({ title, path: relatedPath }));
  }

  return notes;
}

// Builds app/search-index.json from the markdown workspace for static/debug use.
async function buildIndex() {
  const files = [
    ...await walkMarkdown(usernotesDir),
    ...await walkMarkdown(inboxDir),
    ...await walkMarkdown(knowledgeDir),
    ...await walkMarkdown(journalDir),
    ...await walkMarkdown(issuesJournalDir)
  ].filter((file) => path.basename(file).toLowerCase() !== "readme.md");

  const notes = [];

  for (const file of files) {
    const markdown = await readFile(file, "utf8");
    const { fields, body } = parseFrontmatter(markdown);
    const relativePath = path.relative(workspace, file).replace(/\\/g, "/");
    const title = fields.title || titleFromFile(file);

    notes.push({
      id: slugify(relativePath),
      path: relativePath,
      title,
      type: fields.type || "note",
      tags: splitTags(fields.tags || path.dirname(relativePath).replace(/\\/g, "/")),
      createdAt: fields.created || fields.date || "",
      excerpt: excerpt(body),
      body,
      outgoingLinks: extractWikiLinks(markdown),
      outgoingPaths: extractMarkdownLinks(markdown),
      backlinks: [],
      relatedNotes: [],
      searchText: ""
    });
  }

  buildRelationships(notes);

  for (const note of notes) {
    note.searchText = noteText(note);
  }

  await mkdir(appDir, { recursive: true });
  const index = {
    generatedAt: new Date().toISOString(),
    noteCount: notes.length,
    notes
  };
  const outputPath = path.join(appDir, "search-index.json");
  await writeFile(outputPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  console.log(`Indexed ${notes.length} notes into ${path.relative(workspace, outputPath)}`);
}

// Searches raw markdown files from the CLI and prints matching file summaries.
async function search(values) {
  const query = values.join(" ").trim().toLowerCase();

  if (!query) {
    throw new Error('Usage: npm run search -- "query"');
  }

  const files = [...await walkMarkdown(usernotesDir), ...await walkMarkdown(inboxDir), ...await walkMarkdown(knowledgeDir), ...await walkMarkdown(journalDir), ...await walkMarkdown(issuesJournalDir)];
  const matches = [];

  for (const file of files) {
    const content = await readFile(file, "utf8");
    if (content.toLowerCase().includes(query)) {
      const firstLine = content.split(/\r?\n/).find((line) => line.trim() && !line.startsWith("---")) ?? "";
      matches.push(`${path.relative(workspace, file)} - ${firstLine}`);
    }
  }

  if (!matches.length) {
    console.log("No matches.");
    return;
  }

  console.log(matches.join("\n"));
}

// Lists skill folder names so the user can see installed Orbiter workflows.
async function listSkills() {
  const entries = await readdir(skillsDir, { withFileTypes: true });
  const names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  console.log(names.join("\n"));
}

// Dispatches the requested CLI command and reports usage/errors consistently.
try {
  if (command === "note") {
    await createNote(args);
  } else if (command === "index") {
    await buildIndex();
  } else if (command === "search") {
    await search(args);
  } else if (command === "skills") {
    await listSkills();
  } else {
    console.log("Usage: node scripts/orbiter.mjs <index|note|search|skills>");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
