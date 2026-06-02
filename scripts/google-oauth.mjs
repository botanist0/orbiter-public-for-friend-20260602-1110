import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findOrCreateGoogleAccessUser } from "./access-control.mjs";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const orbiterDir = path.join(workspace, ".orbiter");
const googleConfigPath = path.join(orbiterDir, "google-oauth.json");
const googleStatesPath = path.join(orbiterDir, "google-oauth-states.json");
const defaultImportLimit = 100;
const googleScopes = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly"
];
const travelQuery = [
  "newer_than:730d",
  "(confirmation OR itinerary OR booking OR reservation OR e-ticket OR hotel OR flight OR train OR rail OR ferry OR voucher)",
  "-category:promotions",
  "-category:social",
  "-in:spam",
  "-in:trash"
].join(" ");
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

function slugify(value, fallback = "google") {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || fallback;
}

function safeReturnTo(value) {
  const raw = String(value || "/").trim();
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}

function normalizeOrigin(value) {
  const raw = String(value ?? "").trim().replace(/\/+$/g, "");
  if (!raw) {
    return "";
  }
  const parsed = new URL(raw);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Google OAuth origin must start with http:// or https://.");
  }
  return `${parsed.protocol}//${parsed.host}`;
}

function requestOrigin(req) {
  const configured = process.env.ORBITER_GOOGLE_REDIRECT_ORIGIN || process.env.ORBITER_PUBLIC_ORIGIN;
  if (configured) {
    return normalizeOrigin(configured);
  }
  const proto = req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
  const host = String(req.headers.host || "localhost:4173");
  return normalizeOrigin(`${proto}://${host}`);
}

function redirectUri(req) {
  return `${requestOrigin(req)}/api/google/oauth/callback`;
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse((await readFile(filePath, "utf8")).replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readGoogleConfig() {
  const fileConfig = await readJson(googleConfigPath, {});
  const config = {
    clientId: process.env.ORBITER_GOOGLE_CLIENT_ID || fileConfig.clientId || "",
    clientSecret: process.env.ORBITER_GOOGLE_CLIENT_SECRET || fileConfig.clientSecret || "",
    importLimit: Number(process.env.ORBITER_GOOGLE_IMPORT_LIMIT || fileConfig.importLimit || defaultImportLimit)
  };
  return {
    ...config,
    importLimit: Number.isFinite(config.importLimit) && config.importLimit > 0
      ? Math.min(defaultImportLimit, config.importLimit)
      : defaultImportLimit
  };
}

async function requireGoogleConfig() {
  const config = await readGoogleConfig();
  if (!config.clientId || !config.clientSecret) {
    throw Object.assign(new Error("Google OAuth is not configured. Add .orbiter/google-oauth.json or ORBITER_GOOGLE_CLIENT_ID/ORBITER_GOOGLE_CLIENT_SECRET."), { statusCode: 503, code: "google_oauth_not_configured" });
  }
  return config;
}

async function readStates() {
  const payload = await readJson(googleStatesPath, { states: [] });
  const now = Date.now();
  const states = Array.isArray(payload.states)
    ? payload.states.filter((entry) => Date.parse(entry.expiresAt) > now)
    : [];
  if (states.length !== payload.states?.length) {
    await writeJson(googleStatesPath, { states });
  }
  return states;
}

async function createOAuthState({ returnTo = "/", popup = false }) {
  const state = randomBytes(32).toString("base64url");
  const states = await readStates();
  const entry = {
    state,
    returnTo: safeReturnTo(returnTo),
    popup: popup === true || popup === "1" || popup === "true",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  };
  await writeJson(googleStatesPath, { states: [...states, entry] });
  return entry;
}

async function consumeOAuthState(state) {
  const states = await readStates();
  const entry = states.find((candidate) => candidate.state === state);
  await writeJson(googleStatesPath, { states: states.filter((candidate) => candidate.state !== state) });
  if (!entry) {
    throw Object.assign(new Error("Invalid or expired Google OAuth state."), { statusCode: 400, code: "invalid_google_oauth_state" });
  }
  return entry;
}

async function postForm(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(payload.error_description || payload.error || `Google request failed: ${response.status}`), { statusCode: 502, code: "google_request_failed" });
  }
  return payload;
}

async function googleJson(url, accessToken) {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(payload.error?.message || payload.error || `Google request failed: ${response.status}`), { statusCode: 502, code: "google_request_failed" });
  }
  return payload;
}

async function exchangeCodeForTokens(code, req, config) {
  return postForm("https://oauth2.googleapis.com/token", {
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: redirectUri(req),
    grant_type: "authorization_code"
  });
}

async function refreshAccessToken(user, tokenRecord = null, config = null) {
  const currentRecord = tokenRecord || await readUserGoogleToken(user);
  const googleConfig = config || await requireGoogleConfig();
  if (!currentRecord.refreshToken) {
    throw Object.assign(new Error("Google refresh token is missing. Sign in with Google again."), { statusCode: 401, code: "google_refresh_missing" });
  }
  const refreshed = await postForm("https://oauth2.googleapis.com/token", {
    client_id: googleConfig.clientId,
    client_secret: googleConfig.clientSecret,
    refresh_token: currentRecord.refreshToken,
    grant_type: "refresh_token"
  });
  const nextRecord = {
    ...currentRecord,
    accessToken: refreshed.access_token,
    expiresAt: new Date(Date.now() + Number(refreshed.expires_in || 3600) * 1000).toISOString(),
    scopes: refreshed.scope || currentRecord.scopes,
    updatedAt: new Date().toISOString()
  };
  await writeUserGoogleToken(user, nextRecord);
  return nextRecord;
}

function userPrivateDir(user) {
  return path.join(orbiterDir, "users", slugify(user.id, "user"));
}

function userGoogleTokenPath(user) {
  return path.join(userPrivateDir(user), "google-oauth-token.json");
}

async function readUserGoogleToken(user) {
  return readJson(userGoogleTokenPath(user), {});
}

async function writeUserGoogleToken(user, record) {
  await writeJson(userGoogleTokenPath(user), record);
}

async function accessTokenForUser(user) {
  const record = await readUserGoogleToken(user);
  if (!record.accessToken) {
    throw Object.assign(new Error("This Orbiter user has not connected Google yet."), { statusCode: 401, code: "google_not_connected" });
  }
  const expiresAt = Date.parse(record.expiresAt || "");
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now() + 60_000) {
    return (await refreshAccessToken(user, record)).accessToken;
  }
  return record.accessToken;
}

function headerValue(headers = [], name) {
  const header = headers.find((item) => String(item.name || "").toLowerCase() === name.toLowerCase());
  return header?.value || "";
}

function decodeBase64Url(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function collectMessageText(part, collected = { plain: [], html: [], attachments: [] }) {
  if (!part) {
    return collected;
  }
  const filename = part.filename || "";
  if (filename) {
    collected.attachments.push(filename);
  }
  const mimeType = String(part.mimeType || "").toLowerCase();
  const data = part.body?.data ? decodeBase64Url(part.body.data) : "";
  if (data && mimeType === "text/plain") {
    collected.plain.push(data);
  } else if (data && mimeType === "text/html") {
    collected.html.push(stripHtml(data));
  }
  for (const child of part.parts || []) {
    collectMessageText(child, collected);
  }
  return collected;
}

function yamlValue(value) {
  return `"${String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/"/g, '\\"')
    .trim()}"`;
}

function frontmatter(fields) {
  return `---\n${Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}: ${yamlValue(value)}`)
    .join("\n")}\n---\n`;
}

function isTravelMarketing(message) {
  const text = `${message.subject}\n${message.from}\n${message.body}`.toLowerCase();
  const promo = travelPromoPatterns.some((pattern) => pattern.test(text));
  const transactional = travelTransactionalPatterns.some((pattern) => pattern.test(text));
  return promo && !transactional;
}

function userInboxDir(user) {
  return path.join(workspace, "inbox", "email", `user-${slugify(user.id, "user")}`);
}

async function writeGoogleEmailNote(user, email, message) {
  const received = message.received || new Date().toISOString();
  const slug = `${received.slice(0, 10)}-${slugify(message.subject, "email")}-${slugify(message.messageId || message.id, "msg").slice(0, 18)}`;
  const folder = userInboxDir(user);
  await mkdir(folder, { recursive: true });
  const outputPath = path.join(folder, `${slug}.md`);
  try {
    await stat(outputPath);
    return { imported: false, path: path.relative(workspace, outputPath).replace(/\\/g, "/") };
  } catch {
    // Continue when the note does not exist yet.
  }

  const content = `${frontmatter({
    title: message.subject || "(no subject)",
    type: "email",
    from: message.from,
    to: message.to,
    message_id: message.messageId || message.id,
    received,
    source: "google-gmail-api",
    account: email,
    account_id: `user-${user.id}`,
    status: message.labelIds?.includes("UNREAD") ? "unread" : "read",
    tags: "email, gmail, travel, google-oauth"
  })}

## Body

${message.body || message.snippet || ""}

## Attachments

${message.attachments.length ? message.attachments.map((name) => `- ${name}`).join("\n") : "- none"}
`;

  await writeFile(outputPath, content, "utf8");
  return { imported: true, path: path.relative(workspace, outputPath).replace(/\\/g, "/") };
}

function normalizeGmailMessage(raw) {
  const headers = raw.payload?.headers || [];
  const text = collectMessageText(raw.payload);
  return {
    id: raw.id,
    threadId: raw.threadId,
    messageId: headerValue(headers, "Message-ID") || raw.id,
    subject: headerValue(headers, "Subject") || "(no subject)",
    from: headerValue(headers, "From"),
    to: headerValue(headers, "To"),
    received: new Date(headerValue(headers, "Date") || Number(raw.internalDate || Date.now())).toISOString(),
    labelIds: raw.labelIds || [],
    snippet: raw.snippet || "",
    body: [...text.plain, ...text.html].join("\n\n").trim(),
    attachments: text.attachments
  };
}

async function runUserTravelItinerary(user) {
  const cleanId = slugify(user.id, "user");
  const outputDir = path.join("knowledge", "projects", "travel", "users", cleanId);
  const outputJson = path.join(".orbiter", "users", cleanId, "travel-itinerary.json");
  const sourceFolder = path.join("inbox", "email", `user-${cleanId}`);

  await new Promise((resolve, reject) => {
    execFile(process.execPath, [
      path.join(workspace, "scripts", "travel-itinerary.mjs"),
      "--source-folder",
      sourceFolder,
      "--output-dir",
      outputDir,
      "--output-json",
      outputJson
    ], { cwd: workspace, windowsHide: true }, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

  return JSON.parse(await readFile(path.join(workspace, outputJson), "utf8"));
}

export async function googleOAuthStatus(req) {
  const config = await readGoogleConfig();
  return {
    configured: Boolean(config.clientId && config.clientSecret),
    redirectUri: redirectUri(req),
    importLimit: config.importLimit,
    scopes: googleScopes
  };
}

export async function googleOAuthStartUrl(req, { returnTo = "/", popup = false } = {}) {
  const config = await requireGoogleConfig();
  const state = await createOAuthState({ returnTo, popup });
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri(req),
    response_type: "code",
    scope: googleScopes.join(" "),
    state: state.state,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent"
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function completeGoogleOAuth(req, url) {
  const config = await requireGoogleConfig();
  const code = url.searchParams.get("code");
  const stateValue = url.searchParams.get("state");
  if (!code || !stateValue) {
    throw Object.assign(new Error("Google OAuth callback is missing code or state."), { statusCode: 400, code: "invalid_google_oauth_callback" });
  }

  const state = await consumeOAuthState(stateValue);
  const tokens = await exchangeCodeForTokens(code, req, config);
  const profile = await googleJson("https://openidconnect.googleapis.com/v1/userinfo", tokens.access_token);
  const user = await findOrCreateGoogleAccessUser({
    googleSub: profile.sub,
    email: profile.email,
    name: profile.name || profile.email
  });
  const priorRecord = await readUserGoogleToken(user);
  await writeUserGoogleToken(user, {
    provider: "google",
    email: profile.email,
    subject: profile.sub,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || priorRecord.refreshToken || "",
    expiresAt: new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString(),
    scopes: tokens.scope || googleScopes.join(" "),
    updatedAt: new Date().toISOString()
  });

  return { user, state };
}

export async function importGoogleTravelForUser(user, options = {}) {
  const config = await readGoogleConfig();
  const limit = Math.min(defaultImportLimit, Number(options.limit || config.importLimit || defaultImportLimit));
  const accessToken = await accessTokenForUser(user);
  const tokenRecord = await readUserGoogleToken(user);
  const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  listUrl.searchParams.set("q", options.query || travelQuery);
  listUrl.searchParams.set("maxResults", String(limit));

  const listed = await googleJson(listUrl, accessToken);
  const messages = Array.isArray(listed.messages) ? listed.messages.slice(0, limit) : [];
  const imported = [];
  const skipped = [];

  for (const item of messages) {
    const getUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}`);
    getUrl.searchParams.set("format", "full");
    const raw = await googleJson(getUrl, accessToken);
    const message = normalizeGmailMessage(raw);
    if (isTravelMarketing(message)) {
      skipped.push({ id: message.id, subject: message.subject, reason: "travel-promo" });
      continue;
    }

    const written = await writeGoogleEmailNote(user, tokenRecord.email || user.email, message);
    if (written.imported) {
      imported.push(written.path);
    } else {
      skipped.push({ id: message.id, subject: message.subject, reason: "already-imported" });
    }
  }

  const itinerary = await runUserTravelItinerary(user);
  return {
    account: tokenRecord.email || user.email,
    query: options.query || travelQuery,
    limit,
    candidateCount: messages.length,
    importedCount: imported.length,
    skippedCount: skipped.length,
    imported,
    skipped,
    itinerary
  };
}
