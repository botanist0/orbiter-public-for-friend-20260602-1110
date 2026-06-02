/**
 * Lambda function wrapper for /api/notes endpoint.
 * 
 * Handles:
 * - GET /api/notes → list all notes (mock)
 * - POST /api/notes → create a note (mock)
 * - DELETE /api/notes → delete a note (mock)
 * 
 * Auth: Bearer token validation (mock)
 * CORS: Configured via API Gateway
 */

export async function handler(event, context) {
  console.log("Event:", JSON.stringify(event, null, 2));

  const httpMethod = event.httpMethod || event.requestContext?.http?.method;
  const path = event.path || event.rawPath || "";
  const headers = event.headers || {};
  const body = event.body ? JSON.parse(event.body) : null;

  // Simple CORS headers (API Gateway should also handle this)
  const responseHeaders = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  };

  // Handle CORS preflight
  if (httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: responseHeaders,
      body: "",
    };
  }

  try {
    // Mock auth: validate Bearer token
    const authHeader = headers.authorization || headers.Authorization || "";
    if (!authHeader.startsWith("Bearer ")) {
      console.warn("Missing or invalid auth header");
      return {
        statusCode: 401,
        headers: responseHeaders,
        body: JSON.stringify({
          error: "Unauthorized",
          code: "auth_required",
        }),
      };
    }

    const token = authHeader.slice(7);
    // In production, validate against AWS Secrets Manager or external auth service
    if (token !== process.env.VALID_TOKEN && process.env.VALID_TOKEN) {
      console.warn("Invalid token:", token);
      return {
        statusCode: 403,
        headers: responseHeaders,
        body: JSON.stringify({
          error: "Forbidden",
          code: "invalid_token",
        }),
      };
    }

    // Route requests
    switch (httpMethod) {
      case "GET":
        return handleGetNotes(responseHeaders);
      case "POST":
        return handlePostNote(body, responseHeaders);
      case "DELETE":
        return handleDeleteNote(body, responseHeaders);
      default:
        return {
          statusCode: 405,
          headers: responseHeaders,
          body: JSON.stringify({ error: "Method not allowed" }),
        };
    }
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      headers: responseHeaders,
      body: JSON.stringify({
        error: "Internal server error",
        message: error.message,
      }),
    };
  }
}

/**
 * GET /api/notes - list all notes (mock)
 */
function handleGetNotes(headers) {
  const mockNotes = [
    {
      path: "inbox/2026-05-31-plan-to-host-orbiter-on-lambda-solutions.md",
      title: "Plan to host Orbiter on Lambda Solutions",
      type: "plan",
      tags: ["hosting", "lambda", "aws"],
      createdAt: "2026-05-31T10:00:00Z",
      body: "Initial plan for serverless hosting...",
      excerpt: "Plan to host Orbiter on Lambda Solutions",
      backlinks: [],
      relatedNotes: [],
    },
    {
      path: "knowledge/areas/second-brain.md",
      title: "Second Brain Area",
      type: "area",
      tags: ["knowledge", "personal"],
      createdAt: "2026-05-15T09:00:00Z",
      body: "Orbiter is a local-first second brain...",
      excerpt: "Orbiter is a local-first second brain",
      backlinks: ["inbox/2026-05-31-plan-to-host-orbiter-on-lambda-solutions.md"],
      relatedNotes: [],
    },
  ];

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      notes: mockNotes,
      count: mockNotes.length,
    }),
  };
}

/**
 * POST /api/notes - create a note (mock)
 */
function handlePostNote(body, headers) {
  const { title, body: noteBody, type, tags } = body || {};

  if (!title) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: "Bad request",
        message: "title is required",
      }),
    };
  }

  const newNote = {
    path: `inbox/2026-05-31-${title.toLowerCase().replace(/\s+/g, "-")}.md`,
    title,
    type: type || "note",
    tags: tags || [],
    createdAt: new Date().toISOString(),
    body: noteBody || "",
  };

  console.log("Created note:", newNote);

  return {
    statusCode: 201,
    headers,
    body: JSON.stringify({
      notes: [newNote],
      created: newNote.path,
    }),
  };
}

/**
 * DELETE /api/notes - delete a note (mock)
 */
function handleDeleteNote(body, headers) {
  const { path } = body || {};

  if (!path) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: "Bad request",
        message: "path is required",
      }),
    };
  }

  console.log("Deleted note:", path);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      deleted: path,
      notes: [], // In production, return remaining notes
    }),
  };
}
