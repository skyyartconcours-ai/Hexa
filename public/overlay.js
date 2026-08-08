(() => {
  const card = document.getElementById('card');
  const userEl = document.getElementById('user');
  const textEl = document.getElementById('text');
  const badgeEl = document.getElementById('badge');
  const statusEl = document.getElementById('status');
  const unlockBtn = document.getElementById('unlock');

  const BADGES = {
    sub: 'nouveau sub',
    resub: 'resub',
    gift: 'sub gifter',
    gift_recipient: 'sub offert',
  };

  /** Le temps d'affichage quand il n'y a pas d'audio (mode texte seul). */
  const TEXT_ONLY_MS = 7000;
  /** Marge apres la fin de l'audio avant de retirer la carte. */
  const OUTRO_MS = 900;

  let socket = null;
  let audioUnlocked = false;
  let current = null;

  function setStatus(message, transient = false) {
    statusEl.textContent = message;
    statusEl.classList.remove('is-hidden');
    if (transient) setTimeout(() => statusEl.classList.add('is-hidden'), 2500);
  }

  function connect() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    socket = new WebSocket(`${protocol}://${location.host}/ws`);

    socket.addEventListener('open', () => setStatus('hexa connecté', true));
    socket.addEventListener('close', () => {
      setStatus('déconnecté — nouvelle tentative…');
      setTimeout(connect, 2000);
    });
    socket.addEventListener('message', (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (payload.type === 'play') play(payload);
    });
  }

  function done(id) {
    if (!current || current.id !== id) return;
    current = null;
    card.classList.remove('is-visible');
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'ended', id }));
    }
  }

  function play(payload) {
    current = payload;

    badgeEl.textContent = BADGES[payload.eventType] ?? 'sub';
    userEl.textContent = payload.user;
    textEl.textContent = payload.text;
    card.classList.add('is-visible');

    if (!payload.audioUrl) {
      setTimeout(() => done(payload.id), TEXT_ONLY_MS);
      return;
    }

    const audio = new Audio(payload.audioUrl);
    audio.addEventListener('ended', () => setTimeout(() => done(payload.id), OUTRO_MS));
    audio.addEventListener('error', () => {
      setStatus('audio illisible', true);
      setTimeout(() => done(payload.id), 1500);
    });

    audio
      .play()
      .then(() => {
        audioUnlocked = true;
        unlockBtn.hidden = true;
      })
      .catch(() => {
        // Un navigateur classique bloque l'autoplay tant qu'il n'y a pas eu de
        // clic. OBS ne passe jamais ici.
        if (!audioUnlocked) unlockBtn.hidden = false;
        setStatus('son bloqué par le navigateur');
        setTimeout(() => done(payload.id), TEXT_ONLY_MS);
      });
  }

  unlockBtn.addEventListener('click', () => {
    // Une lecture silencieuse suffit a debloquer l'autoplay pour la suite.
    const silence = new Audio(
      'data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQxAADB8AhSmxhIIEVCSiJrDCQBTcu3UrAIwUdkRgQbFAZC1CQEwTJ9mjRvBA4UOLD8nKVOWfh+UlK3z/177OXOImcM/ZO+zU2z00DK889EMPGyx/uIiuO+xTQvOXQ==',
    );
    silence.play().finally(() => {
      audioUnlocked = true;
      unlockBtn.hidden = true;
      setStatus('son activé', true);
    });
  });

  connect();
})();
