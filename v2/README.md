# @tsundoku/book-sources

Couche commune pour les sources de métadonnées bibliographiques de Tsundoku V2.

Sources incluses :
- Open Library, sans clé API.
- Google Books, avec la clé personnelle de l'utilisateur si elle est disponible.

Les fournisseurs sont normalisés vers `BookSearchResult` et `BookMetadata`.
La base locale Tsundoku reste la source de vérité de l'application.
