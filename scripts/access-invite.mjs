import {
  createAccessUser,
  findUserByAccessToken,
  readAccessUsers,
  rotateAccessToken,
  slugifyAccessId
} from "./access-control.mjs";
import { createEmailDraft } from "./email-draft-core.mjs";

const [, , command = "draft", ...args] = process.argv;

// Parses npm-forwarded flags for creating a token-backed local invite.
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

// Treats string booleans from npm/PowerShell as actual booleans.
function enabled(value) {
  return value === true || ["1", "true", "yes", "on"].includes(String(value ?? "").toLowerCase());
}

// Builds a warm token email while making the privacy boundary explicit.
function inviteBody({ name, token, role, publicOrigin, ephemeral }) {
  const accessMode = ephemeral
    ? "This is a temporary guest doorway. When you log out, Orbiter can remove your guest travel data from the local system."
    : "This access is tied to your Orbiter user.";

  return `## Your Orbiter access is ready

Hi ${name},

This is Orbit. Nitro set up a test Orbiter account for you.

Open ${publicOrigin} and paste this secret access token when Orbiter asks for it:

**${token}**

What this lets you do:

- Sign in without Google
- Use the Orbiter guest travel-planning flow
- Keep your data separate from Nitro's owner workspace

Account type: ${role}

${accessMode}

Keep this token private. Anyone with it can sign in as this Orbiter user until Nitro rotates or removes the token.

- Orbit, sent on Nitro's behalf`;
}

// Creates or rotates a local access user and stages an invite email draft.
async function draftInvite(values) {
  const options = parseArgs(values);
  const id = slugifyAccessId(options.id || options._[0] || options.name || "");
  const name = String(options.name || id || "").trim();
  const to = String(options.to || "").trim();
  const role = String(options.role || "guest").trim().toLowerCase();
  const ephemeral = options.ephemeral === undefined ? true : enabled(options.ephemeral);
  const dataScope = String(options["data-scope"] || options.dataScope || (ephemeral ? "ephemeral" : "shared")).trim().toLowerCase();
  const publicOrigin = String(options.origin || process.env.ORBITER_PUBLIC_ORIGIN || "https://example.com").replace(/\/$/, "");

  if (!id || !name || !to) {
    throw new Error("Usage: npm run access:invite -- --id mom --name \"Mom\" --to recipient@example.com");
  }

  const existing = (await readAccessUsers()).find((user) => user.id === id);
  let createdOrRotated;
  if (existing) {
    if (!enabled(options.rotate)) {
      throw new Error(`Access user already exists: ${id}. Pass --rotate true to replace the token and draft a fresh invite.`);
    }
    createdOrRotated = await rotateAccessToken(id);
  } else {
    createdOrRotated = await createAccessUser({ id, name, role, ephemeral, dataScope });
  }

  const verified = await findUserByAccessToken(createdOrRotated.token);
  if (!verified || verified.id !== createdOrRotated.user.id) {
    throw new Error("Created access token did not verify against the access store.");
  }

  const draft = await createEmailDraft({
    account: options.account || "gmail-primary",
    to,
    subject: options.subject || "Your Orbiter access is ready",
    body: inviteBody({
      name: createdOrRotated.user.name,
      token: createdOrRotated.token,
      role: createdOrRotated.user.role,
      publicOrigin,
      ephemeral: createdOrRotated.user.ephemeral
    })
  });

  console.log(existing ? `Rotated access user: ${createdOrRotated.user.id}` : `Created access user: ${createdOrRotated.user.id}`);
  console.log(`Name: ${createdOrRotated.user.name}`);
  console.log(`Role: ${createdOrRotated.user.role}`);
  console.log(`Ephemeral: ${createdOrRotated.user.ephemeral ? "yes" : "no"}`);
  console.log(`Data scope: ${createdOrRotated.user.dataScope}`);
  console.log(`Created invite draft: ${draft.path}`);
  console.log(`From: ${draft.from}`);
  console.log(`To: ${draft.to.join(", ")}`);
  console.log(`Subject: ${draft.subject}`);
  console.log("Status: draft-only; token included in the local draft and was not printed.");
}

try {
  if (command === "draft") {
    await draftInvite(args);
  } else {
    console.log("Usage: npm run access:invite -- --id mom --name \"Mom\" --to recipient@example.com");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
