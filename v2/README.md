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
