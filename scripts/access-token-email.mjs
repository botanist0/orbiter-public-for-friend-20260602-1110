import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEmailDraft } from "./email-draft-core.mjs";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const accessAdminPath = path.join(workspace, ".orbiter", "access-admin-only.json");
const [, , command = "draft", ...args] = process.argv;

// Parses simple CLI flags for the one-off access-token draft workflow.
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

// Reads the admin-only text file and returns the token on the line after the name.
async function accessTokenForName(name) {
  const target = String(name ?? "").trim().toLowerCase();
  if (!target) {
    throw new Error("Access-token recipient name is required.");
  }

  const lines = (await readFile(accessAdminPath, "utf8"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const index = lines.findIndex((line) => line.toLowerCase() === target);
  const token = index === -1 ? "" : lines[index + 1] ?? "";

  if (!token.startsWith("orb_")) {
    throw new Error(`Could not find an Orbiter access token for ${name}.`);
  }
  return token;
}

// Builds the warm but explicit message that will be sent after review.
function accessEmailBody({ name, token }) {
  const publicOrigin = String(process.env.ORBITER_PUBLIC_ORIGIN || "https://your-orbiter.example").replace(/\/$/, "");
  return `## Orbiter access is online

Hi ${name},

This is Orbit. I was asked by the Orbiter owner to deliver your personal access details.

Your secret access token is ready to use at ${publicOrigin}:

**${token}**

What to do:

- Open ${publicOrigin}
- Paste the access token when Orbiter asks for it
- Keep this token private

You now have your own doorway into Orbiter.

- Orbit, sent automatically on the owner's behalf`;
}

// Creates the local draft and prints only metadata, never the token.
async function draft(values) {
  const options = parseArgs(values);
  const name = String(options.name || options._[0] || "").trim();
  const to = String(options.to || "").trim();
  if (!name || !to) {
    throw new Error("Usage: node scripts/access-token-email.mjs draft --name <recipient-name> --to <recipient@example.com>");
  }
  const token = await accessTokenForName(name);
  const created = await createEmailDraft({
    account: options.account || "gmail-primary",
    to,
    subject: options.subject || "Your Orbiter access is ready",
    body: accessEmailBody({ name, token })
  });

  console.log(`Created access email draft: ${created.path}`);
  console.log(`From: ${created.from}`);
  console.log(`To: ${created.to.join(", ")}`);
  console.log(`Subject: ${created.subject}`);
  console.log("Status: draft-only; token included in the local draft.");
}

try {
  if (command === "draft") {
    await draft(args);
  } else {
    console.log("Usage: node scripts/access-token-email.mjs draft --name <recipient-name> --to <recipient@example.com>");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
