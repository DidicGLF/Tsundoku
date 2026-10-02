# @tsundoku/database

Couche d'accès aux données de Tsundoku V2.

```text
React UI
   ↓
Core
   ↓
Repositories
   ↓
SqliteAdapter
   ↓
SQLite
```

L'application ne manipule jamais SQLite directement. Le moteur SQLite sera injecté selon la plateforme.

- Android : SQLite natif
- Windows/Tauri : SQLite natif
- Web/PWA : moteur SQLite compatible navigateur

Les suppressions utilisent `deleted_at` afin de conserver les tombstones nécessaires à la synchronisation.
