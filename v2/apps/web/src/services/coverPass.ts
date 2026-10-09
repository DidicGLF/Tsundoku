import { canonicalIsbn, cleanIsbn, isExactCover, type BookSearchLanguage } from "@tsundoku/book-sources";
import { enrichLibraryBooks } from "./authorLibrary";
import type { LibraryBook } from "./library";

/*
 * Passage de jaquettes au lancement : les livres sans jaquette, ou dont la jaquette n'est pas celle de
 * leur édition, sont complétés en arrière-plan. Les échecs sont mémorisés par le service de jaquettes,
 * donc un passage ne refait pas le travail du précédent ; la limite de fréquence évite en plus des
 * requêtes à chaque ouverture de l'application.
 */
const LAST_RUN_KEY = "tsundoku.cover-pass.at";
const MIN_INTERVAL = 12 * 3600 * 1000;
const START_DELAY = 4000;

const hasIsbn = (book: LibraryBook) => Boolean(canonicalIsbn(book) ?? cleanIsbn(book.isbn10));

export function booksNeedingCover(library: LibraryBook[]): LibraryBook[] {
  return library.filter(book => !book.coverUrl || (hasIsbn(book) && !isExactCover(book.coverUrl)));
}

function lastRun(): number {
  try { return Number(localStorage.getItem(LAST_RUN_KEY)) || 0; } catch { return 0; }
}

/** Programme le passage ; renvoie la fonction qui l'annule. Rien n'est lancé s'il n'y a rien à faire. */
export function scheduleLaunchCoverPass(
  library: LibraryBook[], language: BookSearchLanguage, onUpdate: (library: LibraryBook[]) => void, now = Date.now()
): () => void {
  const todo = booksNeedingCover(library);
  if (!todo.length || now - lastRun() < MIN_INTERVAL) return () => undefined;

  let active = true;
  const timer = window.setTimeout(() => {
    try { localStorage.setItem(LAST_RUN_KEY, String(Date.now())); } catch { /* facultatif */ }
    void enrichLibraryBooks(todo, library, language, updated => { if (active) onUpdate(updated); });
  }, START_DELAY);
  return () => { active = false; window.clearTimeout(timer); };
}
