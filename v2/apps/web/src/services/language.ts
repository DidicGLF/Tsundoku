import { normalizeText, type BookSearchLanguage, type BookSearchResult } from "@tsundoku/book-sources";

const languageAliases: Record<Exclude<BookSearchLanguage, "all">, string[]> = {
  fr: ["fr", "fre", "fra", "francais", "french"],
  en: ["en", "eng", "anglais", "english"],
  de: ["de", "ger", "deu", "allemand", "german"],
  es: ["es", "spa", "espagnol", "spanish"],
  it: ["it", "ita", "italien", "italian"]
};

const matchesAlias = (value: string, alias: string) => value === alias || value.startsWith(`${alias} `) || value.startsWith(`${alias}-`);

export type BookLanguageGroup = "preferred" | "unknown" | "other";

export function getBookLanguageGroup(book: BookSearchResult, language: BookSearchLanguage): BookLanguageGroup {
  if (language === "all") return "preferred";
  const value = normalizeText(book.language ?? "");
  if (!value) return "unknown";
  return languageAliases[language].some(alias => matchesAlias(value, alias)) ? "preferred" : "other";
}

export function getBookLanguageLabel(book: BookSearchResult): string {
  const value = normalizeText(book.language ?? "");
  if (!value) return "?";
  for (const [code, aliases] of Object.entries(languageAliases)) {
    if (aliases.some(alias => matchesAlias(value, alias))) return code.toUpperCase();
  }
  return book.language?.trim().slice(0, 5).toUpperCase() || "?";
}

/** Preferred language first, then unknown, then others; the source order is kept inside each group. */
export function rankByLanguage(books: BookSearchResult[], language: BookSearchLanguage): BookSearchResult[] {
  const weight: Record<BookLanguageGroup, number> = { preferred: 2, unknown: 1, other: 0 };
  return books.map((book, index) => ({ book, index, score: weight[getBookLanguageGroup(book, language)] }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(item => item.book);
}
