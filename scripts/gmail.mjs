import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import tls from "node:tls";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const orbiterDir = path.join(workspace, ".orbiter");
const configPath = path.join(orbiterDir, "email-config.json");
const secretPath = path.join(orbiterDir, "email-secrets.json");
const statePath = path.join(orbiterDir, "email-state.json");
const [, , command = "test", ...args] = process.argv;
const defaultTravelLookbackDays = 730;
const defaultTravelFetchLimit = 200;
const defaultImportantLookbackDays = 120;
const defaultImportantFetchLimit = 200;
const defaultImportantThreshold = 35;
const travelSearchTerms = [
  "from:agoda",
  "agoda booking",
  "agoda confirmation",
  "agoda voucher",
  "\"booking confirmed\"",
  "\"booking confirmation\"",
  "\"hotel confirmation\"",
  "\"reservation confirmation\"",
  "\"confirmed booking\"",
  "\"Booking ID\"",
  "\"check-in\"",
  "\"check in\"",
  "\"check-out\"",
  "\"check out\"",
  "voucher",
  "itinerary",
  "\"Korean Air\"",
  "teamLab",
  "\"DRUM TAO\"",
  "\"APA Hotel\""
];
const importantSearchTerms = [
  "is:read -category:promotions -category:social",
  "is:important",
  "is:starred",
  "\"security alert\"",
  "\"verification code\"",
  "\"login code\"",
  "invoice",
  "receipt",
  "billing",
  "reservation",
  "itinerary",
  "ticket",
  "domain",
  "account"
];

// Parses simple CLI flags so Gmail commands can target one account or all accounts.
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

const options = parseArgs(args);

// Reads a numeric CLI/config option while protecting the ingest path from bad values.
function numberOption(name, fallback) {
  const value = options[name];
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Converts user-facing text into a safe filename segment.
function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "email";
}

// Escapes frontmatter values so generated email markdown remains parseable.
function yamlValue(value) {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/"/g, '\\"')
    .trim();
}

// Serializes frontmatter for imported email notes.
function frontmatter(fields) {
  return `---\n${Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}: "${yamlValue(value)}"`)
    .join("\n")}\n---\n`;
}

// Formats an email address object or string for frontmatter and summaries.
function addressText(value) {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value.value)) {
    return value.value.map((item) => item.address ? `${item.name ? `${item.name} ` : ""}<${item.address}>`.trim() : item.name).filter(Boolean).join(", ");
  }
  return String(value.text ?? value.address ?? "");
}

// Checks raw text with compact rule definitions used by the email importance scorer.
function hasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

// Normalizes IMAP flags from ImapFlow so scoring works with arrays or Sets.
function flagNames(flags = []) {
  return [...flags].map((flag) => String(flag).toLowerCase());
}

const travelPromoPatterns = [
  /top price drops?/,
  /selected for you/,
  /pack your bags/,
  /new deals? (just landed|inside|claim now)/,
  /recent booking has unlocked new deals?/,
  /birthday sale/,
  /welcome gift/,
  /only \d+ rooms? remains?/,
  /claim now/,
  /\bup to \d+%\s*off\b/,
  /\bprice drops?\b/,
  /\bpersonalized[_ -]?deals?\b/,
  /\bnewsletter\b/,
  /\bshop now\b/,
  /exclusive deals?/,
  /get all your deals?/,
  /more deals on flights and hotels/,
  /we'?d love to hear from you/
];

const travelTransactionalPatterns = [
  /booking confirmation/,
  /booking id[:\s#-]*\d{4,}/,
  /your booking is now confirmed/,
  /booking is confirmed/,
  /customer receipt from booking/,
  /has cancelled your booking/,
  /e-?ticket/,
  /itinerary receipt/,
  /ticket purchase completion/,
  /completion of reservation purchase/,
  /reservation purchase/,
  /reservation confirmation/,
  /confirmed reservation/,
  /travel reservation/,
  /voucher/,
  /receipt/
];

// Detects travel marketing that matched broad Gmail search terms but is not a real trip record.
function classifyTravelMarketing(parsed) {
  const subject = parsed.subject || "";
  const from = addressText(parsed.from);
  const text = `${subject}\n${from}\n${parsed.text ?? ""}\n${parsed.html ?? ""}`.toLowerCase();
  const promoReasons = travelPromoPatterns
    .filter((pattern) => pattern.test(text))
    .map((pattern) => pattern.source.replace(/\\/g, ""));
  const transactional = travelTransactionalPatterns.some((pattern) => pattern.test(text));

  return {
    skip: promoReasons.length > 0 && !transactional,
    reasons: promoReasons,
    transactional
  };
}

// Classifies imported mail with deterministic signals before any ML layer exists.
function classifyEmailImportance(parsed, flags = [], account = {}) {
  const subject = parsed.subject || "";
  const from = addressText(parsed.from);
  const to = addressText(parsed.to);
  const text = `${subject}\n${from}\n${to}\n${parsed.text ?? ""}`.toLowerCase();
  const flagList = flagNames(flags);
  const seen = flagList.some((flag) => flag.includes("seen"));
  let score = seen ? 18 : -8;
  const reasons = [seen ? "read-message" : "unread-lower-priority"];

  if (hasAny(text, [/security alert/, /password/, /2-step|two-step|mfa|multi-factor/, /verification code/, /login code/, /account (changed|access|recovery)/])) {
    score += 45;
    reasons.push("account-security");
  }
  if (hasAny(text, [/invoice/, /receipt/, /billing/, /payment/, /renewal/, /domain/, /cloudflare/, /github/, /openai/, /squarespace/])) {
    score += 32;
    reasons.push("money-or-infrastructure");
  }
  if (hasAny(text, [/reservation/, /itinerary/, /ticket/, /booking/, /flight/, /hotel/, /event/])) {
    score += 28;
    reasons.push("travel-or-schedule");
  }
  if (parsed.attachments?.length) {
    score += 12;
    reasons.push("has-attachments");
  }
  if (account.address && to.toLowerCase().includes(String(account.address).toLowerCase())) {
    score += 8;
    reasons.push("direct-to-account");
  }
  if (hasAny(text, [/unsubscribe/, /\b\d+%\s*off\b/, /\bsale\b/, /\bdeal\b/, /coupon/, /newsletter/, /price drops?/, /giveaway/, /shop now/])) {
    score -= 34;
    reasons.push("promotional");
  }
  if (hasAny(text, [/no-reply|noreply|marketing|promo|offers?@/])) {
    score -= 8;
    reasons.push("bulk-sender");
  }

  const label = score >= 65 ? "critical" : score >= defaultImportantThreshold ? "important" : score >= 15 ? "low" : "junk";
  return {
    score,
    label,
    reasons: [...new Set(reasons)]
  };
}

// Returns a sorted unique UID list because Gmail searches can overlap heavily.
function uniqueSorted(values) {
  return [...new Set(values.filter((value) => Number.isFinite(Number(value))).map(Number))].sort((left, right) => left - right);
}

// Reads the private Gmail account config created by email:setup.
async function readConfig() {
  try {
    return JSON.parse((await readFile(configPath, "utf8")).replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error('Missing .orbiter/email-config.json. Run: npm run email:setup -- --address "your.address@gmail.com"');
    }
    throw error;
  }
}

// Reads dedupe state so repeated ingests do not import the same Gmail message twice.
async function readState() {
  try {
    return JSON.parse((await readFile(statePath, "utf8")).replace(/^\uFEFF/, ""));
  } catch {
    return { version: 1, accounts: {} };
  }
}

// Persists imported message IDs and last sync metadata.
async function writeState(state) {
  await mkdir(orbiterDir, { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

// Decrypts the Gmail app password stored by scripts/email-secret.ps1.
function decryptWindowsSecureString(encrypted) {
  const script = [
    "$encrypted = [Console]::In.ReadToEnd()",
    "$secure = ConvertTo-SecureString $encrypted",
    "$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)",
    "try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }"
  ].join("; ");

  return execFileSync("powershell", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    input: encrypted
  }).trim();
}

// Loads the Gmail app password from encrypted local storage or an explicit env fallback.
async function readPassword(account) {
  if (process.env.ORBITER_GMAIL_APP_PASSWORD) {
    return process.env.ORBITER_GMAIL_APP_PASSWORD;
  }

  let secrets;
  try {
    secrets = JSON.parse((await readFile(secretPath, "utf8")).replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("Missing Gmail app password. Run: npm run email:secret");
    }
    throw error;
  }

  const entry = secrets.accounts?.find((item) => item.id === account.id || item.address === account.address);
  if (!entry?.credential?.encrypted) {
    throw new Error(`No stored Gmail app password for ${account.address}. Run: npm run email:secret`);
  }
  if (entry.credential.type !== "windows-dpapi-secure-string") {
    throw new Error(`Unsupported credential type: ${entry.credential.type}`);
  }

  return decryptWindowsSecureString(entry.credential.encrypted);
}

// Quotes IMAP login fields for the raw Gmail authentication preflight.
function imapQuote(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// Performs a minimal IMAP LOGIN check so Gmail auth errors are reported clearly.
function gmailLoginPreflight(account, password) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: account.receive.host,
      port: account.receive.port,
      servername: account.receive.host,
      timeout: 20_000
    });
    let sentLogin = false;
    let transcript = "";

    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      transcript += chunk;
      if (!sentLogin && transcript.includes("* OK")) {
        sentLogin = true;
        socket.write(`a1 LOGIN ${imapQuote(account.username)} ${imapQuote(password)}\r\n`);
      }

      if (transcript.includes("a1 OK")) {
        socket.write("a2 LOGOUT\r\n");
        socket.end();
        resolve();
      } else if (transcript.includes("a1 NO") || transcript.includes("a1 BAD")) {
        socket.destroy();
        const response = transcript
          .split(/\r?\n/)
          .find((line) => line.startsWith("a1 NO") || line.startsWith("a1 BAD")) ?? "Gmail login failed.";
        reject(new Error(response.replace(/^a1\s+/, "")));
      }
    });
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("Timed out while waiting for Gmail IMAP login response."));
    });
    socket.on("error", reject);
  });
}

// Returns configured Gmail accounts and validates the settings this script depends on.
async function readAccounts() {
  const config = await readConfig();
  let accounts = config.accounts ?? [];

  if (!accounts.length) {
    throw new Error("No Gmail account configured.");
  }

  for (const account of accounts) {
    if (account.provider !== "gmail") {
      throw new Error(`Only Gmail accounts are supported by this MVP. ${account.id} is ${account.provider}.`);
    }
    if (!account.receive?.enabled) {
      throw new Error(`Gmail receive is disabled for ${account.id}.`);
    }
  }

  const requested = options.account || options.address || options._[0];
  if (requested && !options.all) {
    accounts = accounts.filter((account) => account.id === requested || account.address === requested);
    if (!accounts.length) {
      throw new Error(`No configured Gmail account matched ${requested}. Run: npm run email:list`);
    }
  } else if (!options.all) {
    accounts = [accounts[0]];
  }

  return accounts;
}

// Returns the single default account used by backward-compatible commands.
async function readAccount() {
  return (await readAccounts())[0];
}

// Opens an authenticated IMAP connection to Gmail.
async function connect(account) {
  const password = await readPassword(account);
  await gmailLoginPreflight(account, password);
  const client = new ImapFlow({
    host: account.receive.host,
    port: account.receive.port,
    secure: account.receive.secure,
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 30_000,
    auth: {
      user: account.username,
      pass: password
    },
    logger: false
  });

  await client.connect();
  return client;
}

// Creates a timestamped sync journal note for successful and failed runs.
async function writeSyncLog(account, title, lines) {
  const now = new Date();
  const folder = path.join(workspace, account.storage.syncJournalFolder);
  await mkdir(folder, { recursive: true });
  const filename = `${now.toISOString().slice(0, 10)}-${now.toISOString().slice(11, 19).replace(/:/g, "")}-${slugify(title)}.md`;
  const content = `${frontmatter({
    title,
    type: "email-sync",
    account: account.address,
    account_id: account.id,
    created: now.toISOString(),
    source: "gmail"
  })}\n${lines.join("\n")}\n`;
  await writeFile(path.join(folder, filename), content, "utf8");
}

// Checks whether an attachment is small enough to copy into Orbiter.
function canStoreAttachment(attachment, maxBytes) {
  return Number(attachment.size ?? attachment.content?.byteLength ?? 0) <= maxBytes;
}

// Writes parsed attachments to a per-message folder and returns markdown links.
async function storeAttachments(account, messageSlug, attachments) {
  if (!attachments?.length) {
    return ["- none"];
  }

  const maxBytes = account.safety?.maxAttachmentBytes ?? 26_214_400;
  const folder = path.join(workspace, account.storage.attachmentsFolder, messageSlug);
  await mkdir(folder, { recursive: true });
  const links = [];

  for (const attachment of attachments) {
    if (!canStoreAttachment(attachment, maxBytes)) {
      links.push(`- skipped ${attachment.filename ?? "attachment"} (${attachment.size ?? "unknown"} bytes, over limit)`);
      continue;
    }

    const filename = attachment.filename || `${attachment.cid || "attachment"}.bin`;
    const safeName = `${slugify(path.basename(filename, path.extname(filename)))}${path.extname(filename) || ".bin"}`;
    const outputPath = path.join(folder, safeName);
    await writeFile(outputPath, attachment.content);
    links.push(`- [${filename}](${path.relative(workspace, outputPath).replace(/\\/g, "/")})`);
  }

  return links;
}

// Writes one Gmail message as a markdown email note.
async function writeEmailNote(account, parsed, uid, flags = [], importance = classifyEmailImportance(parsed, flags, account)) {
  const received = parsed.date?.toISOString?.() ?? new Date().toISOString();
  const subject = parsed.subject || "(no subject)";
  const messageId = parsed.messageId || `gmail-uid-${uid}`;
  const messageSlug = `${received.slice(0, 10)}-${slugify(subject)}-${slugify(messageId).slice(0, 16)}`;
  const folder = path.join(workspace, account.storage.inboxFolder);
  await mkdir(folder, { recursive: true });

  const outputPath = path.join(folder, `${messageSlug}.md`);
  try {
    await stat(outputPath);
    return { imported: false, path: path.relative(workspace, outputPath).replace(/\\/g, "/"), messageId };
  } catch {
    // File does not exist yet.
  }

  const attachmentLinks = await storeAttachments(account, messageSlug, parsed.attachments);
  const content = `${frontmatter({
    title: subject,
    type: "email",
    from: addressText(parsed.from),
    to: addressText(parsed.to),
    cc: addressText(parsed.cc),
    message_id: messageId,
    received,
    source: "gmail-imap",
    account: account.address,
    account_id: account.id,
    status: flagNames(flags).some((flag) => flag.includes("seen")) ? "read" : "unread",
    importance_score: importance.score,
    importance_label: importance.label,
    importance_reasons: importance.reasons.join(", "),
    tags: ["email", "gmail", `importance-${importance.label}`, ...importance.reasons.map((reason) => `email-${reason}`)].join(", ")
  })}

## Body

${parsed.text?.trim() || parsed.html?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || ""}

## Attachments

${attachmentLinks.join("\n")}
`;

  await writeFile(outputPath, content, "utf8");
  return { imported: true, path: path.relative(workspace, outputPath).replace(/\\/g, "/"), messageId };
}

// Connects to Gmail, opens the target mailbox, and prints a small metadata summary.
async function testConnectionForAccount(account) {
  console.log(`connecting to ${account.receive.host}:${account.receive.port} as ${account.username}`);
  const client = await connect(account);

  try {
    const mailbox = await client.mailboxOpen(account.receive.mailbox, { readOnly: true });
    const unseen = await client.search({ seen: false }, { uid: true });
    console.log(`ok Gmail IMAP connection for ${account.address}`);
    console.log(`mailbox: ${account.receive.mailbox}`);
    console.log(`messages: ${mailbox.exists}`);
    console.log(`unseen: ${unseen.length}`);
  } finally {
    await client.logout();
  }
}

// Connects to one or more Gmail accounts and prints mailbox summaries.
async function testConnection() {
  const accounts = await readAccounts();
  for (const account of accounts) {
    await testConnectionForAccount(account);
  }
}

// Searches Gmail broadly for travel confirmations, including read messages that normal ingest misses.
async function travelCandidateUids(client, account) {
  const lookbackDays = numberOption("lookback-days", account.receive.travelLookbackDays ?? defaultTravelLookbackDays);
  const maxCandidates = numberOption("limit", account.receive.travelFetchLimit ?? defaultTravelFetchLimit);
  const uids = [];

  for (const term of travelSearchTerms) {
    const query = `newer_than:${lookbackDays}d ${term}`;
    try {
      const matches = await client.search({ gmailRaw: query }, { uid: true });
      uids.push(...matches);
    } catch (error) {
      console.warn(`Travel Gmail search skipped "${query}": ${error.message}`);
    }
  }

  return uniqueSorted(uids).slice(-maxCandidates);
}

// Searches for likely important mail without pulling the whole mailbox into Orbiter.
async function importantCandidateUids(client, account) {
  const lookbackDays = numberOption("lookback-days", account.receive.importantLookbackDays ?? defaultImportantLookbackDays);
  const maxCandidates = numberOption("limit", account.receive.importantFetchLimit ?? defaultImportantFetchLimit);
  const uids = [];

  for (const term of importantSearchTerms) {
    const query = `newer_than:${lookbackDays}d ${term}`;
    try {
      const matches = await client.search({ gmailRaw: query }, { uid: true });
      uids.push(...matches);
    } catch (error) {
      console.warn(`Important Gmail search skipped "${query}": ${error.message}`);
    }
  }

  return uniqueSorted(uids).slice(-maxCandidates);
}

// Selects the candidate Gmail UIDs for the requested ingest mode.
async function ingestCandidates(client, account) {
  if (options.travel) {
    const candidates = await travelCandidateUids(client, account);
    console.log(`Travel ingest candidate messages: ${candidates.length}`);
    return candidates;
  }
  if (options.important) {
    const candidates = await importantCandidateUids(client, account);
    console.log(`Important ingest candidate messages: ${candidates.length}`);
    return candidates;
  }

  const unseen = await client.search({ seen: false }, { uid: true });
  return unseen.slice(-Number(account.receive.fetchLimit ?? 25));
}

// Imports recent unseen Gmail messages into inbox/email/ without marking them seen.
async function ingestAccount(account) {
  console.log(`connecting to ${account.receive.host}:${account.receive.port} as ${account.username}`);
  const state = await readState();
  state.accounts[account.id] ??= { importedMessageIds: [] };
  const importedIds = new Set(state.accounts[account.id].importedMessageIds ?? []);
  const ignoredIds = new Set(state.accounts[account.id].ignoredMessageIds ?? []);
  const client = await connect(account);
  const imported = [];
  const skipped = [];

  try {
    await client.mailboxOpen(account.receive.mailbox, { readOnly: true });
    const targetUids = await ingestCandidates(client, account);

    if (!targetUids.length) {
      const message = options.travel
        ? "No travel Gmail messages matched the travel ingest search."
        : options.important
          ? "No important Gmail messages matched the important ingest search."
          : "No unseen Gmail messages to ingest.";
      console.log(message);
      await writeSyncLog(account, "Gmail ingest no messages", [message]);
      return;
    }

    const importanceThreshold = numberOption("importance-threshold", account.receive.importantThreshold ?? defaultImportantThreshold);
    for await (const message of client.fetch(targetUids, { uid: true, source: true, flags: true }, { uid: true })) {
      const parsed = await simpleParser(message.source);
      const messageId = parsed.messageId || `gmail-uid-${message.uid}`;
      if (importedIds.has(messageId)) {
        skipped.push(messageId);
        continue;
      }
      if (ignoredIds.has(messageId)) {
        skipped.push(`${messageId} (ignored-travel-promo)`);
        continue;
      }

      const importance = classifyEmailImportance(parsed, message.flags, account);
      if (options.travel) {
        const marketing = classifyTravelMarketing(parsed);
        if (marketing.skip) {
          skipped.push(`${messageId} (travel-promo:${marketing.reasons.slice(0, 3).join("+")})`);
          ignoredIds.add(messageId);
          continue;
        }
      }
      if (options.important && importance.score < importanceThreshold) {
        skipped.push(`${messageId} (${importance.label}:${importance.score})`);
        continue;
      }

      const result = await writeEmailNote(account, parsed, message.uid, message.flags, importance);
      if (result.imported) {
        imported.push(result.path);
        importedIds.add(result.messageId);
      } else {
        skipped.push(result.messageId);
        importedIds.add(result.messageId);
      }
    }

    state.accounts[account.id].importedMessageIds = [...importedIds].slice(-5000);
    state.accounts[account.id].ignoredMessageIds = [...ignoredIds].slice(-5000);
    state.accounts[account.id].lastSync = new Date().toISOString();
    await writeState(state);

    console.log(`Imported ${imported.length} Gmail message${imported.length === 1 ? "" : "s"}.`);
    for (const item of imported) {
      console.log(`- ${item}`);
    }

    await writeSyncLog(account, "Gmail ingest", [
      `Mode: ${options.travel ? "travel" : options.important ? "important" : "unseen"}`,
      options.important ? `Importance threshold: ${importanceThreshold}` : "",
      `Candidates: ${targetUids.length}`,
      `Imported: ${imported.length}`,
      `Skipped: ${skipped.length}`,
      "",
      ...imported.map((item) => `- ${item}`)
    ]);
  } finally {
    await client.logout();
  }
}

// Imports recent unseen Gmail messages from one or more configured accounts.
async function ingest() {
  const accounts = await readAccounts();
  for (const account of accounts) {
    await ingestAccount(account);
  }
}

try {
  if (command === "test") {
    await testConnection();
  } else if (command === "ingest") {
    await ingest();
  } else {
    console.log("Usage: node scripts/gmail.mjs <test|ingest>");
  }
} catch (error) {
  const account = await readAccount().catch(() => ({ id: "unknown", address: "unknown", storage: { syncJournalFolder: "journal/email-sync" } }));
  await writeSyncLog(account, "Gmail error", [`Error: ${error.message}`]).catch(() => {});
  console.error(error.message);
  process.exitCode = 1;
}
