// Serveur Spyfall en français — zéro dépendance, Node.js >= 16.
// Lancement : node server.js  (port 3000 par défaut, ou variable PORT)
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const DECKS = require("./locations");

// Modes proposés à la création (et au lancement) — sous-ensemble de DECKS.
const ALLOWED_DECKS = ["both", "delire", "delire2", "delireBoth"];
const DEFAULT_DECK = "both";

// --- Lieux & rôles éditables, persistés sur disque -------------------------
// Les 4 paquets de base sont modifiables depuis l'app (ajout/suppression de
// lieux et de rôles). On charge data.json s'il existe (il SURVIT aux
// redéploiements car non suivi par git), sinon on l'initialise depuis
// locations.js. Les modes de jeu (both / delireBoth) se recomposent à la volée.
const DATA_FILE = path.join(__dirname, "data.json");
const BASE_PACKS = ["spyfall1", "spyfall2", "delire", "delire2"];
const LABELS = {
  spyfall1: "Spyfall 1",
  spyfall2: "Spyfall 2",
  both: "Spyfall 1 + 2",
  delire: "Délire (RP)",
  delire2: "Délire 2 (corsé) 🔞",
  delireBoth: "Délire + Délire 2 🔞",
};
const editable = {};

function clonePack(k) {
  return DECKS[k].locations.map((l) => ({ name: l.name, theme: l.theme, roles: [...l.roles] }));
}
function saveEditable() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(editable, null, 2));
  } catch (e) {
    console.error("Écriture data.json impossible :", e.message);
  }
}
function loadEditable() {
  let saved = null;
  try { saved = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { saved = null; }
  for (const k of BASE_PACKS) editable[k] = saved && Array.isArray(saved[k]) ? saved[k] : clonePack(k);
  if (!saved) saveEditable();
}
function poolFor(deckKey) {
  switch (deckKey) {
    case "both": return [...editable.spyfall1, ...editable.spyfall2];
    case "delire": return editable.delire;
    case "delire2": return editable.delire2;
    case "delireBoth": return [...editable.delire, ...editable.delire2];
    default: return [...editable.spyfall1, ...editable.spyfall2];
  }
}
function deckMeta() {
  return Object.fromEntries(ALLOWED_DECKS.map((k) => [k, { label: LABELS[k], count: poolFor(k).length }]));
}
function allThemes() {
  const set = new Set();
  for (const k of BASE_PACKS) for (const l of editable[k]) set.add(l.theme);
  return [...set];
}
function locationsPayload() {
  return {
    packs: BASE_PACKS.map((k) => ({ key: k, label: LABELS[k], locations: editable[k] })),
    themes: allThemes(),
  };
}
function cleanStr(s, max) {
  return String(s == null ? "" : s).trim().replace(/\s+/g, " ").slice(0, max);
}
// Applique une opération d'édition (jette httpError si invalide).
function applyEdit(body) {
  if (!BASE_PACKS.includes(body.pack)) throw httpError(400, "Paquet inconnu.");
  const list = editable[body.pack];
  if (body.op === "addLocation") {
    const name = cleanStr(body.name, 40);
    if (!name) throw httpError(400, "Donnez un nom au lieu.");
    if (list.some((l) => l.name.toLowerCase() === name.toLowerCase()))
      throw httpError(400, "Ce lieu existe déjà dans ce paquet.");
    const theme = cleanStr(body.theme, 40) || allThemes()[0] || "Autres";
    let roles = [...new Set((Array.isArray(body.roles) ? body.roles : []).map((r) => cleanStr(r, 40)).filter(Boolean))];
    if (roles.length > 30) throw httpError(400, "Trop de rôles (30 max).");
    if (!roles.length) roles = ["Habitué"];
    list.push({ name, theme, roles });
    return;
  }
  const loc = list.find((l) => l.name === body.name);
  if (body.op === "deleteLocation") {
    if (!loc) throw httpError(404, "Lieu introuvable.");
    if (list.length <= 1) throw httpError(400, "Un paquet doit garder au moins un lieu.");
    list.splice(list.indexOf(loc), 1);
    return;
  }
  if (!loc) throw httpError(404, "Lieu introuvable.");
  if (body.op === "addRole") {
    const role = cleanStr(body.role, 40);
    if (!role) throw httpError(400, "Donnez un nom au rôle.");
    if (loc.roles.some((r) => r.toLowerCase() === role.toLowerCase()))
      throw httpError(400, "Ce rôle existe déjà dans ce lieu.");
    if (loc.roles.length >= 30) throw httpError(400, "Trop de rôles pour ce lieu (30 max).");
    loc.roles.push(role);
    return;
  }
  if (body.op === "deleteRole") {
    const idx = loc.roles.indexOf(String(body.role || ""));
    if (idx === -1) throw httpError(404, "Rôle introuvable.");
    if (loc.roles.length <= 1) throw httpError(400, "Un lieu doit garder au moins un rôle.");
    loc.roles.splice(idx, 1);
    return;
  }
  throw httpError(400, "Opération inconnue.");
}

loadEditable();

// Portail à un seul champ : mot de passe partagé lu dans l'environnement.
// Vide => aucun portail (accès libre, pratique en local). Le mot de passe
// n'est jamais écrit dans le dépôt : il est fourni via SPYFALL_PASSWORD.
const ACCESS_PASSWORD = process.env.SPYFALL_PASSWORD || "";
const GATE_ON = ACCESS_PASSWORD.length > 0;

function passOk(given) {
  if (!GATE_ON) return true;
  const a = Buffer.from(String(given || ""));
  const b = Buffer.from(ACCESS_PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const PORT = process.env.PORT || 3000;
const ROOM_TTL_MS = 3 * 60 * 60 * 1000; // salles supprimées après 3 h d'inactivité
const MAX_ROOMS = 500;
const MAX_PLAYERS = 12;

const rooms = new Map();

function makeRoomCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code;
  do {
    code = Array.from({ length: 2 }, () => letters[crypto.randomInt(letters.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function touch(room) {
  room.lastActivity = Date.now();
}

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.lastActivity > ROOM_TTL_MS) rooms.delete(code);
  }
}, 10 * 60 * 1000).unref();

function createRoom(name, deck) {
  if (rooms.size >= MAX_ROOMS) throw httpError(503, "Trop de salles ouvertes, réessayez plus tard.");
  const room = {
    code: makeRoomCode(),
    players: [],
    status: "lobby", // lobby | playing | reveal
    round: null,
    durationMin: 8,
    deck: ALLOWED_DECKS.includes(deck) ? deck : DEFAULT_DECK,
    lastActivity: Date.now(),
  };
  rooms.set(room.code, room);
  const player = addPlayer(room, name, true);
  return { room, player };
}

function addPlayer(room, name, isHost) {
  name = String(name || "").trim().slice(0, 20);
  if (!name) throw httpError(400, "Il faut un prénom.");
  if (room.players.length >= MAX_PLAYERS) throw httpError(400, "La salle est pleine.");
  if (room.players.some((p) => p.name.toLowerCase() === name.toLowerCase()))
    throw httpError(400, "Ce prénom est déjà pris dans la salle.");
  const player = { id: crypto.randomUUID(), name, isHost: !!isHost };
  room.players.push(player);
  touch(room);
  return player;
}

function getRoom(code) {
  const room = rooms.get(String(code || "").toUpperCase());
  if (!room) throw httpError(404, "Salle introuvable. Vérifiez le code.");
  return room;
}

function getPlayer(room, playerId) {
  const player = room.players.find((p) => p.id === playerId);
  if (!player) throw httpError(403, "Joueur inconnu dans cette salle.");
  return player;
}

function startRound(room, player, durationMin, deck) {
  if (!player.isHost) throw httpError(403, "Seul l'hôte peut lancer la manche.");
  if (room.players.length < 3) throw httpError(400, "Il faut au moins 3 joueurs.");
  const minutes = Math.min(20, Math.max(1, Number(durationMin) || room.durationMin));
  room.durationMin = minutes;
  if (ALLOWED_DECKS.includes(deck)) room.deck = deck;
  const pool = poolFor(room.deck);
  if (!pool.length) throw httpError(400, "Ce mode n'a aucun lieu. Ajoutez-en dans l'éditeur.");
  const location = pool[crypto.randomInt(pool.length)];
  const spy = room.players[crypto.randomInt(room.players.length)];
  const shuffledRoles = [...location.roles].sort(() => Math.random() - 0.5);
  const cards = {};
  let i = 0;
  for (const p of room.players) {
    cards[p.id] =
      p.id === spy.id
        ? { spy: true }
        : { spy: false, location: location.name, role: shuffledRoles[i++ % shuffledRoles.length] };
  }
  room.round = {
    locationName: location.name,
    poolNames: pool.map((l) => ({ name: l.name, theme: l.theme })),
    spyId: spy.id,
    cards,
    startedAt: Date.now(),
    durationMs: minutes * 60 * 1000,
  };
  room.status = "playing";
  touch(room);
}

function endRound(room, player) {
  if (!player.isHost) throw httpError(403, "Seul l'hôte peut terminer la manche.");
  if (room.status !== "playing") throw httpError(400, "Aucune manche en cours.");
  room.status = "reveal";
  touch(room);
}

function backToLobby(room, player) {
  if (!player.isHost) throw httpError(403, "Seul l'hôte peut revenir au salon.");
  room.status = "lobby";
  room.round = null;
  touch(room);
}

function stateFor(room, playerId) {
  const player = getPlayer(room, playerId);
  const state = {
    code: room.code,
    status: room.status,
    durationMin: room.durationMin,
    deck: room.deck,
    decks: deckMeta(),
    you: { id: player.id, name: player.name, isHost: player.isHost },
    players: room.players.map((p) => ({ name: p.name, isHost: p.isHost })),
  };
  if (room.status === "playing") {
    state.card = room.round.cards[player.id];
    state.endsAt = room.round.startedAt + room.round.durationMs;
    state.locations = room.round.poolNames;
  }
  if (room.status === "reveal") {
    const spy = room.players.find((p) => p.id === room.round.spyId);
    state.reveal = { location: room.round.locationName, spyName: spy ? spy.name : "(parti)" };
  }
  return state;
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 10_000) reject(httpError(413, "Requête trop grosse."));
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(httpError(400, "JSON invalide."));
      }
    });
  });
}

const STATIC = {
  "/": ["public/index.html", "text/html; charset=utf-8"],
  "/app.js": ["public/app.js", "text/javascript; charset=utf-8"],
  "/style.css": ["public/style.css", "text/css; charset=utf-8"],
  "/editor.html": ["public/editor.html", "text/html; charset=utf-8"],
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (req.method === "GET" && STATIC[url.pathname]) {
      const [file, type] = STATIC[url.pathname];
      res.writeHead(200, { "Content-Type": type });
      res.end(fs.readFileSync(path.join(__dirname, file)));
      return;
    }

    // Le client demande s'il faut afficher le portail mot de passe.
    if (req.method === "GET" && url.pathname === "/api/config") {
      return sendJSON(res, 200, { gate: GATE_ON });
    }
    // Vérification du mot de passe du portail (un seul champ).
    if (req.method === "POST" && url.pathname === "/api/access") {
      const body = await readBody(req);
      if (!passOk(body.password)) throw httpError(401, "Mot de passe incorrect.");
      return sendJSON(res, 200, { ok: true });
    }

    // Liste des modes proposés à la création (écran d'accueil, avant toute salle).
    if (req.method === "GET" && url.pathname === "/api/decks") {
      return sendJSON(res, 200, { decks: deckMeta() });
    }

    // Éditeur de lieux & rôles (protégé par le mot de passe du portail).
    if (url.pathname === "/api/locations") {
      if (!passOk(req.headers["x-spyfall-pass"])) throw httpError(401, "Mot de passe requis.");
      if (req.method === "GET") return sendJSON(res, 200, locationsPayload());
      if (req.method === "POST") {
        applyEdit(await readBody(req));
        saveEditable();
        return sendJSON(res, 200, locationsPayload());
      }
      throw httpError(405, "Méthode non autorisée.");
    }

    // API : /api/rooms et /api/rooms/:code/(join|start|end|lobby|state)
    const match = url.pathname.match(/^\/api\/rooms(?:\/([A-Za-z]{2})(?:\/(join|start|end|lobby|state))?)?$/);
    if (!match) throw httpError(404, "Page introuvable.");
    const [, code, action] = match;

    // Toutes les actions de jeu exigent le mot de passe du portail.
    if (!passOk(req.headers["x-spyfall-pass"])) throw httpError(401, "Mot de passe requis.");

    if (req.method === "POST" && !code) {
      const body = await readBody(req);
      const { room, player } = createRoom(body.name, body.deck);
      return sendJSON(res, 201, { code: room.code, playerId: player.id });
    }
    if (req.method === "POST" && action === "join") {
      const body = await readBody(req);
      const player = addPlayer(getRoom(code), body.name, false);
      return sendJSON(res, 200, { code: code.toUpperCase(), playerId: player.id });
    }
    if (req.method === "POST" && (action === "start" || action === "end" || action === "lobby")) {
      const body = await readBody(req);
      const room = getRoom(code);
      const player = getPlayer(room, body.playerId);
      if (action === "start") startRound(room, player, body.durationMin, body.deck);
      else if (action === "end") endRound(room, player);
      else backToLobby(room, player);
      return sendJSON(res, 200, stateFor(room, player.id));
    }
    if (req.method === "GET" && action === "state") {
      const room = getRoom(code);
      touch(room);
      return sendJSON(res, 200, stateFor(room, url.searchParams.get("playerId")));
    }
    throw httpError(404, "Page introuvable.");
  } catch (e) {
    sendJSON(res, e.status || 500, { error: e.message || "Erreur serveur." });
  }
});

server.listen(PORT, () => {
  console.log(`Spyfall FR prêt sur http://localhost:${PORT}`);
});
