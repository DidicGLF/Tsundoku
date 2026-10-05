# Tsundoku V2

Réécriture de Tsundoku en parallèle de V1.

## Stack actuelle

- React + TypeScript + Vite
- packages partagés dans un workspace pnpm
- Open Library et Google Books pour les métadonnées
- abstraction SQLite prête pour les adaptateurs natifs
- stockage des credentials séparé des données synchronisées

## Lancer le prototype

```bash
pnpm install
pnpm typecheck
pnpm dev
```

V1 reste indépendante de ce dossier.
