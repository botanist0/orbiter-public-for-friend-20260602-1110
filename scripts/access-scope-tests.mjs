import { filterNotesForActor } from "./access-scope.mjs";

const policy = { authRequired: true };
const notes = [
  { path: "inbox/email/gmail-primary/ad.md", type: "email", title: "Owner primary email" },
  { path: "inbox/email/gmail-travel/hotel.md", type: "email", accountId: "gmail-travel", title: "Shared travel email" },
  { path: "inbox/email/user-mom/hotel.md", type: "email", title: "Mom travel email" },
  { path: "knowledge/projects/travel/users/mom/itinerary.md", type: "note", title: "Mom itinerary" },
  { path: "commands/inbox/command.md", type: "command", title: "Owner command" },
  { path: "knowledge/research/public.md", type: "note", title: "Shared note" }
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function visiblePaths(actor) {
  return filterNotesForActor(notes, actor, policy).map((note) => note.path);
}

const adminPaths = visiblePaths({ id: "nitro", role: "admin" });
assert(adminPaths.length === notes.length, "admin should see all records");

const wifePaths = visiblePaths({ id: "wife", role: "wife" });
assert(wifePaths.includes("inbox/email/gmail-travel/hotel.md"), "wife should see shared travel email");
assert(!wifePaths.includes("inbox/email/gmail-primary/ad.md"), "wife should not see owner primary email");
assert(!wifePaths.includes("commands/inbox/command.md"), "wife should not see command records");

const memberPaths = visiblePaths({ id: "household-member", role: "member" });
assert(!memberPaths.includes("inbox/email/gmail-primary/ad.md"), "member should not see owner primary email");
assert(!memberPaths.includes("inbox/email/gmail-travel/hotel.md"), "member should not see shared travel email by default");
assert(memberPaths.includes("knowledge/research/public.md"), "member should see non-email, non-command notes");
assert(!memberPaths.includes("commands/inbox/command.md"), "member should not see command records");

const guestPaths = visiblePaths({ id: "mom", role: "guest" });
assert(guestPaths.includes("inbox/email/user-mom/hotel.md"), "guest should see own scoped email");
assert(guestPaths.includes("knowledge/projects/travel/users/mom/itinerary.md"), "guest should see own scoped itinerary");
assert(!guestPaths.includes("knowledge/research/public.md"), "guest should not see shared owner notes");
assert(!guestPaths.includes("inbox/email/gmail-primary/ad.md"), "guest should not see owner primary email");
assert(!guestPaths.includes("commands/inbox/command.md"), "guest should not see command records");

const devPaths = filterNotesForActor(notes, null, { authRequired: false }).map((note) => note.path);
assert(devPaths.length === notes.length, "local development mode should remain unfiltered");

console.log("Access scope tests passed.");
