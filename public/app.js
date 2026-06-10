// Client Spyfall FR — vanilla JS, synchronisation par sondage toutes les 2 s.
const $ = (id) => document.getElementById(id);

let session = JSON.parse(localStorage.getItem("spyfall-session") || "null");
let pollTimer = null;
let countdownTimer = null;
let lastStatus = null;

function saveSession(s) {
  session = s;
  if (s) localStorage.setItem("spyfall-session", JSON.stringify(s));
  else localStorage.removeItem("spyfall-session");
}

async function api(path, options) {
  const res = await fetch(path, options && {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Erreur réseau");
  return data;
}

function show(screenId) {
  for (const s of document.querySelectorAll(".screen")) s.classList.add("hidden");
  $(screenId).classList.remove("hidden");
}

function setError(id, msg) {
  $(id).textContent = msg || "";
}

// --- Accueil ---------------------------------------------------------------

$("btn-create").onclick = async () => {
  setError("home-error", "");
  try {
    const { code, playerId } = await api("/api/rooms", { name: $("name-input").value });
    saveSession({ code, playerId });
    startPolling();
  } catch (e) {
    setError("home-error", e.message);
  }
};

$("btn-join").onclick = async () => {
  setError("home-error", "");
  const code = $("code-input").value.trim().toUpperCase();
  try {
    const { playerId } = await api(`/api/rooms/${code}/join`, { name: $("name-input").value });
    saveSession({ code, playerId });
    startPolling();
  } catch (e) {
    setError("home-error", e.message);
  }
};

// --- Synchronisation ---------------------------------------------------------

function startPolling() {
  stopPolling();
  poll();
  pollTimer = setInterval(poll, 2000);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function poll() {
  if (!session) return;
  try {
    const state = await api(`/api/rooms/${session.code}/state?playerId=${session.playerId}`);
    render(state);
  } catch (e) {
    // Salle expirée ou joueur inconnu : retour à l'accueil.
    stopPolling();
    saveSession(null);
    show("screen-home");
    setError("home-error", e.message);
  }
}

function render(state) {
  if (state.status === "lobby") {
    show("screen-lobby");
    $("lobby-code").textContent = state.code;
    $("lobby-players").innerHTML = state.players
      .map((p) => `<li>${escapeHtml(p.name)}${p.isHost ? " 👑" : ""}</li>`)
      .join("");
    $("host-controls").classList.toggle("hidden", !state.you.isHost);
    $("lobby-hint").classList.toggle("hidden", state.you.isHost);
    if (state.you.isHost && !$("deck-select").options.length) {
      $("deck-select").innerHTML = Object.entries(state.decks)
        .map(([k, d]) => `<option value="${k}">${escapeHtml(d.label)} (${d.count} lieux)</option>`)
        .join("");
      $("deck-select").value = state.deck;
    }
  } else if (state.status === "playing") {
    if (lastStatus !== "playing") {
      // Nouvelle manche : carte de nouveau face cachée.
      $("btn-flip").classList.remove("hidden");
      $("card-content").classList.add("hidden");
      renderCard(state.card);
      $("locations-list").innerHTML = state.locations
        .map((l) => `<li>${escapeHtml(l)}</li>`)
        .join("");
    }
    $("btn-end").classList.toggle("hidden", !state.you.isHost);
    startCountdown(state.endsAt);
    show("screen-game");
  } else if (state.status === "reveal") {
    stopCountdown();
    show("screen-reveal");
    $("reveal-spy").textContent = state.reveal.spyName;
    $("reveal-location").textContent = state.reveal.location;
    $("btn-again").classList.toggle("hidden", !state.you.isHost);
  }
  lastStatus = state.status;
}

function renderCard(card) {
  $("card-content").innerHTML = card.spy
    ? `<p class="card-title spy">🤫 Vous êtes l'ESPION</p>
       <p>Vous ne connaissez pas le lieu. Écoutez, bluffez, et essayez de le deviner !</p>`
    : `<p class="card-label">Lieu</p>
       <p class="card-title">${escapeHtml(card.location)}</p>
       <p class="card-label">Votre rôle</p>
       <p class="card-role">${escapeHtml(card.role)}</p>`;
}

$("btn-flip").onclick = () => {
  $("btn-flip").classList.add("hidden");
  $("card-content").classList.remove("hidden");
};

// --- Actions de l'hôte -------------------------------------------------------

$("btn-start").onclick = async () => {
  setError("lobby-error", "");
  try {
    const state = await api(`/api/rooms/${session.code}/start`, {
      playerId: session.playerId,
      durationMin: Number($("duration-input").value),
      deck: $("deck-select").value,
    });
    render(state);
  } catch (e) {
    setError("lobby-error", e.message);
  }
};

$("btn-end").onclick = async () => {
  setError("game-error", "");
  try {
    render(await api(`/api/rooms/${session.code}/end`, { playerId: session.playerId }));
  } catch (e) {
    setError("game-error", e.message);
  }
};

$("btn-again").onclick = async () => {
  setError("reveal-error", "");
  try {
    render(await api(`/api/rooms/${session.code}/lobby`, { playerId: session.playerId }));
  } catch (e) {
    setError("reveal-error", e.message);
  }
};

// --- Chrono -------------------------------------------------------------------

function startCountdown(endsAt) {
  stopCountdown();
  const tick = () => {
    const remaining = Math.max(0, endsAt - Date.now());
    const m = Math.floor(remaining / 60000);
    const s = Math.floor((remaining % 60000) / 1000);
    $("timer").textContent = `${m}:${String(s).padStart(2, "0")}`;
    $("timer").classList.toggle("urgent", remaining < 60000);
    if (remaining === 0) stopCountdown();
  };
  tick();
  countdownTimer = setInterval(tick, 500);
}

function stopCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = null;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// Reprise de session après rechargement de la page.
if (session) startPolling();
else show("screen-home");
