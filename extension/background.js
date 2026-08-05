/**
 * Service worker : orchestre la capture et relaie les sous-titres.
 *
 * Il ne touche jamais à l'audio lui-même — Chrome peut le mettre en veille à
 * tout moment, ce qui couperait la capture. Le travail se fait dans le document
 * offscreen, qui, lui, reste vivant.
 */

const DEFAULTS = {
  serverUrl: "ws://127.0.0.1:8765",
  sourceLang: "it",
  targetLang: "fr",
  showOriginal: false,
  fontSize: 28,
  keepSeconds: 7,
  maxLines: 2,
};

let active = null; // { tabId }

async function getSettings() {
  const stored = await chrome.storage.local.get("settings");
  return { ...DEFAULTS, ...(stored.settings || {}) };
}

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA"],
    justification: "Capturer l'audio de l'onglet Twitch pour le sous-titrer.",
  });
}

/**
 * `createDocument` rend la main dès que le document existe, pas quand son script
 * a fini de s'exécuter : le premier message peut arriver avant que le listener
 * soit posé. On réessaie brièvement plutôt que d'échouer sur cette course.
 */
async function sendToOffscreen(message, attempts = 12) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await chrome.runtime.sendMessage({ target: "offscreen", ...message });
    } catch (error) {
      if (i === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  return undefined;
}

async function sendToTab(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // L'extension vient d'être rechargée : l'onglet n'a plus de content script.
    // On le réinjecte au lieu de demander à l'utilisateur de recharger la page.
    try {
      await chrome.scripting.insertCSS({ target: { tabId }, files: ["content.css"] });
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
      await chrome.tabs.sendMessage(tabId, message);
    } catch {
      /* l'onglet a disparu */
    }
  }
}

async function start(tabId) {
  const settings = await getSettings();
  await ensureOffscreen();

  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  const response = await sendToOffscreen({ type: "start", streamId, config: settings });

  if (!response?.ok) {
    throw new Error(response?.error || "la capture audio a échoué");
  }

  active = { tabId };
  await chrome.action.setBadgeText({ text: "ON" });
  await chrome.action.setBadgeBackgroundColor({ color: "#3fb950" });
  await sendToTab(tabId, { type: "hexa:show", settings });
  return settings;
}

async function stop() {
  if (await hasOffscreen()) {
    await sendToOffscreen({ type: "stop" }, 1).catch(() => {});
    await chrome.offscreen.closeDocument().catch(() => {});
  }
  if (active) {
    await sendToTab(active.tabId, { type: "hexa:hide" });
    active = null;
  }
  await chrome.action.setBadgeText({ text: "" });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "hexa:start") {
    start(message.tabId)
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch(async (error) => {
        await stop();
        sendResponse({ ok: false, error: String(error?.message || error) });
      });
    return true;
  }

  if (message?.type === "hexa:stop") {
    stop().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === "hexa:state") {
    sendResponse({ ok: true, running: active !== null, tabId: active?.tabId ?? null });
    return undefined;
  }

  if (message?.target !== "background") return undefined;

  // Messages remontés par le document offscreen.
  if (message.type === "subtitle" && active) {
    sendToTab(active.tabId, { type: "hexa:subtitle", payload: message.payload });
  } else if (message.type === "status" && active) {
    sendToTab(active.tabId, { type: "hexa:status", state: message.state });
  } else if (message.type === "capture-ended") {
    stop();
  }
  return undefined;
});

// Si l'onglet capturé se ferme ou navigue ailleurs, on arrête proprement.
chrome.tabs.onRemoved.addListener((tabId) => {
  if (active?.tabId === tabId) stop();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (active?.tabId === tabId && changeInfo.status === "loading" && changeInfo.url) {
    stop();
  }
});
