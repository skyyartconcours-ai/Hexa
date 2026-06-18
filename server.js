// Serveur Spyfall en français — zéro dépendance, Node.js >= 16.
// Lancement : node server.js  (port 3000 par défaut, ou variable PORT)
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const DECKS = require("./locations");

const PORT = process.env.PORT || 3000;
const ROOM_TTL_MS = 3 * 60 * 60 * 1000; // salles supprimées après 3 h d'inactivité
const MAX_ROOMS = 500;
const MAX_PLAYERS = 12;

const rooms = new Map();

function makeRoomCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[crypto.randomInt(letters.length)]).join("");
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

function createRoom(name) {
  if (rooms.size >= MAX_ROOMS) throw httpError(503, "Trop de salles ouvertes, réessayez plus tard.");
  const room = {
    code: makeRoomCode(),
    players: [],
    status: "lobby", // lobby | playing | reveal
    round: null,
    durationMin: 8,
    deck: "spyfall1",
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
  if (DECKS[deck]) room.deck = deck;
  const pool = DECKS[room.deck].locations;
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
    decks: Object.fromEntries(Object.entries(DECKS).map(([k, d]) => [k, { label: d.label, count: d.locations.length }])),
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

    // API : /api/rooms et /api/rooms/:code/(join|start|end|lobby|state)
    const match = url.pathname.match(/^\/api\/rooms(?:\/([A-Za-z]{4})(?:\/(join|start|end|lobby|state))?)?$/);
    if (!match) throw httpError(404, "Page introuvable.");
    const [, code, action] = match;

    if (req.method === "POST" && !code) {
      const body = await readBody(req);
      const { room, player } = createRoom(body.name);
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
