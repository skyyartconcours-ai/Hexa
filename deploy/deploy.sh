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

cat > /etc/systemd/system/spyfall.service <<EOF
[Unit]
Description=Spyfall FR
After=network.target

[Service]
WorkingDirectory=$DIR
ExecStart=$(command -v node) server.js
Environment=PORT=$PORT
Environment=SPYFALL_PASSWORD=$PASS
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
