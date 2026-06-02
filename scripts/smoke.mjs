const baseUrl = process.env.ORBITER_URL ?? "http://127.0.0.1:4173";
let sessionCookie = "";

// Calls an endpoint or static asset and lets each check validate the response shape.
async function check(path, validate, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    redirect: options.redirect ?? "follow",
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(sessionCookie ? { cookie: sessionCookie } : {}),
      ...options.headers
    },
    body: options.body
  });
  const expectedStatus = options.expectStatus ?? 200;

  if (response.status !== expectedStatus) {
    throw new Error(`${path} returned ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (options.expectContentType && !contentType.includes(options.expectContentType)) {
    throw new Error(`${path} returned content type ${contentType || "(none)"}`);
  }
  const body = contentType.includes("application/json")
    ? await response.json()
    : contentType.startsWith("image/")
      ? await response.arrayBuffer()
      : await response.text();
  validate(body);
  console.log(`ok ${path}`);
}

// Verifies HEAD probes separately because they intentionally return no body.
async function checkHead(path, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "HEAD",
    headers: sessionCookie ? { cookie: sessionCookie } : undefined
  });

  if (response.status !== expectedStatus) {
    throw new Error(`HEAD ${path} returned ${response.status}`);
  }

  console.log(`ok HEAD ${path}`);
}

// Reads the current access mode before deciding whether to smoke protected routes.
async function readSession() {
  const response = await fetch(`${baseUrl}/api/session`, {
    headers: sessionCookie ? { cookie: sessionCookie } : undefined
  });
  if (!response.ok) {
    throw new Error(`/api/session returned ${response.status}`);
  }
  return response.json();
}

let session = await readSession();

if (session.authRequired && !session.authenticated && process.env.ORBITER_SMOKE_ACCESS_TOKEN) {
  const response = await fetch(`${baseUrl}/api/session/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: process.env.ORBITER_SMOKE_ACCESS_TOKEN })
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Smoke login failed: ${payload.error ?? response.status}`);
  }
  sessionCookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
  session = await readSession();
}

const canCheckProtectedRoutes = !session.authRequired || session.authenticated;

// Confirms the shell HTML includes the main app and command queue elements.
await check("/", (body) => {
  const page = String(body);
  if (!canCheckProtectedRoutes) {
    if (!page.includes("Orbiter Login") || !page.includes("accessToken")) {
      throw new Error("Unauthenticated production home page should serve the login shell.");
    }
    return;
  }
  if (!page.includes("ORBITER") || !page.includes("emailView") || !page.includes("emailDraftForm") || !page.includes("email-intelligence-panel") || !page.includes("travelView") || !page.includes("travelStats") || !page.includes("travelGaps") || !page.includes("transportationList") || !page.includes("lodgingBars") || !page.includes("environment-widget") || !page.includes("timePhaseIcon") || !page.includes("commandForm") || !page.includes("commandSummary") || !page.includes("codexHistoryList") || !page.includes("resetGraphLayout") || !page.includes("accessView") || !page.includes("commandCount") || page.includes("skillsView")) {
    throw new Error("Home page did not include expected Orbiter UI elements.");
  }
}, canCheckProtectedRoutes ? {} : { redirect: "manual" });

// Confirms the login shell is present for production access mode.
await check("/login.html", (body) => {
  const page = String(body);
  if (!page.includes("Orbiter Login") || !page.includes("accessToken") || !page.includes("./favicon.png")) {
    throw new Error("Login page did not include expected access token form.");
  }
});

if (canCheckProtectedRoutes) {
  // Confirms the browser bundle still references the expected API routes.
  await check("/app.js", (body) => {
    const script = String(body);
    if (!script.includes("/api/time") || !script.includes("/api/environment") || !script.includes("/api/session") || !script.includes("/api/commands") || !script.includes("/api/codex/history") || !script.includes("/api/email/drafts") || !script.includes("/api/email/drafts/send") || !script.includes("/api/travel/itinerary") || !script.includes("renderTravelStats") || !script.includes("renderLodgingBars") || !script.includes("renderEnvironment") || !script.includes("renderCodexHistory") || !script.includes("travelResearchPrompt") || !script.includes("copyChatGptTravelPrompt") || !script.includes("canOperateCodexCommands") || !script.includes("Admin access is required to queue Codex commands.") || !script.includes("graphManualPositions") || !script.includes("pointerdown")) {
      throw new Error("App script did not include expected API calls.");
    }
  });
}

// Confirms the login script can call the session login endpoint.
await check("/login.js", (body) => {
  if (!String(body).includes("/api/session/login")) {
    throw new Error("Login script did not include expected session login API call.");
  }
});

// Confirms the stylesheet includes the newest visible UI surfaces.
await check("/styles.css", (body) => {
  const styles = String(body);
  if (!styles.includes("color-scheme: dark") || !styles.includes(".time-card") || !styles.includes(".time-phase-icon") || !styles.includes(".environment-widget") || !styles.includes(".email-compose") || !styles.includes(".email-intelligence-panel") || !styles.includes(".travel-card") || !styles.includes(".travel-route-card") || !styles.includes(".lodging-bars") || !styles.includes(".travel-gap-actions") || !styles.includes(".codex-history-panel") || !styles.includes("#knowledgeGraph.is-dragging")) {
    throw new Error("Styles did not include expected time and command UI.");
  }
});

// Confirms the browser tab icon is available before and after authentication.
await check("/favicon.png", (body) => {
  if (!(body instanceof ArrayBuffer) && typeof body !== "string") {
    throw new Error("Favicon response had an unexpected body shape.");
  }
}, { expectContentType: "image/png" });

// Confirms the backend process is responding.
await check("/api/health", (body) => {
  if (!body.ok) {
    throw new Error("Health check failed.");
  }
});
await checkHead("/api/health");

// Confirms the session endpoint exposes local development access state.
await check("/api/session", (body) => {
  if (typeof body.authRequired !== "boolean" || typeof body.authenticated !== "boolean") {
    throw new Error("Session response missing access fields.");
  }
});

if (!canCheckProtectedRoutes) {
  await check("/api/time", (body) => {
    if (body.code !== "auth_required") {
      throw new Error("Protected API routes should require auth in production mode.");
    }
  }, { expectStatus: 401 });
} else {
  // Confirms the backend exposes the local time contract the UI depends on.
  await check("/api/time", (body) => {
    for (const key of ["timeZone", "localDate", "localTime", "localDateTime", "iso"]) {
      if (!body[key]) {
        throw new Error(`Time response missing ${key}.`);
      }
    }
  });

  // Confirms the environment widget endpoint returns a stable shape with or without location config.
  await check("/api/environment", (body) => {
    if (!body.location || !body.weather || !body.eclipse) {
      throw new Error("Environment response missing location, weather, or eclipse data.");
    }
    if (typeof body.location.configured !== "boolean" || !body.weather.status || !body.eclipse.status) {
      throw new Error("Environment response missing expected status fields.");
    }
  });

  // Confirms note scanning returns a list shape.
  await check("/api/notes", (body) => {
    if (!Array.isArray(body.notes)) {
      throw new Error("Notes response missing notes array.");
    }
  });

  // Confirms graph generation returns node and edge arrays.
  await check("/api/graph", (body) => {
    if (!Array.isArray(body.nodes) || !Array.isArray(body.edges)) {
      throw new Error("Graph response missing nodes or edges.");
    }
  });

  // Confirms the command queue API is available even when no commands are pending.
  await check("/api/commands", (body) => {
    if (!Array.isArray(body.commands)) {
      throw new Error("Commands response missing commands array.");
    }
  });

  // Confirms the live Codex history endpoint exposes timeline events.
  await check("/api/codex/history", (body) => {
    if (!Array.isArray(body.events) || typeof body.runningCount !== "number") {
      throw new Error("Codex history response missing expected fields.");
    }
  });

  // Confirms the generated travel itinerary endpoint is available for the Travel tab.
  await check("/api/travel/itinerary", (body) => {
    if (!Array.isArray(body.items)) {
      throw new Error("Travel itinerary response missing items array.");
    }
  });

  // Confirms skill discovery is still reading installed skills.
  await check("/api/skills", (body) => {
    if (!Array.isArray(body.skills) || !body.skills.length) {
      throw new Error("Skills response missing skills.");
    }
  });
}

// Confirms mobile capture is write-only and not exposed as a GET route.
await check("/api/mobile/capture", (body) => {
  if (body.error !== "API route not found.") {
    throw new Error("Mobile capture GET should not be a valid route.");
  }
}, { expectStatus: 404 });

if (canCheckProtectedRoutes) {
  // Confirms destructive note operations reject invalid paths.
  await check("/api/notes", (body) => {
    if (body.error !== "Invalid note path.") {
      throw new Error("Delete without path should be rejected.");
    }
  }, { method: "DELETE", body: JSON.stringify({}), expectStatus: 400 });
}

console.log(`Orbiter smoke checks passed for ${baseUrl}`);
