# Tsundoku V2

V2 est développée en parallèle de la V1.

## Règle importante

La V1 reste la version de production pendant toute la construction et la validation de V2. Aucun fichier racine de la V1 ne doit être supprimé ou remplacé par V2.

## Structure

- `apps/` : applications exécutables
- `packages/types/` : modèles TypeScript partagés
- `packages/core/` : logique métier
- `packages/database/` : stockage local SQLite et repositories (prochaine étape)
- `packages/credentials/` : stockage sécurisé des clés locales (prochaine étape)
- `packages/book-sources/` : Open Library / Google Books (prochaine étape)
- `migration/` : migration V1 → V2

## Démarrage

La V2 utilise pnpm.

```bash
cd v2
pnpm install
pnpm dev
```
