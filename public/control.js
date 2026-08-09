(() => {
  const $ = (id) => document.getElementById(id);

  const els = {
    conn: $('conn'),
    meta: $('meta'),
    pill: $('pill'),
    timer: $('timer'),
    minutes: $('minutes'),
    start: $('start'),
    stop: $('stop'),
    autoplay: $('autoplay'),
    queue: $('queue'),
    testForm: $('test-form'),
    testUser: $('test-user'),
    optout: $('optout'),
  };

  const LABELS = {
    sub: 'nouveau sub',
    resub: 'resub',
    gift: 'sub gifter',
    gift_recipient: 'sub offert',
  };

  // Ton demandé au TTS. Uniquement interprété par les fournisseurs qui gèrent
  // les didascalies en ligne — sinon la vanne est dite au naturel.
  const DELIVERY_LABELS = {
    deadpan: '🗿 pince-sans-rire',
    amused: '🙂 amusé',
    laughing: '😂 en riant',
    'mock serious': '🎩 faussement grave',
    warm: '🤗 chaleureux',
    excited: '⚡ enthousiaste',
  };

  const STATUS_LABELS = {
    pending: 'en attente',
    approved: 'validée',
    playing: 'à l\'antenne',
    played: 'passée',
    failed: 'filtrée',
  };

  let session = { active: false, endsAt: null, autoPlay: false, roastsPlayed: 0 };

  async function api(path, body) {
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return response.json().catch(() => ({}));
  }

  // ── Rendu ────────────────────────────────────────────────────────────

  function renderSession() {
    els.pill.textContent = session.active ? 'session en cours' : 'hors session';
    els.pill.classList.toggle('is-live', session.active);
    els.conn.classList.toggle('is-live', session.active);
    els.start.hidden = session.active;
    els.stop.hidden = !session.active;
    els.autoplay.checked = Boolean(session.autoPlay);
    renderTimer();
  }

  function renderTimer() {
    if (!session.active || !session.endsAt) {
      els.timer.textContent = '—';
      return;
    }
    const remaining = Math.max(0, session.endsAt - Date.now());
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    els.timer.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function renderQueue(items) {
    if (!items.length) {
      els.queue.innerHTML = '<p class="empty">Rien pour l\'instant.</p>';
      return;
    }

    els.queue.innerHTML = '';
    for (const item of items) {
      const node = document.createElement('article');
      node.className = 'item';
      if (item.status === 'playing') node.classList.add('is-playing');
      if (item.status === 'failed') node.classList.add('is-failed');

      const left = document.createElement('div');

      const head = document.createElement('div');
      head.className = 'item__head';

      const user = document.createElement('span');
      user.className = 'item__user';
      user.textContent = item.trigger.userName;
      head.append(user);

      const kind = document.createElement('span');
      kind.className = 'tag';
      kind.textContent = LABELS[item.trigger.type] ?? item.trigger.type;
      head.append(kind);

      if (item.severity > 0) {
        const sev = document.createElement('span');
        sev.className = `tag tag--sev${item.severity}`;
        sev.textContent = `sévérité ${item.severity}`;
        head.append(sev);
      }

      const status = document.createElement('span');
      status.className = item.status === 'failed' ? 'tag tag--err' : 'tag';
      status.textContent = STATUS_LABELS[item.status] ?? item.status;
      head.append(status);

      if (item.delivery) {
        const delivery = document.createElement('span');
        delivery.className = 'tag';
        delivery.textContent = DELIVERY_LABELS[item.delivery] ?? item.delivery;
        head.append(delivery);
      }

      if (item.angle) {
        const angle = document.createElement('span');
        angle.textContent = item.angle;
        head.append(angle);
      }

      const text = document.createElement('p');
      text.className = 'item__text';
      if (item.error) {
        text.textContent = `Rejetée — ${item.error}`;
        text.classList.add('is-pending');
      } else if (item.text) {
        text.textContent = item.text;
      } else {
        text.textContent = 'génération en cours…';
        text.classList.add('is-pending');
      }

      left.append(head, text);
      node.append(left);

      if (item.status === 'pending' && item.text) {
        const actions = document.createElement('div');
        actions.className = 'item__actions';

        const go = document.createElement('button');
        go.className = 'icon-btn icon-btn--go';
        go.title = 'Envoyer à l\'antenne';
        go.textContent = '▶';
        go.addEventListener('click', () => api(`/api/roast/${item.id}/approve`, {}));

        const kill = document.createElement('button');
        kill.className = 'icon-btn icon-btn--stop';
        kill.title = 'Jeter';
        kill.textContent = '✕';
        kill.addEventListener('click', () => api(`/api/roast/${item.id}/reject`, {}));

        actions.append(go, kill);
        node.append(actions);
      }

      els.queue.append(node);
    }
  }

  function renderSide(state) {
    const { chat, settings, optedOut } = state;
    els.meta.textContent =
      `${settings.model} · tts:${settings.tts} · sév≤${settings.maxSeverity} · ` +
      `${chat.messages} messages / ${chat.users} viewers connus`;

    if (!optedOut.length) {
      els.optout.innerHTML = '<span class="hint">personne</span>';
      return;
    }
    els.optout.innerHTML = '';
    for (const name of optedOut) {
      const tag = document.createElement('span');
      tag.className = 'name';
      tag.textContent = name;
      els.optout.append(tag);
    }
  }

  // ── Données ──────────────────────────────────────────────────────────

  async function refreshFull() {
    const state = await api('/api/state');
    session = state.session;
    renderSession();
    renderQueue(state.queue);
    renderSide(state);
  }

  function connect() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${location.host}/ws`);

    socket.addEventListener('message', (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (payload.type !== 'state') return;
      session = payload.session;
      renderSession();
      renderQueue(payload.queue);
    });

    socket.addEventListener('close', () => setTimeout(connect, 2000));
  }

  // ── Interactions ─────────────────────────────────────────────────────

  els.start.addEventListener('click', () =>
    api('/api/session/start', { minutes: Number(els.minutes.value) || 30 }),
  );
  els.stop.addEventListener('click', () => api('/api/session/stop', {}));
  els.autoplay.addEventListener('change', () =>
    api('/api/session/autoplay', { value: els.autoplay.checked }),
  );

  els.testForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const user = els.testUser.value.trim();
    if (!user) return;
    await api('/api/test', { user });
    els.testUser.value = '';
  });

  setInterval(renderTimer, 1000);
  setInterval(refreshFull, 15000);
  refreshFull();
  connect();
})();
