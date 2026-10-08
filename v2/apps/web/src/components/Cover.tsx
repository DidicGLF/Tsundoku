import { useEffect, useState } from "react";

interface CoverBook { title: string; authors: string[]; coverUrl?: string }

/** Teintes du logo : rouge du soleil, ocre, vert, bleu ardoise et deux nuances froides. */
const LOGO_HUES = [12, 32, 142, 208, 222, 340];

/** Teinte stable dérivée du titre : un même livre garde toujours la même couleur, toujours dans la palette du logo. */
export function hueOf(text: string): number {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return LOGO_HUES[hash % LOGO_HUES.length];
}

/** Titre sans sous-titre ni mention de responsabilité (« Dune / Frank Herbert ; trad. … »). */
function shortTitle(title: string): string {
  return title.split(/\s[/:;]\s|\s\(|\s*\[/)[0].trim() || title;
}

/** Initiale du titre en ignorant l'article (« Le Messie de Dune » → M). */
export function titleInitial(title: string): string {
  const articles = /^(le|la|les|un|une|des|du|de|the|a|an|der|die|das|el|los|las|il)$/i;
  const words = title.trim().replace(/^[LlDd]['’]/, "").split(/\s+/).filter(Boolean);
  const word = words.find(candidate => !articles.test(candidate)) ?? words[0] ?? "";
  const letter = [...word.replace(/^[^\p{L}\p{N}]+/u, "")][0];
  return letter ? letter.toLocaleUpperCase("fr") : "?";
}

/**
 * Jaquette d'un livre. Sans image (ou si elle ne charge pas), une tuile colorée portant
 * le titre prend la place : l'absence de jaquette doit rester présentable.
 * `pending` : une recherche de jaquette est en cours pour ce livre (la tuile pulse).
 * `variant` : « card » (liste), « mini » (ligne de bibliographie), « tile » (grille), « detail » (fiche).
 */
export function Cover({ book, variant = "card", pending = false }: { book: CoverBook; variant?: "card" | "mini" | "detail" | "tile"; pending?: boolean }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [book.coverUrl]);

  const className = variant === "detail" ? "detail-cover" : variant === "mini" ? "mini-cover" : variant === "tile" ? "tile-cover" : "cover";
  if (book.coverUrl && !broken) {
    return <img className={variant === "detail" ? "detail-cover" : variant === "tile" ? "tile-cover" : undefined} src={book.coverUrl} alt="" loading="lazy" onError={() => setBroken(true)} />;
  }

  const title = shortTitle(book.title);
  const author = book.authors[0];
  return <div
    className={`${className} cover-fallback cover-${variant}${pending ? " cover-pending" : ""}`}
    style={{ "--hue": hueOf(title) } as React.CSSProperties}
    aria-hidden="true"
  >
    {variant === "mini"
      ? <b>{titleInitial(title)}</b>
      : <><span className="cover-title">{title}</span>{author && <small className="cover-author">{author}</small>}</>}
  </div>;
}
