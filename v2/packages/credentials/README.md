# @tsundoku/credentials

La clé Google Books est propre à l'appareil. Elle n'est ni synchronisée, ni enregistrée dans SQLite, ni exportée avec la bibliothèque.

Le prototype Web utilise `localStorage`. Android et Windows utiliseront ensuite un stockage sécurisé natif.
