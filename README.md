# Tsundoku

Application web (PWA) pour suivre les romans d'un auteur : possession, statut de lecture, note et avis. Tout est stocké localement dans le navigateur (aucun compte, aucun serveur).

## Utilisation en local

Ouvrir `index.html` avec un petit serveur local (nécessaire pour que le service worker fonctionne), par exemple :

```bash
python3 -m http.server 8000
```

puis aller sur http://localhost:8000.

## Mise en ligne gratuite (GitHub Pages)

1. Créer un dépôt sur GitHub (ex : `tsundoku`) et y pousser ce dossier :
   ```bash
   git remote add origin git@github.com:<votre-utilisateur>/tsundoku.git
   git push -u origin main
   ```
2. Sur GitHub : **Settings → Pages → Source : Deploy from a branch**, choisir la branche `main` et le dossier `/ (root)`.
3. Après quelques minutes, l'app est accessible à `https://<votre-utilisateur>.github.io/tsundoku/`.
4. Sur mobile, ouvrir cette adresse puis « Ajouter à l'écran d'accueil » (Android : menu ⋮ ; iPhone : partager → Sur l'écran d'accueil).

## Notes

- Les romans sont récupérés via l'API publique [Open Library](https://openlibrary.org/developers/api) (aucune clé requise), en ne gardant que les œuvres ayant au moins une édition en français.
- Le titre affiché reste parfois celui de l'édition d'origine cataloguée par Open Library (souvent en anglais) même quand une édition française existe — Open Library ne fournit pas facilement le titre français au niveau de l'œuvre (voir « Google Books (optionnel) » ci-dessous). Un champ « Titre » dans la fiche du roman permet aussi de le renommer à la main quand le résultat automatique est mal formé ; un bouton « Réinitialiser » revient au titre d'origine.
- Comme Open Library liste toutes les œuvres d'un auteur (parfois essais, recueils ou doublons de traductions), utilisez « Retirer de ma liste » sur une fiche pour nettoyer les entrées qui ne sont pas des romans.
- Les données vivent dans le `localStorage` du navigateur utilisé : elles ne se synchronisent pas entre appareils et sont propres à ce navigateur (ne pas vider les données de site pour ce domaine).
- Chaque roman a un champ « Série » libre (ex : « La Belgariade ») à remplir soi-même — Open Library ne fournit pas cette information de façon fiable au niveau œuvre. Le contrôle « Ranger par » (Grille / Série / Statut / Possession), sur la fiche dédiée d'un auteur (accessible en cliquant son nom), regroupe ensuite les romans par cette valeur, par statut de lecture, ou par possession.
- La page d'accueil affiche directement les jaquettes de chaque auteur suivi, groupées en sections — pas besoin de cliquer sur un auteur pour voir sa bibliothèque. Cliquer sur le nom d'un auteur ouvre sa fiche dédiée, avec les filtres/tri/regroupement en plus. Le bouton « Afficher seulement ce qu'il me manque » en haut de la page filtre toutes les sections pour ne montrer que les romans pas encore possédés, tous auteurs confondus.
- Certains auteurs sont dupliqués sur Open Library sous plusieurs fiches identiques (même nom exact), chacune avec une partie seulement de sa bibliographie (ex : David Eddings, Maxime Chattam). Quand vous ajoutez un tel auteur, l'app recherche et fusionne automatiquement toutes les fiches portant exactement le même nom en une seule fois. Si une fiche déjà suivie a été ajoutée avant ce correctif (ou si Open Library ajoute une nouvelle fiche en double plus tard), la recherche l'affichera comme « auteur déjà suivi, clic pour compléter » plutôt que « ✓ suivi » — cliquez dessus pour la fusionner.
- La liste d'un auteur se met à jour toute seule : à chaque visite, si elle n'a pas été vérifiée depuis plus de 24h, l'app revérifie discrètement Open Library en arrière-plan et ajoute les nouveautés (avec une petite notification si elle en trouve). Le bouton « 🔄 Actualiser la liste » sur la fiche auteur force cette vérification immédiatement.
- Chaque roman affiche son ISBN quand on peut le trouver (édition française en priorité, sinon n'importe quelle édition), avec un bouton pour le copier — pratique pour le commander. Recherché automatiquement à l'ouverture de la fiche, via Google Books si une clé est configurée, sinon via Open Library.

## Google Books (optionnel)

Pour obtenir un titre et un résumé réellement en français quand Open Library n'en a pas (ou les a en anglais), l'app peut interroger [Google Books](https://developers.google.com/books) en complément — uniquement quand une clé API est renseignée dans **⚙ Réglages**.

Contrairement à ce qu'on pourrait attendre, Google Books **exige désormais une clé API même pour un simple test** (les appels anonymes reçoivent un quota de 0 requête/jour) — j'ai vérifié en la testant en conditions réelles. Sans clé, cette fonctionnalité reste simplement inactive et l'app fonctionne comme avant (résumé Open Library uniquement).

Pour créer une clé gratuite (~2 minutes, compte Google requis) :
1. Ouvrir [console.cloud.google.com/apis/library/books.googleapis.com](https://console.cloud.google.com/apis/library/books.googleapis.com) et cliquer sur **Activer** (créer un projet si demandé).
2. Aller dans **Identifiants** → **Créer des identifiants** → **Clé API**.
3. Coller la clé dans **⚙ Réglages** de l'app.
4. Recommandé : dans les paramètres de la clé sur Google Cloud, la restreindre à l'API « Books API » uniquement, pour limiter les risques si elle fuite (elle est visible dans les requêtes réseau du navigateur).

Le quota gratuit par défaut (généralement de l'ordre de 1000 requêtes/jour, visible sur le tableau de bord Google Cloud) est largement suffisant pour un usage personnel.
