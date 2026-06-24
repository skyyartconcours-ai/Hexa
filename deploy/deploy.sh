#!/usr/bin/env bash
# Déploiement de Spyfall FR sur un serveur Linux (Debian/Ubuntu, ex. Hetzner).
# Usage : sudo bash deploy.sh
#
# N'installe que /opt/spyfall et le service systemd "spyfall", sur son propre
# port (3210 par défaut) : les autres applications du serveur ne sont pas
# touchées. Relançable à volonté pour mettre à jour.
set -euo pipefail

REPO="https://github.com/skyyartconcours-ai/Hexa.git"
BRANCH="${SPYFALL_BRANCH:-claude/korean-speyfold-localization-14sse8}"
DIR="/opt/spyfall"
PORT="${SPYFALL_PORT:-3210}"
PASS="${SPYFALL_PASSWORD:-}"
[ -z "$PASS" ] && echo "⚠️  SPYFALL_PASSWORD non défini : l'accès au jeu sera LIBRE. Pour protéger : SPYFALL_PASSWORD=monmotdepasse sudo bash deploy.sh"

command -v git >/dev/null || { apt-get update -qq && apt-get install -y -qq git; }
command -v node >/dev/null || { apt-get update -qq && apt-get install -y -qq nodejs; }

if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch origin "$BRANCH"
  git -C "$DIR" checkout "$BRANCH"
  git -C "$DIR" reset --hard "origin/$BRANCH"
else
  git clone -b "$BRANCH" "$REPO" "$DIR"
fi

# Secret hors de l'unité : fichier d'environnement lisible par root seul. Évite
# le mot de passe en clair dans l'unité ET tout problème de quoting (espaces, #,
# $, " dans le mot de passe casseraient une ligne Environment= inline).
ENVFILE="/etc/spyfall.env"
( umask 077; printf 'SPYFALL_PASSWORD=%s\n' "$PASS" > "$ENVFILE" )
chmod 600 "$ENVFILE"
# Ce déploiement expose Node directement sur $PORT (pas de proxy) : le rate-limit
# utilise la vraie IP (remoteAddress). Si vous ajoutez un reverse-proxy devant,
# décommentez TRUST_PROXY=1 + HOST=127.0.0.1 ci-dessous pour garder l'IP client
# (X-Forwarded-For) fiable — sinon toutes les requêtes paraîtraient venir du proxy.

cat > /etc/systemd/system/spyfall.service <<EOF
[Unit]
Description=Spyfall FR
After=network.target

[Service]
WorkingDirectory=$DIR
ExecStart=$(command -v node) server.js
Environment=PORT=$PORT
#Environment=TRUST_PROXY=1
#Environment=HOST=127.0.0.1
EnvironmentFile=$ENVFILE
Restart=always
RestartSec=2
DynamicUser=yes

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable spyfall >/dev/null
systemctl restart spyfall

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo "✅ Spyfall FR tourne : http://${IP:-<ip-du-serveur>}:$PORT"
echo "   (pensez à ouvrir le port $PORT dans le pare-feu Hetzner si besoin)"
