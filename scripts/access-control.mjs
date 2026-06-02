import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const orbiterDir = path.join(workspace, ".orbiter");
const configPath = path.join(orbiterDir, "access-config.json");
const usersPath = path.join(orbiterDir, "access-users.json");
const sessionsPath = path.join(orbiterDir, "access-sessions.json");
const sessionTtlMs = 1000 * 60 * 60 * 24 * 14;
const allowedAccessRoles = new Set(["admin", "wife", "member", "guest"]);

// Keeps roles explicit so permission checks do not depend on arbitrary labels.
export function normalizeAccessRole(role) {
  const cleanRole = String(role || "member").trim().toLowerCase();
  return allowedAccessRoles.has(cleanRole) ? cleanRole : "member";
}

// Stores phone numbers in E.164 form for future SMS verification lookups.
export function normalizePhoneE164(value) {
  const rawValue = String(value ?? "").trim();
  if (!rawValue) {
    return "";
  }

  const digits = rawValue.replace(/\D/g, "");
  if (rawValue.startsWith("+") && digits) {
    return `+${digits}`;
  }
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  return rawValue;
}

// Converts user ids into compact stable ids safe for config files and tags.
export function slugifyAccessId(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

// Hashes bearer-style secrets before storage so plaintext access tokens are shown only once.
export function tokenHash(token) {
  return createHash("sha256").update(String(token ?? ""), "utf8").digest("hex");
}

// Compares token hashes without short-circuiting on partial matches.
function hashEquals(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ""), "hex");
  const rightBuffer = Buffer.from(String(right ?? ""), "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

// Reads JSON from an Orbiter private config file, returning a fallback when missing.
async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

// Writes private access control JSON with stable formatting.
async function writeJson(filePath, value) {
  await mkdir(orbiterDir, { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

// Loads the local production access policy.
export async function readAccessConfig() {
  return {
    authRequired: false,
    networkGuard: "off",
    createdAt: "",
    updatedAt: "",
    ...await readJson(configPath, {})
  };
}

// Persists access policy changes under .orbiter/.
export async function writeAccessConfig(updates) {
  const existing = await readAccessConfig();
  const now = new Date().toISOString();
  const next = {
    ...existing,
    ...updates,
    createdAt: existing.createdAt || now,
    updatedAt: now
  };
  await writeJson(configPath, next);
  return next;
}

// Loads all configured users.
export async function readAccessUsers() {
  const payload = await readJson(usersPath, { users: [] });
  return Array.isArray(payload.users) ? payload.users : [];
}

// Persists the configured users.
export async function writeAccessUsers(users) {
  await writeJson(usersPath, { users });
}

// Removes sensitive hash fields before returning a user to the UI.
export function publicUser(user) {
  if (!user) {
    return null;
  }
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    active: user.active !== false,
    authProvider: user.authProvider || "access-token",
    email: user.googleEmail || "",
    ephemeral: user.ephemeral === true,
    dataScope: user.dataScope || "shared",
    phoneLast4: user.phoneE164 ? String(user.phoneE164).slice(-4) : "",
    createdAt: user.createdAt ?? "",
    lastRotatedAt: user.lastRotatedAt ?? ""
  };
}

// Creates a high-entropy token for a user and stores only its hash.
export async function createAccessUser({ id, name, role = "member", ephemeral = false, dataScope = "" }) {
  const users = await readAccessUsers();
  const cleanId = slugifyAccessId(id || name || os.userInfo().username || "user");
  if (!cleanId) {
    throw new Error("User id is required.");
  }
  if (users.some((user) => user.id === cleanId)) {
    throw new Error(`Access user already exists: ${cleanId}`);
  }

  const token = `orb_${randomBytes(32).toString("base64url")}`;
  const now = new Date().toISOString();
  const user = {
    id: cleanId,
    name: String(name || cleanId).trim(),
    role: normalizeAccessRole(role),
    active: true,
    ephemeral: ephemeral === true || ephemeral === "true",
    dataScope: dataScope || ((ephemeral === true || ephemeral === "true") ? "ephemeral" : "shared"),
    tokenHash: tokenHash(token),
    createdAt: now,
    lastRotatedAt: now
  };

  await writeAccessUsers([...users, user]);
  return { user: publicUser(user), token };
}

// Creates or updates an ephemeral Google-backed guest user after OAuth succeeds.
export async function findOrCreateGoogleAccessUser({ googleSub, email, name }) {
  const users = await readAccessUsers();
  const cleanSub = String(googleSub || "").trim();
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!cleanSub || !cleanEmail) {
    throw new Error("Google user info must include subject and email.");
  }

  const now = new Date().toISOString();
  const existingIndex = users.findIndex((user) => user.googleSub === cleanSub || user.googleEmail === cleanEmail);
  if (existingIndex !== -1) {
    users[existingIndex] = {
      ...users[existingIndex],
      name: String(name || users[existingIndex].name || cleanEmail).trim(),
      active: true,
      role: users[existingIndex].role || "guest",
      authProvider: "google",
      googleSub: cleanSub,
      googleEmail: cleanEmail,
      ephemeral: users[existingIndex].ephemeral !== false,
      dataScope: users[existingIndex].dataScope || "ephemeral",
      updatedAt: now
    };
    await writeAccessUsers(users);
    return publicUser(users[existingIndex]);
  }

  const localPart = cleanEmail.split("@")[0] || "google-user";
  const baseId = `google-${slugifyAccessId(localPart) || "user"}`;
  let cleanId = baseId;
  if (users.some((user) => user.id === cleanId)) {
    cleanId = `${baseId}-${slugifyAccessId(cleanSub).slice(-8) || randomBytes(4).toString("hex")}`;
  }

  const user = {
    id: cleanId,
    name: String(name || cleanEmail).trim(),
    role: "guest",
    active: true,
    authProvider: "google",
    googleSub: cleanSub,
    googleEmail: cleanEmail,
    ephemeral: true,
    dataScope: "ephemeral",
    tokenHash: tokenHash(`google:${cleanSub}:${randomBytes(32).toString("base64url")}`),
    createdAt: now,
    updatedAt: now,
    lastRotatedAt: now
  };

  await writeAccessUsers([...users, user]);
  return publicUser(user);
}

// Updates non-secret user metadata while preserving the stored token hash.
export async function updateAccessUser({ id, name, role, active, phoneE164, ephemeral, dataScope }) {
  const users = await readAccessUsers();
  const cleanId = slugifyAccessId(id);
  const index = users.findIndex((user) => user.id === cleanId);
  if (index === -1) {
    throw new Error(`Access user not found: ${cleanId}`);
  }

  const nextUser = { ...users[index] };
  if (name !== undefined) {
    nextUser.name = String(name || cleanId).trim();
  }
  if (role !== undefined) {
    nextUser.role = normalizeAccessRole(role);
  }
  if (active !== undefined) {
    nextUser.active = active !== false && active !== "false";
  }
  if (ephemeral !== undefined) {
    nextUser.ephemeral = ephemeral === true || ephemeral === "true";
    if (nextUser.ephemeral && !nextUser.dataScope) {
      nextUser.dataScope = "ephemeral";
    }
  }
  if (dataScope !== undefined) {
    nextUser.dataScope = String(dataScope || "shared").trim().toLowerCase();
  }
  if (phoneE164 !== undefined) {
    const cleanPhone = normalizePhoneE164(phoneE164);
    if (cleanPhone) {
      nextUser.phoneE164 = cleanPhone;
    } else {
      delete nextUser.phoneE164;
    }
  }

  users[index] = nextUser;
  await writeAccessUsers(users);
  return publicUser(nextUser);
}

// Replaces a user's access token and returns the new plaintext token once.
export async function rotateAccessToken(id) {
  const users = await readAccessUsers();
  const cleanId = slugifyAccessId(id);
  const index = users.findIndex((user) => user.id === cleanId);
  if (index === -1) {
    throw new Error(`Access user not found: ${cleanId}`);
  }

  const token = `orb_${randomBytes(32).toString("base64url")}`;
  users[index] = {
    ...users[index],
    tokenHash: tokenHash(token),
    active: true,
    lastRotatedAt: new Date().toISOString()
  };
  await writeAccessUsers(users);
  return { user: publicUser(users[index]), token };
}

// Deletes a user and removes that user's browser sessions.
export async function removeAccessUser(id) {
  const users = await readAccessUsers();
  const cleanId = slugifyAccessId(id);
  if (!cleanId) {
    throw new Error("User id is required.");
  }

  const target = users.find((user) => user.id === cleanId);
  if (!target) {
    throw new Error(`Access user not found: ${cleanId}`);
  }

  const removingActiveAdmin = target.role === "admin" && target.active !== false;
  const remainingActiveAdmins = users.filter((user) => user.id !== cleanId && user.role === "admin" && user.active !== false);
  if (removingActiveAdmin && remainingActiveAdmins.length === 0) {
    throw new Error("Cannot remove the last active admin user.");
  }

  await writeAccessUsers(users.filter((user) => user.id !== cleanId));

  const sessions = await readSessions();
  const keptSessions = sessions.filter((session) => session.userId !== cleanId);
  await writeJson(sessionsPath, { sessions: keptSessions });

  return {
    user: publicUser(target),
    revokedSessions: sessions.length - keptSessions.length
  };
}

// Finds an active user matching a provided access token.
export async function findUserByAccessToken(token) {
  const hash = tokenHash(token);
  const user = (await readAccessUsers()).find((candidate) => candidate.active !== false && hashEquals(candidate.tokenHash, hash));
  return user ? publicUser(user) : null;
}

// Parses a Cookie header into a simple name/value map.
export function parseCookies(cookieHeader) {
  return Object.fromEntries(
    String(cookieHeader ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        return separator === -1 ? [part, ""] : [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
      })
  );
}

// Loads non-expired browser sessions.
async function readSessions() {
  const now = Date.now();
  const payload = await readJson(sessionsPath, { sessions: [] });
  const sessions = Array.isArray(payload.sessions) ? payload.sessions.filter((session) => Date.parse(session.expiresAt) > now) : [];
  if (sessions.length !== payload.sessions?.length) {
    await writeJson(sessionsPath, { sessions });
  }
  return sessions;
}

// Creates a browser session bound to an access user id.
export async function createAccessSession(user) {
  const sessionToken = randomBytes(32).toString("base64url");
  const now = new Date();
  const session = {
    tokenHash: tokenHash(sessionToken),
    userId: user.id,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + sessionTtlMs).toISOString()
  };
  await writeJson(sessionsPath, { sessions: [...await readSessions(), session] });
  return { sessionToken, expiresAt: session.expiresAt };
}

// Resolves the current session cookie into an active user.
export async function userFromSessionCookie(cookieHeader) {
  const token = parseCookies(cookieHeader).orbiter_session;
  if (!token) {
    return null;
  }

  const hash = tokenHash(token);
  const session = (await readSessions()).find((candidate) => hashEquals(candidate.tokenHash, hash));
  if (!session) {
    return null;
  }

  const user = (await readAccessUsers()).find((candidate) => candidate.id === session.userId && candidate.active !== false);
  return publicUser(user);
}

// Deletes a browser session if it exists.
export async function revokeAccessSession(cookieHeader) {
  const token = parseCookies(cookieHeader).orbiter_session;
  if (!token) {
    return;
  }

  const hash = tokenHash(token);
  const sessions = (await readSessions()).filter((session) => !hashEquals(session.tokenHash, hash));
  await writeJson(sessionsPath, { sessions });
}

// Resolves the user bound to a session cookie before revocation removes it.
export async function userFromSessionCookieIncludingInactive(cookieHeader) {
  const token = parseCookies(cookieHeader).orbiter_session;
  if (!token) {
    return null;
  }

  const hash = tokenHash(token);
  const session = (await readSessions()).find((candidate) => hashEquals(candidate.tokenHash, hash));
  if (!session) {
    return null;
  }

  const user = (await readAccessUsers()).find((candidate) => candidate.id === session.userId);
  return publicUser(user);
}

// Builds the browser session cookie header, adding Secure when Orbiter sits behind HTTPS.
export function sessionCookie(sessionToken, expiresAt, options = {}) {
  const secure = options.secure ? "; Secure" : "";
  return `orbiter_session=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; SameSite=Strict; Expires=${new Date(expiresAt).toUTCString()}${secure}`;
}

// Builds a clearing cookie header for logout or failed sessions.
export function clearSessionCookie() {
  return "orbiter_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0";
}
