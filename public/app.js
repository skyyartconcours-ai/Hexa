// Client Hexa (Spyfall FR) — vanilla JS, synchronisation par sondage toutes les 2 s.
const $ = (id) => document.getElementById(id);

let session = JSON.parse(localStorage.getItem("spyfall-session") || "null");
let pollTimer = null;
let countdownTimer = null;
let lastStatus = null;
let timerBase = null;        // { remaining, at } pour un chrono sans dérive d'horloge
let vibratedTimeUp = false;
let wakeLock = null;
let qrRenderedCode = null;
let lastCardKey = null;
let editorData = null;
let editorPack = null;
let editorBusy = false;
let editorSuggestions = {};     // suggestions de rôles par lieu (rouge à retirer / vert à ajouter)
let settingsInitForCode = null; // pour ne pas écraser les réglages de l'hôte au polling
let lastVoteKey = null;         // évite de reconstruire le panneau de vote inutilement
let lastRevealShown = null;     // pour ne déclencher l'animation de victoire qu'une fois
let eliminatedLocs = new Set(); // lieux rayés par le joueur — PARTAGÉS entre la liste d'élimination et le panneau espion
let lastGameState = null;       // dernier state de manche (pour re-rendre le panneau espion quand les éliminations changent)
let confettiRAF = null;
let lobbyKnownNames = null;     // détection des arrivées dans le salon (#4)
let iWasSpyThisRound = false;   // pour les stats du Casier (#6)
let playedThisRound = false;    // n'enregistre une manche que si on l'a vraiment jouée (anti-fantôme)
let seatsAtRoundStart = 0;      // pour proposer 'inviter' si un siège se libère (#1)
let tutoStep = 0;

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

let currentScreen = null;
function show(screenId) {
  const changed = screenId !== currentScreen;
  for (const s of document.querySelectorAll(".screen")) s.classList.add("hidden");
  const el = $(screenId);
  el.classList.remove("hidden");
  currentScreen = screenId;
  // Ne déplace le focus QU'au changement d'écran (sinon le sondage toutes les
  // 2 s volerait le focus de la saisie de l'hôte et de la nav clavier).
  if (changed) {
    const focusable = el.querySelector("h1, [tabindex], button:not(.hidden), input");
    if (focusable) try { focusable.focus({ preventScroll: false }); } catch {}
  }
}

function setError(id, msg) { $(id).textContent = msg || ""; }

function netBanner(on) { $("net-banner").classList.toggle("hidden", !on); }

// Désactive un bouton pendant une action réseau (anti double-tap).
async function withBusy(btn, fn) {
  if (btn.disabled) return;
  btn.disabled = true;
  try { return await fn(); } finally { btn.disabled = false; }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// --- Accueil -----------------------------------------------------------------

$("btn-create").onclick = () => withBusy($("btn-create"), async () => {
  setError("home-error", "");
  try {
    const { code, playerId } = await api("/api/rooms", {
      name: $("name-input").value,
      deck: $("mode-select").value,
    });
    saveSession({ code, playerId });
    startPolling();
  } catch (e) { setError("home-error", e.message); }
});

$("btn-join").onclick = () => withBusy($("btn-join"), async () => {
  setError("home-error", "");
  const code = $("code-input").value.trim().toUpperCase();
  try {
    const { playerId } = await api(`/api/rooms/${code}/join`, { name: $("name-input").value });
    saveSession({ code, playerId });
    startPolling();
  } catch (e) { setError("home-error", e.message); }
});

async function loadDecks() {
  try {
    const { decks } = await api("/api/decks");
    $("mode-select").innerHTML = Object.entries(decks)
      .map(([k, d]) => `<option value="${k}">${escapeHtml(d.label)} (${d.count} lieux)</option>`)
      .join("");
  } catch {}
}

// --- Synchronisation ---------------------------------------------------------

function startPolling() { stopPolling(); poll(); pollTimer = setInterval(poll, 2000); }
function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

async function poll() {
  if (!session) return;
  try {
    const state = await api(`/api/rooms/${session.code}/state?playerId=${session.playerId}`);
    netBanner(false);
    render(state);
  } catch (e) {
    if (e.status === 401 || e.status === 429) {
      stopPolling();
      lockGate(e.status === 429 ? "Trop de tentatives — patientez quelques minutes puis ré-entrez le mot de passe." : "Ré-entrez le mot de passe.");
      return;
    }
    if (e.status) {
      // Salle expirée ou joueur inconnu : retour à l'accueil.
      stopPolling();
      saveSession(null);
      releaseWake();
      show("screen-home");
      setError("home-error", e.message);
      return;
    }
    // Erreur réseau transitoire : on garde la session et on réessaiera.
    netBanner(true);
    // Si aucun écran n'est visible (reprise dont le 1er sondage a échoué), éviter l'écran blanc.
    if (!document.querySelector(".screen:not(.hidden)")) show("screen-home");
  }
}

function render(state) {
  if (state.status !== "lobby") lobbyKnownNames = null; // réinitialise la détection d'arrivées
  if (state.status === "lobby") renderLobby(state);
  else if (state.status === "playing") renderGame(state);
  else if (state.status === "reveal") renderReveal(state);
  lastStatus = state.status;
}

// Petit toast éphémère (arrivées, copie de lien…).
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), 2200);
}

// Invitation par partage natif (Web Share), repli copie du lien.
async function shareInvite() {
  if (!session) return;
  const url = location.origin + "/?code=" + session.code;
  const text = `Rejoins ma partie d'Hexa 🕵️ — salle ${session.code}\n${url}`;
  if (navigator.share) { try { await navigator.share({ title: "Hexa — partie en cours", text, url }); return; } catch {} }
  try { await navigator.clipboard.writeText(url); toast("Lien copié — colle-le dans ton groupe !"); return; } catch {}
  toast(url); // contexte non sécurisé (LAN http) : on affiche le lien à recopier
}

// --- Salon -------------------------------------------------------------------

function renderLobby(state) {
  releaseWake();
  stopCountdown();
  show("screen-lobby");
  $("lobby-code").textContent = state.code;

  // QR + partage (une fois par code).
  if (qrRenderedCode !== state.code) {
    qrRenderedCode = state.code;
    const url = location.origin + "/?code=" + state.code;
    try { $("qr-box").innerHTML = window.QR ? window.QR.svg(url, { px: 168 }) : ""; }
    catch { $("qr-box").innerHTML = ""; }
    $("btn-share").classList.toggle("hidden", !navigator.share);
  }

  // Détection des arrivées (lobby vivant #4).
  const names = state.players.map((p) => p.name);
  const isNew = (n) => lobbyKnownNames && !lobbyKnownNames.has(n);
  if (lobbyKnownNames) {
    const arrivals = names.filter((n) => !lobbyKnownNames.has(n) && n !== state.you.name);
    if (arrivals.length) toast(arrivals.length === 1 ? `${arrivals[0]} a rejoint 👋` : `${arrivals.join(", ")} ont rejoint 👋`);
  }
  $("lobby-players").innerHTML = state.players
    .map((p) => `<li class="${isNew(p.name) ? "just-joined" : ""}"><span class="pdot pdot-${p.presence || "actif"}" title="${p.presence || ""}"></span>${escapeHtml(p.name)}${p.isHost ? " 👑" : ""}${p.name === state.you.name ? " <span class=\"you-tag\">(vous)</span>" : ""}</li>`)
    .join("");
  lobbyKnownNames = new Set(names);

  // Mur d'invitation incitatif (#2) + barre de remplissage + compteur de parties.
  const n = state.players.length;
  const wall = $("invite-wall");
  if (n < 3) {
    wall.classList.remove("hidden");
    $("invite-count").textContent = `Il manque ${3 - n} joueur${3 - n > 1 ? "s" : ""} pour lancer — invite tes potes !`;
  } else wall.classList.add("hidden");
  const fb = $("fill-bar-inner");
  fb.style.width = Math.min(100, (n / 3) * 100) + "%";
  fb.classList.toggle("ready", n >= 3);
  const ag = $("active-games");
  if (state.activeGames >= 3) { ag.classList.remove("hidden"); ag.textContent = `🎲 ${state.activeGames} parties en cours`; }
  else ag.classList.add("hidden");

  const isHost = state.you.isHost;
  $("host-controls").classList.toggle("hidden", !isHost);
  $("lobby-hint").textContent = isHost
    ? (state.players.length < 3 ? `Il manque ${3 - state.players.length} joueur(s) pour lancer (minimum 3).` : "Prêt à lancer !")
    : "En attente que l'hôte lance la manche… (3 joueurs minimum)";

  if (isHost) {
    // Reconstruit la liste des modes (counts à jour) en PRÉSERVANT le choix de l'hôte.
    // Les réglages ne sont (ré)initialisés qu'à la première entrée dans CETTE salle,
    // ensuite le polling ne les écrase plus (sinon presets/sélections seraient annulés).
    const deckSel = $("deck-select");
    const init = settingsInitForCode !== state.code;
    if (document.activeElement !== deckSel) { // ne pas reconstruire si l'hôte a le menu ouvert
      const keepDeck = init ? state.deck : (deckSel.value || state.deck);
      deckSel.innerHTML = Object.entries(state.decks)
        .map(([k, d]) => `<option value="${k}">${escapeHtml(d.label)} (${d.count} lieux)</option>`).join("");
      deckSel.value = keepDeck;
    }
    if (init) {
      $("spy-select").value = state.spyMode;
      $("duration-input").value = state.durationMin;
      settingsInitForCode = state.code;
    }
    const btn = $("btn-start");
    btn.disabled = state.players.length < 3;
    btn.textContent = state.players.length < 3 ? `Lancer (${state.players.length}/3 joueurs)` : "Lancer la manche";
  }

  renderScoreboard("lobby-scoreboard", state.scores, state.history);
}

function renderScoreboard(id, scores, history) {
  const box = $(id);
  if (!scores || !scores.length || scores.every((s) => s.score === 0)) { box.innerHTML = ""; return; }
  let html = `<h2 class="sb-title">🏆 Classement</h2><ol class="sb-list">` +
    scores.map((s) => `<li><span><span class="pdot pdot-${s.presence || "actif"}"></span>${escapeHtml(s.name)}${s.isHost ? " 👑" : ""}${s.you ? " (vous)" : ""}</span><strong>${s.score}</strong></li>`).join("") +
    `</ol>`;
  box.innerHTML = html;
}

// --- Manche en cours ---------------------------------------------------------

function renderGame(state) {
  show("screen-game");
  requestWake();
  lastGameState = state; // mémorisé pour re-rendre le panneau espion quand les éliminations changent

  const cardKey = state.card ? JSON.stringify(state.card) : "";
  if (lastStatus !== "playing" || cardKey !== lastCardKey) {
    // Nouvelle manche : carte de nouveau face cachée, ratures effacées.
    lastCardKey = cardKey;
    vibratedTimeUp = false;
    iWasSpyThisRound = !!state.youAreSpy;
    playedThisRound = true;
    seatsAtRoundStart = state.players.length;
    eliminatedLocs = new Set(); // les lieux rayés sont propres à chaque manche
    $("btn-flip").classList.remove("hidden");
    $("card-content").classList.add("hidden");
    renderCard(state);
    renderLocations(state.locations);
    renderSpyPanel(state);
    renderAccuseList(state);
    if (!countdownTimer) startCountdown();
  }

  timerBase = { remaining: state.remainingMs, at: Date.now() };
  // Nom du premier joueur : rafraîchi à CHAQUE sondage (reflète un re-tirage
  // serveur si le 1er joueur quitte en cours de manche), mais seulement tant
  // qu'il reste du temps — sinon tickTimer affiche « Temps écoulé » et on ne
  // l'écrase pas (évite tout flicker et l'info premier-joueur périmée).
  if (state.remainingMs > 0) {
    $("first-player").textContent = state.firstPlayer ? `🎙️ ${state.firstPlayer} commence et choisit qui interroger.` : "";
  }

  $("btn-end").classList.toggle("hidden", !state.you.isHost);

  renderVotePanel(state);
}

function renderCard(state) {
  const card = state.card;
  if (!card) return; // sécurité : jamais de crash si la carte manque
  if (card.spy) {
    const extra = state.spyCount > 1 ? `<p>Vous n'êtes pas seul : il y a <strong>${state.spyCount} espions</strong> (vous ne savez pas qui est l'autre). ⚠️ Si vous tentez le lieu et vous trompez, les deux espions perdent.</p>` : "";
    $("card-content").innerHTML =
      `<p class="card-title spy">🤫 Vous êtes l'ESPION</p>
       <p>Vous ne connaissez pas le lieu. Écoutez, bluffez, et essayez de le deviner !</p>${extra}`;
  } else {
    const roles = (state.locationRoles || []).map((r) => `<li>${escapeHtml(r)}</li>`).join("");
    $("card-content").innerHTML =
      `<p class="card-label">Lieu</p>
       <p class="card-title">${escapeHtml(card.location)}</p>
       <p class="card-label">Votre rôle</p>
       <p class="card-role">${escapeHtml(card.role)}</p>
       ${roles ? `<details class="role-help"><summary>Rôles possibles ici</summary><ul>${roles}</ul></details>` : ""}`;
  }
}

// Quand les lieux rayés changent, on re-rend le panneau espion pour qu'il reflète
// la MÊME liste filtrée (candidats en haut, rayés barrés en bas).
function syncSpyPanel() {
  if (lastGameState && lastGameState.youAreSpy) renderSpyPanel(lastGameState);
}
// Raye / dé-raye un lieu dans l'état PARTAGÉ + met à jour son item visuel.
function setLocEliminated(name, li, off) {
  if (off) eliminatedLocs.add(name); else eliminatedLocs.delete(name);
  li.classList.toggle("eliminated", off);
  li.setAttribute("aria-pressed", String(off));
}

function renderLocations(locations) {
  const byTheme = new Map();
  for (const l of locations) {
    if (!byTheme.has(l.theme)) byTheme.set(l.theme, []);
    byTheme.get(l.theme).push(l.name);
  }
  $("locations-list").innerHTML = [...byTheme.entries()]
    .map(([theme, names]) => `
      <div class="loc-group">
        <button class="loc-theme">${escapeHtml(theme)} <span>(${names.length})</span></button>
        <ul>${names.map((n) => `<li class="loc-item${eliminatedLocs.has(n) ? " eliminated" : ""}" role="button" tabindex="0" aria-pressed="${eliminatedLocs.has(n)}" data-loc="${escapeHtml(n)}">${escapeHtml(n)}</li>`).join("")}</ul>
      </div>`)
    .join("");
  for (const btn of document.querySelectorAll(".loc-theme")) {
    btn.onclick = () => {
      const items = [...btn.parentElement.querySelectorAll(".loc-item")];
      const off = items.some((li) => !eliminatedLocs.has(li.dataset.loc)); // au moins un encore possible -> tout rayer ; sinon tout rétablir
      btn.classList.toggle("eliminated", off);
      for (const li of items) setLocEliminated(li.dataset.loc, li, off);
      syncSpyPanel(); // une seule synchro après le lot
    };
  }
  for (const li of document.querySelectorAll(".loc-item")) {
    const toggle = () => { setLocEliminated(li.dataset.loc, li, !eliminatedLocs.has(li.dataset.loc)); syncSpyPanel(); };
    li.onclick = toggle;
    li.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } };
  }
}

function renderSpyPanel(state) {
  const panel = $("spy-panel");
  panel.classList.toggle("hidden", !state.youAreSpy);
  if (!state.youAreSpy) return;
  const names = state.locations.map((l) => l.name);
  const candidats = names.filter((n) => !eliminatedLocs.has(n));
  const rayes = names.filter((n) => eliminatedLocs.has(n));
  // Astuce : l'espion raye les lieux impossibles dans la liste ci-dessous ; ici
  // ils passent en bas (barrés) et il devine parmi ceux qui restent.
  const hint = rayes.length
    ? `<p class="spy-hint">🎯 ${candidats.length} lieu${candidats.length > 1 ? "x" : ""} encore possible${candidats.length > 1 ? "s" : ""} — les lieux rayés sont en bas.</p>`
    : `<p class="spy-hint">🎯 Rayez les lieux impossibles dans « Éliminer les lieux » : ils passeront en bas ici.</p>`;
  const mk = (n) => `<button class="pick-btn${eliminatedLocs.has(n) ? " eliminated" : ""}" data-loc="${escapeHtml(n)}">${escapeHtml(n)}</button>`;
  $("spy-guess-list").innerHTML = hint + candidats.concat(rayes).map(mk).join("");
  for (const b of $("spy-guess-list").querySelectorAll(".pick-btn")) {
    b.onclick = () => withBusy(b, async () => {
      setError("game-error", "");
      try { render(await api(`/api/rooms/${session.code}/guess`, { playerId: session.playerId, location: b.dataset.loc })); }
      catch (e) { setError("game-error", e.message); }
    });
  }
}

function renderAccuseList(state) {
  $("accuse-list").innerHTML = state.players
    .filter((p) => p.name !== state.you.name)
    .map((p) => `<button class="pick-btn" data-name="${escapeHtml(p.name)}">${escapeHtml(p.name)}</button>`).join("");
  for (const b of $("accuse-list").querySelectorAll(".pick-btn")) {
    b.onclick = () => withBusy(b, async () => {
      setError("game-error", "");
      try { render(await api(`/api/rooms/${session.code}/accuse`, { playerId: session.playerId, suspect: b.dataset.name })); $("accuse-panel").open = false; }
      catch (e) { setError("game-error", e.message); }
    });
  }
}

function renderVotePanel(state) {
  const vp = $("vote-panel");
  const acc = state.accusation;
  // Pendant un vote, on masque les actions individuelles.
  $("spy-panel").style.display = acc ? "none" : "";
  $("accuse-panel").style.display = acc ? "none" : "";
  if (!acc) { vp.classList.add("hidden"); vp.innerHTML = ""; lastVoteKey = null; return; }
  vp.classList.remove("hidden");
  // Ne reconstruit le panneau que si son état a changé (évite le flicker et de
  // recréer un bouton « actif » pendant qu'une requête de vote est en vol).
  const key = `${acc.id}|${acc.youAreSuspect}|${acc.canVote}|${acc.votedCount}/${acc.votersCount}`;
  if (key === lastVoteKey) return;
  lastVoteKey = key;
  if (acc.youAreSuspect) {
    vp.innerHTML = `<p class="vote-q">😱 <strong>${escapeHtml(acc.accuser)}</strong> vous accuse d'être l'espion !</p>
      <p class="hint">Vote en cours… (${acc.votedCount}/${acc.votersCount})</p>`;
  } else if (acc.canVote) {
    vp.innerHTML = `<p class="vote-q"><strong>${escapeHtml(acc.accuser)}</strong> accuse <strong>${escapeHtml(acc.suspect)}</strong>. Coupable ?</p>
      <div class="vote-btns"><button id="vote-yes" class="primary">Oui, c'est l'espion</button><button id="vote-no" class="danger">Non</button></div>`;
    $("vote-yes").onclick = () => sendVote(true);
    $("vote-no").onclick = () => sendVote(false);
  } else {
    vp.innerHTML = `<p class="vote-q"><strong>${escapeHtml(acc.accuser)}</strong> accuse <strong>${escapeHtml(acc.suspect)}</strong>.</p>
      <p class="hint">Vote en cours… (${acc.votedCount}/${acc.votersCount})</p>`;
  }
}

function sendVote(agree) {
  const b = agree ? $("vote-yes") : $("vote-no");
  return withBusy(b, async () => {
    setError("game-error", "");
    try { render(await api(`/api/rooms/${session.code}/vote`, { playerId: session.playerId, agree })); }
    catch (e) { setError("game-error", e.message); }
  });
}

$("btn-flip").onclick = () => { $("btn-flip").classList.add("hidden"); $("card-content").classList.remove("hidden"); };

$("btn-end").onclick = () => withBusy($("btn-end"), async () => {
  setError("game-error", "");
  try { render(await api(`/api/rooms/${session.code}/end`, { playerId: session.playerId })); }
  catch (e) { setError("game-error", e.message); }
});

// --- Révélation --------------------------------------------------------------

function renderReveal(state) {
  releaseWake();
  stopCountdown();
  show("screen-reveal");
  const r = state.reveal;
  const info = r.info || {};
  const verdicts = {
    spy_guessed_right: `🎯 L'espion ${escapeHtml(info.by || "")} a deviné le lieu (${escapeHtml(info.guess || "")}) — les espions gagnent !`,
    spy_guessed_wrong: `❌ L'espion ${escapeHtml(info.by || "")} a tenté « ${escapeHtml(info.guess || "")} » — raté ! Les innocents gagnent.`,
    spy_caught: `🕵️ ${escapeHtml(info.suspect || "")} était bien un espion — démasqué ! Les innocents gagnent.`,
    wrong_accusation: `🙅 ${escapeHtml(info.suspect || "")} était innocent — accusation ratée ! Les espions gagnent.`,
    timeout: `⏰ Temps écoulé — l'espion a survécu ! Les espions gagnent.`,
  };
  const vp = $("reveal-verdict");
  vp.innerHTML = verdicts[r.outcome] || "";
  vp.className = "reveal-verdict " + (r.winners === "spy" ? "win-spy" : "win-innocents");
  $("reveal-location").textContent = r.location;
  $("reveal-spy").textContent = r.spies.join(", ") || "(parti)";
  renderScoreboard("reveal-scoreboard", state.scores, state.history);
  $("reveal-series").textContent = state.roundNo > 0 ? `🔥 ${state.roundNo} manche${state.roundNo > 1 ? "s" : ""} jouée${state.roundNo > 1 ? "s" : ""} ce soir !` : "";
  $("btn-revanche").classList.toggle("hidden", !state.you.isHost);
  $("btn-again").classList.toggle("hidden", !state.you.isHost);
  const seatFreed = seatsAtRoundStart && state.players.length < seatsAtRoundStart;
  $("btn-invite-reveal").classList.toggle("hidden", !seatFreed);

  // Mise en scène jouée UNE seule fois par manche (pas à chaque sondage).
  const key = `${state.roundNo}|${r.outcome}`;
  if (key !== lastRevealShown) {
    lastRevealShown = key;
    if (playedThisRound) recordRound(r, iWasSpyThisRound); // stats Casier seulement si la manche a été jouée
    playedThisRound = false;
    const sec = $("screen-reveal");
    sec.classList.remove("reveal-anim");
    void sec.offsetWidth; // relance les animations CSS
    sec.classList.add("reveal-anim");
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (r.winners === "innocents") { if (!reduce) launchConfetti(); try { navigator.vibrate && navigator.vibrate([40, 40, 90]); } catch {} }
    else { if (!reduce) flashDefeat(); try { navigator.vibrate && navigator.vibrate(220); } catch {} }
  }
}

// Confettis dorés (canvas maison, zéro dépendance) pour une victoire des innocents.
function launchConfetti() {
  const cv = $("confetti");
  const ctx = cv.getContext("2d");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = window.innerWidth * dpr;
  cv.height = window.innerHeight * dpr;
  cv.style.opacity = "1";
  const colors = ["#e6c87a", "#f1d99a", "#9a7a2e", "#f3ead6", "#c9a24a"];
  const parts = Array.from({ length: 150 }, () => ({
    x: Math.random() * cv.width, y: -Math.random() * cv.height * 0.4,
    r: (4 + Math.random() * 6) * dpr, c: colors[Math.floor(Math.random() * colors.length)],
    vx: (Math.random() - 0.5) * 2.2 * dpr, vy: (2 + Math.random() * 4) * dpr,
    rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.32,
  }));
  let start = null;
  if (confettiRAF) cancelAnimationFrame(confettiRAF);
  const frame = (ts) => {
    if (start === null) start = ts;
    const elapsed = ts - start;
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.03 * dpr; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, 1 - elapsed / 3600);
      ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.6); ctx.restore();
    }
    if (elapsed < 3600) confettiRAF = requestAnimationFrame(frame);
    else { ctx.clearRect(0, 0, cv.width, cv.height); cv.style.opacity = "0"; confettiRAF = null; }
  };
  confettiRAF = requestAnimationFrame(frame);
}
// Pulsation rouge pour une victoire des espions.
function flashDefeat() {
  document.body.classList.remove("defeat-flash");
  void document.body.offsetWidth;
  document.body.classList.add("defeat-flash");
}

$("btn-again").onclick = () => withBusy($("btn-again"), async () => {
  setError("reveal-error", "");
  try { render(await api(`/api/rooms/${session.code}/lobby`, { playerId: session.playerId })); }
  catch (e) { setError("reveal-error", e.message); }
});

$("btn-reset-scores").onclick = () => withBusy($("btn-reset-scores"), async () => {
  setError("lobby-error", "");
  try { render(await api(`/api/rooms/${session.code}/scores`, { playerId: session.playerId })); }
  catch (e) { setError("lobby-error", e.message); }
});

// --- Lancement de manche & réglages hôte -------------------------------------

$("btn-start").onclick = () => withBusy($("btn-start"), async () => {
  setError("lobby-error", "");
  try {
    render(await api(`/api/rooms/${session.code}/start`, {
      playerId: session.playerId,
      durationMin: Number($("duration-input").value),
      deck: $("deck-select").value,
      spyMode: $("spy-select").value,
    }));
  } catch (e) { setError("lobby-error", e.message); }
});

for (const b of $("duration-presets").querySelectorAll("button")) {
  b.onclick = () => { $("duration-input").value = b.dataset.min; };
}

// --- Copier / partager / quitter ---------------------------------------------

$("btn-copy").onclick = async () => {
  try { await navigator.clipboard.writeText(session.code); }
  catch {}
  const old = $("btn-copy").textContent;
  $("btn-copy").textContent = "✅";
  setTimeout(() => { $("btn-copy").textContent = old; }, 1200);
};
$("btn-share").onclick = async () => {
  try { await navigator.share({ title: "Hexa", text: `Rejoins ma partie d'Hexa 🕵️ (code ${session.code})`, url: location.origin + "/?code=" + session.code }); }
  catch {}
};

function doLeave() {
  if (session) { try { api(`/api/rooms/${session.code}/leave`, { playerId: session.playerId }); } catch {} }
  stopPolling(); releaseWake(); stopCountdown();
  saveSession(null);
  lastStatus = null; lastCardKey = null; qrRenderedCode = null; settingsInitForCode = null; lastVoteKey = null; lastRevealShown = null;
  show("screen-home");
  loadDecks();
}
for (const id of ["btn-leave-lobby", "btn-leave-game", "btn-leave-reveal"]) {
  $(id).onclick = () => { if (confirm("Quitter la partie ?")) doLeave(); };
}
// Grâce de reconnexion : verrouiller/masquer l'onglet ne fait PAS quitter la
// partie. Le serveur garde le joueur (avec sa carte/rôle) pendant 90 s ; on
// retire seulement les joueurs réellement absents au-delà de ce délai. Seul le
// bouton « Quitter » provoque un départ immédiat.

// --- Chrono (basé sur le temps restant serveur, sans dérive d'horloge) --------

function startCountdown() { stopCountdown(); tickTimer(); countdownTimer = setInterval(tickTimer, 500); }
function stopCountdown() { if (countdownTimer) clearInterval(countdownTimer); countdownTimer = null; }
function tickTimer() {
  if (!timerBase) return;
  const remaining = Math.max(0, timerBase.remaining - (Date.now() - timerBase.at));
  const m = Math.floor(remaining / 60000);
  const s = Math.floor((remaining % 60000) / 1000);
  const t = $("timer");
  if (remaining <= 0) {
    t.textContent = "0:00";
    t.classList.add("urgent");
    $("first-player").textContent = "⏰ Temps écoulé — en attente de l'hôte…";
    if (!vibratedTimeUp) { vibratedTimeUp = true; try { navigator.vibrate && navigator.vibrate(200); } catch {} }
  } else {
    t.textContent = `${m}:${String(s).padStart(2, "0")}`;
    t.classList.toggle("urgent", remaining < 60000);
  }
}

// --- Wake Lock (garde l'écran allumé pendant la manche) ----------------------

async function requestWake() {
  try { if ("wakeLock" in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; }); } } catch {}
}
function releaseWake() { try { if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch {} }
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (session && currentScreen !== "screen-gate") { if (!pollTimer) startPolling(); else poll(); } // reconnexion immédiate (pas depuis le portail)
  if (lastStatus === "playing") requestWake();
});

// --- Éditeur de lieux & rôles ------------------------------------------------

$("btn-open-editor").onclick = openEditor;
$("btn-editor-back").onclick = () => { loadDecks(); show("screen-home"); };

async function openEditor() {
  setError("home-error", "");
  try {
    editorData = await api("/api/locations");
    try { editorSuggestions = (await api("/api/suggestions")).suggestions || {}; } catch { editorSuggestions = {}; }
    editorPack = editorData.packs[0].key;
    renderEditor();
    show("screen-editor");
  } catch (e) { setError("home-error", e.message); }
}

async function editOp(payload) {
  if (editorBusy) return false;
  editorBusy = true;
  setError("editor-error", "");
  try { editorData = await api("/api/locations", payload); renderEditor(); return true; }
  catch (e) { setError("editor-error", e.message); return false; }
  finally { editorBusy = false; }
}

// Ajoute plusieurs rôles (séparés par des virgules) à un lieu.
async function addRoles(loc, raw) {
  const roles = String(raw).split(",").map((r) => r.trim()).filter(Boolean);
  for (const role of roles) { if (!(await editOp({ op: "addRole", pack: editorPack, name: loc, role }))) break; }
}

function renderEditor() {
  // Sauve les saisies de rôles en cours pour ne pas les perdre au re-rendu.
  const saved = {};
  document.querySelectorAll(".ed-role-input").forEach((i) => { if (i.value) saved[i.dataset.loc] = i.value; });
  const activeLoc = document.activeElement && document.activeElement.classList && document.activeElement.classList.contains("ed-role-input")
    ? document.activeElement.dataset.loc : null;

  $("pack-tabs").innerHTML = editorData.packs
    .map((p) => `<button class="pack-tab${p.key === editorPack ? " active" : ""}" data-pack="${escapeHtml(p.key)}">${escapeHtml(p.label)} <span>(${p.locations.length})</span></button>`)
    .join("");
  $("theme-list").innerHTML = editorData.themes.map((t) => `<option value="${escapeHtml(t)}"></option>`).join("");

  const pack = editorData.packs.find((p) => p.key === editorPack);
  $("editor-list").innerHTML = pack.locations
    .map((l) => {
      // Bloc de suggestions des agents (seulement pour le pack corsé Délire 2).
      let sugHtml = "";
      const sug = editorPack === "delire2" ? editorSuggestions[l.name] : null;
      if (sug) {
        const has = (x) => l.roles.some((r) => r.toLowerCase() === String(x).toLowerCase());
        const removable = (sug.remove || []).filter((r) => has(r));
        const addable = (sug.add || []).filter((a) => !has(a));
        if (removable.length || addable.length) {
          sugHtml =
            `<div class="ed-sugg"><p class="ed-sugg-title">💡 Suggestions des agents</p>` +
            removable.map((r) => `<div class="sugg-row sugg-remove"><span>🔴 ${escapeHtml(r)}</span><button class="sugg-del" data-loc="${escapeHtml(l.name)}" data-role="${escapeHtml(r)}">Retirer</button></div>`).join("") +
            addable.map((a) => `<div class="sugg-row sugg-add"><span>🟢 ${escapeHtml(a)}</span><button class="sugg-add-btn" data-loc="${escapeHtml(l.name)}" data-role="${escapeHtml(a)}">Ajouter</button></div>`).join("") +
            `</div>`;
        }
      }
      return `
      <div class="ed-loc">
        <div class="ed-loc-head">
          <div class="ed-loc-id">
            <span class="ed-loc-name">${escapeHtml(l.name)}</span>
            <span class="ed-loc-theme">${escapeHtml(l.theme)}</span>
          </div>
          <button class="ed-del-loc" data-name="${escapeHtml(l.name)}" title="Supprimer ce lieu" aria-label="Supprimer le lieu ${escapeHtml(l.name)}">🗑️</button>
        </div>
        <div class="ed-roles">
          ${l.roles.map((r) => `<span class="ed-role">${escapeHtml(r)}<button class="ed-del-role" data-loc="${escapeHtml(l.name)}" data-role="${escapeHtml(r)}" title="Retirer ce rôle" aria-label="Retirer le rôle ${escapeHtml(r)}">×</button></span>`).join("")}
        </div>
        <div class="ed-addrole">
          <input class="ed-role-input" data-loc="${escapeHtml(l.name)}" maxlength="120" placeholder="Rôle(s), séparés par des virgules…" />
          <button class="ed-add-role" data-loc="${escapeHtml(l.name)}">+ Rôle</button>
        </div>
        ${sugHtml}
      </div>`;
    })
    .join("");

  // Restaure les saisies + le focus.
  document.querySelectorAll(".ed-role-input").forEach((i) => { if (saved[i.dataset.loc]) i.value = saved[i.dataset.loc]; });
  if (activeLoc) { const el = document.querySelector(`.ed-role-input[data-loc="${CSS.escape(activeLoc)}"]`); if (el) { el.focus(); const v = el.value; el.value = ""; el.value = v; } }
}

$("pack-tabs").onclick = (e) => {
  const t = e.target.closest(".pack-tab");
  if (!t) return;
  editorPack = t.dataset.pack;
  renderEditor();
};

$("editor-list").onclick = (e) => {
  const delLoc = e.target.closest(".ed-del-loc");
  if (delLoc) { if (confirm(`Supprimer le lieu « ${delLoc.dataset.name} » ?`)) editOp({ op: "deleteLocation", pack: editorPack, name: delLoc.dataset.name }); return; }
  const delRole = e.target.closest(".ed-del-role");
  if (delRole) { editOp({ op: "deleteRole", pack: editorPack, name: delRole.dataset.loc, role: delRole.dataset.role }); return; }
  const sugDel = e.target.closest(".sugg-del"); // suggestion rouge : retirer
  if (sugDel) { editOp({ op: "deleteRole", pack: editorPack, name: sugDel.dataset.loc, role: sugDel.dataset.role }); return; }
  const sugAdd = e.target.closest(".sugg-add-btn"); // suggestion verte : ajouter
  if (sugAdd) { editOp({ op: "addRole", pack: editorPack, name: sugAdd.dataset.loc, role: sugAdd.dataset.role }); return; }
  const addRole = e.target.closest(".ed-add-role");
  if (addRole) {
    const input = addRole.closest(".ed-loc").querySelector(".ed-role-input");
    const val = input.value.trim();
    if (val) { input.value = ""; addRoles(addRole.dataset.loc, val); } // vidé avant le re-rendu
  }
};
$("editor-list").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.classList.contains("ed-role-input")) {
    const val = e.target.value.trim();
    if (val) { e.target.value = ""; addRoles(e.target.dataset.loc, val); }
  }
});

$("btn-add-loc").onclick = () => withBusy($("btn-add-loc"), async () => {
  const name = $("new-loc-name").value;
  if (!name.trim()) { setError("editor-error", "Donnez un nom au lieu."); return; }
  const roles = $("new-loc-role").value.split(",").map((r) => r.trim()).filter(Boolean);
  const ok = await editOp({ op: "addLocation", pack: editorPack, name, theme: $("new-loc-theme").value, roles });
  if (ok) { $("new-loc-name").value = ""; $("new-loc-role").value = ""; $("new-loc-theme").value = ""; }
});

// --- Invitation / Revanche (#1, #2) ------------------------------------------

$("btn-invite").onclick = () => shareInvite();
$("btn-invite-reveal").onclick = () => shareInvite();
$("btn-revanche").onclick = () => withBusy($("btn-revanche"), async () => {
  setError("reveal-error", "");
  try { render(await api(`/api/rooms/${session.code}/start`, { playerId: session.playerId })); } // réutilise les réglages de la salle
  catch (e) { setError("reveal-error", e.message); }
});
// Mémorise le prénom pour le pré-remplir (onboarding fluide).
$("name-input").addEventListener("input", () => { try { localStorage.setItem("spyfall-name", $("name-input").value.trim().slice(0, 20)); } catch {} });

// --- Casier d'identité (#6, stats LOCALES, carte Canvas client) ---------------

function loadStats() { try { return JSON.parse(localStorage.getItem("spyfall-stats")) || {}; } catch { return {}; } }
function recordRound(reveal, wasSpy) {
  const s = loadStats();
  s.parties = (s.parties || 0) + 1;
  const won = reveal.winners === (wasSpy ? "spy" : "innocents");
  if (won) s.wins = (s.wins || 0) + 1;
  if (wasSpy) { s.asSpy = (s.asSpy || 0) + 1; if (won) s.spyWins = (s.spyWins || 0) + 1; }
  try { localStorage.setItem("spyfall-stats", JSON.stringify(s)); } catch {}
}
function casierTitle(s) {
  const p = s.parties || 0;
  if (!p) return "Recrue";
  const spyRate = s.asSpy ? (s.spyWins || 0) / s.asSpy : 0;
  const winRate = (s.wins || 0) / p;
  if (s.asSpy >= 5 && spyRate >= 0.6) return "Espion fantôme 👻";
  if (s.asSpy >= 5 && spyRate <= 0.2) return "Espion grillé 🔥";
  if (p >= 5 && winRate >= 0.6) return "Fin limier 🕵️";
  if (p >= 5 && winRate <= 0.3) return "Pigeon attitré 🐦";
  if (p >= 20) return "Vétéran d'Hexa";
  return "Apprenti espion";
}
function casierBadges(s) {
  const b = [];
  if ((s.parties || 0) >= 5) b.push("🎯 5 parties");
  if ((s.parties || 0) >= 20) b.push("🏅 20 parties");
  if ((s.spyWins || 0) >= 5) b.push("🕶️ 5 wins espion");
  if ((s.spyWins || 0) >= 10) b.push("👑 10 wins espion");
  if ((s.wins || 0) >= 10) b.push("🏆 10 victoires");
  return b.length ? b : ["— pas encore de badge —"];
}
function buildCasierCanvas() {
  const s = loadStats();
  const W = 1080, H = 1350;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const x = cv.getContext("2d");
  const g = x.createRadialGradient(W / 2, 0, 120, W / 2, H * 0.45, H);
  g.addColorStop(0, "#1a140c"); g.addColorStop(1, "#070605");
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.strokeStyle = "#9a7a2e"; x.lineWidth = 8; x.strokeRect(30, 30, W - 60, H - 60);
  x.textAlign = "center";
  x.fillStyle = "#e6c87a"; x.font = "bold 60px Georgia, serif"; x.fillText("🕵️ CASIER HEXA", W / 2, 150);
  const name = (localStorage.getItem("spyfall-name") || "Joueur").slice(0, 18);
  x.fillStyle = "#f3ead6"; x.font = "bold 86px Georgia, serif"; x.fillText(name, W / 2, 280);
  x.fillStyle = "#f1d99a"; x.font = "italic 54px Georgia, serif"; x.fillText(casierTitle(s), W / 2, 372);
  const lines = [
    ["Parties jouées", String(s.parties || 0)],
    ["Victoires", `${s.wins || 0} (${Math.round(((s.wins || 0) / (s.parties || 1)) * 100)}%)`],
    ["Manches en espion", String(s.asSpy || 0)],
    ["Bluffs réussis", s.asSpy ? `${s.spyWins || 0} (${Math.round(((s.spyWins || 0) / s.asSpy) * 100)}%)` : "—"],
  ];
  x.font = "44px Arial, sans-serif"; let yy = 530;
  for (const [k, v] of lines) {
    x.textAlign = "left"; x.fillStyle = "#9b9078"; x.fillText(k, 110, yy);
    x.textAlign = "right"; x.fillStyle = "#e6c87a"; x.fillText(v, W - 110, yy);
    yy += 92;
  }
  x.textAlign = "center"; x.fillStyle = "#f3ead6"; x.font = "38px Arial, sans-serif";
  let by = yy + 50; for (const bg of casierBadges(s)) { x.fillText(bg, W / 2, by); by += 64; }
  x.fillStyle = "#9a7a2e"; x.font = "34px Georgia, serif"; x.fillText("spy.skyyarttools.fr", W / 2, H - 70);
  return cv;
}
function openCasier() {
  const s = loadStats();
  const wrap = $("casier-wrap");
  wrap.innerHTML = "";
  if (!(s.parties > 0)) {
    $("casier-empty").classList.remove("hidden");
    $("btn-casier-share").classList.add("hidden");
  } else {
    $("casier-empty").classList.add("hidden");
    const cv = buildCasierCanvas();
    const img = document.createElement("img");
    img.src = cv.toDataURL("image/png"); img.className = "casier-img"; img.alt = "Mon Casier Hexa";
    wrap.appendChild(img);
    wrap._canvas = cv;
    $("btn-casier-share").classList.remove("hidden");
  }
  show("screen-casier");
}
async function shareCasier() {
  const cv = $("casier-wrap")._canvas;
  if (!cv) return;
  let blob = null;
  try { blob = await new Promise((r) => cv.toBlob(r, "image/png")); } catch {}
  if (blob && navigator.canShare) {
    const file = new File([blob], "casier-hexa.png", { type: "image/png" });
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], text: "Mon Casier Hexa 🕵️ — spy.skyyarttools.fr" }); } catch {} // annulé/échec : NE PAS télécharger
      return;
    }
  }
  // Partage de fichier non supporté : téléchargement de l'image.
  const a = document.createElement("a"); a.href = cv.toDataURL("image/png"); a.download = "casier-hexa.png"; a.click();
}
$("btn-casier").onclick = openCasier;
$("btn-casier-back").onclick = () => show("screen-home");
$("btn-casier-share").onclick = () => shareCasier();

// --- Tutoriel express (#8, scripté, sans fausse IA) --------------------------

const TUTO_STEPS = [
  `<h2>🕵️ Le but</h2><p>Tout le monde reçoit le <b>même lieu</b> et un rôle… sauf <b>l'espion</b>, qui ne connaît pas le lieu.</p><div class="tuto-demo"><span class="card-label">Lieu</span><span class="card-title">Plage</span><span class="card-label">Ton rôle</span><span class="card-role">Maître-nageur</span></div>`,
  `<h2>❓ On enquête</h2><p>Chacun son tour, on se pose des questions pour démasquer l'espion — sans être trop précis, sinon il devine le lieu.</p><div class="tuto-chat"><p><b>Léa :</b> « Tu mets de la crème solaire ? »</p><p><b>Max :</b> « …euh, parfois. »</p><p class="tuto-tip">👀 Max hésite : suspect !</p></div>`,
  `<h2>🙋 On accuse</h2><p>N'importe qui peut accuser un joueur. Si <b>tout le monde est d'accord</b>, on révèle son rôle.</p><div class="tuto-demo"><span class="vote-q">« Max est l'espion ? »</span><span class="card-role">3 / 3 votes ✔️</span></div>`,
  `<h2>🎯 L'espion peut tenter</h2><p>À tout moment, l'espion peut <b>deviner le lieu</b> pour gagner d'un coup. Risqué : s'il se trompe, il perd.</p>`,
  `<h2>🏆 La révélation</h2><div class="reveal-verdict win-innocents tuto-verdict">🕵️ Max était l'espion — démasqué ! Les innocents gagnent.</div><p>Score cumulé, classement, Revanche en 1 tap… <b>c'est 100× mieux entre amis 👇</b></p>`,
];
function renderTuto() {
  $("tuto-card").innerHTML = TUTO_STEPS[tutoStep];
  $("tuto-dots").innerHTML = TUTO_STEPS.map((_, i) => `<span class="tuto-dot${i === tutoStep ? " on" : ""}"></span>`).join("");
  $("btn-tuto-next").textContent = tutoStep === TUTO_STEPS.length - 1 ? "🎮 Créer une partie" : "Suivant";
}
function openTuto() { tutoStep = 0; renderTuto(); show("screen-tutorial"); }
function endTuto() { try { localStorage.setItem("spyfall-seen-tuto", "1"); } catch {} show("screen-home"); try { $("name-input").focus(); } catch {} }
$("btn-tuto").onclick = openTuto;
$("btn-tuto-skip").onclick = endTuto;
$("btn-tuto-next").onclick = () => { if (tutoStep < TUTO_STEPS.length - 1) { tutoStep++; renderTuto(); } else endTuto(); };

// --- Portail (un seul champ mot de passe) ------------------------------------

function lockGate(msg) {
  stopPolling(); releaseWake();
  localStorage.removeItem("spyfall-pass");
  show("screen-gate");
  setError("gate-error", msg || "");
  try { $("gate-pass").focus(); } catch {}
}
function enterApp() {
  loadDecks();
  const storedName = localStorage.getItem("spyfall-name");
  if (storedName && !$("name-input").value) $("name-input").value = storedName;
  const params = new URLSearchParams(location.search);
  const c = (params.get("code") || "").toUpperCase();
  const hasCode = /^[A-Z0-9]{3,8}$/.test(c);
  if (hasCode && !session) $("code-input").value = c;
  if (session) { startPolling(); return; }
  // Première visite (et pas arrivé par un lien de salle) : tutoriel express.
  if (!hasCode && !localStorage.getItem("spyfall-seen-tuto")) { openTuto(); return; }
  show("screen-home");
}
async function tryPassword(pass) {
  const res = await fetch("/api/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pass }) });
  return res.ok;
}
$("btn-gate").onclick = () => withBusy($("btn-gate"), async () => {
  setError("gate-error", "");
  const pass = $("gate-pass").value;
  try { if (!(await tryPassword(pass))) throw new Error("Mot de passe incorrect."); localStorage.setItem("spyfall-pass", pass); enterApp(); }
  catch (e) { setError("gate-error", e.message); }
});
$("gate-pass").addEventListener("keydown", (e) => { if (e.key === "Enter") $("btn-gate").click(); });

// Démarrage : portail si nécessaire (fail-closed si /api/config échoue), sinon reprise.
(async function boot() {
  let gate = true; // par défaut on suppose un portail (sécurité)
  try { gate = (await (await fetch("/api/config")).json()).gate; } catch { gate = false; }
  if (!gate) return enterApp();
  const stored = localStorage.getItem("spyfall-pass");
  if (stored && (await tryPassword(stored).catch(() => false))) return enterApp();
  localStorage.removeItem("spyfall-pass");
  show("screen-gate");
  try { $("gate-pass").focus(); } catch {}
})();
