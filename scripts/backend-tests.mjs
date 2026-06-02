import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = process.env.ORBITER_URL ?? "http://127.0.0.1:4173";
const runId = `backend-test-${Date.now()}`;
const createdPaths = [];
const mobileToken = await readMobileToken();
let sessionCookie = "";

// Sends a JSON request to the running backend and raises route-level failures.
async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      "content-type": "application/json",
      ...(sessionCookie ? { cookie: sessionCookie } : {}),
      ...options.headers
    },
    ...options
  });
  const body = await response.json();

  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} failed: ${body.error ?? response.status}`);
  }

  return body;
}

// Logs into production-mode Orbiter when a test token is provided.
async function loginForTests() {
  const sessionResponse = await fetch(`${baseUrl}/api/session`, {
    headers: sessionCookie ? { cookie: sessionCookie } : undefined
  });
  const session = await sessionResponse.json();
  if (!session.authRequired || session.authenticated) {
    return session;
  }

  if (!process.env.ORBITER_TEST_ACCESS_TOKEN) {
    return session;
  }

  const loginResponse = await fetch(`${baseUrl}/api/session/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: process.env.ORBITER_TEST_ACCESS_TOKEN })
  });
  const loginBody = await loginResponse.json();
  if (!loginResponse.ok) {
    throw new Error(`Test login failed: ${loginBody.error ?? loginResponse.status}`);
  }

  sessionCookie = loginResponse.headers.get("set-cookie")?.split(";")[0] ?? "";
  return request("/api/session");
}

// Keeps test assertions small and dependency-free.
function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// Reads the mobile token only when it already exists, so tests do not create setup state.
async function readMobileToken() {
  try {
    return (await readFile(path.join(workspace, ".orbiter", "mobile-token"), "utf8")).trim();
  } catch {
    return "";
  }
}

// Deletes any records created during the test run, even if a later assertion fails.
async function cleanup() {
  for (const notePath of createdPaths.reverse()) {
    try {
      await request("/api/notes", {
        method: "DELETE",
        body: JSON.stringify({ path: notePath })
      });
    } catch (error) {
      console.warn(`cleanup failed for ${notePath}: ${error.message}`);
    }
  }
}

// Exercises the core backend flows as an integration test against the running server.
try {
  const health = await request("/api/health");
  assert(health.apiVersion === "v1", "health should expose API version");
  assert(health.cache?.ttlMs !== undefined, "health should expose cache metadata");

  const session = await loginForTests();
  if (session.authRequired && !session.authenticated) {
    const blocked = await fetch(`${baseUrl}/api/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: `Blocked ${runId}` })
    });
    const blockedBody = await blocked.json();
    assert(blocked.status === 401, "protected writes should require auth in production mode");
    assert(blockedBody.code === "auth_required", "blocked protected writes should return auth_required");
    console.log(`Backend auth-boundary tests passed for ${baseUrl}. Set ORBITER_TEST_ACCESS_TOKEN for full mutation tests in production mode.`);
  } else {

  const invalidJson = await fetch(`${baseUrl}/api/notes`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(sessionCookie ? { cookie: sessionCookie } : {})
    },
    body: "{"
  });
  const invalidJsonBody = await invalidJson.json();
  assert(invalidJson.status === 400, "invalid JSON should return 400");
  assert(invalidJsonBody.error === "Invalid JSON request body.", "invalid JSON should return a useful error");

  const created = await request("/api/notes", {
    method: "POST",
    body: JSON.stringify({
      title: `Backend Test Create ${runId}`,
      body: `Search marker ${runId}`,
      type: "note",
      tags: ["backend-test"]
    })
  });
  createdPaths.push(created.path);
  assert(created.path.startsWith("inbox/"), "created note should land in inbox");

  const search = await request(`/api/search?q=${encodeURIComponent(runId)}`);
  assert(search.notes.some((note) => note.path === created.path), "created note should be searchable");

  const imported = await request("/api/import", {
    method: "POST",
    body: JSON.stringify({
      files: [
        {
          filename: `${runId}-target.md`,
          markdown: `---\ntitle: Backend Test Target ${runId}\ntype: note\ntags: backend-test\ncreated: 2026-05-30\n---\n\nTarget body.`
        },
        {
          filename: `${runId}-link.md`,
          markdown: `---\ntitle: Backend Test Link ${runId}\ntype: note\ntags: backend-test\ncreated: 2026-05-30\n---\n\nLinks to [[Backend Test Target ${runId}]].`
        }
      ]
    })
  });
  createdPaths.push(...imported.imported);
  assert(imported.imported.length === 2, "import should create two markdown files");

  const notes = await request("/api/notes");
  const target = notes.notes.find((note) => note.title === `Backend Test Target ${runId}`);
  const link = notes.notes.find((note) => note.title === `Backend Test Link ${runId}`);
  assert(target, "target note should exist after import");
  assert(link, "link note should exist after import");
  assert(target.backlinks.includes(link.title), "target should include backlink from link note");
  assert(link.relatedNotes.some((note) => note.title === target.title), "link note should suggest target as related");

  const graph = await request("/api/graph");
  assert(graph.nodes.some((node) => node.label === target.title), "graph should include imported target note");
  assert(graph.edges.some((edge) => edge.type === "wiki-link"), "graph should include wiki-link edges");

  const travel = await request("/api/travel/itinerary");
  assert(Array.isArray(travel.items), "travel itinerary endpoint should expose items array");

  const session = await request("/api/session");
  assert(typeof session.authRequired === "boolean", "session endpoint should expose auth mode");

  if (!session.authRequired || session.user?.role === "admin") {
    const draft = await request("/api/email/drafts", {
      method: "POST",
      body: JSON.stringify({
        account: "gmail-primary",
        to: "test-recipient@example.com",
        subject: `Backend Test Draft ${runId}`,
        body: `Draft-only email body ${runId}`
      })
    });
    createdPaths.push(draft.draft.path);
    assert(draft.draft.path.startsWith("outbox/email/drafts/"), "email draft should land in outbox drafts");
    assert(Boolean(draft.draft.from), "email draft should use the configured sender account");
    assert(draft.draft.to.includes("test-recipient@example.com"), "email draft should target the requested recipient");
  }

  const remoteCommand = await request("/api/commands", {
    method: "POST",
    body: JSON.stringify({
      command: `Upgrade Orbiter backend test command ${runId}`,
      skill: "codex",
      source: "backend-test"
    })
  });
  createdPaths.push(remoteCommand.created.path);
  assert(remoteCommand.created.kind === "command", "remote command should create command record");
  assert(remoteCommand.created.path.startsWith("commands/inbox/"), "remote command should land in command inbox");

  if (!session.authRequired || session.user?.role === "admin") {
    await request("/api/commands", {
      method: "PATCH",
      body: JSON.stringify({
        path: remoteCommand.created.path,
        status: "reviewed"
      })
    });

    const codexPreview = await request("/api/codex/next", {
      method: "POST",
      body: JSON.stringify({ path: remoteCommand.created.path, noClaim: true })
    });
    assert(codexPreview.handoff?.path === remoteCommand.created.path, "codex preview should return the requested reviewed command");
    assert(codexPreview.handoff?.status === "reviewed", "codex preview should not mark the command running");
    assert(codexPreview.handoff?.claimed === false, "codex preview should report that it did not claim the command");

    const afterPreview = await request("/api/commands");
    assert(
      afterPreview.commands.some((command) => command.path === remoteCommand.created.path && command.status === "reviewed"),
      "commands API should keep previewed command reviewed"
    );

    const codexHandoff = await request("/api/codex/next", {
      method: "POST",
      body: JSON.stringify({ path: remoteCommand.created.path })
    });
    assert(codexHandoff.handoff?.path === remoteCommand.created.path, "codex handoff should claim the requested reviewed command");
    assert(codexHandoff.handoff?.status === "running", "codex handoff should mark the command running");
    assert(codexHandoff.handoff?.output.includes("ORBITER_CODEX_HANDOFF"), "codex handoff should return the CLI handoff format");
  }

  // When mobile setup exists, also verify COMMAND captures enter the command queue.
  if (mobileToken) {
    const mobileCommand = await request("/api/mobile/capture", {
      method: "POST",
      headers: {
        "x-orbiter-mobile-token": mobileToken
      },
      body: JSON.stringify({
        text: `COMMAND classify backend test command ${runId}`,
        skill: "capture",
        source: "backend-test"
      })
    });
    createdPaths.push(mobileCommand.capture.path);
    assert(mobileCommand.capture.kind === "command", "COMMAND capture should be classified as command");
    assert(mobileCommand.capture.path.startsWith("commands/inbox/"), "command capture should land in commands inbox");

    const commands = await request("/api/commands");
    assert(commands.commands.some((command) => command.path === mobileCommand.capture.path), "commands API should include mobile command");

    const updatedCommand = await request("/api/commands", {
      method: "PATCH",
      body: JSON.stringify({
        path: mobileCommand.capture.path,
        status: "reviewed"
      })
    });
    assert(updatedCommand.updated === mobileCommand.capture.path, "command status update should return updated path");
    assert(
      updatedCommand.commands.some((command) => command.path === mobileCommand.capture.path && command.status === "reviewed"),
      "commands API should include updated command status"
    );

    const slashCommand = await request("/api/mobile/capture", {
      method: "POST",
      headers: {
        "x-orbiter-mobile-token": mobileToken
      },
      body: JSON.stringify({
        text: `/itinerary ${runId}`,
        source: "backend-test"
      })
    });
    createdPaths.push(slashCommand.capture.path);
    assert(slashCommand.capture.kind === "command", "slash capture should be classified as command");
    assert(slashCommand.capture.command.includes("Run /itinerary"), "slash command should expand into itinerary prompt");
  }

  const deleted = await request("/api/notes", {
    method: "DELETE",
    body: JSON.stringify({ path: created.path })
  });
  createdPaths.splice(createdPaths.indexOf(created.path), 1);
  assert(deleted.deleted === created.path, "delete should return deleted path");

  const afterDelete = await request(`/api/search?q=${encodeURIComponent(`Backend Test Create ${runId}`)}`);
  assert(!afterDelete.notes.some((note) => note.path === created.path), "deleted note should no longer be searchable");

  console.log(`Backend integration tests passed for ${baseUrl}`);
  }
} finally {
  await cleanup();
}
