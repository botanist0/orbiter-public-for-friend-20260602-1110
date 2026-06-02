import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import tls from "node:tls";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const workspace = path.resolve(path.dirname(scriptPath), "..");
const configPath = path.join(workspace, ".orbiter", "email-config.json");
const secretPath = path.join(workspace, ".orbiter", "email-secrets.json");
const sentJournalDir = path.join(workspace, "journal", "email-sent");
const [, , command = "send", ...args] = process.argv;

// Parses CLI flags without introducing a dependency for this operator-only script.
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

// Keeps note/journal filenames stable and filesystem-safe.
function slugify(value, fallback = "email") {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || fallback;
}

// Produces Orbiter-local time metadata for send guards and journal filenames.
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
  return {
    iso: date.toISOString(),
    localDate: `${parts.year}-${parts.month}-${parts.day}`,
    localTime: `${parts.hour}:${parts.minute}:${parts.second}`,
    hour: Number(parts.hour),
    timeZone
  };
}

// Reads simple Orbiter frontmatter from the local draft markdown file.
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

  return { fields, body: markdown.slice(match[0].length).trim() };
}

// Pulls the human-authored body section from an Orbiter email draft.
function draftBody(body) {
  const match = body.match(/# Body\s+([\s\S]*?)(?:\n# Send Safety|$)/);
  return (match?.[1] ?? body).trim();
}

// Splits comma-separated draft fields into recipient arrays.
function recipients(value) {
  return String(value ?? "")
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

// Escapes HTML before applying a tiny safe markdown subset.
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Converts the draft body to restrained HTML for Gmail while preserving bold tokens.
function markdownToHtml(markdown) {
  const lines = String(markdown ?? "").split(/\r?\n/);
  const html = [];
  let inList = false;

  function closeList() {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      continue;
    }

    const strong = escapeHtml(trimmed).replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    if (trimmed.startsWith("## ")) {
      closeList();
      html.push(`<h2>${strong.slice(3)}</h2>`);
    } else if (trimmed.startsWith("- ")) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${strong.slice(2)}</li>`);
    } else {
      closeList();
      html.push(`<p>${strong}</p>`);
    }
  }

  closeList();
  return `<div style="font-family:Inter,Segoe UI,Arial,sans-serif;line-height:1.55;color:#111827;max-width:680px">
  <div style="border:1px solid #d1d5db;border-radius:12px;padding:24px;background:#f9fafb">
    ${html.join("\n")}
  </div>
</div>`;
}

// Makes a MIME-safe-ish subject header for ASCII-first Orbiter emails.
function headerValue(value) {
  return String(value ?? "").replace(/\r?\n/g, " ").trim();
}

// Dot-stuffs SMTP DATA and normalizes line endings.
function smtpData(value) {
  return String(value).replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
}

// Reads the private email config and finds the account referenced by the draft.
async function readAccount(accountId) {
  const config = JSON.parse((await readFile(configPath, "utf8")).replace(/^\uFEFF/, ""));
  const account = (config.accounts ?? []).find((item) => item.id === accountId || item.address === accountId);
  if (!account) {
    throw new Error(`Email account not configured: ${accountId}`);
  }
  return account;
}

// Decrypts the Gmail app password stored by the local Windows user profile.
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

// Loads the encrypted app password for the draft's account.
async function readPassword(account) {
  const secrets = JSON.parse((await readFile(secretPath, "utf8")).replace(/^\uFEFF/, ""));
  const entry = secrets.accounts?.find((item) => item.id === account.id || item.address === account.address);
  if (!entry?.credential?.encrypted) {
    throw new Error(`No stored email app password for ${account.address}.`);
  }
  if (entry.credential.type !== "windows-dpapi-secure-string") {
    throw new Error(`Unsupported credential type: ${entry.credential.type}`);
  }
  return decryptWindowsSecureString(entry.credential.encrypted);
}

// Reads one complete SMTP response and handles multiline status messages.
function readResponse(socket) {
  return new Promise((resolve, reject) => {
    let transcript = "";

    function cleanup() {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("timeout", onTimeout);
    }
    function onError(error) {
      cleanup();
      reject(error);
    }
    function onTimeout() {
      cleanup();
      reject(new Error("Timed out waiting for SMTP response."));
    }
    function onData(chunk) {
      transcript += chunk;
      const lines = transcript.split(/\r?\n/).filter(Boolean);
      const last = lines.at(-1) ?? "";
      if (/^\d{3}\s/.test(last)) {
        cleanup();
        const code = Number(last.slice(0, 3));
        resolve({ code, transcript });
      }
    }

    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("timeout", onTimeout);
  });
}

// Sends an SMTP command and validates the response code family.
async function smtpCommand(socket, commandText, expectedCodes) {
  socket.write(`${commandText}\r\n`);
  const response = await readResponse(socket);
  if (!expectedCodes.includes(response.code)) {
    throw new Error(`SMTP command failed (${response.code}): ${response.transcript.trim()}`);
  }
  return response;
}

// Sends the prepared MIME message through Gmail SMTP.
async function sendSmtp(account, password, message) {
  const socket = tls.connect({
    host: account.send.host,
    port: account.send.port,
    servername: account.send.host,
    timeout: 30_000
  });
  socket.setEncoding("utf8");

  await readResponse(socket);
  await smtpCommand(socket, "EHLO orbiter.local", [250]);
  await smtpCommand(socket, `AUTH PLAIN ${Buffer.from(`\0${account.username}\0${password}`, "utf8").toString("base64")}`, [235]);
  await smtpCommand(socket, `MAIL FROM:<${message.from}>`, [250]);
  for (const recipient of [...message.to, ...message.cc, ...message.bcc]) {
    await smtpCommand(socket, `RCPT TO:<${recipient}>`, [250, 251]);
  }
  await smtpCommand(socket, "DATA", [354]);
  socket.write(`${smtpData(message.raw)}\r\n.\r\n`);
  const dataResponse = await readResponse(socket);
  if (![250].includes(dataResponse.code)) {
    throw new Error(`SMTP DATA failed (${dataResponse.code}): ${dataResponse.transcript.trim()}`);
  }
  await smtpCommand(socket, "QUIT", [221]);
  socket.end();
  return dataResponse.transcript.trim();
}

// Authenticates to SMTP and quits without sending a message.
async function testSmtp(account, password) {
  const socket = tls.connect({
    host: account.send.host,
    port: account.send.port,
    servername: account.send.host,
    timeout: 30_000
  });
  socket.setEncoding("utf8");

  await readResponse(socket);
  await smtpCommand(socket, "EHLO orbiter.local", [250]);
  await smtpCommand(socket, `AUTH PLAIN ${Buffer.from(`\0${account.username}\0${password}`, "utf8").toString("base64")}`, [235]);
  await smtpCommand(socket, "QUIT", [221]);
  socket.end();
}

// Builds a multipart message with text and HTML alternatives.
function buildMessage(draft, bodyMarkdown) {
  const boundary = `orbiter-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const toHeader = draft.to.join(", ");
  const textBody = bodyMarkdown;
  const htmlBody = markdownToHtml(bodyMarkdown);
  const headers = [
    `From: ${headerValue(draft.from)}`,
    `To: ${headerValue(toHeader)}`,
    `Subject: ${headerValue(draft.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`
  ];
  if (draft.cc.length) {
    headers.splice(2, 0, `Cc: ${headerValue(draft.cc.join(", "))}`);
  }

  return [
    ...headers,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    textBody,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    htmlBody,
    "",
    `--${boundary}--`,
    ""
  ].join("\r\n");
}

// Updates draft frontmatter after SMTP succeeds so automation retries do not resend.
async function markDraftSent(draftPath, markdown) {
  const sentAt = localStamp();
  const match = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (!match) {
    return;
  }

  const fields = new Map();
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator !== -1) {
      fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
    }
  }
  fields.set("status", "sent");
  fields.set("sent_at", sentAt.iso);

  const updatedFrontmatter = `---\n${[...fields.entries()].map(([key, value]) => `${key}: ${value}`).join("\n")}\n---\n`;
  await writeFile(draftPath, `${updatedFrontmatter}\n${markdown.slice(match[0].length).trim()}\n`, "utf8");
}

// Writes an audit record without copying the token-bearing body into the journal.
async function writeSentJournal(draft, draftPath, smtpResult) {
  const sentAt = localStamp();
  await mkdir(sentJournalDir, { recursive: true });
  const journalPath = path.join(sentJournalDir, `${sentAt.localDate}-${sentAt.localTime.replace(/:/g, "")}-${slugify(draft.subject)}.md`);
  const content = `---\ntitle: Email sent - ${draft.subject}\ntype: email-sent\nstatus: sent\ncreated: ${sentAt.iso}\naccount: ${draft.account}\nfrom: ${draft.from}\nto: ${draft.to.join(", ")}\nsubject: ${draft.subject}\ndraft: ${draftPath}\n---\n\n# Sent Email\n\nOrbiter sent this email through the configured SMTP account.\n\n- Draft: ${draftPath}\n- SMTP result: ${smtpResult.replace(/\r?\n/g, " ")}\n`;
  await writeFile(journalPath, content, "utf8");
  return path.relative(workspace, journalPath).replace(/\\/g, "/");
}

// Sends a local draft after all explicit safety guards pass.
export async function sendEmailDraft(draftPath, { confirmSend = false, requiredHour = null, requireStatus = "" } = {}) {
  if (!draftPath) {
    throw new Error("Usage: npm run email:send -- --path outbox/email/drafts/... --confirm-send SEND --require-local-hour 6");
  }
  if (!confirmSend) {
    throw new Error('Refusing to send without --confirm-send SEND.');
  }

  const now = localStamp();
  if (Number.isInteger(requiredHour) && now.hour !== requiredHour) {
    throw new Error(`Refusing to send at local time ${now.localTime}. Required hour is ${String(requiredHour).padStart(2, "0")}:00.`);
  }

  const resolvedPath = path.resolve(workspace, draftPath);
  const outboxRoot = path.resolve(workspace, "outbox", "email", "drafts");
  if (!resolvedPath.startsWith(`${outboxRoot}${path.sep}`)) {
    throw new Error("Refusing to send a file outside outbox/email/drafts.");
  }

  const markdown = await readFile(resolvedPath, "utf8");
  const { fields, body } = parseFrontmatter(markdown);
  const draft = {
    account: fields.account || "gmail-primary",
    from: fields.from,
    to: recipients(fields.to),
    cc: recipients(fields.cc),
    bcc: recipients(fields.bcc),
    subject: fields.subject
  };
  if (fields.status === "sent") {
    throw new Error("Refusing to resend a draft already marked sent.");
  }
  if (requireStatus && String(fields.status || "").toLowerCase() !== requireStatus) {
    throw new Error(`Draft must be ${requireStatus} before send. Current status: ${fields.status || "unknown"}.`);
  }
  if (!draft.from || !draft.to.length || !draft.subject) {
    throw new Error("Draft is missing from, to, or subject metadata.");
  }

  const account = await readAccount(draft.account);
  const password = await readPassword(account);
  const bodyMarkdown = draftBody(body);
  const raw = buildMessage(draft, bodyMarkdown);
  const smtpResult = await sendSmtp(account, password, { ...draft, raw });
  await markDraftSent(resolvedPath, markdown);
  const journalPath = await writeSentJournal(draft, path.relative(workspace, resolvedPath).replace(/\\/g, "/"), smtpResult);
  const sentPath = path.relative(workspace, resolvedPath).replace(/\\/g, "/");

  return {
    draftPath: sentPath,
    to: draft.to,
    subject: draft.subject,
    journalPath,
    smtpResult
  };
}

// Parses CLI options and delegates to the reusable send guard.
async function send(values) {
  const options = parseArgs(values);
  const requiredHour = options["require-local-hour"] === undefined ? null : Number(options["require-local-hour"]);
  const result = await sendEmailDraft(String(options.path || options._[0] || "").trim(), {
    confirmSend: options["confirm-send"] === "SEND",
    requiredHour
  });

  console.log(`Sent email draft: ${result.draftPath}`);
  console.log(`To: ${result.to.join(", ")}`);
  console.log(`Subject: ${result.subject}`);
  console.log(`Journal: ${result.journalPath}`);
}

// Verifies the SMTP credentials and connection without sending email.
async function test(values) {
  const options = parseArgs(values);
  const account = await readAccount(options.account || options._[0] || "gmail-primary");
  const password = await readPassword(account);
  await testSmtp(account, password);
  console.log(`ok SMTP auth for ${account.address}`);
}

if (path.resolve(process.argv[1] || "") === scriptPath) {
  try {
    if (command === "send") {
      await send(args);
    } else if (command === "test") {
      await test(args);
    } else {
      console.log("Usage: node scripts/email-send.mjs <send|test>");
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
