const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'error');
  return data;
}

function urlBase64ToUint8Array(base64) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

let me;

// ---- notifications ----

const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;

async function currentSubscription() {
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

async function renderNotifications() {
  const status = $('notif-status');
  $('notif-on').classList.add('hidden');
  $('notif-off').classList.add('hidden');
  if (!me.push.enabled) {
    status.textContent = 'Les notifications ne sont pas encore configurées sur ce serveur.';
    return;
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    status.textContent = 'Ton navigateur ne gère pas les notifications.';
    if (isIos && !isStandalone) $('ios-hint').classList.remove('hidden');
    return;
  }
  if (Notification.permission === 'denied') {
    status.textContent = 'Les notifications sont bloquées pour ce site dans les réglages de ton navigateur.';
    return;
  }
  const sub = await currentSubscription();
  if (sub) {
    status.innerHTML = '<span class="ok">✓ Activées</span> — tu seras prévenu à chaque début de live.';
    $('notif-off').classList.remove('hidden');
  } else {
    status.textContent = 'Reçois une notification dès que le live commence. Tu peux les couper quand tu veux.';
    $('notif-on').classList.remove('hidden');
  }
}

$('notif-on').addEventListener('click', async () => {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return renderNotifications();
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(me.push.publicKey),
    });
    await api('POST', '/api/push/subscribe', { subscription: sub.toJSON() });
  } catch (err) {
    alert(`Impossible d'activer les notifications : ${err.message}`);
  }
  renderNotifications();
});

$('notif-off').addEventListener('click', async () => {
  const sub = await currentSubscription();
  if (sub) {
    await api('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe();
  }
  renderNotifications();
});

// ---- wins ----

function renderWins() {
  const box = $('wins');
  if (!me.user) {
    $('login-box').classList.remove('hidden');
    box.innerHTML = '';
    return;
  }
  $('login-box').classList.add('hidden');
  $('logout').classList.remove('hidden');
  $('forget').classList.remove('hidden');
  if (!me.wins.length) {
    box.innerHTML = `<p class="muted">Connecté en tant que <strong>${esc(me.user.name)}</strong>. Pas encore de gain… ça va venir 🍀</p>`;
    return;
  }
  box.innerHTML = me.wins.map((w) => `
    <div class="card">
      <strong>${esc(w.prize)}</strong>
      <div class="muted">Gagné le ${new Date(w.won_at).toLocaleDateString('fr-FR')}</div>
      ${w.delivered_at
        ? '<p class="ok">✓ Envoyé</p>'
        : `<label for="contact-${w.id}">Comment te faire parvenir ton cadeau ?</label>
           <textarea id="contact-${w.id}" rows="3" placeholder="Ex : ton pseudo Discord, ou ton e-mail pour recevoir une clé de jeu">${esc(w.contact || '')}</textarea>
           <div class="row" style="margin-top:8px">
             <button data-win="${w.id}">${w.contact ? 'Mettre à jour' : 'Envoyer'}</button>
             ${w.contact ? '<span class="ok">✓ Reçu, le streamer va te contacter</span>' : ''}
           </div>`}
    </div>`).join('');
  for (const btn of box.querySelectorAll('button[data-win]')) {
    btn.addEventListener('click', async () => {
      const contact = $(`contact-${btn.dataset.win}`).value;
      try {
        await api('POST', `/api/wins/${btn.dataset.win}/contact`, { contact });
        await load();
      } catch {
        alert('Impossible d\'enregistrer, réessaie.');
      }
    });
  }
}

$('logout').addEventListener('click', async (e) => {
  e.preventDefault();
  await api('POST', '/auth/logout');
  load();
});

$('forget').addEventListener('click', async (e) => {
  e.preventDefault();
  if (!confirm('Supprimer tes coordonnées et tes abonnements aux notifications ?')) return;
  const sub = await currentSubscription().catch(() => null);
  if (sub) await sub.unsubscribe();
  await api('DELETE', '/api/me');
  location.reload();
});

async function load() {
  me = await api('GET', '/api/me');
  $('live-link').href = `https://twitch.tv/${me.channel}`;
  $('login-btn').href = `/auth/login?next=${encodeURIComponent(location.pathname + location.search)}`;
  renderWins();
  await renderNotifications();
  if (new URLSearchParams(location.search).has('win')) $('wins-card').scrollIntoView({ behavior: 'smooth' });
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
load();
