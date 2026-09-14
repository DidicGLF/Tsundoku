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

- Les romans sont récupérés via l'API publique [Open Library](https://openlibrary.org/developers/api) (aucune clé requise).
- Comme Open Library liste toutes les œuvres d'un auteur (parfois essais, recueils ou doublons de traductions), utilisez « Retirer de ma liste » sur une fiche pour nettoyer les entrées qui ne sont pas des romans.
- Les données vivent dans le `localStorage` du navigateur utilisé : elles ne se synchronisent pas entre appareils et sont propres à ce navigateur (ne pas vider les données de site pour ce domaine).
