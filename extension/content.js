/**
 * Overlay posé sur le lecteur Twitch.
 *
 * L'overlay est injecté *dans* le conteneur du lecteur, pas dans <body> : c'est
 * ce qui lui permet de suivre le passage en plein écran et en mode théâtre sans
 * traitement particulier. Twitch étant une SPA qui reconstruit son lecteur à
 * chaque changement de chaîne, on vérifie périodiquement que l'overlay est
 * toujours rattaché au bon endroit.
 */

(() => {
  if (window.__hexaInjected) return;
  window.__hexaInjected = true;

  const HOST_SELECTORS = [
    ".persistent-player",
    '[data-a-target="video-player"]',
    ".video-player__container",
    '[data-test-selector="video-player__video-container"]',
  ];

  let root = null;
  let stage = null;
  let statusEl = null;
  let settings = { showOriginal: false, fontSize: 28, keepSeconds: 7, maxLines: 2 };
  const lines = new Map(); // id de segment -> { el, body, caret, text, timer }
  let watchdog = null;

  function findHost() {
    if (document.fullscreenElement) return document.fullscreenElement;
    for (const selector of HOST_SELECTORS) {
      const found = document.querySelector(selector);
      if (found) return found;
    }
    const video = document.querySelector("video");
    return video?.parentElement || document.body;
  }

  function build() {
    root = document.createElement("div");
    root.className = "hexa-root";

    statusEl = document.createElement("div");
    statusEl.className = "hexa-status";

    stage = document.createElement("div");
    stage.className = "hexa-stage";

    root.append(statusEl, stage);
    applySettings();
    return root;
  }

  function applySettings() {
    if (!root) return;
    root.style.setProperty("--hexa-size", `${settings.fontSize}px`);
  }

  function attach() {
    const host = findHost();
    if (!host) return;
    // Le conteneur du lecteur Twitch est déjà positionné, mais pas <body> ni un
    // élément passé en plein écran : on s'en assure pour que le positionnement
    // absolu de l'overlay reste relatif au lecteur.
    if (getComputedStyle(host).position === "static") {
      host.style.position = "relative";
    }
    if (root.parentElement !== host) host.append(root);
  }

  function setStatus(text, ok) {
    statusEl.textContent = text;
    statusEl.classList.toggle("hexa-status--ok", !!ok);
    statusEl.classList.remove("hexa-hidden");
    clearTimeout(setStatus.timer);
    if (ok) {
      setStatus.timer = setTimeout(() => statusEl.classList.add("hexa-hidden"), 2500);
    }
  }

  function trimLines() {
    while (stage.children.length > settings.maxLines) {
      const first = stage.firstElementChild;
      for (const [id, entry] of lines) {
        if (entry.el === first) {
          clearTimeout(entry.timer);
          lines.delete(id);
        }
      }
      first.remove();
    }
    const all = [...stage.children];
    all.forEach((el, i) => el.classList.toggle("hexa-line--stale", i !== all.length - 1));
  }

  function ensureLine(id) {
    let entry = lines.get(id);
    if (entry) return entry;

    const el = document.createElement("div");
    el.className = "hexa-line";
    const body = document.createElement("span");
    const caret = document.createElement("i");
    caret.className = "hexa-caret";
    el.append(body, caret);
    stage.append(el);

    entry = { el, body, caret, text: "" };
    lines.set(id, entry);
    trimLines();
    return entry;
  }

  function dropLine(id) {
    const entry = lines.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.el.remove();
    lines.delete(id);
  }

  function expire(id) {
    const entry = lines.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.el.classList.add("hexa-line--leaving");
      setTimeout(() => dropLine(id), 500);
    }, settings.keepSeconds * 1000);
  }

  function onSegment(msg) {
    if (msg.state === "transcribed") {
      const entry = ensureLine(msg.id);
      if (!entry.text) entry.body.textContent = "…";
      return;
    }

    if (msg.state === "delta") {
      const entry = ensureLine(msg.id);
      entry.text += msg.delta;
      entry.body.textContent = entry.text;
      return;
    }

    if (msg.state === "done") {
      const entry = ensureLine(msg.id);
      entry.caret.remove();
      entry.body.textContent = msg.translation;
      if (settings.showOriginal && msg.original && msg.original !== msg.translation) {
        const src = document.createElement("span");
        src.className = "hexa-src";
        src.textContent = msg.original;
        entry.el.append(src);
      }
      expire(msg.id);
      return;
    }

    if (msg.state === "dropped") dropLine(msg.id);
  }

  function show(next) {
    settings = { ...settings, ...next };
    if (!root) build();
    applySettings();
    attach();
    setStatus("Hexa : en attente du serveur…", false);

    document.addEventListener("fullscreenchange", attach);
    clearInterval(watchdog);
    // Twitch reconstruit son lecteur en changeant de chaîne ou de mode :
    // on se réaccroche tout seul au lieu d'attendre un rechargement.
    watchdog = setInterval(attach, 1500);
  }

  function hide() {
    clearInterval(watchdog);
    watchdog = null;
    document.removeEventListener("fullscreenchange", attach);
    for (const id of [...lines.keys()]) dropLine(id);
    root?.remove();
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "hexa:show") {
      show(message.settings);
    } else if (message?.type === "hexa:hide") {
      hide();
    } else if (message?.type === "hexa:status") {
      if (!root) return;
      setStatus(
        message.state === "connected"
          ? "Hexa : connecté"
          : "Hexa : serveur injoignable, reconnexion…",
        message.state === "connected"
      );
    } else if (message?.type === "hexa:subtitle" && root) {
      const payload = message.payload;
      if (payload.type === "ready") {
        setStatus(`Hexa : ${payload.source_lang} → ${payload.target_lang}`, true);
      } else if (payload.type === "segment") {
        onSegment(payload);
      } else if (payload.type === "error") {
        setStatus(`Hexa : ${payload.message}`, false);
      }
    }
  });
})();
