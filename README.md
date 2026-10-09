# Tsundoku 積読

*Tsundoku* : acheter des livres et les laisser s'empiler sans les lire. Cette application sert à garder la main sur la pile :
on **suit des auteurs**, on voit **ce qu'on possède et ce qui manque**, et on suit ses lectures.

Application Android et version web installable, qui fonctionnent **hors ligne** et peuvent se **synchroniser entre appareils**.

## Installer

Tout part de la page d'installation : **https://didicglf.github.io/Tsundoku/**

| Appareil | Comment |
| --- | --- |
| Android | Télécharger l'APK (`tsundoku.apk`) depuis la page ou depuis les [Releases](https://github.com/DidicGLF/Tsundoku/releases), puis l'ouvrir. L'app signale elle-même les nouvelles versions. |
| Ordinateur, iPhone | Ouvrir la version web puis « Installer » (ou « Ajouter à l'écran d'accueil »). |

Aucun compte, rien d'autre à installer. [Politique de confidentialité](https://didicglf.github.io/Tsundoku/privacy.html).

## Ce que fait l'application

- **Accueil** : les *nouveautés* parues chez tes auteurs suivis, tes *derniers ajouts*, et des compteurs (livres, en cours, à lire, lus).
- **Auteurs suivis** : bibliographie complète (BnF, Open Library, Google Books), photo et biographie (Wikipédia), détection des séries
  et des nouvelles œuvres. Pour chaque livre : possédé ou manquant.
- **Bibliothèque** : grille de couvertures groupée par auteur, filtres (possédés, manquants, favoris, statut), recherche, tris.
- **Fiche livre** : statut (à lire, en cours, lu), progression, note, dates, édition, changement de jaquette.
- **Ajout rapide** : recherche par titre, auteur ou ISBN, **scan du code-barres** (Android), ajout manuel.
- **Jaquettes** : cherchées automatiquement ; sans image, une tuile colorée porte le titre.
- **Synchronisation** entre appareils, sans compte : une clé aléatoire identifie la bibliothèque, un **code de liaison** court
  (valable 5 minutes) relie un nouvel appareil. Les modifications se propagent en quelques secondes.
- **Filet de sécurité** : confirmation avant suppression, écran « Livres supprimés » (restauration pendant 30 jours),
  export et import de sauvegarde en JSON.

Les données restent d'abord sur l'appareil. Le serveur de synchronisation ne conserve que les fiches de bibliothèque,
rattachées à l'empreinte de la clé : ni nom, ni e-mail. Les clés secrètes (Google Books, synchronisation) ne sont jamais synchronisées.

## Pour les développeurs

Le projet actuel (V2) est dans [`v2/`](v2/) : React + Vite, Capacitor (Android, SQLite natif), `sql.js` sur le web, et un petit
serveur de synchronisation Node + PostgreSQL. Tout est documenté dans **[`v2/README.md`](v2/README.md)** : structure, commandes,
base de données, synchronisation et ses tests, publication d'une version.

Publier une version se résume à poser un tag : `git tag v0.3.1 && git push origin v0.3.1`. GitHub Actions construit l'APK signé,
crée la Release et met le site à jour.

> Les fichiers à la racine (`index.html`, `app.js`, `style.css`, `sw.js`, `icons/`, `manifest.json`) sont l'ancienne V1, conservée
> pour mémoire. Elle n'est plus publiée : la page d'installation et l'application web viennent de `v2/`.
