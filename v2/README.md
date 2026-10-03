# @tsundoku/credentials

Gestion locale des credentials de Tsundoku V2.

La clé Google Books est propre à chaque appareil.

Elle n'est volontairement :
- pas stockée dans SQLite ;
- pas stockée dans les paramètres synchronisés ;
- pas envoyée à PostgreSQL ;
- pas incluse dans les exports de bibliothèque ;
- pas enregistrée dans Git.

## Web / PWA

`WebCredentialStore` utilise `localStorage`.

Ce stockage n'est pas un coffre-fort : le navigateur doit pouvoir fournir la clé au JavaScript qui effectue les appels Google Books. C'est adapté au modèle personnel prévu pour V2.

## Android / Windows

Nous ajouterons ensuite des implémentations utilisant le stockage sécurisé natif de chaque plateforme.

Le reste de Tsundoku ne dépend que de `CredentialStore`.

## Parcours utilisateur

Au premier lancement, l'utilisateur pourra :
1. configurer sa clé Google Books ;
2. ou continuer sans Google Books.

La bibliothèque locale reste utilisable sans clé.
