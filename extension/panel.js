(() => {
  const EBS = window.EBS_URL;
  const ext = window.Twitch.ext;
  const app = document.getElementById('app');

  const ERRORS = {
    not_open: 'Les inscriptions sont fermées.',
    login_required: 'Connecte-toi à Twitch pour participer.',
    identity_required: 'Il faut accepter de partager ton identité Twitch pour participer (c\'est pour savoir à qui donner le cadeau).',
    account_too_recent: 'Ton compte Twitch est trop récent pour participer.',
    not_candidate: 'Ce n\'est pas (ou plus) à toi de confirmer.',
    too_late: 'Trop tard, le temps pour confirmer est écoulé 😢',
    wrong_channel: 'Extension non configurée pour cette chaîne.',
  };

  let token = null;
  let state = null;
  let context = {};
  let clockOffset = 0;
  let error = '';
  let busy = false;
  let pendingJoin = false;

  // Presence checks: one per window, at a random moment, plus one just before the draw.
  let hbTimer = null;
  let pollTimer = null;
  let lastSentSlot = -1;
  let trackedGiveaway = null;
  let preDrawSentFor = null;

  document.getElementById('app-link').href = `${EBS}/`;
  document.getElementById('rules-link').href = `${EBS}/reglement`;

  const serverNow = () => Date.now() + clockOffset;
  const watching = () => context.isPaused !== true && context.playbackMode !== 'chat-only';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

  function formatDuration(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h) return `${h} h ${String(m).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  async function call(method, path) {
    const res = await fetch(EBS + path, { method, headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'error'), { code: data.error });
    return data;
  }

  function applyState(next) {
    clockOffset = next.serverNow - Date.now();
    const gid = next.giveaway ? next.giveaway.id : null;
    if (gid !== trackedGiveaway) {
      trackedGiveaway = gid;
      lastSentSlot = -1;
    }
    if (next.me && next.me.lastSlot != null) lastSentSlot = Math.max(lastSentSlot, next.me.lastSlot);
    state = next;
    render();
    scheduleHeartbeat();
    schedulePoll();
  }

  async function refresh() {
    if (!token) return;
    try {
      applyState(await call('GET', '/ext/state'));
      error = '';
    } catch (e) {
      error = ERRORS[e.code] || 'Connexion au serveur impossible.';
      render();
      schedulePoll();
    }
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    const claiming = state && state.giveaway && state.giveaway.status === 'claiming';
    pollTimer = setTimeout(refresh, claiming ? 10_000 : 5 * 60_000);
  }

  function scheduleHeartbeat() {
    clearTimeout(hbTimer);
    const g = state && state.giveaway;
    if (!g || g.status === 'done' || !state.me.loggedIn) return;
    const now = serverNow();
    const interval = g.intervalSec * 1000;
    const slot = Math.floor((now - g.startedAt) / interval);
    const target = lastSentSlot >= slot ? slot + 1 : slot;
    const windowStart = g.startedAt + target * interval;
    const from = Math.max(now, windowStart);
    const to = Math.max(from, windowStart + interval - 30_000);
    let at = from + Math.random() * (to - from);
    const preDraw = g.drawAt - 30_000 - Math.random() * 90_000;
    if (g.status === 'open' && preDrawSentFor !== g.id && preDraw > now && preDraw < at) at = preDraw;
    hbTimer = setTimeout(sendHeartbeat, Math.max(0, at - now));
  }

  async function sendHeartbeat() {
    // Paused or chat-only: not watching. Try again in a minute.
    if (!watching()) {
      hbTimer = setTimeout(sendHeartbeat, 60_000);
      return;
    }
    const g = state && state.giveaway;
    if (g && serverNow() >= g.drawAt - 150_000) preDrawSentFor = g.id;
    try {
      const res = await call('POST', '/ext/heartbeat');
      if (res.slot != null) lastSentSlot = Math.max(lastSentSlot, res.slot);
      applyState(res.state);
    } catch {
      hbTimer = setTimeout(sendHeartbeat, 60_000);
    }
  }

  async function act(path) {
    busy = true;
    render();
    try {
      applyState(await call('POST', path));
      error = '';
    } catch (e) {
      error = ERRORS[e.code] || 'Oups, réessaie dans un instant.';
    }
    busy = false;
    render();
  }

  function onJoin() {
    if (!ext.viewer.isLinked) {
      pendingJoin = true;
      ext.actions.requestIdShare();
      return;
    }
    act('/ext/join');
  }

  // ---- rendering ----

  function prizeBlock(g) {
    return `<div class="prize"><div class="label">À gagner</div><div class="name">${esc(g.prize)}</div></div>`;
  }

  function countdownRow(g) {
    return `<div class="row"><span>Tirage dans</span><span class="big" data-until="${g.drawAt}"></span></div>`;
  }

  function renderOpen(g, me) {
    const every = Math.round(g.intervalSec / 60);
    if (!me.loggedIn) {
      return `<h1>🎁 Giveaway en cours</h1>${prizeBlock(g)}${countdownRow(g)}
        <p>Connecte-toi à Twitch pour participer.</p>`;
    }
    if (!me.joined) {
      return `<h1>🎁 Giveaway en cours</h1>${prizeBlock(g)}${countdownRow(g)}
        <p>Plus tu restes sur le live, plus tu as de tickets 🎟️ (1 toutes les ${every} min).</p>
        ${me.slots ? `<p class="ok">Tu as déjà ${plural(me.tickets, 'ticket')} de présence !</p>` : ''}
        <button id="join" ${busy ? 'disabled' : ''}>Je participe</button>
        <p class="muted">Gratuit. Ta présence est vérifiée automatiquement : garde juste le live ouvert.</p>`;
    }
    if (me.forfeited) {
      return `<h1>🎁 Giveaway</h1>${prizeBlock(g)}<p class="warn">Tu as été tiré au sort mais tu n'as pas confirmé à temps 😢</p>`;
    }
    const missing = Math.max(0, g.minTickets - me.slots);
    const chance = state.stats.totalTickets ? Math.max(1, Math.round((100 * me.tickets) / state.stats.totalTickets)) : 0;
    return `<h1>🎁 Giveaway en cours</h1>${prizeBlock(g)}
      <p class="ok">✓ Tu participes</p>
      <div class="row"><span>Tes tickets</span><span class="big">${me.tickets} / ${g.maxTickets}</span></div>
      <div class="bar"><div data-pct="${(100 * me.tickets) / g.maxTickets}"></div></div>
      ${missing
        ? `<p class="warn">Encore ${plural(missing, 'vérification')} de présence avant de pouvoir gagner.</p>`
        : `<p class="muted">Tes chances ≈ ${chance} % (${plural(state.stats.entrants, 'participant')})</p>`}
      ${countdownRow(g)}
      <p class="muted">Présence vérifiée toutes les ~${every} min. Ne mets pas le live en pause !</p>`;
  }

  function renderClaiming(g, me) {
    if (me.isCandidate) {
      return `<h2>🎉 Tu as été tiré au sort !</h2>${prizeBlock(g)}
        <p>Confirme que tu es là avant la fin du compte à rebours :</p>
        <div class="center big" data-until="${g.claimDeadline}"></div>
        <button id="claim" class="pulse" ${busy ? 'disabled' : ''}>Je suis là !</button>`;
    }
    return `<h1>🎲 Tirage effectué !</h1>${prizeBlock(g)}
      <p>Le gagnant a <strong data-until="${g.claimDeadline}"></strong> pour confirmer sa présence…</p>
      ${me.forfeited ? '<p class="warn">Tu as été tiré mais tu n\'as pas confirmé à temps 😢</p>' : ''}`;
  }

  function renderDone(g, me) {
    if (me.isWinner) {
      return `<h2>🏆 Tu as gagné !</h2>${prizeBlock(g)}
        <p>Pour recevoir ton cadeau, connecte-toi sur l'app avec Twitch :</p>
        <a class="button" href="${EBS}/?win=1" target="_blank" rel="noopener">Récupérer mon cadeau</a>`;
    }
    if (g.winner) {
      return `<h1>🎉 Bravo à ${esc(g.winner)} !</h1>${prizeBlock(g)}
        <p class="muted">Prochain giveaway au prochain live. Active les notifs pour ne pas le rater.</p>`;
    }
    return `<h1>Giveaway terminé</h1><p>Personne n'était éligible cette fois-ci.</p>`;
  }

  function render() {
    let html;
    if (!state) {
      html = `<p class="muted center">${esc(error || 'Chargement…')}</p>`;
    } else {
      const g = state.giveaway;
      if (!g) {
        html = `<h1>🎁 Giveaways</h1><p>Pas de giveaway en cours pour l'instant.</p>
          <p class="muted">Active les notifications pour être prévenu au prochain live 👇</p>`;
      } else if (g.status === 'open') html = renderOpen(g, state.me);
      else if (g.status === 'claiming') html = renderClaiming(g, state.me);
      else html = renderDone(g, state.me);
      if (error) html += `<p class="error">${esc(error)}</p>`;
    }
    app.innerHTML = html;
    const join = app.querySelector('#join');
    if (join) join.addEventListener('click', onJoin);
    const claim = app.querySelector('#claim');
    if (claim) claim.addEventListener('click', () => act('/ext/claim'));
    for (const bar of app.querySelectorAll('[data-pct]')) bar.style.width = `${Math.min(100, bar.dataset.pct)}%`;
    updateCountdowns();
  }

  function updateCountdowns() {
    for (const el of app.querySelectorAll('[data-until]')) {
      el.textContent = formatDuration(Number(el.dataset.until) - serverNow());
    }
  }

  // ---- Twitch hooks ----

  ext.onAuthorized((auth) => {
    token = auth.token;
    if (pendingJoin && ext.viewer.isLinked) {
      pendingJoin = false;
      act('/ext/join');
    } else {
      refresh();
    }
  });

  ext.onContext((ctx) => {
    context = { ...context, ...ctx };
    document.body.classList.toggle('dark', context.theme === 'dark');
  });

  // The server pings every open panel when something changes; spread the refetches out.
  ext.listen('broadcast', () => setTimeout(refresh, Math.random() * 3000));

  setInterval(updateCountdowns, 1000);
})();
