#!/usr/bin/env bash
# Déploiement de Spyfall sur un VPS avec Caddy en reverse proxy.
#
# ADDITIF & SÛR : ne touche QUE ses propres ressources (son dossier, son port,
# son service systemd, son bloc Caddy délimité). Les autres outils hébergés sur
# le serveur (olympe, poker, lecercle…) ne sont jamais modifiés.
#
# Usage, depuis le PC (Git Bash) :
#   SPYFALL_SSH_HOST=root@1.2.3.4 bash deploy/deploy-vps.sh inventory   # lecture seule
#   SPYFALL_SSH_HOST=root@1.2.3.4 bash deploy/deploy-vps.sh deploy      # déploie
#   SPYFALL_SSH_HOST=root@1.2.3.4 bash deploy/deploy-vps.sh rollback    # retire ce service
#
# Mot de passe du jeu : SPYFALL_PASSWORD=xxx bash deploy/deploy-hetzner.sh deploy
set -euo pipefail

# ---------- config ----------
TOOL="spyfall"
DOMAIN="${SPYFALL_DOMAIN:-spyfall.skyyarttools.fr}"
ALIAS="${SPYFALL_ALIAS:-spy.skyyarttools.fr}"      # alias court, imprime dans le partage du Casier (app.js)
PORT="${SPYFALL_PORT:-3210}"          # port interne ; abandon s'il est pris par un AUTRE service
SSH_HOST="${SPYFALL_SSH_HOST:-}"           # OBLIGATOIRE : user@ip du VPS
SSH_KEY="${SPYFALL_SSH_KEY:-$HOME/.ssh/olympe_deploy}"
REMOTE_DIR="/opt/spyfall"
ENVFILE="/etc/spyfall.env"
REPO="https://github.com/skyyartconcours-ai/Hexa.git"
BRANCH="${SPYFALL_BRANCH:-claude/deploy-spyfall-skyy-wtj43p}"
PASS="${SPYFALL_PASSWORD:-spy}"
SSH="ssh -i $SSH_KEY -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 $SSH_HOST"

# Sous-domaines d'AUTRES outils — interdiction absolue d'y toucher.
PROTECTED_SUBDOMAINS="olympe poker lecercle www ftp skyyarttools.fr"

say() { printf '\n\033[1;33m== %s\033[0m\n' "$*"; }

require_ssh() {
  if [ -z "$SSH_HOST" ]; then
    echo "❌ SPYFALL_SSH_HOST non défini. Exemple :"
    echo "   SPYFALL_SSH_HOST=root@1.2.3.4 bash deploy/deploy-vps.sh inventory"
    exit 1
  fi
  if ! $SSH 'echo ok' >/dev/null 2>&1; then
    echo "❌ SSH impossible (clé non autorisée ?). Autorise d'abord la clé :"
    echo "   Get-Content \$env:USERPROFILE\\.ssh\\olympe_deploy.pub | ssh $SSH_HOST \"mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys\""
    exit 1
  fi
}

guard_domain() {
  for p in $PROTECTED_SUBDOMAINS; do
    if [ "$DOMAIN" = "$p" ] || [ "$DOMAIN" = "$p.skyyarttools.fr" ]; then
      echo "❌ ABANDON : $DOMAIN appartient à un autre outil."; exit 1
    fi
  done
}

bootstrap() {
  require_ssh
  say "PRÉPARATION D'UN VPS NEUF (Node + Caddy)"
  echo "N'installe que ce qui manque. Si Caddy est déjà là, sa configuration n'est pas touchée."
  $SSH bash -s <<'EOF'
set -e
export DEBIAN_FRONTEND=noninteractive
if ! command -v curl >/dev/null; then apt-get update -qq && apt-get install -y -qq curl; fi

if command -v node >/dev/null && [ "$(node -v | cut -d. -f1 | tr -d v)" -ge 18 ]; then
  echo "node $(node -v) déjà présent ✓"
else
  echo "-> installation de Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi

if command -v caddy >/dev/null; then
  echo "caddy $(caddy version | head -1) déjà présent ✓ (configuration inchangée)"
else
  echo "-> installation de Caddy (dépôt officiel)"
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -qq
  apt-get install -y -qq caddy
  systemctl enable --now caddy
fi

echo "--- récapitulatif ---"
node -v; caddy version | head -1; systemctl is-active caddy
EOF
  echo ""
  echo "Serveur prêt. Étape suivante :"
  echo "  SPYFALL_SSH_HOST=$SSH_HOST bash deploy/deploy-vps.sh deploy"
}

inventory() {
  require_ssh
  say "INVENTAIRE (lecture seule) — rien n'est modifié"
  $SSH bash -s <<EOF
set -e
echo "--- hostname ---"; hostname
echo "--- node ---"; node -v 2>/dev/null || echo "NODE ABSENT"
echo "--- ports en écoute ---"; ss -tlnp 2>/dev/null | awk 'NR==1 || /LISTEN/' | head -40
echo "--- port ${PORT} ---"; if ss -tln 2>/dev/null | grep -q ":${PORT} "; then echo "OCCUPÉ ⚠"; else echo "libre ✓"; fi
echo "--- routes Caddy déjà en place ---"; grep -oE '^[a-z0-9.-]+\.skyyarttools\.fr' /etc/caddy/Caddyfile 2>/dev/null || echo "(Caddyfile illisible ou absent)"
echo "--- ${REMOTE_DIR} ---"
if [ -d "${REMOTE_DIR}" ]; then
  ls -la "${REMOTE_DIR}" | head -5
  [ -f "${REMOTE_DIR}/.claude-deploy-owned" ] && echo "MARQUEUR présent ✓" || echo "⚠ dossier SANS marqueur — le déploiement refusera de l'écraser"
else
  echo "absent (sera créé)"
fi
echo "--- service spyfall ---"; systemctl is-active spyfall 2>/dev/null || echo "(pas encore installé)"
echo "--- DNS ${DOMAIN} ---"; getent hosts ${DOMAIN} || echo "(résolution via le wildcard *.skyyarttools.fr attendue)"
EOF
}

deploy() {
  require_ssh
  guard_domain

  say "1/6 Vérifications distantes (node, port libre, dossier non-étranger)"
  $SSH bash -s <<EOF
set -e
command -v node >/dev/null || { echo "❌ node absent — lancez d'abord : bash deploy/deploy-vps.sh bootstrap"; exit 1; }
command -v git  >/dev/null || { echo "❌ git absent sur le serveur."; exit 1; }
# Refus absolu d'écraser un dossier qui n'a pas été créé par ce pipeline.
if [ -d "${REMOTE_DIR}" ] && [ ! -f "${REMOTE_DIR}/.claude-deploy-owned" ]; then
  echo "❌ ${REMOTE_DIR} existe sans marqueur — refus de toucher un dossier étranger."; exit 1
fi
# Le check "port libre" ne vaut qu'à la PREMIÈRE installation : au redéploiement,
# c'est notre propre service qui tient le port, ce qui est normal.
OURS=0; [ -f "${REMOTE_DIR}/.claude-deploy-owned" ] && OURS=1
if [ "\$OURS" = "0" ] && ss -tln 2>/dev/null | grep -q ":${PORT} "; then
  echo "❌ port ${PORT} déjà pris par un AUTRE service — relance avec SPYFALL_PORT=<autre>."; exit 1
fi
mkdir -p "${REMOTE_DIR}"; touch "${REMOTE_DIR}/.claude-deploy-owned"
# Compte systeme dedie. Le jeu ecrit data.json et pending.json dans son propre
# dossier : il lui faut un proprietaire stable. DynamicUser=yes en etait
# incapable (dossier root => EROFS silencieux, edition des lieux perdue).
id spyfall >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin spyfall
EOF

  say "2/6 Code : clone/mise à jour depuis GitHub (branche ${BRANCH})"
  # Le dépôt Hexa est public : un git pull côté serveur est plus fiable qu'un
  # envoi tar (pas de dépendance à l'état du poste, et la mise à jour est atomique).
  $SSH bash -s <<EOF
set -e
# Le dossier appartient au compte spyfall, git tourne en root : sans cette
# exception git refuse le depot ("dubious ownership") et la mise a jour echoue.
git config --global --get-all safe.directory 2>/dev/null | grep -qx "${REMOTE_DIR}"   || git config --global --add safe.directory "${REMOTE_DIR}"
if [ -d "${REMOTE_DIR}/.git" ]; then
  git -C "${REMOTE_DIR}" remote set-url origin "${REPO}"
  git -C "${REMOTE_DIR}" fetch origin "${BRANCH}"
  git -C "${REMOTE_DIR}" checkout -B "${BRANCH}" "origin/${BRANCH}"
  git -C "${REMOTE_DIR}" reset --hard "origin/${BRANCH}"
else
  # Le dossier existe déjà (marqueur créé à l'étape 1) : on clone dedans.
  git clone -b "${BRANCH}" "${REPO}" "${REMOTE_DIR}.tmp"
  mv "${REMOTE_DIR}.tmp/.git" "${REMOTE_DIR}/.git"
  rm -rf "${REMOTE_DIR}.tmp"
  git -C "${REMOTE_DIR}" checkout -f "${BRANCH}"
fi
echo "HEAD : \$(git -C "${REMOTE_DIR}" log --oneline -1)"
EOF

  say "3/6 Secret : mot de passe du jeu dans ${ENVFILE} (600, root seul)"
  # Le mot de passe transite par stdin, jamais par la ligne de commande : il
  # n'apparaît donc ni dans un `ps`, ni dans l'unité systemd, ni dans un log.
  printf '%s' "$PASS" | $SSH "umask 077 && { printf 'SPYFALL_PASSWORD='; cat; echo; } > ${ENVFILE} && chmod 600 ${ENVFILE} && echo 'secret écrit ✓'"

  say "4/6 Service systemd (derrière Caddy : loopback + vraie IP client)"
  $SSH bash -s <<EOF
set -e
cat > /etc/systemd/system/spyfall.service <<UNIT
[Unit]
Description=Spyfall FR (spyfall.skyyarttools.fr)
After=network.target

[Service]
WorkingDirectory=${REMOTE_DIR}
ExecStart=\$(command -v node) server.js
Environment=PORT=${PORT}
# Derrière Caddy : on n'écoute que sur la loopback (Node jamais joignable en
# direct) et on lit X-Forwarded-For, sinon le rate-limit anti-brute-force du
# mot de passe verrait toutes les requêtes venir du proxy.
Environment=TRUST_PROXY=1
Environment=HOST=127.0.0.1
EnvironmentFile=${ENVFILE}
Restart=always
RestartSec=2
# Compte dedie non privilegie, proprietaire de ${REMOTE_DIR}, sinon l ecriture
# de data.json echoue en silence et les lieux ajoutes sont perdus au redemarrage.
User=spyfall
Group=spyfall
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=${REMOTE_DIR}

[Install]
WantedBy=multi-user.target
UNIT
chown -R spyfall:spyfall ${REMOTE_DIR}
systemctl daemon-reload
systemctl enable spyfall >/dev/null 2>&1
systemctl restart spyfall
sleep 1
systemctl is-active spyfall
EOF

  say "5/6 Route Caddy (HTTPS automatique) — idempotent, n'affecte aucun autre domaine"
  $SSH bash -s <<EOF
set -e
export PATH="/usr/local/sbin:/usr/sbin:/sbin:\$PATH"   # SSH non-interactif : caddy/systemctl hors /usr/bin
CADDY=/etc/caddy/Caddyfile
if [ ! -f "\$CADDY" ]; then echo "❌ Caddyfile introuvable (\$CADDY) — reverse proxy inattendu."; exit 1; fi
if grep -q "${DOMAIN}" "\$CADDY"; then
  echo "route ${DOMAIN} déjà présente ✓ (Caddyfile inchangé)"
else
  cp "\$CADDY" "\$CADDY.deploybak"
  cat >> "\$CADDY" <<CADDYBLOCK

# ========== AJOUT ${TOOL} (${DOMAIN}, deploy auto) ==========
${DOMAIN} {
	reverse_proxy 127.0.0.1:${PORT}
}
# L alias court renvoie vers le vrai nom (redirection permanente, chemin conserve).
# Il vit DANS ce bloc pour que rollback le retire avec le reste.
${ALIAS} {
	redir https://${DOMAIN}{uri} permanent
}
# ========== FIN AJOUT ${TOOL} ==========
CADDYBLOCK
  if command -v caddy >/dev/null && caddy validate --config "\$CADDY" --adapter caddyfile >/dev/null 2>&1; then
    systemctl reload caddy
    echo "route ${DOMAIN} ajoutée + Caddy rechargé ✓"
  else
    echo "❌ Caddyfile invalide après ajout — restauration de la sauvegarde"
    mv "\$CADDY.deploybak" "\$CADDY"
    exit 1
  fi
fi
EOF

  say "6/6 Vérification"
  $SSH "curl -s -o /dev/null -w 'interne  127.0.0.1:${PORT}/api/config -> %{http_code}\n' http://127.0.0.1:${PORT}/api/config"
  $SSH "curl -s -o /dev/null -w 'public   https://${DOMAIN}/ -> %{http_code}\n' --max-time 20 https://${DOMAIN}/ || echo '(pas encore joignable — Caddy met ~1 min à émettre le certificat la 1re fois)'"
  echo ""
  echo "→ en ligne : https://${DOMAIN}   (mot de passe : ${PASS})"
}

rollback() {
  require_ssh
  guard_domain
  say "Retrait de ${TOOL} — seules SES ressources sont supprimées"
  $SSH bash -s <<EOF
set -e
export PATH="/usr/local/sbin:/usr/sbin:/sbin:\$PATH"
systemctl disable --now spyfall 2>/dev/null || true
rm -f /etc/systemd/system/spyfall.service
systemctl daemon-reload
CADDY=/etc/caddy/Caddyfile
if [ -f "\$CADDY" ] && grep -q "AJOUT ${TOOL}" "\$CADDY"; then
  cp "\$CADDY" "\$CADDY.deploybak"
  # Supprime uniquement le bloc délimité par nos marqueurs, le reste est intact.
  sed -i "/# ========== AJOUT ${TOOL} /,/# ========== FIN AJOUT ${TOOL} /d" "\$CADDY"
  if caddy validate --config "\$CADDY" --adapter caddyfile >/dev/null 2>&1; then
    systemctl reload caddy; echo "route ${DOMAIN} retirée ✓"
  else
    mv "\$CADDY.deploybak" "\$CADDY"; echo "❌ Caddyfile invalide — restauré"; exit 1
  fi
fi
# Ne supprime le dossier que s'il porte NOTRE marqueur.
if [ -f "${REMOTE_DIR}/.claude-deploy-owned" ]; then rm -rf "${REMOTE_DIR}"; echo "${REMOTE_DIR} supprimé ✓"; fi
rm -f ${ENVFILE}
echo "rollback terminé."
EOF
}

case "${1:-}" in
  bootstrap) bootstrap ;;
  inventory) inventory ;;
  deploy)    deploy ;;
  rollback)  rollback ;;
  *) echo "usage: SPYFALL_SSH_HOST=user@ip bash deploy/deploy-vps.sh [bootstrap|inventory|deploy|rollback]"; exit 2 ;;
esac
