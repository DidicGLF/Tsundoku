#!/usr/bin/env bash
# Enregistre la clé de signature dans les secrets GitHub du dépôt, pour que le workflow de release signe l'APK.
# Utilise la CLI GitHub (gh), déjà connectée à ton compte (gh auth login). Rien n'est affiché : ni la clé ni le mot de passe.
#   bash scripts/set-signing-secrets.sh
set -euo pipefail
repo="${1:-DidicGLF/Tsundoku}"
dir="${TSUNDOKU_SIGNING_DIR:-$HOME/.tsundoku-signing}"
command -v gh >/dev/null || { echo "La CLI GitHub (gh) est absente : voir le README pour ajouter les secrets à la main." >&2; exit 1; }
[ -f "$dir/tsundoku-release.jks" ] && [ -f "$dir/signing.properties" ] || { echo "Clé introuvable dans $dir" >&2; exit 1; }

base64 -w0 "$dir/tsundoku-release.jks" | gh secret set SIGNING_KEYSTORE_BASE64 --repo "$repo"
sed -n 's/^storePassword=//p' "$dir/signing.properties" | tr -d '\n' | gh secret set SIGNING_PASSWORD --repo "$repo"
echo "Secrets enregistrés dans $repo : SIGNING_KEYSTORE_BASE64 et SIGNING_PASSWORD."
