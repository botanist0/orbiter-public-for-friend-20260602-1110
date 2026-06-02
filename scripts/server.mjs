import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  clearSessionCookie,
  createAccessSession,
  findUserByAccessToken,
  readAccessConfig,
  revokeAccessSession,
  sessionCookie,
  userFromSessionCookie,
  userFromSessionCookieIncludingInactive
} from "./access-control.mjs";
import { filterNotesForActor } from "./access-scope.mjs";
import {
  completeGoogleOAuth,
  googleOAuthStartUrl,
  googleOAuthStatus,
  importGoogleTravelForUser
} from "./google-oauth.mjs";
import {
  claimNextCodexCommand,
  formatCodexHandoff
} from "./codex-handoff-core.mjs";
import { createEmailDraft } from "./email-draft-core.mjs";
import { sendEmailDraft } from "./email-send.mjs";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const orbiterDir = path.join(workspace, ".orbiter");
const environmentConfigPath = path.join(orbiterDir, "environment-config.json");
const eclipseEventsPath = path.join(workspace, "data", "eclipse-events.json");
const mobileTokenPath = path.join(orbiterDir, "mobile-token");
const travelItineraryPath = path.join(orbiterDir, "travel-itinerary.json");
const appRoot = path.join(workspace, "app");
const inboxDir = path.join(workspace, "inbox");
const outboxDir = path.join(workspace, "outbox");
const emailDraftsDir = path.join(outboxDir, "email", "drafts");
const usernotesDir = path.join(workspace, "usernotes");
const mobileUsernotesDir = path.join(usernotesDir, "mobile");
const commandsDir = path.join(workspace, "commands");
const commandInboxDir = path.join(commandsDir, "inbox");
const knowledgeDir = path.join(workspace, "knowledge");
const journalDir = path.join(workspace, "journal");
const issuesJournalDir = path.join(workspace, "issues-journal");
const skillsDir = path.join(workspace, "skills");
const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? "127.0.0.1";
const apiVersion = "v1";
const configuredCacheTtlMs = Number(process.env.ORBITER_CACHE_TTL_MS ?? 1_000);
const workspaceCacheTtlMs = Number.isFinite(configuredCacheTtlMs) ? Math.max(0, configuredCacheTtlMs) : 1_000;
const publicOrigin = normalizePublicOrigin(process.env.ORBITER_PUBLIC_ORIGIN);
const publicOriginHost = publicOrigin ? new URL(publicOrigin).hostname.toLowerCase() : "";
const runtimeEnvironment = String(process.env.ORBITER_ENV || (publicOrigin ? "production" : "local")).trim().toLowerCase() || "local";
const defaultAllowedHosts = ["127.0.0.1", "localhost", "::1"];
const configuredAllowedHosts = String(process.env.ORBITER_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const configuredAllowedOrigins = String(process.env.ORBITER_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((value) => normalizeOrigin(value))
  .filter(Boolean);

let notesCache = { expiresAt: 0, generatedAt: "", notes: null };
let commandsCache = { expiresAt: 0, generatedAt: "", commands: null };
let environmentCache = { expiresAt: 0, payload: null };

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".ico", "image/x-icon"]
]);

const deletableRoots = [
  usernotesDir,
  commandsDir,
  inboxDir,
  outboxDir,
  knowledgeDir,
  journalDir,
  issuesJournalDir
];

// Defines all folders where future guest imports and generated artifacts must be written.
function scopedUserDataRoots(userId) {
  const cleanId = slugify(userId || "");
  if (!cleanId) {
    return [];
  }

  return [
    path.join(orbiterDir, "users", cleanId),
    path.join(inboxDir, "email", `user-${cleanId}`),
    path.join(inboxDir, "attachments", "email", `user-${cleanId}`),
    path.join(outboxDir, "email", "drafts", `user-${cleanId}`),
    path.join(journalDir, "email-sync", `user-${cleanId}`),
    path.join(journalDir, "email-sent", `user-${cleanId}`),
    path.join(knowledgeDir, "projects", "travel", "users", cleanId)
  ];
}

// Stores generated itinerary JSON separately for each Google/guest user.
function scopedTravelItineraryPath(userId) {
  const cleanId = slugify(userId || "");
  return cleanId ? path.join(orbiterDir, "users", cleanId, "travel-itinerary.json") : "";
}

// Deletes only explicitly user-scoped data roots for wipe-on-logout guest accounts.
async function purgeEphemeralUserData(user) {
  if (!user?.ephemeral) {
    return { purged: false, paths: [] };
  }

  const paths = [];
  for (const root of scopedUserDataRoots(user.id)) {
    const resolved = path.resolve(root);
    const allowed = [
      path.join(orbiterDir, "users"),
      path.join(inboxDir, "email"),
      path.join(inboxDir, "attachments", "email"),
      path.join(outboxDir, "email", "drafts"),
      path.join(journalDir, "email-sync"),
      path.join(journalDir, "email-sent"),
      path.join(knowledgeDir, "projects", "travel", "users")
    ].some((parent) => resolved.startsWith(`${path.resolve(parent)}${path.sep}`));

    if (!allowed) {
      continue;
    }

    await rm(resolved, { recursive: true, force: true });
    paths.push(path.relative(workspace, resolved).replace(/\\/g, "/"));
  }

  invalidateWorkspaceCache();
  return { purged: true, paths };
}

// Normalizes browser Origin values so default ports and hostname case do not break login.
function normalizeOrigin(value) {
  const raw = String(value ?? "").trim().replace(/\/+$/g, "");
  if (!raw) {
    return "";
  }
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "";
    }
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return "";
  }
}

// Normalizes the configured public origin so Host and Origin checks are exact.
function normalizePublicOrigin(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }
  const origin = normalizeOrigin(raw);
  if (!origin) {
    throw new Error("ORBITER_PUBLIC_ORIGIN must start with http:// or https://.");
  }
  return origin;
}

// Adds baseline browser hardening headers to every response.
function securityHeaders(extra = {}) {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'"
  ].join("; ");

  return {
    "content-security-policy": csp,
    "referrer-policy": "same-origin",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    ...extra
  };
}

// Interprets env flags consistently across Windows cmd and PowerShell callers.
function enabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").toLowerCase());
}

// Centralizes feature flags so unfinished surfaces can ship in code without rolling out.
function featureFlags() {
  return {
    commandCenter: enabled(process.env.ORBITER_FEATURE_COMMAND_CENTER || process.env.ORBITER_COMMAND_CENTER)
  };
}

// Checks a named flag without letting a missing flag expose the feature by accident.
function featureEnabled(name) {
  return Boolean(featureFlags()[name]);
}

// Loads the effective runtime access policy, with env vars overriding private config.
async function accessPolicy() {
  const config = await readAccessConfig();
  const authEnv = process.env.ORBITER_AUTH;
  return {
    authRequired: authEnv === undefined ? config.authRequired === true : enabled(authEnv),
    networkGuard: process.env.ORBITER_NETWORK_GUARD || config.networkGuard || "off"
  };
}

// Normalizes IPv4-mapped remote addresses from Node sockets.
function remoteAddress(req) {
  return String(req.socket.remoteAddress ?? "")
    .replace(/^::ffff:/, "")
    .replace(/^\[|\]$/g, "");
}

// Pulls the hostname out of a Host header without trusting arbitrary schemes.
function requestHost(req) {
  const raw = String(req.headers.host ?? "").trim().toLowerCase();
  if (!raw) {
    return "";
  }
  if (raw.startsWith("[")) {
    return raw.slice(1, raw.indexOf("]"));
  }
  return raw.split(":")[0];
}

// Builds the allowed-host set for public tunnel mode while preserving local access.
function allowedHosts() {
  const hosts = new Set([...defaultAllowedHosts, ...configuredAllowedHosts]);
  if (publicOriginHost) {
    hosts.add(publicOriginHost);
  }
  return hosts;
}

// Blocks DNS rebinding and wrong-host traffic when Orbiter has a public origin.
function hostAllowed(req) {
  if (!publicOrigin && !configuredAllowedHosts.length) {
    return true;
  }
  return allowedHosts().has(requestHost(req));
}

// Returns the request origin when browsers send one for state-changing requests.
function requestOrigin(req) {
  const raw = String(req.headers.origin ?? "").trim();
  return {
    present: Boolean(raw),
    value: normalizeOrigin(raw)
  };
}

// Allows same-origin writes from the public hostname and local development URLs.
function originAllowed(req) {
  if (!["POST", "PATCH", "DELETE"].includes(req.method ?? "GET")) {
    return true;
  }
  const origin = requestOrigin(req);
  if (!origin.present) {
    return true;
  }
  if (!origin.value) {
    return false;
  }

  const allowed = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    ...configuredAllowedOrigins
  ]);
  if (publicOrigin) {
    allowed.add(publicOrigin);
  }
  for (const allowedHost of allowedHosts()) {
    if (!defaultAllowedHosts.includes(allowedHost)) {
      allowed.add(`https://${allowedHost}`);
    }
  }
  return allowed.has(origin.value);
}

// Detects whether the browser reached Orbiter over HTTPS before a proxy forwarded it locally.
function requestIsHttps(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").toLowerCase();
  if (forwardedProto) {
    return forwardedProto === "https";
  }
  return Boolean(req.socket?.encrypted);
}

// Allows browser and API use from this Windows machine regardless of production guard.
function isLoopbackAddress(address) {
  return address === "127.0.0.1" || address === "::1" || address === "localhost";
}

// Tailscale clients use the 100.64.0.0/10 carrier-grade NAT range.
function isTailscaleAddress(address) {
  const parts = address.split(".").map((part) => Number(part));
  return parts.length === 4 && parts.every((part) => Number.isInteger(part)) && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

// Enforces local-only or tailnet-only access before any static file or API work runs.
function networkAllowed(req, policy) {
  if (policy.networkGuard !== "tailscale") {
    return true;
  }

  const address = remoteAddress(req);
  return isLoopbackAddress(address) || isTailscaleAddress(address);
}

// Extracts a bearer or custom access token from API/Shortcut requests.
function accessTokenFromRequest(req) {
  const headerToken = req.headers["x-orbiter-access-token"];
  const authorization = req.headers.authorization ?? "";
  const bearerToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return Array.isArray(headerToken) ? headerToken[0] : headerToken || bearerToken;
}

// Returns the logged-in browser user when a session cookie is present.
async function sessionActor(req) {
  return userFromSessionCookie(req.headers.cookie ?? "");
}

// Identifies static files that must stay reachable before login.
function isPublicStaticPath(url) {
  return ["/app.js", "/login.html", "/login.js", "/styles.css", "/favicon.png"].includes(url.pathname);
}

// Treats the app root as the friendly signed-out entrypoint instead of a redirect-only path.
function isAppRootPath(url) {
  return url.pathname === "/" || url.pathname === "/index.html";
}

// Identifies API routes that perform login or must stay available for setup checks.
function isPublicApiPath(url) {
  return url.pathname === "/api/session"
    || url.pathname === "/api/session/login"
    || url.pathname === "/api/health"
    || url.pathname === "/api/mobile/capture"
    || url.pathname === "/api/google/oauth/status"
    || url.pathname === "/api/google/oauth/start"
    || url.pathname === "/api/google/oauth/callback";
}

// Clears cached workspace reads after Orbiter writes or deletes markdown.
function invalidateWorkspaceCache() {
  notesCache = { expiresAt: 0, generatedAt: "", notes: null };
  commandsCache = { expiresAt: 0, generatedAt: "", commands: null };
}

// Clears command-specific cached reads after command status changes.
function invalidateCommandCache() {
  commandsCache = { expiresAt: 0, generatedAt: "", commands: null };
  notesCache = { expiresAt: 0, generatedAt: "", notes: null };
}

// Exposes lightweight cache metadata for health/debug responses.
function cacheState() {
  const now = Date.now();
  return {
    ttlMs: workspaceCacheTtlMs,
    notes: {
      warm: Array.isArray(notesCache.notes),
      expiresInMs: Math.max(0, notesCache.expiresAt - now),
      generatedAt: notesCache.generatedAt
    },
    commands: {
      warm: Array.isArray(commandsCache.commands),
      expiresInMs: Math.max(0, commandsCache.expiresAt - now),
      generatedAt: commandsCache.generatedAt
    }
  };
}

// Converts user-facing titles and paths into short filesystem-safe identifiers.
function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "note";
}

// Returns the backend machine's local calendar date for note filenames.
function today() {
  return getLocalTime().localDate;
}

// Extracts stable date/time parts in a specific IANA timezone.
function localParts(date, timeZone) {
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
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second
  };
}

// Formats a timezone offset in the ISO-style +/-HH:MM form.
function utcOffset(minutes) {
  const sign = minutes >= 0 ? "+" : "-";
  const absolute = Math.abs(minutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const mins = String(absolute % 60).padStart(2, "0");
  return `${sign}${hours}:${mins}`;
}

// Builds the complete local-time payload used by the API and note metadata.
function getLocalTime(date = new Date()) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const parts = localParts(date, timeZone);
  const offsetMinutes = -date.getTimezoneOffset();
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  const localTime = `${parts.hour}:${parts.minute}:${parts.second}`;

  return {
    timeZone,
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    iso: date.toISOString(),
    epochMs: date.getTime(),
    localDate,
    localTime,
    localDateTime: `${localDate}T${localTime}${utcOffset(offsetMinutes)}`,
    offsetMinutes,
    utcOffset: utcOffset(offsetMinutes)
  };
}

// Converts config/env coordinate values into validated numbers.
function numericCoordinate(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// Reads the local environment widget config without requiring it to exist.
async function readEnvironmentConfig() {
  let fileConfig = {};
  try {
    fileConfig = JSON.parse(await readFile(environmentConfigPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  const location = fileConfig.location ?? {};
  const latitude = numericCoordinate(process.env.ORBITER_HOME_LATITUDE ?? process.env.ORBITER_HOME_LAT ?? location.latitude);
  const longitude = numericCoordinate(process.env.ORBITER_HOME_LONGITUDE ?? process.env.ORBITER_HOME_LON ?? location.longitude);
  const label = String(process.env.ORBITER_HOME_LABEL ?? location.label ?? "").trim();
  const timeZone = String(process.env.ORBITER_HOME_TIMEZONE ?? location.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC").trim();
  const configured = latitude !== null && longitude !== null && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;

  return {
    configured,
    label: label || (configured ? "Home" : "Location not configured"),
    latitude: configured ? latitude : null,
    longitude: configured ? longitude : null,
    timeZone,
    configPath: ".orbiter/environment-config.json"
  };
}

// Maps WMO weather codes to compact labels for the topbar widget.
function weatherCodeLabel(code) {
  const labels = {
    0: "Clear",
    1: "Mostly clear",
    2: "Partly cloudy",
    3: "Cloudy",
    45: "Fog",
    48: "Rime fog",
    51: "Light drizzle",
    53: "Drizzle",
    55: "Heavy drizzle",
    56: "Freezing drizzle",
    57: "Freezing drizzle",
    61: "Light rain",
    63: "Rain",
    65: "Heavy rain",
    66: "Freezing rain",
    67: "Freezing rain",
    71: "Light snow",
    73: "Snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Rain showers",
    81: "Rain showers",
    82: "Heavy showers",
    85: "Snow showers",
    86: "Snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm hail",
    99: "Thunderstorm hail"
  };
  return labels[Number(code)] ?? "Weather";
}

// Groups weather codes into icon classes that the browser can render as a compact widget.
function weatherIconKind(code, isDay) {
  const value = Number(code);
  if ([0, 1].includes(value)) {
    return isDay ? "clear-day" : "clear-night";
  }
  if ([2, 3, 45, 48].includes(value)) {
    return "cloud";
  }
  if ((value >= 51 && value <= 67) || [80, 81, 82].includes(value)) {
    return "rain";
  }
  if ((value >= 71 && value <= 77) || [85, 86].includes(value)) {
    return "snow";
  }
  if (value >= 95) {
    return "storm";
  }
  return "unknown";
}

// Fetches JSON with a short timeout so weather never blocks the local app.
async function fetchJsonWithTimeout(url, timeoutMs = 3500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Weather provider returned ${response.status}.`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

// Loads current weather from Open-Meteo for the configured local coordinates.
async function readOpenMeteoWeather(location) {
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: "temperature_2m,weather_code,wind_speed_10m,is_day,cloud_cover,precipitation",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    timezone: location.timeZone || "auto"
  });
  const payload = await fetchJsonWithTimeout(`https://api.open-meteo.com/v1/forecast?${params}`);
  const current = payload.current ?? payload.current_weather ?? {};
  const temperature = numericCoordinate(current.temperature_2m ?? current.temperature);
  const code = Number(current.weather_code ?? current.weathercode ?? -1);
  const isDay = Number(current.is_day ?? 1) === 1;

  return {
    status: "ok",
    provider: "Open-Meteo",
    providerUrl: "https://open-meteo.com/en/docs",
    observedAt: current.time ?? "",
    temperature: temperature === null ? null : Math.round(temperature),
    unit: "F",
    condition: weatherCodeLabel(code),
    conditionCode: Number.isFinite(code) && code >= 0 ? code : null,
    icon: weatherIconKind(code, isDay),
    isDay,
    cloudCover: numericCoordinate(current.cloud_cover),
    precipitation: numericCoordinate(current.precipitation),
    windSpeed: numericCoordinate(current.wind_speed_10m ?? current.windspeed)
  };
}

// Reads curated eclipse events used for local path/time matching.
async function readEclipseEvents() {
  try {
    const payload = JSON.parse(await readFile(eclipseEventsPath, "utf8"));
    return Array.isArray(payload.events) ? payload.events : [];
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    return [];
  }
}

// Measures distance between coordinates for approximate eclipse-path checks.
function distanceKm(left, right) {
  const radiusKm = 6371;
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const lat1 = toRadians(left.latitude);
  const lat2 = toRadians(right.latitude);
  const dLat = toRadians(right.latitude - left.latitude);
  const dLon = toRadians(right.longitude - left.longitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radiusKm * Math.asin(Math.sqrt(a));
}

// Checks broad bounds and path waypoints so Orbiter can flag a totality-path event.
function locationInEclipsePath(location, event) {
  if (!location.configured) {
    return false;
  }
  if (event.visibility === "global-night") {
    return true;
  }

  const point = { latitude: location.latitude, longitude: location.longitude };
  for (const box of event.pathBounds ?? []) {
    if (location.latitude >= box.minLat && location.latitude <= box.maxLat && location.longitude >= box.minLon && location.longitude <= box.maxLon) {
      return true;
    }
  }

  const radiusKm = Number(event.totalityRadiusKm ?? 115);
  return (event.pathWaypoints ?? []).some((waypoint) => distanceKm(point, waypoint) <= radiusKm);
}

// Turns weather plus an active eclipse match into the short topbar event text.
function eclipseViewingText(event, weather) {
  if (!event) {
    return "No local eclipse event now.";
  }
  if (weather?.status !== "ok") {
    return `${event.safetyNote || "Check official viewing guidance."}`;
  }

  const cloudCover = numericCoordinate(weather.cloudCover);
  if (cloudCover !== null && cloudCover >= 75) {
    return `${event.label} active; clouds may block the view.`;
  }
  if (cloudCover !== null && cloudCover <= 35) {
    return `${event.label} active; sky looks favorable.`;
  }
  return `${event.label} active; check the sky.`;
}

// Finds an eclipse that is active now and visible from the configured location.
async function currentEclipseEvent(location, weather, now = new Date()) {
  const events = await readEclipseEvents();
  const match = events.find((event) => {
    const start = new Date(event.start);
    const end = new Date(event.end);
    return Number.isFinite(start.getTime())
      && Number.isFinite(end.getTime())
      && now >= start
      && now <= end
      && locationInEclipsePath(location, event);
  });

  if (!match) {
    return {
      status: location.configured ? "none" : "not_configured",
      icon: "none",
      label: location.configured ? "No eclipse now" : "Location required",
      detail: location.configured ? "No local total solar or lunar eclipse is active right now." : "Set latitude and longitude to enable eclipse path checks."
    };
  }

  return {
    status: "active",
    icon: match.icon || match.kind || "eclipse",
    kind: match.kind,
    label: match.label,
    detail: eclipseViewingText(match, weather),
    start: match.start,
    end: match.end,
    source: match.source,
    sourceUrl: match.sourceUrl,
    safetyNote: match.safetyNote || ""
  };
}

// Builds the environment widget model consumed by the browser topbar.
async function readEnvironment() {
  const now = Date.now();
  if (environmentCache.payload && now < environmentCache.expiresAt) {
    return environmentCache.payload;
  }

  const location = await readEnvironmentConfig();
  let weather = {
    status: "not_configured",
    provider: "Open-Meteo",
    condition: "Weather location needed",
    icon: "unknown",
    detail: "Set .orbiter/environment-config.json or ORBITER_HOME_LATITUDE/ORBITER_HOME_LONGITUDE."
  };

  if (location.configured) {
    try {
      weather = await readOpenMeteoWeather(location);
    } catch (error) {
      weather = {
        status: "unavailable",
        provider: "Open-Meteo",
        condition: "Weather unavailable",
        icon: "unknown",
        detail: error.message
      };
    }
  }

  const eclipse = await currentEclipseEvent(location, weather);
  const payload = {
    generatedAt: new Date().toISOString(),
    location,
    weather,
    eclipse
  };
  environmentCache = { expiresAt: now + 10 * 60 * 1000, payload };
  return payload;
}

// Normalizes tag input from arrays or comma-separated strings into a clean array.
function splitTags(value) {
  if (Array.isArray(value)) {
    return value.map((tag) => String(tag).trim()).filter(Boolean);
  }

  return String(value ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

// Parses the simple YAML-like frontmatter format Orbiter stores in markdown files.
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
    const rawValue = line.slice(separator + 1).trim();
    const value = rawValue.startsWith('"') && rawValue.endsWith('"')
      ? rawValue.slice(1, -1).replace(/\\"/g, '"')
      : rawValue;
    fields[key] = value;
  }

  return {
    fields,
    body: markdown.slice(match[0].length).trim()
  };
}

// Serializes frontmatter fields while keeping markdown files easy to read by hand.
function frontmatter(fields) {
  return `---\n${Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}: ${String(value).replace(/\r?\n/g, " ").trim()}`)
    .join("\n")}\n---\n`;
}

// Derives a readable note title from a markdown filename when frontmatter has no title.
function titleFromFile(filePath) {
  return path
    .basename(filePath, ".md")
    .replace(/^\d{4}-\d{2}-\d{2}-/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

// Produces a compact body preview for lists and search results.
function excerpt(body) {
  return body.replace(/\s+/g, " ").trim().slice(0, 220);
}

// Collapses a title into a comparable key for backlink and related-note matching.
function normalizeTitle(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Extracts meaningful title tokens for lightweight related-note scoring.
function titleTokens(value) {
  return normalizeTitle(value)
    .split(" ")
    .filter((token) => token.length > 3);
}

// Finds Obsidian-style wiki links so Orbiter can build backlinks.
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

// Finds markdown links that target .md files inside the workspace.
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

// Builds the searchable text blob for a note record.
function noteText(note) {
  return [note.title, note.type, note.path, note.body, ...note.tags].join(" ").toLowerCase();
}

// Detects the explicit mobile command trigger word.
function isCommandText(text) {
  return /\bCOMMAND\b/i.test(String(text ?? "")) || Boolean(slashCommandName(text));
}

// Detects slash commands such as /itinerary at the start of a mobile capture.
function slashCommandName(text) {
  const match = String(text ?? "").trim().match(/^\/([a-z][a-z0-9-]*)\b/i);
  return match?.[1]?.toLowerCase() ?? "";
}

// Removes the command trigger prefix while preserving the user's actual prompt.
function commandTextFrom(rawText) {
  const slashName = slashCommandName(rawText);
  if (slashName === "itinerary") {
    const detail = String(rawText ?? "").trim().replace(/^\/itinerary\b\s*/i, "").trim();
    return ["Run /itinerary: import travel Gmail and regenerate the travel itinerary.", detail].filter(Boolean).join("\n\n");
  }

  const cleaned = String(rawText ?? "")
    .replace(/\bCOMMAND\b\s*[:\-]?\s*/i, "")
    .trim();

  return cleaned || String(rawText ?? "").trim();
}

// Maps a note path into the domain node used by the knowledge graph.
function graphDomain(notePath) {
  const parts = notePath.split("/");
  if (parts[0] === "knowledge" && parts[1]) {
    return `knowledge/${parts[1]}`;
  }
  if (parts[0] === "usernotes" && parts[1] && !parts[1].endsWith(".md")) {
    return `usernotes/${parts[1]}`;
  }
  return parts[0] || "workspace";
}

// Converts notes, tags, domains, and explicit links into graph nodes and edges.
function buildKnowledgeGraph(notes) {
  const nodes = new Map();
  const edges = new Map();
  const byTitle = new Map(notes.map((note) => [normalizeTitle(note.title), note]));
  const byPath = new Map(notes.map((note) => [note.path.replace(/\\/g, "/"), note]));

  // Adds a node or increments its count when multiple notes point at the same concept.
  function addNode(node) {
    const existing = nodes.get(node.id);
    if (existing) {
      existing.count = (existing.count ?? 1) + (node.count ?? 1);
      return existing;
    }
    nodes.set(node.id, node);
    return node;
  }

  // Adds a weighted edge, merging duplicate relationships into a single graph edge.
  function addEdge(source, target, type, weight = 1) {
    if (!source || !target || source === target) {
      return;
    }
    const id = `${source}->${target}:${type}`;
    const existing = edges.get(id);
    if (existing) {
      existing.weight += weight;
      return;
    }
    edges.set(id, { id, source, target, type, weight });
  }

  for (const note of notes) {
    addNode({
      id: note.id,
      label: note.title,
      type: "note",
      path: note.path,
      noteType: note.type,
      count: 1
    });

    const domain = graphDomain(note.path);
    const domainId = `domain:${domain}`;
    addNode({
      id: domainId,
      label: domain,
      type: "domain",
      count: 1
    });
    addEdge(note.id, domainId, "in-domain", 2);

    for (const tag of note.tags) {
      const tagId = `tag:${tag}`;
      addNode({
        id: tagId,
        label: tag,
        type: "tag",
        count: 1
      });
      addEdge(note.id, tagId, "tagged", 1);
    }

    for (const linkedTitle of note.outgoingLinks) {
      const target = byTitle.get(normalizeTitle(linkedTitle));
      if (target) {
        addEdge(note.id, target.id, "wiki-link", 4);
      }
    }

    for (const linkedPath of note.outgoingPaths) {
      const target = byPath.get(linkedPath);
      if (target) {
        addEdge(note.id, target.id, "markdown-link", 4);
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    nodeCount: nodes.size,
    edgeCount: edges.size,
    nodes: [...nodes.values()],
    edges: [...edges.values()]
  };
}

// Recursively lists markdown files under a directory, ignoring missing folders.
async function walkMarkdown(dir) {
  const files = [];

  // Visits a directory depth-first and records markdown files for later parsing.
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

// Chooses a non-conflicting file path by appending a counter when needed.
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

// Resolves and validates a workspace-relative markdown path before mutation.
function resolveNotePath(relativePath) {
  const normalized = String(relativePath ?? "").replace(/\\/g, "/");
  if (!normalized || !normalized.endsWith(".md") || normalized.includes("..")) {
    throw Object.assign(new Error("Invalid note path."), { statusCode: 400 });
  }

  const filePath = path.resolve(workspace, normalized);
  const allowed = deletableRoots.some((root) => {
    const resolvedRoot = path.resolve(root);
    return filePath === resolvedRoot || filePath.startsWith(`${resolvedRoot}${path.sep}`);
  });

  if (!allowed) {
    throw Object.assign(new Error("Note path is outside deletable note folders."), { statusCode: 403 });
  }

  return filePath;
}

// Narrows path validation to command files only.
function resolveCommandPath(relativePath) {
  const filePath = resolveNotePath(relativePath);
  const resolvedRoot = path.resolve(commandsDir);

  if (!filePath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw Object.assign(new Error("Command path is outside commands folder."), { statusCode: 403 });
  }

  return filePath;
}

// Narrows path validation to outbound email draft records only.
function resolveEmailDraftPath(relativePath) {
  const filePath = resolveNotePath(relativePath);
  const resolvedRoot = path.resolve(emailDraftsDir);

  if (!filePath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw Object.assign(new Error("Email draft path is outside outbox/email/drafts."), { statusCode: 403 });
  }

  return filePath;
}

// Deletes a validated markdown record from one of Orbiter's mutable note roots.
async function deleteNote(relativePath) {
  const filePath = resolveNotePath(relativePath);
  const info = await stat(filePath);

  if (!info.isFile()) {
    throw Object.assign(new Error("Note path is not a file."), { statusCode: 400 });
  }

  await unlink(filePath);
  invalidateWorkspaceCache();
  return path.relative(workspace, filePath).replace(/\\/g, "/");
}

// Moves an email draft through the explicit browser approval workflow.
async function updateEmailDraftStatus(relativePath, status, actor = null) {
  const allowedStatuses = new Set(["draft", "approved", "rejected"]);
  if (!allowedStatuses.has(status)) {
    throw Object.assign(new Error("Invalid email draft status."), { statusCode: 400 });
  }

  const filePath = resolveEmailDraftPath(relativePath);
  const markdown = await readFile(filePath, "utf8");
  const { fields } = parseFrontmatter(markdown);

  if (fields.type !== "email-draft") {
    throw Object.assign(new Error("File is not an email draft."), { statusCode: 400 });
  }
  if (fields.status === "sent") {
    throw Object.assign(new Error("Sent drafts cannot be changed."), { statusCode: 400 });
  }

  const timestamp = new Date().toISOString();
  const updates = { status, email_updated_at: timestamp };
  if (status === "approved") {
    updates.email_approved_at = timestamp;
    updates.email_approved_by = actor?.id || "local";
    updates.email_approved_by_name = actor?.name || "local user";
  }
  if (status === "rejected") {
    updates.email_rejected_at = timestamp;
    updates.email_rejected_by = actor?.id || "local";
    updates.email_rejected_by_name = actor?.name || "local user";
  }

  await writeFile(filePath, updateMarkdownFrontmatter(markdown, updates), "utf8");
  invalidateWorkspaceCache();
  return path.relative(workspace, filePath).replace(/\\/g, "/");
}

// Sends an approved draft through the existing SMTP pipeline and refreshes workspace caches.
async function sendApprovedEmailDraft(relativePath, confirmSend) {
  const filePath = resolveEmailDraftPath(relativePath);
  const relativeDraftPath = path.relative(workspace, filePath).replace(/\\/g, "/");
  const result = await sendEmailDraft(relativeDraftPath, {
    confirmSend: confirmSend === "SEND",
    requireStatus: "approved"
  });
  invalidateWorkspaceCache();
  return result;
}

// Rewrites frontmatter fields without changing the markdown body.
function updateMarkdownFrontmatter(markdown, updates) {
  const { fields, body } = parseFrontmatter(markdown);
  return `${frontmatter({ ...fields, ...updates })}\n${body.trim()}\n`;
}

// Loads or creates the shared secret used by the iPhone Shortcut endpoint.
async function getMobileToken() {
  try {
    return (await readFile(mobileTokenPath, "utf8")).trim();
  } catch {
    await mkdir(orbiterDir, { recursive: true });
    const token = randomBytes(24).toString("hex");
    await writeFile(mobileTokenPath, `${token}\n`, "utf8");
    return token;
  }
}

// Authenticates mobile captures with either a per-user access token or legacy mobile token.
async function authenticateMobileRequest(req) {
  const accessToken = accessTokenFromRequest(req);
  if (accessToken) {
    const user = await findUserByAccessToken(accessToken);
    if (user) {
      return user;
    }
  }

  const expectedToken = await getMobileToken();
  const headerToken = req.headers["x-orbiter-mobile-token"];
  const authorization = req.headers.authorization ?? "";
  const bearerToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const providedToken = Array.isArray(headerToken) ? headerToken[0] : headerToken || bearerToken;

  if (providedToken !== expectedToken) {
    throw Object.assign(new Error("Invalid mobile token."), { statusCode: 401 });
  }

  return null;
}

// Allows sensitive browser actions only for admins when production auth is enabled.
function requireAdmin(actor, policy) {
  if (!policy.authRequired) {
    return;
  }
  if (!actor) {
    throw Object.assign(new Error("Authentication required."), { statusCode: 401, code: "auth_required" });
  }
  if (actor.role !== "admin") {
    throw Object.assign(new Error("Admin access is required."), { statusCode: 403, code: "admin_required" });
  }
}

// Blocks Codex command creation and lifecycle operations for trusted non-admin users.
function requireCommandOperator(actor, policy) {
  if (!policy.authRequired) {
    return;
  }
  if (!actor) {
    throw Object.assign(new Error("Authentication required."), { statusCode: 401, code: "auth_required" });
  }
  if (actor.role !== "admin") {
    throw Object.assign(new Error("Admin access is required to operate Codex commands."), { statusCode: 403, code: "admin_required" });
  }
}

// Keeps private command prompts and lifecycle history admin-only in production auth mode.
function canReadCommandSurface(actor, policy) {
  return !policy.authRequired || actor?.role === "admin";
}

// Returns an empty command model for non-admin users instead of leaking command text.
function commandsForActor(commands, actor, policy) {
  return canReadCommandSurface(actor, policy) ? commands : [];
}

// Restricts destructive shared-workspace actions until per-user note ownership exists.
function requireDestructiveWorkspaceOperator(actor, policy) {
  if (!policy.authRequired) {
    return;
  }
  if (!actor) {
    throw Object.assign(new Error("Authentication required."), { statusCode: 401, code: "auth_required" });
  }
  if (actor.role !== "admin") {
    throw Object.assign(new Error("Admin access is required for destructive workspace changes."), { statusCode: 403, code: "admin_required" });
  }
}

// Applies role-based visibility to note-like read models before API responses leave the server.
function notesForActor(notes, actor, policy) {
  if (!policy.authRequired) {
    return notes;
  }

  const visibleNotes = filterNotesForActor(notes, actor, policy)
    .map((note) => ({ ...note, backlinks: [], relatedNotes: [] }));

  buildRelationships(visibleNotes);
  return visibleNotes.map((note) => ({ ...note, searchText: noteText(note) }));
}

// Reads all notes, then returns only the records the current user may see.
async function readNotesForActor(actor, policy) {
  return notesForActor(await readAllNotes(), actor, policy);
}

// Computes backlinks and related-note suggestions across all parsed notes.
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

// Reads every markdown-backed record Orbiter treats as searchable note data.
async function readAllNotes() {
  const startedAt = Date.now();
  if (workspaceCacheTtlMs > 0 && notesCache.notes && notesCache.expiresAt > startedAt) {
    return notesCache.notes;
  }

  const files = [
    ...await walkMarkdown(usernotesDir),
    ...await walkMarkdown(commandsDir),
    ...await walkMarkdown(inboxDir),
    ...await walkMarkdown(outboxDir),
    ...await walkMarkdown(knowledgeDir),
    ...await walkMarkdown(journalDir),
    ...await walkMarkdown(issuesJournalDir)
  ];
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
      status: fields.status || "",
      tags: splitTags(fields.tags || path.dirname(relativePath).replace(/\\/g, "/")),
      createdAt: fields.created || fields.date || "",
      owner: fields.owner || "",
      ownerName: fields.owner_name || "",
      from: fields.from || "",
      to: fields.to || "",
      cc: fields.cc || "",
      bcc: fields.bcc || "",
      subject: fields.subject || "",
      sentAt: fields.sent_at || "",
      emailApprovedAt: fields.email_approved_at || "",
      emailApprovedByName: fields.email_approved_by_name || "",
      accountId: fields.account_id || fields.account || "",
      importanceLabel: fields.importance_label || "",
      importanceScore: fields.importance_score || "",
      importanceReasons: fields.importance_reasons || "",
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

  const sortedNotes = notes
    .map((note) => ({ ...note, searchText: noteText(note) }))
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)) || left.title.localeCompare(right.title));

  if (workspaceCacheTtlMs > 0) {
    notesCache = {
      expiresAt: Date.now() + workspaceCacheTtlMs,
      generatedAt: new Date().toISOString(),
      notes: sortedNotes
    };
  }

  return sortedNotes;
}

// Creates a browser-captured note in the inbox folder, or a command in commands/inbox.
async function createNote({ title, body = "", type = "note", tags = [] }, actor = null) {
  const cleanTitle = String(title ?? "").trim();
  if (!cleanTitle) {
    throw Object.assign(new Error("Title is required."), { statusCode: 400 });
  }

  const noteType = String(type || "note").trim() || "note";
  const isCommand = noteType === "command";
  const targetDir = isCommand ? commandInboxDir : inboxDir;
  const defaultTag = isCommand ? "command" : "inbox";

  await mkdir(targetDir, { recursive: true });
  const created = new Date().toISOString();
  const filename = `${today()}-${slugify(cleanTitle)}.md`;
  const filePath = await uniqueFilePath(targetDir, filename);
  const tagList = splitTags(tags).join(", ") || defaultTag;
  const content = `${frontmatter({
    title: cleanTitle,
    type: noteType,
    tags: tagList,
    created,
    owner: actor?.id,
    owner_name: actor?.name
  })}\n${String(body ?? "").trim()}\n`;

  await writeFile(filePath, content, "utf8");
  invalidateWorkspaceCache();
  return path.relative(workspace, filePath).replace(/\\/g, "/");
}

// Uses the first non-empty capture line as a human-readable title.
function titleFromCapture(text) {
  const firstLine = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    return "Mobile Capture";
  }

  return firstLine.slice(0, 70);
}

// Stores an incoming mobile capture, routing COMMAND text into the command queue.
async function createMobileCapture({ text, skill = "capture", source = "iphone-back-tap", tags = [] }, actor = null, policy = { authRequired: false }) {
  const rawText = String(text ?? "").trim();
  if (!rawText) {
    throw Object.assign(new Error("Capture text is required."), { statusCode: 400 });
  }

  if (isCommandText(rawText)) {
    if (policy.authRequired && actor?.role !== "admin") {
      throw Object.assign(new Error("Admin access is required to create Codex commands."), { statusCode: 403, code: "admin_required" });
    }
    return createMobileCommand({ text: rawText, skill: slashCommandName(rawText) || skill, source, tags }, actor);
  }

  await mkdir(mobileUsernotesDir, { recursive: true });

  const capturedAt = getLocalTime();
  const cleanSkill = String(skill || "capture").trim() || "capture";
  const cleanSource = String(source || "iphone-back-tap").trim() || "iphone-back-tap";
  const title = titleFromCapture(rawText);
  const tagList = [...new Set(["usernotes", "mobile", "iphone", `skill-${slugify(cleanSkill)}`, ...splitTags(tags)])];
  const filename = `${capturedAt.localDate}-${capturedAt.localTime.replace(/:/g, "")}-${slugify(title)}.md`;
  const filePath = await uniqueFilePath(mobileUsernotesDir, filename);
  const content = `${frontmatter({
    title,
    type: "usernote",
    tags: tagList.join(", "),
    created: capturedAt.iso,
    local_created: capturedAt.localDateTime,
    source: cleanSource,
    skill_trigger: cleanSkill,
    owner: actor?.id,
    owner_name: actor?.name
  })}

# Raw Capture

${rawText}

# Processing Hint

- Skill: ${cleanSkill}
- Source: ${cleanSource}
- Owner: ${actor?.name ?? "mobile-token"}
- Captured: ${capturedAt.localDateTime} ${capturedAt.timeZone}
`;

  await writeFile(filePath, content, "utf8");
  invalidateWorkspaceCache();

  return {
    kind: "note",
    path: path.relative(workspace, filePath).replace(/\\/g, "/"),
    title,
    capturedAt
  };
}

// Stores a mobile command as a pending review item instead of a regular note.
async function createMobileCommand({ text, skill = "command", source = "iphone-back-tap", tags = [] }, actor = null) {
  const rawText = String(text ?? "").trim();
  const commandText = commandTextFrom(rawText);
  const capturedAt = getLocalTime();
  const cleanSkill = String(slashCommandName(rawText) || skill || "command").trim() || "command";
  const cleanSource = String(source || "iphone-back-tap").trim() || "iphone-back-tap";
  const title = titleFromCapture(commandText);
  const tagList = [...new Set(["command", "mobile", "iphone", `skill-${slugify(cleanSkill)}`, ...splitTags(tags)])];

  await mkdir(commandInboxDir, { recursive: true });

  const filename = `${capturedAt.localDate}-${capturedAt.localTime.replace(/:/g, "")}-${slugify(title)}.md`;
  const filePath = await uniqueFilePath(commandInboxDir, filename);
  const content = `${frontmatter({
    title,
    type: "command",
    status: "pending",
    tags: tagList.join(", "),
    created: capturedAt.iso,
    local_created: capturedAt.localDateTime,
    source: cleanSource,
    skill_trigger: cleanSkill,
    owner: actor?.id,
    owner_name: actor?.name
  })}

# Command

${commandText}

# Raw Capture

${rawText}

# Execution Notes

- Status: pending
- Codex should review before running.
- Owner: ${actor?.name ?? "mobile-token"}
- Captured: ${capturedAt.localDateTime} ${capturedAt.timeZone}
`;

  await writeFile(filePath, content, "utf8");
  invalidateWorkspaceCache();

  return {
    kind: "command",
    path: path.relative(workspace, filePath).replace(/\\/g, "/"),
    title,
    command: commandText,
    capturedAt
  };
}

// Creates a command from the authenticated browser app or a remote access token.
async function createRemoteCommand({ command, text, title, skill = "codex", source = "orbiter-browser", tags = [] }, actor = null) {
  const commandText = String(command ?? text ?? "").trim();
  if (!commandText) {
    throw Object.assign(new Error("Command text is required."), { statusCode: 400 });
  }

  const capturedAt = getLocalTime();
  const cleanSkill = String(skill || "codex").trim() || "codex";
  const cleanSource = String(source || "orbiter-browser").trim() || "orbiter-browser";
  const cleanTitle = String(title || titleFromCapture(commandText)).trim();
  const ownerTag = actor?.id ? `user-${slugify(actor.id)}` : "user-local";
  const tagList = [...new Set(["command", "remote", "codex", ownerTag, `skill-${slugify(cleanSkill)}`, ...splitTags(tags)])];

  await mkdir(commandInboxDir, { recursive: true });

  const filename = `${capturedAt.localDate}-${capturedAt.localTime.replace(/:/g, "")}-${slugify(cleanTitle)}.md`;
  const filePath = await uniqueFilePath(commandInboxDir, filename);
  const content = `${frontmatter({
    title: cleanTitle,
    type: "command",
    status: "pending",
    tags: tagList.join(", "),
    created: capturedAt.iso,
    local_created: capturedAt.localDateTime,
    source: cleanSource,
    skill_trigger: cleanSkill,
    owner: actor?.id,
    owner_name: actor?.name
  })}

# Command

${commandText}

# Execution Notes

- Status: pending
- Submitted from: ${cleanSource}
- Owner: ${actor?.name ?? "local user"}
- Codex should review before running.
- Captured: ${capturedAt.localDateTime} ${capturedAt.timeZone}
`;

  await writeFile(filePath, content, "utf8");
  invalidateWorkspaceCache();

  return {
    kind: "command",
    path: path.relative(workspace, filePath).replace(/\\/g, "/"),
    title: cleanTitle,
    command: commandText,
    capturedAt
  };
}

// Extracts the command prompt section from a command markdown record.
function extractCommandBody(body) {
  const match = body.match(/# Command\s+([\s\S]*?)(?:\n# |$)/);
  return (match?.[1] ?? body).trim();
}

// Reads command records and returns the metadata needed by the Commands UI.
async function readCommands() {
  const startedAt = Date.now();
  if (workspaceCacheTtlMs > 0 && commandsCache.commands && commandsCache.expiresAt > startedAt) {
    return commandsCache.commands;
  }

  const files = await walkMarkdown(commandsDir);
  const commands = [];

  for (const file of files) {
    const markdown = await readFile(file, "utf8");
    const { fields, body } = parseFrontmatter(markdown);
    const relativePath = path.relative(workspace, file).replace(/\\/g, "/");
    commands.push({
      id: slugify(relativePath),
      path: relativePath,
      title: fields.title || titleFromFile(file),
      status: fields.status || "pending",
      source: fields.source || "",
      skillTrigger: fields.skill_trigger || "",
      owner: fields.owner || "",
      ownerName: fields.owner_name || "",
      createdAt: fields.created || "",
      localCreated: fields.local_created || "",
      handoffStarted: fields.codex_handoff_started || "",
      handoffActor: fields.codex_handoff_actor || "",
      handoffActorName: fields.codex_handoff_actor_name || "",
      reviewedAt: fields.codex_reviewed || "",
      requeuedAt: fields.codex_requeued || "",
      completedAt: fields.codex_completed || "",
      rejectedAt: fields.codex_rejected || "",
      updatedAt: fields.codex_updated || "",
      tags: splitTags(fields.tags || "command"),
      command: extractCommandBody(body),
      body
    });
  }

  const sortedCommands = commands.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)) || left.title.localeCompare(right.title));

  if (workspaceCacheTtlMs > 0) {
    commandsCache = {
      expiresAt: Date.now() + workspaceCacheTtlMs,
      generatedAt: new Date().toISOString(),
      commands: sortedCommands
    };
  }

  return sortedCommands;
}

// Builds a live command-thread timeline from Orbiter-owned command metadata.
async function readCodexHistory(actor = null, policy = { authRequired: false }) {
  const canReadCommands = canReadCommandSurface(actor, policy);
  if (!canReadCommands) {
    return {
      generatedAt: new Date().toISOString(),
      runningCount: 0,
      reviewedCount: 0,
      accessRestricted: true,
      events: []
    };
  }

  const commands = await readCommands();
  const events = [];

  function pushEvent(command, type, timestamp, label, detail = "") {
    if (!timestamp) {
      return;
    }
    events.push({
      id: `${command.path}:${type}:${timestamp}`,
      type,
      timestamp,
      title: command.title,
      path: command.path,
      status: command.status,
      owner: command.ownerName || command.owner || "",
      label,
      detail,
      prompt: command.command || ""
    });
  }

  for (const command of commands) {
    pushEvent(command, "created", command.createdAt, "Command queued", command.source ? `Source: ${command.source}` : "");
    pushEvent(command, "reviewed", command.reviewedAt || (command.status === "reviewed" ? command.updatedAt : ""), "Approved for Codex", "Ready for Codex handoff.");
    pushEvent(command, "claimed", command.handoffStarted, "Claimed by Codex", command.handoffActorName ? `Claimed by ${command.handoffActorName}.` : "Claimed by the Codex runner.");
    pushEvent(command, "requeued", command.requeuedAt, "Returned to Ready", "Command was moved back from In Codex to Ready.");
    pushEvent(command, "done", command.completedAt, "Completed by Codex", "Marked done after Codex verification.");
    pushEvent(command, "rejected", command.rejectedAt, "Rejected", "Marked rejected.");
  }

  events.sort((left, right) => String(right.timestamp).localeCompare(String(left.timestamp)) || left.title.localeCompare(right.title));

  return {
    generatedAt: new Date().toISOString(),
    runningCount: commands.filter((command) => String(command.status || "").toLowerCase() === "running").length,
    reviewedCount: commands.filter((command) => String(command.status || "").toLowerCase() === "reviewed").length,
    events: events.slice(0, 80)
  };
}

// Validates and persists command lifecycle changes.
async function updateCommandStatus(relativePath, status) {
  const allowedStatuses = new Set(["pending", "reviewed", "running", "done", "rejected"]);
  if (!allowedStatuses.has(status)) {
    throw Object.assign(new Error("Invalid command status."), { statusCode: 400 });
  }

  const filePath = resolveCommandPath(relativePath);
  const markdown = await readFile(filePath, "utf8");
  const { fields } = parseFrontmatter(markdown);

  if (fields.type !== "command") {
    throw Object.assign(new Error("File is not a command."), { statusCode: 400 });
  }

  const updates = { status };
  const timestamp = new Date().toISOString();
  if (status === "done") {
    updates.codex_completed = timestamp;
  } else if (status === "rejected") {
    updates.codex_rejected = timestamp;
  } else if (status === "reviewed") {
    updates.codex_reviewed = timestamp;
    updates.codex_updated = timestamp;
  } else {
    updates.codex_updated = timestamp;
  }
  if (status === "reviewed" && String(fields.status || "").toLowerCase() === "running") {
    updates.codex_requeued = timestamp;
  }

  await writeFile(filePath, updateMarkdownFrontmatter(markdown, updates), "utf8");
  invalidateCommandCache();
  return path.relative(workspace, filePath).replace(/\\/g, "/");
}

// Claims the next reviewed command for Codex without exposing arbitrary shell execution.
async function claimCodexHandoff(input = {}, actor = null) {
  const previewOnly = input.noClaim === true || input.preview === true;
  const command = await claimNextCodexCommand({
    path: String(input.path || ""),
    status: "reviewed",
    noClaim: previewOnly,
    actor
  });

  if (!command) {
    return null;
  }

  invalidateCommandCache();
  return {
    path: command.path,
    title: command.title,
    status: command.status,
    skill: command.skill,
    source: command.source,
    owner: command.owner,
    created: command.created,
    prompt: command.command,
    claimed: !previewOnly,
    output: formatCodexHandoff(command)
  };
}

// Imports uploaded markdown files into the inbox while preserving their content.
async function importMarkdown(files) {
  if (!Array.isArray(files)) {
    throw Object.assign(new Error("files must be an array."), { statusCode: 400 });
  }

  await mkdir(inboxDir, { recursive: true });
  const imported = [];

  for (const file of files) {
    const filename = String(file.filename ?? "imported.md");
    const markdown = String(file.markdown ?? "");
    const { fields } = parseFrontmatter(markdown);
    const title = fields.title || titleFromFile(filename);
    const outputName = `${today()}-${slugify(title)}.md`;
    const filePath = await uniqueFilePath(inboxDir, outputName);
    await writeFile(filePath, markdown.endsWith("\n") ? markdown : `${markdown}\n`, "utf8");
    imported.push(path.relative(workspace, filePath).replace(/\\/g, "/"));
  }

  invalidateWorkspaceCache();
  return imported;
}

// Reads assistant skill manifests from skills/*/SKILL.md.
async function readSkills() {
  const entries = await readdir(skillsDir, { withFileTypes: true });
  const skills = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const skillPath = path.join(skillsDir, entry.name, "SKILL.md");
    const markdown = await readFile(skillPath, "utf8");
    const { fields, body } = parseFrontmatter(markdown);
    const firstParagraph = body
      .split(/\r?\n\r?\n/)
      .map((part) => part.replace(/^# .*\r?\n?/, "").trim())
      .find(Boolean);

    skills.push({
      name: fields.name || entry.name,
      description: fields.description || firstParagraph || "",
      path: path.relative(workspace, skillPath).replace(/\\/g, "/")
    });
  }

  return skills.sort((left, right) => left.name.localeCompare(right.name));
}

function emptyTravelItinerary(sourceFolder = "inbox/email/gmail-travel") {
  return {
    generatedAt: "",
    sourceFolder,
    itemCount: 0,
    items: []
  };
}

function normalizeTravelItinerary(payload, sourceFolder) {
  return {
    generatedAt: payload.generatedAt ?? "",
    sourceFolder: payload.sourceFolder ?? sourceFolder,
    itemCount: Number(payload.itemCount ?? payload.items?.length ?? 0),
    items: Array.isArray(payload.items) ? payload.items : []
  };
}

// Loads a generated travel itinerary model without exposing shared plans to guests.
async function readTravelItinerary(actor = null) {
  const cleanId = slugify(actor?.id || "");
  const scopedPath = scopedTravelItineraryPath(cleanId);
  const scopedSource = cleanId ? `inbox/email/user-${cleanId}` : "";

  if (actor?.role === "guest" || (actor && actor.role !== "admin" && actor.role !== "wife")) {
    if (!scopedPath) {
      return emptyTravelItinerary(scopedSource || "user-scoped travel email");
    }
    try {
      return normalizeTravelItinerary(JSON.parse(await readFile(scopedPath, "utf8")), scopedSource);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      return emptyTravelItinerary(scopedSource);
    }
  }

  if (actor?.role === "wife" && scopedPath) {
    try {
      return normalizeTravelItinerary(JSON.parse(await readFile(scopedPath, "utf8")), scopedSource);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  try {
    const raw = await readFile(travelItineraryPath, "utf8");
    return normalizeTravelItinerary(JSON.parse(raw), "inbox/email/gmail-travel");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    return emptyTravelItinerary("inbox/email/gmail-travel");
  }
}

// Counts records by a normalized key while keeping empty values grouped explicitly.
function countBy(items, selectKey) {
  return items.reduce((counts, item) => {
    const key = String(selectKey(item) || "unknown").toLowerCase();
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

// Returns the oldest command in a status bucket so the dashboard can show the next likely action.
function oldestCommandByStatus(commands, status) {
  const target = String(status || "").toLowerCase();
  return commands
    .filter((command) => String(command.status || "pending").toLowerCase() === target)
    .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)) || left.title.localeCompare(right.title))[0] ?? null;
}

// Flags commands that have been claimed for Codex long enough to deserve human review.
function staleRunningCommands(commands, maxAgeHours = 6) {
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  const now = Date.now();
  return commands.filter((command) => {
    if (String(command.status || "").toLowerCase() !== "running" || !command.handoffStarted) {
      return false;
    }
    const claimedAt = new Date(command.handoffStarted).getTime();
    return Number.isFinite(claimedAt) && now - claimedAt > maxAgeMs;
  });
}

// Pulls concise travel health from the generated itinerary model.
function travelSummary(travelItinerary) {
  const items = Array.isArray(travelItinerary.items) ? travelItinerary.items : [];
  const byType = countBy(items, (item) => item.type || item.category || "unknown");
  const needsReview = items.filter((item) => item.needsReview || item.needs_review || String(item.confidence || "").toLowerCase() === "low" || !item.start);
  const cities = [...new Set(items.map((item) => item.city || item.location || "").filter(Boolean))].slice(0, 8);

  return {
    generatedAt: travelItinerary.generatedAt || "",
    sourceFolder: travelItinerary.sourceFolder || "",
    itemCount: Number(travelItinerary.itemCount ?? items.length),
    byType,
    needsReviewCount: needsReview.length,
    cities,
    needsReview: needsReview.slice(0, 8).map((item) => ({
      title: item.title || item.summary || "Travel item",
      type: item.type || item.category || "unknown",
      start: item.start || item.date || "",
      reason: item.reviewReason || item.review_reason || item.confidenceReason || "Weak or incomplete itinerary parse."
    }))
  };
}

// Produces human-readable next steps from the aggregate runtime snapshot.
function commandCenterRecommendations({ commands, notes, travel, environment, graph }) {
  const recommendations = [];
  const commandCounts = countBy(commands, (command) => command.status || "pending");
  const staleRunning = staleRunningCommands(commands);
  const draftCounts = countBy(notes.filter((note) => note.type === "email-draft"), (note) => note.status || "draft");

  if ((commandCounts.reviewed || 0) > 0) {
    recommendations.push(`${commandCounts.reviewed} command${commandCounts.reviewed === 1 ? "" : "s"} ready for Codex handoff.`);
  }
  if (staleRunning.length) {
    recommendations.push(`${staleRunning.length} In Codex command${staleRunning.length === 1 ? "" : "s"} claimed for more than 6 hours; verify or requeue.`);
  }
  if ((draftCounts.approved || 0) > 0) {
    recommendations.push(`${draftCounts.approved} approved outbound email draft${draftCounts.approved === 1 ? "" : "s"} waiting to send.`);
  }
  if (travel.needsReviewCount > 0) {
    recommendations.push(`${travel.needsReviewCount} travel itinerary item${travel.needsReviewCount === 1 ? "" : "s"} need review before the trip operating view is reliable.`);
  }
  if (environment.location?.configured === false || environment.weather?.status === "not_configured") {
    recommendations.push("Configure local weather coordinates so the environment widget can provide real status checks.");
  }
  if ((graph.nodeCount || 0) > 75) {
    recommendations.push("Knowledge graph is dense enough to start adding saved graph focus presets for faster navigation.");
  }
  if (!recommendations.length) {
    recommendations.push("No urgent operating gaps detected from the current Orbiter read models.");
  }

  return recommendations;
}

// Builds the hidden dev Command Center read model without mutating the workspace.
async function readCommandCenter(actor, policy) {
  const [notes, commands, codex, travelItinerary, environment] = await Promise.all([
    readNotesForActor(actor, policy),
    readCommands(),
    readCodexHistory(actor, policy),
    readTravelItinerary(actor),
    readEnvironment()
  ]);
  const visibleCommands = commandsForActor(commands, actor, policy);
  const graph = buildKnowledgeGraph(notes);
  const commandCounts = countBy(visibleCommands, (command) => command.status || "pending");
  const noteTypeCounts = countBy(notes, (note) => note.type || "note");
  const draftCounts = countBy(notes.filter((note) => note.type === "email-draft"), (note) => note.status || "draft");
  const staleRunning = staleRunningCommands(visibleCommands);
  const travel = travelSummary(travelItinerary);

  return {
    generatedAt: new Date().toISOString(),
    runtime: {
      environment: runtimeEnvironment,
      publicOrigin,
      host,
      port,
      uptimeSeconds: Math.round(process.uptime()),
      authRequired: policy.authRequired,
      networkGuard: policy.networkGuard,
      features: featureFlags()
    },
    actor: actor ? {
      id: actor.id,
      name: actor.name,
      role: actor.role,
      dataScope: actor.dataScope || "",
      authProvider: actor.authProvider || "access-token"
    } : null,
    counts: {
      notes: notes.length,
      noteTypes: noteTypeCounts,
      commands: visibleCommands.length,
      commandStatuses: commandCounts,
      emailDraftStatuses: draftCounts,
      graphNodes: graph.nodeCount,
      graphEdges: graph.edgeCount,
      travelItems: travel.itemCount
    },
    queue: {
      pendingCount: commandCounts.pending || 0,
      reviewedCount: commandCounts.reviewed || 0,
      runningCount: commandCounts.running || 0,
      doneCount: commandCounts.done || 0,
      rejectedCount: commandCounts.rejected || 0,
      nextReviewed: oldestCommandByStatus(visibleCommands, "reviewed"),
      staleRunning: staleRunning.slice(0, 8)
    },
    codex,
    travel,
    environment,
    recommendations: commandCenterRecommendations({
      commands: visibleCommands,
      notes,
      travel,
      environment,
      graph
    })
  };
}

// Reads and parses a JSON request body with a simple size guard.
async function readJson(req) {
  const chunks = [];
  let byteLength = 0;
  for await (const chunk of req) {
    chunks.push(chunk);
    byteLength += chunk.byteLength;
    if (byteLength > 2_000_000) {
      throw Object.assign(new Error("Request body is too large."), { statusCode: 413 });
    }
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("Invalid JSON request body."), { statusCode: 400, code: "invalid_json" });
  }
}

// Sends a formatted JSON response with the correct content type.
function sendJson(res, statusCode, value, headers = {}) {
  res.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-orbiter-api-version": apiVersion,
    ...securityHeaders(headers)
  });
  res.end(`${JSON.stringify(value, null, 2)}\n`);
}

// Sends JSON-compatible response headers for HEAD probes without writing a body.
function sendJsonHead(res, statusCode, headers = {}) {
  res.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-orbiter-api-version": apiVersion,
    ...securityHeaders(headers)
  });
  res.end();
}

// Converts thrown route errors into API responses without leaking internals.
function sendError(res, error) {
  const statusCode = error.statusCode ?? 500;
  sendJson(res, statusCode, {
    error: error.statusCode ? error.message : "Internal server error",
    code: error.code || (statusCode >= 500 ? "internal_error" : "request_error"),
    statusCode
  });
}

// Routes all /api/* requests and keeps endpoint behavior centralized.
async function handleApi(req, res, url, context = {}) {
  const actor = context.actor ?? null;
  const policy = context.policy ?? { authRequired: false, networkGuard: "off" };

  if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/api/health") {
    if (req.method === "HEAD") {
      sendJsonHead(res, 200);
      return;
    }

    sendJson(res, 200, {
      ok: true,
      apiVersion,
      workspace: actor || !policy.authRequired ? workspace : "protected",
      authRequired: policy.authRequired,
      networkGuard: policy.networkGuard,
      cache: cacheState()
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/session") {
    sendJson(res, 200, {
      authRequired: policy.authRequired,
      authenticated: Boolean(actor),
      user: actor,
      networkGuard: policy.networkGuard,
      remoteAddress: remoteAddress(req),
      environment: runtimeEnvironment,
      runtime: {
        environment: runtimeEnvironment,
        publicOrigin,
        host,
        port
      },
      features: featureFlags()
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/google/oauth/status") {
    sendJson(res, 200, await googleOAuthStatus(req));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/google/oauth/start") {
    const authUrl = await googleOAuthStartUrl(req, {
      returnTo: url.searchParams.get("returnTo") || "/",
      popup: url.searchParams.get("popup") || false
    });
    res.writeHead(302, securityHeaders({ location: authUrl }));
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/google/oauth/callback") {
    const completed = await completeGoogleOAuth(req, url);
    const session = await createAccessSession(completed.user);
    let importResult = null;
    let importError = "";
    try {
      importResult = await importGoogleTravelForUser(completed.user);
      invalidateWorkspaceCache();
    } catch (error) {
      importError = error.message;
    }

    const destination = completed.state.popup ? "/login.html" : completed.state.returnTo || "/";
    const redirect = new URL(destination, "http://orbiter.local");
    redirect.searchParams.set("google", "connected");
    if (importResult) {
      redirect.searchParams.set("imported", String(importResult.importedCount));
      redirect.searchParams.set("items", String(importResult.itinerary?.itemCount ?? 0));
    }
    if (importError) {
      redirect.searchParams.set("import_error", importError.slice(0, 180));
    }
    if (completed.state.popup) {
      redirect.searchParams.set("popup", "1");
    }

    res.writeHead(302, securityHeaders({
      location: `${redirect.pathname}${redirect.search}`,
      "set-cookie": sessionCookie(session.sessionToken, session.expiresAt, { secure: requestIsHttps(req) })
    }));
    res.end();
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/session/login") {
    const { token } = await readJson(req);
    const user = await findUserByAccessToken(token);
    if (!user) {
      throw Object.assign(new Error("Invalid access token."), { statusCode: 401 });
    }

    const session = await createAccessSession(user);
    sendJson(res, 200, {
      authenticated: true,
      user,
      expiresAt: session.expiresAt
    }, {
      "set-cookie": sessionCookie(session.sessionToken, session.expiresAt, { secure: requestIsHttps(req) })
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/session/logout") {
    const logoutUser = await userFromSessionCookieIncludingInactive(req.headers.cookie ?? "");
    await revokeAccessSession(req.headers.cookie ?? "");
    const purge = await purgeEphemeralUserData(logoutUser);
    sendJson(res, 200, { authenticated: false, purge }, { "set-cookie": clearSessionCookie() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/time") {
    sendJson(res, 200, getLocalTime());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/environment") {
    sendJson(res, 200, await readEnvironment());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/command-center") {
    if (!featureEnabled("commandCenter")) {
      sendJson(res, 404, { error: "Feature not enabled.", code: "feature_not_enabled", statusCode: 404 });
      return;
    }
    requireAdmin(actor, policy);
    sendJson(res, 200, await readCommandCenter(actor, policy));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/notes") {
    const notes = await readNotesForActor(actor, policy);
    sendJson(res, 200, { generatedAt: new Date().toISOString(), noteCount: notes.length, notes });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/graph") {
    const notes = await readNotesForActor(actor, policy);
    sendJson(res, 200, buildKnowledgeGraph(notes));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/commands") {
    sendJson(res, 200, { commands: commandsForActor(await readCommands(), actor, policy) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/codex/history") {
    sendJson(res, 200, await readCodexHistory(actor, policy));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/email/drafts") {
    requireAdmin(actor, policy);
    const draft = await createEmailDraft(await readJson(req), actor);
    invalidateWorkspaceCache();
    const notes = await readNotesForActor(actor, policy);
    sendJson(res, 201, { draft, noteCount: notes.length, notes });
    return;
  }

  if (req.method === "PATCH" && url.pathname === "/api/email/drafts") {
    requireAdmin(actor, policy);
    const { path: draftPath, status } = await readJson(req);
    const updated = await updateEmailDraftStatus(draftPath, status, actor);
    const notes = await readNotesForActor(actor, policy);
    sendJson(res, 200, { updated, noteCount: notes.length, notes });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/email/drafts/send") {
    requireAdmin(actor, policy);
    const { path: draftPath, confirmSend } = await readJson(req);
    const sent = await sendApprovedEmailDraft(draftPath, confirmSend);
    const notes = await readNotesForActor(actor, policy);
    sendJson(res, 200, { sent, noteCount: notes.length, notes });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/commands") {
    requireCommandOperator(actor, policy);
    const created = await createRemoteCommand(await readJson(req), actor);
    sendJson(res, 201, { created, commands: commandsForActor(await readCommands(), actor, policy) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/codex/next") {
    requireAdmin(actor, policy);
    const handoff = await claimCodexHandoff(await readJson(req), actor);
    sendJson(res, 200, {
      handoff,
      message: handoff
        ? handoff.claimed
          ? `Claimed for Codex: ${handoff.title}`
          : `Prepared handoff preview: ${handoff.title}. Status remains Ready for Codex.`
        : "No reviewed commands ready for Codex handoff.",
      commands: commandsForActor(await readCommands(), actor, policy)
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/travel/itinerary") {
    sendJson(res, 200, await readTravelItinerary(actor));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/google/travel/import") {
    if (!actor) {
      throw Object.assign(new Error("Authentication required."), { statusCode: 401, code: "auth_required" });
    }
    const result = await importGoogleTravelForUser(actor, await readJson(req));
    invalidateWorkspaceCache();
    const notes = await readNotesForActor(actor, policy);
    sendJson(res, 200, {
      ...result,
      travelItinerary: await readTravelItinerary(actor),
      noteCount: notes.length,
      notes
    });
    return;
  }

  if (req.method === "PATCH" && url.pathname === "/api/commands") {
    requireCommandOperator(actor, policy);
    const { path: commandPath, status } = await readJson(req);
    const updated = await updateCommandStatus(commandPath, status);
    sendJson(res, 200, { updated, commands: commandsForActor(await readCommands(), actor, policy) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/notes") {
    const payload = await readJson(req);
    if (String(payload.type || "note").trim() === "command") {
      requireCommandOperator(actor, policy);
    }
    const relativePath = await createNote(payload, actor);
    const notes = await readNotesForActor(actor, policy);
    sendJson(res, 201, { path: relativePath, noteCount: notes.length, notes });
    return;
  }

  if (req.method === "DELETE" && url.pathname === "/api/notes") {
    requireDestructiveWorkspaceOperator(actor, policy);
    const { path: notePath } = await readJson(req);
    const deleted = await deleteNote(notePath);
    const notes = await readNotesForActor(actor, policy);
    sendJson(res, 200, { deleted, noteCount: notes.length, notes });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/import") {
    requireDestructiveWorkspaceOperator(actor, policy);
    const { files } = await readJson(req);
    const imported = await importMarkdown(files);
    const notes = await readNotesForActor(actor, policy);
    sendJson(res, 201, { imported, noteCount: notes.length, notes });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/mobile/capture") {
    const mobileActor = await authenticateMobileRequest(req);
    const capture = await createMobileCapture(await readJson(req), mobileActor, policy);
    const notes = await readNotesForActor(mobileActor, policy);
    sendJson(res, 201, { capture, noteCount: notes.length });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/search") {
    const query = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
    const notes = await readNotesForActor(actor, policy);
    const results = query ? notes.filter((note) => note.searchText.includes(query)) : notes;
    sendJson(res, 200, { query, noteCount: results.length, notes: results });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/skills") {
    sendJson(res, 200, { skills: canReadCommandSurface(actor, policy) ? await readSkills() : [] });
    return;
  }

  sendJson(res, 404, { error: "API route not found.", code: "not_found", statusCode: 404 });
}

// Resolves a browser URL to a safe file under app/.
function resolveStatic(url) {
  const pathname = decodeURIComponent(url.pathname);
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(appRoot, `.${requested}`);

  if (filePath !== appRoot && !filePath.startsWith(`${appRoot}${path.sep}`)) {
    return null;
  }

  return filePath;
}

// Serves the browser app's static files from disk.
async function handleStatic(req, res, url) {
  const filePath = resolveStatic(url);

  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "cache-control": "no-store",
      "content-type": contentTypes.get(path.extname(filePath)) ?? "application/octet-stream",
      ...securityHeaders()
    });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

// Dispatches each HTTP request to either the API layer or the static file server.
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${host}:${port}`);

  try {
    const policy = await accessPolicy();
    if (!hostAllowed(req)) {
      if (url.pathname.startsWith("/api/")) {
        sendJson(res, 403, { error: "Request host is not allowed.", code: "host_not_allowed", statusCode: 403 });
      } else {
        res.writeHead(403, securityHeaders({ "content-type": "text/plain; charset=utf-8" }));
        res.end("Request host is not allowed.");
      }
      return;
    }

    if (!originAllowed(req)) {
      sendJson(res, 403, { error: "Request origin is not allowed.", code: "origin_not_allowed", statusCode: 403 });
      return;
    }

    if (!networkAllowed(req, policy)) {
      if (url.pathname.startsWith("/api/")) {
        sendJson(res, 403, {
          error: "Orbiter production mode only accepts loopback or Tailscale clients.",
          code: "network_guard",
          statusCode: 403
        });
      } else {
        res.writeHead(403, securityHeaders({ "content-type": "text/plain; charset=utf-8" }));
        res.end("Orbiter production mode only accepts loopback or Tailscale clients.");
      }
      return;
    }

    const actor = await sessionActor(req);
    if (policy.authRequired && !actor && !isPublicApiPath(url) && !isPublicStaticPath(url)) {
      if (url.pathname.startsWith("/api/")) {
        sendJson(res, 401, { error: "Authentication required.", code: "auth_required", statusCode: 401 });
      } else if (isAppRootPath(url)) {
        await handleStatic(req, res, new URL("/login.html", `http://${host}:${port}`));
      } else {
        res.writeHead(302, securityHeaders({ location: "/login.html" }));
        res.end();
      }
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url, { actor, policy });
      return;
    }

    await handleStatic(req, res, url);
  } catch (error) {
    sendError(res, error);
  }
});

server.listen(port, host, () => {
  console.log(`Orbiter backend is running at http://${host}:${port}`);
});
