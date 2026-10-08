/**
 * Interrupteurs des sources de jaquettes optionnelles.
 *
 * `amazon` : adresse d'images par ISBN-10 d'Amazon. Elle n'est pas une API officielle et sa
 * réutilisation relève des conditions d'Amazon : acceptable pour un usage perso ou entre
 * proches, à passer à `false` avant toute distribution publique (voir aussi README).
 * Quand elle est coupée ou indisponible, la tuile de substitution prend la place.
 */
export const COVER_SOURCES = {
  amazon: true,
  /**
   * Google Books pour les jaquettes : gain mesuré de 1 à 4 points seulement, au prix du quota
   * quotidien (1000 requêtes) qui sert mieux aux recherches d'ISBN. Coupé par défaut.
   */
  googleBooks: false
} as const;
