#!/usr/bin/env bash
# Installe (ou met à jour) le serveur Tsundoku directement depuis GitHub, dans un conteneur Debian 12/13, en root :
#   apt-get update && apt-get install -y curl && curl -fsSL https://raw.githubusercontent.com/DidicGLF/Tsundoku/main/v2/packages/sync-server/deploy/bootstrap.sh | bash
# Relançable à tout moment : il récupère la dernière version, la compile et redémarre le service
# sans toucher à la base ni au jeton.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "À lancer en root." >&2; exit 1; fi
repo="${TSUNDOKU_REPO:-https://github.com/DidicGLF/Tsundoku.git}"
branch="${TSUNDOKU_BRANCH:-main}"
src=/opt/tsundoku-src

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl ca-certificates

# Node 22 (le dépôt Debian est trop ancien) : nécessaire dès la compilation.
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi

if [ -d "$src/.git" ]; then
  git -C "$src" fetch -q origin "$branch"
  git -C "$src" reset -q --hard "origin/$branch"
else
  git clone -q --depth 1 --branch "$branch" "$repo" "$src"
fi

cd "$src/v2/packages/sync-server"
npm install --no-audit --no-fund --silent
npm run build --silent
exec ./deploy/install.sh
