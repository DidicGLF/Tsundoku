import { useEffect, useState } from "react";

interface CoverBook { title: string; authors: string[]; coverUrl?: string }

/** Teinte stable (0-359) dérivée du titre : un même livre garde toujours la même couleur. */
function hueOf(text: string): number {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}

/** Titre sans sous-titre ni mention de responsabilité (« Dune / Frank Herbert ; trad. … »). */
function shortTitle(title: string): string {
  return title.split(/\s[/:;]\s|\s\(|\s*\[/)[0].trim() || title;
}

/**
 * Jaquette d'un livre. Sans image (ou si elle ne charge pas), une tuile colorée portant
 * le titre prend la place : l'absence de jaquette doit rester présentable.
 * `variant` : « card » (liste), « mini » (ligne de bibliographie), « detail » (fiche).
 */
export function Cover({ book, variant = "card" }: { book: CoverBook; variant?: "card" | "mini" | "detail" }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [book.coverUrl]);

  const className = variant === "detail" ? "detail-cover" : variant === "mini" ? "mini-cover" : "cover";
  if (book.coverUrl && !broken) {
    return <img className={variant === "detail" ? "detail-cover" : undefined} src={book.coverUrl} alt="" loading="lazy" onError={() => setBroken(true)} />;
  }

  const title = shortTitle(book.title);
  const author = book.authors[0];
  return <div
    className={`${className} cover-fallback cover-${variant}`}
    style={{ "--hue": hueOf(title) } as React.CSSProperties}
    aria-hidden="true"
  >
    {variant === "mini"
      ? <b>{[...title][0]?.toLocaleUpperCase("fr") ?? "?"}</b>
      : <><span className="cover-title">{title}</span>{author && <small className="cover-author">{author}</small>}</>}
  </div>;
}
