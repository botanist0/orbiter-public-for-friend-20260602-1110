const api = {
  // Loads every indexed markdown-backed record that the app can display.
  async getNotes() {
    return request("/api/notes");
  },
  // Loads the precomputed graph model used by the canvas graph renderer.
  async getGraph() {
    return request("/api/graph");
  },
  // Loads mobile/user commands that are waiting for review or status updates.
  async getCommands() {
    return request("/api/commands");
  },
  // Loads the live Codex activity timeline derived from command lifecycle metadata.
  async getCodexHistory() {
    return request("/api/codex/history");
  },
  // Loads the hidden dev Command Center aggregate when the feature flag is enabled.
  async getCommandCenter() {
    return request("/api/command-center");
  },
  // Loads the active browser session and production access policy.
  async getSession() {
    return request("/api/session");
  },
  // Checks whether Google SSO/Gmail travel import has been configured server-side.
  async getGoogleOAuthStatus() {
    return request("/api/google/oauth/status");
  },
  // Imports Google Gmail travel messages for the signed-in Google user.
  async importGoogleTravel(limit = 100) {
    return request("/api/google/travel/import", {
      method: "POST",
      body: JSON.stringify({ limit })
    });
  },
  // Queues a command for Codex/manual review from the browser app.
  async createCommand(command) {
    return request("/api/commands", {
      method: "POST",
      body: JSON.stringify(command)
    });
  },
  // Loads the generated travel timeline built from the travel Gmail account.
  async getTravelItinerary() {
    return request("/api/travel/itinerary");
  },
  // Reads the backend machine's local clock so the UI reflects Orbiter's host time.
  async getTime() {
    return request("/api/time");
  },
  // Loads local weather and sky-event status for the topbar environment widget.
  async getEnvironment() {
    return request("/api/environment");
  },
  // Creates a local outbound draft record without sending through SMTP.
  async createEmailDraft(draft) {
    return request("/api/email/drafts", {
      method: "POST",
      body: JSON.stringify(draft)
    });
  },
  // Moves an outbound draft into or out of the approved send state.
  async updateEmailDraft(path, status) {
    return request("/api/email/drafts", {
      method: "PATCH",
      body: JSON.stringify({ path, status })
    });
  },
  // Sends an approved outbound draft through the backend SMTP guard.
  async sendEmailDraft(path) {
    return request("/api/email/drafts/send", {
      method: "POST",
      body: JSON.stringify({ path, confirmSend: "SEND" })
    });
  },
  // Creates a new inbox note from the capture form.
  async createNote(note) {
    return request("/api/notes", {
      method: "POST",
      body: JSON.stringify(note)
    });
  },
  // Deletes a markdown record by workspace-relative path.
  async deleteNote(path) {
    return request("/api/notes", {
      method: "DELETE",
      body: JSON.stringify({ path })
    });
  },
  // Moves a command through its review lifecycle without changing the command text.
  async updateCommand(path, status) {
    return request("/api/commands", {
      method: "PATCH",
      body: JSON.stringify({ path, status })
    });
  },
  // Prepares or claims the next reviewed command through the bounded admin handoff endpoint.
  async claimCodexNext(options = {}) {
    const payload = typeof options === "string" ? { path: options } : options;
    return request("/api/codex/next", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  // Clears the HttpOnly browser session cookie.
  async logout() {
    return request("/api/session/logout", {
      method: "POST",
      body: JSON.stringify({})
    });
  },
  // Imports browser-selected markdown files into Orbiter's inbox.
  async importMarkdown(files) {
    return request("/api/import", {
      method: "POST",
      body: JSON.stringify({ files })
    });
  },
  // Runs server-side search against the markdown workspace.
  async search(query) {
    const params = new URLSearchParams({ q: query });
    return request(`/api/search?${params}`);
  }
};

let notes = [];
let commands = [];
let codexHistory = { events: [], generatedAt: "", runningCount: 0, reviewedCount: 0 };
let commandCenter = {
  generatedAt: "",
  runtime: {},
  counts: {},
  queue: {},
  codex: { events: [] },
  travel: {},
  recommendations: []
};
let travelItinerary = { items: [] };
let environmentStatus = {
  location: { configured: false, label: "Location not configured" },
  weather: { status: "not_configured", condition: "Weather location needed", icon: "unknown" },
  eclipse: { status: "not_configured", icon: "none", label: "Location required" }
};
let session = { authRequired: false, authenticated: false, user: null, networkGuard: "off" };
let activeInboxFilter = "focused";
let googleOAuth = { configured: false, importLimit: 100 };
let graph = { nodes: [], edges: [] };
let graphPositions = [];
let selectedGraphNode = null;
let graphDrag = null;
const graphLayoutStorageKey = "orbiter.graph.layout.v1";
let graphManualPositions = loadGraphLayout();
const travelShortCatalog = [
  {
    cities: ["Tokyo", "Hakone", "Kyoto", "Osaka", "Koyasan"],
    region: "Japan",
    publisher: "Visit Japan",
    playlist: "UUAF3bpYrvw_3RIkZ3OUnMNA"
  },
  {
    cities: ["Seoul", "Busan"],
    region: "Korea",
    publisher: "Imagine Your Korea",
    playlist: "UUhhOtjq-3QyyLmP2jv9amrg"
  },
  {
    cities: ["Hanoi", "Da Nang", "Ho Chi Minh City", "Hoi An"],
    region: "Vietnam",
    publisher: "Vietnam Tourism",
    userUploads: "vietnamtourismmedia"
  }
];
let travelShortObserver = null;
let travelShortActiveKey = "";

const els = {
  form: document.querySelector("#captureForm"),
  title: document.querySelector("#titleInput"),
  body: document.querySelector("#bodyInput"),
  type: document.querySelector("#typeInput"),
  tags: document.querySelector("#tagsInput"),
  noteCount: document.querySelector("#noteCount"),
  indexCount: document.querySelector("#indexCount"),
  mobileCount: document.querySelector("#mobileCount"),
  emailCount: document.querySelector("#emailCount"),
  travelCount: document.querySelector("#travelCount"),
  connectGoogleTravel: document.querySelector("#connectGoogleTravel"),
  importGoogleTravel: document.querySelector("#importGoogleTravel"),
  googleTravelStatus: document.querySelector("#googleTravelStatus"),
  commandCount: document.querySelector("#commandCount"),
  graphCount: document.querySelector("#graphCount"),
  accessMode: document.querySelector("#accessMode"),
  localTime: document.querySelector("#localTime"),
  timePhaseIcon: document.querySelector("#timePhaseIcon"),
  localDate: document.querySelector("#localDate"),
  localZone: document.querySelector("#localZone"),
  environmentIcon: document.querySelector("#environmentIcon"),
  environmentPrimary: document.querySelector("#environmentPrimary"),
  environmentSecondary: document.querySelector("#environmentSecondary"),
  timeUpdated: document.querySelector("#timeUpdated"),
  noteList: document.querySelector("#noteList"),
  inboxStats: document.querySelector("#inboxStats"),
  inboxFilters: document.querySelector("#inboxFilters"),
  inboxListTitle: document.querySelector("#inboxListTitle"),
  inboxListHint: document.querySelector("#inboxListHint"),
  mobileList: document.querySelector("#mobileList"),
  emailList: document.querySelector("#emailList"),
  emailDraftForm: document.querySelector("#emailDraftForm"),
  emailTo: document.querySelector("#emailTo"),
  emailSubject: document.querySelector("#emailSubject"),
  emailBody: document.querySelector("#emailBody"),
  emailStatus: document.querySelector("#emailStatus"),
  commandList: document.querySelector("#commandList"),
  commandForm: document.querySelector("#commandForm"),
  commandStatus: document.querySelector("#commandStatus"),
  commandSummary: document.querySelector("#commandSummary"),
  codexNext: document.querySelector("#codexNext"),
  copyCodexHandoff: document.querySelector("#copyCodexHandoff"),
  codexHandoffPanel: document.querySelector("#codexHandoffPanel"),
  codexHandoffOutput: document.querySelector("#codexHandoffOutput"),
  codexHistoryMeta: document.querySelector("#codexHistoryMeta"),
  codexHistoryList: document.querySelector("#codexHistoryList"),
  refreshCodexHistory: document.querySelector("#refreshCodexHistory"),
  commandCenterSync: document.querySelector("#commandCenterSync"),
  commandCenterHero: document.querySelector("#commandCenterHero"),
  commandCenterMetrics: document.querySelector("#commandCenterMetrics"),
  commandCenterQueue: document.querySelector("#commandCenterQueue"),
  commandCenterRecommendations: document.querySelector("#commandCenterRecommendations"),
  commandCenterActivity: document.querySelector("#commandCenterActivity"),
  refreshCommandCenter: document.querySelector("#refreshCommandCenter"),
  searchInput: document.querySelector("#searchInput"),
  searchResults: document.querySelector("#searchResults"),
  clearReviewed: document.querySelector("#clearReviewed"),
  refreshMobile: document.querySelector("#refreshMobile"),
  refreshEmail: document.querySelector("#refreshEmail"),
  refreshTravel: document.querySelector("#refreshTravel"),
  refreshCommands: document.querySelector("#refreshCommands"),
  refreshGraph: document.querySelector("#refreshGraph"),
  resetGraphLayout: document.querySelector("#resetGraphLayout"),
  graphMode: document.querySelector("#graphMode"),
  knowledgeGraph: document.querySelector("#knowledgeGraph"),
  graphDetail: document.querySelector("#graphDetail"),
  travelGenerated: document.querySelector("#travelGenerated"),
  travelSource: document.querySelector("#travelSource"),
  travelStats: document.querySelector("#travelStats"),
  travelRoute: document.querySelector("#travelRoute"),
  travelShortPanel: document.querySelector("#travelShortPanel"),
  travelShortTitle: document.querySelector("#travelShortTitle"),
  travelShortMeta: document.querySelector("#travelShortMeta"),
  travelShortLink: document.querySelector("#travelShortLink"),
  travelShortPlayer: document.querySelector("#travelShortPlayer"),
  travelGaps: document.querySelector("#travelGaps"),
  travelGapStatus: document.querySelector("#travelGapStatus"),
  transportationList: document.querySelector("#transportationList"),
  lodgingBars: document.querySelector("#lodgingBars"),
  travelReview: document.querySelector("#travelReview"),
  travelTimeline: document.querySelector("#travelTimeline"),
  accessUser: document.querySelector("#accessUser"),
  accessAuth: document.querySelector("#accessAuth"),
  accessGuard: document.querySelector("#accessGuard"),
  accessRemote: document.querySelector("#accessRemote"),
  accessDataScope: document.querySelector("#accessDataScope"),
  logoutButton: document.querySelector("#logoutButton"),
  markdownImport: document.querySelector("#markdownImport"),
  importStatus: document.querySelector("#importStatus"),
  captureStatus: document.querySelector("#captureStatus"),
  captureSubmit: document.querySelector("#captureSubmit"),
  noteTemplate: document.querySelector("#noteTemplate"),
  commandTemplate: document.querySelector("#commandTemplate"),
  travelTemplate: document.querySelector("#travelTemplate")
};

// Wraps fetch with Orbiter's JSON conventions and raises useful errors for the UI.
async function request(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      ...options.headers
    },
    ...options
  });

  const payload = await response.json();

  if (!response.ok) {
    if (response.status === 401 && payload.code === "auth_required" && window.location.pathname !== "/login.html") {
      window.location.href = "/login.html";
      throw new Error("Authentication required. Redirecting to login.");
    }
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
}

// Converts a comma-separated tags input into the normalized tag array the backend expects.
function splitTags(value) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

// Reads server-owned feature flags; disabled features stay hidden even if their HTML exists.
function featureEnabled(name) {
  return Boolean(session.features?.[name]);
}

// Hides unfinished UI surfaces until the active runtime explicitly enables them.
function applyFeatureVisibility() {
  document.querySelectorAll("[data-feature]").forEach((node) => {
    const enabled = featureEnabled(node.dataset.feature);
    node.hidden = !enabled;
    node.classList.toggle("is-feature-disabled", !enabled);
  });

  const activeView = document.querySelector(".view.is-active");
  const featureName = activeView?.dataset.feature || "";
  if (featureName && !featureEnabled(featureName)) {
    switchView("capture");
  }
}

// Reconstructs a note as markdown so it can be exported from the browser.
function toMarkdown(note) {
  const tags = note.tags.length ? note.tags.join(", ") : "untagged";
  return `---\ntitle: ${note.title}\ntype: ${note.type}\ntags: ${tags}\ncreated: ${note.createdAt}\n---\n\n${note.body || ""}\n`;
}

// Creates a temporary browser download for markdown export without involving the backend.
function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// Produces filesystem-safe names for exported note files.
function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "note";
}

// Renders a list of notes into a target container and wires each card's actions.
function renderNotes(target, noteList) {
  target.replaceChildren();
  const isEmailView = target === els.emailList;

  if (!noteList.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No notes yet.";
    target.append(empty);
    return;
  }

  for (const note of noteList) {
    const node = els.noteTemplate.content.firstElementChild.cloneNode(true);
    node.classList.add(`note-type-${slugify(note.type || "note")}`);
    if (isTravelEmailNote(note)) {
      node.classList.add("note-source-travel");
    } else if (isEmailRecord(note)) {
      node.classList.add("note-source-email");
    } else if (isMobileCapture(note)) {
      node.classList.add("note-source-mobile");
    } else if (isCommandRecord(note)) {
      node.classList.add("note-source-command");
    }
    node.querySelector(".note-meta").textContent = `${note.path} / ${note.type} / ${note.tags.join(", ") || "untagged"}`;
    node.querySelector("h3").textContent = note.title;
    node.querySelector(".note-body").textContent = note.excerpt || note.body || "No body text.";

    const relationList = node.querySelector(".relation-list");
    if (note.type === "email-draft") {
      const status = document.createElement("span");
      status.textContent = `Draft: ${note.status || "draft"}`;
      relationList.append(status);
      if (note.to) {
        const to = document.createElement("span");
        to.textContent = `To: ${note.to}`;
        relationList.append(to);
      }
      if (note.subject) {
        const subject = document.createElement("span");
        subject.textContent = `Subject: ${note.subject}`;
        relationList.append(subject);
      }
    }
    for (const backlink of note.backlinks ?? []) {
      const item = document.createElement("span");
      item.textContent = `Backlink: ${backlink}`;
      relationList.append(item);
    }
    for (const related of note.relatedNotes ?? []) {
      const item = document.createElement("span");
      item.textContent = `Related: ${related.title}`;
      relationList.append(item);
    }
    if (note.importanceLabel) {
      const item = document.createElement("span");
      item.textContent = `Email: ${note.importanceLabel}${note.importanceScore ? ` ${note.importanceScore}` : ""}`;
      relationList.append(item);
    }

    const actions = node.querySelector(".note-actions");
    if (isEmailView && note.type === "email-draft") {
      const status = String(note.status || "draft").toLowerCase();
      if (status !== "sent") {
        const approveButton = document.createElement("button");
        approveButton.className = "secondary";
        approveButton.type = "button";
        approveButton.textContent = status === "approved" ? "Approved" : "Approve Draft";
        approveButton.disabled = status === "approved";
        approveButton.title = "Approve this draft before the Send button is enabled.";
        approveButton.addEventListener("click", async () => {
          try {
            showEmailStatus(`Approving draft: ${note.subject || note.title}`);
            const payload = await api.updateEmailDraft(note.path, "approved");
            notes = payload.notes ?? [];
            showEmailStatus(`Approved draft: ${note.subject || note.title}`);
            render();
          } catch (error) {
            showEmailStatus(error.message);
          }
        });
        actions.prepend(approveButton);
      }

      const sendButton = document.createElement("button");
      sendButton.className = status === "approved" ? "primary" : "secondary";
      sendButton.type = "button";
      sendButton.textContent = status === "sent" ? "Sent" : "Send Approved";
      sendButton.disabled = status !== "approved";
      sendButton.title = status === "approved" ? "Send this approved draft through the configured SMTP account." : "Draft must be approved before sending.";
      sendButton.addEventListener("click", async () => {
        const confirmed = window.confirm(`Send this approved email draft now?\n\nTo: ${note.to || "unknown"}\nSubject: ${note.subject || note.title}\n\nThis will send a real email through the configured account.`);
        if (!confirmed) {
          return;
        }

        try {
          showEmailStatus(`Sending approved draft: ${note.subject || note.title}`);
          const payload = await api.sendEmailDraft(note.path);
          notes = payload.notes ?? [];
          showEmailStatus(`Sent draft: ${payload.sent.subject}`);
          render();
        } catch (error) {
          showEmailStatus(error.message);
        }
      });
      actions.insertBefore(sendButton, actions.querySelector(".export-button"));
    }

    node.querySelector(".export-button").addEventListener("click", () => {
      downloadText(`${slugify(note.title)}.md`, toMarkdown(note));
    });
    node.querySelector(".delete-button").addEventListener("click", async () => {
      const confirmed = window.confirm(`Delete "${note.title}"?\n\n${note.path}`);
      if (!confirmed) {
        return;
      }

      try {
        const payload = await api.deleteNote(note.path);
        notes = payload.notes ?? [];
        if (note.path.startsWith("commands/")) {
          const commandPayload = await api.getCommands();
          commands = commandPayload.commands ?? [];
        }
        showError(`Deleted ${payload.deleted}.`);
        render();
      } catch (error) {
        showError(error.message);
      }
    });
    target.append(node);
  }
}

// Persists a command status transition and refreshes the local command state.
async function setCommandStatus(command, status) {
  try {
    const payload = await api.updateCommand(command.path, status);
    commands = payload.commands ?? [];
    showCommandStatus(`Marked "${command.title}" ${statusLabel(status)}.`);
    renderCommands();
    await refreshCodexHistory();
  } catch (error) {
    showCommandStatus(error.message);
  }
}

// Converts internal command lifecycle values into labels that read clearly in the UI.
function statusLabel(status) {
  const labels = {
    pending: "Pending Review",
    reviewed: "Ready for Codex",
    running: "In Codex",
    done: "Done",
    rejected: "Rejected"
  };
  return labels[String(status || "pending").toLowerCase()] ?? String(status || "pending");
}

// Formats command lifecycle timestamps without making the card visually noisy.
function formatCommandTimestamp(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

// Counts command records by status so the queue health is visible at a glance.
function commandStatusCounts() {
  return commands.reduce((counts, command) => {
    const status = String(command.status || "pending").toLowerCase();
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
}

// Explains what each lifecycle state means so "In Codex" is not mistaken for done.
function commandDetailText(command, status) {
  const claimedAt = formatCommandTimestamp(command.handoffStarted);
  const completedAt = formatCommandTimestamp(command.completedAt);
  const rejectedAt = formatCommandTimestamp(command.rejectedAt);

  if (status === "running") {
    return claimedAt
      ? `Claimed by Codex on ${claimedAt}. This is not completion; return it to Ready if the Codex thread did not actually finish it.`
      : "Claimed by Codex. This is not completion; return it to Ready if the Codex thread did not actually finish it.";
  }
  if (status === "reviewed") {
    return "Ready for the Codex runner. Previewing the handoff will not change this status.";
  }
  if (status === "pending") {
    return "Waiting for your approval before Codex can pick it up.";
  }
  if (status === "done") {
    return completedAt ? `Completed on ${completedAt}.` : "Completed.";
  }
  if (status === "rejected") {
    return rejectedAt ? `Rejected on ${rejectedAt}.` : "Rejected.";
  }
  return "";
}

// Renders a compact command status summary above the command controls.
function renderCommandSummary() {
  const counts = commandStatusCounts();
  const ordered = ["pending", "reviewed", "running", "done", "rejected"];
  els.commandSummary.replaceChildren();

  for (const status of ordered) {
    const badge = document.createElement("span");
    badge.className = `command-summary-badge status-${status}`;
    badge.textContent = `${statusLabel(status)}: ${counts[status] || 0}`;
    els.commandSummary.append(badge);
  }
}

// Keeps long Codex prompts readable by showing a short preview until the user expands a command.
function renderCommandBody(node, command) {
  const body = node.querySelector(".note-body");
  const fullText = command.command || "No command text.";
  const collapsedLimit = 360;

  body.replaceChildren();
  body.classList.add("command-body");

  const preview = document.createElement("span");
  preview.className = "command-preview";
  preview.textContent = fullText.length > collapsedLimit ? `${fullText.slice(0, collapsedLimit).trim()}...` : fullText;
  body.append(preview);

  if (fullText.length <= collapsedLimit) {
    return;
  }

  const toggle = document.createElement("button");
  toggle.className = "inline-action command-expand";
  toggle.type = "button";
  toggle.textContent = "Show full prompt";
  toggle.addEventListener("click", () => {
    const expanded = body.classList.toggle("is-expanded");
    preview.textContent = expanded ? fullText : `${fullText.slice(0, collapsedLimit).trim()}...`;
    toggle.textContent = expanded ? "Collapse prompt" : "Show full prompt";
  });
  body.append(toggle);
}

// Renders the command review queue, including lifecycle and delete actions.
function renderCommands() {
  renderCodexControls();
  renderCommandSummary();
  els.commandList.replaceChildren();
  const activeCount = commands.filter((command) => !["done", "rejected"].includes(String(command.status || "pending").toLowerCase())).length;
  const canOperateCommands = canOperateCodexCommands();
  els.commandCount.textContent = String(activeCount);

  if (!commands.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No commands yet.";
    els.commandList.append(empty);
    return;
  }

  for (const command of commands) {
    const node = els.commandTemplate.content.firstElementChild.cloneNode(true);
    const source = command.source || "unknown source";
    const skill = command.skillTrigger || "no skill";
    const owner = command.ownerName || command.owner || "shared";
    const status = String(command.status || "pending").toLowerCase();
    node.classList.add(`status-${status}`);
    node.querySelector(".note-meta").textContent = `${command.path} / ${skill} / ${source} / ${owner}`;
    node.querySelector(".status-pill").textContent = statusLabel(status);
    node.querySelector("h3").textContent = command.title;
    renderCommandBody(node, command);
    node.querySelector(".command-detail").textContent = commandDetailText(command, status);

    const reviewedButton = node.querySelector(".reviewed-button");
    const doneButton = node.querySelector(".done-button");
    const rejectButton = node.querySelector(".reject-button");
    const isClosed = status === "done" || status === "rejected";

    if (status === "pending") {
      reviewedButton.disabled = !canOperateCommands;
      reviewedButton.textContent = "Approve for Codex";
      reviewedButton.title = canOperateCommands ? "Move this command to Ready for Codex." : "Admin access is required to operate Codex commands.";
    } else if (status === "running") {
      reviewedButton.disabled = !canOperateCommands;
      reviewedButton.textContent = "Return to Ready";
      reviewedButton.title = canOperateCommands ? "Use this when a command was claimed but Codex did not complete it." : "Admin access is required to operate Codex commands.";
    } else {
      reviewedButton.disabled = true;
      reviewedButton.textContent = statusLabel(status);
      reviewedButton.title = "";
    }

    doneButton.disabled = !canOperateCommands || status !== "running";
    doneButton.textContent = status === "running" ? "Mark Done (Verified)" : "Mark Done";
    doneButton.title = canOperateCommands
      ? status === "running" ? "Only use after this Codex thread confirms the work is complete." : "Only a running command can be marked done."
      : "Admin access is required to operate Codex commands.";
    rejectButton.disabled = !canOperateCommands || status === "done" || status === "rejected";
    rejectButton.title = canOperateCommands ? rejectButton.title : "Admin access is required to operate Codex commands.";

    if (canOperateCommands) {
      reviewedButton.addEventListener("click", () => setCommandStatus(command, "reviewed"));
      doneButton.addEventListener("click", () => {
        const confirmed = window.confirm(`Mark "${command.title}" done only if Codex actually completed and verified it.\n\n${command.path}`);
        if (confirmed) {
          setCommandStatus(command, "done");
        }
      });
      rejectButton.addEventListener("click", () => setCommandStatus(command, "rejected"));
    }
    if (isClosed) {
      node.querySelector(".delete-button").title = "Delete this closed command record from Orbiter.";
    }
    const deleteButton = node.querySelector(".delete-button");
    deleteButton.disabled = !canOperateCommands;
    deleteButton.title = canOperateCommands ? deleteButton.title : "Admin access is required to delete command records.";
    if (canOperateCommands) {
      deleteButton.addEventListener("click", async () => {
        const confirmed = window.confirm(`Delete command "${command.title}"?\n\n${command.path}`);
        if (!confirmed) {
          return;
        }

        try {
          const payload = await api.deleteNote(command.path);
          notes = payload.notes ?? [];
          commands = commands.filter((item) => item.path !== command.path);
          await refreshCodexHistory();
          showCommandStatus(`Deleted ${payload.deleted}.`);
          render();
        } catch (error) {
          showCommandStatus(error.message);
        }
      });
    }

    els.commandList.append(node);
  }
}

// Renders the live Codex activity timeline that Orbiter can safely infer from command files.
function renderCodexHistory() {
  const generated = formatCommandTimestamp(codexHistory.generatedAt);
  if (codexHistory.accessRestricted) {
    els.codexHistoryMeta.textContent = `Admin-only command history${generated ? ` / synced ${generated}` : ""}`;
  } else {
    els.codexHistoryMeta.textContent = `In Codex: ${codexHistory.runningCount || 0} / Ready: ${codexHistory.reviewedCount || 0}${generated ? ` / synced ${generated}` : ""}`;
  }
  els.codexHistoryList.replaceChildren();

  if (codexHistory.accessRestricted) {
    const restricted = document.createElement("p");
    restricted.className = "empty";
    restricted.textContent = "Command history is visible to admin users only.";
    els.codexHistoryList.append(restricted);
    return;
  }

  const events = codexHistory.events ?? [];
  if (!events.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No Codex activity yet.";
    els.codexHistoryList.append(empty);
    return;
  }

  for (const event of events.slice(0, 24)) {
    const item = document.createElement("article");
    item.className = `codex-history-item event-${event.type || "activity"}`;

    const marker = document.createElement("span");
    marker.className = "codex-history-marker";
    marker.textContent = "";
    item.append(marker);

    const body = document.createElement("div");
    body.className = "codex-history-body";

    const head = document.createElement("div");
    head.className = "codex-history-item-head";
    const title = document.createElement("h4");
    title.textContent = event.label || "Codex activity";
    const time = document.createElement("time");
    time.dateTime = event.timestamp || "";
    time.textContent = formatCommandTimestamp(event.timestamp) || "time unknown";
    head.append(title, time);
    body.append(head);

    const meta = document.createElement("p");
    meta.className = "note-meta";
    meta.textContent = `${event.title || "Untitled command"} / ${statusLabel(event.status)} / ${event.path}`;
    body.append(meta);

    if (event.detail) {
      const detail = document.createElement("p");
      detail.className = "note-body";
      detail.textContent = event.detail;
      body.append(detail);
    }

    if (event.prompt) {
      const prompt = document.createElement("p");
      prompt.className = "codex-history-prompt";
      prompt.textContent = event.prompt.length > 180 ? `${event.prompt.slice(0, 177)}...` : event.prompt;
      body.append(prompt);
    }

    item.append(body);
    els.codexHistoryList.append(item);
  }
}

// Appends one compact row to a Command Center list.
function appendCommandCenterRow(parent, label, value, detail = "") {
  const row = document.createElement("div");
  row.className = "command-center-row";
  const labelNode = document.createElement("span");
  labelNode.textContent = label;
  const valueNode = document.createElement("strong");
  valueNode.textContent = value;
  row.append(labelNode, valueNode);
  if (detail) {
    const detailNode = document.createElement("p");
    detailNode.className = "note-body";
    detailNode.textContent = detail;
    row.append(detailNode);
  }
  parent.append(row);
}

// Builds a single dashboard metric tile.
function commandCenterMetric(label, value, detail = "") {
  const card = document.createElement("article");
  card.className = "command-center-metric";
  const number = document.createElement("strong");
  number.textContent = String(value ?? 0);
  const text = document.createElement("span");
  text.textContent = label;
  card.append(number, text);
  if (detail) {
    const small = document.createElement("p");
    small.className = "note-body";
    small.textContent = detail;
    card.append(small);
  }
  return card;
}

// Renders the hidden dev Command Center dashboard when its server feature flag is enabled.
function renderCommandCenter() {
  if (!els.commandCenterSync) {
    return;
  }

  if (!featureEnabled("commandCenter")) {
    els.commandCenterSync.textContent = "Command Center is hidden in this runtime.";
    return;
  }

  const generated = formatCommandTimestamp(commandCenter.generatedAt);
  const runtime = commandCenter.runtime ?? {};
  const counts = commandCenter.counts ?? {};
  const statuses = counts.commandStatuses ?? {};
  const drafts = counts.emailDraftStatuses ?? {};
  const queue = commandCenter.queue ?? {};
  const travel = commandCenter.travel ?? {};
  const environment = commandCenter.environment ?? {};

  els.commandCenterSync.textContent = generated
    ? `Synced ${generated} / ${runtime.environment || "runtime unknown"} / ${runtime.publicOrigin || "local origin"}`
    : "Command Center has not synced yet.";

  els.commandCenterHero.replaceChildren();
  appendCommandCenterRow(els.commandCenterHero, "Runtime", runtime.environment || "local", `${runtime.host || "127.0.0.1"}:${runtime.port || "4173"} / auth ${runtime.authRequired ? "on" : "off"}`);
  appendCommandCenterRow(els.commandCenterHero, "Operator", commandCenter.actor?.name || "Local development", commandCenter.actor?.role || "local");
  appendCommandCenterRow(els.commandCenterHero, "Environment", environment.weather?.condition || "Weather pending", environment.eclipse?.label || environment.location?.label || "No sky event");

  els.commandCenterMetrics.replaceChildren(
    commandCenterMetric("Notes", counts.notes, `${counts.noteTypes?.email || 0} email / ${counts.noteTypes?.["email-draft"] || 0} drafts`),
    commandCenterMetric("Commands", counts.commands, `${statuses.reviewed || 0} ready / ${statuses.running || 0} in Codex`),
    commandCenterMetric("Approved Drafts", drafts.approved || 0, "Ready for guarded send"),
    commandCenterMetric("Travel Items", travel.itemCount || 0, `${travel.needsReviewCount || 0} need review`),
    commandCenterMetric("Graph Nodes", counts.graphNodes || 0, `${counts.graphEdges || 0} edges`),
    commandCenterMetric("Uptime", runtime.uptimeSeconds ? `${Math.round(runtime.uptimeSeconds / 60)}m` : "0m", runtime.publicOrigin || "local")
  );

  els.commandCenterQueue.replaceChildren();
  appendCommandCenterRow(els.commandCenterQueue, "Pending Review", String(queue.pendingCount || 0));
  appendCommandCenterRow(els.commandCenterQueue, "Ready for Codex", String(queue.reviewedCount || 0), queue.nextReviewed ? queue.nextReviewed.title : "No reviewed command waiting.");
  appendCommandCenterRow(els.commandCenterQueue, "In Codex", String(queue.runningCount || 0), queue.staleRunning?.length ? `${queue.staleRunning.length} stale handoff${queue.staleRunning.length === 1 ? "" : "s"}.` : "No stale handoffs detected.");
  appendCommandCenterRow(els.commandCenterQueue, "Closed", String((queue.doneCount || 0) + (queue.rejectedCount || 0)), `${queue.doneCount || 0} done / ${queue.rejectedCount || 0} rejected`);

  els.commandCenterRecommendations.replaceChildren();
  for (const recommendation of commandCenter.recommendations ?? []) {
    const item = document.createElement("p");
    item.className = "command-center-recommendation";
    item.textContent = recommendation;
    els.commandCenterRecommendations.append(item);
  }

  els.commandCenterActivity.replaceChildren();
  const events = commandCenter.codex?.events ?? [];
  if (!events.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No Codex activity found.";
    els.commandCenterActivity.append(empty);
    return;
  }
  for (const event of events.slice(0, 8)) {
    appendCommandCenterRow(
      els.commandCenterActivity,
      event.label || "Codex activity",
      formatCommandTimestamp(event.timestamp) || "time unknown",
      `${event.title || "Untitled"} / ${statusLabel(event.status)}`
    );
  }
}

// Centralizes the browser-side Codex permission check so non-admin roles cannot queue work by mistake.
function canOperateCodexCommands() {
  return !session.authRequired || session.user?.role === "admin";
}

// Keeps Codex handoff controls aligned with the active user's permissions.
function renderCodexControls() {
  const canClaim = canOperateCodexCommands();
  els.codexNext.disabled = !canClaim;
  els.codexNext.title = canClaim ? "Preview the oldest reviewed command without changing its status." : "Admin access is required.";
}

// Shows the current access mode and authenticated user for local production use.
function renderAccess() {
  const user = session.user;
  els.accessMode.textContent = session.authRequired ? "prod" : "local";
  els.accessUser.textContent = user ? `${user.name} (${user.role})` : session.authRequired ? "Not signed in" : "Local development";
  els.accessAuth.textContent = session.authRequired ? session.authenticated ? "Signed in" : "Required" : "Not required";
  els.accessGuard.textContent = session.networkGuard || "off";
  els.accessRemote.textContent = session.remoteAddress || "local";
  els.accessDataScope.textContent = user?.ephemeral ? "Ephemeral / wiped on logout" : user?.dataScope || "shared";
  els.logoutButton.textContent = user?.ephemeral ? "Log out and wipe data" : "Log out";
  els.logoutButton.hidden = !session.authenticated;
}

// Opens Google OAuth in a small browser window so the main Travel tab can stay in place.
function openGoogleTravelPopup() {
  els.googleTravelStatus.textContent = "Opening Google sign-in...";
  const params = new URLSearchParams({ popup: "1", returnTo: "/" });
  const popup = window.open(`/api/google/oauth/start?${params}`, "orbiter_google_sso", "width=520,height=720,noopener=false");
  if (!popup) {
    els.googleTravelStatus.textContent = "Popup blocked. Opening Google sign-in in this tab.";
    window.location.href = `/api/google/oauth/start?${params}`;
  }
}

// Keeps Google travel controls aligned with server config and the active user.
function renderGoogleTravelControls() {
  const isGoogleUser = session.user?.authProvider === "google";
  els.connectGoogleTravel.disabled = !googleOAuth.configured;
  els.importGoogleTravel.disabled = !googleOAuth.configured || !isGoogleUser;
  els.connectGoogleTravel.textContent = isGoogleUser ? "Reconnect Google" : "Connect Google";
  if (!googleOAuth.configured) {
    els.googleTravelStatus.textContent = "Google SSO is not configured on this Orbiter server yet.";
  } else if (isGoogleUser) {
    els.googleTravelStatus.textContent = `Connected as ${session.user.email || session.user.name}. Imports are capped at ${googleOAuth.importLimit || 100} messages.`;
  } else {
    els.googleTravelStatus.textContent = "Connect Google to import this user's travel emails.";
  }
}

// Formats an itinerary timestamp while keeping unknown dates visually explicit.
function travelDateParts(value) {
  if (!value) {
    return { month: "TBD", day: "--", time: "", dayKey: "unknown", dayLabel: "Date unknown" };
  }

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return { month: "TBD", day: "--", time: "", dayKey: "unknown", dayLabel: "Date unknown" };
  }

  return {
    month: new Intl.DateTimeFormat("en-US", { month: "short" }).format(date),
    day: new Intl.DateTimeFormat("en-US", { day: "2-digit" }).format(date),
    time: new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date),
    dayKey: date.toISOString().slice(0, 10),
    dayLabel: new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(date)
  };
}

// Converts a stored itinerary date into a valid Date object or null.
function travelDate(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

// Produces compact date labels used in route stops, stays, and stats.
function shortTravelDate(value) {
  const date = value instanceof Date ? value : travelDate(value);
  if (!date) {
    return "TBD";
  }
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

// Measures whole travel days between two dates for range and bar calculations.
function travelDaySpan(start, end) {
  const dayMs = 24 * 60 * 60 * 1000;
  const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.max(0, Math.round((endDay - startDay) / dayMs));
}

// Normalizes travel dates to midnight so lodging nights can be compared consistently.
function travelDayStart(value) {
  const date = value instanceof Date ? value : travelDate(value);
  if (!date) {
    return null;
  }

  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Adds whole days to a normalized travel date.
function addTravelDays(value, days) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

// Produces a compact range for hotel-gap and transfer recommendations.
function shortTravelRange(start, end) {
  const startLabel = shortTravelDate(start);
  const endLabel = shortTravelDate(end);
  return startLabel === endLabel ? startLabel : `${startLabel} to ${endLabel}`;
}

// Escapes city names before using them inside transport-coverage regular expressions.
function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Pulls a Date from confirmation snippets such as "Check out: Monday June 15, 2026".
function dateFromTravelText(text) {
  const value = String(text ?? "");
  const longDate = value.match(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?\s*([A-Z][a-z]+\s+\d{1,2},\s+\d{4})(?:\s+\((?:after|before)\s+([^)]+)\))?/);
  if (longDate) {
    const parsed = new Date(`${longDate[1]} ${longDate[2] ?? "12:00 PM"}`);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  const isoDate = value.match(/\b(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?/);
  if (isoDate) {
    const parsed = new Date(`${isoDate[1]}T${isoDate[2] ?? "12:00"}:00`);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  return null;
}

// Finds the best city hint from an itinerary item without trusting noisy email bodies too much.
function cityForTravelItem(item) {
  const text = `${item.location ?? ""} ${item.title ?? ""} ${(item.snippets ?? []).join(" ")}`;
  const cityRules = [
    ["Hakone", /\bHakone\b|Tonosawa|Tounosawa|Ichinoyu|Yamano Chaya/i],
    ["Tokyo", /\bTokyo\b|Nishishinjuku|teamLab|Shibuya|APA Hotel/i],
    ["Koyasan", /\bKoyasan\b|\bKoya\b|Shojo Shin-in|Shukubo|Wakayama|Okunoin/i],
    ["Kyoto", /\bKyoto\b|Kawaramachi|DRUM TAO|Waka Kyoto/i],
    ["Osaka", /\bOsaka\b|Dotonbori|Forza/i],
    ["Seoul", /\bSeoul\b|Dongdaemun|Skypark|\bICN\b|Incheon/i],
    ["Hanoi", /\bHanoi\b|\bHa Noi\b|\bHAN\b/i],
    ["Da Nang", /\bDa Nang\b|\bDanang\b|\bDAD\b|\bHoi An\b/i],
    ["Ho Chi Minh City", /\bHo Chi Minh\b|\bSaigon\b|\bSGN\b/i],
    ["Washington", /\bWashington\b|\bIAD\b/i]
  ];
  return cityRules.find(([, pattern]) => pattern.test(text))?.[0] ?? "";
}

// Expands flight routes into both endpoint cities for the route strip.
function routeCitiesForTravelItem(item) {
  const text = `${item.title ?? ""} ${(item.snippets ?? []).join(" ")}`;
  if (/\bICN\b.*\bIAD\b/i.test(text)) {
    return ["Seoul", "Washington"];
  }
  if (/\bIAD\b.*\bICN\b/i.test(text)) {
    return ["Washington", "Seoul"];
  }

  const city = cityForTravelItem(item);
  return city ? [city] : [];
}

// Chooses compact two-to-four character type tokens for the visual timeline rail.
function travelTypeToken(type) {
  if (type === "flight") {
    return "FL";
  }
  if (type === "transport") {
    return "TRN";
  }
  if (type === "lodging") {
    return "ST";
  }
  if (type === "event") {
    return "EV";
  }
  return "TR";
}

// Identifies movement-related itinerary records that belong in the transportation panel.
function isTransportationItem(item) {
  if (item.type === "flight" || item.type === "transport") {
    return true;
  }

  const text = `${item.title ?? ""} ${item.location ?? ""} ${(item.snippets ?? []).join(" ")}`;
  return /\b(train|rail|railway|shinkansen|jr pass|limited express|bus|ferry|transfer|transportation)\b/i.test(text);
}

// Chooses a practical default transport mode for a gap between two known cities.
function recommendedTransportMode(fromCity, toCity) {
  const japanCities = new Set(["Tokyo", "Hakone", "Kyoto", "Osaka", "Koyasan"]);
  if (isLocalTransitLeg(fromCity, toCity)) {
    return "local rail";
  }
  if (japanCities.has(fromCity) && japanCities.has(toCity)) {
    return "rail";
  }
  if ([fromCity, toCity].includes("Seoul") && (japanCities.has(fromCity) || japanCities.has(toCity))) {
    return "flight";
  }
  return "rail or bus";
}

// Keeps common day-of regional train moves from being escalated like missing hotel or flight confirmations.
function isLocalTransitLeg(fromCity, toCity) {
  const pair = [fromCity, toCity].filter(Boolean).sort().join("|");
  return [
    "Kyoto|Osaka",
    "Kobe|Osaka",
    "Kyoto|Nara",
    "Nara|Osaka"
  ].includes(pair);
}

// Flags international moves that should be treated as real booking gaps.
function isInternationalTravelLeg(fromCity, toCity) {
  const japanCities = new Set(["Tokyo", "Hakone", "Kyoto", "Osaka", "Koyasan"]);
  return [fromCity, toCity].includes("Seoul") && (japanCities.has(fromCity) || japanCities.has(toCity));
}

// Adds operational meaning to a detected gap so the UI can separate blockers from planning reminders.
function travelGapClassification(kind, fromCity = "", toCity = "") {
  if (kind === "hotel-gap") {
    return {
      classification: "key-gap",
      classificationLabel: "Key gap",
      classificationDetails: "A confirmed lodging night is missing and should be resolved before travel.",
      priority: "high",
      isKeyGap: true,
      isDataDiscrepancy: false
    };
  }

  if (kind === "lodging-conflict") {
    return {
      classification: "data-discrepancy",
      classificationLabel: "Data check",
      classificationDetails: "This may be an intentional backup, duplicate stay, or parsed city/location issue.",
      priority: "high",
      isKeyGap: true,
      isDataDiscrepancy: true
    };
  }

  if (kind === "transport-gap" && isInternationalTravelLeg(fromCity, toCity)) {
    return {
      classification: "key-gap",
      classificationLabel: "Key gap",
      classificationDetails: "An international move needs a booked flight or verified transportation confirmation.",
      priority: "high",
      isKeyGap: true,
      isDataDiscrepancy: false
    };
  }

  if (kind === "transport-gap" && isLocalTransitLeg(fromCity, toCity)) {
    return {
      classification: "local-transit",
      classificationLabel: "Local transit",
      classificationDetails: "This is usually handled day-of with local rail instead of a reserved booking.",
      priority: "low",
      isKeyGap: false,
      isDataDiscrepancy: false
    };
  }

  return {
    classification: "transport-plan",
    classificationLabel: "Transit plan",
    classificationDetails: "A real route decision is needed, but local fallback transportation likely exists.",
    priority: "medium",
    isKeyGap: false,
    isDataDiscrepancy: false
  };
}

// Merges classification metadata into a travel planning gap.
function classifiedTravelGap(gap, fromCity = "", toCity = "") {
  return {
    ...gap,
    ...travelGapClassification(gap.kind, fromCity, toCity)
  };
}

// Summarizes the current itinerary enough for Codex or ChatGPT to research a specific gap.
function travelResearchContext() {
  const items = sortedTravelItems(travelItinerary.items ?? [])
    .slice(0, 24)
    .map((item) => {
      const dateParts = travelDateParts(item.date);
      const when = [dateParts.dayLabel, dateParts.time].filter(Boolean).join(" ");
      const city = cityForTravelItem(item) || item.location || "location unknown";
      return `- ${when || "date unknown"} / ${travelTypeToken(item.type)} / ${city} / ${item.title} / source: ${item.source || "unknown"}`;
    });

  return items.length ? items.join("\n") : "- No generated itinerary items available yet.";
}

// Builds the research prompt for Codex or a manually opened ChatGPT conversation.
function travelResearchPrompt(gap) {
  const evidence = gap.evidence ? `\nEvidence: ${gap.evidence}` : "";
  return [
    "You are helping me use Orbiter as my remote home-based travel agent while I am traveling in Japan, Korea, and Vietnam.",
    "",
    `Research this itinerary gap: ${gap.title}`,
    `Details: ${gap.details}`,
    `Classification: ${gap.classificationLabel || "Unclassified"} / ${gap.priority || gap.severity || "unknown"} priority`,
    `Classification note: ${gap.classificationDetails || "No classification note available."}`,
    `Current recommendation: ${gap.recommendation}${evidence}`,
    "",
    "Use live web research if available. Prefer official booking/provider pages first, then reputable backup booking pages only when official pages are weak or foreign-card-unfriendly.",
    "Do not invent a booking confirmation. Do not claim something is booked unless the itinerary or email source proves it.",
    "",
    "Return:",
    "1. Best next action.",
    "2. Recommended official booking/search links.",
    "3. Backup links if useful.",
    "4. What exact ticket/reservation I should buy or verify.",
    "5. Risks, timing constraints, and what information you still need from me.",
    "",
    "Orbiter itinerary context:",
    travelResearchContext()
  ].join("\n");
}

// Builds the Codex command text for a detected travel planning gap.
function travelGapCommand(gap) {
  return travelResearchPrompt(gap);
}

// Gives travel-gap commands a stable tag so the Travel tab can recognize queued work after refresh.
function travelGapTag(gap) {
  return `gap-${slugify(gap.id || gap.title)}`;
}

// Finds the active command already queued for a specific travel planning gap.
function queuedTravelGapCommand(gap) {
  const tag = travelGapTag(gap);
  return commands.find((command) => {
    const status = String(command.status || "").toLowerCase();
    return command.source === "travel-gap"
      && !["done", "rejected"].includes(status)
      && ((command.tags ?? []).includes(tag) || command.title === gap.title);
  });
}

// Checks whether an imported transport record appears to cover a city transfer.
function transportCoversLeg(items, fromCity, toCity, start, end) {
  const windowStart = addTravelDays(start, -1);
  const windowEnd = addTravelDays(end, 1);

  return items.filter(isTransportationItem).some((item) => {
    const date = travelDayStart(item.date);
    if (!date || date < windowStart || date > windowEnd) {
      return false;
    }

    const text = `${item.title ?? ""} ${item.location ?? ""} ${(item.snippets ?? []).join(" ")}`;
    return new RegExp(`\\b${escapeRegExp(fromCity)}\\b`, "i").test(text) && new RegExp(`\\b${escapeRegExp(toCity)}\\b`, "i").test(text);
  });
}

// Turns imported lodging confirmations into date spans that can be audited for coverage.
function lodgingSpans(items) {
  return items
    .filter((item) => item.type === "lodging")
    .map(lodgingStay)
    .filter(Boolean)
    .map((stay) => ({
      ...stay,
      startDay: travelDayStart(stay.start),
      endDay: travelDayStart(stay.end),
      city: stay.city || cityForTravelItem(stay.item) || stay.item.location || ""
    }))
    .filter((stay) => stay.startDay && stay.endDay)
    .sort((left, right) => left.startDay - right.startDay || left.endDay - right.endDay);
}

// Finds missing hotel nights, overlapping city conflicts, and uncovered intercity movement.
function travelPlanningGaps(items) {
  const stays = lodgingSpans(items);
  const gaps = [];

  if (stays.length < 2) {
    return gaps;
  }

  let current = stays[0];
  for (const next of stays.slice(1)) {
    if (next.startDay < current.endDay && current.city && next.city && current.city !== next.city) {
      gaps.push(classifiedTravelGap({
        id: `lodging-conflict-${current.item.id}-${next.item.id}`,
        kind: "lodging-conflict",
        severity: "review",
        label: "CHECK",
        title: `Overlapping stays: ${current.city} and ${next.city}`,
        details: `${current.item.title} overlaps ${next.item.title} around ${shortTravelRange(next.startDay, current.endDay)}.`,
        recommendation: "Confirm whether one booking is a backup/cancelled stay or whether the city/location parse is wrong.",
        evidence: `${current.item.source} / ${next.item.source}`
      }, current.city, next.city));
    }

    if (next.startDay > current.endDay) {
      const missingNights = travelDaySpan(current.endDay, next.startDay);
      gaps.push(classifiedTravelGap({
        id: `hotel-gap-${current.item.id}-${next.item.id}`,
        kind: "hotel-gap",
        severity: "action",
        label: "HOTEL",
        title: `Hotel gap: ${shortTravelRange(current.endDay, addTravelDays(next.startDay, -1))}`,
        details: `${missingNights} unconfirmed night${missingNights === 1 ? "" : "s"} after ${current.item.title} before ${next.item.title}.`,
        recommendation: `Book or confirm lodging near ${[current.city, next.city].filter(Boolean).join(" / ") || "the next city"} for ${shortTravelRange(current.endDay, addTravelDays(next.startDay, -1))}.`,
        evidence: `${current.item.source} / ${next.item.source}`
      }, current.city, next.city));
    }

    if (next.startDay >= current.endDay && current.city && next.city && current.city !== next.city && !transportCoversLeg(items, current.city, next.city, current.endDay, next.startDay)) {
      const mode = recommendedTransportMode(current.city, next.city);
      const classification = travelGapClassification("transport-gap", current.city, next.city);
      gaps.push(classifiedTravelGap({
        id: `transport-gap-${current.city}-${next.city}-${current.endDay.toISOString().slice(0, 10)}`,
        kind: "transport-gap",
        severity: classification.priority === "low" ? "review" : "action",
        label: mode.includes("flight") ? "AIR" : "RAIL",
        title: `Missing ${mode}: ${current.city} to ${next.city}`,
        details: `No imported transportation confirmation covers the move from ${current.city} after ${shortTravelDate(current.endDay)} to ${next.city} by ${shortTravelDate(next.startDay)}.`,
        recommendation: classification.classification === "local-transit"
          ? `Plan day-of ${mode} from ${current.city} to ${next.city} around ${shortTravelRange(current.endDay, next.startDay)}; no reserved booking is usually required.`
          : `Research and book ${mode} for ${current.city} to ${next.city} around ${shortTravelRange(current.endDay, next.startDay)}.`,
        evidence: `${current.item.source} / ${next.item.source}`
      }, current.city, next.city));
    }

    if (next.endDay > current.endDay) {
      current = next;
    }
  }

  return gaps;
}

// Flags records that should stay visible as review work instead of being hidden in the timeline.
function travelNeedsReview(item) {
  const confidence = Number(item.confidence ?? 0);
  return !travelDate(item.date) || confidence < 6;
}

// Keeps dated items first and moves unknown items to the bottom.
function sortedTravelItems(items) {
  return [...items].sort((left, right) => {
    const leftDate = travelDate(left.date);
    const rightDate = travelDate(right.date);
    if (leftDate && rightDate) {
      return leftDate - rightDate;
    }
    if (leftDate) {
      return -1;
    }
    if (rightDate) {
      return 1;
    }
    return String(left.title).localeCompare(String(right.title));
  });
}

// Adds a stat tile to the itinerary summary strip.
function appendTravelStat(label, value, hint) {
  const stat = document.createElement("div");
  stat.className = "travel-stat";

  const strong = document.createElement("strong");
  strong.textContent = String(value);
  const caption = document.createElement("span");
  caption.textContent = label;
  const note = document.createElement("small");
  note.textContent = hint;

  stat.append(strong, caption, note);
  els.travelStats.append(stat);
}

// Renders the numeric trip summary above the route.
function renderTravelStats(items) {
  els.travelStats.replaceChildren();

  const dated = items.map((item) => travelDate(item.date)).filter(Boolean);
  const min = dated.length ? new Date(Math.min(...dated)) : null;
  const max = dated.length ? new Date(Math.max(...dated)) : null;
  const days = min && max ? travelDaySpan(min, max) + 1 : 0;
  const lodgingCount = items.filter((item) => item.type === "lodging").length;
  const transportationCount = items.filter(isTransportationItem).length;
  const gapCount = travelPlanningGaps(items).length;
  const reviewCount = items.filter(travelNeedsReview).length;

  appendTravelStat("Items", items.length, "Parsed records");
  appendTravelStat("Days", days || "TBD", min && max ? `${shortTravelDate(min)} to ${shortTravelDate(max)}` : "No dated range");
  appendTravelStat("Transport", transportationCount, "Flights and tickets");
  appendTravelStat("Stays", lodgingCount, "Lodging records");
  appendTravelStat("Gaps", gapCount, gapCount ? "Needs planning" : "No gaps found");
  appendTravelStat("Review", reviewCount, reviewCount ? "Needs attention" : "Clean parse");
}

// Creates chronological city stops from the itinerary items.
function travelStops(items) {
  const stops = [];
  for (const item of sortedTravelItems(items)) {
    const date = travelDate(item.date);
    const cities = routeCitiesForTravelItem(item);
    if (!date || !cities.length) {
      continue;
    }

    for (const city of cities) {
      const existing = stops.find((stop) => stop.city === city);
      if (existing) {
        existing.end = date > existing.end ? date : existing.end;
        existing.count += 1;
      } else {
        stops.push({ city, start: date, end: date, count: 1 });
      }
    }
  }
  return stops;
}

// Draws the route strip as a sequence of city nodes.
function renderTravelRoute(items) {
  els.travelRoute.replaceChildren();
  const stops = travelStops(items);

  if (!stops.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No route cities detected yet.";
    els.travelRoute.append(empty);
    return;
  }

  stops.forEach((stop, index) => {
    const node = document.createElement("div");
    node.className = "route-stop";

    const dot = document.createElement("span");
    dot.className = "route-dot";
    dot.textContent = String(index + 1);
    const city = document.createElement("strong");
    city.textContent = stop.city;
    const dates = document.createElement("span");
    dates.textContent = `${shortTravelDate(stop.start)}${travelDaySpan(stop.start, stop.end) ? ` to ${shortTravelDate(stop.end)}` : ""}`;

    node.append(dot, city, dates);
    els.travelRoute.append(node);
  });
}

// Finds the official tourism feed that best matches a route city.
function travelShortEntryForCity(city) {
  return travelShortCatalog.find((entry) => entry.cities.includes(city));
}

// Picks the first route city with a known video feed, preserving itinerary order.
function travelShortCandidate(items) {
  const routeCities = travelStops(items).map((stop) => stop.city);
  const itemCities = sortedTravelItems(items).map((item) => cityForTravelItem(item)).filter(Boolean);
  const cities = [...new Set([...routeCities, ...itemCities])];
  const city = cities.find((value) => travelShortEntryForCity(value));
  if (!city) {
    return null;
  }

  return {
    ...travelShortEntryForCity(city),
    city
  };
}

// Builds a stable key so rerenders do not reload the same YouTube iframe.
function travelShortKey(candidate) {
  return [candidate.city, candidate.playlist || candidate.userUploads || candidate.publisher].join(":");
}

// Links users to the broader Shorts search for the selected route city.
function travelShortSearchUrl(candidate) {
  const query = `${candidate.city} ${candidate.region} travel shorts`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

// Uses YouTube's embed endpoints with muted autoplay so browsers allow scroll-triggered playback.
function travelShortEmbedUrl(candidate) {
  const params = new URLSearchParams({
    autoplay: "1",
    mute: "1",
    playsinline: "1",
    controls: "1",
    rel: "0",
    modestbranding: "1",
    origin: window.location.origin
  });

  if (candidate.playlist) {
    params.set("list", candidate.playlist);
    return `https://www.youtube-nocookie.com/embed/videoseries?${params}`;
  }

  params.set("listType", "user_uploads");
  params.set("list", candidate.userUploads);
  return `https://www.youtube-nocookie.com/embed?${params}`;
}

// Replaces the player with a compact pending state while the route short waits to load.
function renderTravelShortPlaceholder(label = "Ready") {
  els.travelShortPlayer.replaceChildren();
  const placeholder = document.createElement("div");
  placeholder.className = "travel-short-placeholder";

  const token = document.createElement("span");
  token.textContent = "YT";
  const copy = document.createElement("p");
  copy.textContent = label;

  placeholder.append(token, copy);
  els.travelShortPlayer.append(placeholder);
}

// Stops the previous visibility watcher before a new itinerary/video target is rendered.
function disconnectTravelShortObserver() {
  if (travelShortObserver) {
    travelShortObserver.disconnect();
    travelShortObserver = null;
  }
}

// Injects the YouTube iframe only after the small player reaches the viewport.
function loadTravelShortIframe(candidate) {
  if (!els.travelShortPlayer || travelShortActiveKey !== travelShortKey(candidate)) {
    return;
  }

  const frame = document.createElement("iframe");
  frame.title = `${candidate.city} travel short from ${candidate.publisher}`;
  frame.src = travelShortEmbedUrl(candidate);
  frame.loading = "lazy";
  frame.referrerPolicy = "strict-origin-when-cross-origin";
  frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
  frame.allowFullscreen = true;
  els.travelShortPlayer.replaceChildren(frame);
}

// Watches the route-short panel and starts playback once the user scrolls it into view.
function observeTravelShort(candidate) {
  disconnectTravelShortObserver();
  if (!("IntersectionObserver" in window)) {
    loadTravelShortIframe(candidate);
    return;
  }

  travelShortObserver = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      loadTravelShortIframe(candidate);
      disconnectTravelShortObserver();
    }
  }, {
    root: null,
    rootMargin: "80px 0px",
    threshold: 0.35
  });
  travelShortObserver.observe(els.travelShortPanel);
}

// Renders a compact video panel that follows the itinerary's first supported city.
function renderTravelShort(items) {
  if (!els.travelShortPanel || !els.travelShortPlayer) {
    return;
  }

  const candidate = travelShortCandidate(items);
  if (!candidate) {
    disconnectTravelShortObserver();
    travelShortActiveKey = "";
    els.travelShortTitle.textContent = "Travel reel";
    els.travelShortMeta.textContent = "No matching route city yet.";
    els.travelShortLink.href = "https://www.youtube.com/";
    els.travelShortLink.textContent = "Open YouTube";
    renderTravelShortPlaceholder("Pending");
    return;
  }

  const key = travelShortKey(candidate);
  els.travelShortTitle.textContent = `${candidate.city} travel short`;
  els.travelShortMeta.textContent = `${candidate.region} feed from ${candidate.publisher}.`;
  els.travelShortLink.href = travelShortSearchUrl(candidate);
  els.travelShortLink.textContent = `Open ${candidate.city} Shorts`;

  if (travelShortActiveKey === key && els.travelShortPlayer.querySelector("iframe")) {
    return;
  }

  travelShortActiveKey = key;
  renderTravelShortPlaceholder("Ready");
  observeTravelShort(candidate);
}

// Renders transit records in a dedicated section so train tickets do not get buried in the timeline.
function renderTransportation(items) {
  els.transportationList.replaceChildren();
  const transportItems = sortedTravelItems(items).filter(isTransportationItem);

  if (!transportItems.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No transportation records detected yet.";
    els.transportationList.append(empty);
    return;
  }

  for (const item of transportItems) {
    const row = document.createElement("article");
    row.className = `transportation-item travel-${item.type || "travel"}`;

    const token = document.createElement("span");
    token.className = "transportation-token";
    token.textContent = travelTypeToken(item.type);

    const copy = document.createElement("div");
    copy.className = "transportation-copy";
    const title = document.createElement("strong");
    title.textContent = item.title;
    const meta = document.createElement("p");
    const dateParts = travelDateParts(item.date);
    meta.textContent = [dateParts.dayLabel, dateParts.time, cityForTravelItem(item) || item.location, item.source].filter(Boolean).join(" / ");
    copy.append(title, meta);

    row.append(token, copy);
    els.transportationList.append(row);
  }
}

// Shows travel-gap feedback with a direct path to the Commands view.
function showTravelGapStatus(message, commandPath = "") {
  els.travelGapStatus.replaceChildren();
  const text = document.createElement("span");
  text.textContent = message;
  els.travelGapStatus.append(text);

  if (commandPath) {
    const jump = document.createElement("button");
    jump.className = "inline-action";
    jump.type = "button";
    jump.textContent = "View in Commands";
    jump.addEventListener("click", () => {
      switchView("commands");
      showCommandStatus(`Showing queued travel command: ${commandPath}`);
    });
    els.travelGapStatus.append(jump);
  }
}

// Copies a travel research prompt and opens ChatGPT for subscription-backed manual research.
async function copyChatGptTravelPrompt(gap, action) {
  const prompt = travelResearchPrompt(gap);
  const originalText = action.textContent;

  try {
    await navigator.clipboard.writeText(prompt);
    action.textContent = "Prompt Copied";
    showTravelGapStatus("Copied the travel research prompt. Opening ChatGPT...");
    window.open("https://chatgpt.com/", "_blank", "noopener");
    setTimeout(() => {
      action.textContent = originalText;
    }, 2000);
  } catch (error) {
    action.textContent = originalText;
    showTravelGapStatus(`Could not copy ChatGPT prompt: ${error.message}`);
  }
}

// Queues a planning gap as a command so Codex can help research concrete booking options.
async function queueTravelGap(gap, action, row, copy) {
  let rowStatus = row.querySelector(".travel-gap-row-status");
  if (!rowStatus) {
    rowStatus = document.createElement("p");
    rowStatus.className = "travel-gap-row-status";
    copy.append(rowStatus);
  }

  try {
    row.classList.add("is-queueing");
    action.disabled = true;
    action.textContent = "Queueing...";
    rowStatus.textContent = "Creating command record...";
    showTravelGapStatus("Queueing Codex research command for review...");
    const payload = await api.createCommand({
      command: travelGapCommand(gap),
      title: gap.title,
      skill: "codex",
      source: "travel-gap",
      tags: ["travel-gap", gap.kind, gap.classification, gap.priority, travelGapTag(gap)].filter(Boolean)
    });
    commands = payload.commands ?? commands;
    renderCommands();
    await refreshCodexHistory();
    row.classList.remove("is-queueing");
    row.classList.add("is-queued");
    rowStatus.textContent = `Queued: ${payload.created.path}`;
    action.disabled = false;
    action.textContent = "View Command";
    action.onclick = () => {
      switchView("commands");
      showCommandStatus(`Showing queued travel command: ${payload.created.path}`);
    };
    showTravelGapStatus(`Queued Codex research for review: ${payload.created.title}`, payload.created.path);
  } catch (error) {
    row.classList.remove("is-queueing");
    action.disabled = false;
    action.textContent = "Codex Research";
    rowStatus.textContent = `Queue failed: ${error.message}`;
    showTravelGapStatus(`Queue failed: ${error.message}`);
  }
}

// Renders lodging and transfer gaps with Codex and ChatGPT research handoff buttons.
function renderTravelGaps(items) {
  els.travelGaps.replaceChildren();
  els.travelGapStatus.replaceChildren();
  const gaps = travelPlanningGaps(items);

  if (!gaps.length) {
    const empty = document.createElement("p");
    empty.className = "travel-review-ok";
    empty.textContent = "No hotel-night or intercity transportation gaps detected.";
    els.travelGaps.append(empty);
    return;
  }

  for (const gap of gaps) {
    const row = document.createElement("article");
    row.className = `travel-gap-item gap-${gap.kind} gap-classification-${gap.classification || "unknown"}`;
    const canQueueCodexResearch = canOperateCodexCommands();

    const token = document.createElement("span");
    token.className = "travel-gap-token";
    token.textContent = gap.label;

    const copy = document.createElement("div");
    copy.className = "travel-gap-copy";
    const title = document.createElement("strong");
    title.textContent = gap.title;
    const meta = document.createElement("p");
    meta.className = "travel-gap-meta";
    meta.textContent = `${gap.classificationLabel || "Unclassified"} / ${gap.priority || gap.severity || "unknown"} priority - ${gap.classificationDetails || "Review this gap."}`;
    const details = document.createElement("p");
    details.textContent = gap.details;
    const recommendation = document.createElement("p");
    recommendation.className = "travel-gap-recommendation";
    recommendation.textContent = gap.recommendation;
    copy.append(title, meta, details, recommendation);

    const actions = document.createElement("div");
    actions.className = "travel-gap-actions";

    const action = document.createElement("button");
    action.className = "secondary";
    action.type = "button";

    const chatGptAction = document.createElement("button");
    chatGptAction.className = "secondary";
    chatGptAction.type = "button";
    chatGptAction.textContent = "ChatGPT Prompt";
    chatGptAction.onclick = () => copyChatGptTravelPrompt(gap, chatGptAction);

    const queuedCommand = queuedTravelGapCommand(gap);
    if (queuedCommand) {
      row.classList.add("is-queued");
      const rowStatus = document.createElement("p");
      rowStatus.className = "travel-gap-row-status";
      rowStatus.textContent = `Queued: ${statusLabel(queuedCommand.status)} / ${queuedCommand.path}`;
      copy.append(rowStatus);
      action.textContent = "View Command";
      action.onclick = () => {
        switchView("commands");
        showCommandStatus(`Showing queued travel command: ${queuedCommand.path}`);
      };
    } else {
      action.textContent = canQueueCodexResearch ? "Codex Research" : "Admin only";
      action.disabled = !canQueueCodexResearch;
      action.title = canQueueCodexResearch ? "Queue this gap for reviewed Codex research." : "Admin access is required to queue Codex research.";
      if (canQueueCodexResearch) {
        action.onclick = () => queueTravelGap(gap, action, row, copy);
      }
    }

    actions.append(action, chatGptAction);
    row.append(token, copy, actions);
    els.travelGaps.append(row);
  }
}

// Extracts a lodging stay range from a lodging item and its confirmation snippets.
function lodgingStay(item) {
  const start = travelDate(item.date);
  if (!start) {
    return null;
  }

  const checkoutSnippet = (item.snippets ?? []).find((snippet) => /^Check out:/i.test(snippet));
  const parsedEnd = checkoutSnippet ? dateFromTravelText(checkoutSnippet) : null;
  const fallbackEnd = new Date(start);
  fallbackEnd.setDate(fallbackEnd.getDate() + 1);
  const end = parsedEnd && parsedEnd > start ? parsedEnd : fallbackEnd;

  return {
    item,
    city: cityForTravelItem(item),
    start,
    end
  };
}

// Renders hotel stays as horizontal bars across the trip date span.
function renderLodgingBars(items) {
  els.lodgingBars.replaceChildren();
  const stays = items.filter((item) => item.type === "lodging").map(lodgingStay).filter(Boolean);

  if (!stays.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No lodging records detected yet.";
    els.lodgingBars.append(empty);
    return;
  }

  const rangeStart = new Date(Math.min(...stays.map((stay) => stay.start)));
  const rangeEnd = new Date(Math.max(...stays.map((stay) => stay.end)));
  const totalDays = Math.max(1, travelDaySpan(rangeStart, rangeEnd));

  for (const stay of stays) {
    const row = document.createElement("div");
    row.className = "stay-row";

    const label = document.createElement("div");
    label.className = "stay-label";
    const name = document.createElement("strong");
    name.textContent = stay.item.title;
    const meta = document.createElement("span");
    meta.textContent = [stay.city, `${shortTravelDate(stay.start)} to ${shortTravelDate(stay.end)}`].filter(Boolean).join(" / ");
    label.append(name, meta);

    const track = document.createElement("div");
    track.className = "stay-track";
    const bar = document.createElement("span");
    bar.className = "stay-bar";
    const offset = travelDaySpan(rangeStart, stay.start);
    const span = Math.max(1, travelDaySpan(stay.start, stay.end));
    bar.style.left = `${Math.min(96, (offset / totalDays) * 100)}%`;
    bar.style.width = `${Math.max(4, (span / totalDays) * 100)}%`;
    track.append(bar);

    row.append(label, track);
    els.lodgingBars.append(row);
  }
}

// Renders unknown and low-confidence records as a dedicated review lane.
function renderTravelReview(items) {
  els.travelReview.replaceChildren();
  const reviewItems = sortedTravelItems(items).filter(travelNeedsReview);

  if (!reviewItems.length) {
    const done = document.createElement("p");
    done.className = "travel-review-ok";
    done.textContent = "No review flags in the generated itinerary.";
    els.travelReview.append(done);
    return;
  }

  for (const item of reviewItems) {
    const row = document.createElement("article");
    row.className = "travel-review-item";

    const token = document.createElement("span");
    token.textContent = travelTypeToken(item.type);
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = item.title;
    const reason = document.createElement("p");
    reason.textContent = travelDate(item.date) ? `Low confidence: ${item.confidence ?? 0}` : "Date needs review";
    copy.append(title, reason);

    row.append(token, copy);
    els.travelReview.append(row);
  }
}

// Builds one itinerary card for the grouped day timeline.
function travelCard(item) {
  const node = els.travelTemplate.content.firstElementChild.cloneNode(true);
  const dateParts = travelDateParts(item.date);
  node.classList.add(`travel-${item.type || "travel"}`);
  if (travelNeedsReview(item)) {
    node.classList.add("needs-review");
  }

  node.querySelector(".travel-type-token").textContent = travelTypeToken(item.type);
  node.querySelector(".travel-time").textContent = dateParts.time || "TBD";
  node.querySelector(".note-meta").textContent = `${item.type} / confidence ${item.confidence ?? 0}`;
  node.querySelector("h3").textContent = item.title;
  node.querySelector(".travel-location").textContent = cityForTravelItem(item) || item.location || "Location needs review";
  node.querySelector(".travel-source").textContent = `Source: ${item.source}`;

  const details = node.querySelector(".travel-details");
  for (const snippet of item.snippets ?? []) {
    const detail = document.createElement("li");
    detail.textContent = snippet;
    details.append(detail);
  }
  if (!details.children.length) {
    const detail = document.createElement("li");
    detail.textContent = item.dateText ? `Matched: ${item.dateText}` : "Review source email for details.";
    details.append(detail);
  }

  return node;
}

// Renders the day-grouped timeline generated from Gmail confirmations.
function renderTravelTimeline(items) {
  els.travelTimeline.replaceChildren();

  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No itinerary items generated yet. Run npm run itinerary after ingesting travel email.";
    els.travelTimeline.append(empty);
    return;
  }

  const groups = new Map();
  for (const item of sortedTravelItems(items)) {
    const dateParts = travelDateParts(item.date);
    if (!groups.has(dateParts.dayKey)) {
      groups.set(dateParts.dayKey, { label: dateParts.dayLabel, items: [] });
    }
    groups.get(dateParts.dayKey).items.push(item);
  }

  for (const group of groups.values()) {
    const section = document.createElement("section");
    section.className = "travel-day-group";

    const header = document.createElement("div");
    header.className = "travel-day-header";
    const title = document.createElement("h3");
    title.textContent = group.label;
    const count = document.createElement("span");
    count.textContent = `${group.items.length} item${group.items.length === 1 ? "" : "s"}`;
    header.append(title, count);

    const cards = document.createElement("div");
    cards.className = "travel-day-items";
    for (const item of group.items) {
      cards.append(travelCard(item));
    }

    section.append(header, cards);
    els.travelTimeline.append(section);
  }
}

// Renders the full travel dashboard from the generated itinerary JSON.
function renderTravel() {
  const items = travelItinerary.items ?? [];
  const generatedAt = travelDate(travelItinerary.generatedAt);
  els.travelCount.textContent = String(items.length);
  els.travelGenerated.textContent = generatedAt ? `Generated ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(generatedAt)}` : "Generated time unknown";
  els.travelSource.textContent = travelItinerary.sourceFolder ? `Source: ${travelItinerary.sourceFolder}` : "Source pending";
  renderGoogleTravelControls();
  renderTravelStats(items);
  renderTravelRoute(items);
  renderTravelShort(items);
  renderTravelGaps(items);
  renderTransportation(items);
  renderLodgingBars(items);
  renderTravelReview(items);
  renderTravelTimeline(items);
}

const inboxFilterCopy = {
  focused: {
    title: "Focused Inbox",
    hint: "Human notes, tasks, and mobile captures only. Imported email stays in Email and Travel Email."
  },
  tasks: {
    title: "Tasks",
    hint: "Action-oriented captures marked as task or todo."
  },
  mobile: {
    title: "Mobile Captures",
    hint: "Notes that arrived from phone shortcuts, back tap, and quick capture flows."
  },
  email: {
    title: "General Email",
    hint: "Imported Gmail and outbound drafts that are not part of the travel account."
  },
  travel: {
    title: "Travel Email",
    hint: "Booking confirmations and travel-account email records separated from the personal inbox."
  },
  commands: {
    title: "Commands",
    hint: "Command records and Codex handoff prompts. Use the Commands tab for the full workflow."
  },
  all: {
    title: "All Inbox Records",
    hint: "Every inbox-adjacent record in one place for debugging and cleanup."
  }
};

function notePath(note) {
  return String(note?.path || "");
}

function noteType(note) {
  return String(note?.type || "").toLowerCase();
}

function noteTags(note) {
  return (note?.tags ?? []).map((tag) => String(tag).toLowerCase());
}

function noteHasTag(note, tag) {
  return noteTags(note).includes(String(tag).toLowerCase());
}

function isMobileCapture(note) {
  return notePath(note).startsWith("usernotes/mobile/");
}

function isTravelEmailNote(note) {
  const path = notePath(note);
  const accountId = String(note?.accountId || "").toLowerCase();
  return accountId === "gmail-travel" || path.startsWith("inbox/email/gmail-travel/") || noteHasTag(note, "account-gmail-travel") || noteHasTag(note, "travel-email");
}

function isEmailRecord(note) {
  const path = notePath(note);
  const type = noteType(note);
  return path.startsWith("inbox/email/") || path.startsWith("outbox/email/") || type === "email" || type === "email-draft";
}

function isCommandRecord(note) {
  return notePath(note).startsWith("commands/") || noteType(note) === "command";
}

function isTaskRecord(note) {
  return noteType(note) === "task" || noteHasTag(note, "task") || noteHasTag(note, "todo");
}

function isPersonalInboxRecord(note) {
  const path = notePath(note);
  return !isEmailRecord(note) && !isCommandRecord(note) && (path.startsWith("usernotes/") || path.startsWith("inbox/"));
}

function inboxBuckets() {
  const focused = notes.filter((note) => isPersonalInboxRecord(note));
  const tasks = focused.filter(isTaskRecord);
  const mobile = notes.filter(isMobileCapture);
  const email = notes.filter((note) => isEmailRecord(note) && !isTravelEmailNote(note));
  const travel = notes.filter(isTravelEmailNote);
  const commandRecords = notes.filter(isCommandRecord);
  const all = notes.filter((note) => isPersonalInboxRecord(note) || isEmailRecord(note) || isCommandRecord(note));

  return {
    focused,
    tasks,
    mobile,
    email,
    travel,
    commands: commandRecords,
    all
  };
}

// Selects notes that belong in the currently active inbox lane.
function inboxNotes() {
  const buckets = inboxBuckets();
  return buckets[activeInboxFilter] ?? buckets.focused;
}

// Selects mobile captures so phone-originated notes have a dedicated review surface.
function mobileNotes() {
  return notes.filter(isMobileCapture);
}

// Selects imported Gmail records for the dedicated Email view.
function emailNotes() {
  return notes.filter(isEmailRecord);
}

function inboxStat(label, value, detail) {
  const card = document.createElement("article");
  card.className = "inbox-stat-card";

  const labelNode = document.createElement("span");
  labelNode.textContent = label;
  const valueNode = document.createElement("strong");
  valueNode.textContent = String(value);
  const detailNode = document.createElement("p");
  detailNode.textContent = detail;

  card.append(labelNode, valueNode, detailNode);
  return card;
}

function renderInboxStats(buckets) {
  els.inboxStats.replaceChildren(
    inboxStat("Focus", buckets.focused.length, "notes and tasks"),
    inboxStat("Travel Email", buckets.travel.length, "booking sources"),
    inboxStat("Email", buckets.email.length, "mail records"),
    inboxStat("Commands", buckets.commands.length, "handoffs")
  );
}

function renderInboxFilters(buckets) {
  for (const button of els.inboxFilters.querySelectorAll("[data-inbox-filter]")) {
    const filter = button.dataset.inboxFilter;
    const isActive = filter === activeInboxFilter;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
    button.querySelector("strong").textContent = String((buckets[filter] ?? []).length);
  }
}

function renderInbox() {
  const buckets = inboxBuckets();
  if (!buckets[activeInboxFilter]) {
    activeInboxFilter = "focused";
  }
  const copy = inboxFilterCopy[activeInboxFilter] ?? inboxFilterCopy.focused;
  els.inboxListTitle.textContent = copy.title;
  els.inboxListHint.textContent = copy.hint;
  renderInboxStats(buckets);
  renderInboxFilters(buckets);
  renderNotes(els.noteList, buckets[activeInboxFilter] ?? buckets.focused);
}

// Reconciles all in-memory app state into the DOM after any data refresh or mutation.
function render() {
  els.noteCount.textContent = String(notes.length);
  els.indexCount.textContent = String(notes.length);
  els.mobileCount.textContent = String(mobileNotes().length);
  els.emailCount.textContent = String(emailNotes().length);
  els.travelCount.textContent = String(travelItinerary.items?.length ?? 0);
  els.graphCount.textContent = String(graph.nodes.length);
  renderInbox();
  renderNotes(els.mobileList, mobileNotes());
  renderNotes(els.emailList, emailNotes());
  renderTravel();
  renderNotes(els.searchResults, notes);
  renderCommands();
  renderCodexHistory();
  renderCommandCenter();
  renderAccess();
  renderGraph();
}

// Reloads notes from the backend and re-renders dependent views.
async function refreshNotes() {
  const payload = await api.getNotes();
  notes = payload.notes ?? [];
  render();
}

// Reloads command records and updates only the command-specific UI.
async function refreshCommands() {
  const payload = await api.getCommands();
  commands = payload.commands ?? [];
  showCommandStatus(`Commands refreshed. ${commands.length} total, ${commands.filter((command) => command.status === "pending").length} pending review.`);
  renderCommands();
  await refreshCodexHistory();
}

// Reloads only the live Codex activity timeline used by the Commands tab.
async function refreshCodexHistory() {
  codexHistory = await api.getCodexHistory();
  renderCodexHistory();
}

// Reloads the hidden Command Center aggregate only when the dev flag exposes it.
async function refreshCommandCenter() {
  if (!featureEnabled("commandCenter")) {
    renderCommandCenter();
    return;
  }
  commandCenter = await api.getCommandCenter();
  renderCommandCenter();
}

// Reloads access/session state for the Access view and topbar status.
async function refreshSession() {
  session = await api.getSession();
  applyFeatureVisibility();
  renderAccess();
  renderGoogleTravelControls();
  renderCodexControls();
  renderCommandCenter();
}

// Reloads Google OAuth setup state so SSO controls can explain what is available.
async function refreshGoogleOAuthStatus() {
  googleOAuth = await api.getGoogleOAuthStatus();
  renderGoogleTravelControls();
}

// Reloads the generated travel itinerary JSON from the backend.
async function refreshTravel() {
  travelItinerary = await api.getTravelItinerary();
  renderTravel();
}

// Reloads graph data and resets graph selection before redrawing the canvas.
async function refreshGraph() {
  graph = await api.getGraph();
  selectedGraphNode = null;
  positionGraph();
  renderGraph();
}

// Reads the backend-local hour and converts it into the time-card phase.
function localHourFromTimePayload(payload, date, timeZone) {
  const hour = Number(String(payload.localTime ?? "").split(":")[0]);
  if (Number.isFinite(hour)) {
    return hour;
  }
  const hourPart = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hourCycle: "h23",
    timeZone
  }).formatToParts(date).find((part) => part.type === "hour")?.value;
  return Number(hourPart);
}

// Updates the time-card icon: daytime from 12:00 AM to 11:59 AM, nighttime otherwise.
function renderTimePhase(payload, date, timeZone) {
  const hour = localHourFromTimePayload(payload, date, timeZone);
  const phase = hour >= 0 && hour < 12 ? "day" : "night";
  const label = phase === "day" ? "Daytime" : "Nighttime";
  const card = els.localTime.closest(".time-card");

  card.classList.toggle("phase-day", phase === "day");
  card.classList.toggle("phase-night", phase === "night");
  els.timePhaseIcon.className = `time-phase-icon phase-${phase}`;
  els.timePhaseIcon.setAttribute("aria-label", label);
}

// Formats compact weather metadata without crowding the topbar.
function weatherDetail(weather, location) {
  const details = [];
  if (location?.label) {
    details.push(location.label);
  }
  if (Number.isFinite(Number(weather.cloudCover))) {
    details.push(`${Math.round(Number(weather.cloudCover))}% clouds`);
  }
  if (Number.isFinite(Number(weather.windSpeed))) {
    details.push(`${Math.round(Number(weather.windSpeed))} mph wind`);
  }
  return details.join(" / ");
}

// Chooses the most important environment icon, giving active sky events priority over weather.
function environmentIconClass() {
  const eclipse = environmentStatus.eclipse ?? {};
  if (eclipse.status === "active") {
    return `event-${eclipse.icon || "eclipse"}`;
  }
  return `weather-${environmentStatus.weather?.icon || "unknown"}`;
}

// Renders the topbar weather and eclipse widget from the backend environment model.
function renderEnvironment() {
  const location = environmentStatus.location ?? {};
  const weather = environmentStatus.weather ?? {};
  const eclipse = environmentStatus.eclipse ?? {};

  els.environmentIcon.className = `environment-icon ${environmentIconClass()}`;
  if (eclipse.status === "active") {
    els.environmentPrimary.textContent = eclipse.label || "Sky event";
    const weatherTemp = weather.status === "ok" && weather.temperature !== null ? ` / ${weather.temperature}${weather.unit || "F"}` : "";
    els.environmentSecondary.textContent = `${eclipse.detail || "Active near this location."}${weatherTemp}`;
    return;
  }

  if (weather.status === "ok") {
    const temperature = weather.temperature !== null ? `${weather.temperature}${weather.unit || "F"}` : "";
    els.environmentPrimary.textContent = [temperature, weather.condition].filter(Boolean).join(" / ");
    els.environmentSecondary.textContent = weatherDetail(weather, location) || "Local weather active";
    return;
  }

  els.environmentPrimary.textContent = weather.condition || "Weather not configured";
  els.environmentSecondary.textContent = weather.detail || eclipse.detail || "Set location to enable weather and eclipse checks.";
}

// Refreshes weather and sky-event status independently from the clock.
async function refreshEnvironment() {
  try {
    environmentStatus = await api.getEnvironment();
  } catch (error) {
    environmentStatus = {
      location: { configured: false, label: "Location unavailable" },
      weather: { status: "unavailable", condition: "Weather unavailable", icon: "unknown", detail: error.message },
      eclipse: { status: "unavailable", icon: "none", label: "Sky status unavailable", detail: error.message }
    };
  }
  renderEnvironment();
}

// Refreshes the local backend time display using the backend's timezone data.
async function refreshTime() {
  const payload = await api.getTime();
  const date = new Date(payload.iso);
  const timeZone = payload.timeZone || "UTC";
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone
  }).format(date);
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone
  }).format(date);
  const zoneLabel = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short"
  }).formatToParts(date).find((part) => part.type === "timeZoneName")?.value ?? payload.utcOffset ?? "UTC";

  els.localTime.textContent = time;
  els.localTime.dateTime = payload.localDateTime || payload.iso;
  renderTimePhase(payload, date, timeZone);
  els.localDate.textContent = dateLabel;
  els.localZone.textContent = `${zoneLabel} / ${timeZone}`;
  els.timeUpdated.textContent = `Synced ${payload.localTime ?? ""}`;
  els.localTime.closest(".time-card").title = `${payload.localDateTime} ${timeZone}`;
}

// Shows lightweight status and error messages in the existing import/status area.
function showError(message) {
  els.importStatus.textContent = message;
}

// Shows command-specific status where the user is currently reviewing handoffs.
function showCommandStatus(message) {
  els.commandStatus.textContent = message;
}

// Shows email compose feedback without mixing it into import status.
function showEmailStatus(message) {
  els.emailStatus.textContent = message;
}

// Maps graph node types to stable colors so the canvas stays visually consistent.
function graphColor(type) {
  if (type === "domain") {
    return "#b75f2a";
  }
  if (type === "tag") {
    return "#1b7fc1";
  }
  return "#2f6f5e";
}

// Restores browser-local graph layout pins created by dragging nodes.
function loadGraphLayout() {
  try {
    const raw = window.localStorage.getItem(graphLayoutStorageKey);
    const entries = JSON.parse(raw || "[]");
    return new Map(Array.isArray(entries) ? entries.filter(([, value]) => Number.isFinite(value?.xRatio) && Number.isFinite(value?.yRatio)) : []);
  } catch {
    return new Map();
  }
}

// Persists manual graph layout pins so the user's rearrangement survives refreshes.
function saveGraphLayout() {
  try {
    window.localStorage.setItem(graphLayoutStorageKey, JSON.stringify([...graphManualPositions.entries()]));
  } catch {
    // Browser storage can be unavailable in hardened contexts; dragging should still work for the session.
  }
}

// Keeps dragged nodes inside the graph canvas so labels and edge endpoints remain reachable.
function clampGraphCoordinate(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// Converts a pointer event into graph canvas coordinates in CSS pixels.
function graphPoint(event) {
  const rect = els.knowledgeGraph.getBoundingClientRect();
  return {
    rect,
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

// Returns graph node positions that are visible in the current graph focus mode.
function visibleGraphPositions() {
  const view = filteredGraph();
  const visibleIds = new Set(view.nodes.map((node) => node.id));
  return graphPositions.filter((node) => visibleIds.has(node.id));
}

// Finds the nearest draggable graph node at a canvas coordinate.
function graphNodeAt(x, y) {
  return visibleGraphPositions()
    .map((node) => ({ node, distance: Math.hypot(node.x - x, node.y - y) }))
    .filter(({ node, distance }) => distance <= node.r + 10)
    .sort((left, right) => left.distance - right.distance)[0]?.node ?? null;
}

// Pins a node's normalized position and redraws connected edges at the new distance.
function moveGraphNode(nodeId, x, y) {
  const node = graphPositions.find((item) => item.id === nodeId);
  if (!node) {
    return null;
  }

  const width = els.knowledgeGraph.clientWidth || 980;
  const height = els.knowledgeGraph.clientHeight || 560;
  const margin = Math.max(node.r + 18, 28);
  const nextX = clampGraphCoordinate(x, margin, Math.max(margin, width - margin));
  const nextY = clampGraphCoordinate(y, margin, Math.max(margin, height - margin));

  node.x = nextX;
  node.y = nextY;
  graphManualPositions.set(node.id, {
    xRatio: nextX / Math.max(width, 1),
    yRatio: nextY / Math.max(height, 1)
  });
  selectedGraphNode = node;
  renderGraph();
  return node;
}

// Updates the graph canvas cursor based on hover and drag state.
function updateGraphCursor(event) {
  if (graphDrag) {
    els.knowledgeGraph.classList.add("is-dragging");
    return;
  }

  const { x, y } = graphPoint(event);
  els.knowledgeGraph.classList.toggle("is-draggable", Boolean(graphNodeAt(x, y)));
}

// Applies the graph focus control and returns the visible subgraph.
function filteredGraph() {
  const mode = els.graphMode.value;
  if (mode === "all") {
    return graph;
  }

  const visibleTypes = new Set(mode === "notes" ? ["note"] : mode === "domains" ? ["note", "domain"] : ["note", "tag"]);
  const nodes = graph.nodes.filter((node) => visibleTypes.has(node.type));
  const ids = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  return { nodes, edges };
}

// Computes deterministic canvas positions for domains, tags, and notes.
function positionGraph() {
  const width = els.knowledgeGraph.clientWidth || 980;
  const height = els.knowledgeGraph.clientHeight || 560;
  const cx = width / 2;
  const cy = height / 2;
  const nodes = graph.nodes;
  const domains = nodes.filter((node) => node.type === "domain");
  const tags = nodes.filter((node) => node.type === "tag");
  const noteNodes = nodes.filter((node) => node.type === "note");
  const positions = new Map();

  domains.forEach((node, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(domains.length, 1);
    positions.set(node.id, {
      ...node,
      x: cx + Math.cos(angle) * width * 0.22,
      y: cy + Math.sin(angle) * height * 0.18,
      r: 18 + Math.min(node.count ?? 1, 12)
    });
  });

  tags.forEach((node, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(tags.length, 1) + 0.2;
    positions.set(node.id, {
      ...node,
      x: cx + Math.cos(angle) * width * 0.42,
      y: cy + Math.sin(angle) * height * 0.34,
      r: 9 + Math.min(node.count ?? 1, 9)
    });
  });

  noteNodes.forEach((node, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(noteNodes.length, 1) + 0.6;
    const ring = 0.24 + (index % 4) * 0.045;
    positions.set(node.id, {
      ...node,
      x: cx + Math.cos(angle) * width * ring,
      y: cy + Math.sin(angle) * height * ring,
      r: 8
    });
  });

  graphPositions = [...positions.values()].map((node) => {
    const manual = graphManualPositions.get(node.id);
    if (!manual) {
      return node;
    }

    const margin = Math.max(node.r + 18, 28);
    return {
      ...node,
      x: clampGraphCoordinate(manual.xRatio * width, margin, Math.max(margin, width - margin)),
      y: clampGraphCoordinate(manual.yRatio * height, margin, Math.max(margin, height - margin))
    };
  });
}

// Draws a short label under a graph node while keeping long titles bounded.
function drawLabel(ctx, node) {
  const label = node.label.length > 26 ? `${node.label.slice(0, 24)}...` : node.label;
  ctx.font = node.type === "domain" ? "600 12px system-ui" : "12px system-ui";
  ctx.fillStyle = "#eef3f6";
  ctx.textAlign = "center";
  ctx.fillText(label, node.x, node.y + node.r + 14);
}

// Renders the side panel for the selected graph node.
function renderGraphDetail(node) {
  els.graphDetail.replaceChildren();

  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = node ? node.type : "Selection";
  els.graphDetail.append(eyebrow);

  const title = document.createElement("h3");
  title.textContent = node ? node.label : "Choose a node";
  els.graphDetail.append(title);

  if (!node) {
    const body = document.createElement("p");
    body.className = "note-body";
    body.textContent = "Click a circle to inspect it, or drag a node to stretch and rearrange its connected edges.";
    els.graphDetail.append(body);
    return;
  }

  const details = document.createElement("dl");
  const pinned = graphManualPositions.has(node.id) ? "Pinned by drag" : "Generated";
  for (const [label, value] of [["Path", node.path ?? "none"], ["Count", node.count ?? 1], ["Layout", pinned], ["ID", node.id]]) {
    const term = document.createElement("dt");
    term.textContent = label;
    const definition = document.createElement("dd");
    definition.textContent = String(value);
    details.append(term, definition);
  }
  els.graphDetail.append(details);
}

// Draws the current graph view onto the canvas, including edges, nodes, and selection.
function renderGraph() {
  const canvas = els.knowledgeGraph;
  if (!canvas) {
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * scale));
  canvas.height = Math.max(1, Math.floor(rect.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const view = filteredGraph();
  const visibleIds = new Set(view.nodes.map((node) => node.id));
  const positions = new Map(graphPositions.filter((node) => visibleIds.has(node.id)).map((node) => [node.id, node]));

  if (selectedGraphNode && positions.has(selectedGraphNode.id)) {
    selectedGraphNode = positions.get(selectedGraphNode.id);
  } else if (selectedGraphNode) {
    selectedGraphNode = null;
  }

  ctx.lineCap = "round";
  for (const edge of view.edges) {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!source || !target) {
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(source.x, source.y);
    ctx.lineTo(target.x, target.y);
    ctx.strokeStyle = edge.type.includes("link") ? "rgba(47,111,94,0.45)" : "rgba(102,113,125,0.22)";
    ctx.lineWidth = Math.min(4, 1 + edge.weight * 0.35);
    ctx.stroke();
  }

  for (const node of positions.values()) {
    const selected = selectedGraphNode?.id === node.id;
    ctx.beginPath();
    ctx.arc(node.x, node.y, selected ? node.r + 4 : node.r, 0, Math.PI * 2);
    ctx.fillStyle = graphColor(node.type);
    ctx.fill();
    ctx.strokeStyle = selected ? "#eef3f6" : "#151b20";
    ctx.lineWidth = selected ? 3 : 2;
    ctx.stroke();
    drawLabel(ctx, node);
  }

  renderGraphDetail(selectedGraphNode);
}

// Switches between top-level app views and redraws graph layout when needed.
function switchView(viewName) {
  const tab = document.querySelector(`.tab[data-view="${viewName}"]`);
  const view = document.querySelector(`#${viewName}View`);
  if (!tab || !view) {
    return;
  }
  const featureName = tab.dataset.feature || view.dataset.feature || "";
  if (featureName && !featureEnabled(featureName)) {
    return;
  }

  document.querySelectorAll(".tab").forEach((item) => item.classList.remove("is-active"));
  document.querySelectorAll(".view").forEach((item) => item.classList.remove("is-active"));
  tab.classList.add("is-active");
  view.classList.add("is-active");
  if (viewName === "graph") {
    positionGraph();
    renderGraph();
  }
  if (viewName === "commandCenter") {
    refreshCommandCenter().catch((error) => {
      els.commandCenterSync.textContent = error.message;
    });
  }
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => switchView(tab.dataset.view));
});

// Keeps the Capture form copy aligned with whether the user is creating a note or a command.
function syncCaptureMode() {
  const isCommand = els.type.value === "command";
  const canQueueCommand = canOperateCodexCommands();
  els.captureSubmit.disabled = isCommand && !canQueueCommand;
  els.captureSubmit.textContent = isCommand
    ? canQueueCommand ? "Queue command" : "Admin required"
    : "Capture note";
  els.title.required = !isCommand;
  els.title.placeholder = isCommand ? "Optional short command title" : "What should this be called?";
  els.body.placeholder = isCommand
    ? canQueueCommand ? "Describe the Orbiter change, research task, or Codex prompt to queue for review." : "Only admin users can queue Codex commands."
    : "Capture the thought, link, quote, decision, or reminder.";
}

// Handles manual capture. Command captures go into the same pending queue as remote commands.
els.form.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const title = els.title.value.trim();
    const body = els.body.value.trim();
    const tags = splitTags(els.tags.value);

    if (els.type.value === "command") {
      if (!canOperateCodexCommands()) {
        els.captureStatus.textContent = "Admin access is required to queue Codex commands.";
        return;
      }
      const command = body || title;
      if (!command) {
        els.captureStatus.textContent = "Command text is required.";
        return;
      }
      const payload = await api.createCommand({
        title: title || undefined,
        command,
        skill: "codex",
        source: "orbiter-capture",
        tags
      });
      commands = payload.commands ?? [];
      await refreshCodexHistory();
      els.captureStatus.textContent = `Queued command for review: ${payload.created.title}`;
      renderCommands();
    } else {
      const payload = await api.createNote({
        title,
        body,
        type: els.type.value,
        tags
      });
      notes = payload.notes ?? [];
      els.captureStatus.textContent = "Captured to inbox.";
    }

    els.form.reset();
    els.title.focus();
    syncCaptureMode();
    render();
  } catch (error) {
    els.captureStatus.textContent = error.message;
  }
});

els.type.addEventListener("change", syncCaptureMode);

// Runs live search as the user types and renders the returned result set.
els.searchInput.addEventListener("input", async () => {
  try {
    const payload = await api.search(els.searchInput.value);
    renderNotes(els.searchResults, payload.notes ?? []);
  } catch (error) {
    showError(error.message);
  }
});

// Reads selected markdown files in the browser and sends their text to the backend import route.
els.markdownImport.addEventListener("change", async (event) => {
  const selectedFiles = [...event.target.files ?? []];

  try {
    const files = [];
    for (const file of selectedFiles) {
      files.push({
        filename: file.name,
        markdown: await file.text()
      });
    }

    const payload = await api.importMarkdown(files);
    notes = payload.notes ?? [];
    els.importStatus.textContent = selectedFiles.length ? `Imported ${selectedFiles.length} markdown file${selectedFiles.length === 1 ? "" : "s"} to inbox.` : "";
    event.target.value = "";
    render();
  } catch (error) {
    showError(error.message);
  }
});

// Refreshes the inbox view from disk-backed backend state.
els.clearReviewed.addEventListener("click", async () => {
  await refreshNotes();
});

// Switches the Review tab between focused notes, email lanes, travel imports, and commands.
els.inboxFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-inbox-filter]");
  if (!button) {
    return;
  }

  activeInboxFilter = button.dataset.inboxFilter || "focused";
  renderInbox();
});

// Refreshes mobile captures after the iPhone Shortcut sends new input.
els.refreshMobile.addEventListener("click", async () => {
  await refreshNotes();
});

// Refreshes imported email notes after Gmail ingest runs.
els.refreshEmail.addEventListener("click", async () => {
  await refreshNotes();
});

// Creates a local reviewable outbound email draft from the Email tab.
els.emailDraftForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    showEmailStatus("Creating draft...");
    const payload = await api.createEmailDraft({
      account: "gmail-primary",
      to: els.emailTo.value.trim(),
      subject: els.emailSubject.value.trim(),
      body: els.emailBody.value.trim()
    });
    notes = payload.notes ?? [];
    els.emailSubject.value = "";
    els.emailBody.value = "";
    showEmailStatus(`Draft created: ${payload.draft.path}`);
    render();
  } catch (error) {
    showEmailStatus(error.message);
  }
});

// Refreshes the itinerary view after running the travel itinerary generator.
els.refreshTravel.addEventListener("click", refreshTravel);

els.connectGoogleTravel.addEventListener("click", openGoogleTravelPopup);

els.importGoogleTravel.addEventListener("click", async () => {
  try {
    els.importGoogleTravel.disabled = true;
    els.googleTravelStatus.textContent = "Importing up to 100 travel emails from Gmail...";
    const payload = await api.importGoogleTravel(googleOAuth.importLimit || 100);
    notes = payload.notes ?? notes;
    travelItinerary = payload.travelItinerary ?? payload.itinerary ?? travelItinerary;
    els.googleTravelStatus.textContent = `Imported ${payload.importedCount} Gmail travel email${payload.importedCount === 1 ? "" : "s"}. Itinerary items: ${travelItinerary.itemCount ?? travelItinerary.items?.length ?? 0}.`;
    render();
  } catch (error) {
    els.googleTravelStatus.textContent = error.message;
  } finally {
    renderGoogleTravelControls();
  }
});

window.addEventListener("message", async (event) => {
  if (event.origin !== window.location.origin || event.data?.type !== "orbiter-google-login") {
    return;
  }
  if (!event.data.ok) {
    els.googleTravelStatus.textContent = "Google sign-in did not complete.";
    return;
  }
  const importNote = event.data.importError
    ? `Signed in, but Gmail import needs attention: ${event.data.importError}`
    : `Signed in with Google. Imported ${event.data.imported} travel email${event.data.imported === "1" ? "" : "s"} and found ${event.data.items} itinerary item${event.data.items === "1" ? "" : "s"}.`;
  els.googleTravelStatus.textContent = importNote;
  await refreshSession();
  await refreshNotes();
  await refreshTravel();
});

// Refreshes command records without a full page reload.
els.refreshCommands.addEventListener("click", refreshCommands);
// Refreshes the Codex activity stream without touching the command cards.
els.refreshCodexHistory.addEventListener("click", async () => {
  try {
    await refreshCodexHistory();
    showCommandStatus("Codex history refreshed.");
  } catch (error) {
    showCommandStatus(error.message);
  }
});
els.refreshCommandCenter.addEventListener("click", async () => {
  try {
    els.refreshCommandCenter.disabled = true;
    els.commandCenterSync.textContent = "Refreshing Command Center...";
    await refreshCommandCenter();
  } catch (error) {
    els.commandCenterSync.textContent = error.message;
  } finally {
    els.refreshCommandCenter.disabled = false;
  }
});
// Previews a reviewed command for Codex and prints the handoff block without claiming it.
els.codexNext.addEventListener("click", async () => {
  try {
    els.codexNext.disabled = true;
    showCommandStatus("Preparing next Codex handoff preview...");
    const payload = await api.claimCodexNext({ noClaim: true });
    commands = payload.commands ?? [];

    if (payload.handoff) {
      els.codexHandoffOutput.value = payload.handoff.output;
      els.codexHandoffPanel.hidden = false;
      els.copyCodexHandoff.hidden = false;
    } else {
      els.codexHandoffOutput.value = "";
      els.codexHandoffPanel.hidden = true;
      els.copyCodexHandoff.hidden = true;
    }

    showCommandStatus(payload.message);
    renderCommands();
  } catch (error) {
    showCommandStatus(error.message);
  } finally {
    renderCodexControls();
  }
});
// Copies the last claimed handoff so it can be pasted into the Codex thread.
els.copyCodexHandoff.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(els.codexHandoffOutput.value);
    showCommandStatus("Copied Codex handoff.");
  } catch {
    els.codexHandoffOutput.select();
    document.execCommand("copy");
    showCommandStatus("Copied Codex handoff.");
  }
});
// Logs out of production mode on this browser by clearing the session cookie.
els.logoutButton.addEventListener("click", async () => {
  try {
    if (session.user?.ephemeral) {
      const confirmed = window.confirm("Log out and remove this guest user's local Orbiter data from the filesystem?");
      if (!confirmed) {
        return;
      }
    }
    await api.logout();
    window.location.href = "/login.html";
  } catch (error) {
    showError(error.message);
  }
});
// Reloads graph data from the backend when the user asks for a fresh graph.
els.refreshGraph.addEventListener("click", refreshGraph);
// Redraws the graph immediately when the user changes graph focus.
els.graphMode.addEventListener("change", () => {
  positionGraph();
  renderGraph();
});
// Clears all browser-local pinned graph positions and returns to the generated layout.
els.resetGraphLayout.addEventListener("click", () => {
  graphManualPositions = new Map();
  saveGraphLayout();
  selectedGraphNode = null;
  positionGraph();
  renderGraph();
});
// Starts a graph node drag when the pointer lands on a visible node.
els.knowledgeGraph.addEventListener("pointerdown", (event) => {
  const { x, y } = graphPoint(event);
  const node = graphNodeAt(x, y);
  if (!node) {
    selectedGraphNode = null;
    renderGraph();
    return;
  }

  event.preventDefault();
  selectedGraphNode = node;
  graphDrag = {
    nodeId: node.id,
    pointerId: event.pointerId,
    offsetX: x - node.x,
    offsetY: y - node.y,
    moved: false
  };
  els.knowledgeGraph.classList.add("is-dragging");
  els.knowledgeGraph.setPointerCapture?.(event.pointerId);
  renderGraph();
});
// Moves the selected graph node and redraws its connected edges in real time.
els.knowledgeGraph.addEventListener("pointermove", (event) => {
  if (!graphDrag) {
    updateGraphCursor(event);
    return;
  }

  event.preventDefault();
  const { x, y } = graphPoint(event);
  const moved = moveGraphNode(graphDrag.nodeId, x - graphDrag.offsetX, y - graphDrag.offsetY);
  graphDrag.moved = Boolean(moved);
});
// Finalizes a drag and stores the normalized node position in browser-local layout state.
els.knowledgeGraph.addEventListener("pointerup", (event) => {
  if (!graphDrag) {
    return;
  }

  if (graphDrag.moved) {
    saveGraphLayout();
  }
  els.knowledgeGraph.releasePointerCapture?.(graphDrag.pointerId);
  graphDrag = null;
  els.knowledgeGraph.classList.remove("is-dragging");
  updateGraphCursor(event);
  renderGraph();
});
els.knowledgeGraph.addEventListener("pointercancel", () => {
  graphDrag = null;
  els.knowledgeGraph.classList.remove("is-draggable", "is-dragging");
  renderGraph();
});
// Restores the neutral cursor when the pointer leaves the graph without an active drag.
els.knowledgeGraph.addEventListener("pointerleave", () => {
  if (!graphDrag) {
    els.knowledgeGraph.classList.remove("is-draggable", "is-dragging");
  }
});
// Recalculates graph geometry when the canvas changes size.
window.addEventListener("resize", () => {
  positionGraph();
  renderGraph();
});

syncCaptureMode();
// Hydrates every independent data source before the first interactive render settles.
await Promise.all([refreshSession(), refreshGoogleOAuthStatus(), refreshNotes(), refreshCommands(), refreshCodexHistory(), refreshTravel(), refreshTime(), refreshEnvironment(), refreshGraph()]);
if (featureEnabled("commandCenter")) {
  await refreshCommandCenter();
}
// Keeps the Codex history panel live while the Commands tab is open.
window.setInterval(async () => {
  if (!document.querySelector("#commandsView")?.classList.contains("is-active")) {
    return;
  }
  try {
    await refreshCodexHistory();
  } catch {
    // Keep background polling quiet; manual refresh still reports errors.
  }
}, 10000);
// Keeps the hidden Command Center live only while the dev tab is visible.
window.setInterval(async () => {
  if (!document.querySelector("#commandCenterView")?.classList.contains("is-active")) {
    return;
  }
  try {
    await refreshCommandCenter();
  } catch {
    // Manual refresh reports errors; background polling should not interrupt the dashboard.
  }
}, 15000);
// Keeps the displayed backend-local time current without polling heavier endpoints.
setInterval(refreshTime, 30000);
// Keeps weather and sky-event status fresh without calling external weather services too often.
setInterval(refreshEnvironment, 10 * 60 * 1000);
