#!/usr/bin/env bash
# Installe le serveur de synchronisation Tsundoku dans un conteneur Debian 12/13 (à lancer en root,
# depuis le dossier extrait de l'archive). Peut être relancé : il met à jour le code sans toucher aux données ni au jeton.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "À lancer en root." >&2; exit 1; fi
here="$(cd "$(dirname "$0")/.." && pwd)"
env_file=/etc/tsundoku-sync.env
app_dir=/opt/tsundoku-sync

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates openssl postgresql

# Node 22 (le dépôt Debian est trop ancien).
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi

id tsundoku >/dev/null 2>&1 || useradd --system --home "$app_dir" --shell /usr/sbin/nologin tsundoku

# Base et jeton : créés une seule fois.
if [ ! -f "$env_file" ]; then
  db_password="$(openssl rand -hex 24)"
  token="$(openssl rand -hex 32)"
  su postgres -c "psql -v ON_ERROR_STOP=1 -q" <<SQL
CREATE ROLE tsundoku LOGIN PASSWORD '$db_password';
CREATE DATABASE tsundoku OWNER tsundoku;
SQL
  umask 077
  cat > "$env_file" <<ENV
DATABASE_URL=postgres://tsundoku:$db_password@127.0.0.1:5432/tsundoku
SYNC_TOKEN=$token
PORT=8787
HOST=127.0.0.1
ENV
  chown root:tsundoku "$env_file"
  chmod 640 "$env_file"
  first_install=1
fi

mkdir -p "$app_dir"
cp -r "$here/dist" "$here/package.json" "$app_dir/"
(cd "$app_dir" && npm install --omit=dev --no-audit --no-fund --silent)
chown -R tsundoku:tsundoku "$app_dir"

cp "$here/deploy/tsundoku-sync.service" /etc/systemd/system/tsundoku-sync.service
systemctl daemon-reload
systemctl enable --now tsundoku-sync
systemctl restart tsundoku-sync
sleep 2
systemctl --no-pager --lines=5 status tsundoku-sync || true

echo
echo "Serveur installé, il écoute sur 127.0.0.1:8787 (visible seulement depuis ce conteneur)."
if [ "${first_install:-}" = 1 ]; then
  echo "Jeton de synchronisation (à saisir dans l'application) :"
  grep '^SYNC_TOKEN=' "$env_file" | cut -d= -f2
  echo "Il reste lisible avec : grep SYNC_TOKEN $env_file"
fi
echo "Étape suivante : le rendre joignable en HTTPS avec Tailscale (voir DEPLOY.md)."
