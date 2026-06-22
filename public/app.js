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

function authHeaders() {
  const p = localStorage.getItem("spyfall-pass");
  return p ? { "x-spyfall-pass": p } : {};
}

async function api(path, options) {
  const init = options
    ? { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(options) }
    : { headers: authHeaders() };
  const res = await fetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || "Erreur réseau");
    e.status = res.status;
    throw e;
  }
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

// Charge les modes proposés à la création (écran d'accueil, avant toute salle).
async function loadDecks() {
  try {
    const { decks } = await api("/api/decks");
    $("mode-select").innerHTML = Object.entries(decks)
      .map(([k, d]) => `<option value="${k}">${escapeHtml(d.label)} (${d.count} lieux)</option>`)
      .join("");
  } catch {
    /* réseau indisponible : on réessaiera, la création échouera proprement sinon */
  }
}

$("btn-create").onclick = async () => {
  setError("home-error", "");
  try {
    const { code, playerId } = await api("/api/rooms", {
      name: $("name-input").value,
      deck: $("mode-select").value,
    });
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
    stopPolling();
    if (e.status === 401) {
      // Mot de passe changé/expiré : on revient au portail.
      lockGate("Ré-entrez le mot de passe.");
      return;
    }
    // Salle expirée ou joueur inconnu : retour à l'accueil.
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
      // Nouvelle manche : carte de nouveau face cachée, ratures effacées.
      $("btn-flip").classList.remove("hidden");
      $("card-content").classList.add("hidden");
      renderCard(state.card);
      renderLocations(state.locations);
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

// Liste des lieux groupée par thème. Toucher un thème ou un lieu le raye :
// c'est un pense-bête personnel (rien n'est partagé), surtout utile à
// l'espion pour éliminer des thématiques entières.
function renderLocations(locations) {
  const byTheme = new Map();
  for (const l of locations) {
    if (!byTheme.has(l.theme)) byTheme.set(l.theme, []);
    byTheme.get(l.theme).push(l.name);
  }
  $("locations-list").innerHTML = [...byTheme.entries()]
    .map(
      ([theme, names]) => `
      <div class="loc-group">
        <button class="loc-theme">${escapeHtml(theme)} <span>(${names.length})</span></button>
        <ul>${names.map((n) => `<li class="loc-item">${escapeHtml(n)}</li>`).join("")}</ul>
      </div>`
    )
    .join("");
  for (const btn of document.querySelectorAll(".loc-theme")) {
    btn.onclick = () => {
      const off = btn.classList.toggle("eliminated");
      for (const li of btn.parentElement.querySelectorAll(".loc-item"))
        li.classList.toggle("eliminated", off);
    };
  }
  for (const li of document.querySelectorAll(".loc-item")) {
    li.onclick = () => li.classList.toggle("eliminated");
  }
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

// --- Éditeur de lieux & rôles ------------------------------------------------

let editorData = null;
let editorPack = null;

$("btn-open-editor").onclick = openEditor;
$("btn-editor-back").onclick = () => show("screen-home");

async function openEditor() {
  setError("home-error", "");
  try {
    editorData = await api("/api/locations");
    editorPack = editorData.packs[0].key;
    renderEditor();
    show("screen-editor");
  } catch (e) {
    setError("home-error", e.message);
  }
}

async function editOp(payload) {
  setError("editor-error", "");
  try {
    editorData = await api("/api/locations", payload);
    renderEditor();
    return true;
  } catch (e) {
    setError("editor-error", e.message);
    return false;
  }
}

function renderEditor() {
  $("pack-tabs").innerHTML = editorData.packs
    .map((p) => `<button class="pack-tab${p.key === editorPack ? " active" : ""}" data-pack="${escapeHtml(p.key)}">${escapeHtml(p.label)} <span>(${p.locations.length})</span></button>`)
    .join("");
  $("new-loc-theme").innerHTML = editorData.themes
    .map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`)
    .join("");
  const pack = editorData.packs.find((p) => p.key === editorPack);
  $("editor-list").innerHTML = pack.locations
    .map(
      (l) => `
      <div class="ed-loc">
        <div class="ed-loc-head">
          <div class="ed-loc-id">
            <span class="ed-loc-name">${escapeHtml(l.name)}</span>
            <span class="ed-loc-theme">${escapeHtml(l.theme)}</span>
          </div>
          <button class="ed-del-loc" data-name="${escapeHtml(l.name)}" title="Supprimer ce lieu">🗑️</button>
        </div>
        <div class="ed-roles">
          ${l.roles
            .map((r) => `<span class="ed-role">${escapeHtml(r)}<button class="ed-del-role" data-loc="${escapeHtml(l.name)}" data-role="${escapeHtml(r)}" title="Retirer ce rôle">×</button></span>`)
            .join("")}
        </div>
        <div class="ed-addrole">
          <input class="ed-role-input" maxlength="40" placeholder="Nouveau rôle…" />
          <button class="ed-add-role" data-loc="${escapeHtml(l.name)}">+ Rôle</button>
        </div>
      </div>`
    )
    .join("");
}

$("pack-tabs").onclick = (e) => {
  const t = e.target.closest(".pack-tab");
  if (!t) return;
  editorPack = t.dataset.pack;
  renderEditor();
};

$("editor-list").onclick = (e) => {
  const delLoc = e.target.closest(".ed-del-loc");
  if (delLoc) {
    if (confirm(`Supprimer le lieu « ${delLoc.dataset.name} » ?`))
      editOp({ op: "deleteLocation", pack: editorPack, name: delLoc.dataset.name });
    return;
  }
  const delRole = e.target.closest(".ed-del-role");
  if (delRole) {
    editOp({ op: "deleteRole", pack: editorPack, name: delRole.dataset.loc, role: delRole.dataset.role });
    return;
  }
  const addRole = e.target.closest(".ed-add-role");
  if (addRole) {
    const input = addRole.closest(".ed-loc").querySelector(".ed-role-input");
    if (input.value.trim()) editOp({ op: "addRole", pack: editorPack, name: addRole.dataset.loc, role: input.value });
  }
};

$("editor-list").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.classList.contains("ed-role-input")) {
    const btn = e.target.closest(".ed-loc").querySelector(".ed-add-role");
    if (e.target.value.trim()) editOp({ op: "addRole", pack: editorPack, name: btn.dataset.loc, role: e.target.value });
  }
});

$("btn-add-loc").onclick = async () => {
  const name = $("new-loc-name").value;
  if (!name.trim()) {
    setError("editor-error", "Donnez un nom au lieu.");
    return;
  }
  const ok = await editOp({
    op: "addLocation",
    pack: editorPack,
    name,
    theme: $("new-loc-theme").value,
    roles: $("new-loc-role").value.trim() ? [$("new-loc-role").value] : [],
  });
  if (ok) {
    $("new-loc-name").value = "";
    $("new-loc-role").value = "";
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

// --- Portail (un seul champ mot de passe) ------------------------------------

function lockGate(msg) {
  stopPolling();
  localStorage.removeItem("spyfall-pass");
  show("screen-gate");
  setError("gate-error", msg || "");
}

function enterApp() {
  loadDecks();
  if (session) startPolling();
  else show("screen-home");
}

async function tryPassword(pass) {
  const res = await fetch("/api/access", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: pass }),
  });
  return res.ok;
}

$("btn-gate").onclick = async () => {
  setError("gate-error", "");
  const pass = $("gate-pass").value;
  try {
    if (!(await tryPassword(pass))) throw new Error("Mot de passe incorrect.");
    localStorage.setItem("spyfall-pass", pass);
    enterApp();
  } catch (e) {
    setError("gate-error", e.message);
  }
};
$("gate-pass").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("btn-gate").click();
});

// Démarrage : portail si nécessaire, sinon reprise de session / accueil.
(async function boot() {
  let gate = false;
  try {
    gate = (await (await fetch("/api/config")).json()).gate;
  } catch {
    /* si /api/config échoue, on tente l'accès libre */
  }
  if (!gate) return enterApp();
  const stored = localStorage.getItem("spyfall-pass");
  if (stored && (await tryPassword(stored).catch(() => false))) return enterApp();
  localStorage.removeItem("spyfall-pass");
  show("screen-gate");
})();
