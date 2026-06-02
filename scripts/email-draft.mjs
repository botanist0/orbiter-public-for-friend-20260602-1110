import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEmailDraft } from "./email-draft-core.mjs";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [, , command = "draft", ...args] = process.argv;

// Parses simple CLI flags into named options for draft creation.
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

// Reads body text either from --body, --body-file, or piped stdin.
async function bodyText(options) {
  if (options.body) {
    return String(options.body);
  }
  if (options["body-file"]) {
    return readFile(path.resolve(workspace, String(options["body-file"])), "utf8");
  }
  if (!process.stdin.isTTY) {
    let input = "";
    for await (const chunk of process.stdin) {
      input += chunk;
    }
    return input;
  }
  return "";
}

// Creates a draft and prints a compact handoff for the caller.
async function draft(values) {
  const options = parseArgs(values);
  const created = await createEmailDraft({
    account: options.account || options.fromAccount || "gmail-primary",
    to: options.to || options._[0],
    cc: options.cc,
    bcc: options.bcc,
    subject: options.subject || options._[1],
    body: await bodyText(options)
  });

  console.log(`Created email draft: ${created.path}`);
  console.log(`From: ${created.from}`);
  console.log(`To: ${created.to.join(", ")}`);
  console.log(`Subject: ${created.subject}`);
  console.log("Status: draft-only; not sent.");
}

try {
  if (command === "draft") {
    await draft(args);
  } else {
    console.log("Usage: node scripts/email-draft.mjs draft --account gmail-primary --to person@example.com --subject \"Subject\" --body \"Body\"");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
