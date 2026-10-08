import { useEffect, useState } from "react";
import type { AuthorInfo } from "../lib/author-info";
import { cachedAuthorInfo, fetchAuthorInfo } from "../services/authorInfo";

/** Informations d'un auteur : le cache répond tout de suite, sinon une requête en arrière-plan. */
export function useAuthorInfo(authorName: string): AuthorInfo | null | undefined {
  const [info, setInfo] = useState<AuthorInfo | null | undefined>(() => cachedAuthorInfo(authorName));

  useEffect(() => {
    let active = true;
    const cached = cachedAuthorInfo(authorName);
    setInfo(cached);
    if (cached === undefined) {
      fetchAuthorInfo(authorName).then(
        found => { if (active) setInfo(found); },
        () => { if (active) setInfo(null); }
      );
    }
    return () => { active = false; };
  }, [authorName]);

  return info;
}
