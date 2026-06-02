import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = process.env.ORBITER_URL ?? "http://127.0.0.1:4173";
const token = (await readFile(path.join(workspace, ".orbiter", "mobile-token"), "utf8")).trim();

// Sends a real authenticated mobile capture through the same route the iPhone uses.
const response = await fetch(`${baseUrl}/api/mobile/capture`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-orbiter-mobile-token": token
  },
  body: JSON.stringify({
    text: "Mobile capture smoke test",
    skill: "capture",
    source: "mobile-test"
  })
});

const body = await response.json();

// Fail loudly when the endpoint rejects the test request.
if (!response.ok) {
  throw new Error(body.error || `Mobile capture failed with ${response.status}`);
}

// Verify that non-command captures still land in the mobile usernotes folder.
if (!body.capture?.path?.startsWith("usernotes/mobile/")) {
  throw new Error("Mobile capture did not write to usernotes/mobile.");
}

console.log(`ok mobile capture ${body.capture.path}`);
