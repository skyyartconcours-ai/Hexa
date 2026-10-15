const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (t) => (t ? new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const name = (u) => esc(u?.display_name || u?.login || '?');

const ERRORS = {
  already_active: 'Un giveaway est déjà en cours.',
  not_active: 'Ce giveaway n\'est plus actif.',
  admin_required: 'Session expirée, reconnecte-toi.',
};

async function api(method, path, body) {
  const res = await fetch(`/admin/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    showLogin();
    throw new Error('admin_required');
  }
  if (!res.ok) throw new Error(ERRORS[data.error] || data.error || 'Erreur serveur');
  return data;
}

function showLogin() {
  $('login').classList.remove('hidden');
  $('dash').classList.add('hidden');
}

let data;
let clockOffset = 0;
let settingsFilled = false;

function formatLeft(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min ${String(s % 60).padStart(2, '0')} s`;
}

function renderWarnings() {
  const items = [];
  if (data.missingConfig.length) items.push(`Configuration incomplète (.env) : <code>${data.missingConfig.map(esc).join(', ')}</code>`);
  if (!data.publicUrl.startsWith('https://')) items.push('Le serveur n\'est pas en HTTPS : Twitch ne pourra pas envoyer l\'alerte « live démarré ».');
  if (data.settings.subMultiplier > 1 && !data.broadcasterToken) items.push('Reconnecte-toi pour autoriser la vérification des subs.');
  $('warnings').innerHTML = items.map((i) => `<p class="warn">⚠️ ${i}</p>`).join('');
  $('warnings').classList.toggle('hidden', !items.length);
}

function renderCurrent() {
  const g = data.giveaway;
  const box = $('current');
  const active = g && (g.status === 'open' || g.status === 'claiming');
  $('start-card').classList.toggle('hidden', Boolean(active));
  if (!active) {
    box.innerHTML = '<p class="muted">Aucun giveaway en cours.</p>';
    return;
  }
  const now = Date.now() + clockOffset;
  const statusLine = g.status === 'open'
    ? `<span class="pill open">Ouvert</span> Tirage dans <strong>${formatLeft(g.draw_at - now)}</strong>`
    : `<span class="pill claiming">En attente de confirmation</span> <strong>${name(g.candidate)}</strong> a ${formatLeft(g.claim_deadline - now)} pour cliquer « Je suis là »`;
  box.innerHTML = `
    <p><strong>${esc(g.prize)}</strong></p>
    <p>${statusLine}</p>
    <p class="muted">${g.stats.entrants} participant(s) · ${g.stats.totalTickets} ticket(s) de présence</p>
    <div class="row">
      <button id="draw-btn">${g.status === 'open' ? '🎲 Tirer maintenant' : '🔁 Retirer quelqu\'un d\'autre'}</button>
      <button id="cancel-btn" class="danger">Annuler le giveaway</button>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Viewer</th><th>Inscrit à</th><th>Vérifs de présence</th><th>Vu pour la dernière fois</th><th>Tickets au tirage</th></tr></thead>
      <tbody>${data.entrants.map((e) => `
        <tr>
          <td>${name(e)}${e.forfeited ? ' <span class="warn">(n\'a pas confirmé)</span>' : ''}</td>
          <td>${fmtDate(e.joined_at)}</td>
          <td>${e.slots}</td>
          <td>${fmtDate(e.last_seen)}</td>
          <td>${e.tickets ?? '—'}</td>
        </tr>`).join('') || '<tr><td colspan="5" class="muted">Personne pour l\'instant.</td></tr>'}
      </tbody>
    </table></div>`;
  $('draw-btn').addEventListener('click', async () => {
    if (!confirm(g.status === 'open' ? 'Faire le tirage maintenant ?' : 'Passer au viewer suivant ?')) return;
    try {
      const res = await api('POST', `/giveaways/${g.id}/draw`);
      if (!res.pick) alert('Personne n\'est éligible pour l\'instant.');
    } catch (err) { alert(err.message); }
    load();
  });
  $('cancel-btn').addEventListener('click', async () => {
    if (!confirm('Annuler ce giveaway ? Personne ne gagnera.')) return;
    try { await api('POST', `/giveaways/${g.id}/cancel`); } catch (err) { alert(err.message); }
    load();
  });
}

function renderSettings() {
  const form = $('settings-form');
  $('sub-warning').classList.toggle('hidden', !(data.settings.subMultiplier > 1));
  if (settingsFilled) return;
  for (const [key, value] of Object.entries(data.settings)) {
    const input = form.elements[key];
    if (!input) continue;
    if (input.type === 'checkbox') input.checked = value;
    else input.value = value;
  }
  $('start-prize').value = data.settings.prize;
  $('start-duration').value = data.settings.durationMin;
  settingsFilled = true;
}

function renderTables() {
  $('winners').innerHTML = data.winners.map((w) => `
    <tr>
      <td>${fmtDate(w.won_at)}</td>
      <td>${name(w)}</td>
      <td>${esc(w.prize)}</td>
      <td class="wrap">${w.contact ? esc(w.contact) : '<span class="muted">pas encore renseigné</span>'}</td>
      <td><input type="checkbox" data-delivered="${w.id}" ${w.delivered_at ? 'checked' : ''}></td>
    </tr>`).join('') || '<tr><td colspan="5" class="muted">Aucun gagnant pour l\'instant.</td></tr>';
  for (const box of document.querySelectorAll('[data-delivered]')) {
    box.addEventListener('change', async () => {
      try { await api('POST', `/winners/${box.dataset.delivered}/delivered`, { delivered: box.checked }); } catch (err) { alert(err.message); }
      load();
    });
  }
  const STATUS = { open: 'ouvert', claiming: 'confirmation', done: 'terminé', cancelled: 'annulé' };
  $('history').innerHTML = data.history.map((h) => `
    <tr>
      <td>${h.id}</td><td>${fmtDate(h.started_at)}</td><td>${esc(h.prize)}</td>
      <td><span class="pill ${h.status}">${STATUS[h.status]}</span></td><td>${h.entrants}</td><td>${esc(h.winner || '—')}</td>
    </tr>`).join('');
  $('push-info').textContent = data.push.enabled
    ? `${data.push.subscribers} appareil(s) abonné(s) aux notifications de live.`
    : 'Notifications désactivées : renseigne VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY.';
}

async function load() {
  try {
    data = await api('GET', '/overview');
  } catch {
    return;
  }
  clockOffset = data.serverNow - Date.now();
  $('login').classList.add('hidden');
  $('dash').classList.remove('hidden');
  renderWarnings();
  renderCurrent();
  renderSettings();
  renderTables();
}

function formValues(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    out[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return out;
}

$('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    data.settings = await api('POST', '/settings', formValues(e.target));
    settingsFilled = false;
    renderSettings();
    $('settings-saved').classList.remove('hidden');
    setTimeout(() => $('settings-saved').classList.add('hidden'), 2000);
  } catch (err) { alert(err.message); }
});

$('start-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { await api('POST', '/giveaways', formValues(e.target)); } catch (err) { alert(err.message); }
  load();
});

$('eventsub-btn').addEventListener('click', async () => {
  $('eventsub-status').textContent = 'Vérification…';
  try {
    const sub = await api('POST', '/eventsub');
    $('eventsub-status').textContent = sub.status === 'enabled'
      ? '✓ Twitch préviendra le serveur à chaque début de live.'
      : `Statut : ${sub.status} (Twitch vérifie l'URL, réessaie dans quelques secondes).`;
  } catch (err) {
    $('eventsub-status').textContent = `Erreur : ${err.message}`;
  }
});

$('push-test').addEventListener('click', async () => {
  try {
    const res = await api('POST', '/push/test');
    alert(`${res.sent} notification(s) envoyée(s).`);
  } catch (err) { alert(err.message); }
});

load();
setInterval(load, 10_000);
