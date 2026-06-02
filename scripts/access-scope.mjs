// Keeps note visibility rules separate from the HTTP server so they can be tested directly.

function normalizedPath(note) {
  return String(note?.path || "").replace(/\\/g, "/");
}

function userScopeId(actor) {
  return String(actor?.id || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

// Identifies records that expose email content or outbound email metadata.
export function isEmailRecord(note) {
  const notePath = normalizedPath(note);
  return note?.type === "email"
    || note?.type === "email-draft"
    || note?.type === "email-sent"
    || notePath.startsWith("inbox/email/")
    || notePath.startsWith("inbox/attachments/email/")
    || notePath.startsWith("outbox/email/")
    || notePath.startsWith("journal/email-sync/")
    || notePath.startsWith("journal/email-sent/");
}

// Identifies command-backed records that can contain prompts for Codex to run.
export function isCommandRecord(note) {
  return note?.type === "command" || normalizedPath(note).startsWith("commands/");
}

// Keeps the wife role limited to the shared travel mailbox instead of the owner's primary mail.
export function wifeCanReadEmailRecord(note) {
  const accountId = String(note?.accountId || "").toLowerCase();
  return accountId === "gmail-travel" || normalizedPath(note).startsWith("inbox/email/gmail-travel/");
}

// Detects records written into a user's isolated data roots.
export function noteBelongsToUserScope(note, actor) {
  const cleanId = userScopeId(actor);
  if (!cleanId) {
    return false;
  }

  const notePath = normalizedPath(note);
  return [
    `inbox/email/user-${cleanId}/`,
    `inbox/attachments/email/user-${cleanId}/`,
    `outbox/email/drafts/user-${cleanId}/`,
    `journal/email-sync/user-${cleanId}/`,
    `journal/email-sent/user-${cleanId}/`,
    `knowledge/projects/travel/users/${cleanId}/`
  ].some((prefix) => notePath.startsWith(prefix));
}

// Applies role-based visibility before note-like API responses leave the server.
export function filterNotesForActor(notes, actor, policy) {
  if (!policy?.authRequired) {
    return notes;
  }

  const role = actor?.role || "";
  return notes
    .filter((note) => role === "admin" || !isCommandRecord(note))
    .filter((note) => role !== "guest" || noteBelongsToUserScope(note, actor))
    .filter((note) => role !== "wife" || !isEmailRecord(note) || wifeCanReadEmailRecord(note))
    .filter((note) => ["admin", "wife"].includes(role) || !isEmailRecord(note) || noteBelongsToUserScope(note, actor));
}
