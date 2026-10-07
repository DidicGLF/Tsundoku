# Tsundoku V2

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
