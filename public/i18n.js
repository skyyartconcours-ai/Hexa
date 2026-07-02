// Moteur i18n d'Hexa. Langue par TÉLÉPHONE (chaque joueur choisit la sienne via
// le drapeau). Source = FRANÇAIS ; les clés du dictionnaire SONT les chaînes FR
// exactes. En anglais on renvoie la traduction si elle existe, sinon la source FR
// (repli gracieux, ex. contenu ajouté via l'éditeur). Le contenu (lieux/rôles/
// thèmes) vient de HEXA_CONTENT_EN (i18n-content.js).
(function () {
  let LANG = "fr";
  try { LANG = localStorage.getItem("hexa-lang") || "fr"; } catch {}
  if (LANG !== "en" && LANG !== "fr") LANG = "fr";

  // --- Dictionnaire de l'INTERFACE (FR -> EN) -------------------------------
  const UI_EN = {
    // Portail
    "Entrez le mot de passe pour accéder au jeu.": "Enter the password to access the game.",
    "Mot de passe": "Password",
    "Entrer": "Enter",
    "Mot de passe incorrect.": "Wrong password.",
    "Ré-entrez le mot de passe.": "Please re-enter the password.",
    "Trop de tentatives — patientez quelques minutes puis ré-entrez le mot de passe.": "Too many attempts — wait a few minutes, then re-enter the password.",
    // Accueil
    "Les cartes du jeu, en français, sur vos téléphones.": "The party game's cards, right on your phones.",
    "Votre prénom": "Your name",
    "ex. Léa": "e.g. Lea",
    "Mode de jeu (choisi par l'hôte à la création)": "Game mode (chosen by the host when creating)",
    "Créer une partie (vous êtes hôte + joueur)": "Create a game (you're host + player)",
    "OURS": "BEAR",
    "Rejoindre": "Join",
    "▶️ Découvrir en 1 min": "▶️ Learn in 1 min",
    "🎖️ Mon Casier": "🎖️ My Record",
    "✏️ Modifier les lieux & rôles": "✏️ Edit locations & roles",
    "Erreur réseau": "Network error",
    // Salon
    "Salon": "Lobby",
    "Code de la salle — partagez-le autour de la table :": "Room code — share it around the table:",
    "Copier le code": "Copy the code",
    "Partager le lien": "Share the link",
    "🔊 Dis le code à voix haute pour faire venir tout le monde": "🔊 Say the code out loud to get everyone in",
    "QR code pour rejoindre": "QR code to join",
    "📲 Inviter des amis": "📲 Invite friends",
    "Mode de jeu": "Game mode",
    "Nombre d'espions": "Number of spies",
    "Auto (2 dès 7 joueurs)": "Auto (2 from 7 players)",
    "1 espion": "1 spy",
    "2 espions": "2 spies",
    "Durée de la manche (minutes)": "Round length (minutes)",
    "Lancer la manche": "Start the round",
    "Réinitialiser les scores": "Reset scores",
    "En attente que l'hôte lance la manche…": "Waiting for the host to start the round…",
    "En attente que l'hôte lance la manche… (3 joueurs minimum)": "Waiting for the host to start the round… (3 players minimum)",
    "Prêt à lancer !": "Ready to start!",
    "Quitter la partie": "Leave the game",
    "lieux": "locations",
    "🏆 Classement": "🏆 Standings",
    "(vous)": "(you)",
    // Salon — chaînes dynamiques
    "Il manque {n} joueur pour lancer — invite tes potes !": "{n} more player needed to start — invite your friends!",
    "Il manque {n} joueurs pour lancer — invite tes potes !": "{n} more players needed to start — invite your friends!",
    "Il manque {n} joueur pour lancer (minimum 3).": "{n} more player needed to start (minimum 3).",
    "Il manque {n} joueurs pour lancer (minimum 3).": "{n} more players needed to start (minimum 3).",
    "🎲 {n} parties en cours": "🎲 {n} games in progress",
    "Lancer ({n}/3 joueurs)": "Start ({n}/3 players)",
    "{name} a rejoint 👋": "{name} joined 👋",
    "{names} ont rejoint 👋": "{names} joined 👋",
    // Manche en cours
    "👆 Touchez pour voir votre carte": "👆 Tap to see your card",
    "(ne la montrez à personne)": "(don't show it to anyone)",
    "🎯 Je suis l'espion — deviner le lieu": "🎯 I'm the spy — guess the location",
    "🙋 Accuser un joueur d'être l'espion": "🙋 Accuse a player of being the spy",
    "❌ Éliminer les lieux impossibles — touchez un lieu (ou un thème entier) pour le rayer": "❌ Cross off impossible locations — tap a location (or a whole theme) to strike it out",
    "Terminer la manche (révéler)": "End the round (reveal)",
    "Quitter": "Leave",
    "🤫 Vous êtes l'ESPION": "🤫 You're the SPY",
    "Vous ne connaissez pas le lieu. Écoutez, bluffez, et essayez de le deviner !": "You don't know the location. Listen, bluff, and try to guess it!",
    "Vous n'êtes pas seul : il y a {n} espions (vous ne savez pas qui est l'autre). ⚠️ Si vous tentez le lieu et vous trompez, les deux espions perdent.": "You're not alone: there are {n} spies (you don't know who the other is). ⚠️ If you guess the location and get it wrong, both spies lose.",
    "Lieu": "Location",
    "Votre rôle": "Your role",
    "👆 Touchez la carte pour la cacher": "👆 Tap the card to hide it",
    "{n} restants": "{n} left",
    "{n} restant": "{n} left",
    "🎙️ {name} commence et choisit qui interroger.": "🎙️ {name} starts and picks who to question.",
    "⏰ Temps écoulé — en attente de l'hôte…": "⏰ Time's up — waiting for the host…",
    "🎯 {n} lieu encore possible — les lieux rayés sont en bas.": "🎯 {n} location still possible — crossed-off ones are at the bottom.",
    "🎯 {n} lieux encore possibles — les lieux rayés sont en bas.": "🎯 {n} locations still possible — crossed-off ones are at the bottom.",
    "🎯 Rayez les lieux impossibles dans « Éliminer les lieux » : ils passeront en bas ici.": "🎯 Cross off impossible locations under “Cross off locations”: they'll move to the bottom here.",
    // Vote
    "😱 {accuser} vous accuse d'être l'espion !": "😱 {accuser} accuses you of being the spy!",
    "Vote en cours… ({a}/{b})": "Voting… ({a}/{b})",
    "{accuser} accuse {suspect}. Coupable ?": "{accuser} accuses {suspect}. Guilty?",
    "{accuser} accuse {suspect}.": "{accuser} accuses {suspect}.",
    "Oui, c'est l'espion": "Yes, it's the spy",
    "Non": "No",
    // Révélation
    "Fin de manche": "Round over",
    "Lieu :": "Location:",
    "Espion(s) :": "Spy/Spies:",
    "Révéler votre carte secrète": "Reveal your secret card",
    "🎯 L'espion {name} a deviné le lieu ({guess}) — les espions gagnent !": "🎯 Spy {name} guessed the location ({guess}) — the spies win!",
    "❌ L'espion {name} a tenté « {guess} » — raté ! Les innocents gagnent.": "❌ Spy {name} guessed “{guess}” — wrong! The innocents win.",
    "🕵️ {name} était bien un espion — démasqué ! Les innocents gagnent.": "🕵️ {name} really was a spy — exposed! The innocents win.",
    "🙅 {name} était innocent — accusation ratée ! Les espions gagnent.": "🙅 {name} was innocent — failed accusation! The spies win.",
    "⏰ Temps écoulé — l'espion a survécu ! Les espions gagnent.": "⏰ Time's up — the spy survived! The spies win.",
    "(parti)": "(left)",
    "🔥 {n} manche jouée ce soir !": "🔥 {n} round played tonight!",
    "🔥 {n} manches jouées ce soir !": "🔥 {n} rounds played tonight!",
    "🔄 Revanche": "🔄 Rematch",
    "📲 Inviter (un siège s'est libéré)": "📲 Invite (a seat opened up)",
    "Changer les réglages": "Change settings",
    // Quitter
    "Quitter la partie ?": "Leave the game?",
    // Partage
    "Rejoins ma partie d'Hexa 🕵️ — salle {code}\n{url}": "Join my Hexa game 🕵️ — room {code}\n{url}",
    "Hexa — partie en cours": "Hexa — game in progress",
    "Rejoins ma partie d'Hexa 🕵️ (code {code})": "Join my Hexa game 🕵️ (code {code})",
    "Lien copié — colle-le dans ton groupe !": "Link copied — paste it in your group chat!",
    // Éditeur
    "← Retour": "← Back",
    "Lieux & rôles": "Locations & roles",
    "Modifiez les lieux et les personnages. Les changements s'appliquent à toutes les futures parties.": "Edit locations and characters. Changes apply to all future games.",
    "➕ Ajouter un lieu": "➕ Add a location",
    "Nom du lieu (ex. Sous-marin)": "Location name (e.g. Submarine)",
    "Thème": "Theme",
    "Rôles, séparés par des virgules (optionnel)": "Roles, comma-separated (optional)",
    "Ajouter le lieu": "Add the location",
    "Donnez un nom au lieu.": "Please name the location.",
    "💡 Suggestions des agents": "💡 Agent suggestions",
    "Retirer": "Remove",
    "Ajouter": "Add",
    "Supprimer ce lieu": "Delete this location",
    "Supprimer le lieu {name}": "Delete the location {name}",
    "Supprimer le lieu « {name} » ?": "Delete the location “{name}”?",
    "Retirer ce rôle": "Remove this role",
    "Retirer le rôle {role}": "Remove the role {role}",
    "Rôle(s), séparés par des virgules…": "Role(s), comma-separated…",
    "+ Rôle": "+ Role",
    // Modes de jeu (libellés serveur)
    "Opus 1 + 2": "Opus 1 + 2",
    "Opus 1": "Opus 1",
    "Opus 2": "Opus 2",
    "Fable 🤯 (abusé)": "Fable 🤯 (unhinged)",
    "Délire (RP)": "Wild (RP)",
    "Délire 2 (corsé) 🔞": "Wild 2 (spicy) 🔞",
    "Délire + Délire 2 🔞": "Wild + Wild 2 🔞",
    // Casier
    "Mon Casier": "My Record",
    "Joue une partie pour remplir ton Casier 🎖️": "Play a game to fill your Record 🎖️",
    "📲 Partager mon Casier": "📲 Share my Record",
    "Recrue": "Rookie",
    "Espion fantôme 👻": "Ghost Spy 👻",
    "Espion grillé 🔥": "Busted Spy 🔥",
    "Fin limier 🕵️": "Master Sleuth 🕵️",
    "Pigeon attitré 🐦": "Usual Sucker 🐦",
    "Vétéran d'Hexa": "Hexa Veteran",
    "Apprenti espion": "Spy Apprentice",
    "🎯 5 parties": "🎯 5 games",
    "🏅 20 parties": "🏅 20 games",
    "🕶️ 5 wins espion": "🕶️ 5 spy wins",
    "👑 10 wins espion": "👑 10 spy wins",
    "🏆 10 victoires": "🏆 10 wins",
    "— pas encore de badge —": "— no badge yet —",
    "🕵️ CASIER HEXA": "🕵️ HEXA RECORD",
    "Joueur": "Player",
    "Parties jouées": "Games played",
    "Victoires": "Wins",
    "Manches en espion": "Rounds as spy",
    "Bluffs réussis": "Successful bluffs",
    "Mon Casier Hexa 🕵️ — spy.skyyarttools.fr": "My Hexa Record 🕵️ — spy.skyyarttools.fr",
    // Tutoriel (boutons ; le contenu riche est géré dans app.js)
    "Passer": "Skip",
    "Suivant": "Next",
    "🎮 Créer une partie": "🎮 Create a game",
    // Divers
    "⚠️ Reconnexion…": "⚠️ Reconnecting…",
  };

  function interp(s, vars) {
    return vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
  }
  function t(fr, vars) {
    const s = (LANG === "en" && Object.prototype.hasOwnProperty.call(UI_EN, fr)) ? UI_EN[fr] : fr;
    return interp(s, vars);
  }
  const C = (window.HEXA_CONTENT_EN || { locations: {}, roles: {}, themes: {} });
  function tLoc(name) { return (LANG === "en" && C.locations[name]) || name; }
  function tRole(role) { return (LANG === "en" && C.roles[role]) || role; }
  function tTheme(th) { return (LANG === "en" && C.themes[th]) || th; }
  function lang() { return LANG; }
  function isEn() { return LANG === "en"; }

  // Applique les traductions aux éléments STATIQUES marqués dans le HTML.
  function applyStatic(root) {
    root = root || document;
    root.querySelectorAll("[data-i18n]").forEach((el) => {
      if (el.dataset.i18nFr == null) el.dataset.i18nFr = el.textContent.trim();
      el.textContent = t(el.dataset.i18nFr);
    });
    root.querySelectorAll("[data-i18n-html]").forEach((el) => {
      if (el.dataset.i18nFrHtml == null) el.dataset.i18nFrHtml = el.innerHTML.trim();
      el.innerHTML = t(el.dataset.i18nFrHtml);
    });
    root.querySelectorAll("[data-i18n-ph]").forEach((el) => {
      if (el.dataset.i18nFrPh == null) el.dataset.i18nFrPh = el.getAttribute("placeholder") || "";
      el.setAttribute("placeholder", t(el.dataset.i18nFrPh));
    });
    root.querySelectorAll("[data-i18n-aria]").forEach((el) => {
      if (el.dataset.i18nFrAria == null) el.dataset.i18nFrAria = el.getAttribute("aria-label") || el.getAttribute("title") || "";
      const v = t(el.dataset.i18nFrAria);
      if (el.hasAttribute("aria-label")) el.setAttribute("aria-label", v);
      if (el.hasAttribute("title")) el.setAttribute("title", v);
    });
    document.documentElement.lang = LANG;
  }

  function updateFlags() {
    document.querySelectorAll(".lang-flag").forEach((b) => {
      // Le drapeau montre la langue ACTUELLE (français par défaut). Cliquer bascule.
      b.textContent = LANG === "fr" ? "🇫🇷" : "🇬🇧";
      const label = LANG === "fr" ? "Langue : Français (cliquer pour l'anglais)" : "Language: English (click for French)";
      b.setAttribute("aria-label", label);
      b.title = label;
    });
  }

  function setLang(l) {
    LANG = (l === "en") ? "en" : "fr";
    try { localStorage.setItem("hexa-lang", LANG); } catch {}
    applyStatic(document);
    updateFlags();
    if (typeof window.onLangChange === "function") { try { window.onLangChange(); } catch {} }
  }
  function toggleLang() { setLang(LANG === "en" ? "fr" : "en"); }

  window.i18n = { t, tLoc, tRole, tTheme, lang, isEn, setLang, toggleLang, applyStatic, updateFlags };
  // Raccourcis globaux pour app.js.
  window.t = t; window.tLoc = tLoc; window.tRole = tRole; window.tTheme = tTheme;

  function boot() {
    document.querySelectorAll(".lang-flag").forEach((b) => b.addEventListener("click", toggleLang));
    applyStatic(document);
    updateFlags();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
