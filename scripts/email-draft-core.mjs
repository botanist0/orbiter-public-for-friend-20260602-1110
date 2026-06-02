import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(workspace, ".orbiter", "email-config.json");

// Converts user-facing labels into safe filename and tag fragments.
function slugify(value, fallback = "draft") {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || fallback;
}

// Escapes one-line frontmatter values while keeping draft files readable.
function frontmatterValue(value) {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/"/g, '\\"')
    .trim();
}

// Serializes simple frontmatter for email draft markdown records.
function frontmatter(fields) {
  return `---\n${Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}: ${frontmatterValue(value)}`)
    .join("\n")}\n---\n`;
}

// Extracts local date/time metadata so draft filenames sort chronologically.
function localStamp(date = new Date()) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  const localTime = `${parts.hour}:${parts.minute}:${parts.second}`;

  return {
    iso: date.toISOString(),
    localDate,
    localTime,
    localDateTime: `${localDate}T${localTime}`,
    timeZone
  };
}

// Chooses a non-conflicting draft filename without overwriting earlier drafts.
async function uniqueFilePath(dir, filename) {
  const extension = path.extname(filename);
  const base = path.basename(filename, extension);
  let candidate = path.join(dir, filename);
  let counter = 2;

  while (true) {
    try {
      await stat(candidate);
      candidate = path.join(dir, `${base}-${counter}${extension}`);
      counter += 1;
    } catch {
      return candidate;
    }
  }
}

// Splits recipient lists on commas or semicolons and trims empty entries.
export function parseRecipients(value) {
  if (Array.isArray(value)) {
    return value.flatMap(parseRecipients);
  }

  return String(value ?? "")
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

// Uses a conservative address check so obvious typos fail before a draft is created.
function assertRecipients(label, recipients, required = false) {
  if (required && !recipients.length) {
    throw Object.assign(new Error(`${label} is required.`), { statusCode: 400 });
  }

  const invalid = recipients.find((recipient) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient));
  if (invalid) {
    throw Object.assign(new Error(`Invalid ${label} address: ${invalid}`), { statusCode: 400 });
  }
}

// Reads Orbiter's private email account configuration.
export async function readEmailConfig() {
  try {
    return JSON.parse((await readFile(configPath, "utf8")).replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw Object.assign(new Error("Missing .orbiter/email-config.json. Run email setup first."), { statusCode: 500 });
    }
    throw error;
  }
}

// Finds the configured account used as the outbound identity.
export async function findEmailAccount(accountId = "gmail-primary") {
  const config = await readEmailConfig();
  const requested = String(accountId || "gmail-primary").trim();
  const account = (config.accounts ?? []).find((item) => item.id === requested || item.address === requested);

  if (!account) {
    throw Object.assign(new Error(`Email account not configured: ${requested}`), { statusCode: 400 });
  }
  if (account.send?.mode !== "draft-only") {
    throw Object.assign(new Error(`Email account ${account.id} is not in draft-only send mode.`), { statusCode: 400 });
  }
  if (account.send?.enabled !== true) {
    throw Object.assign(new Error(`Draft creation is disabled for ${account.id}. Enable account.send.enabled first.`), { statusCode: 400 });
  }

  return account;
}

// Creates a local outbound email draft record without connecting to SMTP or sending mail.
export async function createEmailDraft(input = {}, actor = null) {
  const account = await findEmailAccount(input.account || input.accountId || "gmail-primary");
  const to = parseRecipients(input.to);
  const cc = parseRecipients(input.cc);
  const bcc = parseRecipients(input.bcc);
  assertRecipients("to", to, true);
  assertRecipients("cc", cc);
  assertRecipients("bcc", bcc);

  const subject = String(input.subject ?? "").trim();
  if (!subject) {
    throw Object.assign(new Error("Subject is required."), { statusCode: 400 });
  }

  const body = String(input.body ?? "").trim();
  const now = localStamp();
  const draftDir = path.resolve(workspace, account.send.draftFolder || `outbox/email/drafts/${account.id}`);
  const from = account.address || account.username;
  const title = `Email draft to ${to.join(", ")} - ${subject}`;
  const fileName = `${now.localDate}-${now.localTime.replace(/:/g, "")}-${slugify(subject, "email-draft")}.md`;
  const filePath = await uniqueFilePath(draftDir, fileName);

  await mkdir(draftDir, { recursive: true });
  const markdown = `${frontmatter({
    title,
    type: "email-draft",
    status: "draft",
    tags: `email, draft, outbound, account-${account.id}`,
    created: now.iso,
    local_created: `${now.localDateTime} ${now.timeZone}`,
    account: account.id,
    from,
    to: to.join(", "),
    cc: cc.join(", "),
    bcc: bcc.join(", "),
    subject,
    owner: actor?.id,
    owner_name: actor?.name
  })}

# Draft

From: ${from}
To: ${to.join(", ")}
${cc.length ? `Cc: ${cc.join(", ")}\n` : ""}${bcc.length ? `Bcc: ${bcc.join(", ")}\n` : ""}Subject: ${subject}

# Body

${body}

# Send Safety

- Status: draft-only.
- Orbiter has not sent this email.
- Review this draft before any future SMTP send confirmation.
`;

  await writeFile(filePath, markdown, "utf8");

  return {
    path: path.relative(workspace, filePath).replace(/\\/g, "/"),
    account: account.id,
    from,
    to,
    cc,
    bcc,
    subject,
    status: "draft",
    createdAt: now.iso
  };
}
