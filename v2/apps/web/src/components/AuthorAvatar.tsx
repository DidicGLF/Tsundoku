import { useState } from "react";
import { initialsOf } from "../lib/library-view";
import { cachedAuthorInfo } from "../services/authorInfo";

/**
 * Petite photo d'auteur pour la liste de la bibliothèque. Elle vient du cache seulement : une requête
 * par auteur pour toute la liste serait trop lourde. La photo apparaît donc une fois la page de l'auteur
 * ouverte ; en attendant, ses initiales.
 */
export function AuthorAvatar({ name }: { name: string }) {
  const [broken, setBroken] = useState(false);
  const photo = cachedAuthorInfo(name)?.photoUrl;
  if (photo && !broken) return <img className="author-avatar" src={photo} alt="" loading="lazy" onError={() => setBroken(true)} />;
  return <span className="author-avatar initials" aria-hidden="true">{initialsOf(name)}</span>;
}
