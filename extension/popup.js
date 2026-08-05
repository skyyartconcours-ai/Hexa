const DEFAULTS = {
  serverUrl: "ws://127.0.0.1:8765",
  sourceLang: "it",
  targetLang: "fr",
  showOriginal: false,
  fontSize: 28,
  keepSeconds: 7,
  maxLines: 2,
};

const fields = {
  serverUrl: document.getElementById("serverUrl"),
  sourceLang: document.getElementById("sourceLang"),
  targetLang: document.getElementById("targetLang"),
  showOriginal: document.getElementById("showOriginal"),
  fontSize: document.getElementById("fontSize"),
  keepSeconds: document.getElementById("keepSeconds"),
};

const toggle = document.getElementById("toggle");
const msg = document.getElementById("msg");
let running = false;

function readForm() {
  return {
    ...DEFAULTS,
    serverUrl: fields.serverUrl.value.trim() || DEFAULTS.serverUrl,
    sourceLang: fields.sourceLang.value,
    targetLang: fields.targetLang.value,
    showOriginal: fields.showOriginal.checked,
    fontSize: Number(fields.fontSize.value) || DEFAULTS.fontSize,
    keepSeconds: Number(fields.keepSeconds.value) || DEFAULTS.keepSeconds,
  };
}

function fillForm(settings) {
  fields.serverUrl.value = settings.serverUrl;
  fields.sourceLang.value = settings.sourceLang;
  fields.targetLang.value = settings.targetLang;
  fields.showOriginal.checked = settings.showOriginal;
  fields.fontSize.value = settings.fontSize;
  fields.keepSeconds.value = settings.keepSeconds;
}

function setInfo(text, isError = false, command = null) {
  msg.replaceChildren(document.createTextNode(text));
  if (command) {
    const code = document.createElement("code");
    code.textContent = command;
    msg.append(code);
  }
  msg.classList.toggle("err", isError);
}

function render() {
  toggle.textContent = running ? "Arrêter" : "Démarrer";
  toggle.classList.toggle("stop", running);
  for (const field of Object.values(fields)) field.disabled = running;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function save() {
  await chrome.storage.local.set({ settings: readForm() });
}

for (const field of Object.values(fields)) {
  field.addEventListener("change", save);
}

toggle.addEventListener("click", async () => {
  toggle.disabled = true;
  try {
    if (running) {
      await chrome.runtime.sendMessage({ type: "hexa:stop" });
      running = false;
      setInfo("Arrêté.");
    } else {
      const tab = await activeTab();
      if (!tab?.url?.includes("twitch.tv")) {
        setInfo("Ouvre d'abord un live sur twitch.tv, puis relance.", true);
        return;
      }
      await save();
      const response = await chrome.runtime.sendMessage({ type: "hexa:start", tabId: tab.id });
      if (response?.ok) {
        running = true;
        setInfo("En cours. Les sous-titres apparaissent sur le lecteur.");
      } else {
        setInfo(
          `Échec : ${response?.error || "erreur inconnue"}. Vérifie que le serveur tourne :`,
          true,
          "cd server && python -m hexa"
        );
      }
    }
  } finally {
    toggle.disabled = false;
    render();
  }
});

(async () => {
  const stored = await chrome.storage.local.get("settings");
  fillForm({ ...DEFAULTS, ...(stored.settings || {}) });

  const state = await chrome.runtime.sendMessage({ type: "hexa:state" });
  running = !!state?.running;
  if (running) setInfo("En cours.");
  render();
})();
