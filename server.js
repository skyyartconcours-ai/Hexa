// Serveur Spyfall en français — zéro dépendance, Node.js >= 16.
// Lancement : node server.js  (port 3000 par défaut, ou variable PORT)
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const DECKS = require("./locations");

// Modes proposés à la création (et au lancement).
const ALLOWED_DECKS = ["both", "delire", "delire2", "delireBoth"];
const DEFAULT_DECK = "both";
const SPY_MODES = ["auto", "1", "2"];

// Portail à un seul champ : mot de passe partagé lu dans l'environnement.
// Vide => aucun portail (accès libre, pratique en local). Jamais dans le dépôt.
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
const HOST_TIMEOUT_MS = 20 * 1000; // hôte réputé parti après 20 s sans activité
const PRESENCE_GONE_MS = 90 * 1000; // grâce de reconnexion : retiré après 90 s d'absence réelle
const MAX_ROOMS = 200; // < 576 codes 2 lettres : marge confortable, codes rapides
const MAX_PLAYERS = 12;

// État de présence dérivé de lastSeen (verrouiller son téléphone ne fait PAS quitter).
function presenceOf(p) {
  const d = nowMs() - p.lastSeen;
  if (d < 12000) return "actif";
  if (d < 40000) return "inactif";
  return "parti";
}

// ---------------------------------------------------------------------------
// Lieux & rôles éditables, persistés sur disque (écriture ATOMIQUE).
// ---------------------------------------------------------------------------
const DATA_FILE = path.join(__dirname, "data.json");
const BASE_PACKS = ["spyfall1", "spyfall2", "delire", "delire2"];
// NB : les CLÉS (spyfall1/spyfall2/both…) sont techniques et ne doivent pas
// changer ; seuls les libellés affichés sont renommés en « Classique » pour
// rester cohérent avec le branding Hexa (plus aucun « Spyfall » à l'écran).
const LABELS = {
  spyfall1: "Classique 1",
  spyfall2: "Classique 2",
  both: "Classique 1 + 2",
  delire: "Délire (RP)",
  delire2: "Délire 2 (corsé) 🔞",
  delireBoth: "Délire + Délire 2 🔞",
};
// Thèmes canoniques (issus des paquets par défaut) : toujours proposés même si
// plus aucun lieu ne les porte (corrige le bug du « thème orphelin »).
const CANON_THEMES = (() => {
  const s = new Set();
  for (const k of BASE_PACKS) for (const l of DECKS[k].locations) s.add(l.theme);
  return [...s];
})();
const editable = {};

function clonePack(k) {
  return DECKS[k].locations.map((l) => ({ name: l.name, theme: l.theme, roles: [...l.roles] }));
}
// Un paquet est valide s'il contient des lieux bien formés (>=1 rôle chacun).
function validPack(arr) {
  return (
    Array.isArray(arr) &&
    arr.length > 0 &&
    arr.every(
      (l) =>
        l &&
        typeof l.name === "string" &&
        l.name.trim() &&
        typeof l.theme === "string" &&
        l.theme.trim() &&
        Array.isArray(l.roles) &&
        l.roles.length > 0 &&
        l.roles.every((r) => typeof r === "string" && r.trim())
    )
  );
}
function loadEditable() {
  let saved = null;
  try { saved = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { saved = null; }
  if (!saved) {
    try { saved = JSON.parse(fs.readFileSync(DATA_FILE + ".bak", "utf8")); } catch { saved = null; }
  }
  let needSave = false;
  for (const k of BASE_PACKS) {
    if (saved && validPack(saved[k])) editable[k] = saved[k];
    else { editable[k] = clonePack(k); needSave = true; }
  }
  if (needSave) saveEditable();
}
function saveEditable() {
  try {
    const tmp = DATA_FILE + ".tmp";
    const fd = fs.openSync(tmp, "w");
    fs.writeSync(fd, JSON.stringify(editable, null, 2));
    fs.fsyncSync(fd); // garantit que le contenu est sur disque AVANT le rename (anti fichier vide)
    fs.closeSync(fd);
    fs.renameSync(tmp, DATA_FILE); // remplacement atomique
    try { fs.copyFileSync(DATA_FILE, DATA_FILE + ".bak"); } catch {} // .bak depuis la version saine
  } catch (e) {
    console.error("Écriture data.json impossible :", e.message);
  }
}
function poolFor(deckKey) {
  let arr;
  switch (deckKey) {
    case "both": arr = [...editable.spyfall1, ...editable.spyfall2]; break;
    case "delire": arr = editable.delire; break;
    case "delire2": arr = editable.delire2; break;
    case "delireBoth": arr = [...editable.delire, ...editable.delire2]; break;
    default: arr = [...editable.spyfall1, ...editable.spyfall2];
  }
  // Déduplique par nom (un éditeur pourrait ajouter un homonyme dans un autre
  // paquet du même mode combiné -> sinon boutons identiques et devinette ambiguë).
  const seen = new Set();
  return arr.filter((l) => { const k = l.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}
function deckMeta() {
  return Object.fromEntries(ALLOWED_DECKS.map((k) => [k, { label: LABELS[k], count: poolFor(k).length }]));
}
function allThemes() {
  const s = new Set(CANON_THEMES);
  for (const k of BASE_PACKS) for (const l of editable[k]) if (l.theme && l.theme.trim()) s.add(l.theme);
  return [...s];
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
function applyEdit(body) {
  if (!BASE_PACKS.includes(body.pack)) throw httpError(400, "Paquet inconnu.");
  const list = editable[body.pack];
  if (body.op === "addLocation") {
    const name = cleanStr(body.name, 40);
    if (!name) throw httpError(400, "Donnez un nom au lieu.");
    if (list.some((l) => l.name.toLowerCase() === name.toLowerCase()))
      throw httpError(400, "Ce lieu existe déjà dans ce paquet.");
    const theme = cleanStr(body.theme, 40) || allThemes()[0] || "Autres";
    let roles = [...new Set((Array.isArray(body.roles) ? body.roles : []).map((r) => cleanStr(r, 80)).filter(Boolean))];
    if (roles.length > 30) throw httpError(400, "Trop de rôles (30 max).");
    if (!roles.length) roles = ["Habitué"];
    list.push({ name, theme, roles });
    return;
  }
  const loc = list.find((l) => l.name.toLowerCase() === String(body.name || "").toLowerCase());
  if (body.op === "deleteLocation") {
    if (!loc) throw httpError(404, "Lieu introuvable.");
    if (list.length <= 1) throw httpError(400, "Un paquet doit garder au moins un lieu.");
    list.splice(list.indexOf(loc), 1);
    return;
  }
  if (!loc) throw httpError(404, "Lieu introuvable.");
  if (body.op === "addRole") {
    const role = cleanStr(body.role, 80);
    if (!role) throw httpError(400, "Donnez un nom au rôle.");
    if (loc.roles.some((r) => r.toLowerCase() === role.toLowerCase()))
      throw httpError(400, "Ce rôle existe déjà dans ce lieu.");
    if (loc.roles.length >= 30) throw httpError(400, "Trop de rôles pour ce lieu (30 max).");
    loc.roles.push(role);
    return;
  }
  if (body.op === "deleteRole") {
    const idx = loc.roles.findIndex((r) => r.toLowerCase() === String(body.role || "").toLowerCase());
    if (idx === -1) throw httpError(404, "Rôle introuvable.");
    if (loc.roles.length <= 1) throw httpError(400, "Un lieu doit garder au moins un rôle.");
    loc.roles.splice(idx, 1);
    return;
  }
  throw httpError(400, "Opération inconnue.");
}
loadEditable();

// ---------------------------------------------------------------------------
// Fichiers statiques : lus UNE fois en mémoire au démarrage (pas d'I/O par requête).
// ---------------------------------------------------------------------------
const STATIC_FILES = {
  "/": ["public/index.html", "text/html; charset=utf-8"],
  "/app.js": ["public/app.js", "text/javascript; charset=utf-8"],
  "/qr.js": ["public/qr.js", "text/javascript; charset=utf-8"],
  "/i18n.js": ["public/i18n.js", "text/javascript; charset=utf-8"],
  "/i18n-content.js": ["public/i18n-content.js", "text/javascript; charset=utf-8"],
  "/style.css": ["public/style.css", "text/css; charset=utf-8"],
};
const STATIC_CACHE = {};
for (const [p, [file, type]] of Object.entries(STATIC_FILES)) {
  try { STATIC_CACHE[p] = { buf: fs.readFileSync(path.join(__dirname, file)), type }; }
  catch (e) { console.error("Statique introuvable :", file, e.message); }
}

// Suggestions de rôles (par lieu corsé) proposées par les agents : à retirer
// (rouge) / à ajouter (vert). Lues au démarrage, servies via /api/suggestions.
let SUGGESTIONS = {};
try { SUGGESTIONS = JSON.parse(fs.readFileSync(path.join(__dirname, "public/suggestions.json"), "utf8")); }
catch (e) { console.error("suggestions.json :", e.message); }

// ---------------------------------------------------------------------------
// Salles & joueurs.
// ---------------------------------------------------------------------------
const rooms = new Map();
const nowMs = () => Date.now();
const activeGamesCount = () => { let n = 0; for (const r of rooms.values()) if (r.status === "playing") n++; return n; };

// Codes de salle = mots FR courts, clairs et DICTABLES à voix haute (soirée,
// stream, vocal Discord). Triés pour éviter homophones/ambiguïtés/vulgarité.
const CODE_WORDS = [
  "LION", "OURS", "LOUP", "PUMA", "LAMA", "ZEBRE", "TIGRE", "PANDA", "KOALA", "COBRA",
  "HIBOU", "AIGLE", "BISON", "MORSE", "PHOQUE", "RENARD", "CASTOR", "OTARIE", "REQUIN", "CHEVAL",
  "MOUTON", "LAPIN", "FAUCON", "HERON", "DAUPHIN", "TABLE", "LIVRE", "STYLO", "LAMPE", "PORTE",
  "RADIO", "PIANO", "ROBOT", "CASQUE", "VOILE", "TRAIN", "AVION", "METRO", "KAYAK", "VELO",
  "MOTO", "BOITE", "CARTE", "FUSEE", "VIOLON", "FLUTE", "HARPE", "IGLOO", "TIPI", "CABANE",
  "MOULIN", "PONT", "TOUR", "NEIGE", "GLACE", "ORAGE", "NUAGE", "FORET", "OCEAN", "PLAGE",
  "DUNE", "VAGUE", "CACTUS", "PALME", "CEDRE", "ERABLE", "BAMBOU", "ROSE", "TULIPE", "ETOILE",
  "COMETE", "VOLCAN", "SOLEIL", "ECLAIR", "MELON", "CITRON", "KIWI", "MANGUE", "CACAO", "MIEL",
  "PATES", "PIZZA", "SUSHI", "GAUFRE", "CREPE", "NOUGAT", "OLIVE", "RAISIN", "POIRE", "FRAISE",
  "CERISE", "BANANE", "TOMATE", "RADIS", "POMME", "ANANAS", "BISCUIT", "CHOCO",
];
function makeRoomCode() {
  for (let i = 0; i < 50; i++) {
    const w = CODE_WORDS[crypto.randomInt(CODE_WORDS.length)];
    if (!rooms.has(w)) return w;
  }
  let code; // repli si beaucoup de salles : mot + chiffre, reste dictable
  do { code = CODE_WORDS[crypto.randomInt(CODE_WORDS.length)] + crypto.randomInt(10); } while (rooms.has(code));
  return code;
}
function touch(room) { room.lastActivity = nowMs(); }

// Mélange uniforme (Fisher-Yates) avec source cryptographique.
function shuffle(arr) {
  const a = [...arr];
  for (let j = a.length - 1; j > 0; j--) {
    const k = crypto.randomInt(j + 1);
    [a[j], a[k]] = [a[k], a[j]];
  }
  return a;
}

// Boucle de maintenance : purge TTL, expiration de manche, réattribution d'hôte.
setInterval(() => {
  const t = nowMs();
  for (const [code, room] of rooms) {
    if (t - room.lastActivity > ROOM_TTL_MS) { rooms.delete(code); continue; }
    // Retire les joueurs réellement absents (au-delà de la grâce de reconnexion).
    const gone = room.players.filter((p) => t - p.lastSeen > PRESENCE_GONE_MS).map((p) => p.id);
    for (const id of gone) leaveRoom(room, id);
    if (!rooms.has(code)) continue;
    maybeExpireRound(room);
    reassignHostIfNeeded(room);
  }
}, 5000).unref();

function reassignHostIfNeeded(room) {
  if (!room.players.length) return;
  const t = nowMs();
  const host = room.players.find((p) => p.isHost);
  if (host && t - host.lastSeen <= HOST_TIMEOUT_MS) return; // hôte encore actif
  const active = room.players.filter((p) => t - p.lastSeen <= HOST_TIMEOUT_MS);
  const pick = (active.length ? active : room.players)[0];
  for (const p of room.players) p.isHost = p.id === pick.id;
}

function maybeExpireRound(room) {
  // Ne pas convertir en timeout (victoire espion) si un vote est en cours :
  // on laisse l'unanimité éventuelle se résoudre (l'hôte peut toujours terminer).
  if (room.status === "playing" && room.round && !room.round.accusation && nowMs() > room.round.startedAt + room.round.durationMs) {
    resolveRound(room, "timeout");
  }
}

function createRoom(name, deck, spyMode) {
  if (rooms.size >= MAX_ROOMS) throw httpError(503, "Trop de salles ouvertes, réessayez plus tard.");
  const room = {
    code: makeRoomCode(),
    players: [],
    status: "lobby", // lobby | playing | reveal
    round: null,
    durationMin: 8,
    deck: ALLOWED_DECKS.includes(deck) ? deck : DEFAULT_DECK,
    spyMode: SPY_MODES.includes(spyMode) ? spyMode : "auto",
    scores: {}, // playerId -> points cumulés
    history: [],
    roundNo: 0,
    lastReveal: null,
    lastActivity: nowMs(),
  };
  const player = addPlayer(room, name, true); // jette si prénom invalide AVANT enregistrement
  rooms.set(room.code, room);
  return { room, player };
}

function addPlayer(room, name, isHost) {
  if (room.status === "playing") throw httpError(409, "Manche en cours — rejoins à la fin de la manche.");
  name = String(name || "").trim().slice(0, 20);
  if (!name) throw httpError(400, "Il faut un prénom.");
  if (room.players.length >= MAX_PLAYERS) throw httpError(400, "La salle est pleine.");
  if (room.players.some((p) => p.name.toLowerCase() === name.toLowerCase()))
    throw httpError(400, "Ce prénom est déjà pris dans la salle.");
  const player = { id: crypto.randomUUID(), name, isHost: !!isHost, lastSeen: nowMs() };
  room.players.push(player);
  room.scores[player.id] = 0;
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

function leaveRoom(room, playerId) {
  const idx = room.players.findIndex((p) => p.id === playerId);
  if (idx === -1) return;
  const departing = room.players[idx];
  const wasHost = departing.isHost;
  room.players.splice(idx, 1);
  delete room.scores[playerId];
  if (!room.players.length) { rooms.delete(room.code); return; }
  if (wasHost) reassignHostIfNeeded(room); // choix cohérent avec la boucle de maintenance

  // Nettoyage si une manche est en cours.
  if (room.status === "playing" && room.round) {
    const r = room.round;
    r.spyIds = r.spyIds.filter((id) => id !== playerId);
    if (r.accusation) {
      delete r.accusation.votes[playerId];
      if (r.accusation.suspectId === playerId || r.accusation.accuserId === playerId) r.accusation = null;
    }
    // Manche devenue injouable (trop peu de joueurs, ou plus d'espion, ou plus d'innocent) -> retour au salon.
    if (room.players.length < 3 || !r.spyIds.length || r.spyIds.length >= room.players.length) {
      room.status = "lobby";
      room.round = null;
      room.lastReveal = null;
    } else {
      // Le premier joueur est parti : on en re-tire un parmi ceux qui restent.
      if (r.firstPlayerName === departing.name) r.firstPlayerName = room.players[crypto.randomInt(room.players.length)].name;
      if (r.accusation) maybeResolveVote(room); // le départ a peut-être complété l'unanimité
    }
  }
  touch(room);
}

function startRound(room, player, opts) {
  if (!player.isHost) throw httpError(403, "Seul l'hôte peut lancer la manche.");
  if (room.status === "playing") throw httpError(400, "Une manche est déjà en cours."); // évite le re-roll mid-manche
  if (room.players.length < 3) throw httpError(400, "Il faut au moins 3 joueurs.");
  if (opts) {
    if (opts.durationMin != null) room.durationMin = Math.min(20, Math.max(1, Number(opts.durationMin) || room.durationMin));
    if (ALLOWED_DECKS.includes(opts.deck)) room.deck = opts.deck;
    if (SPY_MODES.includes(opts.spyMode)) room.spyMode = opts.spyMode;
  }
  const pool = poolFor(room.deck);
  if (!pool.length) throw httpError(400, "Ce mode n'a aucun lieu. Ajoutez-en dans l'éditeur.");
  const location = pool[crypto.randomInt(pool.length)];

  // Nombre d'espions : auto = 1 (<7 joueurs) ou 2 (>=7), borné pour garder >=1 innocent.
  let spyCount = room.spyMode === "2" ? 2 : room.spyMode === "1" ? 1 : room.players.length >= 7 ? 2 : 1;
  spyCount = Math.max(1, Math.min(spyCount, room.players.length - 1));
  const spyIds = shuffle(room.players.map((p) => p.id)).slice(0, spyCount);

  const roles = shuffle(location.roles);
  const order = shuffle(room.players.map((_, i) => i)); // casse la régularité des doublons de rôles
  const cards = {};
  let i = 0;
  for (const oi of order) {
    const p = room.players[oi];
    cards[p.id] = spyIds.includes(p.id)
      ? { spy: true }
      : { spy: false, location: location.name, role: roles[i++ % roles.length] };
  }
  const first = room.players[crypto.randomInt(room.players.length)];
  room.roundNo += 1;
  room.round = {
    locationName: location.name,
    locationRoles: [...location.roles],
    poolNames: pool.map((l) => ({ name: l.name, theme: l.theme })),
    spyIds,
    cards,
    startedAt: nowMs(),
    durationMs: room.durationMin * 60 * 1000,
    firstPlayerName: first.name,
    accusation: null,
    spentAccusers: [],
    clearedSuspects: [],
  };
  room.status = "playing";
  room.lastReveal = null;
  touch(room);
}

function spyGuess(room, player, locationName) {
  if (room.status !== "playing" || !room.round) throw httpError(400, "Aucune manche en cours.");
  if (room.round.accusation) throw httpError(400, "Un vote est en cours, attendez le résultat."); // aligne le serveur sur l'UI : pas de devinette tant qu'une accusation est ouverte
  if (!room.round.spyIds.includes(player.id)) throw httpError(403, "Seul l'espion peut deviner le lieu.");
  const correct = String(locationName) === room.round.locationName;
  resolveRound(room, correct ? "spy_guessed_right" : "spy_guessed_wrong", { by: player.name, guess: String(locationName) });
}

function accuse(room, player, suspectName) {
  if (room.status !== "playing" || !room.round) throw httpError(400, "Aucune manche en cours.");
  if (room.round.accusation) throw httpError(400, "Un vote est déjà en cours.");
  if (room.round.spentAccusers.includes(player.id)) throw httpError(400, "Vous avez déjà lancé une accusation cette manche.");
  const suspect = room.players.find((p) => p.name === suspectName);
  if (!suspect) throw httpError(404, "Joueur introuvable.");
  if (suspect.id === player.id) throw httpError(400, "Vous ne pouvez pas vous accuser vous-même.");
  if (room.round.clearedSuspects.includes(suspect.id)) throw httpError(400, "Ce joueur a déjà été innocenté ce tour.");
  room.round.accusation = {
    id: crypto.randomUUID(), // identifiant unique : fiabilise la reconstruction du panneau de vote
    accuserId: player.id,
    accuserName: player.name,
    suspectId: suspect.id,
    suspectName: suspect.name,
    votes: { [player.id]: true }, // l'accusateur est d'accord d'office
  };
  touch(room);
  maybeResolveVote(room);
}

function castVote(room, player, agree) {
  if (room.status !== "playing" || !room.round) throw httpError(400, "Aucune manche en cours.");
  const acc = room.round.accusation;
  if (!acc) throw httpError(400, "Aucun vote en cours.");
  if (player.id === acc.suspectId) throw httpError(403, "Le suspect ne vote pas.");
  if (player.id in acc.votes) throw httpError(400, "Vous avez déjà voté."); // vote définitif
  acc.votes[player.id] = !!agree;
  touch(room);
  maybeResolveVote(room);
}

function maybeResolveVote(room) {
  const acc = room.round.accusation;
  const voters = room.players.filter((p) => p.id !== acc.suspectId);
  if (!voters.every((p) => p.id in acc.votes)) return; // tout le monde n'a pas voté
  const unanimousYes = voters.every((p) => acc.votes[p.id] === true);
  if (unanimousYes) {
    const caught = room.round.spyIds.includes(acc.suspectId);
    resolveRound(room, caught ? "spy_caught" : "wrong_accusation", { accuser: acc.accuserName, accuserId: acc.accuserId, suspect: acc.suspectName });
  } else {
    room.round.spentAccusers.push(acc.accuserId); // l'accusateur a épuisé sa tentative
    room.round.clearedSuspects.push(acc.suspectId); // ce suspect ne peut plus être ré-accusé ce tour
    room.round.accusation = null;
    touch(room);
  }
}

function resolveRound(room, outcome, info) {
  if (room.status !== "playing" || !room.round) return; // idempotent : pas de double résolution
  const r = room.round;
  r.accusation = null; // neutralise tout vote résiduel
  const spies = room.players.filter((p) => r.spyIds.includes(p.id));
  const spyNames = spies.map((p) => p.name);
  const innocents = room.players.filter((p) => !r.spyIds.includes(p.id));
  const deltas = {};
  const add = (p, n) => { deltas[p.name] = (deltas[p.name] || 0) + n; room.scores[p.id] = (room.scores[p.id] || 0) + n; };
  let winners;
  if (outcome === "spy_guessed_right") { winners = "spy"; spies.forEach((p) => add(p, 2)); }
  else if (outcome === "spy_guessed_wrong") { winners = "innocents"; innocents.forEach((p) => add(p, 1)); }
  else if (outcome === "spy_caught") {
    winners = "innocents";
    innocents.forEach((p) => add(p, 1));
    const acc = room.players.find((p) => p.id === (info && info.accuserId));
    if (acc && !r.spyIds.includes(acc.id)) add(acc, 1); // bonus à l'accusateur juste (par id, pas par nom)
  } else if (outcome === "wrong_accusation") { winners = "spy"; spies.forEach((p) => add(p, 2)); }
  else { outcome = "timeout"; winners = "spy"; spies.forEach((p) => add(p, 2)); }

  room.lastReveal = { location: r.locationName, spies: spyNames, outcome, winners, deltas, info: info || {} };
  room.history.unshift({ roundNo: room.roundNo, location: r.locationName, spies: spyNames, outcome, winners });
  if (room.history.length > 20) room.history.pop();
  room.status = "reveal";
  touch(room);
}

function endRound(room, player) {
  if (!player.isHost) throw httpError(403, "Seul l'hôte peut terminer la manche.");
  if (room.status !== "playing") throw httpError(400, "Aucune manche en cours.");
  resolveRound(room, "timeout");
}

function backToLobby(room, player) {
  if (!player.isHost) throw httpError(403, "Seul l'hôte peut revenir au salon.");
  room.status = "lobby";
  room.round = null;
  room.lastReveal = null;
  touch(room);
}

function resetScores(room, player) {
  if (!player.isHost) throw httpError(403, "Seul l'hôte peut réinitialiser les scores.");
  for (const id of Object.keys(room.scores)) room.scores[id] = 0;
  room.history = [];
  touch(room);
}

function stateFor(room, playerId) {
  const player = getPlayer(room, playerId);
  player.lastSeen = nowMs();
  reassignHostIfNeeded(room);
  maybeExpireRound(room);

  const scoreboard = room.players
    .map((p) => ({ name: p.name, isHost: p.isHost, score: room.scores[p.id] || 0, you: p.id === playerId, presence: presenceOf(p) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  const state = {
    code: room.code,
    status: room.status,
    durationMin: room.durationMin,
    deck: room.deck,
    spyMode: room.spyMode,
    decks: deckMeta(),
    roundNo: room.roundNo,
    you: { id: player.id, name: player.name, isHost: player.isHost },
    activeGames: activeGamesCount(),
    players: room.players.map((p) => ({ name: p.name, isHost: p.isHost, presence: presenceOf(p) })),
    scores: scoreboard,
    history: room.history,
  };

  if (room.status === "playing") {
    const r = room.round;
    state.card = r.cards[player.id];
    state.remainingMs = Math.max(0, r.startedAt + r.durationMs - nowMs());
    state.timeUp = state.remainingMs <= 0;
    state.locations = r.poolNames;
    state.firstPlayer = r.firstPlayerName;
    state.youAreSpy = r.spyIds.includes(player.id);
    state.spyCount = r.spyIds.length;
    if (!state.youAreSpy) state.locationRoles = r.locationRoles; // aide aux questions
    if (r.accusation) {
      const acc = r.accusation;
      const voters = room.players.filter((p) => p.id !== acc.suspectId);
      state.accusation = {
        id: acc.id,
        accuser: acc.accuserName,
        suspect: acc.suspectName,
        youAreSuspect: player.id === acc.suspectId,
        youVoted: player.id in acc.votes,
        votedCount: voters.filter((p) => p.id in acc.votes).length,
        votersCount: voters.length,
        canVote: player.id !== acc.suspectId && !(player.id in acc.votes),
      };
    }
    state.canAccuse = !r.accusation && !r.spentAccusers.includes(player.id);
  }
  if (room.status === "reveal") state.reveal = room.lastReveal;
  return state;
}

// ---------------------------------------------------------------------------
// Plomberie HTTP.
// ---------------------------------------------------------------------------
function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};
function sendJSON(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...SECURITY_HEADERS });
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers["content-length"] || 0) > 10_000) { reject(httpError(413, "Requête trop grosse.")); return; }
    const chunks = [];
    let size = 0;
    let done = false;
    req.on("data", (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > 10_000) { done = true; reject(httpError(413, "Requête trop grosse.")); return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (done) return;
      done = true;
      const data = Buffer.concat(chunks).toString("utf8");
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(httpError(400, "JSON invalide.")); }
    });
    req.on("error", (e) => { if (!done) { done = true; reject(e); } });
  });
}

// Limitation de débit (en mémoire) des ÉCHECS d'authentification, par IP —
// couvre /api/access ET la vérification du mot de passe sur toutes les routes.
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const accessAttempts = new Map();
function clientIp(req) {
  if (TRUST_PROXY) {
    const xff = req.headers["x-forwarded-for"];
    if (xff) return String(xff).split(",").pop().trim(); // l'IP ajoutée par le proxy de confiance
  }
  return req.socket.remoteAddress || "?";
}
function authBlocked(req) {
  const e = accessAttempts.get(clientIp(req));
  return !!(e && nowMs() <= e.resetAt && e.count > 10);
}
// Borne mémoire : on évince d'abord les entrées EXPIRÉES (préserve les blocages
// actifs) ; on ne vide tout qu'en dernier recours si la map déborde encore.
function pruneExpired(map, t) {
  for (const [k, e] of map) if (t > e.resetAt) map.delete(k);
}
function capMap(map, t) {
  if (map.size > 5000) { pruneExpired(map, t); if (map.size > 5000) map.clear(); }
}
function recordAuthFail(req) {
  const ip = clientIp(req);
  const t = nowMs();
  let e = accessAttempts.get(ip);
  if (!e || t > e.resetAt) {
    capMap(accessAttempts, t);
    e = { count: 0, resetAt: t + 5 * 60 * 1000 };
    accessAttempts.set(ip, e);
  }
  e.count += 1;
}
function resetAuthFails(req) { accessAttempts.delete(clientIp(req)); } // après une auth réussie

// Limitation des actions coûteuses (création de salle, écriture éditeur) par IP.
// Le test (actionOverLimit) est séparé de la comptabilisation (recordAction) :
// on ne consomme un jeton qu'après une action RÉUSSIE, jamais sur un échec de
// validation (sinon un hôte qui tâtonne son prénom se prend un faux 429).
const actionAttempts = new Map();
function actionOverLimit(req, kind, max) {
  const e = actionAttempts.get(clientIp(req) + "|" + kind);
  return !!(e && nowMs() <= e.resetAt && e.count >= max);
}
function recordAction(req, kind, windowMs) {
  const key = clientIp(req) + "|" + kind;
  const t = nowMs();
  let e = actionAttempts.get(key);
  if (!e || t > e.resetAt) {
    capMap(actionAttempts, t);
    e = { count: 0, resetAt: t + windowMs };
    actionAttempts.set(key, e);
  }
  e.count += 1;
}
setInterval(() => {
  const t = nowMs();
  pruneExpired(accessAttempts, t);
  pruneExpired(actionAttempts, t);
}, 60 * 1000).unref();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    // Statiques (depuis le cache mémoire).
    if (req.method === "GET" && STATIC_CACHE[url.pathname]) {
      const { buf, type } = STATIC_CACHE[url.pathname];
      res.writeHead(200, { "Content-Type": type, ...SECURITY_HEADERS });
      res.end(buf);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/config") {
      return sendJSON(res, 200, { gate: GATE_ON });
    }
    if (req.method === "POST" && url.pathname === "/api/access") {
      const body = await readBody(req);
      if (passOk(body.password)) { resetAuthFails(req); return sendJSON(res, 200, { ok: true }); }
      recordAuthFail(req);
      throw httpError(authBlocked(req) ? 429 : 401, authBlocked(req) ? "Trop de tentatives. Réessayez dans quelques minutes." : "Mot de passe incorrect.");
    }

    // À partir d'ici, tout exige le mot de passe du portail (avec rate-limit des échecs).
    if (url.pathname.startsWith("/api/") && !passOk(req.headers["x-spyfall-pass"])) {
      recordAuthFail(req);
      throw httpError(authBlocked(req) ? 429 : 401, authBlocked(req) ? "Trop de tentatives. Réessayez dans quelques minutes." : "Mot de passe requis.");
    }

    if (req.method === "GET" && url.pathname === "/api/decks") {
      return sendJSON(res, 200, { decks: deckMeta() });
    }
    if (req.method === "GET" && url.pathname === "/api/suggestions") {
      return sendJSON(res, 200, { suggestions: SUGGESTIONS });
    }

    // Éditeur de lieux & rôles.
    if (url.pathname === "/api/locations") {
      if (req.method === "GET") return sendJSON(res, 200, locationsPayload());
      if (req.method === "POST") {
        if (actionOverLimit(req, "edit", 60)) throw httpError(429, "Trop de modifications d'un coup, ralentis un peu.");
        applyEdit(await readBody(req));
        saveEditable();
        recordAction(req, "edit", 60 * 1000); // seulement après une édition valide
        return sendJSON(res, 200, locationsPayload());
      }
      throw httpError(405, "Méthode non autorisée.");
    }

    // API des salles.
    const match = url.pathname.match(/^\/api\/rooms(?:\/([A-Za-z0-9]{3,8})(?:\/(join|start|end|lobby|state|leave|guess|accuse|vote|scores))?)?$/);
    if (!match) throw httpError(404, "Page introuvable.");
    const [, code, action] = match;

    if (req.method === "POST" && !code) {
      if (actionOverLimit(req, "create", 20)) throw httpError(429, "Trop de salles créées récemment, réessayez dans quelques minutes.");
      const body = await readBody(req);
      const { room, player } = createRoom(body.name, body.deck, body.spyMode);
      recordAction(req, "create", 5 * 60 * 1000); // seulement après une création réussie
      return sendJSON(res, 201, { code: room.code, playerId: player.id });
    }
    if (req.method === "POST" && action === "join") {
      const body = await readBody(req);
      const player = addPlayer(getRoom(code), body.name, false);
      return sendJSON(res, 200, { code: code.toUpperCase(), playerId: player.id });
    }
    if (req.method === "POST" && action) {
      const body = await readBody(req);
      const room = getRoom(code);
      if (action === "leave") { leaveRoom(room, body.playerId); return sendJSON(res, 200, { ok: true }); }
      const player = getPlayer(room, body.playerId);
      switch (action) {
        case "start": startRound(room, player, body); break;
        case "end": endRound(room, player); break;
        case "lobby": backToLobby(room, player); break;
        case "scores": resetScores(room, player); break;
        case "guess": spyGuess(room, player, body.location); break;
        case "accuse": accuse(room, player, body.suspect); break;
        case "vote": castVote(room, player, body.agree); break;
        default: throw httpError(404, "Action inconnue.");
      }
      return sendJSON(res, 200, stateFor(room, player.id));
    }
    if (req.method === "GET" && action === "state") {
      const room = getRoom(code);
      touch(room);
      return sendJSON(res, 200, stateFor(room, url.searchParams.get("playerId")));
    }
    throw httpError(404, "Page introuvable.");
  } catch (e) {
    if (e && e.status) sendJSON(res, e.status, { error: e.message });
    else { console.error("Erreur serveur :", e); sendJSON(res, 500, { error: "Erreur serveur." }); }
  }
});

// Derrière un proxy (TRUST_PROXY=1, ex. Caddy) on n'écoute QUE sur la loopback :
// Node n'est jamais joignable directement, donc X-Forwarded-For est fiable et le
// rate-limit ne peut être ni contourné ni globalisé. En local, on écoute partout
// (jeu en LAN). Surchargeable via HOST.
const HOST = process.env.HOST || (TRUST_PROXY ? "127.0.0.1" : "0.0.0.0");
server.listen(PORT, HOST, () => {
  console.log(`Hexa (Spyfall FR) prêt sur http://localhost:${PORT} (hôte ${HOST})`);
});
