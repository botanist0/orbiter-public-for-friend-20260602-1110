const form = document.querySelector("#loginForm");
const token = document.querySelector("#accessToken");
const status = document.querySelector("#loginStatus");
const googleButton = document.querySelector("#googleLoginButton");
const googleStatus = document.querySelector("#googleLoginStatus");

function popupCompleteFromQuery() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("popup") !== "1") {
    return false;
  }
  const message = {
    type: "orbiter-google-login",
    ok: params.get("google") === "connected",
    imported: params.get("imported") || "0",
    items: params.get("items") || "0",
    importError: params.get("import_error") || ""
  };
  window.opener?.postMessage(message, window.location.origin);
  window.close();
  return true;
}

async function refreshGoogleLoginStatus() {
  try {
    const response = await fetch("/api/google/oauth/status", { credentials: "same-origin" });
    const payload = await response.json();
    if (!response.ok || !payload.configured) {
      googleButton.disabled = true;
      googleStatus.textContent = payload.configured === false
        ? "Google sign-in is not configured on this Orbiter server yet."
        : payload.error || "Google sign-in is unavailable.";
      return;
    }
    googleButton.disabled = false;
    googleStatus.textContent = "For family travel planning, sign in with Gmail.";
  } catch (error) {
    googleButton.disabled = true;
    googleStatus.textContent = error.message;
  }
}

function startGooglePopup() {
  googleStatus.textContent = "Opening Google sign-in...";
  const params = new URLSearchParams({ popup: "1", returnTo: "/" });
  const popup = window.open(`/api/google/oauth/start?${params}`, "orbiter_google_sso", "width=520,height=720,noopener=false");
  if (!popup) {
    googleStatus.textContent = "Popup blocked. Opening Google sign-in in this tab.";
    window.location.href = `/api/google/oauth/start?${params}`;
  }
}

if (!popupCompleteFromQuery()) {
  await refreshGoogleLoginStatus();
}

googleButton.addEventListener("click", startGooglePopup);

window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin || event.data?.type !== "orbiter-google-login") {
    return;
  }
  if (!event.data.ok) {
    googleStatus.textContent = "Google sign-in did not complete.";
    return;
  }
  const importNote = event.data.importError
    ? ` Signed in, but Gmail import needs attention: ${event.data.importError}`
    : ` Imported ${event.data.imported} travel email${event.data.imported === "1" ? "" : "s"} and found ${event.data.items} itinerary item${event.data.items === "1" ? "" : "s"}.`;
  googleStatus.textContent = `Google sign-in complete.${importNote}`;
  window.location.href = "/";
});

// Exchanges a one-time visible access token for an HttpOnly browser session cookie.
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  status.textContent = "Checking token...";

  try {
    const response = await fetch("/api/session/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: token.value.trim() })
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Login failed.");
    }

    status.textContent = `Unlocked for ${payload.user.name}.`;
    window.location.href = "/";
  } catch (error) {
    status.textContent = error.message;
  }
});
