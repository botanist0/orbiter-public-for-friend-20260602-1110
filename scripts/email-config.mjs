import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const orbiterDir = path.join(workspace, ".orbiter");
const emailConfigPath = path.join(orbiterDir, "email-config.json");
const [, , command = "validate", ...args] = process.argv;

// Parses simple CLI flags into named options for setup and validation commands.
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

// Converts an email address or label into a stable account id.
function accountId(value, fallback = "gmail") {
  return String(value ?? fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || fallback;
}

// Produces one Gmail account config without storing any password or app password.
function gmailAccount(address, options = {}) {
  const cleanAddress = String(address ?? "").trim();
  const credentialName = cleanAddress ? `Orbiter/Gmail/${cleanAddress}` : "Orbiter/Gmail/<email-address>";
  const id = options.id || `gmail-${accountId(options.label || cleanAddress)}`;
  const label = options.label || "Gmail";

  return {
    id,
    provider: "gmail",
    label,
    address: cleanAddress,
    username: cleanAddress,
    credentialRef: {
      type: "pending",
      name: credentialName,
      note: "Create a Gmail app password in Google Account settings, then store it locally. Do not put it in this JSON file."
    },
    receive: {
      enabled: true,
      protocol: "imap",
      host: "imap.gmail.com",
      port: 993,
      secure: true,
      mailbox: options.mailbox || "INBOX",
      pollingIntervalSeconds: 300,
      fetchLimit: Number(options.fetchLimit ?? 25),
      markSeen: false
    },
    send: {
      mode: "draft-only",
      enabled: false,
      protocol: "smtp",
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      draftFolder: `outbox/email/drafts/${id}`,
      sentFolder: "journal/email-sent"
    },
    storage: {
      inboxFolder: `inbox/email/${id}`,
      attachmentsFolder: `inbox/attachments/email/${id}`,
      syncJournalFolder: "journal/email-sync"
    },
    safety: {
      maxAttachmentBytes: 26214400,
      dryRun: true,
      requireSendConfirmation: true
    }
  };
}

// Produces the Gmail MVP configuration without storing any password or app password.
function gmailConfig(address) {
  return {
    version: 1,
    accounts: [gmailAccount(address, { id: "gmail-primary", label: "Gmail" })]
  };
}

// Writes the private local config file after the user provides a Gmail address.
async function setup(values) {
  const parsed = parseArgs(values);
  const address = String(parsed.address ?? parsed.email ?? parsed._[0] ?? "").trim();

  if (!address || !address.includes("@")) {
    throw new Error('Usage: npm run email:setup -- --address "your.address@gmail.com"');
  }

  await mkdir(orbiterDir, { recursive: true });
  await writeFile(emailConfigPath, `${JSON.stringify(gmailConfig(address), null, 2)}\n`, "utf8");
  console.log(`Wrote ${path.relative(workspace, emailConfigPath)}`);
  console.log("No password was stored. Generate a Gmail app password and store it locally in the next credential step.");
}

// Adds a second Gmail account to the existing private config.
async function addGmail(values) {
  const parsed = parseArgs(values);
  const address = String(parsed.address ?? parsed.email ?? parsed._[0] ?? "").trim();
  const label = String(parsed.label ?? "Travel Gmail").trim();

  if (!address || !address.includes("@")) {
    throw new Error('Usage: npm run email:add -- --address "travel.address@gmail.com" --label "Travel Gmail"');
  }

  const config = await readConfig();
  config.accounts ??= [];

  if (config.accounts.some((account) => account.address.toLowerCase() === address.toLowerCase())) {
    throw new Error(`${address} is already configured.`);
  }

  const id = parsed.id ? accountId(parsed.id) : `gmail-${accountId(label || address)}`;
  if (config.accounts.some((account) => account.id === id)) {
    throw new Error(`Account id already exists: ${id}. Pass --id with a unique value.`);
  }

  config.accounts.push(gmailAccount(address, {
    id,
    label,
    mailbox: parsed.mailbox,
    fetchLimit: parsed["fetch-limit"] ?? parsed.fetchLimit
  }));

  await writeFile(emailConfigPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  console.log(`Added ${address} as ${id}`);
  console.log("Next: npm run email:secret:gui -- --account " + id);
}

// Reads and parses the private email config from .orbiter/.
async function readConfig() {
  try {
    return JSON.parse((await readFile(emailConfigPath, "utf8")).replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error('Missing .orbiter/email-config.json. Run: npm run email:setup -- --address "your.address@gmail.com"');
    }
    throw new Error(`Could not read email config: ${error.message}`);
  }
}

// Validates the config shape needed before implementing IMAP ingest.
function validateConfig(config) {
  const problems = [];
  if (config.version !== 1) {
    problems.push("version must be 1.");
  }
  if (!Array.isArray(config.accounts) || !config.accounts.length) {
    problems.push("accounts must contain at least one account.");
  }

  for (const account of config.accounts ?? []) {
    if (account.provider !== "gmail") {
      problems.push(`${account.id ?? "account"} provider must be gmail for the current MVP.`);
    }
    if (!account.address || !account.address.includes("@")) {
      problems.push(`${account.id ?? "account"} address is required.`);
    }
    if (!account.username || !account.username.includes("@")) {
      problems.push(`${account.id ?? "account"} username is required.`);
    }
    if (account.receive?.host !== "imap.gmail.com" || account.receive?.port !== 993 || account.receive?.secure !== true) {
      problems.push(`${account.id ?? "account"} receive settings must use Gmail IMAP over TLS on port 993.`);
    }
    if (account.send?.mode !== "draft-only") {
      problems.push(`${account.id ?? "account"} send.mode must be draft-only for this MVP.`);
    }
    if (!account.storage?.inboxFolder || !account.storage?.attachmentsFolder) {
      problems.push(`${account.id ?? "account"} storage folders are required.`);
    }
  }

  return problems;
}

// Validates the current private config and reports the next safe setup step.
async function validate() {
  const config = await readConfig();
  const problems = validateConfig(config);

  if (problems.length) {
    for (const problem of problems) {
      console.error(`error: ${problem}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`ok email config with ${config.accounts.length} account${config.accounts.length === 1 ? "" : "s"}`);
  for (const account of config.accounts) {
    console.log(`- ${account.id}: ${account.address}`);
    console.log(`  receive: ${account.receive.host}:${account.receive.port} ${account.receive.mailbox}`);
    console.log(`  send mode: ${account.send.mode}`);
    console.log(`  inbox folder: ${account.storage.inboxFolder}`);
    console.log(`  credential ref: ${account.credentialRef?.name ?? "missing"}`);
  }
}

// Prints configured account ids for account-specific secret/test/ingest commands.
async function listAccounts() {
  const config = await readConfig();
  for (const account of config.accounts ?? []) {
    console.log(`${account.id}\t${account.address}\t${account.label}`);
  }
}

try {
  if (command === "setup") {
    await setup(args);
  } else if (command === "add-gmail") {
    await addGmail(args);
  } else if (command === "validate") {
    await validate();
  } else if (command === "list") {
    await listAccounts();
  } else {
    console.log("Usage: node scripts/email-config.mjs <setup|add-gmail|validate|list>");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
