(() => {
  const card = document.getElementById('card');
  const userEl = document.getElementById('user');
  const textEl = document.getElementById('text');
  const badgeEl = document.getElementById('badge');
  const statusEl = document.getElementById('status');
  const bannerEl = document.getElementById('banner');
  const unlockBtn = document.getElementById('unlock');

  const BADGES = {
    sub: 'nouveau sub',
    resub: 'resub',
    gift: 'sub gifter',
    gift_recipient: 'sub offert',
    cheer: 'bits',
    donation: 'don',
  };

  /** Le temps d'affichage quand il n'y a pas d'audio (mode texte seul). */
  const TEXT_ONLY_MS = 7000;
  /** Marge apres la fin de l'audio avant de retirer la carte. */
  const OUTRO_MS = 900;

  let socket = null;
  let audioUnlocked = false;
  let current = null;
  let currentAudio = null;

  function setStatus(message, transient = false) {
    statusEl.textContent = message;
    statusEl.classList.remove('is-hidden');
    if (transient) setTimeout(() => statusEl.classList.add('is-hidden'), 2500);
  }

  function connect() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    socket = new WebSocket(`${protocol}://${location.host}/ws`);

    socket.addEventListener('open', () => {
      // On s'identifie : seuls les overlays ont le droit de déclarer une vanne
      // terminée, sinon un onglet de régie ouvert coupe l'audio d'OBS.
      socket.send(JSON.stringify({ type: 'hello_overlay' }));
      setStatus('hexa connecté', true);
    });
    socket.addEventListener('close', () => {
      // Sans serveur plus rien ne sera roasté : le bandeau ne doit pas continuer
      // à le promettre à l'antenne. Le prochain 'state' le rallume si besoin.
      bannerEl.classList.remove('is-visible');
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
      // Coupure demandée depuis la régie : on arrête net.
      if (payload.type === 'cut') cut();
      // Le bandeau suit l'état réel de la session, pas une horloge locale :
      // si la régie coupe avant la fin du minuteur, il disparaît aussi.
      if (payload.type === 'state' && payload.session) {
        bannerEl.classList.toggle('is-visible', Boolean(payload.session.active));
      }
    });
  }

  /**
   * Arrête l'audio en cours sans déclencher son handler 'error' : `src = ''`
   * lève un MEDIA_ERR_SRC_NOT_SUPPORTED, qui affichait « audio illisible » à
   * l'antenne après chaque coupure.
   */
  function stopAudio() {
    const audio = currentAudio;
    currentAudio = null;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }

  function cut() {
    stopAudio();
    current = null;
    card.classList.remove('is-visible');
    setStatus('coupé', true);
  }

  function done(id, failed = false) {
    if (!current || current.id !== id) return;
    current = null;
    currentAudio = null;
    card.classList.remove('is-visible');
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'ended', id, failed }));
    }
  }

  function play(payload) {
    // Deux vannes ne doivent jamais se superposer : si l'une tourne encore
    // (double overlay, 'ended' prématuré), on la coupe avant de démarrer.
    stopAudio();
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
    currentAudio = audio;
    // Les événements d'un audio qu'on a déjà coupé (cut, vanne suivante) ne
    // concernent plus l'antenne.
    const isCurrent = () => currentAudio === audio;
    audio.addEventListener('ended', () => setTimeout(() => done(payload.id), OUTRO_MS));
    audio.addEventListener('error', () => {
      if (!isCurrent()) return;
      setStatus('audio illisible', true);
      // Signale l'echec : sinon la regie affichait « passee » pour une vanne muette.
      setTimeout(() => done(payload.id, true), 1500);
    });

    audio
      .play()
      .then(() => {
        audioUnlocked = true;
        unlockBtn.hidden = true;
      })
      .catch((error) => {
        if (!isCurrent()) return; // AbortError d'une coupure : rien à signaler
        // Seul un vrai refus d'autoplay justifie le bouton : il recouvre toute
        // la scène OBS, et personne ne peut cliquer dessus en direct. Un fichier
        // illisible (NotSupportedError) est déjà traité par l'événement 'error'.
        if (!error || error.name !== 'NotAllowedError') return;
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
