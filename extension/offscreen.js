/**
 * Capture l'audio de l'onglet Twitch et l'envoie au serveur Hexa.
 *
 * Point important : `tabCapture` coupe le son de l'onglet dès qu'on récupère le
 * flux. Pour que tu continues à entendre le stream, il faut le renvoyer
 * explicitement vers les haut-parleurs. On utilise donc deux contextes audio :
 *
 *   - lecture  : fréquence native, branché sur la sortie -> tu entends le stream
 *   - capture  : forcé à 16 kHz, branché sur le worklet  -> PCM pour le serveur
 *
 * Deux contextes plutôt qu'un seul rééchantillonné, sinon la lecture sortirait
 * elle aussi à 16 kHz et le stream sonnerait comme un téléphone.
 */

let playbackCtx = null;
let captureCtx = null;
let workletNode = null;
let stream = null;
let socket = null;
let settings = null;
let reconnectTimer = null;
let reconnectDelay = 500;
let stopping = false;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "offscreen") return undefined;

  if (message.type === "start") {
    start(message)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true; // réponse asynchrone
  }

  if (message.type === "stop") {
    stop();
    sendResponse({ ok: true });
    return undefined;
  }

  return undefined;
});

function report(type, payload) {
  chrome.runtime.sendMessage({ target: "background", type, ...payload }).catch(() => {});
}

async function start({ streamId, config }) {
  stop();
  stopping = false;
  settings = config;

  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    },
  });

  // Si l'onglet se ferme ou change de page, la piste s'arrête : on remonte
  // l'information pour que l'UI ne reste pas bloquée sur "en cours".
  stream.getAudioTracks().forEach((track) => {
    track.addEventListener("ended", () => {
      if (!stopping) {
        stop();
        report("capture-ended", {});
      }
    });
  });

  // 1) Remettre le son dans les haut-parleurs.
  playbackCtx = new AudioContext();
  playbackCtx.createMediaStreamSource(stream).connect(playbackCtx.destination);

  // 2) Dériver une copie à 16 kHz pour le serveur.
  captureCtx = new AudioContext({ sampleRate: 16000 });
  await captureCtx.audioWorklet.addModule(chrome.runtime.getURL("pcm-worklet.js"));

  workletNode = new AudioWorkletNode(captureCtx, "pcm-worklet");
  workletNode.port.onmessage = (event) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(event.data);
    }
  };

  captureCtx.createMediaStreamSource(stream).connect(workletNode);

  // Un nœud de sortie muet garantit que le graphe est bien « tiré » par le
  // moteur audio, quelle que soit la version de Chrome.
  const muted = captureCtx.createGain();
  muted.gain.value = 0;
  workletNode.connect(muted).connect(captureCtx.destination);

  connect();
}

function connect() {
  if (stopping) return;

  socket = new WebSocket(settings.serverUrl);

  socket.addEventListener("open", () => {
    reconnectDelay = 500;
    socket.send(
      JSON.stringify({
        type: "hello",
        role: "producer",
        source_lang: settings.sourceLang,
        target_lang: settings.targetLang,
      })
    );
    report("status", { state: "connected" });
  });

  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    try {
      report("subtitle", { payload: JSON.parse(event.data) });
    } catch {
      /* message illisible : on l'ignore */
    }
  });

  socket.addEventListener("close", () => {
    if (stopping) return;
    report("status", { state: "reconnecting" });
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 8000);
  });

  socket.addEventListener("error", () => socket.close());
}

function stop() {
  stopping = true;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;

  if (socket) {
    if (socket.readyState === WebSocket.OPEN) {
      // Laisse le serveur transcrire la fin de phrase au lieu de la jeter.
      try {
        socket.send(JSON.stringify({ type: "flush" }));
      } catch {
        /* socket déjà morte */
      }
    }
    socket.close();
    socket = null;
  }

  if (workletNode) {
    workletNode.port.onmessage = null;
    workletNode.disconnect();
    workletNode = null;
  }
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  for (const ctx of [captureCtx, playbackCtx]) {
    if (ctx && ctx.state !== "closed") ctx.close();
  }
  captureCtx = null;
  playbackCtx = null;
}
