# Tsundoku

Suivi de bibliothèque et de lectures : on suit des auteurs, on voit ce qu'on possède et ce qui manque.
Web (React + Vite) et Android (Capacitor, SQLite natif). Indépendant de la V1.

## Structure

| Dossier | Rôle |
| --- | --- |
| `apps/web` | Application React, adaptateurs SQLite (sql.js sur le web, Capacitor sur Android) |
| `packages/book-sources` | Clients BnF / Open Library / Google Books, normalisation des auteurs, fusion et comparaison de livres |
| `packages/database` | Schéma SQLite versionné (`PRAGMA user_version`) et `SqliteLibraryRepository` |
| `packages/credentials` | Stockage de la clé Google Books, séparé des données |

## Développement

```bash
nix-shell            # Node 22, pnpm, JDK et SDK Android (voir shell.nix)
pnpm install
pnpm dev             # serveur Vite
pnpm test            # Vitest (matching, auteurs, dépôt SQLite en mémoire)
pnpm typecheck
pnpm build
```

Sans compiler pour Android, `nix-shell -p nodejs_22 pnpm` suffit.

## Base de données

Le schéma est une liste de migrations ajoutées à la suite dans `packages/database/src/migrations.ts` :
ne jamais modifier une migration déjà publiée, en ajouter une nouvelle.
Une base issue des builds de prototype (table `library_books`) est supprimée et recréée au démarrage.

La clé Google Books est optionnelle : elle se saisit dans les paramètres de l'app.

## Sources de jaquettes

Les jaquettes sont cherchées par étapes (cache → Open Library par ISBN → Amazon par ISBN-10 →
Open Library par titre → Google Books si une clé est configurée). Sans image, une tuile générée
porte le titre.

**Avant toute distribution publique :** l'étape Amazon utilise l'adresse d'images
`images-na.ssl-images-amazon.com/images/P/<ISBN-10>…`, qui n'est pas une API officielle et dont la
réutilisation relève des conditions d'Amazon. Elle convient à un usage perso ou entre proches.
Pour la couper : `amazon: false` dans `apps/web/src/services/coverSources.ts`.

## Informations sur les auteurs

La page d'un auteur affiche sa description, ses dates, un résumé et sa photo quand ils existent :
Wikipédia (français) d'abord, Open Library en secours pour les dates. Une requête par auteur, mise en
cache 30 jours (7 jours si rien n'est trouvé). Le texte de Wikipédia est sous licence CC BY-SA : le lien
vers l'article reste visible sous le résumé.

## Sauvegarde

- **Automatique (Android)** : la base SQLite est incluse dans la sauvegarde cloud d'Android
  (`res/xml/backup_rules.xml`, `data_extraction_rules.xml`) ; les secrets (clé Google) sont exclus.
- **Export / import manuel** (Paramètres → Sauvegarde) : fichier JSON `tsundoku-sauvegarde-AAAA-MM-JJ.json`
  (livres avec statut, note, dates, jaquettes locales, auteurs suivis). L'import fusionne sans rien écraser :
  un livre déjà présent (même ISBN ou même œuvre) reçoit seulement ce qui lui manque. Format versionné
  (`format`) : une sauvegarde plus récente que l'app est refusée.
- Un rappel s'affiche sur l'accueil si la bibliothèque (≥ 5 livres) n'a jamais été exportée ou pas depuis 30 jours.

## Scan de code-barres ISBN (Android)

Sur l'écran « Ajouter », le bouton « Scanner un ISBN » ouvre le lecteur de Google (ML Kit, via
Play Services, `@capacitor-mlkit/barcode-scanning`). Le module du lecteur est téléchargé la première
fois (quelques secondes, réseau nécessaire). Seul un EAN-13 en 978/979 à clé valide est accepté
(`lib/barcode.ts`) ; la recherche ISBN habituelle est alors lancée. Le bouton n'existe pas sur le web.

## Synchronisation entre appareils

Chaque appareil garde sa base complète (il marche hors ligne) et se synchronise avec le serveur de l'application
(`packages/sync-server` : Node + PostgreSQL). L'utilisateur n'installe rien d'autre que l'app : « Activer la
synchronisation » génère une clé secrète aléatoire (stockage sécurisé) qui identifie sa bibliothèque ; le serveur ne
garde que son empreinte, pas de compte ni d'e-mail. Un autre appareil rejoint la même bibliothèque avec un **code de liaison** court
(8 caractères, valable 5 minutes, à usage unique) tapé sur le nouvel appareil, ou en scannant le QR code de la clé. Le code
sert à chiffrer la clé (PBKDF2 + AES-GCM) avant son dépôt sur le serveur, qui ne voit donc jamais la clé. Unité échangée : la fiche de bibliothèque entière ; la version modifiée en dernier
gagne, les suppressions se propagent. L'utilisateur peut tout effacer du serveur depuis l'app.
Les secrets (clé Google, clé de synchronisation) ne sont jamais synchronisés.

L'adresse du serveur est intégrée au build : `apps/web/.env` avec `VITE_SYNC_URL=https://…` (sans elle,
l'écran propose de la saisir). Installation du serveur (conteneur LXC + Tailscale Funnel) : `packages/sync-server/DEPLOY.md`.

Test de bout en bout contre un vrai PostgreSQL temporaire :
`nix-shell -p nodejs_22 pnpm postgresql --run 'bash packages/sync-server/test/run-with-postgres.sh'`.

### Tests de la synchronisation

- `pnpm test` : scénarios précis (`packages/database/test/sync.test.ts`) et **simulation de convergence**
  (`apps/web/test/sync-convergence.test.ts`) : 3 appareils + 1 appareil neuf font 120 à 600 opérations au hasard
  (même livre ajouté sur plusieurs appareils, modifications concurrentes, suppressions, fusions de doublons, auteurs suivis),
  se synchronisent dans un ordre quelconque, puis doivent tous contenir exactement ce que dit un modèle de référence
  (la version la plus récemment écrite de chaque fiche), sans qu'une synchronisation de plus change quoi que ce soit.
  40 graines + un scénario de 600 opérations.
- Le même scénario tourne à travers le vrai serveur HTTP et un vrai PostgreSQL (graines 101 à 106) avec
  `bash packages/sync-server/test/run-with-postgres.sh` (voir plus haut).
- Les tests ont été vérifiés en cassant volontairement le code (suppressions ignorées, serveur qui accepte une version plus
  ancienne, test de fraîcheur retiré, envoi supprimé, auteurs suivis ignorés) : chacun de ces défauts fait échouer la suite.

## Diffusion : APK, version web et page d'installation

**Publier une version = poser un tag.** Dans VS Code (palette de commandes → « Git: Create Tag » puis « Git: Push Tags »)
ou en ligne de commande :

```bash
git tag v0.3.0
git push origin v0.3.0
```

Le workflow `.github/workflows/release.yml` fait le reste : tests, APK signé, vérification de la signature
(l'empreinte doit être celle de `scripts/signing-fingerprint.txt`), Release GitHub avec `tsundoku.apk` joint et notes de
version générées, puis republication du site avec la même version. Un tag avec un tiret (`v0.3.0-beta.1`) crée une
**pré-version** : la page d'installation et le message « nouvelle version » l'ignorent, c'est le moyen d'essayer.

- **La version vient des tags git** (`scripts/version.mjs`) : plus rien à modifier à la main. `versionName` = le tag,
  `versionCode` = majeur×10000 + mineur×100 + correctif (0.3.0 → 300, 0.2.1 → 201 ; au plus 99 correctifs par version mineure).
  Elle est affichée dans Paramètres → À propos, et l'application Android la compare chaque jour à la dernière Release
  GitHub pour proposer la mise à jour (`services/updateCheck.ts`). Hors tag, une construction locale porte `X.Y.Z-dev.N`.
- **Réglage unique (secrets GitHub)** : le workflow signe avec ta clé, enregistrée dans les secrets du dépôt
  (`SIGNING_KEYSTORE_BASE64` et `SIGNING_PASSWORD`). Avec la CLI GitHub : `gh auth login` puis
  `bash scripts/set-signing-secrets.sh` (rien n'est affiché). Sans elle : Settings → Secrets and variables → Actions → New
  repository secret ; le premier est `base64 -w0 ~/.tsundoku-signing/tsundoku-release.jks`, le second le `storePassword`
  de `~/.tsundoku-signing/signing.properties`.
- **Clé de signature** : `~/.tsundoku-signing/` (`tsundoku-release.jks` + `signing.properties`), hors du dépôt. **À sauvegarder** :
  sans elle, les utilisateurs ne pourraient plus mettre l'application à jour (il faudrait la désinstaller). Un APK de
  debug ne peut pas être mis à jour par un APK release (signatures différentes) : désinstaller d'abord, après avoir
  synchronisé ou exporté la bibliothèque.
- **Essai local** : `nix-shell --run 'bash scripts/release-apk.sh'` construit et vérifie `release/tsundoku-<version>.apk`
  (`APP_VERSION=v0.3.0` pour forcer une version).
- **Version web (PWA) et page d'installation** : `.github/workflows/pages.yml` les construit et les publie sur GitHub Pages
  (`https://didicglf.github.io/Tsundoku/` : page d'installation ; `/app/` : l'application ; `/privacy.html`) à chaque
  push sur `main`. Réglage unique : Settings → Pages → Source : **GitHub Actions**. Le contenu de la page est dans `site/`.
  La version web est construite avec `VITE_PWA=1 VITE_BASE=/Tsundoku/app/` (service worker, mode hors ligne) ; l'APK, sans
  service worker.
- `site/sw.js` est un service worker de nettoyage : l'ancienne V1 de Tsundoku (publiée à cette adresse avant la V2) avait
  enregistré un service worker qui garde l'ancien site en cache ; celui-ci le supprime et se désinscrit.
