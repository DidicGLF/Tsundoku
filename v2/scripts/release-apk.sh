#!/usr/bin/env bash
# Construit l'APK de diffusion signé : release/tsundoku-<version>.apk et release/tsundoku.apk (nom fixe pour le lien de la page).
# À lancer dans le nix-shell du projet, depuis v2/ :  nix-shell --run 'bash scripts/release-apk.sh'
# La diffusion normale passe par le workflow GitHub (.github/workflows/release.yml, déclenché par un tag) ; ce script sert à un essai local.
# La clé de signature est lue dans ~/.tsundoku-signing (ou TSUNDOKU_SIGNING_DIR) : elle n'est jamais dans le dépôt.
set -euo pipefail
cd "$(dirname "$0")/.."

signing="${TSUNDOKU_SIGNING_DIR:-$HOME/.tsundoku-signing}"
[ -f "$signing/signing.properties" ] || { echo "Clé de signature introuvable dans $signing" >&2; exit 1; }

# La version vient des tags git (scripts/version.mjs) : « git tag v0.3.0 » avant de lancer ce script pour une vraie version.
export APP_VERSION="$(node scripts/version.mjs)"
version="$APP_VERSION"
echo "Version $version (versionCode $(node scripts/version.mjs --code))"
pnpm build
(cd apps/web && npx cap sync android)
(cd apps/web/android && ./gradlew --no-daemon clean assembleRelease)

apk="apps/web/android/app/build/outputs/apk/release/app-release.apk"
[ -f "$apk" ] || { echo "APK release introuvable (non signé ?)" >&2; exit 1; }
apksigner="$(ls -d "$ANDROID_HOME"/build-tools/*/apksigner | sort -V | tail -1)"
"$apksigner" verify --verbose --print-certs "$apk" | grep -E "Verifies|v2|v3|SHA-256" | head -6
expected="$(tr -d '[:space:]' < scripts/signing-fingerprint.txt)"
actual="$("$apksigner" verify --print-certs "$apk" | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' | head -1)"
[ "$actual" = "$expected" ] || { echo "Empreinte de la clé inattendue : $actual (attendu $expected)" >&2; exit 1; }

mkdir -p release
cp "$apk" "release/tsundoku-$version.apk"
cp "$apk" release/tsundoku.apk
echo
sha256sum "release/tsundoku-$version.apk"
ls -la release/*.apk
